// « Mes matchups », réglé avant la partie : un BO de base par civ, puis des règles précises
// « je joue X, contre Y, sur la carte Z → ce BO ». Il présélectionne le BO sur l'écran de choix.
// Seules clés : ta civ, la civ adverse (1v1 classé ou rapide) et la carte, toutes publiques à
// l'écran de chargement. Jamais l'identité ni l'historique d'un adversaire.

export interface MatchupRule {
  id: string;
  civ: string;
  /** Civ adverse, ou null : toutes. Ne joue qu'en 1v1 classé ou rapide (civ adverse connue). */
  opponent: string | null;
  /** Carte, ou null : toutes. */
  map: string | null;
  buildId: string;
}

export interface Matchups {
  /** BO de base de chaque civ : sans règle plus précise, c'est lui. */
  base: Record<string, string>;
  rules: MatchupRule[];
}

export interface MatchupGame {
  kind: string;
  /** Plusieurs joueurs listés par équipe (personnalisée à plusieurs) : comme une partie en équipe. */
  team?: boolean;
  civ: string;
  /** Civ adverse, en 1v1 classé ou rapide seulement. */
  opponentCiv: string | null;
  map: string;
}

/** Ce qui a choisi le BO : la règle complète, une règle partielle, ou le BO de base. */
export type MatchupMatch = "exact" | "map" | "opponent" | "base";

export interface MatchupPick {
  buildId: string;
  match: MatchupMatch;
  rule: MatchupRule | null;
  /** Une règle « contre » qui va aussi avec la partie mais dit un autre BO (la carte l'emporte). */
  conflict: MatchupRule | null;
}

/**
 * De la règle la plus précise à la plus générale. La carte passe avant la civ adverse : une
 * carte d'eau ou hybride rend un BO terrestre injouable, alors qu'on s'adapte à l'adversaire
 * après l'éclaireur. Une règle complète (adversaire et carte) tranche les cas particuliers.
 */
export const PRECEDENCE: MatchupMatch[] = ["exact", "map", "opponent", "base"];

const KEY = "bogo.matchups.v1";
type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export function emptyMatchups(): Matchups {
  return { base: {}, rules: [] };
}

export function loadMatchups(store: KeyValueStore): Matchups {
  try {
    const data = JSON.parse(store.getItem(KEY) ?? "{}");
    // Chaque champ est lu à part : un champ abîmé ne fait jamais perdre le reste.
    const base: Record<string, string> = {};
    if (data && typeof data.base === "object" && data.base !== null && !Array.isArray(data.base)) {
      for (const [civ, id] of Object.entries(data.base)) if (typeof id === "string") base[civ] = id;
    }
    const rules: MatchupRule[] = Array.isArray(data?.rules)
      ? data.rules
          .filter((r: Partial<MatchupRule>) => typeof r?.civ === "string" && typeof r.buildId === "string")
          .map((r: MatchupRule) => ({
            id: typeof r.id === "string" ? r.id : newRuleId(),
            civ: r.civ,
            opponent: typeof r.opponent === "string" && r.opponent ? r.opponent : null,
            map: typeof r.map === "string" && r.map.trim() ? r.map.trim() : null,
            buildId: r.buildId,
          }))
          // Sans civ adverse ni carte, ce n'est pas une règle (c'est le rôle du BO de base).
          .filter((r: MatchupRule) => r.opponent !== null || r.map !== null)
      : [];
    return { base, rules: dedupeRules(rules) };
  } catch {
    return emptyMatchups();
  }
}

export function saveMatchups(store: KeyValueStore, matchups: Matchups): void {
  try {
    store.setItem(KEY, JSON.stringify(matchups));
  } catch {
    // Quota atteint ou stockage indisponible : les matchups restent en mémoire.
  }
}

/**
 * Cartes proposées dans l'éditeur : les pools 1v1 classés d'avril 2025 à juin 2026, aux noms
 * exacts d'AoE4World (le pool tourne chaque mois depuis juillet 2026 : les cartes vues dans
 * ton journal s'y ajoutent, et tu peux en taper une autre).
 */
export const MAP_SUGGESTIONS = [
  "Altai", "Ancient Spires", "Archipelago", "Boulder Bay", "Canal", "Carmel", "Cliffside", "Confluence",
  "Craters", "Danube River", "Dry Arabia", "Enlightened Horizon", "Flankwoods", "Four Lakes", "Golden Heights",
  "High View", "Highwoods", "Hill and Dale", "Himeyama", "King of the Hill", "Lakeside", "Lipany", "Migration",
  "Ocean Gateway", "Prairie", "Relic River", "Rocky River", "Socotra", "Sunkenlands", "Wasteland", "Waterholes",
  "West Lake",
];

/** Anciens noms de carte d'AoE4World ramenés aux noms actuels (clés de mapKey). */
const MAP_ALIASES: Record<string, string> = { wateringholes: "waterholes", mediterranean: "baltic" };

/**
 * Clé de comparaison d'une carte : sans casse, accents, espaces ni tirets ; « & » vaut « and ».
 * « High View », « Highview » et « high-view » sont la même carte.
 */
export function mapKey(name: string): string {
  const key = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
  return MAP_ALIASES[key] ?? key;
}

/** Même civ, même civ adverse, même carte : seule la règle la plus récente (la dernière) reste. */
export function dedupeRules(rules: MatchupRule[]): MatchupRule[] {
  const key = (r: MatchupRule) => `${r.civ.toLowerCase()}|${r.opponent?.toLowerCase() ?? ""}|${mapKey(r.map ?? "")}`;
  const last = new Map(rules.map((r) => [key(r), r.id]));
  return rules.filter((r) => last.get(key(r)) === r.id);
}

/** Partie à plusieurs (équipe, chacun pour soi) : les règles du 1v1 ne s'y appliquent pas. */
function teamGame(game: MatchupGame): boolean {
  return !!game.team || /_[2-4]v[2-4](_|$)/.test(game.kind) || /_ffa(_|$)/.test(game.kind);
}

/** Genre d'une règle : complète (adversaire + carte), adversaire seul, carte seule. */
export function ruleMatch(rule: MatchupRule): MatchupMatch {
  return rule.opponent && rule.map ? "exact" : rule.opponent ? "opponent" : rule.map ? "map" : "base";
}

/**
 * BO du profil pour cette partie : la règle la plus précise gagne (voir PRECEDENCE), puis le
 * BO de base de la civ. Une règle dont le BO n'est plus jouable (supprimé, autre civ) est
 * ignorée. En équipe, seul le BO de base compte : les règles sont celles du 1v1.
 */
export function matchupPick(matchups: Matchups, game: MatchupGame, playable: (buildId: string) => boolean): MatchupPick | null {
  const civ = game.civ.toLowerCase();
  if (!teamGame(game)) {
    const map = game.map ? mapKey(game.map) : null;
    const opponent = game.opponentCiv?.toLowerCase() ?? null;
    const fits = (r: MatchupRule) =>
      r.civ.toLowerCase() === civ &&
      (r.opponent === null || r.opponent.toLowerCase() === opponent) &&
      (r.map === null || (map !== null && mapKey(r.map) === map)) &&
      playable(r.buildId);
    // La plus récente d'abord, si deux règles disent la même situation.
    const matching = matchups.rules.filter(fits).reverse();
    for (const match of PRECEDENCE) {
      const rule = matching.find((r) => ruleMatch(r) === match);
      if (!rule) continue;
      const other = match === "map" ? matching.find((r) => ruleMatch(r) === "opponent" && r.buildId !== rule.buildId) : undefined;
      return { buildId: rule.buildId, match, rule, conflict: other ?? null };
    }
  }
  const base = Object.entries(matchups.base).find(([c]) => c.toLowerCase() === civ)?.[1];
  return base && playable(base) ? { buildId: base, match: "base", rule: null, conflict: null } : null;
}

/** « Tes matchups : contre French sur Dry Arabia », « 📌 Ton BO de base avec English ». */
export function matchupReason(pick: MatchupPick, game: MatchupGame): string {
  const rule = pick.rule;
  if (!rule) return `📌 Ton BO de base avec ${game.civ}`;
  const parts = [rule.opponent ? `contre ${rule.opponent}` : "", rule.map ? `sur ${rule.map}` : ""].filter(Boolean);
  return `Tes matchups : ${parts.join(" ")}`;
}

/** Règles et BO de base qui citent un BO supprimé de la bibliothèque : retirés. */
export function forgetBuild(matchups: Matchups, buildId: string): Matchups {
  const base = Object.fromEntries(Object.entries(matchups.base).filter(([, id]) => id !== buildId));
  return { base, rules: matchups.rules.filter((r) => r.buildId !== buildId) };
}

export function newRuleId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
