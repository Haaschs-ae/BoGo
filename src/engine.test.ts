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
    // TC de la Horde d'or : 750 bois, une seule ressource. 480 bois dépensés d'un coup peuvent
    // être quelques bâtiments : il faut presque tout le coût (sonde de l'audit).
    const tcEngine = new BuildEngine(steps, "Golden Horde");
    tcEngine.setStep(4);
    feed(tcEngine, reading({ food: 9, wood: 6, gold: 3 }, { wood: 600 }), 0, 4);
    expect(feed(tcEngine, reading({ food: 9, wood: 6, gold: 3 }, { wood: 120 }), 4000, 3).index).toBe(4);
    feed(tcEngine, reading({ food: 9, wood: 6, gold: 3 }, { wood: 800 }), 20000, 4);
    expect(feed(tcEngine, reading({ food: 9, wood: 6, gold: 3 }, { wood: 60 }), 24000, 3).index).toBe(5);

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

describe("estimation des villageois : scénarios de l'audit", () => {
  const longSteps = [step(30, { food: 30 })];

  it("redescend après un raid : population et villageois visibles baissent ensemble", () => {
    const engine = new BuildEngine(longSteps, "English");
    // 12 villageois + 5 lanciers + l'éclaireur.
    feed(engine, panel({ food: 8, wood: 4 }, 0, 18), 0);
    expect(feed(engine, panel({ food: 8, wood: 4 }, 0, 18), 2000).villagers).toBe(12);
    // Raid : 4 villageois tués au bois.
    expect(feed(engine, panel({ food: 8 }, 0, 14), 4000).villagers).toBe(8);
    // Un lancier mort ne retire pas de villageois.
    expect(feed(engine, panel({ food: 8 }, 0, 13), 6000).villagers).toBe(8);
  });

  it("n'ajoute pas l'armée faite en réaction sur une étape de villageois", () => {
    const engine = new BuildEngine(longSteps, "English");
    feed(engine, panel({ food: 9 }, 0, 10), 0);
    // 2 lanciers contre un éclaireur adverse : la population monte, aucun villageois n'apparaît.
    feed(engine, panel({ food: 9 }, 0, 11), 2000);
    expect(feed(engine, panel({ food: 9 }, 0, 12), 4000).villagers).toBe(9);
    // 40 s plus tard, un bâtisseur revient récolter : il ne confirme pas les lanciers oubliés.
    feed(engine, panel({ food: 8 }, 0, 12), 10000);
    expect(feed(engine, panel({ food: 9 }, 0, 12), 50000).villagers).toBe(9);
  });

  it("une population mal lue (18 au lieu de 16) ne crée pas de villageois fantôme", () => {
    const engine = new BuildEngine(longSteps, "English");
    feed(engine, panel({ food: 15 }, 0, 16), 0);
    feed(engine, panel({ food: 15 }, 0, 18), 2000);
    feed(engine, panel({ food: 15 }, 0, 16), 4000);
    // La lecture corrigée annule la hausse fantôme : un vrai villageois ensuite compte pour un.
    expect(feed(engine, panel({ food: 16 }, 0, 17), 6000).villagers).toBe(16);
    expect(feed(engine, panel({ food: 16 }, 0, 17), 40000).villagers).toBe(16);
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
    // Le 7e villageois fait passer une étape à la fois, avec 5 s au moins sur chacune.
    expect(feed(engine, reading({ food: 6, wood: 1 }), 5000).index).toBe(1);
    expect(engine.log[0]).toBe("Étape 1 → 2 : 7 villageois > 6, répartition faite");
    expect(feed(engine, reading({ food: 6, wood: 1 }), 10000).index).toBe(2);
    expect(feed(engine, reading({ food: 6, wood: 1 }), 15000).index).toBe(2);
  });

  it("passe à l'étape suivante quand le 7e villageois apparaît, après 5 s au moins sur l'étape", () => {
    const engine = new BuildEngine(steps, "English");
    expect(feed(engine, reading({ food: 6 }), 0).index).toBe(0);
    expect(feed(engine, reading({ food: 6, wood: 1 }), 2000).index).toBe(0);
    expect(feed(engine, reading({ food: 6, wood: 1 }), 5000).index).toBe(1);
  });

  it("ignore un chiffre mal lu une seule fois", () => {
    const engine = new BuildEngine(steps, "English");
    feed(engine, reading({ food: 6 }), 0);
    engine.update(reading({ food: 8 }), 6000);
    expect(feed(engine, reading({ food: 6 }), 7000).index).toBe(0);
  });

  it("attend le clic sur le monument, puis avance quand les ressources sont dépensées", () => {
    const engine = new BuildEngine(steps, "English");
    engine.setStep(2);
    const twelve = { food: 6, wood: 3, gold: 3 };
    let state = feed(engine, reading({ ...twelve, food: 7 }, { food: 300, gold: 150 }), 0);
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

  it("avance après la pose du TC (bois et pierre dépensés)", () => {
    const engine = new BuildEngine(steps, "English");
    engine.setStep(4);
    feed(engine, reading({ food: 9, wood: 6, gold: 3 }, { wood: 450, stone: 320 }), 0, 4);
    const state = feed(engine, reading({ food: 9, wood: 6, gold: 3 }, { wood: 40, stone: 20 }), 4000, 3);
    expect(state.index).toBe(5);
  });

  it("ne prend pas des palissades posées en urgence (gros bois, pas de pierre) pour un TC", () => {
    const engine = new BuildEngine(steps, "English");
    engine.setStep(4);
    feed(engine, reading({ food: 9, wood: 6, gold: 3 }, { wood: 450, stone: 320 }), 0, 4);
    expect(feed(engine, reading({ food: 9, wood: 6, gold: 3 }, { wood: 60, stone: 320 }), 4000, 3).index).toBe(4);
  });

  it("ne saute jamais un passage d'âge sur le seul nombre de villageois (attaque, villageois en plus)", () => {
    const engine = new BuildEngine(steps, "English");
    engine.setStep(2);
    let t = 0;
    for (let food = 7; food <= 16; food++, t += 3000) feed(engine, reading({ food, wood: 3, gold: 3 }), t);
    expect(engine.index).toBe(2);
  });

  it("respecte un retour en arrière fait à la main jusqu'au prochain villageois", () => {
    const engine = new BuildEngine(steps, "English");
    feed(engine, reading({ food: 6 }), 0);
    expect(feed(engine, reading({ food: 6, wood: 2 }), 5000).index).toBe(1);
    engine.setStep(0);
    expect(feed(engine, reading({ food: 6, wood: 2 }), 10000).index).toBe(0);
    expect(feed(engine, reading({ food: 6, wood: 3 }), 15000).index).toBe(1);
  });

  it("reste sur l'étape tant que la répartition n'est pas faite, même avec des villageois en plus : vu en partie", () => {
    const engine = new BuildEngine(steps, "English");
    engine.setStep(1);
    // Étape 2 : 6 nourriture + 3 bois = 9. Un 10e villageois, mais 9 à la nourriture et 1 au bois.
    // Erreur ordinaire : alerte dès que l'écart dure 3 s, sans autre délai.
    let state = feed(engine, reading({ food: 9, wood: 1 }), 0, 4);
    expect(state.villagers).toBe(10);
    expect(state.index).toBe(1);
    // 3 de trop à la nourriture, mais il n'en manque que 2 au bois : « envoies-en 2 ».
    expect(state.misplacement).toEqual({ from: "food", to: "wood", count: 2, excess: 3 });
    expect(state.drift).toBe(1);
    // Le joueur corrige : on avance.
    state = feed(engine, reading({ food: 6, wood: 3, gold: 1 }), 5000);
    expect(state.index).toBe(2);
    // Décroché du BO (attaque, choix du joueur) : BoGo reste et propose ⌘⌥→ (drift).
    const lost = new BuildEngine(steps, "English");
    lost.setStep(1);
    let t = 0;
    for (let food = 12; food <= 15; food++, t += 6000) state = feed(lost, reading({ food }), t);
    expect(state.index).toBe(1);
    expect(state.drift).toBe(6);
  });

  it("ne signale pas les villageois qui attendent de construire (bâtisseurs prévus) : vu en partie", () => {
    const withBuilders = [step(21, { food: 6, wood: 0, gold: 7, builder: 8 })];
    const engine = new BuildEngine(withBuilders, "English");
    expect(feed(engine, reading({ food: 7, wood: 4 }), 0, 5).misplacement).toBeNull();
    // Au-delà des bâtisseurs prévus, l'alerte revient.
    expect(feed(engine, reading({ food: 9, wood: 8 }), 5000, 5).misplacement).toEqual({ from: "wood", to: "gold", count: 3, excess: 3 });
  });

  it("signale un villageois en trop sur une ressource s'il y reste", () => {
    const engine = new BuildEngine(steps, "English");
    engine.setStep(1);
    // Étape 2 : 6 nourriture, 3 bois. Le 8e part aux moutons au lieu du bois (ralliement oublié) :
    // alerte au bout de 3 s d'écart, même juste après le changement d'étape.
    let state = feed(engine, reading({ food: 7, wood: 1 }), 0, 2);
    expect(state.misplacement).toBeNull();
    state = feed(engine, reading({ food: 7, wood: 1 }), 2000, 2);
    expect(state.misplacement).toEqual({ from: "food", to: "wood", count: 1, excess: 1 });
    state = feed(engine, reading({ food: 6, wood: 2 }), 5000, 1);
    expect(state.misplacement).toBeNull();
  });

  it("laisse 6 s pour une étape qui demande de déplacer des villageois", () => {
    // 9 aux moutons, puis « 3 des moutons vers l'or » : 3 de trop aux moutons, c'est normal au début.
    const moving = [step(12, { food: 9, wood: 3 }), step(12, { food: 6, wood: 3, gold: 3 })];
    const engine = new BuildEngine(moving, "English");
    engine.setStep(1);
    let state = feed(engine, reading({ food: 9, wood: 3 }), 0, 5);
    expect(state.misplacement).toBeNull();
    state = feed(engine, reading({ food: 9, wood: 3 }), 5000, 2);
    expect(state.misplacement).toEqual({ from: "food", to: "gold", count: 3, excess: 3 });
  });
});

describe("fin du BO (objectif de la dernière étape)", () => {
  it("un BO qui finit sur « passe l'âge » se termine au paiement, pas sur les villageois", () => {
    const bo = [
      step(6, { food: 6 }, ["6 @unit_worker/villager.webp@ sur les moutons"]),
      step(9, { food: 6, wood: 3 }, ["Age up with @landmark_english/council-hall.webp@"]),
    ];
    expect(stepGoal(bo, 1)).toEqual({ kind: "age", age: 2 });
    const engine = new BuildEngine(bo, "English");
    engine.setStep(1);
    // Villageois et répartition atteints : pas fini, il faut payer l'âge.
    let state = feed(engine, reading({ food: 6, wood: 3 }, { food: 450, gold: 220 }), 0, 15);
    expect(state.completed).toBe(false);
    // 400 nourriture et 200 or dépensés d'un coup : passage d'âge payé, fin du BO.
    state = feed(engine, reading({ food: 6, wood: 3 }, { food: 50, gold: 20 }), 15000, 3);
    expect(state.completed).toBe(true);
    expect(engine.log[0]).toContain("fin du BO");
  });

  it("une dernière étape « villageois » reste affichée 10 s avant la fin", () => {
    const bo = [step(6, { food: 6 }), step(9, { food: 6, wood: 3 })];
    const engine = new BuildEngine(bo, "English");
    engine.setStep(1);
    expect(feed(engine, reading({ food: 6, wood: 3 }), 0, 5).completed).toBe(false);
    expect(feed(engine, reading({ food: 6, wood: 3 }), 5000, 7).completed).toBe(true);
  });

  it("revenir en arrière au clavier annule la fin", () => {
    const bo = [step(6, { food: 6 }), step(9, { food: 6, wood: 3 })];
    const engine = new BuildEngine(bo, "English");
    engine.setStep(1);
    expect(feed(engine, reading({ food: 6, wood: 3 }), 0, 12).completed).toBe(true);
    engine.setStep(0);
    expect(engine.state().completed).toBe(false);
  });
});
