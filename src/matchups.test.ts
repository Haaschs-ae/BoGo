import { describe, expect, it } from "vitest";
import {
  dedupeRules,
  emptyMatchups,
  forgetBuild,
  loadMatchups,
  mapKey,
  matchupPick,
  matchupReason,
  saveMatchups,
  type MatchupRule,
  type Matchups,
} from "./matchups";

const rule = (id: string, opponent: string | null, map: string | null, buildId: string, civ = "English"): MatchupRule => ({
  id,
  civ,
  opponent,
  map,
  buildId,
});
const matchups: Matchups = {
  base: { English: "base" },
  rules: [
    rule("r1", "French", null, "anti-cav"),
    rule("r2", null, "Migration", "naval"),
    rule("r3", "French", "Dry Arabia", "exact"),
    rule("r4", "Mongols", null, "missing"),
  ],
};
const duel = (opponentCiv: string | null, map: string, kind = "rm_1v1") => ({ kind, civ: "English", opponentCiv, map });
const all = () => true;

describe("mes matchups", () => {
  it("la règle la plus précise gagne, puis le BO de base", () => {
    expect(matchupPick(matchups, duel("French", "Dry Arabia"), all)).toMatchObject({ buildId: "exact", match: "exact" });
    expect(matchupPick(matchups, duel("French", "Lipany"), all)).toMatchObject({ buildId: "anti-cav", match: "opponent" });
    expect(matchupPick(matchups, duel("Rus", "Migration"), all)).toMatchObject({ buildId: "naval", match: "map" });
    // Carte d'eau contre French : la carte passe avant la civ adverse, et le conflit est signalé.
    expect(matchupPick(matchups, duel("French", "Migration"), all)).toMatchObject({
      buildId: "naval",
      match: "map",
      conflict: { id: "r1", buildId: "anti-cav" },
    });
    expect(matchupPick(matchups, duel("Rus", "Migration"), all)?.conflict).toBeNull();
    expect(matchupPick(matchups, duel("Rus", "Lipany"), all)).toMatchObject({ buildId: "base", match: "base", rule: null });
  });

  it("compare les cartes sans casse, accents ni anciens noms", () => {
    expect(mapKey(" Hill & Dale ")).toBe(mapKey("hill and dale"));
    expect(mapKey("Watering Holes")).toBe(mapKey("Waterholes"));
    expect(matchupPick(matchups, duel("French", "dry arabia"), all)?.buildId).toBe("exact");
  });

  it("ignore une règle dont le BO n'est plus jouable", () => {
    const playable = (id: string) => id !== "missing";
    expect(matchupPick(matchups, duel("Mongols", "Lipany"), playable)?.buildId).toBe("base");
    expect(matchupPick({ base: { English: "missing" }, rules: [] }, duel(null, "Lipany"), playable)).toBeNull();
  });

  it("en équipe, seulement le BO de base ; sans civ adverse connue, pas de règle d'adversaire", () => {
    expect(matchupPick(matchups, duel(null, "Migration", "rm_2v2"), all)?.match).toBe("base");
    expect(matchupPick(matchups, duel(null, "Dry Arabia", "custom"), all)?.match).toBe("base");
    expect(matchupPick(matchups, duel(null, "Migration", "custom"), all)?.match).toBe("map");
    // Personnalisée à plusieurs (deux humains listés en face) : comme en équipe.
    expect(matchupPick(matchups, { ...duel(null, "Migration", "custom"), team: true }, all)?.match).toBe("base");
    expect(matchupPick(matchups, { ...duel("French", "Lipany"), civ: "Rus" }, all)).toBeNull();
  });

  it("dit pourquoi, en une ligne", () => {
    const game = duel("French", "Dry Arabia");
    expect(matchupReason(matchupPick(matchups, game, all)!, game)).toBe("Tes matchups : contre French sur Dry Arabia");
    expect(matchupReason(matchupPick(matchups, duel("Rus", "Lipany"), all)!, game)).toBe("📌 Ton BO de base avec English");
  });

  it("se lit et s'écrit sans jamais casser, et oublie un BO supprimé", () => {
    const memory = new Map<string, string>();
    const store = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
    expect(loadMatchups(store)).toEqual(emptyMatchups());
    saveMatchups(store, matchups);
    expect(loadMatchups(store)).toEqual(matchups);
    memory.set("bogo.matchups.v1", "{abîmé");
    expect(loadMatchups(store)).toEqual(emptyMatchups());
    const cleaned = forgetBuild(matchups, "base");
    expect(cleaned.base).toEqual({});
    expect(forgetBuild(matchups, "naval").rules.map((r) => r.id)).toEqual(["r1", "r3", "r4"]);
  });

  it("un champ abîmé ne fait pas perdre les règles ; une règle vide est écartée ; la plus récente gagne", () => {
    const memory = new Map<string, string>();
    const store = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };
    memory.set("bogo.matchups.v1", JSON.stringify({ base: null, rules: [rule("x", "French", null, "anti-cav"), rule("vide", null, null, "naval")] }));
    expect(loadMatchups(store).rules.map((r) => r.id)).toEqual(["x"]);
    const twice = [rule("old", "French", "High View", "a"), rule("new", "french", "Highview", "b")];
    expect(dedupeRules(twice).map((r) => r.id)).toEqual(["new"]);
    expect(mapKey("High View")).toBe(mapKey("high-view"));
    expect(matchupPick({ base: {}, rules: twice }, duel("French", "Highview"), all)?.buildId).toBe("b");
  });
});
