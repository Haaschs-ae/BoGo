import { describe, expect, it } from "vitest";
import { parseHud, type OcrToken } from "./hud";

// Zone lue par bogo-vision sur un écran 1920×1080 : x 0–345 px, y 648–1080 px.
// Positions relevées sur une vraie capture d'AoE4 (début de partie, 6 vils aux moutons).
function token(text: string, x1: number, y1: number, x2: number, y2: number): OcrToken {
  const W = 345.6;
  const H = 432;
  return { text, x: x1 / W, y: (y1 - 648) / H, w: (x2 - x1) / W, h: (y2 - y1) / H };
}

const startOfGame = [
  token("4", 14, 735, 22, 750), // compteur du bouton de bâtiment, au-dessus du panneau
  token("7/10", 42, 858, 78, 878),
  token("0", 146, 858, 157, 878),
  token("0", 42, 916, 52, 936),
  token("6", 146, 916, 157, 936),
  token("200", 42, 955, 72, 975),
  token("0", 146, 955, 157, 975),
  token("100", 42, 994, 72, 1014),
  token("0", 146, 994, 157, 1014),
  token("0", 42, 1033, 52, 1053),
  token("0", 146, 1033, 157, 1053),
];

describe("parseHud", () => {
  it("lit population, stocks et villageois par ressource", () => {
    expect(parseHud(startOfGame)).toEqual({
      population: 7,
      populationMax: 10,
      idle: 0,
      stock: { food: 0, wood: 200, gold: 100, stone: 0 },
      gatherers: { food: 6, wood: 0, gold: 0, stone: 0 },
      villagers: 6,
    });
  });

  it("ne prend pas pour la population une autre fraction affichée au-dessus (vu en partie, 2026)", () => {
    // Capture du joueur : « 0 » (bouton), « 12/20 » et « 0/7 » au-dessus de « 13/35 ».
    const newHud = [
      token("0", 62, 750, 80, 768),
      token("12/20", 42, 800, 86, 820),
      token("0/7", 152, 800, 180, 820),
      token("13/35", 42, 858, 86, 878),
      token("0", 146, 858, 157, 878),
      token("99", 42, 916, 62, 936),
      token("2", 146, 916, 157, 936),
      token("30", 42, 955, 62, 975),
      token("3", 146, 955, 157, 975),
      token("40", 42, 994, 62, 1014),
      token("3", 146, 994, 157, 1014),
      token("0", 42, 1033, 52, 1053),
      token("0", 146, 1033, 157, 1053),
    ];
    expect(parseHud(newHud)).toEqual({
      population: 13,
      populationMax: 35,
      idle: 0,
      stock: { food: 99, wood: 30, gold: 40, stone: 0 },
      gatherers: { food: 2, wood: 3, gold: 3, stone: 0 },
      villagers: 8,
    });
  });

  it("ne lit jamais les ressources décalées sous la mauvaise fraction (capture du joueur, 0:53)", () => {
    // « 8/10 » et « 0/7 » au-dessus de la population « 9/10 » en orange, idle 0 grisé.
    const hud = (pop: OcrToken | null) =>
      [
        token("0", 62, 750, 80, 768),
        token("8/10", 42, 800, 78, 820),
        token("0/7", 152, 800, 180, 820),
        pop,
        token("0", 146, 858, 157, 878),
        token("124", 42, 916, 72, 936),
        token("6", 146, 914, 157, 934),
        token("150", 42, 955, 72, 975),
        token("1", 146, 953, 155, 973),
        token("100", 42, 994, 72, 1014),
        token("0", 146, 992, 157, 1012),
        token("0", 42, 1033, 52, 1053),
        token("0", 146, 1031, 157, 1051),
      ].filter((t): t is OcrToken => t !== null);
    expect(parseHud(hud(token("9/10", 42, 858, 78, 878)))).toEqual({
      population: 9,
      populationMax: 10,
      idle: 0,
      stock: { food: 124, wood: 150, gold: 100, stone: 0 },
      gatherers: { food: 6, wood: 1, gold: 0, stone: 0 },
      villagers: 7,
    });
    // Population orange mal lue ou pas lue : rien plutôt qu'une lecture décalée sous « 8/10 ».
    expect(parseHud(hud(token("g/10", 42, 858, 78, 878)))).toBeNull();
    expect(parseHud(hud(token("合 9/10", 20, 858, 78, 878)))).toBeNull();
    expect(parseHud(hud(null))).toBeNull();
  });

  it("ignore le panneau de la sélection et les icônes lues comme des chiffres (partie enregistrée, 6:40)", () => {
    // Bâtiment sélectionné : « 1000/1000 » et « 25 » à droite ; icône de la pierre lue « 4e ».
    const frame: OcrToken[] = [
      { text: "0", x: 0.1908, y: 0.2407, w: 0.0347, h: 0.0324 },
      { text: "24/30", x: 0.1156, y: 0.3611, w: 0.1387, h: 0.037 },
      { text: "25/70", x: 0.1156, y: 0.4954, w: 0.1387, h: 0.037 },
      { text: "458", x: 0.1156, y: 0.6296, w: 0.0983, h: 0.037 },
      { text: "153", x: 0.1156, y: 0.7176, w: 0.0925, h: 0.037 },
      { text: "95", x: 0.1156, y: 0.8102, w: 0.0636, h: 0.037 },
      { text: "4e 11", x: 0.0462, y: 0.8981, w: 0.1329, h: 0.0324 },
      { text: "0/7", x: 0.4334, y: 0.3609, w: 0.087, h: 0.0421 },
      { text: "9", x: 0.422, y: 0.625, w: 0.0347, h: 0.0278 },
      { text: "10", x: 0.4104, y: 0.713, w: 0.0694, h: 0.037 },
      { text: "4", x: 0.422, y: 0.8056, w: 0.0347, h: 0.0278 },
      { text: "1000/1000", x: 0.6879, y: 0.6713, w: 0.2543, h: 0.037 },
      { text: "25", x: 0.6936, y: 0.8056, w: 0.0694, h: 0.0324 },
    ];
    expect(parseHud(frame)).toEqual({
      population: 25,
      populationMax: 70,
      idle: 0,
      stock: { food: 458, wood: 153, gold: 95, stone: 11 },
      gatherers: { food: 9, wood: 10, gold: 4, stone: 0 },
      villagers: 23,
    });
    // Le « 1000/1000 » seul, sans le vrai panneau, n'est pas une population.
    expect(parseHud(frame.filter((t) => t.text !== "25/70"))).toBeNull();
  });

  it("lit le panneau sous Windows malgré une ligne de pierre illisible (partie enregistrée, 7:13)", () => {
    // Reconnaissance de Windows : le « 0 » seul du stock de pierre n'est pas lu, ni les « 0 »
    // grisés des villageois. Bâtiment sélectionné à droite (« 7000/7000 », nom du joueur).
    const frame: OcrToken[] = [
      { text: "6/13", x: 0.144, y: 0.36, w: 0.099, h: 0.031 },
      { text: "0/1", x: 0.43, y: 0.36, w: 0.066, h: 0.032 },
      { text: "28/35", x: 0.123, y: 0.495, w: 0.128, h: 0.032 },
      { text: "17", x: 0.422, y: 0.624, w: 0.053, h: 0.029 },
      { text: "270", x: 0.123, y: 0.629, w: 0.083, h: 0.029 },
      { text: "7000/7000", x: 0.693, y: 0.672, w: 0.245, h: 0.03 },
      { text: "c'", x: 0.046, y: 0.72, w: 0.045, h: 0.025 },
      { text: "170", x: 0.123, y: 0.719, w: 0.083, h: 0.029 },
      { text: "41", x: 0.121, y: 0.809, w: 0.051, h: 0.029 },
      { text: "[ODGJ", x: 0.63, y: 0.957, w: 0.142, h: 0.035 },
    ];
    expect(parseHud(frame)).toEqual({
      population: 28,
      populationMax: 35,
      idle: 0,
      stock: { food: 270, wood: 170, gold: 41, stone: 0 },
      gatherers: { food: 17, wood: 0, gold: 0, stone: 0 },
      villagers: 17,
    });
  });

  it("ne prend jamais les points de vie de la sélection pour la population (« 50/50 », Mac)", () => {
    const frame: OcrToken[] = [
      { text: "7/10", x: 0.116, y: 0.361, w: 0.11, h: 0.032 },
      { text: "50/50", x: 0.688, y: 0.671, w: 0.139, h: 0.037 },
      { text: "6", x: 0.694, y: 0.787, w: 0.029, h: 0.032 },
      { text: "5", x: 0.694, y: 0.87, w: 0.029, h: 0.032 },
      { text: "100", x: 0.121, y: 0.81, w: 0.087, h: 0.032 },
    ];
    expect(parseHud(frame)).toBeNull();
  });

  it("compte 0 pour les compteurs grisés que la reconnaissance n'a pas lus", () => {
    const grayZerosMissing = startOfGame.filter((t, i) => !(t.text === "0" && t.x > 0.4) || i === 0);
    const reading = parseHud(grayZerosMissing);
    expect(reading?.gatherers).toEqual({ food: 6, wood: 0, gold: 0, stone: 0 });
    expect(reading?.idle).toBe(0);
  });

  it("accepte un stock et un compteur lus comme un seul texte", () => {
    const merged = [
      token("12/20", 42, 858, 90, 878),
      token("2", 146, 858, 157, 878),
      token("150 7", 42, 916, 157, 936),
      token("85 3", 42, 955, 157, 975),
      token("40 0", 42, 994, 157, 1014),
      token("0", 42, 1033, 52, 1053),
    ];
    expect(parseHud(merged)).toMatchObject({
      idle: 2,
      stock: { food: 150, wood: 85, gold: 40, stone: 0 },
      gatherers: { food: 7, wood: 3, gold: 0, stone: 0 },
      villagers: 10,
    });
  });

  it("corrige un O lu à la place d'un zéro", () => {
    const withLetterO = startOfGame.map((t) => (t.text === "200" ? { ...t, text: "2OO" } : t));
    expect(parseHud(withLetterO)?.stock.wood).toBe(200);
  });

  it("ne compte pas deux fois les inactifs, déjà comptés sur leur ressource (capture réelle à 6:21)", () => {
    const tokens = [
      token("13/20", 42, 858, 90, 878),
      token("9", 146, 858, 157, 878),
      token("900", 42, 916, 72, 936),
      token("6", 146, 916, 157, 936),
      token("310", 42, 955, 72, 975),
      token("3", 146, 955, 157, 975),
      token("100", 42, 994, 72, 1014),
      token("0", 42, 1033, 52, 1053),
    ];
    expect(parseHud(tokens)).toMatchObject({ idle: 9, villagers: 9, gatherers: { food: 6, wood: 3, gold: 0, stone: 0 } });
  });

  it("refuse une lecture incomplète ou incohérente", () => {
    expect(parseHud(startOfGame.filter((t) => t.text !== "7/10"))).toBeNull();
    expect(parseHud(startOfGame.filter((t) => t.text !== "100"))).toBeNull();
    const tooMany = startOfGame.map((t) => (t.text === "6" ? { ...t, text: "60" } : t));
    // 60 villageois pour 7 de population : chiffre mal lu.
    expect(parseHud(tooMany)).toBeNull();
  });
});
