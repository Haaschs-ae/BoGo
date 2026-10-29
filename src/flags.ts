import { civilizationId } from "./civs";

// Drapeaux embarqués dans l'appli (src/assets/flags/<identifiant AoE4World>.png).
const FLAGS: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("./assets/flags/*.png", { eager: true, query: "?url", import: "default" }),
  ).map(([path, url]) => [path.replace(/^.*\/(.+)\.png$/, "$1"), url]),
);

export function flagUrl(civilization: string): string {
  return FLAGS[civilizationId(civilization) ?? "unknown"] ?? FLAGS.unknown;
}
