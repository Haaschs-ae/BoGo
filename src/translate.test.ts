import { describe, expect, it } from "vitest";
import type { BuildOrder } from "./buildOrder";
import { looksEnglish, translateTerm, translateText } from "./translate";

describe("translateText (consignes réelles du BO « English 2 TC defensive »)", () => {
  it.each([
    ["until 3; scout in a standard pattern with ", "jusqu'à 3; explore en motif classique avec "],
    [" if he is passive", " s'il est passif"],
    ["Last ", "Derniers "],
    [" chopped: 8 ", " au bois: 8 "],
    [" done: keep 3 ", " terminé: garde 3 "],
    [", rest ", ", reste "],
    [" + both ", " + les deux "],
    ["; keep around 10 ", "; garde environ 10 "],
    ["Save ", "Économise "],
    [", up to 30 ", ", jusqu'à 30 "],
    [" to sell", " pour vendre"],
    ["At 100 ", "À 100 "],
    [" away from ", " loin de "],
    [" until 8, then ", " jusqu'à 8, puis "],
    [" (keep 4); no ", " (garde 4); pas de "],
    [" yet", " encore"],
    [" with ", " avec "],
    [" or ", " ou "],
    [", then ", ", puis "],
    [" and ", " et "],
  ])("« %s » → « %s »", (en, fr) => {
    expect(translateText(en)).toBe(fr);
  });

  it("traduit les expressions avant les mots, et garde la majuscule", () => {
    expect(translateText("Build a lumber camp then age up")).toBe("Construis camp de bûcherons puis passe l'âge");
    expect(translateText("Send the rest to gold")).toBe("Envoie le reste vers or");
    expect(translateText("6 villagers on sheep")).toBe("6 villageois sur moutons");
    expect(translateText("Age up with  when you have the resources")).toBe("Passe l'âge avec quand tu as les ressources");
  });

  it("ne touche pas aux sigles ni aux nombres", () => {
    expect(translateText("2nd TC at 4:30")).toBe("2nd TC à 4:30");
  });
});

function bo(notes: string[]): BuildOrder {
  return {
    name: "x",
    civilization: "English",
    build_order: [
      {
        population_count: -1,
        villager_count: 6,
        age: 1,
        resources: { food: 6, wood: 0, gold: 0, stone: 0 },
        notes,
      },
    ],
  };
}

describe("looksEnglish", () => {
  it("reconnaît un BO en anglais", () => {
    expect(looksEnglish(bo(["6 @unit_worker/villager.webp@ to sheep", "Build a house then send 3 to wood"]))).toBe(true);
  });

  it("laisse un BO déjà en français (« or » y veut dire l'or)", () => {
    expect(looksEnglish(bo(["6 villageois aux moutons", "Construis une maison puis envoie 3 au bois et 2 à l'or"]))).toBe(false);
  });
});

describe("translateTerm (noms d'icônes)", () => {
  it("traduit un nom connu et laisse un nom inconnu en anglais", () => {
    expect(translateTerm("lumber camp")).toBe("camp de bûcherons");
    expect(translateTerm("house")).toBe("maison");
    expect(translateTerm("stone wall tower")).toBe("stone wall tower");
    expect(translateTerm("kharash")).toBe("kharash");
  });
});
