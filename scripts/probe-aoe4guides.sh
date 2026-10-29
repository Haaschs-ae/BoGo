#!/usr/bin/env bash
# Sonde l'API publique d'aoe4guides depuis une machine qui y a accès (ton Mac) : 15 requêtes,
# sous les limites d'usage (30 listes/min), sans aucune donnée personnelle. Les réponses sont
# écrites dans un dossier à envoyer tel quel. Voir docs/conseil-bo.md.
set -u
OUT="${1:-$HOME/Desktop/bogo-sonde-aoe4guides}"
mkdir -p "$OUT"
UA="BoGo-probe/0.1 (+https://github.com/Haaschs-ae/BoGo)"

get() {
  local name="$1" url="$2"
  echo "→ $name"
  curl -sS -L --max-time 20 -A "$UA" -D "$OUT/$name.headers" -o "$OUT/$name.json" -w "%{http_code} %{url_effective}\n" "$url" \
    | tee -a "$OUT/_statuts.txt"
  sleep 3
}

SITE="https://aoe4guides.com/api"
CLOUD="https://aoe4-guides-api-7h2vti5ckq-ey.a.run.app"

get status            "$SITE/status"
get eng-score         "$SITE/builds?civ=ENG&orderBy=score"
get eng-likes         "$SITE/builds?civ=ENG&orderBy=likes"
get eng-time          "$SITE/builds?civ=ENG&orderBy=timeCreated"
get eng-alltime       "$SITE/builds?civ=ENG&orderBy=scoreAllTime"
get eng-strategy      "$SITE/builds?civ=ENG&strategy=Boom"
get eng-season        "$SITE/builds?civ=ENG&season=13"
get eng-limit         "$SITE/builds?civ=ENG&limit=20"
get eng-overlay       "$SITE/builds?civ=ENG&orderBy=score&overlay=true"
get goh-score         "$SITE/builds?civ=GOH&orderBy=score"
get gol-score         "$SITE/builds?civ=GOL&orderBy=score"
get jin-score         "$SITE/builds?civ=JIN&orderBy=score"
get cloud-eng-score   "$CLOUD/builds?civ=ENG&orderBy=score"
get cloud-api-eng     "$CLOUD/api/builds?civ=ENG&orderBy=score"
get build-example     "$SITE/builds/8lKqJLXIJJDPRKwvv2nh"

echo
echo "Terminé. Dossier à envoyer : $OUT"
