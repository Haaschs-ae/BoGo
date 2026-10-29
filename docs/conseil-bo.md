# Conseil de BO au début de la partie (écran C)

Conception issue d'une analyse à plusieurs angles (données disponibles, qualité des BO,
joueur d'abord, contexte de la partie), puis de deux critiques (faisabilité des données,
expérience d'un joueur classé). Ce document fixe ce qui est décidé pour la v1 et ce qui
reste à vérifier. Le lancement automatique après 8 s est conservé (décision du joueur).

## Sur quoi BoGo se base, dans l'ordre

1. **Filtres durs** : la civ jouée (AoE4World, connue même en aléatoire), le mode
   (`rm_1v1`, `qm_1v1`, équipe, personnalisée ; Empire Wars et Nomad : aucun conseil),
   les brouillons et les BO trop incomplets (moins de 5 étapes, ou villageois / répartition
   sur moins de la moitié des étapes) sont écartés. Les BO qui citent une unité ou une
   technologie retirée par un patch (`aoe4world/data`, `patch-history.json`) ne sont jamais
   lancés automatiquement et portent un avertissement.
2. **Ton choix d'avant la partie** : un BO lancé depuis la bibliothèque après la fin de la
   partie précédente (ou après le démarrage de BoGo) et pas encore rattaché à une partie est
   ton choix. Pas de compte à rebours ; une ligne « BO choisi avant la partie : X ».
3. **Ta mémoire contre cette civ (1v1 seulement)** : le BO gardé la dernière fois contre
   cette civ (90 jours), s'il diffère de ton habitude, est proposé et dit tel quel
   (« contre les Mongols la dernière fois : X »). À plusieurs, les adversaires ne sont ni
   affichés ni utilisés.
4. **Ton habitude avec cette civ** : un BO gardé à 2 parties au moins, dont un choix actif,
   parmi tes 5 dernières parties avec la civ. Un seul essai ne fait pas une habitude.
5. **Ta bibliothèque ★** : un BO de la civ (de cette saison ou de la précédente, ou lancé
   depuis moins de 90 jours), le plus gardé puis le plus récent.
6. **La communauté aoe4guides** : dans la catégorie retenue, le meilleur BO de la saison en
   cours, sinon de la précédente. Saison en cours : en tête de la liste « tendance »
   (`orderBy=score`) ; saison précédente : le plus mis en favoris. Le choix est collant :
   il ne change que si un autre BO le dépasse nettement ou n'est plus éligible.
7. **Le contexte** : seulement les cartes d'eau (BO avec ports), sinon avertissement et pas
   de compte à rebours. Le niveau de l'adversaire et les statistiques globales ne choisissent
   jamais le BO : elles n'ont pas de dimension « catégorie de BO ».

La **catégorie** (Boom, Fast Castle, Timing Attack, Rush, Cheese…) vient du champ
`strategy` d'aoe4guides, jamais codée en dur. Elle est choisie par ce que tu gardes
réellement avec la civ (2 choix actifs de suite dans une catégorie la changent), puis, sans
historique, par le meilleur BO de la civ cette saison. Cheese n'est jamais choisi tout seul.

Les **résultats** (victoires, défaites) sont notés et affichés dès 3 parties, mais ne
changent pas le conseil avant une vingtaine de parties : avec quelques parties par civ,
c'est surtout le hasard du matchmaking.

## Ce qui compte comme « suivi »

Le BO gardé est celui actif à 4:00 de jeu (ou au premier passage d'âge). Un lancement
automatique ne compte que si le panneau montre qu'il a été suivi (au moins 3 étapes passées
par le moteur, sans alerte de répartition la plupart du temps). Sinon, poids 0 : le conseil
automatique ne peut pas se renforcer tout seul. Un choix actif (bouton, raccourci,
bibliothèque) pèse 1. Un changement après 1:30 (réaction à un scout) ne nourrit que la
mémoire contre cette civ adverse, pas l'habitude de la civ. Les parties personnalisées ne
nourrissent pas les règles des parties classées.

## Le compte à rebours de 8 s

Il démarre seulement si tout est vrai : partie classée ou rapide en 1v1 ; horloge ≤ 2:00
(ou ≤ 3:00 depuis le début selon AoE4World) ; BO crédible (habitude, ★, ou BO de la saison
en cours ou précédente avec assez de favoris ou de vues) ; JSON du BO déjà en local ; pas
de patch récent sans ★/habitude ; répartition déjà à l'écran compatible avec le BO (règle
de `src/distribution.ts`, à 3 villageois près) ; pas refusé les 2 dernières fois avec cette
civ ; BoGo ni caché ni réduit par choix (réduit après un BO terminé : la carte s'ouvre).
Sinon le bouton reste, avec la raison écrite : « Lancement auto désactivé : partie en
équipe » etc. Rien ne remplace le BO sous le compte à rebours.

Raccourcis **fixes par catégorie**, valables pour toutes les civs : ⌘⌥1 Boom, ⌘⌥2 Fast
Castle, ⌘⌥3 Timing, ⌘⌥4 Rush ; ⌘⌥↵ lance ; ⌘⌥⌫ annule. Pas d'Échap (il va au jeu), pas de
pause au survol (la souris est bloquée en mode verrouillé). Les raccourcis restent actifs
après le lancement jusqu'au premier passage d'âge, pour corriger sans la souris. Le panneau
ne doit pas prendre le clavier au jeu (`becomes_key_only_if_needed`).

## « Choisi car : … »

Des faits vérifiables, pas des classements : « 12 favoris, 2 300 vues, Saison 13 »,
« gardé à 3 de tes 4 dernières parties en Anglais », « contre les Mongols la dernière
fois ». « Habituel » seulement à partir de 3 parties gardées. Les résultats dans une puce à
part (« Avec ce BO : 1 V – 3 D »), jamais dans la raison. Aucun mot de classement quand la
liste compte moins de 5 BO. Préfixe « civ aléatoire » quand la civ a été tirée au sort.

## Journal local (jamais envoyé)

Une entrée par partie AoE4World (`game_id`), écrite dès la détection (règle le problème
du `handledGameId` perdu au redémarrage ou à l'enregistrement des réglages) : mode, carte,
civ, civ aléatoire, civ adverse en 1v1, offre (BO, règle, raison, compte à rebours ou motif
d'arrêt), lancements (quoi, comment, horloge), BO gardé, abandons, exécution (étapes,
passages d'âge, alertes), résultat. Stockée dans un fichier app-data Tauri (pas
localStorage : quota et absence de `try/catch`). Jamais la clé API, jamais le nom ni
l'identifiant d'un adversaire.

## Données aoe4guides : ce qui est connu et ce qui bloque

- API publique, lecture seule, sans clé : `GET /api/builds?civ=ENG&orderBy=score|likes|timeCreated|views`,
  **10 BO par liste au plus, sans pagination, sans filtre de catégorie ni de saison**
  (documentation Swagger `aoe4guides.com/api/api-docs/`). Limites : 30 listes/min,
  300/h ; 120 BO/min. Règles d'usage : mettre en cache, ne pas parcourir toute la
  bibliothèque, attribuer les données (« Données aoe4guides.com » avec lien).
- Conséquence : avec 3 listes par civ (~30 BO), « le meilleur de chaque catégorie pour la
  saison en cours » sera souvent vide ou réduit à un seul BO. Il faut d'abord **sonder
  l'API depuis le Mac** (`scripts/probe-aoe4guides.sh`) : valeurs exactes de `strategy`,
  format de `season`, présence des étapes dans les listes, filtres non documentés
  (`strategy=`, `season=`, `limit=`), hôte des listes (le site répondrait `not_proxied`
  pour les listes ; hôte Cloud Run indiqué dans le Swagger). Ensuite, contacter le
  développeur (page « about ») pour des filtres catégorie/saison.
- Codes de civ : `ABB AYY BYZ CHI DEL ENG FRE HRE HOL JAP JDA KTE MAC MAL MON DRA OTT RUS SEN TUG ZXL`,
  Golden Horde `GOH` (site) ou `GOL` (clients), Jin `JIN` à confirmer, Scots et Vikings sans
  code (bibliothèque seulement).
- Cache : 3 listes par civ, civs les plus jouées d'abord, 1 appel toutes les 3 s, TTL 24 h
  (72 h pour les autres civs), jamais une réponse vide ou invalide par-dessus un cache
  valide, échec gardé 1 h au plus ; JSON `overlay=true` du BO retenu par catégorie. Un BO
  lancé depuis le cache n'entre pas dans la bibliothèque (★ = choix explicite).
- Saison en cours : maximum entre le profil AoE4World, la dernière partie classée du
  joueur, la dernière partie classée globale (`/api/v0/games?leaderboard=rm_1v1`) et un
  calendrier embarqué ; saison effective d'un BO = max(étiquette, saison de sa création).

## À faire : v1, puis v2

**Fait (29/10, v1 sur la bibliothèque)** : journal (`src/journal.ts`, fichier app-data),
règles 2 à 5 en fonctions pures testées (`src/advice.ts`), carte de choix, compte à rebours
de 8 s et ses garde-fous (1v1 classé ou rapide, horloge, BO déjà joué, 2 refus, BoGo masqué
ou réduit, répartition à l'écran), raccourcis de catégorie et lancer / annuler. Catégories :
celles de la bibliothèque (Boom, Agressif, Fast Castle, Autre). Reste de la v1 : cache et
règle aoe4guides (6), cartes d'eau (7), patch récent, plan « Âge II 4:20 · 2e TC 6:10 ».

v1 : journal ; cache aoe4guides avec sonde préalable ; règles 1 à 7 en fonctions pures
testées, constantes dans un seul fichier ; carte C compacte (titre, catégorie, plan « Âge II
4:20 · 2e TC 6:10 », une raison, raccourcis par catégorie) ; compte à rebours avec ses
garde-fous ; requêtes AoE4World sans chevauchement et avec délai maximal (client `reqwest`
partagé, 8 s) ; carte précalculée par civ pour un affichage immédiat ; sondage à 5 s quand
l'horloge du jeu est lue sans partie connue.

v2 : résultats dans le choix (après ~20 parties) ; règle « plus tranquille » si tes passages
d'âge sont en retard de plus de 60 s sur le plan ; favoris aoe4guides du joueur ; ligne
d'information sur l'adversaire (1v1) ; épingler/bannir un BO, pouce après la partie.
