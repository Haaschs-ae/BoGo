// Haut de l'écran d'AoE4 : horloge, et pendant un passage d'âge, l'icône du landmark avec une
// barre de progression et le nombre de villageois qui le construisent, au-dessus de l'horloge.
import type { OcrToken } from "./hud";

const CLOCK = /^\d{1,2}:\d{2}(:\d{2})?$/;

/** Villageois qui construisent le landmark, ou null si aucun passage d'âge n'est en cours. */
export function ageUpBuilders(tokens: OcrToken[]): number | null {
  const clock = tokens.find((t) => CLOCK.test(t.text.replace(/[Oo]/g, "0").trim()));
  if (!clock) return null;
  const counter = tokens.find((t) => t !== clock && /^\d{1,2}$/.test(t.text.trim()) && t.y + t.h <= clock.y + clock.h / 2);
  return counter ? Number(counter.text.trim()) : null;
}

/** Une lecture sans compteur ne suffit pas à dire que le landmark est fini : il faut ce délai. */
const REARM_MS = 15000;

/**
 * Landmark en construction vu en haut de l'écran : signalé une seule fois, après deux lectures
 * de suite (chiffre parasite), et réarmé seulement après 15 s sans compteur. Une lecture ratée
 * pendant les 2-3 minutes de construction ne doit pas faire sauter un âge.
 */
export class LandmarkWatch {
  private seen = false;
  private handled = false;
  private lastSeenAt = Number.NEGATIVE_INFINITY;

  /** Renvoie true quand un nouveau passage d'âge vient d'être confirmé. */
  observe(tokens: OcrToken[], now: number): boolean {
    if (ageUpBuilders(tokens) === null) {
      if (now - this.lastSeenAt > REARM_MS) this.handled = false;
      this.seen = false;
      return false;
    }
    const confirmed = this.seen && !this.handled;
    this.seen = true;
    this.lastSeenAt = now;
    if (confirmed) this.handled = true;
    return confirmed;
  }
}
