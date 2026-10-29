// Ce que l'overlay met en avant, déduit de l'étape du BO et du panneau du jeu.

import { imageLabel, type BuildOrderStep, type StepResources } from "./buildOrder";
import { applyMoves, distributionReached, plannedBuilders, plannedMoves } from "./distribution";
import { effectiveVillagerTargets, nextVillagerResources } from "./engine";
import { RESOURCES, type Resource, type Resources } from "./hud";
import { translateTerm } from "./translate";

export interface VillagerFocus {
  /** Ressource du prochain villageois, ou « build » : il part construire (bâtisseur prévu). */
  resource: Resource | "build";
  /** Étape d'où vient la consigne : l'étape en cours, ou une étape suivante. */
  stepIndex: number;
}

/**
 * Où envoyer le PROCHAIN villageois produit (le point de ralliement du TC).
 *
 * Avec le panneau, on suppose faits les déplacements que l'alerte demande (`plannedMoves`).
 * Tant que l'étape attend des villageois, ou que sa répartition n'est pas faite (le moteur y
 * reste alors), le prochain va à ce qui lui manque encore. Sinon, il appartient à la première
 * étape qui demande plus de villageois qu'il n'y en a : les étapes sans nouveau villageois entre
 * les deux (déplacements, bâtiment, passage d'âge) donnent la répartition de départ, et une
 * étape qui n'ajoute que des bâtisseurs donne « build ». Sans le panneau : ce que l'étape
 * ajoute à la précédente.
 */
export function villagerFocus(
  steps: BuildOrderStep[],
  index: number,
  gatherers: Resources | null,
  villagers: number | null = null,
): VillagerFocus | null {
  const target = steps[index].resources;
  if (!gatherers) {
    const added = (Object.entries(nextVillagerResources(steps, index)) as [Resource, number][]).sort((a, b) => b[1] - a[1]);
    return added.length ? { resource: added[0][0], stepIndex: index } : null;
  }
  const targets = effectiveVillagerTargets(steps);
  const fixed = applyMoves(gatherers, plannedMoves(target, gatherers));
  const producing = villagers === null || villagers < targets[index];
  const now = missing(target, fixed);
  if (now.length && (producing || !distributionReached(target, fixed))) return { resource: now[0], stepIndex: index };
  if (producing && plannedBuilders(target) > 0) return { resource: "build", stepIndex: index };

  const count = Math.max(villagers ?? 0, targets[index]);
  // Le joueur aura fait la répartition de l'étape : on part de là.
  let base = settle(fixed, target);
  for (let j = index + 1; j < steps.length; j++) {
    const step = steps[j].resources;
    if (targets[j] > count) {
      const need = missing(step, base);
      if (need.length) return { resource: need[0], stepIndex: j };
      return plannedBuilders(step) > plannedBuilders(steps[j - 1].resources) ? { resource: "build", stepIndex: j } : null;
    }
    base = settle(base, step);
  }
  return null;
}

/** Répartition une fois l'étape faite : ses cibles, et ce qu'on a pour une cible non précisée. */
function settle(have: Resources, target: StepResources): Resources {
  const out = { ...have };
  for (const r of RESOURCES) if (target[r] >= 0) out[r] = target[r];
  return out;
}

/** Ressources où il manque des villageois, la plus en manque d'abord. */
function missing(target: StepResources, have: Resources): Resource[] {
  return RESOURCES.filter((r) => target[r] >= 0 && target[r] > have[r]).sort(
    (a, b) => target[b] - have[b] - (target[a] - have[a]),
  );
}

export interface HeroModel {
  /** Ressource du prochain villageois ; null : il part construire. */
  resource: Resource | null;
  stepIndex: number;
  /** Icône de la tuile (source de nourriture, ressource, bâtiment à construire). */
  icon: string | null;
  /** Le mot en grand : « BOIS », « MOUTONS », « CONSTRUCTION ». */
  word: string;
  /** Bâtiment à construire, en toutes lettres (sous « CONSTRUCTION »). */
  detail: string | null;
  /** Bâtiment de dépôt que le villageois pose en arrivant (villageois d'une étape suivante). */
  dropOff: IconLabel | null;
  /** Icônes déjà nommées en grand : leur nom n'est pas répété dans les consignes. */
  named: string[];
}

/**
 * Le bloc « Prochain villageois », sans chiffre : les chiffres sont dans les barres (réel /
 * cible) et dans les consignes (total du BO). Chaque nom une seule fois à l'écran.
 */
export function heroModel(
  steps: BuildOrderStep[],
  index: number,
  gatherers: Resources | null,
  villagers: number | null,
): HeroModel | null {
  const focus = villagerFocus(steps, index, gatherers, villagers);
  if (!focus) return null;
  const step = steps[focus.stepIndex];
  if (focus.resource === "build") {
    const building = stepBuilderTarget(step);
    return {
      resource: null,
      stepIndex: focus.stepIndex,
      icon: building?.path ?? null,
      word: "CONSTRUCTION",
      detail: building?.label ?? null,
      dropOff: null,
      named: building ? [building.path] : [],
    };
  }
  const r = focus.resource;
  const source = r === "food" ? foodSource(step) : null;
  const icon = source?.path ?? `resource/resource_${r}.webp`;
  const named = source ? [source.path] : [];
  // Villageois d'une étape suivante (ses consignes ne sont pas affichées) : il pose le bâtiment
  // de dépôt de sa ressource, si le BO ne l'a pas déjà fait construire avant.
  let dropOff = focus.stepIndex !== index ? stepDropOff(step, r) : null;
  if (dropOff && steps.slice(0, focus.stepIndex).some((s) => imagesOf(s).includes(dropOff!.path))) dropOff = null;
  if (dropOff) named.push(dropOff.path);
  return {
    resource: r,
    stepIndex: focus.stepIndex,
    icon,
    word: (source?.label ?? iconLabel(icon)).toUpperCase(),
    detail: null,
    dropOff,
    named,
  };
}

export interface IconLabel {
  path: string;
  label: string;
}

const FOOD_SOURCES: Record<string, string> = {
  "resource/sheep.webp": "moutons",
  "resource/berrybush.webp": "baies",
  "resource/deer.webp": "cerfs",
  "resource/boar.webp": "sanglier",
  "resource/fish.webp": "poisson",
  "resource/cattle.webp": "bétail",
  "building_economy/farm.webp": "fermes",
};

/** Source de nourriture citée par l'étape (moutons, baies, fermes…), pour une consigne précise. */
export function foodSource(step: BuildOrderStep): IconLabel | null {
  for (const path of imagesOf(step)) {
    const label = FOOD_SOURCES[path];
    if (label) return { path, label };
  }
  return null;
}

/** Premier bâtiment cité par l'étape (camp de bûcherons, maison…), en français. */
export function stepBuilding(step: BuildOrderStep): IconLabel | null {
  const path = imagesOf(step).find((p) => p.startsWith("building_") && !p.endsWith("/farm.webp"));
  return path ? { path, label: iconLabel(path) } : null;
}

const DROP_OFFS: [RegExp, Resource[]][] = [
  [/lumber/, ["wood"]],
  [/mining|mine/, ["gold", "stone"]],
  [/mill/, ["food"]],
];

/** Bâtiment de dépôt de l'étape pour cette ressource (camp de bûcherons pour le bois…). */
export function stepDropOff(step: BuildOrderStep, resource: Resource): IconLabel | null {
  const path = imagesOf(step).find(
    (p) => p.startsWith("building_") && DROP_OFFS.some(([name, res]) => name.test(p) && res.includes(resource)),
  );
  return path ? { path, label: iconLabel(path) } : null;
}

/** Bâtiment des bâtisseurs prévus : le premier cité qui n'est pas un dépôt de ressource. */
export function stepBuilderTarget(step: BuildOrderStep): IconLabel | null {
  const buildings = imagesOf(step).filter((p) => p.startsWith("building_") && !p.endsWith("/farm.webp"));
  const path = buildings.find((p) => !DROP_OFFS.some(([name]) => name.test(p))) ?? buildings[0];
  return path ? { path, label: iconLabel(path) } : null;
}

/** Landmark cité par l'étape (pour le passage d'âge). */
export function stepLandmark(step: BuildOrderStep): IconLabel | null {
  const path = imagesOf(step).find((p) => p.startsWith("landmark_"));
  return path ? { path, label: iconLabel(path) } : null;
}

/** Icônes que tout joueur reconnaît d'un coup d'œil : pas besoin d'écrire leur nom à côté. */
export function isWellKnownIcon(path: string): boolean {
  return /^(resource\/resource_(food|wood|gold|stone)|unit_worker\/villager[^/]*|age\/age_\d)\.webp$/.test(path);
}

/** Noms que le fichier ne donne pas (mot collé, verbe homonyme…). */
const ICON_NAMES: Record<string, string> = {
  ...FOOD_SOURCES,
  "resource/resource_food.webp": "nourriture",
  "resource/resource_wood.webp": "bois",
  "resource/resource_gold.webp": "or",
  "resource/resource_stone.webp": "pierre",
  "resource/oliveoil.webp": "huile d'olive",
  "resource/gaiatreeprototypetree.webp": "arbre",
  "resource/wolf.webp": "loup",
  "resource/relics.webp": "reliques",
  "resource/repair.webp": "réparation",
  "abilities/repair.webp": "réparation",
  "building_defensive/keep.webp": "donjon",
};

const ROMAN = ["", "I", "II", "III", "IV"];

/**
 * Nom en français d'une icône du jeu (« baies », « camp de bûcherons »). Un nom inconnu
 * (unité d'une nouvelle civ) reste en anglais ; un landmark garde son nom propre.
 */
export function iconLabel(path: string): string {
  const known = ICON_NAMES[path];
  if (known) return known;
  if (path.startsWith("unit_worker/villager")) return "villageois";
  const age = /^age\/age_(\d)\./.exec(path);
  if (age) return `âge ${ROMAN[Number(age[1])] ?? age[1]}`;
  const label = imageLabel(path);
  return path.startsWith("landmark_") ? titleCase(label) : translateTerm(label);
}

function imagesOf(step: BuildOrderStep): string[] {
  return step.notes.flatMap((note) => [...note.matchAll(/@([^@]+\.(?:webp|png|jpe?g|gif))@/gi)].map((m) => m[1]));
}

function titleCase(text: string): string {
  return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}
