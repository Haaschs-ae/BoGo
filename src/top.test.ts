import { expect, it } from "vitest";
import { ageUpBuilders } from "./top";

// Zone lue en haut au centre (x 35–65 %, y 0–25 % d'un écran 1920×1080), positions de captures réelles.
function token(text: string, x1: number, y1: number, x2: number, y2: number) {
  const left = 672;
  const W = 576;
  const H = 270;
  return { text, x: (x1 - left) / W, y: y1 / H, w: (x2 - x1) / W, h: (y2 - y1) / H };
}

it("repère un landmark en construction au-dessus de l'horloge (capture à 3:48)", () => {
  expect(ageUpBuilders([token("2", 1036, 100, 1050, 122), token("03:48", 936, 148, 986, 172)])).toBe(2);
});

it("ignore l'indicateur d'âge seul (capture à 0:13)", () => {
  expect(ageUpBuilders([token("I", 955, 36, 965, 60), token("00:13", 936, 102, 986, 126)])).toBeNull();
  expect(ageUpBuilders([])).toBeNull();
});
