// Rejeu d'une partie enregistrée (réglage « Enregistrer mes parties ») : les mêmes lectures de
// l'écran, aux mêmes instants, repassent dans le moteur. On voit où le BO avance, alerte ou se
// trompe, et on règle BoGo sans repasser par GeForce Now.

import { civilizationsOf, parseBuildOrder, type BuildOrder } from "./buildOrder";
import { ClockTracker, formatClock } from "./clock";
import { BuildEngine } from "./engine";
import { parseHud, type OcrToken, type Resource } from "./hud";
import { LandmarkWatch } from "./top";

/** Une ligne du fichier d'enregistrement : heure (ms) et événement (vision ou repère de BoGo). */
export interface RecordedLine {
  t: number;
  event: { type: string; [key: string]: unknown };
}

export interface ReplayEntry {
  /** Millisecondes depuis le début de l'enregistrement. */
  t: number;
  /** Horloge du jeu lue à ce moment, en secondes, si elle l'a été. */
  clock: number | null;
  text: string;
}

const PLACE: Record<Resource, string> = { food: "à la nourriture", wood: "au bois", gold: "à l'or", stone: "à la pierre" };

/** Lit un fichier JSONL d'enregistrement (les lignes illisibles sont ignorées). */
export function parseRecording(text: string): RecordedLine[] {
  const lines: RecordedLine[] = [];
  for (const raw of text.split("\n")) {
    try {
      const line = JSON.parse(raw);
      if (typeof line?.t === "number" && typeof line?.event?.type === "string") lines.push(line);
    } catch {
      // ligne vide ou coupée : on passe
    }
  }
  return lines;
}

/** Rejoue un enregistrement ; `build` sert si l'enregistrement ne contient pas le BO lancé. */
export function replay(lines: RecordedLine[], build?: BuildOrder): ReplayEntry[] {
  const entries: ReplayEntry[] = [];
  const start = lines[0]?.t ?? 0;
  const clock = new ClockTracker();
  const landmark = new LandmarkWatch();
  let engine: BuildEngine | null = null;
  let logged = 0;
  let alert = "";
  let finished = false;

  const at = (t: number, text: string) => entries.push({ t: t - start, clock: clock.current(t, 60_000), text });
  const launch = (t: number, bo: BuildOrder) => {
    engine = new BuildEngine(bo.build_order, civilizationsOf(bo)[0]);
    logged = 0;
    alert = "";
    finished = false;
    at(t, `BO lancé : ${bo.name} (${bo.build_order.length} étapes)`);
  };
  // Nouvelles lignes du journal du moteur (il garde les plus récentes en tête).
  const flushLog = (t: number) => {
    if (!engine) return;
    const fresh = engine.log.length - logged;
    for (let i = Math.min(fresh, engine.log.length) - 1; i >= 0; i--) at(t, engine.log[i]);
    logged = engine.log.length;
  };

  if (build) launch(lines[0]?.t ?? 0, build);
  for (const { t, event } of lines) {
    switch (event.type) {
      case "bo":
        try {
          launch(t, parseBuildOrder(event.build));
        } catch {
          at(t, "BO illisible dans l'enregistrement");
        }
        break;
      case "clock":
        if (typeof event.seconds === "number") clock.read(event.seconds, t);
        break;
      case "step":
        if (engine && typeof event.step === "number") {
          (engine as BuildEngine).setStep(event.step, "clavier");
          flushLog(t);
        }
        break;
      case "top":
        if (engine && landmark.observe(event.tokens as OcrToken[], t)) {
          (engine as BuildEngine).ageUpStarted();
          flushLog(t);
        }
        break;
      case "hud": {
        const reading = parseHud(event.tokens as OcrToken[]);
        if (!engine || !reading) break;
        const state = (engine as BuildEngine).update(reading, t);
        flushLog(t);
        const m = state.misplacement;
        const now = m
          ? `alerte : ${m.excess} de trop ${PLACE[m.from]}${m.to ? `, ${m.count} à envoyer ${PLACE[m.to]}` : ""}`
          : "";
        if (now !== alert) at(t, now || "alerte terminée");
        alert = now;
        if (state.completed && !finished) at(t, "BO terminé");
        finished = state.completed;
        break;
      }
      case "status":
      case "error":
      case "stopped":
        at(t, `lecture : ${event.type} ${String(event.code ?? event.message ?? event.detail ?? "").trim()}`.trim());
        break;
    }
  }
  return entries;
}

/** Journal lisible : « 0:41 (+52 s) · Étape 2 → 3 : … ». */
export function formatReplay(entries: ReplayEntry[]): string {
  return entries
    .map((e) => `${e.clock === null ? "  -  " : formatClock(e.clock).padStart(5)} (+${Math.round(e.t / 1000)} s) · ${e.text}`)
    .join("\n");
}
