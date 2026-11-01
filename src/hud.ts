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
/** Première ligne de ressources : un écart et demi sous la population (mesuré sur Mac et Windows). */
const FIRST_ROW = 1.5;
/** Plus que la population maximale d'AoE4 (200, jusqu'à 210 et plus avec certains bonus). */
const MAX_POPULATION = 300;
/** Bord gauche du panneau, en fraction de la zone lue : la population y est (x ≈ 0,12). */
const POPULATION_MAX_X = 0.3;

export function parseHud(tokens: OcrToken[]): HudReading | null {
  // Plusieurs fractions peuvent s'afficher au-dessus du panneau (« 12/20 », « 0/7 ») : la
  // population est la plus basse qui a ses quatre lignes de ressources en dessous.
  // La population est au bord gauche du panneau ; plus à droite, une fraction est celle du
  // panneau de la sélection (points de vie « 50/50 ») ou du compteur d'unités militaires.
  const candidates = tokens
    .filter((t) => POPULATION.test(clean(t.text)) && t.x < POPULATION_MAX_X)
    .sort((a, b) => b.y - a.y);
  for (const pop of candidates) {
    const reading = readFrom(pop, tokens);
    if (reading) return reading;
  }
  return null;
}

function readFrom(pop: OcrToken, tokens: OcrToken[]): HudReading | null {
  const [, current, max] = POPULATION.exec(clean(pop.text))!;
  // Population de 300 au plus : « 7000/7000 », ce sont les points de vie d'un bâtiment.
  if (Number(max) > MAX_POPULATION || Number(current) > MAX_POPULATION) return null;
  const popCy = pop.y + pop.h / 2;
  const rowTolerance = pop.h * 0.6;

  // Les autres fractions (au-dessus) ne sont pas des nombres du panneau. Plus à droite, c'est
  // le panneau de l'unité ou du bâtiment sélectionné (points de vie, attaque…) ; plus à gauche
  // que la population, ce sont les icônes des ressources lues comme des chiffres (« 4 0 »).
  // Mesuré en largeur de caractère de la population : la hauteur des cadres varie d'une
  // reconnaissance à l'autre (Vision, Windows), pas la largeur des chiffres. Villageois par
  // ressource vers 12 caractères à droite, panneau de la sélection à 20 et plus.
  const charWidth = pop.w / Math.max(1, clean(pop.text).length);
  const left = pop.x - charWidth;
  const right = pop.x + charWidth * 17;
  const numbers = tokens
    .filter((t) => t !== pop && !POPULATION.test(clean(t.text)))
    .flatMap(numbersOf)
    .filter((n) => n.cx >= left && n.cx <= right);
  // La population est la fraction la plus basse du panneau : une autre fraction en dessous,
  // c'est elle la population (celle-ci est « 12/20 » ou « 8/10 », au-dessus).
  const below = tokens.some(
    (t) => t !== pop && POPULATION.test(clean(t.text)) && t.y + t.h / 2 > popCy + rowTolerance && t.x >= left && t.x <= right,
  );
  if (below) return null;
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
  // Il faut deux lignes pour connaître l'écart entre lignes.
  if (rows.length < 2) return null;

  // Les lignes de ressources sont régulièrement espacées, la première à un écart et demi sous la
  // population. Chaque ligne lue doit tomber pile sur l'une des quatre places : une ligne de
  // trop (celle de la vraie population, mal lue, sous une autre fraction « 8/10 ») décalerait
  // tout d'une ressource, mieux vaut ne rien lire. Une place sans ligne est une ligne dont le
  // stock n'a pas été lu (souvent un « 0 » seul, que Windows ne lit pas) : 0 partout.
  // Hauteur d'une ligne : celle du stock (colonne de gauche, plus régulière que les compteurs
  // de villageois dans leurs cases). L'écart entre deux lignes lues voisines doit valoir un
  // nombre entier d'écarts de ligne (1, ou 2 si une ligne manque), et la première tomber à un
  // écart et demi sous la population.
  const centers = rows.map((row) => [...row].sort((a, b) => a.cx - b.cx)[0].cy);
  const spacing = Math.min(...centers.slice(1).map((cy, i) => cy - centers[i]));
  if (spacing <= rowTolerance) return null;
  const slots: (NumberToken[] | undefined)[] = [];
  let index = -1;
  for (const [i, row] of rows.entries()) {
    const steps = i === 0 ? (centers[0] - popCy) / spacing - FIRST_ROW : (centers[i] - centers[i - 1]) / spacing;
    const step = Math.round(steps);
    if (Math.abs(steps - step) > 0.3 || (i === 0 ? step < 0 : step < 1)) return null;
    index = i === 0 ? step : index + step;
    if (index >= RESOURCES.length) break;
    slots[index] = row;
  }
  if (slots.filter(Boolean).length < 2) return null;

  const stock = {} as Resources;
  const gatherers = {} as Resources;
  for (const [i, resource] of RESOURCES.entries()) {
    const row = slots[i] ?? [];
    const left = row.filter((n) => n.cx < columnSplit).sort((a, b) => a.cx - b.cx)[0];
    const right = row.filter((n) => n.cx >= columnSplit).sort((a, b) => b.cx - a.cx)[0];
    if (row.length && !left) return null;
    stock[resource] = left?.value ?? 0;
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
