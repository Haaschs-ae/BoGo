import { civilizationsOf, type BuildOrder } from "./buildOrder";

export const STYLES = {
  boom: "Boom",
  agressif: "Agressif",
  "fast-castle": "Fast Castle",
  autre: "Autre",
} as const;

export type Style = keyof typeof STYLES;

export interface SavedBuild {
  id: string;
  style: Style;
  build: BuildOrder;
  sourceUrl?: string;
  addedAt: number;
}

/** Les BO RTS_Overlay valables pour toutes les civs utilisent "any". */
export const ANY_CIV = "any";

const KEY = "bogo.library.v1";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

export function loadLibrary(store: KeyValueStore): SavedBuild[] {
  try {
    const raw = store.getItem(KEY);
    const data: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? (data as SavedBuild[]) : [];
  } catch {
    return [];
  }
}

export function saveLibrary(store: KeyValueStore, library: SavedBuild[]): void {
  store.setItem(KEY, JSON.stringify(library));
}

export function addBuild(
  library: SavedBuild[],
  build: BuildOrder,
  style: Style,
  sourceUrl?: string,
): SavedBuild[] {
  const saved: SavedBuild = { id: newId(), style, build, sourceUrl, addedAt: Date.now() };
  // Réimporter le même lien remplace l'ancienne version.
  const rest = sourceUrl ? library.filter((b) => b.sourceUrl !== sourceUrl) : library;
  return [...rest, saved];
}

export function removeBuild(library: SavedBuild[], id: string): SavedBuild[] {
  return library.filter((b) => b.id !== id);
}

/** BO jouables avec cette civ (ou toutes les civs si `civ` est vide), triés par nom. */
export function filterBuilds(library: SavedBuild[], civ: string, style: Style | ""): SavedBuild[] {
  return library
    .filter((b) => !style || b.style === style)
    .filter((b) => {
      if (!civ) return true;
      const civs = civilizationsOf(b.build).map((c) => c.toLowerCase());
      return civs.includes(civ.toLowerCase()) || civs.includes(ANY_CIV);
    })
    .sort((a, b) => a.build.name.localeCompare(b.build.name));
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
