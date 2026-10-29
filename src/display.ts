// Ce que l'overlay met en avant, déduit de l'étape du BO et du panneau du jeu.

import { imageLabel, type BuildOrderStep, type StepResources } from "./buildOrder";
import { RESOURCES, type Resource, type Resources } from "./hud";
import { translateTerm } from "./translate";

export interface VillagerFocus {
  resource: Resource;
  count: number;
  /** Autres ressources qui attendent aussi des villageois. */
  others: { resource: Resource; count: number }[];
  /** Étape d'où vient la consigne (l'étape en cours, ou la suivante si elle est faite). */
  stepIndex: number;
}

/**
 * Où envoyer les prochains villageois. Avec le panneau : ce qui manque à l'étape en cours,
 * ou, si sa répartition est faite, ce qu'il faudra pour la suivante. Sans le panneau : ce
 * que l'étape ajoute par rapport à la précédente.
 */
export function villagerFocus(steps: BuildOrderStep[], index: number, gatherers: Resources | null): VillagerFocus | null {
  let stepIndex = index;
  let list = gatherers
    ? missing(steps[index].resources, gatherers)
    : missing(steps[index].resources, previousResources(steps, index));
  if (gatherers && list.length === 0 && index + 1 < steps.length) {
    stepIndex = index + 1;
    list = missing(steps[stepIndex].resources, gatherers);
  }
  if (list.length === 0) return null;
  return { ...list[0], others: list.slice(1), stepIndex };
}

function missing(target: StepResources, have: Resources): { resource: Resource; count: number }[] {
  return RESOURCES.filter((r) => target[r] >= 0 && target[r] > have[r])
    .map((r) => ({ resource: r, count: target[r] - have[r] }))
    .sort((a, b) => b.count - a.count);
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
