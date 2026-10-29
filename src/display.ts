// Ce que l'overlay met en avant, déduit de l'étape du BO et du panneau du jeu.

import { imageLabel, type BuildOrderStep, type StepResources } from "./buildOrder";
import { RESOURCES, type Resource, type Resources } from "./hud";
import { translateTerm } from "./translate";

export interface VillagerFocus {
  /** Ressource du prochain villageois, ou « build » : il part construire (bâtisseur prévu). */
  resource: Resource | "build";
  /** Étape d'où vient la consigne (l'étape en cours, ou la suivante si elle est faite). */
  stepIndex: number;
}

/**
 * Où envoyer le PROCHAIN villageois produit (le point de ralliement du TC).
 *
 * Avec le panneau, on suppose faits les déplacements que l'alerte demande (les villageois en
 * trop vont là où il en manque) : ce qui manque encore à l'étape revient aux villageois à
 * produire pour elle. S'il n'en reste plus à produire (`toProduce` ≤ 0), ou si la répartition
 * est faite, le prochain villageois est pour l'étape suivante. Sans le panneau : ce que
 * l'étape ajoute à la précédente.
 */
export function villagerFocus(
  steps: BuildOrderStep[],
  index: number,
  gatherers: Resources | null,
  toProduce: number | null = null,
): VillagerFocus | null {
  const target = steps[index].resources;
  if (!gatherers) {
    const added = missing(target, previousResources(steps, index));
    return added.length ? { resource: added[0], stepIndex: index } : null;
  }
  const fixed = afterMoves(target, gatherers);
  const producing = toProduce === null || toProduce > 0;
  const now = missing(target, fixed);
  if (producing && now.length) return { resource: now[0], stepIndex: index };
  // Répartition faite mais villageois encore à produire : ce sont les bâtisseurs prévus.
  if (producing && (target.builder ?? 0) > 0) return { resource: "build", stepIndex: index };
  const next = steps[index + 1];
  if (!next) return null;
  // Le joueur aura corrigé la répartition : on part de la cible de l'étape en cours.
  const base = { ...fixed };
  for (const r of RESOURCES) base[r] = Math.max(base[r], target[r]);
  const later = missing(next.resources, base);
  return later.length ? { resource: later[0], stepIndex: index + 1 } : null;
}

/**
 * Répartition une fois corrigée : les villageois en trop (au-delà des bâtisseurs prévus, qui
 * récoltent en attendant) vont aux ressources où il en manque le plus. Même règle que l'alerte.
 */
function afterMoves(target: StepResources, have: Resources): Resources {
  const out = { ...have };
  const counted = RESOURCES.filter((r) => target[r] >= 0);
  const excess = counted.reduce((sum, r) => sum + Math.max(0, have[r] - target[r]), 0);
  let movable = Math.max(0, excess - Math.max(0, target.builder ?? 0));
  const short = counted.filter((r) => have[r] < target[r]).sort((a, b) => target[b] - have[b] - (target[a] - have[a]));
  for (const r of short) {
    const take = Math.min(movable, target[r] - out[r]);
    out[r] += take;
    movable -= take;
  }
  return out;
}

/** Ressources où il manque des villageois, la plus en manque d'abord. */
function missing(target: StepResources, have: Resources): Resource[] {
  return RESOURCES.filter((r) => target[r] >= 0 && target[r] > have[r]).sort(
    (a, b) => target[b] - have[b] - (target[a] - have[a]),
  );
}

function previousResources(steps: BuildOrderStep[], index: number): Resources {
  const previous = index > 0 ? steps[index - 1].resources : null;
  const value = (r: Resource) => Math.max(0, previous?.[r] ?? 0);
  return { food: value("food"), wood: value("wood"), gold: value("gold"), stone: value("stone") };
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
