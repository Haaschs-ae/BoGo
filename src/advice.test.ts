import { describe, expect, it } from "vitest";
import { adviseBuild, categoryPicks, distributionMismatch, noAdvice, usableBuild } from "./advice";
import type { BuildOrder } from "./buildOrder";
import type { HudReading } from "./hud";
import { habitLaunch, keptLaunch, launchWeight, parseJournal, serializeJournal, type GameEntry, type Launch } from "./journal";
import type { SavedBuild, Style } from "./library";

const step = (villagers: number, food: number, wood: number) => ({
  population_count: -1,
  villager_count: villagers,
  age: 1,
  resources: { food, wood, gold: 0, stone: 0 },
  notes: [],
});
const bo = (name: string, civ: string, steps = 6): BuildOrder => ({
  name,
  civilization: civ,
  build_order: Array.from({ length: steps }, (_, i) => step(6 + 3 * i, 6 + 2 * i, i)),
});
const saved = (id: string, style: Style = "boom", addedAt = 1, civ = "English"): SavedBuild => ({ id, style, build: bo(id, civ), addedAt });

const DAY = 86_400_000;
const NOW = 400 * DAY;
let gameId = 1;
const game = (launches: Launch[], over: Partial<GameEntry> = {}): GameEntry => ({
  gameId: gameId++,
  at: NOW - DAY,
  kind: "rm_1v1",
  map: "Dry Arabia",
  civ: "English",
  randomCiv: false,
  opponentCiv: "French",
  launches,
  refused: false,
  autoSteps: 0,
  ageUpAt: null,
  ...over,
});
const launch = (buildId: string, clock = 5, how: Launch["how"] = "choice"): Launch => ({ buildId, how, clock });
const duel = { kind: "rm_1v1", civ: "English", randomCiv: false, opponentCiv: "French", map: "Dry Arabia" };

describe("journal", () => {
  it("garde le BO actif à 4:00, ou au premier passage d'âge", () => {
    expect(keptLaunch(game([launch("a"), launch("b", 200), launch("c", 260)]))?.buildId).toBe("b");
    expect(keptLaunch(game([launch("a"), launch("b", 200)], { ageUpAt: 150 }))?.buildId).toBe("a");
    expect(keptLaunch(game([launch("a", 300)]))).toBeNull();
  });

  it("un changement après 1:30 ne compte pas pour l'habitude", () => {
    const changed = game([launch("a"), launch("b", 120)]);
    expect(habitLaunch(changed)?.buildId).toBe("a");
    expect(keptLaunch(changed)?.buildId).toBe("b");
    expect(habitLaunch(game([launch("a", 100)]))?.buildId).toBe("a");
  });

  it("un lancement automatique ne compte que s'il a été suivi", () => {
    const auto = launch("a", 5, "auto");
    expect(launchWeight(game([auto]), auto)).toBe(0);
    expect(launchWeight(game([auto], { autoSteps: 3 }), auto)).toBe(1);
    expect(launchWeight(game([launch("a")]), launch("a"))).toBe(1);
  });

  it("lit le fichier sans jamais tout perdre pour une entrée abîmée", () => {
    expect(parseJournal("")).toEqual([]);
    expect(parseJournal("{")).toEqual([]);
    const read = parseJournal(JSON.stringify([{ gameId: 7, civ: "Rus", launches: [] }, { civ: "Rus" }, null]));
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ gameId: 7, refused: false, autoSteps: 0, ageUpAt: null });
    const many = Array.from({ length: 600 }, () => game([]));
    expect(JSON.parse(serializeJournal(many))).toHaveLength(500);
  });
});

describe("conseil de BO", () => {
  it("rien en Empire Wars ou Nomade, ni sans BO utilisable", () => {
    expect(noAdvice("qm_1v1_ew")).toBe(true);
    expect(noAdvice("rm_1v1")).toBe(false);
    expect(adviseBuild([saved("a")], [], { ...duel, kind: "qm_2v2_ew" }, NOW)).toBeNull();
    expect(usableBuild(bo("court", "English", 4))).toBe(false);
    expect(adviseBuild([{ ...saved("a"), build: bo("a", "English", 4) }], [], duel, NOW)).toBeNull();
    expect(adviseBuild([saved("fr", "boom", 1, "French")], [], duel, NOW)).toBeNull();
  });

  it("sans historique : le plus récent de la bibliothèque, jamais lancé tout seul", () => {
    const advice = adviseBuild([saved("old", "boom", 1), saved("new", "agressif", 2)], [], duel, NOW);
    expect(advice).toMatchObject({ rule: "library", reason: "Le plus récent de ta bibliothèque pour English", autoOff: "BO jamais joué" });
    expect(advice?.build.id).toBe("new");
    expect(adviseBuild([saved("a")], [], duel, NOW)?.reason).toBe("Le seul de ta bibliothèque pour English");
  });

  it("habitude : gardé à 2 parties au moins, dont un choix actif", () => {
    const library = [saved("a", "boom", 1), saved("b", "agressif", 2)];
    const journal = [game([launch("a")]), game([launch("b")], { at: NOW - 2 * DAY }), game([launch("a", 5, "auto")], { autoSteps: 4 })];
    const advice = adviseBuild(library, journal, duel, NOW);
    expect(advice).toMatchObject({ rule: "habit", reason: "Gardé à 2 de tes 3 dernières parties avec English", autoOff: null });
    expect(advice?.build.id).toBe("a");
  });

  it("le lancement automatique ne fait pas une habitude à lui seul", () => {
    const library = [saved("a", "boom", 1), saved("b", "agressif", 2)];
    // En équipe : pas de mémoire contre une civ adverse, seule l'habitude pourrait jouer.
    const team = { opponentCiv: null, kind: "rm_2v2" };
    const autos = [game([launch("a", 5, "auto")], { ...team, autoSteps: 3 }), game([launch("a", 5, "auto")], { ...team, autoSteps: 3 })];
    expect(adviseBuild(library, autos, duel, NOW)).toMatchObject({ rule: "library", reason: "Ton BO le plus gardé avec English (2 parties)" });
    const ignored = [game([launch("a", 5, "auto")], team), game([launch("a", 5, "auto")], team)];
    expect(adviseBuild(library, ignored, duel, NOW)).toMatchObject({ reason: "Le plus récent de ta bibliothèque pour English", autoOff: "BO jamais joué" });
  });

  it("mémoire contre la civ adverse (1v1), même changée après 1:30, pendant 90 jours", () => {
    const library = [saved("a"), saved("b", "agressif")];
    const journal = [
      game([launch("a"), launch("b", 120)], { at: NOW - DAY }),
      game([launch("a")], { at: NOW - 2 * DAY, opponentCiv: "Mongols" }),
      game([launch("a")], { at: NOW - 3 * DAY, opponentCiv: "Rus" }),
    ];
    const advice = adviseBuild(library, journal, duel, NOW);
    expect(advice).toMatchObject({ rule: "memory", reason: "Gardé la dernière fois contre French" });
    expect(advice?.build.id).toBe("b");
    expect(adviseBuild(library, journal, { ...duel, kind: "rm_2v2", opponentCiv: null }, NOW)?.build.id).toBe("a");
    expect(adviseBuild(library, journal, duel, NOW + 91 * DAY)?.rule).toBe("habit");
  });

  it("les parties personnalisées ne nourrissent pas le conseil des parties classées", () => {
    const library = [saved("a", "boom", 1), saved("b", "agressif", 2)];
    const custom = [game([launch("a")], { kind: "custom" }), game([launch("a")], { kind: "custom" })];
    expect(adviseBuild(library, custom, duel, NOW)?.rule).toBe("library");
    expect(adviseBuild(library, custom, { ...duel, kind: "custom" }, NOW)).toMatchObject({ rule: "habit", autoOff: "partie personnalisée" });
  });

  it("garde-fous du lancement automatique", () => {
    const library = [saved("a")];
    const played = [game([launch("a")]), game([launch("a")])];
    expect(adviseBuild(library, played, { ...duel, kind: "rm_2v2", opponentCiv: null }, NOW)?.autoOff).toBe("partie en équipe");
    expect(adviseBuild(library, played, duel, NOW)?.autoOff).toBeNull();
    const refused = played.map((e) => ({ ...e, refused: true }));
    expect(adviseBuild(library, refused, duel, NOW)?.autoOff).toBe("annulé les 2 dernières fois");
  });

  it("tes matchups passent avant ce que BoGo déduit, et peuvent partir tout seuls", () => {
    const library = [saved("a", "boom", 1), saved("b", "agressif", 2), { ...saved("short"), build: bo("short", "English", 3) }];
    const habitual = [game([launch("a")]), game([launch("a")])];
    const matchups = {
      base: { English: "b" },
      rules: [{ id: "r", civ: "English", opponent: "French", map: "Dry Arabia", buildId: "short" }],
    };
    // Règle complète : même un BO court (choix explicite), lancé tout seul même jamais joué.
    expect(adviseBuild(library, habitual, duel, NOW, matchups)).toMatchObject({
      rule: "matchups",
      reason: "Tes matchups : contre French sur Dry Arabia",
      autoOff: null,
    });
    // Sinon le BO de base, avant l'habitude.
    const base = adviseBuild(library, habitual, { ...duel, map: "Lipany" }, NOW, matchups);
    expect(base).toMatchObject({ rule: "matchups", reason: "📌 Ton BO de base avec English" });
    expect(base?.build.id).toBe("b");
    // Carte et civ adverse se contredisent : la carte gagne, l'autre BO est proposé, pas de lancement auto.
    const conflicting = {
      base: {},
      rules: [
        { id: "m", civ: "English", opponent: null, map: "Migration", buildId: "a" },
        { id: "o", civ: "English", opponent: "French", map: null, buildId: "b" },
      ],
    };
    const both = adviseBuild(library, habitual, { ...duel, map: "Migration" }, NOW, conflicting);
    expect(both).toMatchObject({ reason: "Tes matchups : sur Migration", autoOff: "2 règles de tes matchups s'appliquent", also: { rule: "contre French" } });
    expect(both?.also?.build.id).toBe("b");
    // Les garde-fous restent : jamais tout seul en équipe.
    expect(adviseBuild(library, habitual, { ...duel, kind: "rm_2v2", opponentCiv: null }, NOW, matchups)?.autoOff).toBe("partie en équipe");
  });

  it("civ aléatoire dite dans la raison", () => {
    expect(adviseBuild([saved("a")], [], { ...duel, randomCiv: true }, NOW)?.reason).toBe("Civ aléatoire · Le seul de ta bibliothèque pour English");
  });

  it("un BO par catégorie pour les raccourcis 1 à 4", () => {
    const library = [saved("a", "boom", 1), saved("b", "boom", 2), saved("c", "fast-castle", 3), saved("fr", "agressif", 4, "French")];
    const picks = categoryPicks(library, [game([launch("a")])], duel);
    expect(picks.boom?.id).toBe("a");
    expect(picks["fast-castle"]?.id).toBe("c");
    expect(picks.agressif).toBeNull();
    expect(picks.autre).toBeNull();
  });

  it("répartition à l'écran trop éloignée du BO : pas de lancement tout seul", () => {
    const reading = (food: number, wood: number): HudReading => ({
      population: 7,
      populationMax: 10,
      idle: 0,
      stock: { food: 0, wood: 0, gold: 0, stone: 0 },
      gatherers: { food, wood, gold: 0, stone: 0 },
      villagers: food + wood,
    });
    expect(distributionMismatch(bo("a", "English"), reading(6, 0))).toBe(false);
    expect(distributionMismatch(bo("a", "English"), reading(0, 6))).toBe(true);
  });
});
