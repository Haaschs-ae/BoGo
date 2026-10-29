import { describe, expect, it } from "vitest";
import { decodeEntities, imageLabel, parseBuildOrder, parseTime, tokenizeNote } from "./buildOrder";

const step = {
  population_count: -1,
  villager_count: 6,
  age: 1,
  resources: { food: 6, wood: 0, gold: 0, stone: 0, builder: 0 },
  notes: ["6 @unit_worker/villager.webp@ sur les @resource/sheep.webp@"],
  time: "0:00",
};

describe("parseBuildOrder", () => {
  it("accepte un BO au format RTS_Overlay, en objet ou en texte", () => {
    const data = { name: "Fast 2 TC", civilization: "Knights Templar", author: "x", build_order: [step] };
    expect(parseBuildOrder(data).build_order[0].villager_count).toBe(6);
    expect(parseBuildOrder(JSON.stringify(data)).name).toBe("Fast 2 TC");
  });

  it("accepte plusieurs civilisations", () => {
    const bo = parseBuildOrder({ name: "x", civilization: ["English", "French"], build_order: [step] });
    expect(bo.civilization).toEqual(["English", "French"]);
  });

  it("ignore un temps mal formé au lieu de rejeter le BO", () => {
    const bo = parseBuildOrder({ name: "x", civilization: "Rus", build_order: [{ ...step, time: "bientôt" }] });
    expect(bo.build_order[0].time).toBeUndefined();
  });

  it("rejette les BO invalides avec un message lisible", () => {
    expect(() => parseBuildOrder("pas du json")).toThrow("JSON valide");
    expect(() => parseBuildOrder({ name: "x", build_order: [step] })).toThrow("Civilisation");
    expect(() => parseBuildOrder({ name: "x", civilization: "Rus", build_order: [] })).toThrow("aucune étape");
    const badStep = { ...step, resources: { ...step.resources, wood: "3" } };
    expect(() => parseBuildOrder({ name: "x", civilization: "Rus", build_order: [badStep] })).toThrow("Étape 1 : bois");
  });
});

describe("parseTime", () => {
  it("convertit m:ss en secondes", () => {
    expect(parseTime("0:00")).toBe(0);
    expect(parseTime("2:05")).toBe(125);
    expect(parseTime("12:30")).toBe(750);
  });

  it("refuse les formats invalides", () => {
    expect(parseTime("2:5")).toBeNull();
    expect(parseTime("2:75")).toBeNull();
    expect(parseTime("abc")).toBeNull();
  });
});

describe("tokenizeNote", () => {
  it("sépare le texte et les images", () => {
    expect(tokenizeNote("6 @resource/sheep.webp@ puis bois")).toEqual([
      { kind: "text", text: "6 " },
      { kind: "image", path: "resource/sheep.webp" },
      { kind: "text", text: " puis bois" },
    ]);
  });

  it("garde un @ qui n'entoure pas une image", () => {
    expect(tokenizeNote("rdv @maison@ ok")).toEqual([{ kind: "text", text: "rdv @maison@ ok" }]);
  });
});

it("imageLabel donne un nom lisible", () => {
  expect(imageLabel("building_economy/mining_camp.webp")).toBe("mining camp");
  expect(imageLabel("unit_cavalry/horseman-1.webp")).toBe("horseman");
});

it("décode les caractères encodés par aoe4guides (vu en partie : « 5 -&gt; »)", () => {
  expect(decodeEntities("5 -&gt; pierre &amp; or, &#39;ok&#39;")).toBe("5 -> pierre & or, 'ok'");
  expect(tokenizeNote("5 -&gt; @resource/stone.webp@")).toEqual([
    { kind: "text", text: "5 -> " },
    { kind: "image", path: "resource/stone.webp" },
  ]);
});
