# Mes matchups et les deux modes (VS / IA)

Demande du joueur (29/10/2026) : en 1v1, choisir un BO par matchup (« je joue X, contre Y, sur
la carte Z → ce BO »), avec un BO de base par civ sans question de matchup ; et deux versions de
l'outil, une aide très guidée contre l'IA, une version sobre contre de vrais joueurs (classée,
rapide ou personnalisée), pour que BoGo ne puisse pas passer pour un outil de triche.

Conception issue de trois recherches (AoE4World et l'IA, fair-play, inventaire du code) et de
trois propositions confrontées (joueur, fair-play, implémentation).

## Les deux modes

> Contre l'IA, BoGo te coache. Contre un joueur, BoGo n'est qu'un BO papier qui tourne ses pages
> tout seul. Test pour toute nouvelle fonction : une feuille de BO imprimée pourrait-elle le dire ?
> Sinon, c'est pour l'entraînement contre l'IA.

Repères : la politique de Riot (TFT) admet une recommandation statique préparée avant la partie,
même affichée toute la partie, mais pas une recommandation qui s'ajuste en direct à tes actions ;
les outils OCR de BO tolérés pour AoE (AoE4BO, RTS Helper) tournent les pages, aucun ne calcule
de déplacement de villageois. Aucune règle publique de Microsoft, World's Edge ou Relic n'existe
sur ces outils : ce découpage est une précaution que BoGo s'impose, ni demandée ni validée par
l'éditeur.

### Comment BoGo décide (`src/mode.ts`, `decideMode`)

AoE4World ne liste jamais les IA (elles sont absentes des équipes, sans marque) : il prouve la
présence d'humains, jamais celle de l'IA. La première règle qui s'applique gagne :

1. Un joueur a été vu en face dans la partie en cours → **VS** jusqu'à la fin de la partie.
2. AoE4World montre une partie contre des humains en cours (classée ou rapide, tous suffixes ;
   personnalisée avec un adversaire listé ; type inconnu) → **VS**.
3. « IA » n'est pas choisi → **VS** (défaut).
4. Pas de profil AoE4World → **VS** : rien ne pourrait détecter une classée.
5. L'horloge de la partie n'est pas lue (menus, partie d'avant) → **VS**, badge « IA… ».
6. Sinon → **IA**, dès 0:00 : contre l'IA, la première minute (moutons, premier bois) compte
   (choix du joueur, 29/10). Si AoE4World voit ensuite une classée, une rapide ou un joueur
   listé en face, règle 1 ou 2 : retour en VS aussitôt, avec un bandeau.

Le choix « IA » se fait avec la bascule VS / IA de l'en-tête, hors jeu. Il n'est jamais
enregistré d'un lancement de BoGo à l'autre. Il vaut pour la partie en cours ou la prochaine, et
tombe : à la fin de la partie où il a servi (deux minutes sans horloge lue) ou au début de la
suivante (l'horloge repart en arrière), dès qu'un joueur est vu en face dans la partie en cours,
après 15 min sans partie, au redémarrage, ou d'un clic.

En jeu : un badge non cliquable « VS », « IA… » ou « IA ». Bandeaux de quelques secondes :
« Joueur détecté en face : BoGo passe en VS jusqu'à la fin de la partie. » et « Nouvelle
partie : retour en VS. ». Une carte « Nouveau : deux modes » l'explique une fois après la mise à
jour.

### Ce que chaque mode montre

| En partie | VS (contre des joueurs) | IA (entraînement) |
|-----------|-------------------------|-------------------|
| Consignes traduites, icônes, noms des icônes peu connues | oui | oui |
| Étape x/y, âge, horloge du jeu | oui | oui |
| Pages qui tournent toutes seules | nombre de villageois écrit, âge ou TC payé, landmark, horloge | pareil, en attendant la répartition de l'étape |
| Prochain villageois | ce que l'étape ajoute, tel qu'écrit | calculé sur ta répartition, avec « il construit un … » |
| Villageois et ressources | cibles écrites (« 12 visés ») | réel / cible, ✓, +N |
| Passage d'âge, nouveau TC | coût écrit, « Garde les ressources pour ça » | en plus : stock lu, « C'est le moment : clique ! » |
| Alertes de répartition et d'inactifs | non | oui |
| « +N villageois sans suivre cette étape » | non | oui |
| Écran de choix, matchups, lancement auto en 8 s | oui | oui |
| ⚙ « Lu à l'écran », changements d'étape | sans chiffres | avec chiffres |
| Enregistrement local des parties (option) | oui | oui |

En VS, le moteur lui-même ne calcule aucun conseil (`engine.coaching = false` : ni répartition,
ni dérive, ni « payable »), et la vue ne lit la partie qu'au travers d'une seule fonction testée
(`projectLive`).

### Limites, dites franchement

- Une personnalisée contre un joueur sans clé API AoE4World (ou avec un compte qui ne peut pas
  en avoir) est invisible : si tu choisis IA, BoGo te croit. Laisse VS.
- Si tu choisis IA puis lances une classée par erreur, le coaching s'affiche jusqu'à ce
  qu'AoE4World voie la partie (quelques secondes à une minute, délai noté au journal :
  `seenAtClock`). Ne choisis IA qu'avant une partie contre l'IA.
- La lecture du panneau des villageois sert encore, en VS, à tourner les pages.
- Un contournement volontaire (autre profil, code modifié) ne peut pas être empêché ; le code est
  public et le mode toujours affiché.

## Mes matchups (`src/matchups.ts`)

- **📌 BO de base** par civ : sur la page de la civ (un clic sur 📌), ou dans l'éditeur. Il est
  présélectionné sans question de matchup, dans toutes les parties, en équipe comprise.
- **Règles** « contre telle civ, sur telle carte → ce BO », dans l'éditeur « 🎯 Matchups » de la
  page de la civ. Choisir le BO enregistre la règle ; une phrase dit ce que BoGo choisirait.
- **Ordre de lecture** au début de la partie :
  1. BO lancé depuis la bibliothèque avant la partie, s'il est toujours le BO en cours ;
  2. règle civ adverse + carte ;
  3. règle de carte ;
  4. règle de civ adverse ;
  5. 📌 BO de base de la civ ;
  6. puis ce que BoGo déduit : mémoire contre la civ adverse, habitude, bibliothèque.
- **La carte passe avant la civ adverse** : une carte d'eau ou hybride rend un BO terrestre
  injouable, alors qu'on s'adapte à l'adversaire après l'éclaireur. Si une règle de carte et une
  règle de civ adverse se contredisent, la carte gagne, l'autre BO est proposé sur l'écran de choix
  (avec sa touche de catégorie s'il est d'une autre catégorie, sinon avec ▶), et rien ne part
  tout seul.
- **« Contre »** ne joue qu'en 1v1 classé ou rapide : en personnalisée, AoE4World omet les IA
  (« moi + une IA contre un joueur + une IA » y ressemble à un 1v1). En équipe, chacun pour soi
  ou personnalisée à plusieurs : le BO de base seulement.
- **Cartes** : noms d'AoE4World, comparés sans casse, accents, espaces ni tirets (« High View »
  = « Highview », « & » = « and »), avec les anciens noms (Watering Holes → Waterholes, Mediterranean → Baltic). Suggestions : pools 1v1
  classés d'avril 2025 à juin 2026 et cartes de ton journal ; une carte inconnue est signalée.
- **Lancement auto** : un BO de tes matchups est ton choix explicite ; il peut partir tout seul
  après 8 s même s'il n'a jamais été joué. Les autres garde-fous restent (1v1 classé ou rapide,
  avant 2:00, BoGo visible, pas après 2 annulations, pas de conflit entre deux règles).
- **Stockage** : `bogo.matchups.v1` (localStorage), relu champ par champ (un champ abîmé ne
  fait rien perdre d'autre) ; une même situation réglée deux fois garde la règle la plus récente. Un BO supprimé sort des matchups (second clic
  s'il y est utilisé) ; un BO réimporté depuis le même lien garde son identifiant.
- Clés utilisées : ta civ, la civ adverse (1v1 classé ou rapide) et la carte, toutes publiques à
  l'écran de chargement. Jamais l'identité, le rang ni l'historique d'un adversaire.

## Journal local (`src/journal.ts`)

Un BO lancé tout seul ne compte comme « suivi » que pour les étapes dont la répartition était
faite, jugée même en VS (jamais affichée) : le lancement auto ne se renforce pas tout seul.
En plus : `rule` (d'où vient le BO proposé : avant la partie, matchups, mémoire, habitude,
bibliothèque), `coached` (BoGo a coaché la partie) et `seenAtClock` (horloge lue quand AoE4World a
vu la partie). Toujours local, jamais envoyé, sans pseudo.
