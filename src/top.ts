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
