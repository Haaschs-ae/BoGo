import { invoke } from "@tauri-apps/api/core";
import { civilizationName } from "./civs";

export interface DetectedGame {
  id: number;
  ongoing: boolean;
  /** Type de partie : rm_1v1, qm_2v2, custom… */
  kind: string;
  map: string;
  startedAt: string;
  myCivilization: string;
  /** Civ tirée au sort (AoE4World la donne quand même). */
  randomCiv: boolean;
  opponentCivilizations: string[];
  /** Deux équipes d'un joueur chacune. */
  oneVsOne: boolean;
}

/** Accepte un lien aoe4world.com/players/5612909-Nom ou l'identifiant seul. */
export function extractProfileId(input: string): string | null {
  const text = input.trim();
  const fromUrl = /aoe4world\.com\/players\/(\d+)/.exec(text);
  if (fromUrl) return fromUrl[1];
  return /^\d+$/.test(text) ? text : null;
}

/**
 * Lit la réponse de /players/{id}/games/last. Renvoie null si le joueur n'y figure pas.
 * Les joueurs sont soit directement dans `teams`, soit sous une clé `player`.
 */
export function parseLastGame(data: unknown, profileId: string): DetectedGame | null {
  if (!isObject(data) || !Array.isArray(data.teams)) return null;
  const myIds = new Set([Number(profileId)]);
  if (isObject(data.filters) && Array.isArray(data.filters.profile_ids)) {
    for (const id of data.filters.profile_ids) myIds.add(Number(id));
  }

  const teams = data.teams.map((team) =>
    (Array.isArray(team) ? team : []).map((p) => (isObject(p) && isObject(p.player) ? p.player : p)).filter(isObject),
  );
  const myTeam = teams.find((team) => team.some((p) => myIds.has(Number(p.profile_id))));
  const me = myTeam?.find((p) => myIds.has(Number(p.profile_id)));
  if (!myTeam || !me || typeof me.civilization !== "string") return null;

  return {
    id: Number(data.game_id),
    ongoing: data.ongoing === true,
    kind: typeof data.kind === "string" ? data.kind : "",
    map: typeof data.map === "string" ? data.map : "",
    startedAt: typeof data.started_at === "string" ? data.started_at : "",
    myCivilization: civilizationName(me.civilization),
    randomCiv: me.civilization_randomized === true,
    opponentCivilizations: teams
      .filter((t) => t !== myTeam)
      .flat()
      .map((p) => (typeof p.civilization === "string" ? civilizationName(p.civilization) : "?")),
    oneVsOne: teams.length === 2 && teams.every((team) => team.length === 1),
  };
}

/**
 * Civ de l'adversaire, seulement en 1v1. À plusieurs, trop de cas possibles pour en tirer un
 * BO : BoGo n'affiche pas les adversaires et ne s'en sert pas pour conseiller.
 */
export function soloOpponent(game: DetectedGame): string | null {
  return game.oneVsOne ? (game.opponentCivilizations[0] ?? null) : null;
}

export async function fetchLastGame(profileId: string, apiKey: string): Promise<DetectedGame | null> {
  const data = await invoke<unknown>("fetch_last_game", { profileId, apiKey: apiKey || null });
  return parseLastGame(data, profileId);
}

/** Libellé lisible du type de partie : "rm_1v1" → "Classée 1v1". */
export function kindLabel(kind: string): string {
  const [prefix, mode] = kind.split("_");
  const names: Record<string, string> = { rm: "Classée", qm: "Partie rapide", custom: "Personnalisée" };
  return [names[prefix] ?? prefix, mode].filter(Boolean).join(" ");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
