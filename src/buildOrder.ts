// Format des build orders : celui de RTS_Overlay, que produit l'export
// « Overlay Tool » d'aoe4guides.com.

export interface StepResources {
  food: number;
  wood: number;
  gold: number;
  stone: number;
  builder?: number;
}

export interface BuildOrderStep {
  population_count: number;
  villager_count: number;
  age: number;
  resources: StepResources;
  notes: string[];
  /** Temps visé, au format "m:ss". */
  time?: string;
}

export interface BuildOrder {
  name: string;
  civilization: string | string[];
  author?: string;
  source?: string;
  build_order: BuildOrderStep[];
}

export type NotePart = { kind: "text"; text: string } | { kind: "image"; path: string };

const IMAGE_PATH = /^[\w\-/.]+\.(webp|png|jpe?g|gif)$/i;

/** Valide un BO (objet ou texte JSON) et lève une erreur lisible s'il est invalide. */
export function parseBuildOrder(input: unknown): BuildOrder {
  let data = input;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      throw new Error("Ce texte n'est pas du JSON valide.");
    }
  }
  if (!isObject(data)) throw new Error("Le build order doit être un objet JSON.");

  const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "Sans nom";
  const civilization = data.civilization;
  if (!isCivilization(civilization)) throw new Error("Civilisation manquante dans le build order.");
  if (!Array.isArray(data.build_order) || data.build_order.length === 0) {
    throw new Error("Le build order ne contient aucune étape.");
  }

  const steps = data.build_order.map((step, i) => parseStep(step, i + 1));
  return {
    name,
    civilization,
    author: typeof data.author === "string" ? data.author : undefined,
    source: typeof data.source === "string" ? data.source : undefined,
    build_order: steps,
  };
}

function parseStep(step: unknown, n: number): BuildOrderStep {
  if (!isObject(step)) throw new Error(`Étape ${n} : format invalide.`);
  const res = step.resources;
  if (!isObject(res)) throw new Error(`Étape ${n} : ressources manquantes.`);
  if (!Array.isArray(step.notes) || !step.notes.every((x) => typeof x === "string")) {
    throw new Error(`Étape ${n} : notes manquantes.`);
  }
  const time = typeof step.time === "string" && parseTime(step.time) !== null ? step.time : undefined;
  return {
    population_count: int(step.population_count, `Étape ${n} : population`),
    villager_count: int(step.villager_count, `Étape ${n} : villageois`),
    age: int(step.age, `Étape ${n} : âge`),
    resources: {
      food: int(res.food, `Étape ${n} : nourriture`),
      wood: int(res.wood, `Étape ${n} : bois`),
      gold: int(res.gold, `Étape ${n} : or`),
      stone: int(res.stone, `Étape ${n} : pierre`),
      builder: res.builder === undefined ? undefined : int(res.builder, `Étape ${n} : bâtisseurs`),
    },
    notes: step.notes as string[],
    time,
  };
}

/** "1:30" → 90 secondes ; null si le format est invalide. */
export function parseTime(time: string): number | null {
  const m = /^(\d+):([0-5]\d)$/.exec(time.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** aoe4guides encode certains caractères : "5 -&gt;" → "5 ->". */
export function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Découpe une note en texte et images : "6 @resource/sheep.webp@" → texte, image. */
export function tokenizeNote(note: string): NotePart[] {
  const parts: NotePart[] = [];
  decodeEntities(note).split("@").forEach((chunk, i) => {
    if (i % 2 === 1 && IMAGE_PATH.test(chunk)) parts.push({ kind: "image", path: chunk });
    else if (chunk) {
      // Un "@" isolé n'entoure pas d'image : on le garde dans le texte.
      const text = i % 2 === 1 ? `@${chunk}@` : chunk;
      const last = parts[parts.length - 1];
      if (last?.kind === "text") last.text += text;
      else parts.push({ kind: "text", text });
    }
  });
  return parts;
}

/** Nom lisible d'une image : "building_economy/house.webp" → "house", "horseman-1.webp" → "horseman". */
export function imageLabel(path: string): string {
  const file = path.split("/").pop() ?? path;
  // Le numéro final est l'âge de la variante dessinée (horseman-1, knight-2).
  return file.replace(/\.[a-z]+$/i, "").replace(/[_-]+/g, " ").replace(/ \d+$/, "");
}

export function civilizationsOf(build: BuildOrder): string[] {
  return Array.isArray(build.civilization) ? build.civilization : [build.civilization];
}

function int(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${label} : nombre entier attendu.`);
  return value;
}

function isCivilization(value: unknown): value is string | string[] {
  if (typeof value === "string") return value.trim() !== "";
  return Array.isArray(value) && value.length > 0 && value.every((c) => typeof c === "string");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
