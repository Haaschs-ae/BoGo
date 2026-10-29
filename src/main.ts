import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { register } from "@tauri-apps/plugin-global-shortcut";
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
import { foodSource, iconLabel, isWellKnownIcon, stepBuilding, stepLandmark, villagerFocus } from "./display";
import { AGE_NAMES, BuildEngine, effectiveVillagerTargets, type EngineState } from "./engine";
import { parseHud, RESOURCES, type HudReading, type OcrToken, type Resource } from "./hud";
import { ageUpBuilders } from "./top";
import { looksEnglish, translateText } from "./translate";
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

const HOTKEYS = {
  next: "CommandOrControl+Alt+ArrowRight",
  previous: "CommandOrControl+Alt+ArrowLeft",
  lock: "CommandOrControl+Alt+L",
  toggle: "CommandOrControl+Alt+B",
  mini: "CommandOrControl+Alt+M",
};

const HOTKEY_HINT = "⌘⌥←/→ étapes · ⌘⌥M réduire · ⌘⌥L verrouiller · ⌘⌥B afficher/masquer";

const SESSION_KEY = "bogo.session.v1";
const SETTINGS_KEY = "bogo.settings.v1";
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
  /** civs : grille des drapeaux ; civ : BO de la civ choisie. */
  view: "civs" | "civ" | "play" | "settings";
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
  saveSession();
  render();
}

function resetEngine() {
  const saved = current();
  if (!saved) {
    engine = null;
    return;
  }
  // La civ jouée sert au coût du passage d'âge (les Mongols paient en pierre).
  const civ = state.game?.ongoing ? state.game.myCivilization : civilizationsOf(saved.build)[0];
  engine = new BuildEngine(saved.build.build_order, civ);
  engine.setStep(state.step, "reprise du BO");
  state.engine = null;
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
  render();
}

function toggleMini() {
  state.mini = !state.mini;
  render();
}

function play(id: string) {
  state.currentId = id;
  state.step = 0;
  state.autoStep = null;
  state.finished = false;
  state.mini = false;
  state.view = "play";
  resetEngine();
  saveSession();
  render();
}

async function setLocked(locked: boolean) {
  state.locked = locked;
  await appWindow.setIgnoreCursorEvents(locked);
  render();
}

async function registerHotkeys() {
  const actions: [string, () => unknown][] = [
    [HOTKEYS.next, () => goToStep(state.step + 1)],
    [HOTKEYS.previous, () => goToStep(state.step - 1)],
    [HOTKEYS.lock, () => setLocked(!state.locked)],
    [HOTKEYS.mini, () => toggleMini()],
    [HOTKEYS.toggle, async () => ((await appWindow.isVisible()) ? appWindow.hide() : appWindow.show())],
  ];
  for (const [shortcut, action] of actions) {
    try {
      await register(shortcut, (event) => {
        if (event.state === "Pressed") action();
      });
    } catch (err) {
      console.error(`Raccourci ${shortcut} indisponible`, err);
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
  const civs = civilizationsOf(build).join(", ");
  state.importStatus = { text: `« ${build.name} » ajouté (${civs}, ${STYLES[style]}).`, error: false };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function pollGame() {
  const { profileId, apiKey } = state.settings;
  if (!profileId) return;
  try {
    const game = await fetchLastGame(profileId, apiKey);
    state.gameError = null;
    state.game = game;
    if (game?.ongoing && game.id !== state.handledGameId) {
      // Nouvelle partie : on propose les BO de la civ jouée.
      state.handledGameId = game.id;
      state.civ = game.myCivilization;
      state.style = "";
      state.view = "civ";
      saveSession();
      render();
      return;
    }
  } catch (err) {
    state.gameError = errorText(err);
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
/** Un landmark en construction était visible à la lecture précédente du haut de l'écran. */
let ageUpSeen = false;
/** Ce landmark a déjà fait avancer le BO. */
let ageUpHandled = false;
/** Relances automatiques de la lecture de l'écran depuis la dernière lecture réussie. */
let visionRestarts = 0;

function onVision(event: VisionEvent) {
  if (event.type === "top") {
    topText = event.tokens.map((t) => t.text).join(" ");
    const builders = ageUpBuilders(event.tokens);
    // Deux lectures de suite (chiffre parasite), et une seule fois par landmark : il reste
    // affiché toute la construction, il ne faut pas sauter jusqu'au passage d'âge suivant.
    if (builders !== null && ageUpSeen && !ageUpHandled && engine) {
      ageUpHandled = true;
      engine.ageUpStarted();
      if (engine.index !== state.step) {
        state.step = engine.index;
        state.engine = engine.state();
        saveSession();
        if (state.view === "play") render();
      }
    }
    ageUpSeen = builders !== null;
    if (builders === null) ageUpHandled = false;
    return;
  }
  if (event.type === "hud") {
    visionRestarts = 0;
    const reading = parseHud(event.tokens);
    if (!reading) return;
    const now = Date.now();
    state.hud = { reading, at: now };
    if (engine) {
      state.engine = engine.update(reading, now);
      if (state.engine.index !== state.step) {
        state.step = state.engine.index;
        saveSession();
      }
      // Dernière étape atteinte avec ses villageois : BO terminé.
      const steps = current()?.build.build_order ?? [];
      const last = steps.length - 1;
      if (!state.finished && state.step === last && (state.engine.villagers ?? 0) >= effectiveVillagerTargets(steps)[last]) {
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
    const build = current();
    // L'horloge ne pilote le BO que si le panneau des villageois n'est pas lu.
    const target = build && !hudIsFresh() ? stepForClock(build.build.build_order, event.seconds) : null;
    if (target !== null && target !== state.autoStep) {
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
    };
  } catch {
    return { profileId: "", apiKey: "", readScreen: true, translate: true, iconNames: true, showNext: false };
  }
}

function saveSettings(settings: Settings) {
  const wasReading = state.settings.readScreen;
  state.settings = settings;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  state.handledGameId = null;
  pollGame();
  if (settings.readScreen && !wasReading) startVision();
  if (!settings.readScreen && wasReading) {
    invoke("stop_vision");
    state.vision = { status: "", error: null };
  }
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ currentId: state.currentId, step: state.step, civ: state.civ }));
}

function restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}");
    if (typeof s.civ === "string") state.civ = s.civ;
    if (typeof s.currentId === "string" && state.library.some((b) => b.id === s.currentId)) {
      state.currentId = s.currentId;
      state.step = Number.isInteger(s.step) ? s.step : 0;
      state.view = "play";
    }
  } catch {
    // Session illisible : on repart de la bibliothèque.
  }
}

// ---------- Rendu ----------

function render() {
  document.body.classList.toggle("locked", state.locked);
  document.body.classList.toggle("mini", state.mini);
  if (state.mini) {
    app.replaceChildren(miniView());
    fitWindow();
    return;
  }
  const views = { civs: civsView, civ: civView, settings: settingsView, play: () => playView(current()!) };
  const view = state.view === "play" && !current() ? "civs" : state.view;
  const body = view === "civ" && !state.civ ? civsView() : views[view]();
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
    const size = `${width}x${height}`;
    if (size === windowSize) return;
    windowSize = size;
    appWindow.setSize(new LogicalSize(width, height)).catch(() => {});
  });
}

function header(): HTMLElement {
  const bar = h("header", "bar");
  bar.dataset.tauriDragRegion = "";
  const title = h("span", "title", "BoGo", gameStatus());
  title.dataset.tauriDragRegion = "";
  const actions = h("div", "actions");
  if (current()) actions.append(button("▶", "Reprendre le BO", () => ((state.view = "play"), render())));
  actions.append(
    button("⚙", "Réglages", () => (state.view === "settings" ? showLibrary() : ((state.view = "settings"), render()))),
    button(state.locked ? "🔒" : "🔓", "Verrouiller (clics transmis au jeu)", () => setLocked(!state.locked)),
    button("✕", "Quitter BoGo", () => invoke("quit")),
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
    button("⚙", "Réglages", () => ((state.view = "settings"), render())),
    button("▾", "Réduire (⌘⌥M)", () => toggleMini()),
    button(state.locked ? "🔒" : "🔓", "Verrouiller : les clics passent au jeu (⌘⌥L)", () => setLocked(!state.locked)),
    button("✕", "Quitter BoGo", () => invoke("quit")),
  );

  const step = steps[state.step];
  const age = step.age >= 1 && step.age <= 4 ? step.age : null;
  const where = h("span", "where");
  where.append(
    button("◀", "Étape précédente (⌘⌥←)", () => goToStep(state.step - 1)),
    h("span", "", "Étape ", h("b", "", `${state.step + 1}/${steps.length}`)),
    button("▶", "Étape suivante (⌘⌥→)", () => goToStep(state.step + 1)),
  );
  if (age) where.append(h("span", "muted", " · "), gameIcon(`age/age_${age}.webp`, ""), h("span", "", ` Âge ${ROMAN[age]}`));
  const gameTime = clock.current(Date.now());
  const right = gameTime !== null ? h("span", "clock", `⏱ ${formatClock(gameTime)}`) : h("span", "bo-name", saved.build.name);
  head.append(h("div", "head-row", progress, actions), h("div", "meta", where, right));
  return head;
}

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

  const view = h("main", "play");
  const alert = alertBanner(auto, hud);
  if (alert) view.append(alert);

  if (auto && auto.goal.kind !== "villagers") {
    view.append(goalBlock(auto, hud!, step));
  } else {
    const hero = heroBlock(steps, hud);
    if (hero) view.append(hero);
    view.append(bulletList(step, effectiveVillagerTargets(steps)[state.step], hud));
    // Villageois en plus sans la répartition de l'étape (attaque, choix du joueur) : BoGo ne
    // saute pas l'étape tout seul, il propose de le faire.
    if (auto && auto.drift >= DRIFT_HINT) {
      view.append(h("div", "drift", `+${auto.drift} villageois sans suivre cette étape : ⌘⌥→ pour passer à la suite`));
    }
  }
  view.append(notes(step.notes, "notes", translate));
  // L'étape suivante seulement si le joueur la demande : une étape à la fois, l'essentiel à l'écran.
  if (next && state.settings.showNext) {
    view.append(h("div", "next", h("span", "muted", "Ensuite · "), ...noteParts(next.notes[0] ?? "", translate)));
  }
  return view;
}

/** Une seule alerte à la fois : erreur de répartition d'abord, puis villageois inactifs. */
function alertBanner(auto: EngineState | null, hud: HudReading | null): HTMLElement | null {
  const m = auto?.misplacement;
  if (m) {
    const vils = m.count > 1 ? `${m.count} villageois` : "1 villageois";
    const move = m.count > 1 ? "envoie-les" : "envoie-le";
    const alert = h("div", "alert", `⚠ ${vils} de trop ${RESOURCE_PLACE[m.from]} `, resourceIcon(m.from));
    if (m.to) alert.append(` → ${move} ${RESOURCE_PLACE[m.to]} `, resourceIcon(m.to));
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

/** Grande icône du prochain villageois : où l'envoyer, combien, et le bâtiment à poser. */
function heroBlock(steps: BuildOrderStep[], hud: HudReading | null): HTMLElement | null {
  const focus = villagerFocus(steps, state.step, hud?.gatherers ?? null);
  if (!focus) return null;
  const focusStep = steps[focus.stepIndex];
  const source = focus.resource === "food" ? foodSource(focusStep) : null;
  const path = source?.path ?? RESOURCE_ICONS[focus.resource][2];
  const word = (source?.label ?? RESOURCE_ICONS[focus.resource][1]).toUpperCase();

  const tile = h("div", `tile ${focus.resource}`, gameIcon(path, RESOURCE_ICONS[focus.resource][0]));
  tile.append(h("span", "badge", `×${focus.count}`));
  const text = h("div", "hero-text", h("div", "big", word));
  const building = stepBuilding(focusStep);
  const extra: (Node | string)[] = [];
  if (building) extra.push("puis ", gameIcon(building.path, ""), ` ${building.label}`);
  for (const other of focus.others) extra.push(extra.length ? " · " : "", `+${other.count} `, resourceIcon(other.resource));
  if (extra.length) text.append(h("div", "sub", ...extra));
  const kicker = focus.count > 1 ? "PROCHAINS VILLAGEOIS" : "PROCHAIN VILLAGEOIS";
  return h("div", "primary", h("div", "kicker", kicker), h("div", "action", tile, text));
}

/** Passage d'âge ou TC à poser : vert et « clique ! » dès qu'on a de quoi payer. */
function goalBlock(auto: EngineState, hud: HudReading, step: BuildOrderStep): HTMLElement {
  const isAge = auto.goal.kind === "age";
  const age = auto.goal.kind === "age" ? auto.goal.age : 0;
  const tile = h("div", "tile goal-tile", gameIcon(isAge ? `age/age_${age}.webp` : TC_ICON, isAge ? "⬆" : "🏰"));
  const text = h("div", "hero-text", h("div", "big", isAge ? `ÂGE ${ROMAN[age] ?? age}` : "NOUVEAU TC"));
  const landmark = isAge ? stepLandmark(step) : null;
  const sub = h("div", "sub", isAge ? (AGE_NAMES[age] ?? "").replace(/^[IV]+ · /, "") : "Town Center");
  if (landmark) sub.append(" · ", gameIcon(landmark.path, ""), ` ${landmark.label}`);
  text.append(sub);

  const costs = h("div", "bullets");
  for (const [r, amount] of Object.entries(auto.cost ?? {}) as [Resource, number][]) {
    costs.append(bulletRow(r, hud.stock[r], amount, { cost: true }));
  }
  const block = h(
    "div",
    auto.affordable ? "primary ready" : "primary",
    h("div", "kicker", isAge ? "PASSAGE D'ÂGE" : "NOUVEAU TC"),
    h("div", "action", tile, text),
    costs,
  );
  block.append(
    auto.affordable ? h("div", "cta", "C'est le moment : clique !") : h("div", "sub", "Garde les ressources pour ça"),
  );
  return block;
}

/** Barres réel / cible : villageois, puis chaque ressource utile à l'étape. */
function bulletList(step: BuildOrderStep, vilTarget: number, hud: HudReading | null): HTMLElement {
  const list = h("div", "bullets");
  const villagers = state.engine?.villagers ?? hud?.villagers ?? null;
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
    row.append(h("div", "label", name[0].toUpperCase() + name.slice(1)), h("div", "value num", `${target}`, h("small", "", " visés")));
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
  const hud = hudIsFresh() ? state.hud!.reading : null;
  if (hud && hud.idle > 0) pill.append(h("span", "warn", gameIcon(VILLAGER_ICON, "💤"), ` ${hud.idle} inactif${hud.idle > 1 ? "s" : ""}`));
  pill.append(button("▴", "Agrandir (⌘⌥M)", () => toggleMini()));
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

function notes(lines: string[], className: string, translate: boolean): HTMLElement {
  const list = h("ul", className);
  for (const line of lines) list.append(h("li", "", ...noteParts(line, translate)));
  return list;
}

/**
 * Consigne du BO : texte (traduit si besoin, « -> » en vraie flèche) et icônes du jeu. Une
 * icône peu connue (baies, bâtiment, unité d'une nouvelle civ) est suivie de son nom, sauf
 * si le texte juste à côté le dit déjà.
 */
function noteParts(line: string, translate: boolean): (Node | string)[] {
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
    const named =
      state.settings.iconNames && !isWellKnownIcon(part.path) && !near.toLowerCase().includes(label.toLowerCase());
    return icon(part.path, label, named);
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
  render();
}

function civsView(): HTMLElement {
  const view = h("main", "civs");
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
  view.append(guidesButton(), grid, importForm(), h("p", "hint", HOTKEY_HINT));
  return view;
}

function civView(): HTMLElement {
  const civ = state.civ;
  const view = h("main", "civ");
  const back = button("←", "Toutes les civilisations", () => showLibrary(""));
  view.append(h("div", "civ-header", back, flag(civ), h("strong", "", civ)));
  if (state.game?.ongoing && state.game.myCivilization === civ) view.append(gameBanner(state.game));

  const tabs = h("div", "tabs");
  for (const [key, label] of [["", "Tous"], ...Object.entries(STYLES)] as [Style | "", string][]) {
    const tab = button(label, `Styles : ${label}`, () => ((state.style = key), render()));
    if (state.style === key) tab.classList.add("active");
    tabs.append(tab);
  }
  view.append(tabs);

  const builds = filterBuilds(state.library, civ, state.style);
  const list = h("ul", "builds");
  if (builds.length === 0) list.append(h("li", "empty", "Aucun BO ici. Trouve-en un sur aoe4guides ou importe un lien."));
  for (const b of builds) {
    const info = h(
      "div",
      "build-info",
      h("span", "build-name", b.build.name),
      h("span", "build-meta", `${STYLES[b.style]}${b.build.author ? ` · ${b.build.author}` : ""}`),
    );
    const del = button("🗑", "Supprimer", () => {
      state.library = removeBuild(state.library, b.id);
      saveLibrary(localStorage, state.library);
      if (state.currentId === b.id) state.currentId = null;
      render();
    });
    list.append(h("li", "build", info, button("▶", "Jouer ce BO", () => play(b.id)), del));
  }
  view.append(list, guidesButton(), importForm());
  return view;
}

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
  if (hudIsFresh()) {
    const r = state.hud!.reading;
    const gatherers = RESOURCES.map((res) => `${RESOURCE_ICONS[res][0]}${r.gatherers[res]}`).join(" ");
    parts.push(`${r.villagers} villageois (${gatherers}, ${r.idle} inactif${r.idle > 1 ? "s" : ""})`);
    parts.push(`stock ${RESOURCES.map((res) => `${RESOURCE_ICONS[res][0]}${r.stock[res]}`).join(" ")}`);
  }
  if (topText) parts.push(`en haut : « ${topText} »`);
  if (parts.length) return `Lu à l'écran : ${parts.join(" · ")}.`;
  const status = VISION_STATUS[state.vision.status] ?? "Lecture de l'écran en cours de démarrage…";
  if (state.vision.status === "no_window" && visionApps.length) return `${status} Applis vues : ${visionApps.join(", ")}.`;
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

function settingsView(): HTMLElement {
  const view = h("main", "settings");
  const profile = document.createElement("input");
  profile.value = state.settings.profileId;
  profile.placeholder = "Lien aoe4world.com/players/… ou identifiant";
  const apiKey = document.createElement("input");
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
      readScreen: readScreen.checked,
      translate: translate.checked,
      iconNames: iconNames.checked,
      showNext: showNext.checked,
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
    h("label", "checkbox", readScreen, "Lire l'écran de GeForce Now (horloge, villageois, ressources) : le BO avance tout seul"),
    visionStatus(),
    h("label", "checkbox", translate, "Traduire en français les consignes des BO en anglais"),
    h("label", "checkbox", iconNames, "Écrire le nom à côté des icônes peu connues (baies, bâtiments, unités…)"),
    h("label", "checkbox", showNext, "Montrer aussi l'étape suivante (« Ensuite ») pendant la partie"),
    stepLog(),
    save,
    message,
    h("p", "hint", HOTKEY_HINT),
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
render();
registerHotkeys();
pollGame();
setInterval(pollGame, POLL_SECONDS * 1000);
listen<{ id: string; style: Style }>("import-request", (event) => importFromGuides(event.payload.id, event.payload.style));
// La lecture de l'écran ne démarre qu'une fois l'écoute en place : sinon une erreur
// immédiate (autorisation manquante) serait perdue.
listen<VisionEvent>("vision", (event) => onVision(event.payload)).then(() => {
  if (state.settings.readScreen) startVision();
});
// macOS peut repasser GeForce Now (plein écran) devant l'overlay : on le remet au premier plan.
setInterval(() => invoke("keep_overlay_on_top").catch(() => {}), 2000);

document.addEventListener("keydown", (e) => {
  if (state.view !== "play" || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === "ArrowRight") goToStep(state.step + 1);
  if (e.key === "ArrowLeft") goToStep(state.step - 1);
});
