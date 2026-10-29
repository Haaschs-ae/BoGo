import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register } from "@tauri-apps/plugin-global-shortcut";
import { extractBuildId, fetchBuild } from "./aoe4guides";
import { extractProfileId, fetchLastGame, kindLabel, type DetectedGame } from "./aoe4world";
import {
  civilizationsOf,
  imageLabel,
  parseBuildOrder,
  tokenizeNote,
  type BuildOrder,
  type BuildOrderStep,
} from "./buildOrder";
import { CIVILIZATIONS } from "./civs";
import { flagUrl } from "./flags";
import { ClockTracker, formatClock, stepForClock } from "./clock";
import {
  AGE_NAMES,
  BuildEngine,
  nextVillagerResources,
  villagerTarget,
  type EngineState,
} from "./engine";
import { parseHud, RESOURCES, type HudReading, type OcrToken, type Resource } from "./hud";
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
};

const HOTKEY_HINT = "⌘⌥←/→ étapes · ⌘⌥L verrouiller · ⌘⌥B afficher/masquer";

const SESSION_KEY = "bogo.session.v1";
const SETTINGS_KEY = "bogo.settings.v1";
// AoE4World voit une partie quelques secondes après son lancement : inutile d'interroger plus souvent.
const POLL_SECONDS = 10;

interface Settings {
  profileId: string;
  apiKey: string;
  /** Lire l'horloge du jeu dans la fenêtre GeForce Now. */
  readScreen: boolean;
}

type VisionEvent =
  | { type: "clock"; seconds: number; text: string }
  | { type: "hud"; tokens: OcrToken[] }
  | { type: "top"; tokens: OcrToken[] }
  | { type: "status"; code: "ok" | "no_window" | "no_clock" }
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
restoreSession();
resetEngine();

const app = document.querySelector<HTMLDivElement>("#app")!;
const appWindow = getCurrentWindow();

if (!state.settings.profileId) state.view = "settings";
render();
registerHotkeys();
pollGame();
setInterval(pollGame, POLL_SECONDS * 1000);
listen<VisionEvent>("vision", (event) => onVision(event.payload));
listen<{ id: string; style: Style }>("import-request", (event) => importFromGuides(event.payload.id, event.payload.style));
if (state.settings.readScreen) startVision();
// macOS peut repasser GeForce Now (plein écran) devant l'overlay : on le remet au premier plan.
setInterval(() => invoke("keep_overlay_on_top").catch(() => {}), 2000);

document.addEventListener("keydown", (e) => {
  if (state.view !== "play" || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === "ArrowRight") goToStep(state.step + 1);
  if (e.key === "ArrowLeft") goToStep(state.step - 1);
});

function current(): SavedBuild | undefined {
  return state.library.find((b) => b.id === state.currentId);
}

function goToStep(step: number) {
  const build = current();
  if (!build) return;
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
  engine.setStep(state.step);
  state.engine = null;
}

/** Le panneau a été lu il y a peu : c'est lui qui pilote le BO (sinon l'horloge, sinon le clavier). */
function hudIsFresh(now = Date.now()): boolean {
  return !!state.hud && now - state.hud.at < 5000;
}

function play(id: string) {
  state.currentId = id;
  state.step = 0;
  state.autoStep = null;
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
  app.querySelector("header")?.replaceWith(header());
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
/** Relances automatiques de la lecture de l'écran depuis la dernière lecture réussie. */
let visionRestarts = 0;

function onVision(event: VisionEvent) {
  if (event.type === "top") {
    topText = event.tokens.map((t) => t.text).join(" ");
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
      engine?.setStep(target);
      saveSession();
    }
    // La vue de jeu n'a pas de champ de saisie : on peut la redessiner chaque seconde.
    if (state.view === "play") render();
    else updateVisionStatus();
    return;
  }
  if (event.type === "error") state.vision.error = event.message;
  else if (event.type === "status") state.vision = { status: event.code, error: null };
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
    return { profileId: String(s.profileId ?? ""), apiKey: String(s.apiKey ?? ""), readScreen: s.readScreen !== false };
  } catch {
    return { profileId: "", apiKey: "", readScreen: true };
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
  const views = { civs: civsView, civ: civView, settings: settingsView, play: () => playView(current()!) };
  const view = state.view === "play" && !current() ? "civs" : state.view;
  const body = view === "civ" && !state.civ ? civsView() : views[view]();
  app.replaceChildren(header(), body);
}

function header(): HTMLElement {
  const bar = h("header", "bar");
  bar.dataset.tauriDragRegion = "";
  const title = h("span", "title", "BoGo", gameStatus());
  title.dataset.tauriDragRegion = "";
  const actions = h("div", "actions");
  if (state.view === "play") actions.append(button("📚", "Bibliothèque", () => showLibrary()));
  else if (current()) actions.append(button("▶", "Reprendre le BO", () => ((state.view = "play"), render())));
  actions.append(
    button("⚙", "Réglages", () => (state.view === "settings" ? showLibrary() : ((state.view = "settings"), render()))),
    button(state.locked ? "🔒" : "🔓", "Verrouiller (clics transmis au jeu)", () => setLocked(!state.locked)),
    button("✕", "Quitter BoGo", () => invoke("quit")),
  );
  bar.append(title, actions);
  return bar;
}

function playView(saved: SavedBuild): HTMLElement {
  const steps = saved.build.build_order;
  const step = steps[state.step];
  const next = steps[state.step + 1];
  const now = Date.now();
  const hud = hudIsFresh(now) ? state.hud!.reading : null;
  const auto = hud && state.engine?.index === state.step ? state.engine : null;

  const gameTime = clock.current(now);
  const followsClock = stepForClock(steps, 0) !== null;
  const count = h("span", "bo-count", `${state.step + 1}/${steps.length}`);
  if (gameTime !== null) {
    const live = h("span", "chip live", `⏱ ${formatClock(gameTime)}`);
    live.title = hud ? "Horloge du jeu" : followsClock ? "Horloge du jeu : le BO avance tout seul" : "Horloge du jeu";
    count.prepend(live, " ");
  }

  const view = h("main", "play");
  view.append(h("div", "bo-title", h("span", "bo-name", saved.build.name), count));
  if (auto) view.append(...alerts(auto, hud!));
  if (auto && auto.goal.kind !== "villagers") view.append(goalBanner(auto, hud!));
  else {
    const hint = nextVillagersHint(steps);
    if (hint) view.append(hint);
  }
  view.append(targets(step, hud), notes(step.notes, "notes"));
  if (next) view.append(h("div", "next-label", "Ensuite"), notes(next.notes.slice(0, 2), "notes next"));

  const nav = h("div", "nav");
  const prev = button("◀", "Étape précédente", () => goToStep(state.step - 1));
  const nextBtn = button("▶", "Étape suivante", () => goToStep(state.step + 1));
  prev.disabled = state.step === 0;
  nextBtn.disabled = !next;
  const mode = hud
    ? "Suivi des villageois · ⌘⌥← / ⌘⌥→"
    : gameTime !== null && !followsClock
      ? "Pas de temps dans ce BO : ⌘⌥← / ⌘⌥→"
      : "⌘⌥← / ⌘⌥→";
  nav.append(prev, h("span", "hint", mode), nextBtn);
  view.append(nav);
  return view;
}

/** « Passe à l'âge II » ou « Construis un TC », avec les ressources qui manquent. */
function goalBanner(auto: EngineState, hud: HudReading): HTMLElement {
  const title =
    auto.goal.kind === "age"
      ? h("strong", "", gameIcon(`age/age_${auto.goal.age}.webp`, "⬆"), ` Passe à l'âge ${AGE_NAMES[auto.goal.age] ?? auto.goal.age}`)
      : h("strong", "", gameIcon(TC_ICON, "🏰"), " Construis un TC");
  const banner = h("div", auto.affordable ? "goal ready" : "goal", title);
  const costs = h("div", "goal-costs");
  for (const [r, amount] of Object.entries(auto.cost ?? {}) as [Resource, number][]) {
    const have = hud.stock[r];
    const chip = h("span", have >= amount ? "chip ok" : "chip", resourceIcon(r), ` ${have}/${amount}`);
    chip.title = RESOURCE_ICONS[r][1];
    costs.append(chip);
  }
  banner.append(costs, h("span", "goal-hint", auto.affordable ? "C'est le moment : clique !" : "Garde les ressources pour ça"));
  return banner;
}

function alerts(auto: EngineState, hud: HudReading): HTMLElement[] {
  const list: HTMLElement[] = [];
  const m = auto.misplacement;
  if (m) {
    const vils = m.count > 1 ? `${m.count} vils` : "1 vil";
    const move = m.count > 1 ? "envoie-les" : "envoie-le";
    const alert = h("div", "alert", `⚠ ${vils} de trop sur `, resourceLabel(m.from));
    if (m.to) alert.append(` → ${move} sur `, resourceLabel(m.to));
    list.push(alert);
  }
  if (hud.idle > 0) {
    const plural = hud.idle > 1 ? "s" : "";
    list.push(h("div", "alert warn", gameIcon(VILLAGER_ICON, "💤"), ` ${hud.idle} vil${plural} inactif${plural}`));
  }
  return list;
}

function nextVillagersHint(steps: BuildOrderStep[]): HTMLElement | null {
  const entries = Object.entries(nextVillagerResources(steps, state.step)) as [Resource, number][];
  if (!entries.length) return null;
  const hint = h("div", "next-vils", "Prochains vils → ");
  entries.forEach(([r, n], i) => hint.append(i ? ", " : "", resourceLabel(r), ` (+${n})`));
  return hint;
}

function targets(step: BuildOrderStep, hud: HudReading | null): HTMLElement {
  const row = h("div", "targets");
  const chip = (content: (Node | string)[], title: string, className = "chip") => {
    const c = h("span", className, ...content);
    c.title = title;
    row.append(c);
  };
  if (step.time) chip([`🕒 ${step.time}`], "Temps visé");
  const vilTarget = villagerTarget(step);
  const vil = gameIcon(VILLAGER_ICON, "👤");
  if (hud) chip([vil, ` ${hud.villagers}/${vilTarget}`], "Villageois : en jeu / visés", hud.villagers >= vilTarget ? "chip ok" : "chip");
  else if (vilTarget > 0) chip([vil, ` ${vilTarget}`], "Villageois visés");

  for (const r of RESOURCES) {
    const target = step.resources[r];
    // -1 signifie « non précisé » dans le format RTS_Overlay.
    if (target === -1) continue;
    const name = RESOURCE_ICONS[r][1];
    if (!hud) {
      chip([resourceIcon(r), ` ${target}`], name);
      continue;
    }
    const have = hud.gatherers[r];
    if (have === 0 && target === 0) continue;
    const status = have > target ? "chip over" : have === target ? "chip ok" : "chip";
    chip([resourceIcon(r), ` ${have}/${target}`], `${name} : villageois en jeu / visés`, status);
  }
  const builder = step.resources.builder;
  if (builder !== undefined && builder > 0) chip([`🔨 ${builder}`], "Bâtisseurs");
  if (step.age > 0) chip([gameIcon(`age/age_${step.age}.webp`, "Âge"), ` ${["I", "II", "III", "IV"][step.age - 1] ?? step.age}`], "Âge", "chip age");
  return row;
}

function resourceIcon(r: Resource): HTMLElement {
  return gameIcon(RESOURCE_ICONS[r][2], RESOURCE_ICONS[r][0]);
}

/** Icône et nom de la ressource : « [icône] bois ». */
function resourceLabel(r: Resource): HTMLElement {
  return h("span", "", resourceIcon(r), ` ${RESOURCE_ICONS[r][1]}`);
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

function notes(lines: string[], className: string): HTMLElement {
  const list = h("ul", className);
  for (const line of lines) {
    const li = h("li");
    for (const part of tokenizeNote(line)) {
      if (part.kind === "text") li.append(part.text);
      else li.append(icon(part.path));
    }
    list.append(li);
  }
  return list;
}

function icon(path: string): HTMLElement {
  const img = document.createElement("img");
  img.className = "icon";
  img.src = ICON_BASE + path;
  img.alt = img.title = imageLabel(path);
  img.onerror = () => img.replaceWith(h("span", "icon-text", imageLabel(path)));
  return img;
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
  return VISION_STATUS[state.vision.status] ?? "Lecture de l'écran en cours de démarrage…";
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
  const versus = game.opponentCivilizations.length ? ` contre ${game.opponentCivilizations.join(", ")}` : "";
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
  const message = h("p", "status");

  const save = button("Enregistrer", "Enregistrer les réglages", () => {
    const profileId = extractProfileId(profile.value);
    if (!profileId) {
      message.className = "status error";
      message.textContent = "Colle le lien de ton profil aoe4world.com/players/… ou son numéro.";
      return;
    }
    saveSettings({ profileId, apiKey: apiKey.value.trim(), readScreen: readScreen.checked });
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
