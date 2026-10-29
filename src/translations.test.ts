import { describe, expect, it } from "vitest";
import type { BuildOrder } from "./buildOrder";
import { cachedLine, loadTranslations, missingTexts, saveTranslations } from "./translations";

const build: BuildOrder = {
  name: "Vikings",
  civilization: "Vikings",
  build_order: [
    {
      population_count: -1,
      villager_count: 6,
      age: 1,
      resources: { food: 6, wood: 0, gold: 0, stone: 0 },
      notes: ["Queue 2 @unit/bondi.webp@ from @building/longhouse.webp@", "6 -> sheep"],
    },
  ],
};

describe("traductions de macOS gardées sur la machine", () => {
  it("liste les morceaux de texte à traduire, une fois chacun, sans les icônes ni les nombres seuls", () => {
    expect(missingTexts(build, {})).toEqual(["Queue 2", "from", "6 → sheep"]);
    expect(missingTexts(build, { "Queue 2": "Lance 2", from: "de" })).toEqual(["6 → sheep"]);
  });

  it("rend une consigne traduite en entier, espaces d'origine gardés, ou rien", () => {
    const cache = { "Queue 2": "Lance 2", from: "de" };
    expect(cachedLine(["Queue 2 ", " from "], cache)).toEqual(["Lance 2 ", " de "]);
    expect(cachedLine(["Queue 2 ", " to "], cache)).toBeNull();
    expect(cachedLine([" 3 ", "Queue 2"], cache)).toEqual([" 3 ", "Lance 2"]);
  });

  it("se lit et s'écrit sans jamais casser", () => {
    const memory = new Map<string, string>();
    const store = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
    expect(loadTranslations(store)).toEqual({});
    saveTranslations(store, { a: "b" });
    expect(loadTranslations(store)).toEqual({ a: "b" });
    memory.set("bogo.translations.v1", "{abîmé");
    expect(loadTranslations(store)).toEqual({});
  });
});
