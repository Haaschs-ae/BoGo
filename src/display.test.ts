import { describe, expect, it } from "vitest";
import type { BuildOrderStep, StepResources } from "./buildOrder";
import { foodSource, heroModel, iconLabel, isWellKnownIcon, stepBuilding, stepDropOff, stepLandmark, villagerFocus } from "./display";

function step(res: Partial<StepResources>, notes: string[] = []): BuildOrderStep {
  return {
    population_count: -1,
    villager_count: -1,
    age: 1,
    resources: { food: 0, wood: 0, gold: 0, stone: 0, ...res },
    notes,
  };
}

const steps = [
  step({ food: 6 }, ["6 @unit_worker/villager.webp@ -> @resource/sheep.webp@"]),
  step({ food: 6, wood: 3 }, ["3 -> @resource/resource_wood.webp@", "Build a @building_economy/lumber-camp.webp@"]),
  step({ food: 6, wood: 3, gold: 2 }, ["Age up with @landmark_english/council-hall.webp@"]),
];

describe("villagerFocus (où va le prochain villageois produit)", () => {
  it("annonce la suite quand l'étape en cours est faite (6 aux moutons → bois)", () => {
    expect(villagerFocus(steps, 0, { food: 6, wood: 0, gold: 0, stone: 0 }, 6)).toEqual({ resource: "wood", stepIndex: 1 });
  });

  it("compte le villageois que l'alerte demande de déplacer (cas vu : 7 nourriture, 1 bois, 8/9)", () => {
    // Cible 6 nourriture, 3 bois : le 7e à la nourriture part au bois, le prochain produit aussi.
    expect(villagerFocus(steps, 1, { food: 7, wood: 1, gold: 0, stone: 0 }, 8)).toEqual({ resource: "wood", stepIndex: 1 });
    // Le déplacement suffit à faire la répartition : le prochain villageois est pour l'étape d'après.
    expect(villagerFocus(steps, 1, { food: 7, wood: 2, gold: 0, stone: 0 }, 9)).toEqual({ resource: "gold", stepIndex: 2 });
  });

  it("répartition à un villageois près et plus rien à produire : le prochain va à l'étape suivante", () => {
    expect(villagerFocus(steps, 1, { food: 6, wood: 2, gold: 0, stone: 0 }, 9)).toEqual({ resource: "gold", stepIndex: 2 });
  });

  it("reste sur l'étape tant que le moteur y reste (2 villageois partis construire)", () => {
    // 9 villageois, mais seulement 1 au bois sur 3 : le moteur ne passera pas l'étape, le 10e va au bois.
    expect(villagerFocus(steps, 1, { food: 6, wood: 1, gold: 0, stone: 0 }, 9)).toEqual({ resource: "wood", stepIndex: 1 });
  });

  it("dit ce qui manque à l'étape en cours, le plus gros manque d'abord", () => {
    expect(villagerFocus(steps, 2, { food: 6, wood: 2, gold: 0, stone: 0 }, 8)).toEqual({ resource: "gold", stepIndex: 2 });
  });

  it("point de ralliement resté sur les moutons : après le déplacement, le suivant retourne aux moutons", () => {
    const bo = [step({ food: 6 }), step({ food: 6, wood: 3 }), step({ food: 8, wood: 3 })];
    // 8 nourriture, 1 bois à 9/9 : l'alerte envoie 2 villageois au bois, le 10e va à la nourriture.
    expect(villagerFocus(bo, 1, { food: 8, wood: 1, gold: 0, stone: 0 }, 9)).toEqual({ resource: "food", stepIndex: 2 });
    const plusOne = [step({ food: 6, wood: 3 }), step({ food: 7, wood: 3 })];
    expect(villagerFocus(plusOne, 0, { food: 7, wood: 2, gold: 0, stone: 0 }, 9)).toEqual({ resource: "food", stepIndex: 1 });
  });

  it("saute les étapes sans nouveau villageois (déplacements, passage d'âge) pour trouver la bonne", () => {
    // 9 moutons + 3 bois (12), puis 3 moutons partent à l'or (12), puis 3 de plus au bois (15).
    const moves = [step({ food: 9, wood: 3 }), step({ food: 6, wood: 3, gold: 3 }), step({ food: 6, wood: 6, gold: 3 })];
    moves[0].villager_count = moves[1].villager_count = 12;
    moves[2].villager_count = 15;
    expect(villagerFocus(moves, 0, { food: 9, wood: 3, gold: 0, stone: 0 }, 12)).toEqual({ resource: "wood", stepIndex: 2 });
    // Passage d'âge : 2 villageois quittent l'or pour construire, sans nouveau villageois, puis des baies.
    const age = [step({ food: 6, wood: 4, gold: 2 }), step({ food: 6, wood: 4, gold: 0, builder: 2 }), step({ food: 9, wood: 4, gold: 0, builder: 2 })];
    age[0].villager_count = age[1].villager_count = 12;
    age[2].villager_count = 15;
    expect(villagerFocus(age, 0, { food: 6, wood: 4, gold: 2, stone: 0 }, 12)).toEqual({ resource: "food", stepIndex: 2 });
  });

  it("ne déplace pas les bâtisseurs prévus, qui récoltent en attendant", () => {
    const withBuilders = [step({ food: 6, wood: 3, builder: 2 }), step({ food: 6, wood: 3, gold: 3 })];
    withBuilders[0].villager_count = 11;
    expect(villagerFocus(withBuilders, 0, { food: 8, wood: 1, gold: 0, stone: 0 }, 9)).toEqual({ resource: "wood", stepIndex: 0 });
  });

  it("bâtisseurs prévus : « build », à l'étape en cours comme à la suivante", () => {
    const now = [step({ food: 6, wood: 3, builder: 2 }, ["2 @unit_worker/villager.webp@ build @building_military/barracks.webp@"])];
    now[0].villager_count = 11;
    expect(villagerFocus(now, 0, { food: 6, wood: 3, gold: 0, stone: 0 }, 9)).toEqual({ resource: "build", stepIndex: 0 });
    // L'étape suivante n'ajoute qu'un bâtisseur : le 10e villageois part construire.
    const next = [step({ food: 6, wood: 3 }), step({ food: 6, wood: 3, builder: 1 })];
    next[0].villager_count = 9;
    next[1].villager_count = 10;
    expect(villagerFocus(next, 0, { food: 6, wood: 3, gold: 0, stone: 0 }, 9)).toEqual({ resource: "build", stepIndex: 1 });
  });

  it("sans panneau lu, donne ce que l'étape ajoute à la précédente", () => {
    expect(villagerFocus(steps, 1, null)).toEqual({ resource: "wood", stepIndex: 1 });
  });

  it("ne propose rien quand tout est fait jusqu'à la dernière étape", () => {
    expect(villagerFocus(steps, 2, { food: 6, wood: 3, gold: 2, stone: 0 }, 11)).toBeNull();
  });
});

describe("heroModel (le bloc « Prochain villageois »)", () => {
  it("cas de la capture : « BOIS », sans chiffre, sans bâtiment (il est dans les consignes)", () => {
    const hero = heroModel(steps, 1, { food: 7, wood: 1, gold: 0, stone: 0 }, 8)!;
    expect(hero.word).toBe("BOIS");
    expect(hero.word).not.toMatch(/\d/);
    expect(hero.dropOff).toBeNull();
    expect(hero.named).toEqual([]);
  });

  it("villageois de l'étape suivante : il pose le camp de bûcherons, nommé une seule fois", () => {
    const hero = heroModel(steps, 0, { food: 6, wood: 0, gold: 0, stone: 0 }, 6)!;
    expect(hero.word).toBe("BOIS");
    expect(hero.dropOff?.label).toBe("camp de bûcherons");
    expect(hero.named).toEqual(["building_economy/lumber-camp.webp"]);
  });

  it("ne redemande pas un bâtiment de dépôt déjà construit plus tôt dans le BO", () => {
    const bo = [
      step({ food: 6, wood: 3 }, ["3 -> @resource/resource_wood.webp@, build a @building_economy/lumber-camp.webp@"]),
      step({ food: 6, wood: 6 }, ["3 more -> @resource/resource_wood.webp@ at the @building_economy/lumber-camp.webp@"]),
    ];
    expect(heroModel(bo, 0, { food: 6, wood: 3, gold: 0, stone: 0 }, 9)?.dropOff).toBeNull();
  });

  it("moutons de l'étape en cours : nommés en grand, pas dans les consignes", () => {
    expect(heroModel(steps, 0, { food: 4, wood: 0, gold: 0, stone: 0 }, 4)).toMatchObject({
      word: "MOUTONS",
      named: ["resource/sheep.webp"],
    });
  });

  it("construction : le bâtiment des bâtisseurs, pas le camp de la ressource", () => {
    const bo = [
      step({ food: 6, wood: 3, builder: 1 }, [
        "3 -> @resource/resource_wood.webp@, build a @building_economy/lumber-camp.webp@",
        "1 @unit_worker/villager.webp@ builds a @building_military/barracks.webp@",
      ]),
    ];
    bo[0].villager_count = 10;
    expect(heroModel(bo, 0, { food: 6, wood: 3, gold: 0, stone: 0 }, 9)).toMatchObject({
      word: "CONSTRUCTION",
      detail: "caserne",
      named: ["building_military/barracks.webp"],
    });
  });
});

describe("icônes et libellés de l'étape", () => {
  it("trouve la source de nourriture, le bâtiment et le landmark", () => {
    expect(foodSource(steps[0])).toEqual({ path: "resource/sheep.webp", label: "moutons" });
    expect(stepBuilding(steps[1])).toEqual({ path: "building_economy/lumber-camp.webp", label: "camp de bûcherons" });
    expect(stepLandmark(steps[2])).toEqual({ path: "landmark_english/council-hall.webp", label: "Council Hall" });
    expect(foodSource(steps[1])).toBeNull();
  });

  it("trouve le bâtiment de dépôt de la ressource (qui le construit : le premier villageois envoyé)", () => {
    expect(stepDropOff(steps[1], "wood")).toEqual({ path: "building_economy/lumber-camp.webp", label: "camp de bûcherons" });
    expect(stepDropOff(steps[1], "gold")).toBeNull();
    const berries = step({ food: 9 }, ["3 -> @resource/berrybush.webp@, build a @building_economy/mill.webp@"]);
    expect(stepDropOff(berries, "food")?.label).toBe("moulin");
  });
});

describe("noms des icônes (les icônes peu connues sont nommées à côté)", () => {
  it.each([
    ["resource/berrybush.webp", "baies"],
    ["resource/sheep.webp", "moutons"],
    ["building_economy/mill.webp", "moulin"],
    ["building_economy/town-center.webp", "TC"],
    ["building_defensive/palisade-wall.webp", "palissade"],
    ["building_defensive/keep.webp", "donjon"],
    ["unit_cavalry/horseman-1.webp", "cavalier"],
    ["unit_infantry/man-at-arms-1.webp", "homme d'armes"],
    ["technology_economy/wheelbarrow.webp", "brouette"],
    ["landmark_english/abbey-of-kings.webp", "Abbey Of Kings"],
    ["unit_golden_horde/kharash.webp", "kharash"],
    ["age/age_2.webp", "âge II"],
    ["unit_worker/villager-china.webp", "villageois"],
  ])("%s → %s", (path, label) => {
    expect(iconLabel(path)).toBe(label);
  });

  it("ne nomme pas les ressources de base, les villageois ni les âges", () => {
    expect(isWellKnownIcon("resource/resource_gold.webp")).toBe(true);
    expect(isWellKnownIcon("unit_worker/villager-japanese.webp")).toBe(true);
    expect(isWellKnownIcon("age/age_3.webp")).toBe(true);
    expect(isWellKnownIcon("resource/berrybush.webp")).toBe(false);
    expect(isWellKnownIcon("unit_worker/trader.webp")).toBe(false);
  });
});
