// Répartition des villageois : une seule règle pour l'alerte (« de trop à la nourriture →
// envoie-les au bois »), le passage d'étape du moteur et le bloc « Prochain villageois ».

import type { StepResources } from "./buildOrder";
import { RESOURCES, type Resource, type Resources } from "./hud";

/** Villageois qui peuvent manquer sans bloquer l'étape (lecture ratée, villageois en chemin). */
export const DISTRIBUTION_TOLERANCE = 1;

export interface Move {
  from: Resource;
  /** Où les envoyer ; null s'il ne manque personne ailleurs (villageois en plus). */
  to: Resource | null;
  /** Villageois à déplacer vers `to`. */
  count: number;
  /** Villageois en trop sur `from` (hors bâtisseurs prévus), dont `count` vont à `to`. */
  excess: number;
}

/** Bâtisseurs prévus par l'étape : ils récoltent en attendant de construire. */
export function plannedBuilders(target: StepResources): number {
  return Math.max(0, target.builder ?? 0);
}

/**
 * Déplacements qui corrigent la répartition, dans l'ordre : le plus gros surplus vers le plus
 * gros manque, chaque déplacement plafonné à ce qui manque à la destination. Les villageois en
 * trop au-delà des bâtisseurs prévus seulement ; sans manque ailleurs, le surplus est signalé
 * sans destination.
 */
export function plannedMoves(target: StepResources, have: Resources): Move[] {
  const counted = RESOURCES.filter((r) => target[r] >= 0);
  const over = new Map(counted.filter((r) => have[r] > target[r]).map((r) => [r, have[r] - target[r]]));
  const under = new Map(counted.filter((r) => have[r] < target[r]).map((r) => [r, target[r] - have[r]]));
  let movable = Math.max(0, [...over.values()].reduce((a, b) => a + b, 0) - plannedBuilders(target));
  const moves: Move[] = [];
  while (movable > 0 && over.size > 0) {
    const from = largest(over);
    const excess = Math.min(over.get(from)!, movable);
    const to = under.size > 0 ? largest(under) : null;
    const count = to ? Math.min(excess, under.get(to)!) : excess;
    moves.push({ from, to, count, excess });
    take(over, from, count);
    if (to) take(under, to, count);
    movable -= count;
  }
  return moves;
}

/** Répartition une fois les déplacements faits. */
export function applyMoves(have: Resources, moves: Move[]): Resources {
  const out = { ...have };
  for (const move of moves) {
    if (!move.to) continue;
    out[move.from] -= move.count;
    out[move.to] += move.count;
  }
  return out;
}

/** Villageois qui manquent encore aux ressources de l'étape. */
export function distributionGap(target: StepResources, have: Resources): number {
  return RESOURCES.reduce((sum, r) => sum + (target[r] >= 0 ? Math.max(0, target[r] - have[r]) : 0), 0);
}

/** Les villageois sont répartis comme l'étape le demande, à quelques villageois près. */
export function distributionReached(target: StepResources, have: Resources): boolean {
  return distributionGap(target, have) <= DISTRIBUTION_TOLERANCE + plannedBuilders(target);
}

/** Clé la plus grande ; à égalité, l'ordre des ressources (nourriture, bois, or, pierre). */
function largest(map: Map<Resource, number>): Resource {
  return [...map.entries()].sort((a, b) => b[1] - a[1] || RESOURCES.indexOf(a[0]) - RESOURCES.indexOf(b[0]))[0][0];
}

function take(map: Map<Resource, number>, key: Resource, n: number) {
  const left = map.get(key)! - n;
  if (left > 0) map.set(key, left);
  else map.delete(key);
}
