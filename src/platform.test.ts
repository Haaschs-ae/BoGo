import { afterEach, describe, expect, it, vi } from "vitest";
import { acceleratorFromEvent, checkHotkey, DEFAULT_HOTKEYS, hotkeyLabel, HOTKEYS, KEYS, sameHotkey, setHotkeys } from "./platform";

// Sous Node, navigator.userAgent ne dit pas « Macintosh » : c'est le comportement Windows.
const keys = (code: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

afterEach(() => setHotkeys());

describe("raccourcis (Windows)", () => {
  it("écrit les raccourcis comme sur un clavier français", () => {
    expect(hotkeyLabel(DEFAULT_HOTKEYS.next)).toBe("Ctrl+Maj+→");
    expect(hotkeyLabel("Control+Alt+KeyL")).toBe("Ctrl+Alt+L");
    expect(hotkeyLabel("Alt+Digit3")).toBe("Alt+3");
    expect(hotkeyLabel("F9")).toBe("F9");
  });

  it("transforme la combinaison tapée en raccourci, rien tant qu'on ne tient qu'un modificateur", () => {
    expect(acceleratorFromEvent(keys("KeyL", { ctrlKey: true, shiftKey: true }))).toBe("Control+Shift+KeyL");
    expect(acceleratorFromEvent(keys("ShiftLeft", { shiftKey: true }))).toBeNull();
    expect(acceleratorFromEvent(keys("ControlRight", { ctrlKey: true }))).toBeNull();
  });

  it("refuse ce qui gênerait la frappe, AltGr, le système et les doublons", () => {
    expect(checkHotkey("KeyL", "lock")).toMatch(/Ajoute/);
    expect(checkHotkey("Shift+KeyL", "lock")).toMatch(/Ajoute/);
    expect(checkHotkey("Control+Alt+KeyL", "lock")).toMatch(/AltGr/);
    expect(checkHotkey("Alt+F4", "next")).toMatch(/réservé/);
    expect(checkHotkey(DEFAULT_HOTKEYS.previous, "next")).toMatch(/Étape précédente/);
  });

  it("accepte une touche F seule, et le raccourci actuel de la même action", () => {
    expect(checkHotkey("F9", "next")).toBeNull();
    expect(checkHotkey("Alt+ArrowRight", "next")).toBeNull();
    expect(checkHotkey(DEFAULT_HOTKEYS.next, "next")).toBeNull();
  });

  it("applique les raccourcis choisis, les autres gardent leur valeur par défaut", () => {
    setHotkeys({ next: "F9" });
    expect(HOTKEYS.next).toBe("F9");
    expect(KEYS.next).toBe("F9");
    expect(HOTKEYS.previous).toBe(DEFAULT_HOTKEYS.previous);
    expect(checkHotkey("F9", "previous")).toMatch(/Étape suivante/);
  });

  it("CommandOrControl vaut Ctrl", () => {
    expect(sameHotkey("CommandOrControl+KeyB", "Control+KeyB")).toBe(true);
    expect(sameHotkey("CommandOrControl+KeyB", "Super+KeyB")).toBe(false);
  });
});

describe("raccourcis (Mac)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("⌘⌥ par défaut, ⌘ tapé = CommandOrControl", async () => {
    vi.resetModules();
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" });
    const mac = await import("./platform");
    expect(mac.hotkeyLabel(mac.DEFAULT_HOTKEYS.next)).toBe("⌘⌥→");
    expect(mac.hotkeyLabel("Control+Shift+F5")).toBe("⌃⇧F5");
    const typed = mac.acceleratorFromEvent(keys("KeyL", { metaKey: true, altKey: true }));
    expect(typed).toBe("Command+Alt+KeyL");
    expect(mac.sameHotkey(typed!, mac.DEFAULT_HOTKEYS.lock)).toBe(true);
    expect(mac.checkHotkey("Command+KeyQ", "next")).toMatch(/réservé/);
    // Ctrl+Alt n'est pas AltGr sur Mac.
    expect(mac.checkHotkey("Control+Alt+KeyN", "next")).toBeNull();
  });
});
