import { describe, expect, it } from "vitest";
import type { BuildOrder } from "./buildOrder";
import { formatReplay, parseRecording, replay } from "./replay";

// Panneau en bas à gauche, mêmes positions que les captures de calibrage (voir hud.test.ts).
function hudTokens(pop: string, idle: number, stock: number[], gatherers: number[]) {
  const t = (text: string | number, x1: number, y1: number, x2: number, y2: number) => ({
    text: String(text), x: x1 / 345.6, y: (y1 - 648) / 432, w: (x2 - x1) / 345.6, h: (y2 - y1) / 432,
  });
  return [
    t(pop, 42, 858, 90, 878), t(idle, 146, 858, 157, 878),
    t(stock[0], 42, 916, 72, 936), t(gatherers[0], 146, 916, 157, 936),
    t(stock[1], 42, 955, 72, 975), t(gatherers[1], 146, 955, 157, 975),
    t(stock[2], 42, 994, 72, 1014), t(gatherers[2], 146, 994, 157, 1014),
    t(stock[3], 42, 1033, 72, 1053), t(gatherers[3], 146, 1033, 157, 1053),
  ];
}

const build: BuildOrder = {
  name: "Test 6 moutons, 3 bois",
  civilization: "English",
  build_order: [
    { population_count: -1, villager_count: 6, age: 1, resources: { food: 6, wood: 0, gold: 0, stone: 0 }, notes: ["6 sur les moutons"] },
    { population_count: -1, villager_count: 9, age: 1, resources: { food: 6, wood: 3, gold: 0, stone: 0 }, notes: ["3 au bois"] },
    { population_count: -1, villager_count: 12, age: 1, resources: { food: 6, wood: 3, gold: 3, stone: 0 }, notes: ["3 à l'or"] },
  ],
};

describe("rejeu d'une partie enregistrée", () => {
  it("repasse les lectures dans le moteur et raconte les changements d'étape", () => {
    const lines: string[] = [JSON.stringify({ t: 1000, event: { type: "bo", id: "x", build } })];
    let t = 2000;
    const push = (event: object, times = 2) => {
      for (let i = 0; i < times; i++, t += 1000) lines.push(JSON.stringify({ t, event }));
    };
    push({ type: "clock", seconds: 5, text: "00:05" }, 1);
    push({ type: "hud", tokens: hudTokens("7/10", 0, [50, 200, 100, 0], [6, 0, 0, 0]) }, 6);
    // Le 7e villageois va au bois : étape 2 après 5 s.
    push({ type: "hud", tokens: hudTokens("8/10", 0, [50, 200, 100, 0], [6, 1, 0, 0]) }, 6);
    lines.push("ligne coupée {");
    const entries = replay(parseRecording(lines.join("\n")));
    const text = formatReplay(entries);
    expect(text).toContain("BO lancé : Test 6 moutons, 3 bois");
    expect(text).toContain("Étape 1 → 2");
    expect(entries.every((e) => e.t >= 0)).toBe(true);
  });

  // Rejouer un vrai fichier : REPLAY=/chemin/partie-123.jsonl npx vitest run src/replay.test.ts
  // (Node n'est pas déclaré dans ce projet d'interface : accès à process et fs sans types.)
  const file = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.REPLAY;
  it.runIf(!!file)("rejoue le fichier REPLAY", async () => {
    const fs = await import(/* @vite-ignore */ `node:${"fs"}`);
    const entries = replay(parseRecording(fs.readFileSync(file, "utf8")));
    console.log(formatReplay(entries));
    expect(entries.length).toBeGreaterThan(0);
  });
});
