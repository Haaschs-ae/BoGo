import { describe, expect, it } from "vitest";
import { extractProfileId, kindLabel, opposition, parseLastGame, soloOpponent } from "./aoe4world";
import { civilizationId } from "./civs";

function player(profile_id: number, civilization: string) {
  return { profile_id, civilization, name: `p${profile_id}` };
}

const game = {
  game_id: 42,
  started_at: "2026-10-29T10:00:00.000Z",
  map: "Dry Arabia",
  kind: "rm_2v2",
  ongoing: true,
  filters: { profile_ids: [5612909, 777] },
  teams: [
    [player(1, "english"), player(2, "zhu_xis_legacy")],
    [player(3, "french"), player(777, "knights_templar")],
  ],
};

describe("parseLastGame", () => {
  it("trouve la civ du joueur (ou d'un de ses comptes liés) et celles des adversaires", () => {
    expect(parseLastGame(game, "5612909")).toEqual({
      id: 42,
      ongoing: true,
      kind: "rm_2v2",
      map: "Dry Arabia",
      startedAt: "2026-10-29T10:00:00.000Z",
      myCivilization: "Knights Templar",
      randomCiv: false,
      opponentCivilizations: ["English", "Zhu Xi's Legacy"],
      oneVsOne: false,
      players: 4,
    });
  });

  it("ne donne la civ adverse qu'en 1v1 (à plusieurs, BoGo ignore les adversaires)", () => {
    const duel = parseLastGame({ ...game, kind: "rm_1v1", teams: [[player(5612909, "rus")], [player(9, "french")]] }, "5612909");
    expect(duel?.oneVsOne).toBe(true);
    expect(soloOpponent(duel!)).toBe("French");
    expect(soloOpponent(parseLastGame(game, "5612909")!)).toBeNull();
    const ffa = parseLastGame({ ...game, kind: "custom", teams: [[player(5612909, "rus")], [player(8, "french")], [player(9, "mongols")]] }, "5612909");
    expect(soloOpponent(ffa!)).toBeNull();
  });

  it("en personnalisée, AoE4World omet les IA : jamais de civ adverse, et IA si personne en face", () => {
    // Moi + une IA contre un joueur + une IA : AoE4World ne montre que les deux humains.
    const mixed = parseLastGame({ ...game, kind: "custom", teams: [[player(5612909, "rus")], [player(9, "french")]] }, "5612909");
    expect(mixed?.oneVsOne).toBe(true);
    expect(soloOpponent(mixed!)).toBeNull();
    expect(opposition(mixed!)).toBe("humans");
    const vsAi = parseLastGame({ ...game, kind: "custom", teams: [[player(5612909, "rus")]] }, "5612909");
    expect(opposition(vsAi!)).toBe("ai");
    // Classée ou rapide : toujours des humains, même si la liste est incomplète.
    expect(opposition(parseLastGame({ ...game, kind: "qm_1v1", teams: [[player(5612909, "rus")]] }, "5612909")!)).toBe("humans");
    expect(opposition(parseLastGame(game, "5612909")!)).toBe("humans");
  });

  it("repère une civ tirée au sort", () => {
    const random = { ...player(5612909, "rus"), civilization_randomized: true };
    const parsed = parseLastGame({ ...game, kind: "rm_1v1", teams: [[random], [player(9, "french")]] }, "5612909");
    expect(parsed?.myCivilization).toBe("Rus");
    expect(parsed?.randomCiv).toBe(true);
  });

  it("accepte les joueurs rangés sous une clé « player »", () => {
    const wrapped = { ...game, filters: undefined, teams: [[{ player: player(5612909, "rus") }], [{ player: player(9, "mongols") }]] };
    const parsed = parseLastGame(wrapped, "5612909");
    expect(parsed?.myCivilization).toBe("Rus");
    expect(parsed?.opponentCivilizations).toEqual(["Mongols"]);
  });

  it("met en forme une civ inconnue au lieu d'échouer", () => {
    const parsed = parseLastGame({ ...game, teams: [[player(5612909, "new_dlc_civ")], [player(9, "rus")]] }, "5612909");
    expect(parsed?.myCivilization).toBe("New Dlc Civ");
  });

  it("renvoie null si le joueur n'est pas dans la partie ou si la réponse est inattendue", () => {
    expect(parseLastGame({ ...game, filters: undefined }, "5612909")).toBeNull();
    expect(parseLastGame({ error: "Not found" }, "5612909")).toBeNull();
    expect(parseLastGame(null, "5612909")).toBeNull();
  });
});

describe("extractProfileId", () => {
  it("lit un lien de profil ou un numéro", () => {
    expect(extractProfileId("https://aoe4world.com/players/5612909")).toBe("5612909");
    expect(extractProfileId("aoe4world.com/players/5612909-Haaschs/games")).toBe("5612909");
    expect(extractProfileId(" 5612909 ")).toBe("5612909");
    expect(extractProfileId("Haaschs")).toBeNull();
  });
});

it("kindLabel traduit le type de partie", () => {
  expect(kindLabel("rm_1v1")).toBe("Classée 1v1");
  expect(kindLabel("qm_4v4")).toBe("Partie rapide 4v4");
  expect(kindLabel("custom")).toBe("Personnalisée");
  expect(kindLabel("qm_2v2_ew")).toBe("Partie rapide 2v2 Empire Wars");
  expect(kindLabel("qm_ffa_nomad")).toBe("Partie rapide chacun pour soi Nomade");
});

it("civilizationId retrouve l'identifiant AoE4World d'un nom de civ", () => {
  expect(civilizationId("Knights Templar")).toBe("knights_templar");
  expect(civilizationId("zhu xi's legacy")).toBe("zhu_xis_legacy");
  expect(civilizationId("Atlantes")).toBeNull();
});
