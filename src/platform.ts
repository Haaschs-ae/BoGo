// Ce qui change entre l'appli Mac et l'appli Windows : raccourcis, libellés, lecture de l'écran.
// Tout le reste (moteur, interface, données) est commun.

/** WKWebView (macOS) annonce « Macintosh » ; WebView2 (Windows) annonce « Windows ». */
export const IS_MAC = /Macintosh|Mac OS X/i.test(navigator.userAgent);

/**
 * Lecture de l'écran (horloge, panneau des villageois) : macOS seulement pour l'instant.
 * Sous Windows, BoGo suit le BO à la main (⌘⌥→ devient Ctrl+Maj+→) en attendant le lecteur Windows.
 */
export const SCREEN_READING = IS_MAC;

/**
 * Touches de modification des raccourcis globaux. Sous Windows, pas de Ctrl+Alt : c'est AltGr sur
 * un clavier AZERTY, et Microsoft le déconseille pour les raccourcis d'applis.
 */
const MODIFIER = IS_MAC ? { keys: "CommandOrControl+Alt", label: "⌘⌥" } : { keys: "Control+Shift", label: "Ctrl+Maj+" };

const KEY_NAMES = { next: ["ArrowRight", "→"], previous: ["ArrowLeft", "←"], lock: ["L", "L"], toggle: ["B", "B"], mini: ["M", "M"] } as const;

export type HotkeyAction = keyof typeof KEY_NAMES;

/** Raccourcis au format du plugin global-shortcut. */
export const HOTKEYS = Object.fromEntries(
  Object.entries(KEY_NAMES).map(([action, [key]]) => [action, `${MODIFIER.keys}+${key}`]),
) as Record<HotkeyAction, string>;

/** Libellés affichés : « ⌘⌥→ » sur Mac, « Ctrl+Maj+→ » sous Windows. */
export const KEYS = Object.fromEntries(
  Object.entries(KEY_NAMES).map(([action, [, label]]) => [action, `${MODIFIER.label}${label}`]),
) as Record<HotkeyAction, string>;

export const HOTKEY_HINT = `${MODIFIER.label}←/→ étapes · ${KEYS.mini} réduire · ${KEYS.lock} verrouiller · ${KEYS.toggle} afficher/masquer`;
