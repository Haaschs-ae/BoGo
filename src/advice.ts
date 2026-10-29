// Conseil de BO au début de la partie (écran de choix). Dans l'ordre : tes matchups (réglés
// avant la partie : règle la plus précise, puis le BO de base de la civ), ta mémoire contre la
// civ adverse (1v1), ton habitude avec la civ, ta bibliothèque. Ce que tu as réglé passe avant
// ce que BoGo déduit. Le BO choisi avant la partie passe avant tout (main.ts).
// Voir docs/conseil-bo.md et docs/profil-et-modes.md.

import type { BuildOrder } from "./buildOrder";
import { distributionGap, plannedBuilders } from "./distribution";
import type { HudReading } from "./hud";
import { habitLaunch, keptLaunch, launchWeight, type GameEntry } from "./journal";
import { filterBuilds, STYLES, type SavedBuild, type Style } from "./library";
import { matchupPick, matchupReason, type Matchups } from "./matchups";

export interface AdviceGame {
  kind: string;
  civ: string;
  randomCiv: boolean;
  /** Civ adverse, en 1v1 classé ou rapide seulement. */
  opponentCiv: string | null;
  map: string;
  /** Plusieurs joueurs listés en face ou à côté (personnalisée à plusieurs). */
  team?: boolean;
}

export interface Advice {
  build: SavedBuild;
  rule: "matchups" | "memory" | "habit" | "library";
  /** « Choisi car » : un fait vérifiable, pas un classement. */
  reason: string;
  /** Pourquoi il ne sera pas lancé tout seul, ou null (lancé après le compte à rebours). */
  autoOff: string | null;
  /** Tes matchups se contredisent : l'autre BO et la règle qui le dit (« contre French »). */
  also?: { build: SavedBuild; rule: string };
}

export const COUNTDOWN_SECONDS = 8;
/** Mémoire contre une civ : 90 jours. */
const MEMORY_MS = 90 * 86_400_000;
/** Habitude : parmi les 5 dernières parties avec la civ. */
const HABIT_GAMES = 5;
/** Écart toléré entre la répartition à l'écran et le BO pour le lancer tout seul. */
const AUTO_GAP = 3;

/** Empire Wars et Nomade : départ différent, aucun conseil. */
export function noAdvice(kind: string): boolean {
  return /_(ew|nomad)(_|$)/.test(kind);
}

const isCustom = (kind: string) => kind.startsWith("custom");

/** BO assez complet pour être conseillé : 5 étapes, villageois ou répartition sur la moitié au moins. */
export function usableBuild(build: BuildOrder): boolean {
  const steps = build.build_order;
  const filled = steps.filter((s) => s.villager_count > 0 || Object.values(s.resources).some((n) => n > 0));
  return steps.length >= 5 && filled.length * 2 >= steps.length;
}

function candidates(library: SavedBuild[], civ: string): SavedBuild[] {
  return filterBuilds(library, civ, "").filter((b) => usableBuild(b.build));
}

/** Parties avec la civ, les plus récentes d'abord ; une personnalisée ne compte pas pour le classé. */
function history(journal: GameEntry[], game: AdviceGame): GameEntry[] {
  return journal
    .filter((e) => e.civ === game.civ && (isCustom(game.kind) || !isCustom(e.kind)))
    .sort((a, b) => b.at - a.at);
}

/** BO gardé dans cette partie, s'il compte (choix actif, ou lancement automatique suivi). */
function counted(entry: GameEntry): string | null {
  const kept = keptLaunch(entry);
  return kept && launchWeight(entry, kept) > 0 ? kept.buildId : null;
}

/** Le plus gardé avec la civ, puis le plus récemment lancé (ou ajouté). */
function best(builds: SavedBuild[], entries: GameEntry[]): SavedBuild | null {
  const kept = (b: SavedBuild) => entries.filter((e) => counted(e) === b.id).length;
  const used = (b: SavedBuild) => entries.find((e) => e.launches.some((l) => l.buildId === b.id))?.at ?? b.addedAt;
  return [...builds].sort((a, b) => kept(b) - kept(a) || used(b) - used(a))[0] ?? null;
}

/** Meilleur BO de chaque catégorie de la bibliothèque, pour les raccourcis 1 à 4. */
export function categoryPicks(library: SavedBuild[], journal: GameEntry[], game: AdviceGame): Record<Style, SavedBuild | null> {
  const builds = candidates(library, game.civ);
  const entries = history(journal, game);
  const picks = {} as Record<Style, SavedBuild | null>;
  for (const style of Object.keys(STYLES) as Style[]) picks[style] = best(builds.filter((b) => b.style === style), entries);
  return picks;
}

/** Habitude : un BO gardé à 2 parties au moins, dont un choix actif, parmi les 5 dernières. */
function habit(entries: GameEntry[], builds: SavedBuild[]) {
  const recent = entries.filter((e) => keptLaunch(e)).slice(0, HABIT_GAMES);
  const tally = new Map<string, { kept: number; active: number }>();
  for (const e of recent) {
    const launch = habitLaunch(e)!;
    if (launchWeight(e, launch) === 0) continue;
    const t = tally.get(launch.buildId) ?? { kept: 0, active: 0 };
    t.kept += 1;
    if (launch.how !== "auto") t.active += 1;
    tally.set(launch.buildId, t);
  }
  // Map garde l'ordre d'insertion : à égalité, le plus récent l'emporte.
  let found: { build: SavedBuild; kept: number } | null = null;
  for (const [id, t] of tally) {
    const build = builds.find((b) => b.id === id);
    if (build && t.kept >= 2 && t.active >= 1 && t.kept > (found?.kept ?? 0)) found = { build, kept: t.kept };
  }
  return found && { ...found, games: recent.length };
}

/** Mémoire (1v1) : le BO gardé la dernière fois contre cette civ, il y a moins de 90 jours. */
function memory(entries: GameEntry[], game: AdviceGame, builds: SavedBuild[], now: number): SavedBuild | null {
  if (!game.opponentCiv) return null;
  const last = entries.find((e) => e.opponentCiv === game.opponentCiv && now - e.at <= MEMORY_MS && counted(e));
  return builds.find((b) => last && b.id === counted(last)) ?? null;
}

/** BO conseillé pour cette partie, ou null (aucun BO utilisable, Empire Wars, Nomade). */
export function adviseBuild(
  library: SavedBuild[],
  journal: GameEntry[],
  game: AdviceGame,
  now: number,
  matchups: Matchups = { base: {}, rules: [] },
): Advice | null {
  if (noAdvice(game.kind) || !game.civ) return null;
  // Tes matchups : un choix explicite, jouable avec la civ même s'il est court ou peu rempli.
  const playable = filterBuilds(library, game.civ, "");
  const pick = matchupPick(matchups, game, (id) => playable.some((b) => b.id === id));
  if (pick) {
    const build = playable.find((b) => b.id === pick.buildId)!;
    const reason = (game.randomCiv ? "Civ aléatoire · " : "") + matchupReason(pick, game);
    const other = pick.conflict && playable.find((b) => b.id === pick.conflict!.buildId);
    // Deux règles se contredisent (carte et civ adverse) : la carte l'emporte, sans lancement auto.
    if (other && pick.conflict) {
      return { build, rule: "matchups", reason, autoOff: "2 règles de tes matchups s'appliquent", also: { build: other, rule: `contre ${pick.conflict.opponent}` } };
    }
    return { build, rule: "matchups", reason, autoOff: autoLaunchBlocker(build, journal, game, true) };
  }
  const builds = candidates(library, game.civ);
  if (builds.length === 0) return null;
  const entries = history(journal, game);
  const usual = habit(entries, builds);
  const met = memory(entries, game, builds, now);
  let advice: Pick<Advice, "build" | "rule" | "reason">;
  if (met && met.id !== usual?.build.id) {
    advice = { build: met, rule: "memory", reason: `Gardé la dernière fois contre ${game.opponentCiv}` };
  } else if (usual) {
    advice = { build: usual.build, rule: "habit", reason: `Gardé à ${usual.kept} de tes ${usual.games} dernières parties avec ${game.civ}` };
  } else {
    const build = best(builds, entries)!;
    const kept = entries.filter((e) => counted(e) === build.id).length;
    const reason = kept
      ? `Ton BO le plus gardé avec ${game.civ} (${kept} partie${kept > 1 ? "s" : ""})`
      : builds.length > 1
        ? `Le plus récent de ta bibliothèque pour ${game.civ}`
        : `Le seul de ta bibliothèque pour ${game.civ}`;
    advice = { build, rule: "library", reason };
  }
  const reason = (game.randomCiv ? "Civ aléatoire · " : "") + advice.reason;
  return { ...advice, reason, autoOff: autoLaunchBlocker(advice.build, journal, game) };
}

/**
 * Garde-fous du lancement automatique connus dès la détection. Ceux du moment (horloge,
 * BoGo masqué ou réduit, répartition à l'écran) sont vérifiés par l'interface. Un BO de tes
 * matchups (`chosen`) est ton choix : il peut partir tout seul même s'il n'a jamais été joué.
 */
export function autoLaunchBlocker(build: SavedBuild, journal: GameEntry[], game: AdviceGame, chosen = false): string | null {
  if (isCustom(game.kind)) return "partie personnalisée";
  if (game.kind !== "rm_1v1" && game.kind !== "qm_1v1") return /_[2-4]v[2-4]/.test(game.kind) ? "partie en équipe" : "pas un 1v1 classé ou rapide";
  if (!chosen && !journal.some((e) => counted(e) === build.id)) return "BO jamais joué";
  const lastTwo = history(journal, game).slice(0, 2);
  if (lastTwo.length === 2 && lastTwo.every((e) => e.refused)) return "annulé les 2 dernières fois";
  return null;
}

/** La répartition à l'écran s'écarte du BO de plus de 3 villageois : le lancer tout seul serait faux. */
export function distributionMismatch(build: BuildOrder, reading: HudReading): boolean {
  const steps = build.build_order;
  const step = [...steps].reverse().find((s) => s.villager_count > 0 && s.villager_count <= reading.villagers) ?? steps[0];
  return !!step && distributionGap(step.resources, reading.gatherers) > AUTO_GAP + plannedBuilders(step.resources);
}
