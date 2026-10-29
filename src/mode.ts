// Deux modes de jeu. Entraînement (contre l'IA) : BoGo te coache. Versus (contre des joueurs,
// en classé, en rapide ou en personnalisée) : ton BO, qui tourne ses pages tout seul, et tes
// comptes en direct (ce que le jeu affiche déjà) ; jamais de consigne qui décide à ta place
// (« envoie-les au bois », « clique ! », alertes) : ça, c'est pour l'entraînement. AoE4World prouve la présence d'humains, jamais celle de l'IA : quand BoGo ne
// sait pas, c'est Versus. Voir docs/profil-et-modes.md.

import { opposition, type DetectedGame } from "./aoe4world";
import type { EngineState } from "./engine";
import type { HudReading } from "./hud";

export type PlayMode = "training" | "versus";

/** Ce que chaque mode montre en partie : un plafond codé, pas une préférence. */
export interface ModeFeatures {
  /** Comptes lus à l'écran face aux cibles : barres réel / cible, stock du passage d'âge. */
  liveCounts: boolean;
  /** Alertes de répartition et de villageois inactifs (bandeau et pastille). */
  alerts: boolean;
  /** « +N villageois sans suivre cette étape ». */
  drift: boolean;
  /** Prochain villageois calculé sur ta partie ; sinon ce que l'étape ajoute, tel qu'écrit. */
  liveHero: boolean;
  /** « C'est le moment : clique ! » quand le passage d'âge ou le TC est payable. */
  affordable: boolean;
  /** Le moteur juge la répartition (pages et conseils) ; sinon le nombre de villageois écrit suffit. */
  coaching: boolean;
}

export const FEATURES: Record<PlayMode, Readonly<ModeFeatures>> = {
  training: { liveCounts: true, alerts: true, drift: true, liveHero: true, affordable: true, coaching: true },
  // Comptes en direct en VS aussi (choix du joueur, 29/10) : le jeu les affiche déjà.
  versus: { liveCounts: true, alerts: false, drift: false, liveHero: false, affordable: false, coaching: false },
};

/** Pourquoi ce mode : choix par défaut, humains vus, IA choisi (en attente de la partie, ou actif). */
export type ModeWhy = "default" | "humans" | "unverifiable" | "waiting" | "armed";

export interface ModeInput {
  /** « IA » choisi par le joueur (pour la partie en cours ou la prochaine). */
  armed: boolean;
  /** Un humain a été vu en face dans la partie en cours : Versus jusqu'à la fin de la partie. */
  humansLocked: boolean;
  /** Dernière partie connue d'AoE4World. */
  game: DetectedGame | null;
  /** Cette partie est celle qui se joue (son début colle à l'horloge lue). */
  fresh: boolean;
  /** Un profil AoE4World est réglé : sans lui, rien ne peut être vérifié. */
  profileSet: boolean;
  /** L'horloge du jeu est lue en ce moment (une partie se joue). */
  inGame: boolean;
}

/**
 * Mode de la partie ; la première règle qui s'applique gagne. VS dès qu'un humain est vu, et
 * par défaut. IA sur ton choix, dès 0:00 de la partie dont l'horloge est lue : contre l'IA, la
 * première minute compte. Si AoE4World voit ensuite une classée, une rapide ou un joueur listé en
 * face, retour en VS aussitôt, jusqu'à la fin de la partie.
 */
export function decideMode(i: ModeInput): { mode: PlayMode; why: ModeWhy } {
  if (i.humansLocked) return { mode: "versus", why: "humans" };
  if (i.game?.ongoing && opposition(i.game) === "humans") return { mode: "versus", why: "humans" };
  if (!i.armed) return { mode: "versus", why: "default" };
  if (!i.profileSet) return { mode: "versus", why: "unverifiable" };
  // Jamais dans les menus ni sur l'horloge de la partie d'avant : seulement la partie qui se joue.
  if (!i.inGame) return { mode: "versus", why: "waiting" };
  return { mode: "training", why: "armed" };
}

/** Ce que BoGo retient d'une lecture à l'autre pour décider du mode (jamais enregistré). */
export interface ModeMemory {
  /** « IA » choisi pour la partie en cours ou la prochaine. */
  armed: boolean;
  /** Le choix « IA » a vu l'horloge d'une partie : il vaut pour elle seule. */
  bound: boolean;
  armedAt: number;
  /** Dernière horloge du jeu lue (s) et quand (ms). */
  lastClock: { seconds: number; at: number } | null;
  /** Un humain vu en face dans la partie en cours. */
  humansLocked: boolean;
  /** Numéro de la partie en cours (il augmente à chaque nouvelle partie vue à l'horloge). */
  epoch: number;
}

/** Un sondage AoE4World : l'horloge et la partie (epoch) au moment où il est parti. */
export interface PollStart {
  clock: number | null;
  epoch: number;
}

export const NEW_GAME_NOTICE = "Nouvelle partie : retour en VS.";
export const HUMANS_NOTICE = "Joueur détecté en face : BoGo passe en VS jusqu'à la fin de la partie.";
/** Choix « IA » oublié dans les menus : il tombe après 15 min sans partie. */
const FORGOTTEN_MS = 15 * 60_000;
/** Plus d'horloge depuis une minute : la partie est finie, le verrou « humains » tombe. */
const GAME_OVER_MS = 60_000;
/** Plus d'horloge depuis deux minutes : le choix « IA » qui a servi à cette partie tombe. */
const ARM_OVER_MS = 120_000;

export function freshMemory(): ModeMemory {
  return { armed: false, bound: false, armedAt: 0, lastClock: null, humansLocked: false, epoch: 0 };
}

/** « IA » choisi ou retiré : il vaudra pour la partie dont BoGo lira l'horloge ensuite. */
export function arm(m: ModeMemory, on: boolean, now: number): ModeMemory {
  return { ...m, armed: on, bound: false, armedAt: now };
}

/**
 * Horloge lue. Si elle repart de loin en arrière, une nouvelle partie commence : le verrou
 * « humains » et la vérification repartent de zéro, et le choix « IA » de la partie d'avant tombe.
 */
export function clockRead(m: ModeMemory, seconds: number, now: number): { memory: ModeMemory; notice: string | null } {
  let next = { ...m };
  let notice: string | null = null;
  if (m.lastClock && seconds < m.lastClock.seconds - 10) {
    next = { ...next, humansLocked: false, epoch: m.epoch + 1 };
    if (m.armed && m.bound) {
      next = { ...next, armed: false };
      notice = NEW_GAME_NOTICE;
    }
  }
  return { memory: { ...next, bound: next.armed, lastClock: { seconds, at: now } }, notice };
}

/**
 * Réponse d'AoE4World. Une partie contre des humains qui est bien celle en cours verrouille VS
 * jusqu'à sa fin et fait tomber le choix « IA ». Un choix oublié, ou qui a servi à une partie
 * finie, tombe aussi. `wasTraining` : le mode juste avant cette réponse (pour prévenir).
 */
export function aoe4worldSeen(
  m: ModeMemory,
  game: DetectedGame | null,
  clockNow: number | null,
  now: number,
  wasTraining: boolean,
): { memory: ModeMemory; notice: string | null } {
  let next = { ...m };
  let notice: string | null = null;
  if (game?.ongoing && opposition(game) === "humans") {
    if (freshGame(game, clockNow, now)) {
      if (wasTraining) notice = HUMANS_NOTICE;
      next = { ...next, humansLocked: true, armed: false };
    }
  }
  if (next.armed && now - Math.max(next.armedAt, next.lastClock?.at ?? 0) > FORGOTTEN_MS) next = { ...next, armed: false };
  // Partie finie (plus d'horloge) : le choix « IA » qui lui a servi tombe.
  if (next.bound && next.lastClock && now - next.lastClock.at > ARM_OVER_MS) {
    next = { ...next, armed: false, bound: false };
  }
  return { memory: next, notice };
}

/** Mode de la partie en cours, d'après ce que BoGo retient (voir decideMode). */
export function currentMode(
  m: ModeMemory,
  game: DetectedGame | null,
  clockNow: number | null,
  profileSet: boolean,
  now: number,
): { mode: PlayMode; why: ModeWhy } {
  return decideMode(inputs(m, game, clockNow, profileSet, now));
}

function inputs(m: ModeMemory, game: DetectedGame | null, clockNow: number | null, profileSet: boolean, now: number): ModeInput {
  return {
    armed: m.armed,
    humansLocked: m.humansLocked && m.lastClock !== null && now - m.lastClock.at < GAME_OVER_MS,
    game,
    fresh: freshGame(game, clockNow, now),
    profileSet,
    // Horloge lue il y a moins de 5 s (ClockTracker) : jamais la partie d'avant, jamais les menus.
    inGame: clockNow !== null,
  };
}

/**
 * La partie AoE4World est-elle celle qui se joue ? Son début doit coller à l'horloge lue :
 * entre 30 s avant et 150 s après (chargement). Sans horloge, on ne peut pas le dire.
 */
export function freshGame(game: DetectedGame | null, clockSeconds: number | null, now: number): boolean {
  const started = Date.parse(game?.startedAt ?? "");
  if (!game?.ongoing || clockSeconds === null || !Number.isFinite(started)) return false;
  const gap = (now - clockSeconds * 1000 - started) / 1000;
  return gap >= -30 && gap <= 150;
}

/**
 * Ce que la vue a le droit de lire de la partie en cours : les comptes si le mode les montre,
 * et un état du moteur sans les conseils que le mode ne montre pas (répartition, dérive,
 * « payable »).
 */
export function projectLive(
  features: Readonly<ModeFeatures>,
  hud: HudReading | null,
  engine: EngineState | null,
): { hud: HudReading | null; engine: EngineState | null } {
  return {
    hud: features.liveCounts ? hud : null,
    engine: engine && {
      ...engine,
      misplacement: features.alerts ? engine.misplacement : null,
      drift: features.drift ? engine.drift : 0,
      affordable: features.affordable ? engine.affordable : false,
      villagers: features.liveCounts ? engine.villagers : null,
    },
  };
}

export const MODE_LABELS: Record<PlayMode | "waiting", { badge: string; title: string }> = {
  versus: { badge: "VS", title: "Versus : ton BO et tes comptes en direct, sans consigne qui décide à ta place" },
  waiting: {
    badge: "IA…",
    title: "Entraînement choisi : le coaching démarre dès que BoGo lit l'horloge de la partie",
  },
  training: { badge: "IA", title: "Entraînement contre l'IA : BoGo te coache (alertes, comptes en direct)" },
};
