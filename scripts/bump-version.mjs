// Change la version de BoGo partout où elle est écrite : node scripts/bump-version.mjs 0.2.1
// Pousser une nouvelle version sur la branche de publication la publie (voir docs/publier.md).
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage : node scripts/bump-version.mjs X.Y.Z");
  process.exit(1);
}
const edit = (file, from, to) => {
  const text = readFileSync(file, "utf8");
  if (!from.test(text)) throw new Error(`Version introuvable dans ${file}`);
  writeFileSync(file, text.replace(from, to));
};
edit("package.json", /"version": "[^"]+"/, `"version": "${version}"`);
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
lock.version = version;
lock.packages[""].version = version;
writeFileSync("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);
edit("src-tauri/tauri.conf.json", /"version": "[^"]+"/, `"version": "${version}"`);
edit("src-tauri/Cargo.toml", /^version = "[^"]+"/m, `version = "${version}"`);
console.log(`BoGo ${version} : pense à ajouter ses nouveautés dans docs/nouveautes.md.`);
