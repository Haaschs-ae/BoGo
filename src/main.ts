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
  | { type: "status"; code: "ok" | "no_window" | "no_clock" }
  | { type: "error"; code: string; message: string }
  | { type: "stopped" };

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
};
const clock = new ClockTracker();
restoreSession();

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
  saveSession();
  render();
}

function play(id: string) {
  state.currentId = id;
  state.step = 0;
  state.autoStep = null;
  state.view = "play";
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

async function startVision() {
  state.vision = { status: "", error: null };
  try {
    await invoke("start_vision");
  } catch (err) {
    state.vision.error = errorText(err);
    refreshHeader();
  }
}

function onVision(event: VisionEvent) {
  if (event.type === "clock") {
    if (clock.read(event.seconds, Date.now()) === null) return;
    const build = current();
    const target = build ? stepForClock(build.build.build_order, event.seconds) : null;
    if (target !== null && target !== state.autoStep) {
      state.autoStep = target;
      state.step = target;
      saveSession();
    }
    // La vue de jeu n'a pas de champ de saisie : on peut la redessiner chaque seconde.
    if (state.view === "play") render();
    else updateVisionStatus();
    return;
  }
  if (event.type === "error") state.vision.error = event.message;
  else if (event.type === "status") state.vision = { status: event.code, error: null };
  // Après une erreur (autorisation manquante…), l'arrêt garde le message d'erreur.
  else state.vision.status = "stopped";
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

  const gameTime = clock.current(Date.now());
  const followsClock = stepForClock(steps, 0) !== null;
  const count = h("span", "bo-count", `${state.step + 1}/${steps.length}`);
  if (gameTime !== null) {
    const live = h("span", "chip live", `⏱ ${formatClock(gameTime)}`);
    live.title = followsClock ? "Horloge du jeu : le BO avance tout seul" : "Horloge du jeu";
    count.prepend(live, " ");
  }

  const view = h("main", "play");
  view.append(
    h("div", "bo-title", h("span", "bo-name", saved.build.name), count),
    targets(step),
    notes(step.notes, "notes"),
  );
  if (next) view.append(h("div", "next-label", "Ensuite"), notes(next.notes.slice(0, 2), "notes next"));

  const nav = h("div", "nav");
  const prev = button("◀", "Étape précédente", () => goToStep(state.step - 1));
  const nextBtn = button("▶", "Étape suivante", () => goToStep(state.step + 1));
  prev.disabled = state.step === 0;
  nextBtn.disabled = !next;
  const navHint = gameTime !== null && !followsClock ? "Pas de temps dans ce BO : ⌘⌥← / ⌘⌥→" : "⌘⌥← / ⌘⌥→";
  nav.append(prev, h("span", "hint", navHint), nextBtn);
  view.append(nav);
  return view;
}

function targets(step: BuildOrderStep): HTMLElement {
  const r = step.resources;
  const items: [string, number | string | undefined, string][] = [
    ["🕒", step.time, "Temps visé"],
    ["👤", step.villager_count, "Villageois"],
    ["🍖", r.food, "Nourriture"],
    ["🪵", r.wood, "Bois"],
    ["🪙", r.gold, "Or"],
    ["🪨", r.stone, "Pierre"],
    ["🔨", r.builder, "Bâtisseurs"],
  ];
  const row = h("div", "targets");
  for (const [icon, value, label] of items) {
    // -1 signifie « non précisé » dans le format RTS_Overlay.
    if (value === undefined || value === -1) continue;
    const chip = h("span", "chip", `${icon} ${value}`);
    chip.title = label;
    row.append(chip);
  }
  if (step.age > 0) row.append(h("span", "chip age", `Âge ${["I", "II", "III", "IV"][step.age - 1] ?? step.age}`));
  return row;
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
  if (time !== null) return `Horloge du jeu lue : ${formatClock(time)}.`;
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
    h("label", "checkbox", readScreen, "Lire l'horloge du jeu dans GeForce Now (le BO avance tout seul)"),
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
