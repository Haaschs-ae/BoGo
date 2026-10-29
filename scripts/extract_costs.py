"""Extrait de aoe4world/data le coût du TC et des passages d'âge de chaque civ.

Le dépôt aoe4world/data est sous licence MIT, mais les données du jeu restent © Microsoft :
usage selon les Game Content Usage Rules (https://www.xbox.com/en-US/developers/rules).

Usage : python3 scripts/extract_costs.py <chemin vers un clone de github.com/aoe4world/data>
Écrit src/data/costs.json, indexé par identifiant de civ AoE4World (« english », « abbasid_dynasty »…).
Pour chaque âge visé (2, 3, 4) : la liste des coûts possibles (un par landmark ou technologie
de passage d'âge), du plus courant au moins courant.
"""

import json
import re
import sys
from collections import Counter
from pathlib import Path

RESOURCES = ("food", "wood", "gold", "stone")


def cost_of(item):
    return {r: item["costs"][r] for r in RESOURCES if item["costs"].get(r)}


def main(data_dir: Path):
    civs = json.loads((data_dir / "civilizations/civs-index.json").read_text())
    result = {}
    for civ in civs.values():
        buildings = json.loads((data_dir / f"buildings/{civ['slug']}.json").read_text())["data"]
        technologies = json.loads((data_dir / f"technologies/{civ['slug']}.json").read_text())["data"]

        tc = next(
            (cost_of(b) for b in sorted(buildings, key=lambda b: b["age"]) if b["baseId"] == "town-center"),
            None,
        )

        ages = {}
        # Landmarks : la classe « ageN_landmarkM » indique un monument construit à l'âge N pour passer à N+1.
        for b in buildings:
            for c in b.get("classes", []):
                m = re.match(r"age(\d)_landmark", c)
                if m and b["age"] == int(m.group(1)):
                    ages.setdefault(int(m.group(1)) + 1, []).append(cost_of(b))
        # Civs sans landmark (Abbassides, Templiers…) : technologies de passage d'âge.
        for t in technologies:
            if "age_up_upgrade" in t.get("classes", []) and t["age"] < 4:
                ages.setdefault(t["age"] + 1, []).append(cost_of(t))

        options = {}
        for age, costs in sorted(ages.items()):
            counted = Counter(json.dumps(c, sort_keys=True) for c in costs if c)
            options[str(age)] = [json.loads(c) for c, _ in counted.most_common()]
        result[civ["id"]] = {"name": civ["name"], "townCenter": tc, "ages": options}

    out = Path(__file__).resolve().parent.parent / "src/data/costs.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(f"{len(result)} civilisations → {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
