// Écrit latest.json, lu par BoGo pour savoir s'il y a une nouvelle version (plugin updater).
// Usage : node scripts/latest-json.mjs <version> <dossier des fichiers> <notes.md> > latest.json
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [version, dir, notesFile] = process.argv.slice(2);
const base = `https://github.com/${process.env.GITHUB_REPOSITORY ?? "Haaschs-ae/BoGo"}/releases/download/v${version}`;
const platforms = {};

function add(keys, file) {
  const path = join(dir, file);
  if (!existsSync(path) || !existsSync(`${path}.sig`)) return;
  const entry = { signature: readFileSync(`${path}.sig`, "utf8").trim(), url: `${base}/${encodeURIComponent(file)}` };
  for (const key of keys) platforms[key] = entry;
}

// Mac : une appli universelle pour les deux processeurs.
add(["darwin-aarch64", "darwin-x86_64"], "BoGo.app.tar.gz");
// Windows : l'installateur lui-même sert à la mise à jour.
add(["windows-x86_64"], `BoGo_${version}_x64-setup.exe`);

if (Object.keys(platforms).length === 0) {
  console.error("Aucun fichier de mise à jour signé trouvé dans", dir);
  process.exit(1);
}
const notes = existsSync(notesFile) ? readFileSync(notesFile, "utf8").trim() : "";
process.stdout.write(`${JSON.stringify({ version, notes, pub_date: new Date().toISOString(), platforms }, null, 2)}\n`);
