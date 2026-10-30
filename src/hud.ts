// Lecture du panneau en bas à gauche de l'interface d'AoE4 à partir du texte reconnu
// par bogo-vision : population, villageois inactifs, stocks et villageois par ressource.
//
//   7/10        zZ 0          ← population / max, villageois inactifs
//   🍖 0        👤 6          ← stock, villageois sur la ressource
//   🪵 200      👤 0
//   🪙 100      👤 0
//   🪨 0        👤 0

export const RESOURCES = ["food", "wood", "gold", "stone"] as const;
export type Resource = (typeof RESOURCES)[number];
export type Resources = Record<Resource, number>;

/** Texte reconnu, position en fraction de la zone lue, origine en haut à gauche. */
export interface OcrToken {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HudReading {
  population: number;
  populationMax: number;
  idle: number;
  stock: Resources;
  gatherers: Resources;
  /** Villageois comptés sur les ressources, ou inactifs s'ils sont plus nombreux
   *  (les bâtisseurs n'apparaissent pas). */
  villagers: number;
}

interface NumberToken {
  value: number;
  cx: number;
  cy: number;
}

const POPULATION = /^(\d+)\/(\d+)$/;

export function parseHud(tokens: OcrToken[]): HudReading | null {
  // Plusieurs fractions peuvent s'afficher au-dessus du panneau (« 12/20 », « 0/7 ») : la
  // population est la plus basse qui a ses quatre lignes de ressources en dessous.
  const candidates = tokens.filter((t) => POPULATION.test(clean(t.text))).sort((a, b) => b.y - a.y);
  for (const pop of candidates) {
    const reading = readFrom(pop, tokens);
    if (reading) return reading;
  }
  return null;
}

function readFrom(pop: OcrToken, tokens: OcrToken[]): HudReading | null {
  const [, current, max] = POPULATION.exec(clean(pop.text))!;
  const popCy = pop.y + pop.h / 2;
  const rowTolerance = pop.h * 0.6;

  // Les autres fractions (au-dessus) ne sont pas des nombres du panneau.
  const numbers = tokens.filter((t) => t !== pop && !POPULATION.test(clean(t.text))).flatMap(numbersOf);
  const idleToken = numbers
    .filter((n) => Math.abs(n.cy - popCy) <= rowTolerance && n.cx > pop.x + pop.w)
    .sort((a, b) => a.cx - b.cx)[0];

  // Les villageois par ressource sont alignés sur les inactifs ; les stocks sur la population.
  const gatherersX = idleToken?.cx ?? pop.x + 3 * pop.w;
  const columnSplit = (pop.x + gatherersX) / 2;

  const rows: NumberToken[][] = [];
  for (const n of numbers.filter((n) => n.cy > popCy + rowTolerance).sort((a, b) => a.cy - b.cy)) {
    const row = rows[rows.length - 1];
    if (row && n.cy - row[0].cy <= rowTolerance) row.push(n);
    else rows.push([n]);
  }
  if (rows.length < RESOURCES.length) return null;

  // Les quatre lignes de ressources sont régulièrement espacées et suivent de près la
  // population. Une ligne de plus en tête (celle de la vraie population, mal lue, sous une
  // autre fraction « 8/10 ») décale tout d'une ressource : mieux vaut ne rien lire.
  const centers = rows.slice(0, RESOURCES.length).map((row) => row[0].cy);
  const gaps = centers.slice(1).map((cy, i) => cy - centers[i]);
  const spacing = Math.min(...gaps);
  if (Math.max(...gaps) > spacing * 1.25) return null;
  if (centers[0] - popCy > spacing * 2.2) return null;

  const stock = {} as Resources;
  const gatherers = {} as Resources;
  for (const [i, resource] of RESOURCES.entries()) {
    const row = rows[i];
    const left = row.filter((n) => n.cx < columnSplit).sort((a, b) => a.cx - b.cx)[0];
    const right = row.filter((n) => n.cx >= columnSplit).sort((a, b) => b.cx - a.cx)[0];
    if (!left) return null;
    stock[resource] = left.value;
    // Un compteur à 0 est grisé et peut ne pas être lu.
    gatherers[resource] = right?.value ?? 0;
  }

  const idle = idleToken?.value ?? 0;
  const working = RESOURCES.reduce((sum, r) => sum + gatherers[r], 0);
  const population = Number(current);
  // Le jeu compte un villageois inactif aussi sur sa dernière ressource (vérifié en partie :
  // 9 inactifs, 6 nourriture + 3 bois) : additionner compterait deux fois. On prend le plus
  // grand ; un villageois sorti du TC sans ralliement n'est compté qu'une fois au travail.
  const villagers = Math.max(working, idle);
  // Plus de villageois que de population : lecture fausse.
  if (villagers > population) return null;
  return { population, populationMax: Number(max), idle, stock, gatherers, villagers };
}

function clean(text: string): string {
  return text.replace(/[Oo]/g, "0").replace(/\s+/g, "");
}

/** Nombres d'un texte, avec une position estimée pour chacun s'il y en a plusieurs. */
function numbersOf(token: OcrToken): NumberToken[] {
  const text = token.text.replace(/[Oo]/g, "0");
  return [...text.matchAll(/\d+/g)].map((m) => {
    const middle = (m.index! + m[0].length / 2) / text.length;
    return { value: Number(m[0]), cx: token.x + token.w * middle, cy: token.y + token.h / 2 };
  });
}
