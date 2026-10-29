import { parseTime, type BuildOrderStep } from "./buildOrder";

/**
 * Filtre les lectures de l'horloge du jeu. La compression vidéo de GeForce Now
 * peut faire mal lire un chiffre : une lecture n'est retenue que si elle colle à
 * l'heure attendue, ou si deux lectures de suite se confirment (nouvelle partie,
 * pause, rechargement).
 */
export class ClockTracker {
  private accepted: { seconds: number; at: number } | null = null;
  private pending: { seconds: number; at: number } | null = null;

  /** Ajoute une lecture faite à `now` (ms) ; renvoie le temps de jeu retenu, ou null. */
  read(seconds: number, now: number): number | null {
    if (!this.accepted || near(this.accepted, seconds, now, 3)) return this.accept(seconds, now);
    if (this.pending && near(this.pending, seconds, now, 2)) return this.accept(seconds, now);
    this.pending = { seconds, at: now };
    return null;
  }

  /** Temps de jeu estimé à `now`, ou null si aucune lecture fiable n'est récente. */
  current(now: number, maxAgeMs = 5000): number | null {
    if (!this.accepted || now - this.accepted.at > maxAgeMs) return null;
    return this.accepted.seconds;
  }

  private accept(seconds: number, now: number): number {
    this.accepted = { seconds, at: now };
    this.pending = null;
    return seconds;
  }
}

function near(previous: { seconds: number; at: number }, seconds: number, now: number, tolerance: number): boolean {
  const expected = previous.seconds + (now - previous.at) / 1000;
  return Math.abs(seconds - expected) <= tolerance;
}

/**
 * Étape du BO correspondant au temps de jeu : la dernière dont le temps est atteint.
 * Null si le BO n'a pas de temps sur toutes ses étapes.
 */
export function stepForClock(steps: BuildOrderStep[], seconds: number): number | null {
  const times = steps.map((s) => (s.time === undefined ? null : parseTime(s.time)));
  if (times.some((t) => t === null)) return null;
  let index = 0;
  times.forEach((t, i) => {
    if (t! <= seconds) index = i;
  });
  return index;
}

/** 125 → "2:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
