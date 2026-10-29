// Ce qui change entre l'appli Mac et l'appli Windows : raccourcis, libellés, lecture de l'écran.
// Tout le reste (moteur, interface, données) est commun.

/** WKWebView (macOS) annonce « Macintosh » ; WebView2 (Windows) annonce « Windows ». */
export const IS_MAC = /Macintosh|Mac OS X/i.test(navigator.userAgent);

/**
 * Lecture de l'écran (horloge, panneau des villageois) : macOS seulement pour l'instant.
 * Sous Windows, BoGo suit le BO avec les raccourcis en attendant le lecteur Windows.
 */
export const SCREEN_READING = IS_MAC;

export type HotkeyAction = "next" | "previous" | "lock" | "toggle" | "mini" | "launch" | "cancel" | "cat1" | "cat2" | "cat3" | "cat4";

/**
 * `choice` : raccourcis de l'écran de choix du début de partie, actifs seulement de la détection
 * de la partie au premier passage d'âge (ils ne prennent pas ces touches aux autres applis le
 * reste du temps).
 */
export const HOTKEY_ACTIONS: { action: HotkeyAction; label: string; choice?: true }[] = [
  { action: "next", label: "Étape suivante" },
  { action: "previous", label: "Étape précédente" },
  { action: "lock", label: "Verrouiller (clics vers le jeu)" },
  { action: "toggle", label: "Afficher / masquer BoGo" },
  { action: "mini", label: "Réduire / agrandir" },
  { action: "launch", label: "Lancer le BO proposé", choice: true },
  { action: "cancel", label: "Annuler le lancement auto", choice: true },
  { action: "cat1", label: "BO Boom", choice: true },
  { action: "cat2", label: "BO Agressif", choice: true },
  { action: "cat3", label: "BO Fast Castle", choice: true },
  { action: "cat4", label: "BO Autre", choice: true },
];

/**
 * Raccourcis par défaut, au format du plugin global-shortcut. Sous Windows, pas de Ctrl+Alt :
 * c'est AltGr sur un clavier AZERTY, et Microsoft le déconseille pour les raccourcis d'applis.
 */
export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = (() => {
  const mod = IS_MAC ? "CommandOrControl+Alt" : "Control+Shift";
  return {
    next: `${mod}+ArrowRight`,
    previous: `${mod}+ArrowLeft`,
    lock: `${mod}+KeyL`,
    toggle: `${mod}+KeyB`,
    mini: `${mod}+KeyM`,
    launch: `${mod}+Enter`,
    cancel: `${mod}+Backspace`,
    cat1: `${mod}+Digit1`,
    cat2: `${mod}+Digit2`,
    cat3: `${mod}+Digit3`,
    cat4: `${mod}+Digit4`,
  };
})();

/** Raccourcis en vigueur (par défaut, ou choisis dans les réglages). */
export const HOTKEYS: Record<HotkeyAction, string> = { ...DEFAULT_HOTKEYS };

/** Libellés en vigueur : « ⌘⌥→ » sur Mac, « Ctrl+Maj+→ » sous Windows. Lus à chaque affichage. */
export const KEYS = {} as Record<HotkeyAction, string>;

/** Applique les raccourcis choisis (les autres reprennent leur valeur par défaut). */
export function setHotkeys(custom: Partial<Record<HotkeyAction, string>> = {}) {
  for (const { action } of HOTKEY_ACTIONS) {
    HOTKEYS[action] = custom[action] || DEFAULT_HOTKEYS[action];
    KEYS[action] = hotkeyLabel(HOTKEYS[action]);
  }
}

export function hotkeyHint(): string {
  return `${KEYS.previous} / ${KEYS.next} étapes · ${KEYS.mini} réduire · ${KEYS.lock} verrouiller · ${KEYS.toggle} afficher/masquer`;
}

const MAC_MODIFIERS: Record<string, string> = { commandorcontrol: "⌘", command: "⌘", cmd: "⌘", super: "⌘", meta: "⌘", alt: "⌥", option: "⌥", control: "⌃", ctrl: "⌃", shift: "⇧" };
const WIN_MODIFIERS: Record<string, string> = { commandorcontrol: "Ctrl+", control: "Ctrl+", ctrl: "Ctrl+", alt: "Alt+", option: "Alt+", shift: "Maj+", super: "Win+", command: "Win+", meta: "Win+" };
const KEY_LABELS: Record<string, string> = {
  arrowright: "→", arrowleft: "←", arrowup: "↑", arrowdown: "↓",
  space: "Espace", enter: IS_MAC ? "↵" : "Entrée", backspace: "⌫", delete: "Suppr", tab: "Tab", escape: "Échap",
  pageup: "Page↑", pagedown: "Page↓", home: "Début", end: "Fin",
};

/** « CommandOrControl+Alt+ArrowRight » → « ⌘⌥→ » (Mac) ou « Ctrl+Alt+→ » (Windows). */
export function hotkeyLabel(accelerator: string): string {
  const parts = accelerator.split("+");
  const key = parts.pop() ?? "";
  const mods = IS_MAC ? MAC_MODIFIERS : WIN_MODIFIERS;
  const lower = key.toLowerCase();
  const keyLabel =
    KEY_LABELS[lower] ??
    (/^key[a-z]$/.test(lower) ? key.slice(3).toUpperCase() : /^digit\d$/.test(lower) ? key.slice(5) : /^numpad\d$/.test(lower) ? `Pavé ${key.slice(6)}` : key);
  return parts.map((m) => mods[m.toLowerCase()] ?? `${m}+`).join("") + keyLabel;
}

const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS|Fn|CapsLock)(Left|Right)?$/;

/**
 * Combinaison tapée → raccourci au format du plugin, ou null tant qu'aucune touche autre qu'un
 * modificateur n'est enfoncée.
 */
export function acceleratorFromEvent(e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): string | null {
  if (!e.code || MODIFIER_CODES.test(e.code)) return null;
  const mods: string[] = [];
  if (e.metaKey) mods.push(IS_MAC ? "Command" : "Super");
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  return [...mods, e.code].join("+");
}

/** Raccourcis du système qu'on ne prend jamais (quitter, changer d'appli, Forcer à quitter…). */
const RESERVED = IS_MAC
  ? ["Command+KeyQ", "Command+KeyW", "Command+Tab", "Command+Space", "Command+KeyH", "Command+Alt+Escape", "Command+Alt+KeyD", "Command+Shift+Digit3", "Command+Shift+Digit4"]
  : ["Alt+Tab", "Alt+F4", "Control+Alt+Delete", "Control+Escape", "Control+Shift+Escape", "Super+KeyL", "Super+KeyD"];

/** Pourquoi ce raccourci est refusé, ou null s'il convient. */
export function checkHotkey(accelerator: string, action: HotkeyAction): string | null {
  const parts = accelerator.split("+");
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  // Une touche F seule ne gêne pas la frappe (chat du jeu, recherche) : elle est permise.
  if (!/^F([1-9]|1\d|2[0-4])$/.test(key) && !mods.some((m) => /^(Command|Control|Alt|Super)$/.test(m))) {
    return `Ajoute ${IS_MAC ? "⌘, ⌃ ou ⌥" : "Ctrl ou Alt"}, ou prends une touche F : une touche seule (ou avec ${IS_MAC ? "⇧" : "Maj"}) gênerait la frappe partout.`;
  }
  if (!IS_MAC && mods.includes("Control") && mods.includes("Alt") && /^(Digit|Key)/.test(key)) {
    return "Ctrl+Alt avec une lettre ou un chiffre, c'est AltGr sur un clavier AZERTY (@, #, €…) : choisis une autre combinaison.";
  }
  if (RESERVED.includes(accelerator)) return "Raccourci réservé au système.";
  const other = HOTKEY_ACTIONS.find((a) => a.action !== action && sameHotkey(HOTKEYS[a.action], accelerator));
  return other ? `Déjà utilisé par BoGo pour « ${other.label} ».` : null;
}

/** « CommandOrControl » vaut ⌘ sur Mac, Ctrl sous Windows. */
export function sameHotkey(a: string, b: string): boolean {
  const norm = (s: string) => s.replace("CommandOrControl", IS_MAC ? "Command" : "Control").toLowerCase();
  return norm(a) === norm(b);
}

// En fin de fichier : les tables de libellés ci-dessus sont alors initialisées.
setHotkeys();
