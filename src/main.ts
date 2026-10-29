import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { extractBuildId, fetchBuild } from "./aoe4guides";
import { extractProfileId, fetchLastGame, kindLabel, soloOpponent, type DetectedGame } from "./aoe4world";
import {
  civilizationsOf,
  parseBuildOrder,
  tokenizeNote,
  type BuildOrder,
  type BuildOrderStep,
} from "./buildOrder";
import { CIVILIZATIONS } from "./civs";
import { flagUrl } from "./flags";
import { ClockTracker, formatClock, stepForClock } from "./clock";
import { heroModel, iconLabel, isWellKnownIcon, stepLandmark } from "./display";
import {
  AGE_NAMES,
  BuildEngine,
  effectiveVillagerTargets,
  goalCosts,
  stepGoal,
  type Cost,
  type EngineState,
  type StepGoal,
} from "./engine";
import { parseHud, RESOURCES, type HudReading, type OcrToken, type Resource } from "./hud";
import { LandmarkWatch } from "./top";
import {
  acceleratorFromEvent,
  checkHotkey,
  DEFAULT_HOTKEYS,
  HOTKEY_ACTIONS,
  hotkeyHint,
  hotkeyLabel,
  HOTKEYS,
  KEYS,
  sameHotkey,
  SCREEN_READING,
  setHotkeys,
  type HotkeyAction,
} from "./platform";
import { looksEnglish, translateText } from "./translate";
import { adviseBuild, categoryPicks, COUNTDOWN_SECONDS, distributionMismatch, type Advice } from "./advice";
import { newEntry, parseJournal, serializeJournal, type GameEntry, type LaunchHow } from "./journal";
import {
  forgetBuild,
  loadMatchups,
  MAP_SUGGESTIONS,
  mapKey,
  matchupPick,
  newRuleId,
  PRECEDENCE,
  ruleMatch,
  saveMatchups,
  type Matchups,
  type MatchupRule,
} from "./matchups";
import {
  aoe4worldSeen,
  freshGame,
  type PollStart,
  arm,
  clockRead,
  currentMode,
  FEATURES,
  freshMemory,
  MODE_LABELS,
  projectLive,
  type ModeFeatures,
  type ModeWhy,
  type PlayMode,
} from "./mode";
import {
  addBuild,
  filterBuilds,
  loadLibrary,
  removeBuild,
  saveLibrary,
  STYLES,
  type SavedBuild,
  type Style,
} from "./library";

// Icônes du jeu servies par le site de RTS_Overlay ; à défaut on affiche le nom de l'image.
const ICON_BASE = "https://rts-overlay.github.io/assets/aoe4/";

const SESSION_KEY = "bogo.session.v1";
const SETTINGS_KEY = "bogo.settings.v1";
/**
 * Bornes de la taille de BoGo, en %. Déclarées avant `state`, que loadSettings remplit : dans
 * l'appli construite, une constante déclarée plus bas vaudrait encore undefined à ce moment-là.
 */
const SCALE_MIN = 70;
const SCALE_MAX = 130;
// AoE4World voit une partie quelques secondes après son lancement : inutile d'interroger plus souvent.
const POLL_SECONDS = 10;

interface Settings {
  profileId: string;
  apiKey: string;
  /** Lire l'horloge du jeu dans la fenêtre GeForce Now. */
  readScreen: boolean;
  /** Traduire en français les consignes des BO écrits en anglais. */
  translate: boolean;
  /** Écrire le nom à côté des icônes peu connues (baies, bâtiments, unités des nouvelles civs). */
  iconNames: boolean;
  /** Montrer l'étape suivante (« Ensuite ») sous l'étape en cours ; caché par défaut. */
  showNext: boolean;
  /** Enregistrer les lectures de l'écran de chaque partie dans un fichier local, pour la rejouer. */
  record: boolean;
  /** Taille de BoGo en %, de 70 à 130 (zoom de toute l'interface). */
  scale: number;
  /** Raccourcis choisis par le joueur (les autres gardent leur valeur par défaut). */
  hotkeys: Partial<Record<HotkeyAction, string>>;
}

type VisionEvent =
  | { type: "clock"; seconds: number; text: string }
  | { type: "hud"; tokens: OcrToken[] }
  | { type: "top"; tokens: OcrToken[] }
  | { type: "status"; code: "ok" | "no_window" | "no_clock"; apps?: string[] }
  | { type: "error"; code: string; message: string }
  | { type: "stopped"; status?: string; detail?: string };

const VISION_STATUS: Record<string, string> = {
  ok: "Horloge du jeu lue.",
  no_window: "Fenêtre GeForce Now introuvable : lance-la, en plein écran de préférence.",
  no_clock: "GeForce Now trouvé, mais pas d'horloge à l'écran (pas encore en partie ?).",
  stopped: "Lecture de l'écran arrêtée.",
};

interface State {
  /**
   * civs : grille des drapeaux ; civ : BO de la civ choisie ; choice : choix du début de partie ;
   * matchups : BO de base et règles de la civ choisie.
   */
  view: "civs" | "civ" | "play" | "settings" | "choice" | "matchups";
  library: SavedBuild[];
  civ: string;
  style: Style | "";
  currentId: string | null;
  step: number;
  locked: boolean;
  importStatus: { text: string; error: boolean } | null;
  settings: Settings;
  game: DetectedGame | null;
  gameError: string | null;
  /** Dernière partie pour laquelle on a déjà proposé les BO. */
  handledGameId: number | null;
  vision: { status: string; error: string | null };
  /** Dernière étape choisie d'après l'horloge : on ne la réimpose pas si le joueur a changé d'étape à la main. */
  autoStep: number | null;
  /** Dernière lecture du panneau (population, ressources, villageois) et son heure. */
  hud: { reading: HudReading; at: number } | null;
  engine: EngineState | null;
  /** Fenêtre réduite à une pastille (BO terminé, ou à la demande). */
  mini: boolean;
  /** Le BO en cours est arrivé au bout. */
  finished: boolean;
  /** Fichier où la partie est enregistrée (réglage « Enregistrer mes parties »), ou l'erreur. */
  recording: { path: string | null; error: string | null };
  /** Choix du début de partie : de la détection au premier passage d'âge (ou 5 min). */
  offer: Offer | null;
  /** Mes matchups : BO de base par civ et règles civ × adversaire × carte (voir matchups.ts). */
  matchups: Matchups;
}

interface Offer {
  game: DetectedGame;
  advice: Advice | null;
  /** Meilleur BO de chaque catégorie (raccourcis 1 à 4). */
  picks: Record<Style, SavedBuild | null>;
  /** Fin du compte à rebours (ms), ou null s'il ne tourne pas. */
  countdownEnd: number | null;
  /** Pourquoi le BO proposé ne sera pas lancé tout seul. */
  autoOff: string | null;
  /** Fin des raccourcis de choix (ms) ; le premier passage d'âge l'avance. */
  until: number;
}

const state: State = {
  view: "civs",
  library: loadLibrary(localStorage),
  civ: "",
  style: "",
  currentId: null,
  step: 0,
  locked: false,
  importStatus: null,
  settings: loadSettings(),
  game: null,
  gameError: null,
  handledGameId: null,
  vision: { status: "", error: null },
  autoStep: null,
  hud: null,
  engine: null,
  mini: false,
  finished: false,
  recording: { path: null, error: null },
  offer: null,
  matchups: loadMatchups(localStorage),
};
const clock = new ClockTracker();
/** Moteur du BO en cours, recréé à chaque lancement d'un BO. */
let engine: BuildEngine | null = null;
// Icône du jeu (même jeu d'icônes que les BO aoe4guides), emoji et nom en français.
const RESOURCE_ICONS: Record<Resource, [string, string, string]> = {
  food: ["🍖", "nourriture", "resource/resource_food.webp"],
  wood: ["🪵", "bois", "resource/resource_wood.webp"],
  gold: ["🪙", "or", "resource/resource_gold.webp"],
  stone: ["🪨", "pierre", "resource/resource_stone.webp"],
};
const VILLAGER_ICON = "unit_worker/villager.webp";
const TC_ICON = "building_economy/town-center.webp";
const app = document.querySelector<HTMLDivElement>("#app")!;
const appWindow = getCurrentWindow();

function current(): SavedBuild | undefined {
  return state.library.find((b) => b.id === state.currentId);
}

function goToStep(step: number) {
  const build = current();
  if (!build) return;
  // ⌘⌥→ sur la dernière étape : BO terminé.
  if (step > build.build.build_order.length - 1) return finishBuild();
  state.step = Math.max(0, Math.min(step, build.build.build_order.length - 1));
  engine?.setStep(state.step);
  // Revenir avant la fin rouvre le BO (pastille « terminé » retirée).
  if (state.finished && state.step < build.build.build_order.length - 1) {
    state.finished = false;
    state.mini = false;
  }
  recordEvent({ type: "step", step: state.step, reason: "clavier" });
  saveSession();
  render();
}

function resetEngine() {
  const saved = current();
  if (!saved) {
    engine = null;
    return;
  }
  // La civ jouée sert au coût du passage d'âge et du TC.
  engine = new BuildEngine(saved.build.build_order, playedCivilization(saved));
  engine.coaching = features().coaching;
  engine.setStep(state.step, "reprise du BO");
  state.engine = null;
}

/**
 * Ce que BoGo retient pour décider du mode : choix « IA » (bascule de l'en-tête, pour la partie
 * en cours ou la prochaine), horloge, joueur vu en face, vérification. Jamais enregistré : au
 * lancement de BoGo, c'est VS. Voir mode.ts.
 */
let modeMemory = freshMemory();
/** Ligne d'information de quelques secondes (retour forcé en VS). */
let modeNotice: { text: string; until: number } | null = null;

/** « IA » choisi (ou retiré) : il vaudra pour la partie en cours, ou pour la prochaine. */
function setTraining(on: boolean) {
  modeMemory = arm(modeMemory, on, Date.now());
  if (engine) engine.coaching = features().coaching;
  render();
}

/** Horloge lue : une nouvelle partie fait tomber le choix « IA » de la précédente. */
function noteClock(seconds: number) {
  const now = Date.now();
  const { memory, notice } = clockRead(modeMemory, seconds, now);
  modeMemory = memory;
  if (notice) modeNotice = { text: notice, until: now + 6000 };
}

/** Mode et raison, recalculés à chaque fois (voir decideMode). */
function modeState(now = Date.now()): { mode: PlayMode; why: ModeWhy } {
  return currentMode(modeMemory, state.game, clock.current(now), !!state.settings.profileId, now);
}

/** Entraînement (contre l'IA, sur ton choix, vérifié) ou Versus (contre des joueurs, ou quand BoGo ne sait pas). */
function mode(): PlayMode {
  return modeState().mode;
}

function features(): Readonly<ModeFeatures> {
  return FEATURES[mode()];
}

/** Le panneau a été lu il y a peu : c'est lui qui pilote le BO (sinon l'horloge, sinon le clavier). */
function hudIsFresh(now = Date.now()): boolean {
  return !!state.hud && now - state.hud.at < 5000;
}

/** BO terminé : l'overlay se réduit à une pastille pour ne plus gêner (un clic le rouvre). */
function finishBuild() {
  if (state.finished) return;
  state.finished = true;
  state.mini = true;
  recordEvent({ type: "finished", step: state.step });
  render();
}

function toggleMini() {
  state.mini = !state.mini;
  render();
}

function play(id: string, how: LaunchHow = "choice") {
  noteLaunch(id, how);
  state.currentId = id;
  state.step = 0;
  state.autoStep = null;
  state.finished = false;
  state.mini = false;
  state.view = "play";
  resetEngine();
  saveSession();
  // En partie, les clics passent au jeu ; le raccourci « Verrouiller » pour cliquer dans BoGo.
  setLocked(true);
  const saved = current();
  if (state.settings.record && saved) {
    startRecording().then(() => recordEvent({ type: "bo", id: saved.id, build: saved.build }));
  }
}

/** Nouveau fichier d'enregistrement (un par BO lancé) ; ne fait jamais échouer le lancement. */
async function startRecording() {
  try {
    state.recording = { path: await invoke<string | null>("set_recording", { enabled: true }), error: null };
  } catch (err) {
    state.recording = { path: null, error: errorText(err) };
  }
}

/** Repère dans l'enregistrement en cours (BO lancé, étape au clavier, fin) ; sans enregistrement, rien. */
function recordEvent(event: Record<string, unknown>) {
  if (state.settings.record) invoke("record_event", { event }).catch(() => {});
}

async function setLocked(locked: boolean) {
  // Sans raccourci pour déverrouiller, BoGo deviendrait intouchable : il reste déverrouillé.
  state.locked = locked && !hotkeyErrors.lock;
  render();
  await appWindow.setIgnoreCursorEvents(state.locked).catch(() => {});
}

/** BoGo n'a pas d'icône dans le Dock : sans raccourci pour le réafficher, on ne le masque pas. */
function hideOverlay() {
  if (!hotkeyErrors.toggle) appWindow.hide();
}

// ---------- Choix du BO au début de la partie ----------

/** Journal local des parties (fichier app-data, jamais envoyé) : il nourrit le conseil. */
let journal: GameEntry[] = [];
const journalReady = invoke<string>("journal_read")
  .then((text) => {
    journal = parseJournal(text);
  })
  .catch(() => {});
let journalTimer = 0;

/** Écriture groupée, une demi-seconde après la dernière modification. */
function saveJournal() {
  clearTimeout(journalTimer);
  journalTimer = window.setTimeout(() => invoke("journal_write", { text: serializeJournal(journal) }).catch(() => {}), 500);
}

/** Entrée du journal de la partie en cours. */
function gameEntry(): GameEntry | undefined {
  const game = state.game;
  return game?.ongoing ? journal.find((e) => e.gameId === game.id) : undefined;
}

/**
 * Ce qu'AoE4World dit des adversaires : un joueur vu en face dans la partie en cours impose VS
 * jusqu'à sa fin ; une réponse sans partie contre des humains vérifie le choix « IA ».
 */
function noteOpposition(game: DetectedGame | null, poll: PollStart, wasTraining: boolean) {
  const now = Date.now();
  const { memory, notice } = aoe4worldSeen(modeMemory, game, poll, clock.current(now), now, wasTraining);
  modeMemory = memory;
  if (notice) modeNotice = { text: notice, until: now + 5000 };
  if (engine) engine.coaching = features().coaching;
}

/** BO lancé entre deux parties : ton choix pour la suivante, gardé tel quel à la détection. */
let preChosen: string | null = null;
/** Raccourcis de choix actifs 5 min au plus quand aucun passage d'âge n'est vu (Windows). */
const CHOICE_MS = 5 * 60_000;
const REFUSED = "annulé";
let countdownTimer = 0;

/** Horloge du jeu : lue à l'écran, sinon estimée depuis le début de la partie selon AoE4World. */
function gameClock(): { seconds: number; read: boolean } {
  const read = clock.current(Date.now());
  if (read !== null) return { seconds: read, read: true };
  const started = Date.parse(state.game?.startedAt ?? "");
  return { seconds: Number.isFinite(started) ? Math.max(0, (Date.now() - started) / 1000) : 0, read: false };
}

function noteLaunch(id: string, how: LaunchHow) {
  stopCountdown();
  const entry = gameEntry();
  if (entry) {
    entry.launches.push({ buildId: id, how, clock: Math.round(gameClock().seconds) });
    saveJournal();
  } else if (!state.game?.ongoing) {
    preChosen = id;
  }
}

/** Nouvelle partie : le BO choisi avant est gardé ; sinon l'écran de choix (ou les BO de la civ). */
async function startGame(game: DetectedGame, seenAtClock: number | null = null) {
  const miniByChoice = state.mini && !state.finished;
  state.civ = game.myCivilization;
  state.style = "";
  state.finished = false;
  endChoice(false);
  if (journal.some((e) => e.gameId === game.id)) {
    // BoGo relancé en pleine partie : rien à reproposer.
    saveSession();
    if (state.view !== "play") showLibrary(game.myCivilization);
    return;
  }
  const entry = newEntry(game, Date.now());
  // Horloge lue quand AoE4World a vu la partie : mesure son délai (réglage de GRACE_SECONDS).
  entry.seenAtClock = seenAtClock;
  journal.push(entry);
  saveJournal();
  // Choisi avant la partie : il reste ton choix tant qu'il est le BO en cours (voir plus bas).
  const pre = preChosen;
  preChosen = null;
  const adviceGame = {
    kind: game.kind,
    civ: game.myCivilization,
    randomCiv: game.randomCiv,
    opponentCiv: soloOpponent(game),
    map: game.map,
    // Personnalisée à plusieurs (AoE4World omet les IA) : plus d'un joueur listé hors 1v1, en face ou à côté.
    team: !game.oneVsOne && game.players > 1,
  };
  const past = journal.filter((e) => e !== entry);
  if (pre && pre === state.currentId && filterBuilds(state.library, game.myCivilization, "").some((b) => b.id === pre)) {
    // BO choisi avant la partie : rien ne change, pas de compte à rebours ; les touches de
    // catégorie permettent encore de changer d'avis jusqu'au passage d'âge.
    entry.launches.push({ buildId: pre, how: "pre", clock: 0 });
    entry.rule = "pre";
    const offer: Offer = {
      game,
      advice: null,
      picks: categoryPicks(state.library, past, adviceGame),
      countdownEnd: null,
      autoOff: null,
      until: Date.now() + CHOICE_MS,
    };
    state.offer = offer;
    setTimeout(() => state.offer === offer && endChoice(), CHOICE_MS);
    state.view = "play";
    saveSession();
    return render();
  }
  const advice = adviseBuild(state.library, past, adviceGame, Date.now(), state.matchups);
  state.mini = false;
  if (!advice) {
    // Rien à conseiller (aucun BO utilisable, Empire Wars, Nomade) : la liste des BO de la civ.
    return showLibrary(game.myCivilization);
  }
  // La tuile allumée montre le BO proposé, et sa touche le lance.
  const picks = { ...categoryPicks(state.library, past, adviceGame), [advice.build.style]: advice.build };
  // Tes matchups se contredisent : l'autre BO garde sa touche de catégorie (si ce n'est pas la même).
  if (advice.also && advice.also.build.style !== advice.build.style) picks[advice.also.build.style] = advice.also.build;
  entry.rule = advice.rule;
  const offer: Offer = {
    game,
    advice,
    picks,
    countdownEnd: null,
    autoOff: advice.autoOff ?? (await momentBlocker(advice.build, miniByChoice)),
    until: Date.now() + CHOICE_MS,
  };
  state.offer = offer;
  state.view = "choice";
  state.mini = miniByChoice;
  saveSession();
  if (!offer.autoOff) startCountdown();
  setTimeout(() => state.offer === offer && endChoice(), CHOICE_MS);
  if (state.locked) setLocked(false);
  else render();
}

/** Garde-fous du moment : BoGo réduit ou masqué, partie déjà avancée, répartition à l'écran. */
async function momentBlocker(build: SavedBuild, miniByChoice: boolean): Promise<string | null> {
  if (miniByChoice) return "BoGo réduit";
  if (!(await appWindow.isVisible().catch(() => true))) return "BoGo masqué";
  const { seconds, read } = gameClock();
  if (seconds > (read ? 120 : 180)) return `partie déjà commencée (${formatClock(seconds)})`;
  // Garde-fou sans commentaire sur ta partie (le lancement auto ne joue qu'en VS) : pas de « répartition ».
  if (state.hud && hudIsFresh() && distributionMismatch(build.build, state.hud.reading)) return "ce BO ne commence pas comme ta partie";
  return null;
}

function startCountdown() {
  const offer = state.offer!;
  const end = Date.now() + COUNTDOWN_SECONDS * 1000;
  offer.countdownEnd = end;
  const tick = () => {
    if (state.offer !== offer || offer.countdownEnd !== end) return;
    const left = end - Date.now();
    if (left <= 50) return play(offer.advice!.build.id, "auto");
    if (state.view === "choice" && !state.mini) render();
    countdownTimer = window.setTimeout(tick, Math.min(1000, left));
  };
  countdownTimer = window.setTimeout(tick, 1000);
}

/** Compte à rebours arrêté sans refus : BO lancé, écran de choix quitté ou réduit. */
function stopCountdown() {
  clearTimeout(countdownTimer);
  const offer = state.offer;
  if (offer?.countdownEnd) {
    offer.countdownEnd = null;
    offer.autoOff = "interrompu";
  }
}

/** Lancement automatique annulé : un refus (deux de suite avec la civ le coupent). */
function refuseCountdown() {
  const offer = state.offer;
  if (!offer?.countdownEnd) return;
  clearTimeout(countdownTimer);
  offer.countdownEnd = null;
  offer.autoOff = REFUSED;
  const entry = gameEntry();
  if (entry) {
    entry.refused = true;
    saveJournal();
  }
  render();
}

/** Raccourci de catégorie : lance son BO, jusqu'au passage d'âge (même après un lancement). */
function pickCategory(style: Style) {
  const pick = state.offer?.picks[style];
  if (pick && !(pick.id === state.currentId && state.view === "play")) play(pick.id);
}

/** Fin du choix (passage d'âge, 5 min, nouvelle partie) : ses raccourcis sont libérés. */
function endChoice(redraw = true) {
  stopCountdown();
  if (!state.offer) return;
  state.offer = null;
  if (state.view === "choice") state.view = state.civ ? "civ" : "civs";
  if (redraw) render();
}

/** Premier passage d'âge : noté au journal (il fixe le BO gardé), fin du choix. */
function noteAgeUp() {
  const entry = gameEntry();
  if (entry && entry.ageUpAt === null) {
    entry.ageUpAt = Math.round(gameClock().seconds);
    saveJournal();
  }
  endChoice();
}

/** BoGo a coaché cette partie (Entraînement) : noté au journal, une fois. */
function noteCoached() {
  const entry = gameEntry();
  if (!entry || entry.coached) return;
  entry.coached = true;
  saveJournal();
}

/** Étape passée par le moteur alors que le BO en cours a été lancé tout seul : il est suivi. */
function noteAutoStep() {
  const entry = gameEntry();
  const last = entry?.launches[entry.launches.length - 1];
  if (!entry || last?.how !== "auto" || last.buildId !== state.currentId) return;
  entry.autoSteps += 1;
  saveJournal();
}

/** Raccourcis que le système a refusés (déjà pris par une autre appli), affichés dans ⚙. */
let hotkeyErrors: Partial<Record<HotkeyAction, string>> = {};

const HOTKEY_HANDLERS: Record<HotkeyAction, () => unknown> = {
  next: () => goToStep(state.step + 1),
  previous: () => goToStep(state.step - 1),
  lock: () => setLocked(!state.locked),
  mini: () => toggleMini(),
  toggle: async () => ((await appWindow.isVisible()) ? appWindow.hide() : appWindow.show()),
  launch: () => state.view === "choice" && state.offer?.advice && play(state.offer.advice.build.id),
  cancel: () => refuseCountdown(),
  cat1: () => pickCategory("boom"),
  cat2: () => pickCategory("agressif"),
  cat3: () => pickCategory("fast-castle"),
  cat4: () => pickCategory("autre"),
};

/** Raccourcis de choix seulement pendant le choix du début de partie, et dans ⚙ pour les vérifier. */
function wantedHotkeys(): HotkeyAction[] {
  const choice = state.view === "settings" || (!!state.offer && Date.now() < state.offer.until);
  return HOTKEY_ACTIONS.filter((a) => choice || !a.choice).map((a) => a.action);
}
let registeredHotkeys = "";
let hotkeyQueue = Promise.resolve();

/** Une inscription à la fois : deux à la fois se désinscriraient l'une l'autre. */
function registerHotkeys(): Promise<void> {
  registeredHotkeys = wantedHotkeys().join();
  hotkeyQueue = hotkeyQueue.then(doRegisterHotkeys, doRegisterHotkeys);
  return hotkeyQueue;
}

async function doRegisterHotkeys() {
  // Pendant la saisie d'un raccourci dans ⚙, aucun n'est actif ; la fin de saisie les remet.
  if (capture) return;
  hotkeyErrors = {};
  const wanted = wantedHotkeys();
  registeredHotkeys = wanted.join();
  await unregisterAll().catch(() => {});
  for (const action of wanted) {
    try {
      await register(HOTKEYS[action], (event) => {
        if (event.state === "Pressed") HOTKEY_HANDLERS[action]();
      });
    } catch (err) {
      hotkeyErrors[action] = errorText(err);
    }
  }
}

async function importBuild(input: string, style: Style) {
  const text = input.trim();
  if (!text) return;
  if (!text.startsWith("{")) {
    const id = extractBuildId(text);
    if (id) return importFromGuides(id, style);
    state.importStatus = { text: "Colle un lien aoe4guides.com/builds/… ou le JSON de l'export Overlay Tool.", error: true };
    return render();
  }
  try {
    saveImported(parseBuildOrder(text), style);
  } catch (err) {
    state.importStatus = { text: errorText(err), error: true };
  }
  render();
}

/** Importe un BO d'aoe4guides : depuis un lien collé ou depuis la fenêtre aoe4guides. */
async function importFromGuides(id: string, style: Style) {
  state.importStatus = { text: "Import en cours…", error: false };
  render();
  try {
    saveImported(await fetchBuild(id), style, `https://aoe4guides.com/builds/${id}`);
  } catch (err) {
    state.importStatus = { text: errorText(err), error: true };
  }
  render();
}

function saveImported(build: BuildOrder, style: Style, sourceUrl?: string) {
  state.library = addBuild(state.library, build, style, sourceUrl);
  saveLibrary(localStorage, state.library);
  // Le BO en cours, réimporté (même identifiant) : son étape reste dans les limites du nouveau.
  const playing = current();
  const replaced = state.library.find((b) => b.build === build);
  if (replaced) englishBuilds.delete(replaced.id);
  if (playing?.build === build) {
    state.step = Math.min(state.step, build.build_order.length - 1);
    saveSession();
    resetEngine();
  }
  const civs = civilizationsOf(build).join(", ");
  state.importStatus = { text: `« ${build.name} » ajouté (${civs}, ${STYLES[style]}).`, error: false };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let polling = false;
/** Partie (epoch) du dernier sondage fait pendant une partie, pour mesurer le délai d'AoE4World. */
let lastPollEpoch: number | null = null;

/** Un seul appel AoE4World à la fois : une réponse lente ne doit pas doubler la suivante. */
async function pollGame() {
  const { profileId, apiKey } = state.settings;
  if (!profileId || polling) return;
  polling = true;
  // Horloge et partie au départ du sondage : ce qu'AoE4World répond vaut pour ce moment-là.
  const poll: PollStart = { clock: clock.current(Date.now()), epoch: modeMemory.epoch };
  try {
    const game = await fetchLastGame(profileId, apiKey);
    if (profileId !== state.settings.profileId) return;
    const wasTraining = mode() === "training";
    state.gameError = null;
    state.game = game;
    noteOpposition(game, poll, wasTraining);
    const sawEarlier = lastPollEpoch === poll.epoch && poll.clock !== null;
    lastPollEpoch = poll.clock !== null ? poll.epoch : null;
    if (game?.ongoing && game.id !== state.handledGameId) {
      state.handledGameId = game.id;
      await journalReady;
      // Délai d'AoE4World : mesuré seulement si un sondage précédent de cette partie ne la voyait pas.
      await startGame(game, sawEarlier ? poll.clock : null);
      return;
    }
  } catch (err) {
    state.gameError = errorText(err);
  } finally {
    polling = false;
  }
  // Sans nouvelle partie, on ne rafraîchit que l'en-tête pour ne pas effacer une saisie en cours.
  refreshHeader();
}

function refreshHeader() {
  const saved = current();
  app.querySelector("header")?.replaceWith(state.view === "play" && saved ? playHeader(saved) : header());
}

/** `keepError` : relance automatique, on garde la raison de l'arrêt affichée. */
async function startVision(keepError = false) {
  state.vision = { status: "", error: keepError ? state.vision.error : null };
  try {
    await invoke("start_vision");
  } catch (err) {
    state.vision.error = errorText(err);
    refreshHeader();
  }
}

/** Texte lu en haut au centre (âge, passage d'âge en cours), affiché dans les réglages. */
let topText = "";
/** Applis avec des fenêtres quand GeForce Now n'a pas été trouvé (pour comprendre pourquoi). */
let visionApps: string[] = [];
/** Landmark en construction en haut de l'écran : un passage d'âge signalé une seule fois. */
const landmark = new LandmarkWatch();
/** Relances automatiques de la lecture de l'écran depuis la dernière lecture réussie. */
let visionRestarts = 0;

function onVision(event: VisionEvent) {
  if (event.type === "top") {
    topText = event.tokens.map((t) => t.text).join(" ");
    // Deux lectures de suite, une seule fois par landmark (voir LandmarkWatch).
    const ageUp = landmark.observe(event.tokens, Date.now());
    if (ageUp) noteAgeUp();
    if (ageUp && engine) {
      engine.ageUpStarted();
      if (!state.finished && engine.state().completed) {
        finishBuild();
        return;
      }
      if (engine.index !== state.step) {
        state.step = engine.index;
        state.engine = engine.state();
        saveSession();
        if (state.view === "play") render();
      }
    }
    return;
  }
  if (event.type === "hud") {
    visionRestarts = 0;
    const reading = parseHud(event.tokens);
    if (!reading) return;
    const now = Date.now();
    state.hud = { reading, at: now };
    if (engine) {
      engine.coaching = features().coaching;
      if (engine.coaching) noteCoached();
      state.engine = engine.update(reading, now);
      // Le journal ne compte une étape « suivie » que si sa répartition était faite (même en VS).
      if (state.engine.index > state.step && engine.followed(state.step)) noteAutoStep();
      if (state.engine.index !== state.step) {
        state.step = state.engine.index;
        saveSession();
      }
      // Objectif de la dernière étape atteint (âge ou TC payé, ou villageois tenus 10 s).
      if (!state.finished && state.engine.completed) {
        finishBuild();
        return;
      }
    }
    if (state.view === "play") render();
    else updateVisionStatus();
    return;
  }
  if (event.type === "clock") {
    if (clock.read(event.seconds, Date.now()) === null) return;
    noteClock(event.seconds);
    const build = current();
    // L'horloge ne pilote le BO que si le panneau des villageois n'est pas lu, et ne fait
    // jamais reculer : un joueur en avance sur les temps du guide le reste.
    const target = build && !hudIsFresh() ? stepForClock(build.build.build_order, event.seconds) : null;
    if (target !== null && target !== state.autoStep && target > state.step) {
      state.autoStep = target;
      state.step = target;
      engine?.setStep(target, "horloge du jeu");
      saveSession();
    }
    // La vue de jeu n'a pas de champ de saisie : on peut la redessiner chaque seconde.
    if (state.view === "play") render();
    else updateVisionStatus();
    return;
  }
  if (event.type === "error") state.vision.error = event.message;
  else if (event.type === "status") {
    state.vision = { status: event.code, error: null };
    visionApps = event.apps ?? [];
  }
  else {
    // Arrêt inattendu : on garde la raison, puis on relance (3 fois au plus d'affilée).
    state.vision.status = "stopped";
    const reason = [event.status, event.detail].filter(Boolean).join(" : ");
    if (reason) state.vision.error ??= `Lecture de l'écran arrêtée (${reason}).`;
    if (state.settings.readScreen && visionRestarts < 3) {
      visionRestarts++;
      setTimeout(() => startVision(true), 5000);
    }
  }
  if (state.view === "play") render();
  else updateVisionStatus();
}

function updateVisionStatus() {
  document.querySelector("#vision-status")?.replaceWith(visionStatus());
  // Passé en VS pendant que ⚙ est ouvert : le journal des étapes (avec ses comptes) disparaît.
  if (!features().liveCounts) document.querySelector(".step-log")?.remove();
}

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return {
      profileId: String(s.profileId ?? ""),
      apiKey: String(s.apiKey ?? ""),
      readScreen: s.readScreen !== false,
      translate: s.translate !== false,
      iconNames: s.iconNames !== false,
      showNext: s.showNext === true,
      record: s.record === true,
      scale: clampScale(Number(s.scale ?? 100)),
      hotkeys: typeof s.hotkeys === "object" && s.hotkeys ? s.hotkeys : {},
    };
  } catch {
    return { profileId: "", apiKey: "", readScreen: true, translate: true, iconNames: true, showNext: false, record: false, scale: 100, hotkeys: {} };
  }
}


function clampScale(scale: number): number {
  return Number.isFinite(scale) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(scale / 5) * 5)) : 100;
}

/** Zoom de toute l'interface ; la fenêtre suit (voir fitWindow). */
function applyScale() {
  getCurrentWebview()
    .setZoom(state.settings.scale / 100)
    .catch(() => {});
  windowSize = "";
  fitWindow();
}

function saveSettings(settings: Settings) {
  const wasReading = state.settings.readScreen;
  const previous = state.settings;
  state.settings = settings;
  store(SETTINGS_KEY, settings);
  if (!settings.record && previous.record) {
    invoke("set_recording", { enabled: false }).catch(() => {});
    state.recording = { path: null, error: null };
  }
  // Autre profil : sa partie en cours n'a pas encore été proposée.
  if (settings.profileId !== previous.profileId) state.handledGameId = null;
  pollGame();
  if (SCREEN_READING && settings.readScreen && !wasReading) startVision();
  if (!settings.readScreen && wasReading) {
    invoke("stop_vision");
    state.vision = { status: "", error: null };
  }
}

function saveSession() {
  store(SESSION_KEY, { currentId: state.currentId, step: state.step, civ: state.civ, handledGameId: state.handledGameId });
}

/** Écrit dans localStorage sans jamais faire échouer l'action en cours (quota, mode privé). */
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Rien à faire : la session continue en mémoire.
  }
}

function restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}");
    if (typeof s.civ === "string") state.civ = s.civ;
    // La partie déjà proposée n'est pas re-proposée après un redémarrage en cours de partie.
    if (Number.isInteger(s.handledGameId)) state.handledGameId = s.handledGameId;
    if (typeof s.currentId === "string" && state.library.some((b) => b.id === s.currentId)) {
      state.currentId = s.currentId;
      // Le BO a pu être réimporté plus court : l'étape reste dans ses limites.
      const length = state.library.find((b) => b.id === s.currentId)!.build.build_order.length;
      state.step = Number.isInteger(s.step) ? Math.max(0, Math.min(s.step, length - 1)) : 0;
      state.view = "play";
    }
  } catch {
    // Session illisible : on repart de la bibliothèque.
  }
}

// ---------- Rendu ----------

function render() {
  if (state.view !== "settings" || state.mini) {
    if (capture) endCapture(null);
    hotkeyMessage = null;
  }
  // Quitter (ou réduire) l'écran de choix arrête le compte à rebours, sans compter de refus.
  if (state.view !== "choice" || state.mini) stopCountdown();
  if (!capture && wantedHotkeys().join() !== registeredHotkeys) {
    registerHotkeys().then(() => state.view === "settings" && render());
  }
  document.body.classList.toggle("locked", state.locked);
  document.body.classList.toggle("mini", state.mini);
  if (state.mini) {
    app.replaceChildren(miniView());
    fitWindow();
    return;
  }
  const views = {
    civs: civsView,
    civ: civView,
    settings: settingsView,
    play: () => playView(current()!),
    choice: choiceView,
    matchups: matchupsView,
  };
  const view = state.view === "play" && !current() ? "civs" : state.view === "choice" && !state.offer ? "civ" : state.view;
  const body = (view === "civ" || view === "matchups") && !state.civ ? civsView() : views[view]();
  app.replaceChildren(view === "play" ? playHeader(current()!) : header(), body);
  fitWindow();
}

const PLAY_WIDTH = 360;
const PANEL_WIDTH = 380;
const MAX_HEIGHT = 680;
let windowSize = "";

/** La fenêtre prend la taille de son contenu : rien de vide ne cache le jeu. */
function fitWindow() {
  requestAnimationFrame(() => {
    const width = state.mini ? Math.ceil(app.getBoundingClientRect().width) : state.view === "play" ? PLAY_WIDTH : PANEL_WIDTH;
    const content = [...app.children].reduce(
      (sum, el) => sum + (el.tagName === "MAIN" ? el.scrollHeight : (el as HTMLElement).offsetHeight),
      2,
    );
    const height = Math.min(Math.ceil(content), MAX_HEIGHT);
    // Les mesures sont en pixels de la page : la fenêtre les multiplie par le zoom choisi.
    const zoom = state.settings.scale / 100;
    const size = `${width}x${height}@${zoom}`;
    if (size === windowSize) return;
    windowSize = size;
    appWindow.setSize(new LogicalSize(Math.round(width * zoom), Math.round(height * zoom))).catch(() => {});
  });
}

/** Quitter demande un second clic dans les 3 s : ✕ est petit et proche des autres boutons. */
function quitButton(): HTMLElement {
  const quit = button("✕", "Quitter BoGo", () => {
    if (quit.dataset.confirm) return invoke("quit");
    quit.dataset.confirm = "1";
    quit.textContent = "Quitter ?";
    quit.classList.add("confirm");
    setTimeout(() => {
      delete quit.dataset.confirm;
      quit.textContent = "✕";
      quit.classList.remove("confirm");
    }, 3000);
  });
  return quit;
}

/** Cadenas ; sans raccourci pour déverrouiller, le verrouillage est refusé (voir setLocked). */
function lockButton(): HTMLElement {
  const title = hotkeyErrors.lock
    ? "Verrouillage impossible : le raccourci « Verrouiller » est indisponible (voir ⚙ › Raccourcis)"
    : `Verrouiller : les clics passent au jeu (${KEYS.lock})`;
  return button(state.locked ? "🔒" : "🔓", title, () => setLocked(!state.locked));
}

function header(): HTMLElement {
  const bar = h("header", "bar");
  bar.dataset.tauriDragRegion = "";
  const title = h("span", "title", "BoGo", gameStatus());
  title.dataset.tauriDragRegion = "";
  const actions = h("div", "actions", modePill());
  if (current()) actions.append(button("▶", "Reprendre le BO", () => ((state.view = "play"), render())));
  actions.append(
    button("⚙", "Réglages", () => (state.view === "settings" ? showLibrary() : showSettings())),
    lockButton(),
    quitButton(),
  );
  bar.append(title, actions);
  return bar;
}

/** En-tête de partie : avancement en segments, étape, âge, horloge, et les boutons (discrets). */
function playHeader(saved: SavedBuild): HTMLElement {
  const steps = saved.build.build_order;
  const head = h("header", "play-head");
  head.dataset.tauriDragRegion = "";

  const progress = h("div", "segments");
  progress.dataset.tauriDragRegion = "";
  if (steps.length <= 24) {
    steps.forEach((_, i) => progress.append(h("i", i < state.step ? "done" : i === state.step ? "now" : "")));
  } else {
    progress.classList.add("bar-mode");
    const fill = h("i", "done");
    fill.style.width = `${((state.step + 1) / steps.length) * 100}%`;
    progress.append(fill);
  }
  const actions = h(
    "div",
    "actions",
    button("📚", "Bibliothèque", () => showLibrary()),
    button("⚙", "Réglages", () => showSettings()),
    button("▾", `Réduire (${KEYS.mini})`, () => toggleMini()),
    lockButton(),
    button("✕", `Masquer BoGo (${KEYS.toggle} pour le réafficher)`, () => hideOverlay()),
  );

  const step = steps[state.step];
  const age = step.age >= 1 && step.age <= 4 ? step.age : null;
  const where = h("span", "where");
  where.append(
    button("◀", `Étape précédente (${KEYS.previous})`, () => goToStep(state.step - 1)),
    h("span", "", "Étape ", h("b", "", `${state.step + 1}/${steps.length}`)),
    button("▶", `Étape suivante (${KEYS.next})`, () => goToStep(state.step + 1)),
  );
  if (age) where.append(h("span", "muted", " · "), gameIcon(`age/age_${age}.webp`, ""), h("span", "", ` Âge ${ROMAN[age]}`));
  const reading = readingState();
  shownReading = reading;
  head.append(
    h("div", "head-row", progress, actions, h("span", "lock-hint", `🔒 ${KEYS.lock}`)),
    h("div", "meta", where, modeBadge(), readingBadge(reading, saved.build.name)),
  );
  return head;
}

/** VS, IA… (vérification) ou IA : toujours visible en partie, jamais cliquable en jeu. */
function modeBadge(): HTMLElement {
  const { mode: m, why } = modeState();
  const key = m === "training" ? "training" : why === "checking" ? "checking" : "versus";
  const badge = h("span", `mode-badge ${key}`, MODE_LABELS[key].badge);
  badge.title = why === "humans" ? `${MODE_LABELS.versus.title}. Joueur détecté en face : VS jusqu'à la fin de la partie.` : MODE_LABELS[key].title;
  return badge;
}

/**
 * Bascule VS / IA de l'en-tête, hors jeu : à choisir avant une partie contre l'IA. Désactivée
 * quand un joueur est vu en face, ou sans profil AoE4World (rien ne pourrait être vérifié).
 */
function modePill(): HTMLElement {
  const { mode: m, why } = modeState();
  // Désactivée seulement si le joueur vu en face est dans la partie en cours ; une classée d'avant
  // encore « en cours » sur AoE4World impose VS mais laisse choisir IA pour la suivante.
  const now = Date.now();
  const current = (modeMemory.humansLocked && !!modeMemory.lastClock && now - modeMemory.lastClock.at < 60_000) || freshGame(state.game, clock.current(now), now);
  if (why === "humans" && current) {
    const pill = button("VS 🔒", "Joueur détecté en face : VS jusqu'à la fin de la partie.", () => {});
    pill.className = "mode-badge versus";
    pill.disabled = true;
    return pill;
  }
  if (!state.settings.profileId) {
    const pill = button("VS", "Entraînement indisponible : sans profil AoE4World, BoGo ne peut pas vérifier que ce n'est pas une classée.", () => {});
    pill.className = "mode-badge versus";
    pill.disabled = true;
    return pill;
  }
  const armed = modeMemory.armed;
  const title = !armed
    ? "VS : contre des joueurs, ton BO seulement, sans conseil calculé en direct. Clique avant une partie contre l'IA pour l'entraînement."
    : m === "training"
      ? `${MODE_LABELS.training.title}. Revient à VS à la fin de la partie. Clique pour revenir à VS.`
      : modeMemory.lastClock && Date.now() - modeMemory.lastClock.at < 60_000
        ? `${MODE_LABELS.checking.title}. Clique pour revenir à VS.`
        : "Entraînement contre l'IA pour ta prochaine partie. BoGo vérifie d'abord sur AoE4World que ce n'est ni une classée ni une partie rapide (1 min de jeu). Clique pour revenir à VS.";
  const label = !armed ? "VS" : m === "training" ? "IA" : "IA…";
  const pill = button(label, title, () => setTraining(!armed));
  pill.className = `mode-badge ${!armed ? "versus" : m === "training" ? "training" : "checking"}`;
  return pill;
}

type ReadingState = "ok" | "clock" | "off" | "stopped" | "waiting" | "manual";

/** État de la lecture de l'écran, toujours visible en partie : jamais de chiffres périmés présentés comme en direct. */
function readingState(now = Date.now()): ReadingState {
  if (!SCREEN_READING || !state.settings.readScreen) return "manual";
  if (state.vision.error) return "stopped";
  if (hudIsFresh(now)) return "ok";
  if (clock.current(now) !== null) return "clock";
  return state.hud ? "off" : "waiting";
}

/** Forme + texte (pas seulement la couleur) : rond = lu, carré = coupé, losange = arrêté. */
function readingBadge(reading: ReadingState, boName: string): HTMLElement {
  const gameTime = clock.current(Date.now());
  const time = gameTime !== null ? `⏱ ${formatClock(gameTime)}` : "";
  const badges: Record<ReadingState, [string, string, string]> = {
    ok: ["ok", time, "Lecture de l'écran OK"],
    clock: ["warn", time, "Horloge lue, mais panneau des villageois illisible : BoGo suit l'horloge du BO"],
    off: ["warn", "Lecture coupée", `Plus rien n'est lu à l'écran : avance avec ${KEYS.next}`],
    stopped: ["bad", "Lecture arrêtée", state.vision.error ?? ""],
    waiting: ["wait", boName, "En attente de la première lecture de l'écran"],
    manual: ["manual", boName, `Suivi manuel : ${KEYS.next} étape suivante`],
  };
  const [kind, text, title] = badges[reading];
  const badge = h("span", `reading ${kind}`, h("i", "dot"), text);
  badge.title = title;
  return badge;
}

/** État de lecture affiché au dernier rendu de la vue de jeu (voir le minuteur en fin de fichier). */
let shownReading: ReadingState | "" = "";

const ROMAN: Record<number, string> = { 1: "I", 2: "II", 3: "III", 4: "IV" };
/** Villageois en plus (répartition pas suivie) à partir desquels on propose de passer l'étape. */
const DRIFT_HINT = 3;

/**
 * Vue de partie, du plus important au détail : alerte (s'il y en a une), action à faire
 * en grand, répartition réel / cible, consignes traduites, puis l'étape suivante.
 */
function playView(saved: SavedBuild): HTMLElement {
  const steps = saved.build.build_order;
  const step = steps[state.step];
  const next = steps[state.step + 1];
  const hud = hudIsFresh() ? state.hud!.reading : null;
  const auto = hud && state.engine?.index === state.step ? state.engine : null;
  const translate = shouldTranslate(saved);
  // Versus : rien de calculé sur la partie en cours, seulement le BO tel qu'il est écrit.
  const f = features();
  const live = projectLive(f, hud, auto);

  const view = h("main", "play");
  const reading = readingState();
  if (modeNotice && Date.now() < modeNotice.until) view.append(h("div", "alert warn", modeNotice.text));
  if (reading === "off") view.append(h("div", "alert warn", `Suivi auto coupé : avance avec ${KEYS.next}`));
  if (reading === "stopped") view.append(h("div", "alert", "Lecture de l'écran arrêtée : voir ⚙"));
  const alert = f.alerts ? alertBanner(live.engine, live.hud) : null;
  if (alert) view.append(alert);
  // Icônes déjà nommées en grand au-dessus : pas de nom répété dans les consignes.
  const named = new Set<string>();

  // Passage d'âge ou TC : même sans lecture du panneau (coûts affichés comme cibles).
  const goal = auto ? auto.goal : stepGoal(steps, state.step);
  if (goal.kind !== "villagers") {
    const cost = auto ? auto.cost : (goalCosts(goal, playedCivilization(saved))[0] ?? null);
    view.append(goalBlock(goal, cost, live.hud?.stock ?? null, live.engine?.affordable ?? false, step, named));
  } else {
    const hero = heroBlock(steps, f.liveHero ? live.hud : null, live.engine?.villagers ?? null, named);
    if (hero) view.append(hero);
    view.append(bulletList(step, effectiveVillagerTargets(steps)[state.step], live.hud, live.engine?.villagers ?? null));
    // Villageois en plus sans la répartition de l'étape (attaque, choix du joueur) : BoGo ne
    // saute pas l'étape tout seul, il propose de le faire.
    if (f.drift && live.engine && live.engine.drift >= DRIFT_HINT) {
      view.append(h("div", "drift", `+${live.engine.drift} villageois sans suivre cette étape : ${KEYS.next} pour passer à la suite`));
    }
  }
  view.append(notes(step.notes, "notes", translate, named));
  // L'étape suivante seulement si le joueur la demande : une étape à la fois, l'essentiel à l'écran.
  if (next && state.settings.showNext) {
    view.append(h("div", "next", h("span", "muted", "Ensuite · "), ...noteParts(next.notes[0] ?? "", translate, named)));
  }
  return view;
}

/** Une seule alerte à la fois : erreur de répartition d'abord, puis villageois inactifs. */
function alertBanner(auto: EngineState | null, hud: HudReading | null): HTMLElement | null {
  const m = auto?.misplacement;
  if (m) {
    // Le nombre exact à déplacer : « 3 de trop à la nourriture → envoies-en 2 au bois ».
    const alert = h("div", "alert", `⚠ ${m.excess} villageois de trop ${RESOURCE_PLACE[m.from]} `, resourceIcon(m.from));
    if (m.to) {
      const move = m.count < m.excess ? `envoies-en ${m.count}` : m.count > 1 ? "envoie-les" : "envoie-le";
      alert.append(` → ${move} ${RESOURCE_PLACE[m.to]} `, resourceIcon(m.to));
    }
    return alert;
  }
  if (hud && hud.idle > 0) {
    const plural = hud.idle > 1 ? "s" : "";
    return h("div", "alert warn", gameIcon(VILLAGER_ICON, "💤"), ` ${hud.idle} villageois inactif${plural}`);
  }
  return null;
}

const RESOURCE_PLACE: Record<Resource, string> = {
  food: "à la nourriture",
  wood: "au bois",
  gold: "à l'or",
  stone: "à la pierre",
};

/**
 * Où envoyer le prochain villageois produit (point de ralliement) : une grande icône, sans
 * chiffre (voir `heroModel`). Les icônes nommées ici ne le sont plus dans les consignes.
 */
function heroBlock(steps: BuildOrderStep[], hud: HudReading | null, villagers: number | null, named: Set<string>): HTMLElement | null {
  // Sans lecture (ou en Versus) : la ressource que l'étape ajoute, telle qu'écrite.
  const hero = heroModel(steps, state.step, hud?.gatherers ?? null, hud ? villagers : null);
  if (!hero) return null;
  for (const path of hero.named) named.add(path);
  const fallback = hero.resource ? RESOURCE_ICONS[hero.resource][0] : "🔨";
  const tile = h(
    "div",
    hero.resource ? `tile ${hero.resource}` : "tile goal-tile",
    hero.icon ? gameIcon(hero.icon, fallback) : fallback,
  );
  const text = h("div", "hero-text", h("div", "big", hero.word));
  if (hero.detail) text.append(h("div", "sub", hero.detail));
  if (hero.dropOff) {
    text.append(h("div", "sub", "il construit un ", gameIcon(hero.dropOff.path, ""), ` ${hero.dropOff.label}`));
  }
  return h("div", "primary", h("div", "kicker", "PROCHAIN VILLAGEOIS"), h("div", "action", tile, text));
}

/** Passage d'âge ou TC à poser : vert et « clique ! » dès qu'on a de quoi payer. */
function goalBlock(
  goal: StepGoal,
  cost: Cost | null,
  stock: HudReading["stock"] | null,
  affordable: boolean,
  step: BuildOrderStep,
  named: Set<string>,
): HTMLElement {
  const isAge = goal.kind === "age";
  const age = goal.kind === "age" ? goal.age : 0;
  const tile = h("div", "tile goal-tile", gameIcon(isAge ? `age/age_${age}.webp` : TC_ICON, isAge ? "⬆" : "🏰"));
  const text = h("div", "hero-text", h("div", "big", isAge ? `ÂGE ${ROMAN[age] ?? age}` : "NOUVEAU TC"));
  const landmark = isAge ? stepLandmark(step) : null;
  const sub = h("div", "sub", isAge ? (AGE_NAMES[age] ?? "").replace(/^[IV]+ · /, "") : "Town Center");
  if (landmark) {
    sub.append(" · ", gameIcon(landmark.path, ""), ` ${landmark.label}`);
    named.add(landmark.path);
  }
  if (!isAge) named.add(TC_ICON);
  text.append(sub);

  const costs = h("div", "bullets");
  for (const [r, amount] of Object.entries(cost ?? {}) as [Resource, number][]) {
    costs.append(bulletRow(r, stock ? stock[r] : null, amount, { cost: true }));
  }
  const block = h(
    "div",
    affordable ? "primary ready" : "primary",
    h("div", "kicker", isAge ? "PASSAGE D'ÂGE" : "NOUVEAU TC"),
    h("div", "action", tile, text),
    costs,
  );
  block.append(
    affordable ? h("div", "cta", "C'est le moment : clique !") : h("div", "sub", "Garde les ressources pour ça"),
  );
  return block;
}

/** Civ jouée (partie détectée), sinon celle du BO : elle fixe le coût des passages d'âge et du TC. */
function playedCivilization(saved: SavedBuild): string {
  return state.game?.ongoing ? state.game.myCivilization : civilizationsOf(saved.build)[0];
}

/** Barres réel / cible : villageois, puis chaque ressource utile à l'étape. */
function bulletList(step: BuildOrderStep, vilTarget: number, hud: HudReading | null, estimated: number | null): HTMLElement {
  const list = h("div", "bullets");
  const villagers = hud ? (estimated ?? hud.villagers) : null;
  if (vilTarget > 0) list.append(bulletRow("villagers", hud ? villagers : null, vilTarget));
  for (const r of RESOURCES) {
    const target = step.resources[r];
    // -1 signifie « non précisé » dans le format RTS_Overlay.
    if (target < 0) continue;
    const have = hud ? hud.gatherers[r] : null;
    if (target === 0 && !have) continue;
    list.append(bulletRow(r, have, target));
  }
  const builder = step.resources.builder;
  if (builder !== undefined && builder > 0) list.append(h("div", "builders muted", `🔨 ${builder} bâtisseur${builder > 1 ? "s" : ""}`));
  return list;
}

/**
 * Une ligne réel / cible. Sans lecture du panneau, seule la cible est affichée.
 * Pour un coût (`cost`), en avoir plus que nécessaire est une bonne nouvelle.
 */
function bulletRow(
  key: Resource | "villagers",
  have: number | null,
  target: number,
  { cost = false } = {},
): HTMLElement {
  const name = key === "villagers" ? "Villageois" : RESOURCE_ICONS[key][1];
  const iconEl = key === "villagers" ? gameIcon(VILLAGER_ICON, "👤") : resourceIcon(key);
  const row = h("div", `bullet ${key}`, iconEl);
  if (have === null) {
    // Un coût est un montant ; une cible de villageois est « visée ».
    row.append(h("div", "label", name[0].toUpperCase() + name.slice(1)), h("div", "value num", `${target}`, cost ? "" : h("small", "", " visés")));
    return row;
  }
  const track = h("div", "track");
  if (cost) {
    const fill = h("span", "fill");
    fill.style.width = `${Math.min(have / Math.max(target, 1), 1) * 100}%`;
    if (have >= target) fill.classList.add("ok");
    track.append(fill);
  } else {
    const scale = Math.max(have, target, 1);
    const fill = h("span", "fill");
    fill.style.width = `${(Math.min(have, target) / scale) * 100}%`;
    const mark = h("span", "target");
    mark.style.left = `calc(${(target / scale) * 100}% - 1px)`;
    track.append(fill, mark);
    if (have > target) {
      const over = h("span", "over");
      over.style.left = `${(target / scale) * 100}%`;
      track.append(over);
    }
  }
  const good = cost ? have >= target : have === target;
  const bad = !cost && have > target;
  const value = h("div", `value num${good ? " ok" : bad ? " bad" : ""}`, `${have}`, h("small", "", `/${target}`));
  if (good) value.append(" ✓");
  if (bad) value.append(h("small", "", ` +${have - target}`));
  row.append(h("div", "", h("div", "label", name[0].toUpperCase() + name.slice(1)), track), value);
  return row;
}

/** Mode réduit : une pastille. « BO terminé » ou l'étape, l'horloge, et les inactifs s'il y en a. */
function miniView(): HTMLElement {
  const saved = current();
  const pill = h("div", "pill");
  pill.dataset.tauriDragRegion = "";
  if (state.finished || !saved) pill.append(h("span", "done", "✓ BO terminé"));
  else pill.append(h("span", "", "Étape ", h("b", "", `${state.step + 1}/${saved.build.build_order.length}`)));
  if (saved) pill.append(h("span", "muted", saved.build.name));
  const gameTime = clock.current(Date.now());
  if (gameTime !== null) pill.append(h("span", "clock", `⏱ ${formatClock(gameTime)}`));
  if (mode() === "training") pill.append(h("span", "mode-badge training", MODE_LABELS.training.badge));
  const hud = projectLive(features(), hudIsFresh() ? state.hud!.reading : null, null).hud;
  if (hud && hud.idle > 0) pill.append(h("span", "warn", gameIcon(VILLAGER_ICON, "💤"), ` ${hud.idle} inactif${hud.idle > 1 ? "s" : ""}`));
  pill.append(button("▴", `Agrandir (${KEYS.mini})`, () => toggleMini()));
  for (const child of pill.querySelectorAll("span")) child.dataset.tauriDragRegion = "";
  return pill;
}

const englishBuilds = new Map<string, boolean>();

function shouldTranslate(saved: SavedBuild): boolean {
  if (!state.settings.translate) return false;
  if (!englishBuilds.has(saved.id)) englishBuilds.set(saved.id, looksEnglish(saved.build));
  return englishBuilds.get(saved.id)!;
}

function resourceIcon(r: Resource): HTMLElement {
  return gameIcon(RESOURCE_ICONS[r][2], RESOURCE_ICONS[r][0]);
}

/** Icône du jeu ; si elle ne charge pas (hors ligne), l'emoji de remplacement. */
function gameIcon(path: string, fallback: string): HTMLElement {
  const img = document.createElement("img");
  img.className = "icon";
  img.src = ICON_BASE + path;
  img.alt = fallback;
  img.onerror = () => img.replaceWith(fallback);
  return img;
}

function notes(lines: string[], className: string, translate: boolean, named = new Set<string>()): HTMLElement {
  const list = h("ul", className);
  for (const line of lines) list.append(h("li", "", ...noteParts(line, translate, named)));
  return list;
}

/**
 * Consigne du BO : texte (traduit si besoin, « -> » en vraie flèche) et icônes du jeu. Une
 * icône peu connue (baies, bâtiment, unité d'une nouvelle civ) est suivie de son nom, sauf
 * si le texte juste à côté le dit déjà, ou si elle est déjà nommée en grand (`named`).
 */
function noteParts(line: string, translate: boolean, named = new Set<string>()): (Node | string)[] {
  const parts = tokenizeNote(line).map((part) => {
    if (part.kind === "image") return part;
    const text = part.text.replace(/->/g, "→");
    return translate ? translateText(text) : text;
  });
  return parts.map((part, i) => {
    if (typeof part === "string") return part;
    const label = iconLabel(part.path);
    const before = parts[i - 1];
    const after = parts[i + 1];
    const near = `${typeof before === "string" ? before.slice(-25) : ""} ${typeof after === "string" ? after.slice(0, 25) : ""}`;
    const showName =
      state.settings.iconNames &&
      !isWellKnownIcon(part.path) &&
      !named.has(part.path) &&
      !near.toLowerCase().includes(label.toLowerCase());
    return icon(part.path, label, showName);
  });
}

/** Icône d'une consigne ; son nom à côté (`named`) ou, si l'image ne charge pas, à sa place. */
function icon(path: string, label: string, named: boolean): HTMLElement {
  const img = document.createElement("img");
  img.className = "icon";
  img.src = ICON_BASE + path;
  img.alt = img.title = label;
  if (!named) {
    img.onerror = () => img.replaceWith(h("span", "icon-text", label));
    return img;
  }
  img.onerror = () => img.remove();
  return h("span", "named", img, h("span", "icon-name", label));
}

function showLibrary(civ = state.civ) {
  state.civ = civ;
  state.view = civ ? "civ" : "civs";
  saveSession();
  if (state.locked) setLocked(false);
  else render();
}

function showSettings() {
  state.view = "settings";
  if (state.locked) setLocked(false);
  else render();
}

const NOTICE_KEY = "bogo.notice.v1";

/** Une fois, après la mise à jour : en VS, les alertes ne sont plus là, et c'est voulu. */
function newsCard(): HTMLElement | "" {
  try {
    if (JSON.parse(localStorage.getItem(NOTICE_KEY) ?? "null") === "modes") return "";
  } catch {
    return "";
  }
  const ok = button("Compris", "Ne plus afficher", () => {
    store(NOTICE_KEY, "modes");
    render();
  });
  return h(
    "div",
    "news",
    h("strong", "", "Nouveau : deux modes"),
    h(
      "p",
      "",
      "Contre des joueurs (VS, par défaut), BoGo n'affiche plus que ton BO, sans alertes ni comptes en direct. " +
        "Pour t'entraîner avec tout le coaching, clique VS → IA en haut avant une partie contre l'IA.",
    ),
    ok,
  );
}

function civsView(): HTMLElement {
  const view = h("main", "civs");
  view.append(newsCard());
  if (state.game?.ongoing) view.append(gameBanner(state.game));

  const grid = h("div", "civ-grid");
  for (const civ of CIVILIZATIONS) {
    const count = filterBuilds(state.library, civ, "").length;
    const tile = h("button", "civ-tile", flag(civ), h("span", "civ-name", civ));
    if (count) tile.append(h("span", "civ-count", String(count)));
    tile.title = `${civ} : ${count} BO`;
    tile.onclick = () => showLibrary(civ);
    grid.append(tile);
  }
  view.append(guidesButton(), grid, importForm(), h("p", "hint", hotkeyHint()));
  return view;
}

function civView(): HTMLElement {
  const civ = state.civ;
  const view = h("main", "civ");
  view.append(newsCard());
  const back = button("←", "Toutes les civilisations", () => showLibrary(""));
  const rules = state.matchups.rules.filter((r) => r.civ === civ).length;
  const matchups = button(rules ? `🎯 Matchups (${rules})` : "🎯 Matchups", `BO de base et règles contre une civ ou sur une carte, pour ${civ}`, () => showMatchups());
  view.append(h("div", "civ-header", back, flag(civ), h("strong", "", civ), h("span", "spacer"), matchups));
  if (state.game?.ongoing && state.game.myCivilization === civ) view.append(gameBanner(state.game));

  const tabs = h("div", "tabs");
  for (const [key, label] of [["", "Tous"], ...Object.entries(STYLES)] as [Style | "", string][]) {
    const tab = button(label, `Styles : ${label}`, () => ((state.style = key), render()));
    if (state.style === key) tab.classList.add("active");
    tabs.append(tab);
  }
  view.append(tabs);

  // Le BO de base de la civ (📌) en tête de liste.
  const baseId = state.matchups.base[civ];
  const builds = filterBuilds(state.library, civ, state.style).sort((a, b) => Number(b.id === baseId) - Number(a.id === baseId));
  const list = h("ul", "builds");
  if (builds.length === 0) list.append(h("li", "empty", "Aucun BO ici. Trouve-en un sur aoe4guides ou importe un lien."));
  for (const b of builds) {
    const info = h(
      "div",
      "build-info",
      h("span", "build-name", b.build.name),
      h("span", "build-meta", `${b.id === baseId ? "Base · " : ""}${STYLES[b.style]}${b.build.author ? ` · ${b.build.author}` : ""}`),
    );
    const uses = matchupUses(b.id);
    const del = button("🗑", uses ? `Supprimer ? Utilisé par tes matchups (${uses}) : ils seront retirés` : "Supprimer", () => {
      // Utilisé par tes matchups : un second clic dans les 3 s, comme pour quitter.
      if (uses && !del.dataset.confirm) {
        del.dataset.confirm = "1";
        del.textContent = "Supprimer ?";
        del.classList.add("confirm");
        setTimeout(() => {
          delete del.dataset.confirm;
          del.textContent = "🗑";
          del.classList.remove("confirm");
        }, 3000);
        return;
      }
      state.library = removeBuild(state.library, b.id);
      saveLibrary(localStorage, state.library);
      // Le BO supprimé sort aussi de tes matchups.
      state.matchups = forgetBuild(state.matchups, b.id);
      saveMatchups(localStorage, state.matchups);
      if (state.currentId === b.id) state.currentId = null;
      render();
    });
    const isBase = state.matchups.base[civ] === b.id;
    const pin = button("📌", isBase ? `BO de base pour ${civ} : clique pour le retirer` : `En faire le BO de base pour ${civ} (présélectionné au début de la partie)`, () => setBase(civ, isBase ? null : b.id));
    pin.className = isBase ? "pin on" : "pin";
    list.append(h("li", "build", pin, info, button("▶", "Jouer ce BO", () => play(b.id)), del));
  }
  view.append(list, guidesButton(), importForm());
  return view;
}

function showMatchups() {
  state.view = "matchups";
  if (state.locked) setLocked(false);
  else render();
}

function setBase(civ: string, buildId: string | null) {
  const base = { ...state.matchups.base };
  if (buildId) base[civ] = buildId;
  else delete base[civ];
  updateMatchups({ ...state.matchups, base });
}

function updateMatchups(matchups: Matchups) {
  state.matchups = matchups;
  saveMatchups(localStorage, matchups);
  render();
}

/** Règle lisible : « contre French · sur Dry Arabia », « toutes les parties ». */
function ruleLabel(rule: MatchupRule): string {
  return [rule.opponent ? `contre ${rule.opponent}` : "", rule.map ? `sur ${rule.map}` : ""].filter(Boolean).join(" · ") || "toutes les parties";
}

/** « 📌 BO de base, 2 règles » : ce qu'une suppression retirerait des matchups. */
function matchupUses(buildId: string): string {
  const base = Object.values(state.matchups.base).includes(buildId);
  const rules = state.matchups.rules.filter((r) => r.buildId === buildId).length;
  return [base ? "📌 BO de base" : "", rules ? `${rules} règle${rules > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ");
}

/** Ce que BoGo choisirait pour cette civ adverse et cette carte, en une phrase. */
function matchupPreview(civ: string, opponent: string | null, map: string | null): string {
  const builds = filterBuilds(state.library, civ, "");
  const pick = matchupPick(state.matchups, { kind: "rm_1v1", civ, opponentCiv: opponent, map: map ?? "" }, (id) => builds.some((b) => b.id === id));
  // Sans carte tapée, les règles de carte de la civ passent avant : « sur les autres cartes ».
  const mapRules = state.matchups.rules.some((r) => r.civ === civ && r.map);
  const opponentRules = state.matchups.rules.some((r) => r.civ === civ && r.opponent);
  const where = `${opponent ? `Contre ${opponent}` : opponentRules ? "Contre les autres civs" : "Contre toutes les civs"}, ${map ? `sur ${map}` : mapRules ? "sur les autres cartes" : "sur toutes les cartes"}`;
  if (!pick) return `${where} : BoGo choisit d'après tes parties.`;
  const name = builds.find((b) => b.id === pick.buildId)?.build.name ?? "?";
  const why = pick.rule ? `ta règle ${ruleLabel(pick.rule)}` : "📌 BO de base";
  const conflict = pick.conflict ? `, elle passe avant ta règle ${ruleLabel(pick.conflict)}` : "";
  return `${where} : ${name} (${why}${conflict}).`;
}

/**
 * Mes matchups pour la civ choisie : le BO de base (📌), puis des règles « contre telle civ,
 * sur telle carte → ce BO ». Au début d'une partie, la règle la plus précise présélectionne
 * le BO sur l'écran de choix. Tout est enregistré à chaque changement.
 */
function matchupsView(): HTMLElement {
  const civ = state.civ;
  if (draft.civ !== civ) draft = { civ, opponent: "", map: "" };
  const view = h("main", "matchups");
  const back = button("←", `BO de ${civ}`, () => showLibrary(civ));
  view.append(h("div", "civ-header", back, flag(civ), h("strong", "", `Matchups · ${civ}`)));
  const builds = filterBuilds(state.library, civ, "");
  if (builds.length === 0) {
    view.append(h("p", "empty", "Ajoute d'abord des BO pour cette civ : les matchups choisissent parmi eux."));
    return view;
  }
  const options: [string, string][] = builds.map((b) => [b.id, `${b.build.name} · ${STYLES[b.style]}`]);

  const base = select([["", "Aucun : BoGo choisit d'après tes parties"], ...options], state.matchups.base[civ] ?? "", (id) => setBase(civ, id || null));
  view.append(h("label", "field", "📌 BO de base, sans question de matchup", base));

  // Dans l'ordre où BoGo les lit (PRECEDENCE) : la première qui va avec ta partie gagne.
  const rules = state.matchups.rules
    .filter((r) => r.civ === civ)
    .sort((a, b) => PRECEDENCE.indexOf(ruleMatch(a)) - PRECEDENCE.indexOf(ruleMatch(b)));
  const list = h("ul", "rules");
  for (const rule of rules) {
    const choice = select(builds.some((b) => b.id === rule.buildId) ? options : [[rule.buildId, "BO supprimé"], ...options], rule.buildId, (id) =>
      updateMatchups({ ...state.matchups, rules: state.matchups.rules.map((r) => (r.id === rule.id ? { ...r, buildId: id } : r)) }),
    );
    const del = button("🗑", "Supprimer cette règle", () =>
      updateMatchups({ ...state.matchups, rules: state.matchups.rules.filter((r) => r.id !== rule.id) }),
    );
    list.append(h("li", "rule", h("div", "rule-text", h("span", "when", ruleLabel(rule)), choice), del));
  }
  view.append(rules.length ? list : h("p", "empty", "Exemple : contre French sur Dry Arabia → ton BO anti-cavalerie."));

  // Nouvelle règle : civ adverse et/ou carte, puis le BO (le choisir enregistre la règle).
  // Le brouillon survit aux redessins (changement du 📌, d'une autre règle, fin du choix…).
  const opponent = select([["", "Toutes les civs adverses"], ...CIVILIZATIONS.map((c): [string, string] => [c, `contre ${c}`])], draft.opponent, () => {
    draft.opponent = opponent.value;
    refresh();
  });
  const map = h("input");
  map.placeholder = "Toutes les cartes";
  map.value = draft.map;
  map.setAttribute("list", "bogo-maps");
  map.oninput = () => {
    draft.map = map.value;
    refresh();
  };
  const seen = journal.map((e) => e.map).filter(Boolean);
  const known = new Map<string, string>();
  for (const m of [...seen.reverse(), ...MAP_SUGGESTIONS]) if (!known.has(mapKey(m))) known.set(mapKey(m), m);
  const maps = h("datalist");
  maps.id = "bogo-maps";
  for (const m of known.values()) maps.append(Object.assign(h("option"), { value: m }));
  const bo = select([["", "Choisis le BO…"], ...options], "", (id) => id && addRule(id));
  const preview = h("p", "hint");
  const message = h("p", "status");
  function refresh() {
    const ready = !!opponent.value || !!map.value.trim();
    bo.disabled = !ready;
    bo.title = ready ? "" : "Choisis d'abord une civ adverse ou une carte";
    const typed = map.value.trim();
    message.className = "status";
    message.textContent = typed && !known.has(mapKey(typed)) ? "Carte inconnue de BoGo : vérifie qu'elle est écrite comme sur AoE4World." : "";
    preview.textContent = matchupPreview(civ, opponent.value || null, typed || null);
  }
  function addRule(buildId: string) {
    const rule: MatchupRule = { id: newRuleId(), civ, opponent: opponent.value || null, map: map.value.trim() || null, buildId };
    // Même situation déjà réglée : la nouvelle règle la remplace.
    const same = (r: MatchupRule) => r.civ === civ && r.opponent === rule.opponent && mapKey(r.map ?? "") === mapKey(rule.map ?? "");
    const replaced = state.matchups.rules.some(same);
    const name = builds.find((b) => b.id === buildId)?.build.name ?? "";
    matchupStatus = `Règle ${replaced ? "remplacée" : "ajoutée"} : ${ruleLabel(rule)} → ${name}`;
    draft = { civ, opponent: "", map: "" };
    updateMatchups({ ...state.matchups, rules: [...state.matchups.rules.filter((r) => !same(r)), rule] });
  }
  refresh();
  if (matchupStatus) {
    message.textContent = matchupStatus;
    matchupStatus = "";
  }
  view.append(
    h("div", "add-rule", h("strong", "", "＋ Nouvelle règle"), opponent, map, maps, bo, preview, message),
    h(
      "p",
      "hint",
      "BoGo lit de haut en bas : la première règle qui va avec ta partie gagne, sinon 📌. Une carte passe avant une civ adverse (carte d'eau). « Contre » : 1v1 classé ou rapide. En équipe : 📌 seulement. Un BO lancé avant la partie passe avant tout.",
    ),
  );
  return view;
}

/** Message après un ajout de règle (la vue est redessinée). */
let matchupStatus = "";
/** Règle en cours de saisie dans l'éditeur. */
let draft = { civ: "", opponent: "", map: "" };

function flag(civ: string): HTMLImageElement {
  const img = document.createElement("img");
  img.className = "flag";
  img.src = flagUrl(civ);
  img.alt = "";
  return img;
}

function guidesButton(): HTMLElement {
  const open = button("🌐 Parcourir aoe4guides", "Choisir des BO sur aoe4guides.com", () =>
    invoke("open_aoe4guides").catch((err) => {
      state.importStatus = { text: errorText(err), error: true };
      render();
    }),
  );
  open.classList.add("primary", "wide");
  return open;
}

function importForm(): HTMLElement {
  const input = document.createElement("textarea");
  input.placeholder = "Lien aoe4guides.com/builds/… ou JSON de l'export « Overlay Tool »";
  input.rows = 2;
  let importStyle: Style = state.style || "boom";
  const importStyleSelect = select(Object.entries(STYLES), importStyle, (v) => (importStyle = v as Style));
  const go = button("Importer", "Importer le BO", () => importBuild(input.value, importStyle));
  const details = h("details", "import", h("summary", "", "Importer un lien ou un JSON"));
  details.append(input, h("div", "import-row", importStyleSelect, go));
  const form = h("div", "import-block", details);
  if (state.importStatus) {
    form.append(h("p", state.importStatus.error ? "status error" : "status", state.importStatus.text));
  }
  return form;
}

/** Derniers changements d'étape et leur raison, pour comprendre le suivi automatique. */
function stepLog(): HTMLElement {
  const lines = engine?.log ?? [];
  const log = h("div", "step-log", h("span", "", "Changements d'étape :"));
  if (!lines.length) log.append(h("span", "", "aucun pour l'instant"));
  for (const line of lines) log.append(h("span", "", line));
  return log;
}

/** Saisie d'un raccourci en cours : elle survit aux redessins et s'arrête en quittant les réglages. */
let capture: { action: HotkeyAction; stop: () => void } | null = null;
let hotkeyMessage: { text: string; error: boolean } | null = null;

/** Raccourcis modifiables : « Changer », puis taper la combinaison voulue (Échap pour annuler). */
function hotkeySettings(): HTMLElement {
  const box = h("div", "hotkeys", h("strong", "", "Raccourcis"));
  for (const { action, label, choice } of HOTKEY_ACTIONS) {
    if (choice && action === "launch") box.append(h("span", "hotkeys-group", "Choix du BO au début de la partie"));
    const capturing = capture?.action === action;
    const key = h("span", capturing ? "key capturing" : "key", capturing ? "Tape la combinaison…" : KEYS[action]);
    const row = h("div", "hotkey-row", h("span", "", label), key);
    row.append(button("Changer", `Changer le raccourci « ${label} »`, () => captureHotkey(action)));
    if (state.settings.hotkeys[action]) {
      row.append(button("Défaut", `Revenir à ${hotkeyLabel(DEFAULT_HOTKEYS[action])}`, () => saveHotkey(action, "")));
    }
    if (hotkeyErrors[action]) {
      row.append(h("span", "status error", "Indisponible (déjà pris par une autre appli ?) : choisis-en un autre."));
    }
    box.append(row);
  }
  if (hotkeyMessage) box.append(h("p", hotkeyMessage.error ? "status error" : "status", hotkeyMessage.text));
  return box;
}

/** Pendant la saisie, les raccourcis de BoGo sont coupés : la combinaison tapée arrive ici. */
function captureHotkey(action: HotkeyAction) {
  capture?.stop();
  unregisterAll().catch(() => {});
  const onKey = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return endCapture(null);
    const accelerator = acceleratorFromEvent(e);
    if (!accelerator) return;
    const error = checkHotkey(accelerator, action);
    if (!error) return endCapture(accelerator);
    hotkeyMessage = { text: `${hotkeyLabel(accelerator)} : ${error}`, error: true };
    render();
  };
  window.addEventListener("keydown", onKey, true);
  capture = { action, stop: () => window.removeEventListener("keydown", onKey, true) };
  hotkeyMessage = { text: "Échap pour annuler.", error: false };
  render();
}

/** Fin de saisie : nouveau raccourci enregistré, ou (Échap, sortie des réglages) raccourcis remis. */
function endCapture(accelerator: string | null) {
  const action = capture?.action;
  capture?.stop();
  capture = null;
  hotkeyMessage = null;
  if (accelerator && action) saveHotkey(action, accelerator);
  else registerHotkeys().then(render);
}

/** Un raccourci refusé par le système (pris par une autre appli) n'est pas gardé. */
async function saveHotkey(action: HotkeyAction, accelerator: string) {
  const previous = state.settings.hotkeys;
  const hotkeys = { ...previous };
  if (accelerator && !sameHotkey(accelerator, DEFAULT_HOTKEYS[action])) hotkeys[action] = accelerator;
  else delete hotkeys[action];
  setHotkeys(hotkeys);
  await registerHotkeys();
  if (accelerator && hotkeyErrors[action]) {
    hotkeyMessage = { text: `${hotkeyLabel(accelerator)} : refusé par le système (déjà pris par une autre appli ?).`, error: true };
    setHotkeys(previous);
    await registerHotkeys();
  } else {
    state.settings = { ...state.settings, hotkeys };
    store(SETTINGS_KEY, state.settings);
  }
  render();
}

/** Où va l'enregistrement : un fichier local par BO lancé, jamais envoyé. */
function recordingStatus(): HTMLElement {
  const { path, error } = state.recording;
  if (error) return h("p", "status error", `Enregistrement impossible : ${error}`);
  if (!state.settings.record) return h("p", "hint", "Rien n'est enregistré.");
  const text = path
    ? `Partie enregistrée dans ${path} (fichier local, jamais envoyé ; sans la liste de tes applis).`
    : "Un fichier sera créé au lancement du prochain BO (fichier local, jamais envoyé).";
  return h("p", "hint", text);
}

function visionStatus(): HTMLElement {
  const status = h("p", state.vision.error ? "status error" : "status", visionText());
  status.id = "vision-status";
  return status;
}

function visionText(): string {
  if (!state.settings.readScreen) return "";
  if (state.vision.error) return state.vision.error;
  const time = clock.current(Date.now());
  const parts: string[] = [];
  if (time !== null) parts.push(`horloge ${formatClock(time)}`);
  // Versus : pas de comptes lus en direct, même dans les réglages (ouverts en pleine partie).
  if (hudIsFresh() && !features().liveCounts) parts.push("panneau des villageois lu");
  if (hudIsFresh() && features().liveCounts) {
    const r = state.hud!.reading;
    const gatherers = RESOURCES.map((res) => `${RESOURCE_ICONS[res][0]}${r.gatherers[res]}`).join(" ");
    parts.push(`${r.villagers} villageois (${gatherers}, ${r.idle} inactif${r.idle > 1 ? "s" : ""})`);
    parts.push(`stock ${RESOURCES.map((res) => `${RESOURCE_ICONS[res][0]}${r.stock[res]}`).join(" ")}`);
  }
  if (topText) parts.push(`en haut : « ${topText} »`);
  if (parts.length) return `Lu à l'écran : ${parts.join(" · ")}.`;
  const status = VISION_STATUS[state.vision.status] ?? "Lecture de l'écran en cours de démarrage…";
  // La liste des applis ouvertes (visionApps) reste hors écran : elle finirait sur une capture.
  if (state.vision.status === "no_window" && visionApps.length) return `${status} Une appli NVIDIA est ouverte.`;
  return status;
}

function gameStatus(): HTMLElement {
  const dot = h("span", "status-dot");
  if (state.gameError) {
    dot.classList.add("error");
    dot.title = state.gameError;
  } else if (state.game?.ongoing) {
    dot.classList.add("live");
    dot.title = "Partie en cours détectée";
  } else {
    dot.title = state.settings.profileId ? "Aucune partie en cours" : "Profil AoE4World non renseigné";
  }
  return dot;
}

function gameBanner(game: DetectedGame): HTMLElement {
  const details = [kindLabel(game.kind), game.map].filter(Boolean).join(" · ");
  const opponent = soloOpponent(game);
  const versus = opponent ? ` contre ${opponent}` : "";
  return h(
    "div",
    "game-banner",
    h("strong", "", `${game.myCivilization}${versus}`),
    h("span", "build-meta", `Partie détectée · ${details}`),
  );
}

/** Catégories de la bibliothèque, dans l'ordre des onglets, et leur raccourci. */
const CHOICE_STYLES: [Style, HotkeyAction][] = [
  ["boom", "cat1"],
  ["agressif", "cat2"],
  ["fast-castle", "cat3"],
  ["autre", "cat4"],
];

/** Choix du début de partie : le BO proposé, pourquoi, le compte à rebours, un BO par catégorie. */
function choiceView(): HTMLElement {
  const { game, advice, picks } = state.offer!;
  const view = h("main", "choice");
  // Un seul en-tête : drapeau, civ (et adversaire en 1v1), mode et carte.
  const banner = gameBanner(game);
  banner.querySelector("strong")?.prepend(flag(game.myCivilization));
  view.append(banner);
  if (modeNotice && Date.now() < modeNotice.until) view.append(h("p", "hint", modeNotice.text));
  if (advice) {
    const card = h(
      "div",
      "reco-card",
      h("span", "reco-label", "Ton BO pour cette partie"),
      h("strong", "reco-name", advice.build.build.name),
      h("span", "build-meta", STYLES[advice.build.style]),
      h("span", "fact", advice.reason),
    );
    if (advice.also) {
      const key = CHOICE_STYLES.find(([style]) => picks[style]?.id === advice.also!.build.id)?.[1];
      const other = advice.also.build;
      card.append(
        h(
          "span",
          "fact also",
          `Ta règle ${advice.also.rule} dit : ${other.build.name}${key ? ` · ${KEYS[key]}` : ""} `,
          button("▶", `Lancer ${other.build.name}`, () => play(other.id)),
        ),
      );
    }
    const go = button(`▶ Lancer · ${KEYS.launch}`, "Lancer ce BO maintenant", () => play(advice.build.id));
    go.className = "primary go";
    card.append(go, countdownLine());
    view.append(card);
  }
  const row = h("div", "catrow");
  for (const [style, action] of CHOICE_STYLES) {
    const pick = picks[style];
    const tile = button("", pick ? `Lancer ${pick.build.name}` : "Aucun BO de cette catégorie pour cette civ", () => pickCategory(style));
    tile.className = `catbtn${advice?.build.style === style ? " on" : ""}`;
    tile.disabled = !pick;
    tile.append(h("span", "key", KEYS[action]), h("span", "l", STYLES[style]), h("span", "b", pick?.build.name ?? "aucun BO"));
    row.append(tile);
  }
  view.append(
    row,
    h("p", "hint", "Une touche de catégorie lance son BO, même après un lancement, jusqu'au passage d'âge."),
    button("Voir tous les BO", "Tous les BO de la civ", () => showLibrary(game.myCivilization)),
  );
  return view;
}

function countdownLine(): HTMLElement {
  const { countdownEnd, autoOff } = state.offer!;
  if (countdownEnd === null) {
    return h("div", "auto off", autoOff === REFUSED ? "Lancement auto annulé" : `Lancement auto désactivé : ${autoOff}`);
  }
  const left = Math.max(0, Math.ceil((countdownEnd - Date.now()) / 1000));
  const fill = h("i");
  fill.style.width = `${(left / COUNTDOWN_SECONDS) * 100}%`;
  const cancel = button(`Annuler · ${KEYS.cancel}`, "Ne pas lancer ce BO tout seul", () => refuseCountdown());
  return h("div", "auto", h("span", "", `Lancé tout seul dans ${left} s`), cancel, h("div", "countdown-bar", fill));
}

function settingsView(): HTMLElement {
  const view = h("main", "settings");
  const profile = document.createElement("input");
  profile.value = state.settings.profileId;
  profile.placeholder = "Lien aoe4world.com/players/… ou identifiant";
  const apiKey = document.createElement("input");
  apiKey.type = "password";
  apiKey.autocomplete = "off";
  apiKey.value = state.settings.apiKey;
  apiKey.placeholder = "Facultative";
  const readScreen = document.createElement("input");
  readScreen.type = "checkbox";
  readScreen.checked = state.settings.readScreen;
  const translate = document.createElement("input");
  translate.type = "checkbox";
  translate.checked = state.settings.translate;
  const iconNames = document.createElement("input");
  iconNames.type = "checkbox";
  iconNames.checked = state.settings.iconNames;
  const showNext = document.createElement("input");
  showNext.type = "checkbox";
  showNext.checked = state.settings.showNext;
  const record = document.createElement("input");
  record.type = "checkbox";
  record.checked = state.settings.record;
  const scale = document.createElement("input");
  scale.type = "range";
  scale.min = String(SCALE_MIN);
  scale.max = String(SCALE_MAX);
  scale.step = "5";
  scale.value = String(state.settings.scale);
  const scaleValue = h("b", "", `${state.settings.scale} %`);
  // Appliqué en direct et gardé tout de suite : on voit la taille en la réglant.
  scale.oninput = () => {
    state.settings = { ...state.settings, scale: clampScale(Number(scale.value)) };
    store(SETTINGS_KEY, state.settings);
    scaleValue.textContent = `${state.settings.scale} %`;
    applyScale();
  };
  if (!SCREEN_READING) {
    readScreen.checked = false;
    readScreen.disabled = true;
  }
  const message = h("p", "status");

  const save = button("Enregistrer", "Enregistrer les réglages", () => {
    const profileId = extractProfileId(profile.value);
    if (!profileId) {
      message.className = "status error";
      message.textContent = "Colle le lien de ton profil aoe4world.com/players/… ou son numéro.";
      return;
    }
    saveSettings({
      profileId,
      apiKey: apiKey.value.trim(),
      readScreen: SCREEN_READING ? readScreen.checked : state.settings.readScreen,
      translate: translate.checked,
      iconNames: iconNames.checked,
      showNext: showNext.checked,
      record: record.checked,
      scale: state.settings.scale,
      hotkeys: state.settings.hotkeys,
    });
    showLibrary();
  });
  save.classList.add("primary");

  view.append(
    h("label", "", "Profil AoE4World", profile),
    h("label", "", "Clé API AoE4World", apiKey),
    h(
      "p",
      "hint",
      "La clé sert à détecter aussi les parties personnalisées. Connecté sur aoe4world.com, ouvre " +
        "aoe4world.com/account/profile_token et copie la valeur de « api_key ».",
    ),
    h(
      "label",
      "checkbox",
      readScreen,
      SCREEN_READING
        ? "Lire l'écran de GeForce Now (horloge, villageois, ressources) : le BO avance tout seul"
        : "Lecture de l'écran : bientôt sous Windows. En attendant, suivi manuel avec les raccourcis.",
    ),
    h(
      "p",
      "hint",
      "Deux modes. VS, par défaut, contre des joueurs : ton BO et ses pages qui tournent toutes seules, rien de " +
        "calculé sur ta partie. IA, à choisir avant une partie contre l'IA (bouton VS / IA en haut) : en plus, alertes " +
        "de répartition et d'inactifs, comptes réel / cible, stock du passage d'âge. BoGo vérifie d'abord sur AoE4World " +
        "que ce n'est ni une classée ni une partie rapide (1 min de jeu) : ne choisis IA qu'avant une partie contre l'IA.",
    ),
    h("label", "scale", "Taille de BoGo ", scaleValue, scale),
    hotkeySettings(),
    visionStatus(),
    h("label", "checkbox", translate, "Traduire en français les consignes des BO en anglais"),
    h("label", "checkbox", iconNames, "Écrire le nom à côté des icônes peu connues (baies, bâtiments, unités…)"),
    h("label", "checkbox", showNext, "Montrer aussi l'étape suivante (« Ensuite ») pendant la partie"),
    h("label", "checkbox", record, "Enregistrer mes parties (lectures de l'écran) pour les rejouer et régler BoGo hors ligne"),
    recordingStatus(),
    features().liveCounts ? stepLog() : "",
    save,
    message,
    h("p", "hint", hotkeyHint()),
  );
  if (state.gameError) {
    message.className = "status error";
    message.textContent = `AoE4World : ${state.gameError}`;
  }
  return view;
}

// ---------- Petits utilitaires DOM ----------

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.append(...children);
  return el;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = h("button", "", label);
  b.title = title;
  b.onclick = onClick;
  return b;
}

function select(options: [string, string][], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = h("select");
  for (const [v, label] of options) {
    const o = h("option", "", label);
    o.value = v;
    o.selected = v === value;
    s.append(o);
  }
  s.onchange = () => onChange(s.value);
  return s;
}

// ---------- Démarrage ----------
// En fin de fichier : toutes les constantes du module sont alors initialisées.

restoreSession();
resetEngine();
if (!state.settings.profileId) state.view = "settings";
setHotkeys(state.settings.hotkeys);
render();
if (state.settings.scale !== 100) applyScale();
// Redessin une fois les raccourcis en place : ceux que le système refuse s'affichent dans ⚙.
const hotkeysReady = registerHotkeys().then(render);
pollGame();
setInterval(pollGame, POLL_SECONDS * 1000);
listen<{ id: string; style: Style }>("import-request", (event) => importFromGuides(event.payload.id, event.payload.style));
// La lecture de l'écran ne démarre qu'une fois l'écoute en place : sinon une erreur
// immédiate (autorisation manquante) serait perdue.
listen<VisionEvent>("vision", (event) => onVision(event.payload)).then(() => {
  if (SCREEN_READING && state.settings.readScreen) startVision();
});
// macOS peut repasser GeForce Now (plein écran) devant l'overlay : on le remet au premier plan.
setInterval(() => invoke("keep_overlay_on_top").catch(() => {}), 2000);
// Quand bogo-vision ne lit plus rien, aucun événement n'arrive : sans ce minuteur, la vue
// garderait les derniers chiffres comme s'ils étaient en direct. On ne redessine qu'au changement.
setInterval(() => {
  if (state.view === "play" && !state.mini && readingState() !== shownReading) render();
}, 1000);
// Lancé au démarrage sur un BO en cours : clics vers le jeu (une fois le raccourci pour
// déverrouiller en place), enregistrement repris.
if (state.view === "play") {
  hotkeysReady.then(() => setLocked(true));
  if (state.settings.record) startRecording();
}

document.addEventListener("keydown", (e) => {
  if (state.view !== "play" || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === "ArrowRight") goToStep(state.step + 1);
  if (e.key === "ArrowLeft") goToStep(state.step - 1);
});
