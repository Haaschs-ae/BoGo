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
