// Journal local des parties, jamais envoyé : la partie détectée, ce que tu as lancé et gardé.
// Il nourrit le conseil de BO du début de partie (src/advice.ts). Ni clé API, ni nom ni
// identifiant d'adversaire : seulement les civs, le mode et la carte.

import { soloOpponent, type DetectedGame } from "./aoe4world";

/** Choisi avant la partie, choisi pendant (bouton, raccourci, bibliothèque), ou lancé tout seul. */
export type LaunchHow = "pre" | "choice" | "auto";

export interface Launch {
  buildId: string;
  how: LaunchHow;
  /** Horloge du jeu au lancement, en secondes (estimée quand l'écran n'est pas lu). */
  clock: number;
}

export interface GameEntry {
  gameId: number;
  /** Détection de la partie (ms). */
  at: number;
  kind: string;
  map: string;
  civ: string;
  randomCiv: boolean;
  /** Civ adverse, en 1v1 seulement. */
  opponentCiv: string | null;
  launches: Launch[];
  /** Lancement automatique annulé. */
  refused: boolean;
  /** Étapes passées par le moteur pendant que le BO lancé tout seul était actif. */
  autoSteps: number;
  /** Horloge du premier passage d'âge vu, en secondes. */
  ageUpAt: number | null;
}

/** Le BO gardé est celui actif à 4:00 de jeu, ou au premier passage d'âge s'il vient avant. */
export const KEEP_CLOCK = 240;
/** Un changement après 1:30 (réaction à un scout) ne compte pas pour l'habitude avec la civ. */
export const CHANGE_CLOCK = 90;
/** Un lancement automatique ne compte que s'il a été suivi : 3 étapes passées par le moteur. */
export const FOLLOWED_STEPS = 3;
const MAX_ENTRIES = 500;

export function newEntry(game: DetectedGame, now: number): GameEntry {
  return {
    gameId: game.id,
    at: now,
    kind: game.kind,
    map: game.map,
    civ: game.myCivilization,
    randomCiv: game.randomCiv,
    opponentCiv: soloOpponent(game),
    launches: [],
    refused: false,
    autoSteps: 0,
    ageUpAt: null,
  };
}

/** BO gardé : le dernier lancé avant 4:00 (ou avant le premier passage d'âge). */
export function keptLaunch(entry: GameEntry): Launch | null {
  const limit = Math.min(KEEP_CLOCK, entry.ageUpAt ?? KEEP_CLOCK);
  const before = entry.launches.filter((l) => l.clock <= limit);
  return before[before.length - 1] ?? null;
}

/** BO pour l'habitude avec la civ : le dernier lancé avant 1:30, sinon le premier lancé. */
export function habitLaunch(entry: GameEntry): Launch | null {
  if (!keptLaunch(entry)) return null;
  const early = entry.launches.filter((l) => l.clock <= CHANGE_CLOCK);
  return early[early.length - 1] ?? entry.launches[0];
}

/** Un choix actif pèse 1 ; un lancement automatique aussi s'il a été suivi, sinon 0. */
export function launchWeight(entry: GameEntry, launch: Launch): number {
  return launch.how !== "auto" || entry.autoSteps >= FOLLOWED_STEPS ? 1 : 0;
}

/** Lit le fichier du journal ; une entrée illisible est ignorée, jamais le journal entier. */
export function parseJournal(text: string): GameEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .filter((e) => typeof e?.gameId === "number" && typeof e.civ === "string" && Array.isArray(e.launches))
    .map((e) => ({ kind: "", map: "", randomCiv: false, opponentCiv: null, refused: false, autoSteps: 0, ageUpAt: null, at: 0, ...e }));
}

/** Les 500 dernières parties suffisent au conseil. */
export function serializeJournal(entries: GameEntry[]): string {
  return JSON.stringify(entries.slice(-MAX_ENTRIES));
}
