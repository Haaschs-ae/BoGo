import { describe, expect, it } from "vitest";
import { shortNotes, UPDATE_EVERY_MS, updateDue } from "./update";

describe("mise à jour de BoGo", () => {
  it("cherche au lancement puis toutes les 6 heures, jamais pendant une partie", () => {
    expect(updateDue(null, 1000, false)).toBe(true);
    expect(updateDue(null, 1000, true)).toBe(false);
    expect(updateDue(0, UPDATE_EVERY_MS - 1, false)).toBe(false);
    expect(updateDue(0, UPDATE_EVERY_MS, false)).toBe(true);
    expect(updateDue(0, UPDATE_EVERY_MS, true)).toBe(false);
  });

  it("garde des notes de version courtes et lisibles", () => {
    const body = "## Nouveautés\n\n- **Comptes** en direct plus sûrs\n* `Ctrl+Alt` sur Mac\n\nhttps://example.com\n1. Un\n2. Deux";
    expect(shortNotes(body)).toBe("Nouveautés\nComptes en direct plus sûrs\nCtrl+Alt sur Mac\nUn");
    expect(shortNotes(undefined)).toBe("");
  });
});
