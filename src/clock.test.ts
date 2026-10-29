import { describe, expect, it } from "vitest";
import type { BuildOrderStep } from "./buildOrder";
import { ClockTracker, formatClock, stepForClock } from "./clock";

describe("ClockTracker", () => {
  it("retient une suite de lectures cohérentes", () => {
    const clock = new ClockTracker();
    expect(clock.read(10, 0)).toBe(10);
    expect(clock.read(11, 1000)).toBe(11);
    expect(clock.read(12, 2000)).toBe(12);
  });

  it("ignore une lecture isolée aberrante (chiffre mal lu)", () => {
    const clock = new ClockTracker();
    clock.read(10, 0);
    expect(clock.read(70, 1000)).toBeNull();
    expect(clock.read(12, 2000)).toBe(12);
  });

  it("accepte un saut confirmé par deux lectures (nouvelle partie)", () => {
    const clock = new ClockTracker();
    clock.read(600, 0);
    expect(clock.read(0, 1000)).toBeNull();
    expect(clock.read(1, 2000)).toBe(1);
  });

  it("suit une partie en pause", () => {
    const clock = new ClockTracker();
    clock.read(100, 0);
    clock.read(100, 1000);
    for (let t = 2000; t <= 6000; t += 1000) clock.read(100, t);
    expect(clock.current(6000)).toBe(100);
  });

  it("oublie l'heure si plus rien n'est lu", () => {
    const clock = new ClockTracker();
    clock.read(30, 0);
    expect(clock.current(4000)).toBe(30);
    expect(clock.current(6000)).toBeNull();
  });
});

function step(time?: string): BuildOrderStep {
  return {
    population_count: -1,
    villager_count: -1,
    age: 1,
    resources: { food: 0, wood: 0, gold: 0, stone: 0 },
    notes: [],
    time,
  };
}

describe("stepForClock", () => {
  const steps = [step("0:00"), step("0:40"), step("1:30")];

  it("choisit la dernière étape dont le temps est atteint", () => {
    expect(stepForClock(steps, 0)).toBe(0);
    expect(stepForClock(steps, 39)).toBe(0);
    expect(stepForClock(steps, 40)).toBe(1);
    expect(stepForClock(steps, 600)).toBe(2);
  });

  it("renvoie null si une étape n'a pas de temps", () => {
    expect(stepForClock([step("0:00"), step()], 30)).toBeNull();
  });
});

it("formatClock", () => {
  expect(formatClock(125)).toBe("2:05");
  expect(formatClock(0)).toBe("0:00");
});
