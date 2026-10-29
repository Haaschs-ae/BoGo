import { describe, expect, it } from "vitest";
import type { StepResources } from "./buildOrder";
import { applyMoves, distributionReached, plannedMoves } from "./distribution";

const target = (res: Partial<StepResources>): StepResources => ({ food: 0, wood: 0, gold: 0, stone: 0, ...res });
const have = (food = 0, wood = 0, gold = 0, stone = 0) => ({ food, wood, gold, stone });

describe("plannedMoves (une seule règle pour l'alerte et le bloc)", () => {
  it("plafonne le déplacement à ce qui manque à la destination", () => {
    // 3 de trop à la nourriture, 2 manquent au bois : « envoies-en 2 au bois », le 3e est en plus.
    expect(plannedMoves(target({ food: 6, wood: 3 }), have(9, 1))).toEqual([
      { from: "food", to: "wood", count: 2, excess: 3 },
      { from: "food", to: null, count: 1, excess: 1 },
    ]);
  });

  it("répartit le surplus sur plusieurs manques, le plus gros d'abord", () => {
    const moves = plannedMoves(target({ food: 6, wood: 3, gold: 2 }), have(9, 1, 1));
    expect(moves).toEqual([
      { from: "food", to: "wood", count: 2, excess: 3 },
      { from: "food", to: "gold", count: 1, excess: 1 },
    ]);
    expect(applyMoves(have(9, 1, 1), moves)).toEqual(have(6, 3, 2));
  });

  it("laisse en place les bâtisseurs prévus, qui récoltent en attendant", () => {
    expect(plannedMoves(target({ food: 6, wood: 3, builder: 2 }), have(8, 1))).toEqual([]);
    expect(plannedMoves(target({ food: 6, wood: 3, builder: 2 }), have(9, 1))).toEqual([
      { from: "food", to: "wood", count: 1, excess: 1 },
    ]);
  });

  it("ignore une ressource non précisée (-1)", () => {
    expect(plannedMoves(target({ food: 6, wood: -1 }), have(6, 5))).toEqual([]);
  });
});

it("distributionReached tolère un villageois de moins (plus les bâtisseurs prévus)", () => {
  expect(distributionReached(target({ food: 6, wood: 3 }), have(6, 2))).toBe(true);
  expect(distributionReached(target({ food: 6, wood: 3 }), have(6, 1))).toBe(false);
  expect(distributionReached(target({ food: 6, wood: 3, builder: 1 }), have(6, 1))).toBe(true);
});
