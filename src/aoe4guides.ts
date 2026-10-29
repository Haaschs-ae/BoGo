import { invoke } from "@tauri-apps/api/core";
import { parseBuildOrder, type BuildOrder } from "./buildOrder";

/** Extrait l'identifiant d'un lien aoe4guides.com/builds/<id>, ou accepte l'identifiant seul. */
export function extractBuildId(input: string): string | null {
  const text = input.trim();
  const fromUrl = /aoe4guides\.com\/builds\/([A-Za-z0-9]+)/.exec(text);
  if (fromUrl) return fromUrl[1];
  return /^[A-Za-z0-9]{8,40}$/.test(text) ? text : null;
}

/** Télécharge un BO au format overlay. La requête passe par Rust pour éviter les blocages CORS. */
export async function fetchBuild(id: string): Promise<BuildOrder> {
  const data = await invoke<unknown>("fetch_aoe4guides_build", { id });
  return parseBuildOrder(data);
}
