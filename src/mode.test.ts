import { describe, expect, it } from "vitest";
import type { DetectedGame } from "./aoe4world";
import type { EngineState } from "./engine";
import type { HudReading } from "./hud";
import {
  aoe4worldSeen,
  arm,
  clockRead,
  currentMode,
  decideMode,
  FEATURES,
  freshGame,
  freshMemory,
  HUMANS_NOTICE,
  NEW_GAME_NOTICE,
  projectLive,
  type ModeInput,
} from "./mode";

const NOW = Date.parse("2026-10-29T16:00:00Z");
const game = (kind: string, opponents: string[], startedSecondsAgo = 100, ongoing = true): DetectedGame => ({
  id: 1,
  ongoing,
  kind,
  map: "Dry Arabia",
  startedAt: new Date(NOW - startedSecondsAgo * 1000).toISOString(),
  myCivilization: "English",
  randomCiv: false,
  opponentCivilizations: opponents,
  oneVsOne: opponents.length === 1,
  players: opponents.length + 1,
});
const input = (over: Partial<ModeInput>): ModeInput => ({
  armed: true,
  humansLocked: false,
  game: null,
  fresh: false,
  profileSet: true,
  inGame: true,
  ...over,
});

describe("mode : Versus par défaut, IA sur ton choix dès 0:00", () => {
  it("Versus sans choix, et dès qu'un humain est vu", () => {
    expect(decideMode(input({ armed: false })).mode).toBe("versus");
    expect(decideMode(input({ game: game("rm_1v1", ["French"]) }))).toEqual({ mode: "versus", why: "humans" });
    expect(decideMode(input({ game: game("qm_4v4_ew", []) })).why).toBe("humans");
    expect(decideMode(input({ game: game("custom", ["French"]), fresh: true })).why).toBe("humans");
    expect(decideMode(input({ humansLocked: true })).why).toBe("humans");
    expect(decideMode(input({ profileSet: false })).why).toBe("unverifiable");
  });

  it("IA choisie : coaching dès la première seconde de la partie, jamais dans les menus", () => {
    expect(decideMode(input({}))).toEqual({ mode: "training", why: "armed" });
    // AoE4World montre encore la partie d'avant, finie : rien n'empêche le coaching.
    expect(decideMode(input({ game: game("rm_1v1", ["French"], 1500, false) })).mode).toBe("training");
    expect(decideMode(input({ game: game("custom", []), fresh: true })).mode).toBe("training");
    expect(decideMode(input({ inGame: false }))).toEqual({ mode: "versus", why: "waiting" });
  });

  it("une partie AoE4World n'est « la partie en cours » que si son début colle à l'horloge", () => {
    expect(freshGame(game("custom", [], 100), 40, NOW)).toBe(true);
    expect(freshGame(game("custom", [], 1500), 40, NOW)).toBe(false);
    expect(freshGame(game("custom", [], 100), null, NOW)).toBe(false);
    expect(freshGame(game("custom", [], 100, false), 40, NOW)).toBe(false);
  });
});

describe("ce que la vue peut lire de la partie", () => {
  const hud: HudReading = {
    population: 10,
    populationMax: 20,
    idle: 2,
    stock: { food: 400, wood: 0, gold: 200, stone: 0 },
    gatherers: { food: 9, wood: 1, gold: 0, stone: 0 },
    villagers: 10,
  };
  const engine = {
    index: 1,
    goal: { kind: "villagers" },
    cost: null,
    affordable: true,
    villagers: 10,
    misplacement: { from: "food", to: "wood", count: 2, excess: 3 },
    drift: 4,
    completed: false,
  } as EngineState;

  it("en Versus : les comptes, sans conseil ; l'étape reste", () => {
    const live = projectLive(FEATURES.versus, hud, engine);
    // Comptes en direct (ce que le jeu affiche), sans conseil qui décide à ta place.
    expect(live.hud).toBe(hud);
    expect(live.engine).toMatchObject({ index: 1, misplacement: null, drift: 0, affordable: false, villagers: 10 });
  });

  it("en Entraînement : tout", () => {
    expect(projectLive(FEATURES.training, hud, engine)).toEqual({ hud, engine });
  });

  it("le Versus coupe tout conseil qui décide à ta place", () => {
    const { liveCounts, ...advice } = FEATURES.versus;
    expect(liveCounts).toBe(true);
    expect(Object.values(advice).every((on) => on === false)).toBe(true);
    expect(Object.values(FEATURES.training).every((on) => on === true)).toBe(true);
  });
});

describe("cycle de vie du choix « IA »", () => {
  // Une partie : l'horloge avance d'une seconde par seconde à partir de `start` (ms).
  const tick = (m: ReturnType<typeof freshMemory>, from: number, to: number, start: number) => {
    let memory = m;
    let notice: string | null = null;
    for (let t = from; t <= to; t++) {
      const r = clockRead(memory, t, start + t * 1000);
      memory = r.memory;
      notice = r.notice ?? notice;
    }
    return { memory, notice };
  };
  const finished = game("rm_1v1", ["French"], 3000, false);

  it("IA choisi dans les menus : vaut dès 0:00 de la partie suivante, puis tombe à la suivante", () => {
    // Une classée finie (25:00), puis IA choisi dans les menus.
    let { memory } = tick(freshMemory(), 1490, 1500, NOW - 600_000);
    memory = arm(memory, true, NOW);
    expect(currentMode(memory, finished, null, true, NOW).why).toBe("waiting");
    // L'escarmouche commence : coaching dès les premières secondes.
    const start = NOW + 30_000;
    ({ memory } = tick(memory, 1, 3, start));
    expect(memory.armed).toBe(true);
    expect(currentMode(memory, finished, 3, true, start + 3_000)).toEqual({ mode: "training", why: "armed" });
    // Partie suivante (l'horloge repart en arrière) : retour en VS, avec un mot.
    ({ memory } = tick(memory, 4, 900, start));
    const next = start + 2_000_000;
    const r = clockRead(memory, 3, next);
    expect(r.memory.armed).toBe(false);
    expect(r.notice).toBe(NEW_GAME_NOTICE);
    expect(currentMode(r.memory, finished, 3, true, next).mode).toBe("versus");
  });

  it("IA choisi, puis une classée lancée : VS et verrou dès qu'AoE4World la voit", () => {
    let memory = arm(freshMemory(), true, NOW);
    const start = NOW + 10_000;
    ({ memory } = tick(memory, 1, 40, start));
    const ranked = { ...game("rm_1v1", ["French"]), startedAt: new Date(start - 20_000).toISOString() };
    const seen = aoe4worldSeen(memory, ranked, 41, start + 41_000, true);
    expect(seen.notice).toBe(HUMANS_NOTICE);
    expect(seen.memory).toMatchObject({ armed: false, humansLocked: true });
    expect(currentMode(seen.memory, null, 41, true, start + 41_000)).toEqual({ mode: "versus", why: "humans" });
  });

  it("IA actif puis joueur vu en face : retour en VS avec un mot", () => {
    const start = NOW;
    let memory = arm(freshMemory(), true, start);
    ({ memory } = tick(memory, 1, 70, start));
    const custom = { ...game("custom", ["French"]), startedAt: new Date(start - 10_000).toISOString() };
    const seen = aoe4worldSeen(memory, custom, 70, start + 70_000, true);
    expect(seen.notice).toBe(HUMANS_NOTICE);
    expect(seen.memory.armed).toBe(false);
  });

  it("une classée d'avant encore « en cours » impose VS sans retirer le choix", () => {
    let memory = arm(freshMemory(), true, NOW);
    const stale = game("rm_1v1", ["French"], 3000, true);
    memory = aoe4worldSeen(memory, stale, null, NOW + 5_000, false).memory;
    expect(memory.armed).toBe(true);
    expect(currentMode(memory, stale, null, true, NOW + 5_000).why).toBe("humans");
  });

  it("une partie IA finie ne laisse rien pour la suivante", () => {
    const start = NOW;
    let memory = arm(freshMemory(), true, start);
    ({ memory } = tick(memory, 1, 70, start));
    expect(currentMode(memory, finished, 70, true, start + 70_000).mode).toBe("training");
    // Trois minutes sans horloge : la partie est finie, le choix tombe.
    memory = aoe4worldSeen(memory, finished, null, start + 250_000, false).memory;
    expect(memory.armed).toBe(false);
  });

  it("un choix « IA » oublié dans les menus tombe après 15 min", () => {
    let memory = arm(freshMemory(), true, NOW);
    memory = aoe4worldSeen(memory, finished, null, NOW + 16 * 60_000, false).memory;
    expect(memory.armed).toBe(false);
  });
});
