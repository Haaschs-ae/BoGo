import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register } from "@tauri-apps/plugin-global-shortcut";
import { extractBuildId, fetchBuild } from "./aoe4guides";
import {
  civilizationsOf,
  imageLabel,
  parseBuildOrder,
  tokenizeNote,
  type BuildOrder,
  type BuildOrderStep,
} from "./buildOrder";
import { CIVILIZATIONS } from "./civs";
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

const SESSION_KEY = "bogo.session.v1";

interface State {
  view: "library" | "play";
  library: SavedBuild[];
  civ: string;
  style: Style | "";
  currentId: string | null;
  step: number;
  locked: boolean;
  importStatus: { text: string; error: boolean } | null;
}

const state: State = {
  view: "library",
  library: loadLibrary(localStorage),
  civ: "",
  style: "",
  currentId: null,
  step: 0,
  locked: false,
  importStatus: null,
};
restoreSession();

const app = document.querySelector<HTMLDivElement>("#app")!;
const appWindow = getCurrentWindow();

render();
registerHotkeys();

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
  state.importStatus = { text: "Import en cours…", error: false };
  render();
  try {
    let build: BuildOrder;
    let sourceUrl: string | undefined;
    if (text.startsWith("{")) {
      build = parseBuildOrder(text);
    } else {
      const id = extractBuildId(text);
      if (!id) throw new Error("Colle un lien aoe4guides.com/builds/… ou le JSON de l'export Overlay Tool.");
      build = await fetchBuild(id);
      sourceUrl = `https://aoe4guides.com/builds/${id}`;
    }
    state.library = addBuild(state.library, build, style, sourceUrl);
    saveLibrary(localStorage, state.library);
    state.importStatus = { text: `« ${build.name} » ajouté.`, error: false };
  } catch (err) {
    state.importStatus = { text: err instanceof Error ? err.message : String(err), error: true };
  }
  render();
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
  app.replaceChildren(header(), state.view === "play" && current() ? playView(current()!) : libraryView());
}

function header(): HTMLElement {
  const bar = h("header", "bar");
  bar.dataset.tauriDragRegion = "";
  const title = h("span", "title", "BoGo");
  title.dataset.tauriDragRegion = "";
  const actions = h("div", "actions");
  if (state.view === "play") actions.append(button("📚", "Bibliothèque", () => ((state.view = "library"), render())));
  else if (current()) actions.append(button("▶", "Reprendre le BO", () => ((state.view = "play"), render())));
  actions.append(
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

  const view = h("main", "play");
  view.append(
    h("div", "bo-title", h("span", "bo-name", saved.build.name), h("span", "bo-count", `${state.step + 1}/${steps.length}`)),
    targets(step),
    notes(step.notes, "notes"),
  );
  if (next) view.append(h("div", "next-label", "Ensuite"), notes(next.notes.slice(0, 2), "notes next"));

  const nav = h("div", "nav");
  const prev = button("◀", "Étape précédente", () => goToStep(state.step - 1));
  const nextBtn = button("▶", "Étape suivante", () => goToStep(state.step + 1));
  prev.disabled = state.step === 0;
  nextBtn.disabled = !next;
  nav.append(prev, h("span", "hint", "⌘⌥← / ⌘⌥→"), nextBtn);
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

function libraryView(): HTMLElement {
  const view = h("main", "library");

  const civSelect = select(
    [["", "Toutes les civs"], ...CIVILIZATIONS.map((c): [string, string] => [c, c])],
    state.civ,
    (v) => ((state.civ = v), saveSession(), render()),
  );
  const styleSelect = select(
    [["", "Tous les styles"], ...Object.entries(STYLES)],
    state.style,
    (v) => ((state.style = v as Style | ""), render()),
  );
  view.append(h("div", "filters", civSelect, styleSelect));

  const builds = filterBuilds(state.library, state.civ, state.style);
  const list = h("ul", "builds");
  if (builds.length === 0) list.append(h("li", "empty", "Aucun BO pour ce filtre. Importe-en un ci-dessous."));
  for (const b of builds) {
    const info = h(
      "div",
      "build-info",
      h("span", "build-name", b.build.name),
      h("span", "build-meta", `${STYLES[b.style]} · ${civilizationsOf(b.build).join(", ")}`),
    );
    const del = button("🗑", "Supprimer", () => {
      state.library = removeBuild(state.library, b.id);
      saveLibrary(localStorage, state.library);
      if (state.currentId === b.id) state.currentId = null;
      render();
    });
    const item = h("li", "build", info, button("▶", "Jouer ce BO", () => play(b.id)), del);
    list.append(item);
  }
  view.append(list);

  const input = document.createElement("textarea");
  input.placeholder = "Lien aoe4guides.com/builds/… ou JSON de l'export « Overlay Tool »";
  input.rows = 2;
  let importStyle: Style = state.style || "boom";
  const importStyleSelect = select(Object.entries(STYLES), importStyle, (v) => (importStyle = v as Style));
  const go = button("Importer", "Importer le BO", () => importBuild(input.value, importStyle));
  go.classList.add("primary");
  const form = h("div", "import", input, h("div", "import-row", importStyleSelect, go));
  if (state.importStatus) {
    form.append(h("p", state.importStatus.error ? "status error" : "status", state.importStatus.text));
  }
  view.append(form, h("p", "hint", "⌘⌥←/→ étapes · ⌘⌥L verrouiller · ⌘⌥B afficher/masquer"));
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
