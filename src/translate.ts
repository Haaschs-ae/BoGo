// Traduction des consignes de BO (souvent en anglais sur aoe4guides) en français, sur
// l'appareil : un dictionnaire des termes d'AoE4, appliqué expressions d'abord, puis mot à
// mot. Le résultat est télégraphique mais clair (« Garde 3 or, reste → nourriture »).
// On ne traduit que les BO écrits en anglais, pour ne pas abîmer un BO déjà en français.

import type { BuildOrder } from "./buildOrder";

/** Expressions, de la plus longue à la plus courte (avant les mots seuls). */
const PHRASES: [string, string][] = [
  ["another dark age civ", "une autre civ en âge sombre"],
  ["scout in a standard pattern", "explore en motif classique"],
  ["dark age civ", "civ en âge sombre"],
  ["either way", "dans tous les cas"],
  ["in any case", "dans tous les cas"],
  ["keep producing", "continue à produire"],
  ["keep making", "continue à faire"],
  ["keep training", "continue à produire"],
  ["keep building", "continue à construire"],
  ["start producing", "commence à produire"],
  ["stop producing", "arrête de produire"],
  ["if possible", "si possible"],
  ["if needed", "si besoin"],
  ["if necessary", "si besoin"],
  ["will have", "aura"],
  ["force drop", "fais déposer"],
  ["force-drop", "fais déposer"],
  ["at least", "au moins"],
  ["instead of", "au lieu de"],
  ["right away", "tout de suite"],
  ["as well", "aussi"],
  ["in a standard pattern", "en motif classique"],
  ["as soon as possible", "dès que possible"],
  ["as soon as", "dès que"],
  ["make sure", "assure-toi"],
  ["if he is", "s'il est"],
  ["if they are", "s'ils sont"],
  ["if you are", "si tu es"],
  ["if you have", "si tu as"],
  ["if you", "si tu"],
  ["when you have", "quand tu as"],
  ["when you", "quand tu"],
  ["you have", "tu as"],
  ["the resources", "les ressources"],
  ["you can", "tu peux"],
  ["do not", "ne pas"],
  ["don't", "ne pas"],
  ["up to", "jusqu'à"],
  ["away from", "loin de"],
  ["close to", "près de"],
  ["next to", "à côté de"],
  ["the rest", "le reste"],
  ["to sell", "pour vendre"],
  ["to buy", "pour acheter"],
  ["go to", "va à"],
  ["drop off", "dépose"],
  ["age up", "passe l'âge"],
  ["age-up", "passe l'âge"],
  ["aging up", "passage d'âge"],
  ["click up", "passe l'âge"],
  ["dark age", "âge sombre"],
  ["feudal age", "âge féodal"],
  ["castle age", "âge des châteaux"],
  ["imperial age", "âge impérial"],
  ["town center", "TC"],
  ["town centre", "TC"],
  ["lumber camp", "camp de bûcherons"],
  ["mining camp", "camp de mineurs"],
  ["archery range", "camp de tir"],
  ["siege workshop", "atelier de siège"],
  ["sacred sites", "sites sacrés"],
  ["sacred site", "site sacré"],
  ["berry bushes", "baies"],
  ["berry bush", "baies"],
  ["fishing boats", "bateaux de pêche"],
  ["fishing boat", "bateau de pêche"],
  ["men-at-arms", "hommes d'armes"],
  ["man-at-arms", "homme d'armes"],
  ["men at arms", "hommes d'armes"],
  ["man at arms", "homme d'armes"],
  ["palisade wall", "palissade"],
  ["palisade gate", "porte de palissade"],
  ["stone wall", "mur de pierre"],
  ["battering ram", "bélier"],
  ["siege tower", "tour de siège"],
  ["trade ship", "navire marchand"],
  ["transport ship", "navire de transport"],
  ["olive oil", "huile d'olive"],
  ["double broadaxe", "double hache"],
  ["survival techniques", "techniques de survie"],
  ["professional scouts", "éclaireurs professionnels"],
];

const WORDS: Record<string, string> = {
  // Ressources et sources
  villager: "villageois",
  villagers: "villageois",
  vill: "vil",
  vills: "vils",
  sheep: "moutons",
  deer: "cerfs",
  boar: "sanglier",
  boars: "sangliers",
  berries: "baies",
  berry: "baies",
  fish: "poisson",
  farm: "ferme",
  farms: "fermes",
  food: "nourriture",
  wood: "bois",
  gold: "or",
  stone: "pierre",
  relic: "relique",
  relics: "reliques",
  resource: "ressource",
  resources: "ressources",
  // Bâtiments
  house: "maison",
  houses: "maisons",
  mill: "moulin",
  mills: "moulins",
  dock: "port",
  docks: "ports",
  blacksmith: "forge",
  market: "marché",
  barracks: "caserne",
  stable: "écurie",
  stables: "écuries",
  landmark: "monument",
  landmarks: "monuments",
  outpost: "avant-poste",
  outposts: "avant-postes",
  palisade: "palissade",
  wall: "mur",
  walls: "murs",
  tower: "tour",
  towers: "tours",
  castle: "château",
  monastery: "monastère",
  mosque: "mosquée",
  university: "université",
  // Unités
  scout: "éclaireur",
  scouts: "éclaireurs",
  spearman: "lancier",
  spearmen: "lanciers",
  spear: "lancier",
  spears: "lanciers",
  archer: "archer",
  archers: "archers",
  horseman: "cavalier",
  horsemen: "cavaliers",
  knight: "chevalier",
  knights: "chevaliers",
  crossbowman: "arbalétrier",
  crossbowmen: "arbalétriers",
  monk: "moine",
  monks: "moines",
  trader: "marchand",
  traders: "marchands",
  prelate: "prélat",
  mangonel: "mangonneau",
  trebuchet: "trébuchet",
  // Technologies et âges
  wheelbarrow: "brouette",
  forestry: "sylviculture",
  fertilization: "fertilisation",
  feudal: "féodal",
  imperial: "impérial",
  age: "âge",
  // Verbes
  protect: "protège",
  defend: "défends",
  finish: "finis",
  kill: "tue",
  attack: "attaque",
  hunt: "chasse",
  wait: "attends",
  producing: "en produisant",
  making: "en faisant",
  training: "en produisant",
  build: "construis",
  built: "construit",
  building: "construction",
  builder: "bâtisseur",
  builders: "bâtisseurs",
  send: "envoie",
  sent: "envoyé",
  move: "déplace",
  moved: "déplacé",
  put: "mets",
  queue: "lance",
  queued: "lancé",
  research: "recherche",
  researched: "recherché",
  train: "produis",
  make: "fais",
  produce: "produis",
  create: "crée",
  get: "prends",
  take: "prends",
  use: "utilise",
  start: "commence",
  stop: "arrête",
  save: "économise",
  sell: "vends",
  buy: "achète",
  chop: "coupe",
  chopping: "au bois",
  chopped: "au bois",
  gather: "récolte",
  gathering: "récolte",
  harass: "harcèle",
  rally: "ralliement",
  keep: "garde",
  // Liaisons et précisions
  until: "jusqu'à",
  then: "puis",
  and: "et",
  or: "ou",
  with: "avec",
  without: "sans",
  from: "de",
  to: "vers",
  on: "sur",
  at: "à",
  in: "dans",
  into: "dans",
  for: "pour",
  of: "de",
  after: "après",
  before: "avant",
  when: "quand",
  while: "pendant",
  if: "si",
  around: "environ",
  about: "environ",
  approx: "environ",
  near: "près",
  far: "loin",
  away: "loin",
  back: "retour",
  rest: "reste",
  both: "les deux",
  all: "tous",
  each: "chaque",
  every: "chaque",
  more: "plus",
  less: "moins",
  enough: "assez",
  extra: "en plus",
  first: "premier",
  last: "derniers",
  next: "suivant",
  new: "nouveau",
  another: "un autre",
  done: "terminé",
  finished: "terminé",
  complete: "terminé",
  completed: "terminé",
  ready: "prêt",
  yet: "encore",
  no: "pas de",
  not: "pas",
  only: "seulement",
  also: "aussi",
  now: "maintenant",
  soon: "bientôt",
  asap: "dès que possible",
  passive: "passif",
  aggressive: "agressif",
  idle: "inactif",
  enemy: "ennemi",
  vs: "contre",
  versus: "contre",
  against: "contre",
  other: "autre",
  deposit: "dépôt",
  so: "donc",
  but: "mais",
  because: "car",
  early: "tôt",
  late: "tard",
  fast: "vite",
  quickly: "vite",
  behind: "derrière",
  opponent: "adversaire",
  he: "il",
  you: "tu",
  your: "ton",
  them: "les",
  is: "est",
  are: "sont",
  // Articles : supprimés (style télégraphique)
  the: "",
  a: "",
  an: "",
};

/** « to » suivi d'un verbe : « pour » + infinitif (« spears to protect deer » → « … pour protéger … »). */
const INFINITIVES: Record<string, string> = {
  build: "construire", send: "envoyer", move: "déplacer", protect: "protéger", defend: "défendre",
  finish: "finir", complete: "finir", get: "prendre", take: "prendre", make: "faire", produce: "produire",
  train: "produire", research: "rechercher", gather: "récolter", chop: "couper", use: "utiliser",
  start: "commencer", stop: "arrêter", save: "économiser", sell: "vendre", buy: "acheter", keep: "garder",
  harass: "harceler", scout: "explorer", kill: "tuer", attack: "attaquer", hunt: "chasser", reach: "atteindre",
  help: "aider", fight: "combattre", wall: "murer", block: "bloquer", push: "pousser", age: "passer l'âge",
};

const INFINITIVE_PATTERN = new RegExp(`(?<![\\p{L}'-])to (${Object.keys(INFINITIVES).join("|")})(?![\\p{L}'-])`, "giu");

const PHRASE_PATTERNS = PHRASES.map(
  ([en, fr]) => [new RegExp(`(?<![\\p{L}'-])${escape(en)}(?![\\p{L}'-])`, "giu"), fr] as const,
);

/** Traduit un texte (sans images) de l'anglais vers le français. */
export function translateText(text: string): string {
  let out = text;
  for (const [pattern, fr] of PHRASE_PATTERNS) out = out.replace(pattern, (match) => keepCase(match, fr));
  out = out.replace(INFINITIVE_PATTERN, (match, verb: string) => keepCase(match, `pour ${INFINITIVES[verb.toLowerCase()]}`));
  // Mots seuls : lettres latines, apostrophe et trait d'union compris (don't, men-at-arms).
  out = out.replace(/[\p{L}][\p{L}'-]*/gu, (word) => {
    const fr = WORDS[word.toLowerCase()];
    return fr === undefined ? word : keepCase(word, fr);
  });
  // Articles supprimés : on ne laisse pas d'espaces doubles.
  return out.replace(/ {2,}/g, " ").replace(/^ (?=\S)/, (m) => (text.startsWith(" ") ? m : ""));
}

/** Mots anglais courants qui ne sont pas du français : s'il en reste, la traduction a échoué. */
const ENGLISH_LEFT = new Set(
  ("the of to for with from by as it its this that these those there their they we will would should could " +
    "can need needs want have has had do does be been being was were way either some any much many very just " +
    "still again over under out down up off sure which what who how why where than too left right while")
    .split(" "),
);

/** Il reste de l'anglais : un mot courant anglais, ou un mot en « -ing ». */
export function hasEnglish(text: string): boolean {
  return (text.match(/[\p{L}][\p{L}'-]*/gu) ?? []).some((w) => {
    const lower = w.toLowerCase();
    return ENGLISH_LEFT.has(lower) || (lower.length >= 5 && lower.endsWith("ing"));
  });
}

/**
 * Traduit les morceaux de texte d'une consigne (entre ses icônes). Jamais de franglais : s'il
 * reste de l'anglais quelque part, la consigne garde son texte anglais, entier et lisible.
 */
export function translateLine(texts: string[]): string[] {
  const french = texts.map(translateText);
  return french.some(hasEnglish) ? texts : french;
}

/** Traduit un nom entier (« lumber camp », « horseman ») ; un nom inconnu reste en anglais. */
export function translateTerm(term: string): string {
  const lower = term.toLowerCase();
  return PHRASES.find(([en]) => en === lower)?.[1] ?? (WORDS[lower] || term);
}

const EN_MARKERS = /\b(the|and|to|until|then|with|on|at|from|build|send|keep|rest|villagers?|sheep|wood|gold|food|stone|berries|house|age|up|if|when|after|before)\b/gi;
const FR_MARKERS = /\b(le|la|les|des|du|et|puis|jusqu|avec|sur|au|aux|construis|envoie|garde|reste|villageois|moutons|bois|nourriture|pierre|baies|maison|âge|si|quand|après|avant)\b/gi;

/** Le BO est écrit en anglais (on compte les mots courants de chaque langue, hors images). */
export function looksEnglish(build: BuildOrder): boolean {
  const text = build.build_order
    .flatMap((step) => step.notes)
    .join(" ")
    .replace(/@[^@]*@/g, " ");
  const en = text.match(EN_MARKERS)?.length ?? 0;
  const fr = text.match(FR_MARKERS)?.length ?? 0;
  return en > fr;
}

function keepCase(source: string, fr: string): string {
  if (!fr || source[0] === source[0].toLowerCase()) return fr;
  return fr[0].toUpperCase() + fr.slice(1);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
