import { describe, expect, it } from "vitest";
import type { BuildOrderStep, StepResources } from "./buildOrder";
import { foodSource, stepBuilding, stepLandmark, villagerFocus } from "./display";

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

describe("villagerFocus", () => {
  it("annonce la suite quand l'étape en cours est faite (6 aux moutons → bois)", () => {
    expect(villagerFocus(steps, 0, { food: 6, wood: 0, gold: 0, stone: 0 })).toEqual({
      resource: "wood",
      count: 3,
      others: [],
      stepIndex: 1,
    });
  });

  it("dit ce qui manque à l'étape en cours, le plus gros manque d'abord", () => {
    expect(villagerFocus(steps, 2, { food: 6, wood: 2, gold: 0, stone: 0 })).toEqual({
      resource: "gold",
      count: 2,
      others: [{ resource: "wood", count: 1 }],
      stepIndex: 2,
    });
  });

  it("sans panneau lu, donne ce que l'étape ajoute à la précédente", () => {
    expect(villagerFocus(steps, 1, null)).toMatchObject({ resource: "wood", count: 3, stepIndex: 1 });
  });

  it("ne propose rien quand tout est fait jusqu'à la dernière étape", () => {
    expect(villagerFocus(steps, 2, { food: 6, wood: 3, gold: 2, stone: 0 })).toBeNull();
  });
});

describe("icônes et libellés de l'étape", () => {
  it("trouve la source de nourriture, le bâtiment et le landmark", () => {
    expect(foodSource(steps[0])).toEqual({ path: "resource/sheep.webp", label: "moutons" });
    expect(stepBuilding(steps[1])).toEqual({ path: "building_economy/lumber-camp.webp", label: "camp de bûcherons" });
    expect(stepLandmark(steps[2])).toEqual({ path: "landmark_english/council-hall.webp", label: "Council Hall" });
    expect(foodSource(steps[1])).toBeNull();
  });
});
