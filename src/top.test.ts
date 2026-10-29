import { expect, it } from "vitest";
import { ageUpBuilders, LandmarkWatch } from "./top";

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

it("LandmarkWatch : un passage d'âge signalé une fois, même avec des lectures ratées pendant la construction", () => {
  const building = [token("2", 1036, 100, 1050, 122), token("03:48", 936, 148, 986, 172)];
  const clockOnly = [token("03:50", 936, 102, 986, 126)];
  const watch = new LandmarkWatch();
  expect(watch.observe(building, 0)).toBe(false); // une lecture : pas encore
  expect(watch.observe(building, 1000)).toBe(true); // deux de suite : passage d'âge
  expect(watch.observe(clockOnly, 2000)).toBe(false); // lecture ratée
  expect(watch.observe(building, 3000)).toBe(false);
  expect(watch.observe(building, 4000)).toBe(false); // pas de second signalement (âge sauté)
  // Landmark fini (plus de compteur pendant 15 s) : le prochain passage d'âge sera signalé.
  for (let t = 5000; t <= 21000; t += 1000) watch.observe(clockOnly, t);
  watch.observe(building, 200000);
  expect(watch.observe(building, 201000)).toBe(true);
});
