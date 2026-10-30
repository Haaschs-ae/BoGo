// Mise à jour de BoGo par lui-même : la nouvelle version est cherchée sur les versions publiées
// du dépôt GitHub (latest.json), vérifiée avec la clé publique de tauri.conf.json, installée
// en un clic, puis BoGo se relance. Jamais pendant une partie.

/** Une recherche au lancement, puis toutes les 6 heures si BoGo reste ouvert. */
export const UPDATE_EVERY_MS = 6 * 60 * 60 * 1000;
/** Laisse BoGo démarrer (et voir s'il y a une partie en cours) avant la première recherche. */
export const FIRST_CHECK_DELAY_MS = 20 * 1000;

export type UpdateStatus = "available" | "downloading" | "ready" | "error";

export interface UpdateState {
  version: string;
  notes: string;
  status: UpdateStatus;
  /** Part téléchargée, de 0 à 1, ou null si la taille n'est pas connue. */
  progress: number | null;
  error: string | null;
}

/** Faut-il chercher une mise à jour maintenant ? Pas en partie, ni plus d'une fois par période. */
export function updateDue(lastCheckAt: number | null, now: number, playing: boolean): boolean {
  if (playing) return false;
  return lastCheckAt === null || now - lastCheckAt >= UPDATE_EVERY_MS;
}

/** Notes de version gardées courtes pour la bannière : premières lignes utiles, sans Markdown. */
export function shortNotes(body: string | undefined, maxLines = 4): string {
  return (body ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(#+|[-*•]|\d+\.)\s*/, "").replace(/\*\*|__|`/g, "").trim())
    .filter((line) => line && !/^https?:\/\//.test(line) && !/^🤖|Generated with/i.test(line))
    .slice(0, maxLines)
    .join("\n");
}
