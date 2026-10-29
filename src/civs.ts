// Identifiants AoE4World → noms utilisés dans les BO d'aoe4guides / RTS_Overlay.
export const CIVILIZATION_NAMES: Record<string, string> = {
  abbasid_dynasty: "Abbasid Dynasty",
  ayyubids: "Ayyubids",
  byzantines: "Byzantines",
  chinese: "Chinese",
  delhi_sultanate: "Delhi Sultanate",
  english: "English",
  french: "French",
  golden_horde: "Golden Horde",
  holy_roman_empire: "Holy Roman Empire",
  house_of_lancaster: "House of Lancaster",
  japanese: "Japanese",
  jeanne_darc: "Jeanne d'Arc",
  jin_dynasty: "Jin Dynasty",
  knights_templar: "Knights Templar",
  macedonian_dynasty: "Macedonian Dynasty",
  malians: "Malians",
  mongols: "Mongols",
  order_of_the_dragon: "Order of the Dragon",
  ottomans: "Ottomans",
  rus: "Rus",
  scots: "Scots",
  sengoku_daimyo: "Sengoku Daimyo",
  tughlaq_dynasty: "Tughlaq Dynasty",
  vikings: "Vikings",
  zhu_xis_legacy: "Zhu Xi's Legacy",
};

export const CIVILIZATIONS = Object.values(CIVILIZATION_NAMES).sort();

/** "knights_templar" → "Knights Templar" ; une civ inconnue (nouveau DLC) est mise en forme au mieux. */
export function civilizationName(aoe4worldId: string): string {
  return (
    CIVILIZATION_NAMES[aoe4worldId] ??
    aoe4worldId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/** "Knights Templar" → "knights_templar" (insensible à la casse) ; null si la civ est inconnue. */
export function civilizationId(name: string): string | null {
  const lower = name.toLowerCase();
  const entry = Object.entries(CIVILIZATION_NAMES).find(([, n]) => n.toLowerCase() === lower);
  return entry ? entry[0] : null;
}
