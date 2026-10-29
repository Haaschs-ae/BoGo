// Traductions faites par la traduction intégrée de macOS (bogo-translate), gardées sur la
// machine : un texte anglais de consigne → son français. Faites une fois, hors partie ; en
// partie, BoGo ne fait que les relire. Sans elles, le dictionnaire de translate.ts prend le relais.

import { tokenizeNote, type BuildOrder } from "./buildOrder";

const KEY = "bogo.translations.v1";
type KeyValueStore = Pick<Storage, "getItem" | "setItem">;
export type TranslationCache = Record<string, string>;

export function loadTranslations(store: KeyValueStore): TranslationCache {
  try {
    const data = JSON.parse(store.getItem(KEY) ?? "{}");
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function saveTranslations(store: KeyValueStore, cache: TranslationCache): void {
  try {
    store.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Quota atteint : les traductions restent en mémoire pour cette session.
  }
}

/** Clé d'un morceau de texte : sans espaces autour, flèches normalisées. */
export function textKey(text: string): string {
  return text.replace(/->/g, "→").trim();
}

/** Morceaux de texte (entre les icônes) d'un BO qui n'ont pas encore de traduction. */
export function missingTexts(build: BuildOrder, cache: TranslationCache): string[] {
  const texts = new Set<string>();
  for (const step of build.build_order) {
    for (const note of step.notes) {
      for (const part of tokenizeNote(note)) {
        if (part.kind !== "text") continue;
        const key = textKey(part.text);
        if (/\p{L}/u.test(key) && cache[key] === undefined) texts.add(key);
      }
    }
  }
  return [...texts];
}

/**
 * Les morceaux d'une consigne, traduits par macOS s'ils le sont tous (espaces d'origine gardés
 * autour), sinon null : la consigne passe alors au dictionnaire, d'un seul tenant.
 */
export function cachedLine(texts: string[], cache: TranslationCache): string[] | null {
  const out: string[] = [];
  for (const text of texts) {
    const key = textKey(text);
    if (!/\p{L}/u.test(key)) {
      out.push(text);
      continue;
    }
    const fr = cache[key];
    if (fr === undefined) return null;
    const lead = text.match(/^\s*/)![0];
    const trail = text.match(/\s*$/)![0];
    out.push(`${lead}${fr}${trail}`);
  }
  return out;
}
