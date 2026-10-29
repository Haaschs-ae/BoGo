import { describe, expect, it } from "vitest";
import type { BuildOrderStep, StepResources } from "./buildOrder";
import { BuildEngine, effectiveVillagerTargets, goalCosts, nextVillagerResources, stepGoal, trainsNonVillagers, villagerTarget } from "./engine";
import type { HudReading, Resources } from "./hud";

function step(villagers: number, res: Partial<StepResources>, notes: string[] = [], age = 1): BuildOrderStep {
  return {
    population_count: -1,
    villager_count: villagers,
    age,
    resources: { food: 0, wood: 0, gold: 0, stone: 0, ...res },
    notes,
  };
}

// BO type : 6 moutons, 3 bois, 3 or, passage Féodal, puis 2e TC.
const steps = [
  step(6, { food: 6 }, ["6 @unit_worker/villager.webp@ sur les moutons"]),
  step(9, { food: 6, wood: 3 }, ["3 au bois"]),
  step(12, { food: 6, wood: 3, gold: 3 }, ["3 à l'or", "Age up with @landmark_english/council-hall.webp@"]),
  step(15, { food: 9, wood: 3, gold: 3 }, ["3 aux baies"], 2),
  step(18, { food: 9, wood: 6, gold: 3 }, ["Build a 2nd @building_economy/town-center.webp@"], 2),
  step(20, { food: 9, wood: 8, gold: 3 }, ["2 au bois"], 2),
];

function reading(gatherers: Partial<Resources>, stock: Partial<Resources> = {}, idle = 0): HudReading {
  const g = { food: 0, wood: 0, gold: 0, stone: 0, ...gatherers };
  const villagers = Math.max(g.food + g.wood + g.gold + g.stone, idle);
  return {
    population: villagers + 1,
    populationMax: 200,
    idle,
    stock: { food: 0, wood: 0, gold: 0, stone: 0, ...stock },
    gatherers: g,
    villagers,
  };
}

/** Envoie la même lecture plusieurs secondes de suite (une lecture par seconde). */
function feed(engine: BuildEngine, r: HudReading, from: number, seconds = 2) {
  let state = engine.state(from);
  for (let t = 0; t < seconds; t++) state = engine.update(r, from + t * 1000);
  return state;
}

describe("analyse des étapes", () => {
  it("repère le passage d'âge, le TC et les étapes de villageois", () => {
    expect(stepGoal(steps, 0)).toEqual({ kind: "villagers" });
    expect(stepGoal(steps, 2)).toEqual({ kind: "age", age: 2 });
    expect(stepGoal(steps, 3)).toEqual({ kind: "villagers" });
    expect(stepGoal(steps, 4)).toEqual({ kind: "tc" });
  });

  it("met la consigne d'âge sur l'étape qui parle du monument", () => {
    const later = [step(6, { food: 6 }), step(9, { food: 9 }, ["Age up @age/age_2.webp@"], 2), step(12, { food: 12 }, [], 2)];
    expect(stepGoal(later, 0)).toEqual({ kind: "villagers" });
    expect(stepGoal(later, 1)).toEqual({ kind: "age", age: 2 });
  });

  it("ne prend pas une simple mention du TC pour un nouveau TC", () => {
    expect(stepGoal([step(6, {}, ["Vils from @building_economy/town-center.webp@"])], 0)).toEqual({ kind: "villagers" });
  });

  it("calcule la cible de villageois quand le BO met -1", () => {
    expect(villagerTarget(step(-1, { food: 6, wood: 2, builder: 1 }))).toBe(9);
  });

  it("indique où partent les prochains villageois", () => {
    expect(nextVillagerResources(steps, 0)).toEqual({ food: 6 });
    expect(nextVillagerResources(steps, 1)).toEqual({ wood: 3 });
  });

  it("donne les coûts de la civ d'après les données d'AoE4World", () => {
    expect(goalCosts({ kind: "age", age: 2 }, "English")).toEqual([{ food: 400, gold: 200 }]);
    expect(goalCosts({ kind: "age", age: 2 }, "Ayyubids")).toContainEqual({ food: 200, gold: 100 });
    expect(goalCosts({ kind: "tc" }, "Mongols")).toEqual([{ wood: 750 }]);
    expect(goalCosts({ kind: "tc" }, "Malians")).toEqual([{ wood: 400, gold: 350 }]);
    expect(goalCosts({ kind: "villagers" }, "English")).toEqual([]);
  });

  it("reconnaît un TC moins cher (technologie) et l'aile Advancement des Ayyoubides", () => {
    const tcEngine = new BuildEngine(steps, "Golden Horde");
    tcEngine.setStep(4);
    feed(tcEngine, reading({ food: 9, wood: 6, gold: 3 }, { wood: 600 }), 0, 4);
    expect(feed(tcEngine, reading({ food: 9, wood: 6, gold: 3 }, { wood: 120 }), 4000, 3).index).toBe(5);

    const ayyubids = new BuildEngine(steps, "Ayyubids");
    ayyubids.setStep(2);
    let state = feed(ayyubids, reading({ food: 7, wood: 3, gold: 3 }, { food: 230, gold: 110 }), 0, 4);
    expect(state.affordable).toBe(true);
    state = feed(ayyubids, reading({ food: 7, wood: 3, gold: 3 }, { food: 30, gold: 10 }), 4000, 3);
    expect(state.index).toBe(3);
  });
});

/** Lecture brute du panneau : compteurs par ressource, inactifs et population donnés à part. */
function panel(gatherers: Partial<Resources>, idle: number, population: number): HudReading {
  const g = { food: 0, wood: 0, gold: 0, stone: 0, ...gatherers };
  const working = g.food + g.wood + g.gold + g.stone;
  return { population, populationMax: 200, idle, stock: { food: 0, wood: 0, gold: 0, stone: 0 }, gatherers: g, villagers: Math.max(working, idle) };
}

describe("estimation des villageois", () => {
  const longSteps = [step(20, { food: 20 })];

  it("compte les villageois produits même s'ils ne sont sur aucune ressource (partie réelle à 6:21)", () => {
    const engine = new BuildEngine(longSteps, "English");
    // Début : 6 villageois inactifs + l'éclaireur.
    expect(feed(engine, panel({}, 6, 7), 0).villagers).toBe(6);
    // Les 3 suivants vont au bois.
    feed(engine, panel({ food: 6, wood: 1 }, 0, 8), 2000);
    feed(engine, panel({ food: 6, wood: 2 }, 0, 9), 4000);
    feed(engine, panel({ food: 6, wood: 3 }, 0, 10), 6000);
    // Moutons épuisés, 3 nouveaux villageois sans tâche : le panneau affiche 6 nourriture,
    // 3 bois et 9 inactifs (les 6 sans moutons + les 3 nouveaux), soit 9 villageois visibles.
    feed(engine, panel({ food: 6, wood: 3 }, 7, 11), 8000);
    feed(engine, panel({ food: 6, wood: 3 }, 8, 12), 10000);
    expect(feed(engine, panel({ food: 6, wood: 3 }, 9, 13), 12000).villagers).toBe(12);
  });

  it("garde un villageois parti construire", () => {
    const engine = new BuildEngine(longSteps, "English");
    feed(engine, panel({ food: 9, wood: 3 }, 0, 13), 0);
    expect(feed(engine, panel({ food: 9 }, 0, 13), 2000).villagers).toBe(12);
  });

  it("ne prend pas une unité militaire pour un villageois", () => {
    const military = [step(20, { food: 12 }, ["2 @unit_infantry/spearman-1.webp@ depuis la caserne"])];
    expect(trainsNonVillagers(military[0])).toBe(true);
    expect(trainsNonVillagers(step(6, {}, ["6 @unit_worker/villager.webp@"]))).toBe(false);

    const engine = new BuildEngine(military, "English");
    feed(engine, panel({ food: 12 }, 0, 13), 0);
    // Un lancier sort : la population monte, mais aucun villageois de plus.
    expect(feed(engine, panel({ food: 12 }, 0, 14), 2000).villagers).toBe(12);
    // Un villageois sort et va récolter : on le compte.
    expect(feed(engine, panel({ food: 13 }, 0, 15), 4000).villagers).toBe(13);
  });
});

describe("BuildEngine", () => {
  it("ne saute pas les étapes sans cible de villageois (-1 ou plus basse) : bug vu en partie", () => {
    const withGaps = [
      step(6, { food: 6 }),
      step(-1, { food: -1, wood: -1, gold: -1, stone: -1 }, ["Construis une maison"]),
      step(9, { food: 6, wood: 3 }),
      step(4, { food: 4 }, ["Étape mal remplie"]),
      step(12, { food: 6, wood: 3, gold: 3 }),
    ];
    expect(effectiveVillagerTargets(withGaps)).toEqual([6, 6, 9, 9, 12]);
    const engine = new BuildEngine(withGaps, "English");
    expect(feed(engine, reading({ food: 6 }), 0).index).toBe(0);
    // Le 7e villageois passe l'étape 1 et l'étape « maison » (même cible), pas plus.
    expect(feed(engine, reading({ food: 6, wood: 1 }), 2000).index).toBe(2);
    expect(engine.log[0]).toBe("Étape 1 → 3 : 7 villageois > 6");
  });

  it("passe à l'étape suivante quand le 7e villageois apparaît", () => {
    const engine = new BuildEngine(steps, "English");
    expect(feed(engine, reading({ food: 6 }), 0).index).toBe(0);
    expect(feed(engine, reading({ food: 6, wood: 1 }), 2000).index).toBe(1);
  });

  it("ignore un chiffre mal lu une seule fois", () => {
    const engine = new BuildEngine(steps, "English");
    feed(engine, reading({ food: 6 }), 0);
    engine.update(reading({ food: 8 }), 2000);
    expect(feed(engine, reading({ food: 6 }), 3000).index).toBe(0);
  });

  it("attend le clic sur le monument, puis avance quand les ressources sont dépensées", () => {
    const engine = new BuildEngine(steps, "English");
    const twelve = { food: 6, wood: 3, gold: 3 };
    let state = feed(engine, reading({ ...twelve, food: 7 }, { food: 300, gold: 150 }), 0);
    expect(state.index).toBe(2);
    expect(state.goal).toEqual({ kind: "age", age: 2 });
    expect(state.affordable).toBe(false);

    // Un 13e villageois ne fait pas sauter l'étape d'âge.
    state = feed(engine, reading({ ...twelve, food: 7 }, { food: 420, gold: 210 }), 2000, 4);
    expect(state.index).toBe(2);
    expect(state.affordable).toBe(true);

    state = feed(engine, reading({ ...twelve, food: 7 }, { food: 25, gold: 12 }), 6000, 3);
    expect(state.index).toBe(3);
  });

  it("ne prend pas les petites dépenses (villageois, maison) pour un passage d'âge", () => {
    const engine = new BuildEngine(steps, "English");
    engine.setStep(2);
    let food = 450;
    let state = engine.state(0);
    for (let t = 0; t < 12; t++) {
      food -= 50; // un villageois toutes les secondes, sans récolte : le pire cas
      state = engine.update(reading({ food: 7, wood: 3, gold: 3 }, { food, gold: 220, wood: 60 }), t * 1000);
    }
    expect(state.index).toBe(2);
  });

  it("avance après la pose du TC (grosse dépense de bois)", () => {
    const engine = new BuildEngine(steps, "English");
    engine.setStep(4);
    feed(engine, reading({ food: 9, wood: 6, gold: 3 }, { wood: 450, stone: 320 }), 0, 4);
    const state = feed(engine, reading({ food: 9, wood: 6, gold: 3 }, { wood: 40, stone: 20 }), 4000, 3);
    expect(state.index).toBe(5);
  });

  it("finit par avancer sans clic vu si les villageois ont largement dépassé la cible", () => {
    const engine = new BuildEngine(steps, "English");
    engine.setStep(2);
    expect(feed(engine, reading({ food: 10, wood: 3, gold: 3 }), 0).index).toBe(2);
    // 17 villageois : l'étape d'âge (12 + 4) et la suivante (15) sont dépassées, on s'arrête au TC.
    expect(feed(engine, reading({ food: 11, wood: 3, gold: 3 }), 2000).index).toBe(4);
  });

  it("respecte un retour en arrière fait à la main jusqu'au prochain villageois", () => {
    const engine = new BuildEngine(steps, "English");
    feed(engine, reading({ food: 6, wood: 2 }), 0);
    expect(engine.index).toBe(1);
    engine.setStep(0);
    expect(feed(engine, reading({ food: 6, wood: 2 }), 2000).index).toBe(0);
    expect(feed(engine, reading({ food: 6, wood: 3 }), 4000).index).toBe(1);
  });

  it("reste sur l'étape tant que la répartition n'est pas faite (trop à la nourriture, pas assez à l'or) : vu en partie", () => {
    const engine = new BuildEngine(steps, "English");
    engine.setStep(1);
    // Étape 2 : 6 nourriture + 3 bois = 9. Un 10e villageois, mais 9 à la nourriture et 1 au bois.
    let state = feed(engine, reading({ food: 9, wood: 1 }), 0, 4);
    expect(state.villagers).toBe(10);
    expect(state.index).toBe(1);
    expect(state.misplacement).toEqual({ from: "food", to: "wood", count: 3 });
    // Le joueur corrige : on avance.
    state = feed(engine, reading({ food: 6, wood: 3, gold: 1 }), 4000);
    expect(state.index).toBe(2);
    // Décroché du BO (3 villageois de plus sans suivre la répartition) : on avance quand même.
    const lost = new BuildEngine(steps, "English");
    lost.setStep(1);
    expect(feed(lost, reading({ food: 12 }), 0).index).toBe(2);
  });

  it("ne signale pas les villageois qui attendent de construire (bâtisseurs prévus) : vu en partie", () => {
    const withBuilders = [step(21, { food: 6, wood: 0, gold: 7, builder: 8 })];
    const engine = new BuildEngine(withBuilders, "English");
    expect(feed(engine, reading({ food: 7, wood: 4 }), 0, 5).misplacement).toBeNull();
    // Au-delà des bâtisseurs prévus, l'alerte revient.
    expect(feed(engine, reading({ food: 9, wood: 8 }), 5000, 5).misplacement).toEqual({ from: "wood", to: "gold", count: 3 });
  });

  it("signale un villageois en trop sur une ressource s'il y reste", () => {
    const engine = new BuildEngine(steps, "English");
    // Étape 2 : 6 nourriture, 3 bois. Le 8e part aux moutons au lieu du bois.
    let state = feed(engine, reading({ food: 7, wood: 1 }), 0, 2);
    expect(state.index).toBe(1);
    expect(state.misplacement).toBeNull();
    state = feed(engine, reading({ food: 7, wood: 1 }), 2000, 3);
    expect(state.misplacement).toEqual({ from: "food", to: "wood", count: 1 });
    state = feed(engine, reading({ food: 6, wood: 2 }), 5000, 1);
    expect(state.misplacement).toBeNull();
  });
});
