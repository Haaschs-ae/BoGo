// Moteur qui fait avancer le BO tout seul d'après le panneau lu à l'écran.
//
// - Étape « villageois » : on passe à la suivante dès qu'un villageois de plus que la
//   cible apparaît (6 → le 7e sort du TC → étape suivante : où l'envoyer).
// - Étape « passe l'âge » ou « construis un TC » : on attend que les ressources soient
//   dépensées d'un coup (clic sur le monument ou pose du TC), puis on avance.
// - Répartition : un villageois en trop sur une ressource déclenche une alerte.
// Un changement d'étape à la main est respecté jusqu'au prochain nouveau villageois.

import type { BuildOrderStep } from "./buildOrder";
import { civilizationId } from "./civs";
import costs from "./data/costs.json";
import { RESOURCES, type HudReading, type Resource, type Resources } from "./hud";

export type StepGoal = { kind: "villagers" } | { kind: "age"; age: number } | { kind: "tc" };

export const AGE_NAMES: Record<number, string> = { 2: "II · Féodal", 3: "III · Château", 4: "IV · Impérial" };

type Cost = Partial<Resources>;
// Coûts par civ, extraits des données d'AoE4World (scripts/extract_costs.py).
const COSTS = costs as Record<string, { townCenter: Cost | null; ages: Record<string, Cost[]> }>;
const DEFAULT_COSTS = COSTS.english;

const LANDMARK_NOTE = /landmark_|age\/age_|age up|aging|passe[rz]? (l'|à l')?[âa]ge|monument/i;
const TC_IMAGE = /town-?center\.webp/i;
const TC_BUILD = /build|constru|2nd|second|deuxi|new|nouveau|another|autre|\+ ?1/i;

/** L'étape fait produire autre chose que des villageois (icône d'unité dans les consignes). */
export function trainsNonVillagers(step: BuildOrderStep): boolean {
  return step.notes.some((note) => /@unit_(?!worker\/)[^@]*@/.test(note));
}

/** Villageois visés à la fin de l'étape ; -1 dans le BO : somme de la répartition. */
export function villagerTarget(step: BuildOrderStep): number {
  if (step.villager_count >= 0) return step.villager_count;
  const r = step.resources;
  return [r.food, r.wood, r.gold, r.stone, r.builder ?? 0].reduce((sum, n) => sum + Math.max(0, n), 0);
}

/**
 * Cible de villageois de chaque étape, jamais inférieure à celle des étapes précédentes :
 * une étape à -1 ou plus basse (simple construction…) garde la cible d'avant, comme RTS_Overlay.
 */
export function effectiveVillagerTargets(steps: BuildOrderStep[]): number[] {
  let max = 0;
  return steps.map((step) => (max = Math.max(max, villagerTarget(step))));
}

export function stepGoal(steps: BuildOrderStep[], index: number): StepGoal {
  const transition = ageTransitionAt(steps, index);
  if (transition) return { kind: "age", age: transition };
  // Les mots-clés sont cherchés hors images : « building_economy/… » contient « build ».
  const tc = steps[index].notes.some((note) => TC_IMAGE.test(note) && TC_BUILD.test(note.replace(/@[^@]*@/g, " ")));
  return tc ? { kind: "tc" } : { kind: "villagers" };
}

/** Si l'âge monte entre l'étape `index` et la suivante, la consigne de passage est sur l'une
 *  des deux : celle qui parle du monument / du passage d'âge, sinon la dernière de l'âge. */
function ageTransitionAt(steps: BuildOrderStep[], index: number): number | null {
  const ageOf = (i: number) => (steps[i].age >= 1 && steps[i].age <= 4 ? steps[i].age : null);
  const mentions = (i: number) => steps[i].notes.some((n) => LANDMARK_NOTE.test(n));
  const before = (i: number) => {
    for (let j = i; j >= 0; j--) if (ageOf(j)) return ageOf(j)!;
    return 1;
  };

  // Transition entre index et index + 1 : la consigne est sur index, sauf si seule la suivante en parle.
  if (index + 1 < steps.length) {
    const next = ageOf(index + 1);
    if (next && next > before(index) && !(mentions(index + 1) && !mentions(index))) return next;
  }
  // Transition entre index - 1 et index, consigne portée par index.
  if (index > 0) {
    const here = ageOf(index);
    if (here && here > before(index - 1) && mentions(index) && !mentions(index - 1)) return here;
  }
  return null;
}

/** Coûts possibles de l'objectif pour cette civ (plusieurs landmarks ou technologies
 *  de passage d'âge), du plus courant au moins courant. */
export function goalCosts(goal: StepGoal, civilization: string): Cost[] {
  const civ = COSTS[civilizationId(civilization) ?? ""] ?? DEFAULT_COSTS;
  if (goal.kind === "tc") return civ.townCenter ? [civ.townCenter] : [];
  if (goal.kind === "age") return civ.ages[goal.age] ?? DEFAULT_COSTS.ages[goal.age] ?? [];
  return [];
}

/** Ressources vers lesquelles partent les prochains villageois de l'étape. */
export function nextVillagerResources(steps: BuildOrderStep[], index: number): Partial<Resources> {
  const target = steps[index].resources;
  const previous = index > 0 ? steps[index - 1].resources : { food: 0, wood: 0, gold: 0, stone: 0 };
  const result: Partial<Resources> = {};
  for (const r of RESOURCES) {
    const delta = target[r] - Math.max(0, previous[r]);
    if (target[r] >= 0 && delta > 0) result[r] = delta;
  }
  return result;
}

export interface Misplacement {
  from: Resource;
  to: Resource | null;
  count: number;
}

export interface EngineState {
  index: number;
  goal: StepGoal;
  /** Coût habituel de l'objectif (le plus courant pour la civ). */
  cost: Cost | null;
  /** Les ressources de l'une des options de l'objectif sont en stock. */
  affordable: boolean;
  villagers: number | null;
  misplacement: Misplacement | null;
}

const CONFIRM_READINGS = 2;
const MISPLACEMENT_SECONDS = 3;
const SPEND_RATIO = 0.75;
/** Le TC peut coûter moins cher après certaines technologies : seuil plus bas. */
const TC_SPEND_RATIO = 0.6;
/** Si le clic n'a pas été vu, on avance quand même après ce nombre de villageois en plus. */
const FALLBACK_EXTRA_VILLAGERS = 4;
/** Répartition pas encore atteinte : on avance quand même après ce nombre de villageois en plus. */
const UNBALANCED_EXTRA_VILLAGERS = 3;
/** Villageois manquants tolérés sur la répartition (en chemin, lecture) en plus des bâtisseurs. */
const DISTRIBUTION_TOLERANCE = 1;

export class BuildEngine {
  index = 0;
  /** Pourquoi le BO a changé d'étape, du plus récent au plus ancien (affiché dans les réglages). */
  log: string[] = [];
  private readonly targets: number[];
  /** Villageois estimés (voir estimateVillagers). */
  private villagers: number | null = null;
  private counted = new Confirmed();
  private population = new Confirmed();
  /** Population et villageois comptés lors de la dernière hausse de population vue. */
  private previous: { population: number; counted: number } | null = null;
  /** Après un changement à la main, il faut dépasser ce nombre de villageois pour avancer. */
  private floor = 0;
  private history: { at: number; stock: Resources }[] = [];
  private misplacedSince: { key: string; at: number } | null = null;
  private last: HudReading | null = null;

  constructor(
    private readonly steps: BuildOrderStep[],
    private readonly civilization: string,
  ) {
    this.targets = effectiveVillagerTargets(steps);
  }

  /** Changement d'étape au clavier : respecté jusqu'au prochain nouveau villageois. */
  setStep(index: number, reason = "clavier") {
    const target = Math.max(0, Math.min(index, this.steps.length - 1));
    if (target !== this.index) this.record(target, reason);
    this.index = target;
    this.floor = this.villagers ?? 0;
  }

  private record(to: number, reason: string) {
    this.log = [`Étape ${this.index + 1} → ${to + 1} : ${reason}`, ...this.log].slice(0, 8);
  }

  update(reading: HudReading, now: number): EngineState {
    this.last = reading;
    this.estimateVillagers(reading);
    this.history = [...this.history.filter((h) => now - h.at <= 8000), { at: now, stock: reading.stock }];

    this.applySpending(now);
    this.advanceOnVillagers();
    return this.state(now);
  }

  state(now = Date.now()): EngineState {
    const goal = stepGoal(this.steps, this.index);
    const options = goalCosts(goal, this.civilization);
    const stock = this.last?.stock;
    const affordable =
      !!stock && options.some((cost) => Object.entries(cost).every(([r, n]) => stock[r as Resource] >= (n ?? 0)));
    return {
      index: this.index,
      goal,
      cost: options[0] ?? null,
      affordable,
      villagers: this.villagers,
      misplacement: this.checkMisplacement(now),
    };
  }

  /**
   * Le panneau ne montre pas tous les villageois : ceux qui construisent ou marchent
   * n'apparaissent nulle part, et un inactif reste compté sur sa dernière ressource.
   * On part donc des villageois comptés, sans jamais redescendre (un bâtisseur reste un
   * villageois), et chaque hausse de population compte comme un nouveau villageois, sauf
   * si l'étape produit aussi de l'armée : alors seulement si un villageois de plus apparaît.
   */
  private estimateVillagers(reading: HudReading) {
    const counted = this.counted.read(reading.villagers);
    const population = this.population.read(reading.population);
    if (counted === null || population === null) return;

    let estimate = this.villagers ?? counted;
    if (this.previous && population > this.previous.population) {
      const produced = population - this.previous.population;
      const newlyCounted = Math.max(0, counted - this.previous.counted);
      estimate += trainsNonVillagers(this.steps[this.index]) ? Math.min(produced, newlyCounted) : produced;
    }
    if (!this.previous || population !== this.previous.population) this.previous = { population, counted };
    this.villagers = Math.min(Math.max(estimate, counted), population);
  }

  private advanceOnVillagers() {
    const v = this.villagers;
    if (v === null || v <= this.floor) return;
    const start = this.index;
    let reason = "";
    while (this.index < this.steps.length - 1) {
      const goal = stepGoal(this.steps, this.index);
      const target = this.targets[this.index];
      const needed = goal.kind === "villagers" ? target : target + FALLBACK_EXTRA_VILLAGERS;
      if (v <= needed) break;
      // Répartition de l'étape pas encore faite (trop à la nourriture, pas assez à l'or…) :
      // on reste sur l'étape, l'alerte dit quoi corriger, sauf si le joueur a décroché du BO.
      const balanced = this.distributionReached(this.index);
      if (goal.kind === "villagers" && !balanced && v < target + UNBALANCED_EXTRA_VILLAGERS) break;
      reason ||=
        goal.kind !== "villagers"
          ? `${v} villageois, clic non vu`
          : balanced
            ? `${v} villageois > ${target}`
            : `${v} villageois, répartition pas suivie`;
      this.index++;
    }
    if (this.index !== start) {
      const end = this.index;
      this.index = start;
      this.record(end, reason);
      this.index = end;
    }
  }

  /** Les villageois sont répartis comme l'étape le demande, à quelques villageois près. */
  private distributionReached(index: number): boolean {
    const gatherers = this.last?.gatherers;
    if (!gatherers) return true;
    const target = this.steps[index].resources;
    const missing = RESOURCES.reduce((sum, r) => sum + Math.max(0, target[r] - gatherers[r]), 0);
    return missing <= DISTRIBUTION_TOLERANCE + Math.max(0, target.builder ?? 0);
  }

  /**
   * Le haut de l'écran montre un landmark en construction (passage d'âge lancé) : si une
   * étape de passage d'âge est en cours ou toute proche, on passe à la suivante.
   */
  ageUpStarted() {
    for (let i = this.index; i < Math.min(this.index + 3, this.steps.length); i++) {
      if (stepGoal(this.steps, i).kind !== "age") continue;
      const to = Math.min(i + 1, this.steps.length - 1);
      if (to !== this.index) this.record(to, "passage d'âge en cours (vu en haut de l'écran)");
      this.index = to;
      this.floor = 0;
      return;
    }
  }

  /** Grosse dépense confirmée sur deux lectures : passage d'âge ou TC posé. */
  private applySpending(now: number) {
    const recent = this.history.filter((h) => now - h.at < 2500);
    const older = this.history.filter((h) => now - h.at >= 2500 && now - h.at <= 6000);
    if (recent.length < 2 || older.length === 0) return;
    const drop = (r: Resource) =>
      Math.min(...older.map((h) => h.stock[r])) - Math.max(...recent.map((h) => h.stock[r]));
    const paid = (cost: Cost, ratio: number) =>
      Object.entries(cost).every(([r, n]) => drop(r as Resource) >= ratio * (n ?? 0));

    // Le joueur peut cliquer un peu avant ou après l'étape prévue : on regarde les prochaines étapes.
    for (let i = this.index; i < Math.min(this.index + 3, this.steps.length); i++) {
      const goal = stepGoal(this.steps, i);
      const options = goalCosts(goal, this.civilization);
      // Pour un TC, seule la plus grosse ressource du coût compte, avec un seuil plus bas.
      const done =
        goal.kind === "tc"
          ? options.some((cost) => paid(Object.fromEntries([largest(cost)]), TC_SPEND_RATIO))
          : options.some((cost) => paid(cost, SPEND_RATIO));
      if (done) {
        const to = Math.min(i + 1, this.steps.length - 1);
        this.record(to, goal.kind === "tc" ? "TC payé" : "passage d'âge payé");
        this.index = to;
        this.floor = 0;
        this.history = [];
        return;
      }
    }
  }

  private checkMisplacement(now: number): Misplacement | null {
    const reading = this.last;
    if (!reading) return null;
    const target = this.steps[this.index].resources;
    const over = (r: Resource) => reading.gatherers[r] - target[r];
    const excess = RESOURCES.filter((r) => target[r] >= 0 && over(r) > 0);
    // Les bâtisseurs prévus par le BO récoltent en attendant de construire : autant de
    // villageois en trop ne sont pas une erreur.
    const builders = Math.max(0, target.builder ?? 0);
    const totalExcess = excess.reduce((sum, r) => sum + over(r), 0);
    if (excess.length === 0 || totalExcess <= builders) {
      this.misplacedSince = null;
      return null;
    }
    const from = excess.sort((a, b) => over(b) - over(a))[0];
    const count = Math.min(over(from), totalExcess - builders);
    const to =
      RESOURCES.filter((r) => target[r] >= 0 && reading.gatherers[r] < target[r]).sort(
        (a, b) => target[b] - reading.gatherers[b] - (target[a] - reading.gatherers[a]),
      )[0] ?? null;

    // L'alerte n'apparaît que si l'écart dure (villageois en chemin, lecture ratée).
    const key = `${from}>${to}`;
    if (this.misplacedSince?.key !== key) this.misplacedSince = { key, at: now };
    if (now - this.misplacedSince.at < MISPLACEMENT_SECONDS * 1000) return null;
    return { from, to, count };
  }
}

function largest(cost: Cost): [Resource, number] {
  return (Object.entries(cost) as [Resource, number][]).sort((a, b) => b[1] - a[1])[0];
}

/** Valeur retenue seulement après deux lectures identiques de suite (chiffre mal lu). */
class Confirmed {
  private candidate: { value: number; seen: number } | null = null;
  private value: number | null = null;

  read(value: number): number | null {
    if (this.candidate?.value === value) this.candidate.seen++;
    else this.candidate = { value, seen: 1 };
    if (this.candidate.seen >= CONFIRM_READINGS) this.value = value;
    return this.value;
  }
}
