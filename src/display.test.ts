import { describe, expect, it } from "vitest";
import type { BuildOrderStep, StepResources } from "./buildOrder";
import { foodSource, iconLabel, isWellKnownIcon, stepBuilding, stepDropOff, stepLandmark, villagerFocus } from "./display";

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
    expect(villagerFocus(steps, 0, { food: 6, wood: 0, gold: 0, stone: 0 }, 0)).toEqual({ resource: "wood", stepIndex: 1 });
  });

  it("compte le villageois que l'alerte demande de déplacer (cas vu : 7 nourriture, 1 bois, 8/9)", () => {
    // Cible 6 nourriture, 3 bois : le 7e à la nourriture part au bois, le prochain produit aussi.
    expect(villagerFocus(steps, 1, { food: 7, wood: 1, gold: 0, stone: 0 }, 1)).toEqual({ resource: "wood", stepIndex: 1 });
    // Le déplacement suffit à faire la répartition : le prochain villageois est pour l'étape d'après.
    expect(villagerFocus(steps, 1, { food: 7, wood: 2, gold: 0, stone: 0 }, 0)).toEqual({ resource: "gold", stepIndex: 2 });
  });

  it("plus de villageois à produire pour l'étape : le prochain va à l'étape suivante", () => {
    // Il manque 1 bois mais les 9 villageois sont là (un inactif à replacer) : le 10e va à l'or.
    expect(villagerFocus(steps, 1, { food: 6, wood: 2, gold: 0, stone: 0 }, 0)).toEqual({ resource: "gold", stepIndex: 2 });
  });

  it("dit ce qui manque à l'étape en cours, le plus gros manque d'abord", () => {
    expect(villagerFocus(steps, 2, { food: 6, wood: 2, gold: 0, stone: 0 }, 3)).toEqual({ resource: "gold", stepIndex: 2 });
  });

  it("ne déplace pas les bâtisseurs prévus, qui récoltent en attendant", () => {
    const withBuilders = [step({ food: 6, wood: 3, builder: 2 }), step({ food: 6, wood: 3, gold: 3 })];
    expect(villagerFocus(withBuilders, 0, { food: 8, wood: 1, gold: 0, stone: 0 }, 2)).toEqual({ resource: "wood", stepIndex: 0 });
  });

  it("répartition faite mais villageois encore à produire : ce sont les bâtisseurs prévus", () => {
    const withBuilders = [step({ food: 6, wood: 3, builder: 2 }, ["2 @unit_worker/villager.webp@ build @building_military/barracks.webp@"])];
    expect(villagerFocus(withBuilders, 0, { food: 6, wood: 3, gold: 0, stone: 0 }, 2)).toEqual({ resource: "build", stepIndex: 0 });
  });

  it("sans panneau lu, donne ce que l'étape ajoute à la précédente", () => {
    expect(villagerFocus(steps, 1, null)).toEqual({ resource: "wood", stepIndex: 1 });
  });

  it("ne propose rien quand tout est fait jusqu'à la dernière étape", () => {
    expect(villagerFocus(steps, 2, { food: 6, wood: 3, gold: 2, stone: 0 }, 0)).toBeNull();
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
