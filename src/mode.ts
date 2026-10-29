// Deux modes de jeu. Entraînement (contre l'IA) : BoGo te coache. Versus (contre des joueurs,
// en classé, en rapide ou en personnalisée) : BoGo n'est qu'un BO papier qui tourne ses pages
// tout seul. Test : une feuille de BO imprimée pourrait-elle le dire ? Sinon, c'est pour
// l'entraînement. AoE4World prouve la présence d'humains, jamais celle de l'IA : quand BoGo ne
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
  versus: { liveCounts: false, alerts: false, drift: false, liveHero: false, affordable: false, coaching: false },
};

/** Pourquoi ce mode : choix par défaut, humains vus, vérification en cours ou faite. */
export type ModeWhy = "default" | "humans" | "unverifiable" | "checking" | "confirmed" | "checked";

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
  /** Horloge du jeu au départ du dernier sondage AoE4World sans aucune partie contre des humains. */
  checkedAtClock: number | null;
  /** L'horloge du jeu est lue en ce moment (une partie se joue). */
  inGame: boolean;
}

/** Le temps qu'AoE4World voie une partie classée ou rapide (à mesurer, voir le journal). */
export const GRACE_SECONDS = 60;

/**
 * Mode de la partie ; la première règle qui s'applique gagne. Versus dès qu'un humain est vu,
 * par défaut, et tant que la vérification n'est pas faite. Entraînement seulement sur ton choix,
 * et quand AoE4World confirme une personnalisée sans adversaire listé, ou ne voit aucune partie
 * contre des joueurs après une minute de jeu.
 */
export function decideMode(i: ModeInput): { mode: PlayMode; why: ModeWhy } {
  if (i.humansLocked) return { mode: "versus", why: "humans" };
  if (i.game?.ongoing && opposition(i.game) === "humans") return { mode: "versus", why: "humans" };
  if (!i.armed) return { mode: "versus", why: "default" };
  if (!i.profileSet) return { mode: "versus", why: "unverifiable" };
  // Une vérification ne vaut que pendant la partie dont l'horloge est lue : jamais dans les menus.
  if (!i.inGame) return { mode: "versus", why: "checking" };
  if (i.game?.ongoing && i.fresh) return { mode: "training", why: "confirmed" };
  if (i.checkedAtClock !== null && i.checkedAtClock >= GRACE_SECONDS) return { mode: "training", why: "checked" };
  return { mode: "versus", why: "checking" };
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
  /** Horloge au départ du dernier sondage AoE4World sans partie contre des humains. */
  checkedAtClock: number | null;
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
  return { armed: false, bound: false, armedAt: 0, lastClock: null, humansLocked: false, checkedAtClock: null, epoch: 0 };
}

/** « IA » choisi ou retiré : il vaudra pour la partie dont BoGo lira l'horloge ensuite. */
export function arm(m: ModeMemory, on: boolean, now: number): ModeMemory {
  // Choisi hors partie : rien de vérifié ne passe d'une partie finie à la suivante.
  const playing = m.lastClock !== null && now - m.lastClock.at < GAME_OVER_MS;
  return { ...m, armed: on, bound: false, armedAt: now, checkedAtClock: playing ? m.checkedAtClock : null };
}

/**
 * Horloge lue. Si elle repart de loin en arrière, une nouvelle partie commence : le verrou
 * « humains » et la vérification repartent de zéro, et le choix « IA » de la partie d'avant tombe.
 */
export function clockRead(m: ModeMemory, seconds: number, now: number): { memory: ModeMemory; notice: string | null } {
  let next = { ...m };
  let notice: string | null = null;
  if (m.lastClock && seconds < m.lastClock.seconds - 10) {
    next = { ...next, humansLocked: false, checkedAtClock: null, epoch: m.epoch + 1 };
    if (m.armed && m.bound) {
      next = { ...next, armed: false };
      notice = NEW_GAME_NOTICE;
    }
  }
  return { memory: { ...next, bound: next.armed, lastClock: { seconds, at: now } }, notice };
}

/**
 * Réponse d'AoE4World à un sondage parti à `poll` (horloge et partie de ce moment-là). Une partie contre des humains qui est
 * bien celle en cours verrouille VS et fait tomber le choix « IA » ; une réponse sans partie
 * contre des humains vérifie le choix « IA » à ce moment de la partie, seulement si le sondage
 * est parti pendant cette partie-ci (sinon il parlerait de la précédente). Un choix oublié tombe.
 * `wasTraining` : le mode juste avant cette réponse (pour prévenir du passage forcé en VS).
 */
export function aoe4worldSeen(
  m: ModeMemory,
  game: DetectedGame | null,
  poll: PollStart,
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
  } else if (game && poll.clock !== null && poll.epoch === m.epoch) {
    next = { ...next, checkedAtClock: Math.max(m.checkedAtClock ?? 0, poll.clock) };
  }
  if (next.armed && now - Math.max(next.armedAt, next.lastClock?.at ?? 0) > FORGOTTEN_MS) next = { ...next, armed: false };
  // Partie finie (plus d'horloge) : le choix « IA » qui lui a servi tombe, la vérification aussi.
  if (next.bound && next.lastClock && now - next.lastClock.at > ARM_OVER_MS) {
    next = { ...next, armed: false, bound: false, checkedAtClock: null };
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
    checkedAtClock: m.checkedAtClock,
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
 * Ce que la vue a le droit de lire de la partie en cours. En Versus : aucune lecture du
 * panneau, et un état du moteur sans conseil (répartition, dérive, « payable », villageois).
 */
export function projectLive(
  features: Readonly<ModeFeatures>,
  hud: HudReading | null,
  engine: EngineState | null,
): { hud: HudReading | null; engine: EngineState | null } {
  if (features.liveCounts) return { hud, engine };
  return {
    hud: null,
    engine: engine && { ...engine, misplacement: null, drift: 0, affordable: false, villagers: null },
  };
}

export const MODE_LABELS: Record<PlayMode | "checking", { badge: string; title: string }> = {
  versus: { badge: "VS", title: "Versus : ton BO seulement, sans conseil calculé en direct" },
  checking: {
    badge: "IA…",
    title: "Entraînement choisi : BoGo vérifie sur AoE4World que ce n'est ni une classée ni une partie rapide (VS jusque-là)",
  },
  training: { badge: "IA", title: "Entraînement contre l'IA : BoGo te coache (alertes, comptes en direct)" },
};
