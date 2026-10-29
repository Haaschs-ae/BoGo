import { describe, expect, it } from "vitest";
import { extractBuildId } from "./aoe4guides";
import type { BuildOrder } from "./buildOrder";
import { addBuild, filterBuilds, loadLibrary, removeBuild, saveLibrary } from "./library";

function bo(name: string, civilization: string | string[]): BuildOrder {
  return { name, civilization, build_order: [] };
}

function memoryStore() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe("bibliothèque", () => {
  it("filtre par civ et par style, en gardant les BO « any »", () => {
    let lib = addBuild([], bo("Boom anglais", "English"), "boom");
    lib = addBuild(lib, bo("Rush français", "French"), "agressif");
    lib = addBuild(lib, bo("Générique", "any"), "boom");

    expect(filterBuilds(lib, "English", "").map((b) => b.build.name)).toEqual(["Boom anglais", "Générique"]);
    expect(filterBuilds(lib, "", "agressif").map((b) => b.build.name)).toEqual(["Rush français"]);
    expect(filterBuilds(lib, "french", "boom").map((b) => b.build.name)).toEqual(["Générique"]);
  });

  it("remplace un BO réimporté depuis le même lien", () => {
    const url = "https://aoe4guides.com/builds/abc12345";
    let lib = addBuild([], bo("v1", "Rus"), "boom", url);
    const first = lib[0].id;
    lib = addBuild(lib, bo("v2", "Rus"), "boom", url);
    expect(lib.map((b) => b.build.name)).toEqual(["v2"]);
    // Même identifiant : le journal et les matchups qui le citent le retrouvent.
    expect(lib[0].id).toBe(first);
  });

  it("sauvegarde, recharge et supprime", () => {
    const store = memoryStore();
    const lib = addBuild([], bo("a", "Rus"), "fast-castle");
    saveLibrary(store, lib);
    const loaded = loadLibrary(store);
    expect(loaded).toEqual(lib);
    expect(removeBuild(loaded, loaded[0].id)).toEqual([]);
  });

  it("repart d'une bibliothèque vide si les données sont corrompues", () => {
    const store = memoryStore();
    store.setItem("bogo.library.v1", "{oops");
    expect(loadLibrary(store)).toEqual([]);
  });
});

describe("extractBuildId", () => {
  it("lit l'identifiant d'un lien aoe4guides ou l'identifiant seul", () => {
    expect(extractBuildId("https://aoe4guides.com/builds/8lKqJLXIJJDPRKwvv2nh")).toBe("8lKqJLXIJJDPRKwvv2nh");
    expect(extractBuildId("aoe4guides.com/builds/8lKqJLXIJJDPRKwvv2nh?x=1")).toBe("8lKqJLXIJJDPRKwvv2nh");
    expect(extractBuildId(" 8lKqJLXIJJDPRKwvv2nh ")).toBe("8lKqJLXIJJDPRKwvv2nh");
  });

  it("refuse le reste", () => {
    expect(extractBuildId("https://example.com/builds/abc")).toBeNull();
    expect(extractBuildId("bonjour")).toBeNull();
  });
});
