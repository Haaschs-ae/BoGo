# BoGo

Overlay de build orders pour **Age of Empires IV**, dans l'esprit de Porofessor ou
OP.GG pour LoL : l'appli détecte ta partie et ta civilisation, te propose tes BO
pour cette civ (boom, agressif, fast castle…) et te guide étape par étape pendant
la partie.

Cible : **macOS, avec AoE4 joué sur GeForce Now** (appli GeForce Now en plein écran).
L'appli est faite avec [Tauri](https://tauri.app) et pourra aussi tourner sous Windows.

Présentation en images : [docs/visuels](docs/visuels) (couverture, choix du BO, matchups, deux
modes, coach contre l'IA, réglages, fair-play).

## Installer et tester

1. Ouvre l'onglet **Actions** du repo, puis la dernière exécution réussie de **Build**.
2. En bas, télécharge l'artefact **BoGo-macos** (un zip qui contient le `.dmg`).
3. Ouvre le `.dmg` et glisse **BoGo** dans **Applications**.
4. L'appli n'est pas signée par un développeur Apple. Au premier lancement, macOS
   la bloque : va dans **Réglages Système → Confidentialité et sécurité** et clique
   sur **Ouvrir quand même**. Si macOS dit que l'appli est endommagée, lance dans
   le Terminal :

   ```bash
   xattr -cr /Applications/BoGo.app
   ```

BoGo n'a pas d'icône dans le Dock : c'est une fenêtre flottante. Pour le fermer, ✕ puis
« Quitter ? » (partout : en partie, dans la bibliothèque, sur la pastille « BO terminé ») ; pour
seulement le masquer, Ctrl+Alt+B (ou ton raccourci). À la fin du BO, BoGo se déverrouille pour que la
pastille réponde aux clics.

### Windows (expérimental)

La même appli existe pour Windows, construite depuis le même code : télécharge **BoGo-windows**
(installateur `.exe`) sur la même page GitHub Actions. Tant que BoGo n'est pas signé, Windows
SmartScreen affiche « Windows a protégé votre ordinateur » : « Informations complémentaires »,
puis « Exécuter quand même ». Pour l'instant, sous Windows :

- **pas de lecture de l'écran** : le BO avance avec les raccourcis (suivi manuel) ;
- raccourcis **Ctrl+Maj** au lieu de Ctrl+Alt (Ctrl+Alt+lettre = AltGr sous Windows en AZERTY ;
  Ctrl+Maj+→ étape suivante, Ctrl+Maj+L verrouiller…),
  modifiables dans ⚙ comme sur Mac ;
- jeu installé (Steam, Xbox) : mets-le en **fenêtré sans bordure**, l'overlay ne peut pas
  s'afficher par-dessus le plein écran exclusif.

## Utilisation

- **Premier lancement** : colle le lien de ton profil `aoe4world.com/players/…` dans les
  réglages (⚙). La clé API AoE4World est facultative : elle sert à détecter aussi les
  parties personnalisées (connecté sur aoe4world.com, ouvre
  `aoe4world.com/account/profile_token` et copie la valeur de `api_key`).
- **Détection de la partie** : toutes les 10 secondes, BoGo demande à AoE4World ta
  dernière partie. Quand une nouvelle partie commence, le point vert s'allume dans
  l'en-tête et BoGo ouvre le **choix du BO** (ou, s'il n'a rien à proposer, la liste des BO
  de ta civ). AoE4World voit la partie quelques secondes après son lancement.
- **Mes matchups** (🎯 sur la page d'une civ) : 📌 un BO de base par civ, présélectionné sans
  question de matchup, et des règles « contre telle civ, sur telle carte → ce BO ». Au début de
  la partie, la règle la plus précise gagne : civ adverse et carte, puis carte (une carte d'eau
  impose son BO), puis civ adverse, puis 📌. « Contre » ne joue qu'en 1v1 classé ou rapide.
  Détails : [docs/profil-et-modes.md](docs/profil-et-modes.md).
- **Choix du BO au début de la partie** : BoGo propose un BO (tes matchups d'abord, sinon un BO
  de ta bibliothèque) et dit pourquoi, avec un fait (« Gardé à 3 de tes 4 dernières parties avec English », « Gardé la
  dernière fois contre French » en 1v1, « Le plus récent de ta bibliothèque »). ▶ Lancer
  (Ctrl+Alt+↵), ou une touche par catégorie : Ctrl+Alt+1 Boom, Ctrl+Alt+2 Agressif, Ctrl+Alt+3 Fast Castle, Ctrl+Alt+4 Autre,
  actives jusqu'au premier passage d'âge pour changer d'avis. En **1v1 classé ou rapide**, un
  BO que tu as déjà joué, ou réglé dans tes matchups, se lance tout seul après **8 s** (Ctrl+Alt+⌫
  annule) ; jamais en équipe ni en personnalisée, jamais un autre BO jamais joué, ni après 2:00 de jeu, ni BoGo masqué ou réduit,
  ni si ta répartition à l'écran ne correspond pas au BO, ni après 2 annulations de suite avec
  cette civ. Un BO lancé depuis la bibliothèque **avant** la partie est gardé tel quel.
  Empire Wars et Nomade : pas de conseil.
- **Bibliothèque** : une grille avec le drapeau de chaque civ et le nombre de BO
  enregistrés. Clique sur une civ pour voir ses BO, rangés par style (Boom, Agressif,
  Fast Castle, Autre), puis ▶ sur le BO voulu.
- **Trouver des BO** : 🌐 **Parcourir aoe4guides** ouvre le site dans une fenêtre de
  BoGo. Sur la page d'un build, un panneau « Importer dans BoGo » apparaît en bas à
  droite : choisis le style, le BO est ajouté à la bibliothèque.
- **Importer un lien** : tu peux aussi coller un lien `aoe4guides.com/builds/…`, ou le
  JSON de l'export « Overlay Tool » d'aoe4guides (menu ⋮ du build).
- **Deux modes**, toujours affichés en haut (VS / IA) :
  - **VS**, par défaut, contre des joueurs (classée, rapide, personnalisée) : ton BO, qui tourne
    ses pages tout seul, et tes comptes en direct face aux cibles (ce que le jeu affiche déjà) ;
    prochain villageois tel qu'écrit ; ni alertes, ni « envoie-les au bois », ni « clique ! ».
  - **IA**, entraînement contre l'IA : clique VS → IA dans l'en-tête avant la partie. BoGo te
    coache dès 0:00 (tout ce qui suit). Le choix vaut pour une partie ; si AoE4World voit une
    classée, une partie rapide ou un joueur en face, retour en VS aussitôt.
- **Pendant la partie en IA**, du plus important au détail : une alerte s'il y en a une
  (« 3 villageois de trop à la nourriture → envoies-en 2 au bois », villageois inactifs),
  la grande icône du **prochain villageois** produit, sans chiffre (« BOIS » ; « BOIS · il
  construit un camp de bûcherons » s'il commence l'étape suivante ; « CONSTRUCTION » pour un
  bâtisseur prévu), les barres **réel / cible** par ressource (les seuls chiffres, avec ceux
  des consignes), les consignes
  **traduites en français** (BO en anglais seulement, désactivable dans ⚙) avec les icônes
  du jeu en grand, et le nom écrit à côté des icônes peu connues (baies, moulin…). Une
  étape à la fois : l'étape suivante (« Ensuite ») ne s'affiche que si tu l'actives dans ⚙.
  La fenêtre prend la hauteur de son contenu.
- **Adversaires** : en 1v1, BoGo montre la civ adverse. À plusieurs, il n'affiche rien sur
  les adversaires.
- **Taille** : un curseur dans ⚙ règle la taille de BoGo de 70 à 130 %, en direct.
- **En partie, les clics passent au jeu** : BoGo se verrouille au lancement d'un BO (cadenas
  « 🔒 Ctrl+Alt+L » en haut à droite) et se déverrouille pour choisir un BO ou ouvrir les réglages.
- **État de la lecture**, toujours visible en haut à droite : ● horloge verte = lecture OK ;
  ■ « Lecture coupée » = plus rien n'est lu (les chiffres disparaissent, bandeau « avance avec
  Ctrl+Alt+→ ») ; ◆ « Lecture arrêtée » = voir ⚙. BoGo n'affiche jamais de chiffres périmés.
- **Fin du BO** : sur l'objectif de la dernière étape (passage d'âge ou TC payé, landmark en
  construction, ou villageois et répartition tenus 10 s), jamais sur le seul nombre de villageois.
  Une nouvelle partie rouvre toujours le choix du BO.
- **Enregistrer mes parties** (⚙, désactivé par défaut) : un fichier local par BO lancé, avec les
  lectures de l'écran, pour rejouer une partie et régler BoGo sans repasser par GeForce Now.
  Rien n'est envoyé ; la liste des applis n'y figure pas.
- **Mode réduit** : quand le BO est terminé, BoGo se réduit à une pastille (« ✓ BO
  terminé », horloge, inactifs). Ctrl+Alt+M ou ▾ / ▴ pour réduire ou agrandir à tout moment.
- **Suivi automatique** : BoGo lit l'écran de GeForce Now une fois par seconde (macOS 14
  ou plus) : l'horloge, et le panneau en bas à gauche (population, villageois inactifs,
  stocks, villageois par ressource).
  - Le BO avance dès qu'un villageois de plus que la cible de l'étape apparaît et que la
    répartition de l'étape est faite (à un villageois près, plus les bâtisseurs prévus) :
    avec 6 vils aux moutons, le 7e fait passer à l'étape qui dit où envoyer les suivants.
    L'alerte, le passage d'étape et le prochain villageois suivent la même règle de
    répartition (`src/distribution.ts`). Une partie n'est pas lisse (attaque, villageois en
    plus) : BoGo avance prudemment, une étape à la fois, après 5 s au moins sur chacune.
    Si la répartition n'est pas suivie, il reste sur l'étape, dit quoi corriger, et à
    partir de 3 villageois en plus propose Ctrl+Alt+→ au lieu de sauter l'étape tout seul.
    Une étape sans cible de villageois (-1, simple construction) garde celle d'avant.
  - Sur une étape « passe l'âge » ou « construis un TC », BoGo attend : un bandeau
    montre les ressources qu'il manque, puis devient vert et clignote quand tu as de
    quoi cliquer. L'étape suivante s'affiche quand les ressources sont dépensées d'un
    coup (clic sur le monument, TC posé : bois **et** pierre), ou quand le haut de l'écran
    montre un landmark en construction, jamais sur le seul nombre de villageois. Les coûts viennent des données d'AoE4World
    pour chaque civ (`src/data/costs.json`, régénéré par `scripts/extract_costs.py`) :
    landmarks ou technologies de passage d'âge (ailes abbassides et ayyoubides,
    commanderies templières…), TC à 750 bois pour les Mongols et Golden Horde, etc.
    Un TC rendu moins cher par une technologie est aussi reconnu.
  - Chaque ressource affiche villageois en jeu / visés. Un villageois de trop sur une
    ressource pendant plus de 3 secondes (au-delà des bâtisseurs prévus) déclenche une alerte (« 1 vil de trop sur 🍖
    → envoie-le sur 🪙 »), tout comme les villageois inactifs.
  - Un changement d'étape au clavier est respecté jusqu'au prochain nouveau villageois.
  - Sans lecture du panneau, BoGo se rabat sur l'horloge (si chaque étape a un temps),
    sinon sur le clavier.
  - Au premier lancement, macOS demande d'autoriser BoGo dans **Réglages Système →
    Confidentialité et sécurité → Enregistrement de l'écran**, puis de relancer BoGo.
    Les réglages (⚙) montrent ce que BoGo lit à l'écran, et permettent de couper la
    lecture.
  - Le panneau du jeu ne montre pas les villageois qui construisent ou marchent, et un
    inactif y reste compté sur sa dernière ressource. BoGo estime donc les villageois :
    il ne redescend jamais (un bâtisseur reste un villageois) et compte chaque hausse de
    population comme un nouveau villageois, sauf sur les étapes qui produisent de l'armée
    (icône d'unité dans les consignes), où il attend de voir le villageois au travail.

| Raccourci | Action |
|-----------|--------|
| Ctrl+Alt+→ / Ctrl+Alt+← | Étape suivante / précédente |
| Ctrl+Alt+L | Verrouiller : les clics traversent l'overlay et vont au jeu |
| Ctrl+Alt+M | Réduire / agrandir (pastille) |
| Ctrl+Alt+B | Afficher / masquer l'overlay |

Ce sont les raccourcis par défaut (Ctrl+Maj sous Windows). **Tous se changent dans ⚙ ›
Raccourcis** : « Changer », puis taper la combinaison voulue (avec ⌘, ⌃ ou ⌥, ou une touche F
seule ; Échap pour annuler) ; « Défaut » pour revenir. BoGo refuse ce qui gênerait la frappe
(une lettre seule), ce qui appartient au système (⌘Q, ⌘Tab…) et les doublons ; si une autre appli
a déjà pris la combinaison, il garde l'ancienne. Sans raccourci « Verrouiller » en place, BoGo ne
se verrouille pas : il resterait hors de portée.

## Fonctionnement prévu

1. **Détection de la partie et de la civ** : interrogation régulière de l'API
   AoE4World, `GET /api/v0/players/{profile_id}/games/last`, qui renvoie la partie en
   cours, son type et les civs de chaque joueur. Avec une clé API AoE4World et
   `include_custom=true`, les parties personnalisées remontent aussi. C'est ce que
   fait [l'overlay d'AoE4World](https://github.com/aoe4world/overlay). Ça marche avec
   GeForce Now, puisque c'est lié au compte et pas au PC.
2. **Choix du BO** : la bibliothèque de BO est rangée par civ et par style. Chaque BO
   est importé depuis [aoe4guides.com](https://aoe4guides.com), via son export
   « Overlay Tool » (format JSON de RTS_Overlay).
3. **Suivi en partie** : capture de la fenêtre GeForce Now et lecture de l'interface
   du jeu (horloge, ressources, villageois par ressource) avec l'OCR intégré à macOS,
   pour avancer automatiquement dans le BO. Il faudra autoriser BoGo dans
   **Enregistrement de l'écran** (Réglages Système). Raccourcis clavier pour avancer
   ou reculer à la main.

### Pourquoi lire l'interface plutôt qu'un chrono

Un chrono lancé au clic prend du retard si le joueur ne lance pas ses premiers
villageois à 0:00. BoGo se cale plutôt sur :

- **l'horloge du jeu** lue à l'écran, pour les étapes basées sur le temps ;
- **le nombre de villageois par ressource**, pour les étapes du type « 6 sur les
  moutons, puis 3 sur le bois ». L'étape suivante s'affiche quand la cible est
  atteinte, et l'appli peut signaler un écart avec le BO.

Le calibrage des zones à lire est dans [docs/hud-calibration.md](docs/hud-calibration.md).

## Feuille de route

- **Étape 1** (fait) : overlay flottant par-dessus GeForce Now en plein écran,
  bibliothèque de BO importés depuis aoe4guides, rangés par civ et par style,
  étapes au clavier.
- **Étape 2** : détection de la partie et des civs via AoE4World, proposition des
  BO pour ta civ, BO calé sur l'horloge du jeu lue à l'écran (fait, à valider en jeu).
- **Étape 3** (fait, à valider en jeu) : avancement automatique selon les villageois,
  attente des passages d'âge et des TC, alertes de répartition et d'inactifs.
- **Étape 4** (fait, à valider en jeu) : choix du BO au début de la partie, d'après ta
  bibliothèque et ton journal local, avec lancement automatique encadré. Les BO de la
  communauté aoe4guides viendront ensuite (il faut d'abord sonder leur API depuis le Mac).
- **Ensuite** : version autonome, qui démarre avec le Mac et s'ouvre seule quand
  une partie commence.

## Développement

```bash
npm install
npm test                  # tests de la logique (format des BO, AoE4World, horloge)
scripts/build-vision.sh   # compile bogo-vision, la lecture de l'écran (macOS, Xcode requis)
npm run tauri dev         # lance l'appli en local (Rust + Node requis)
```

La compilation de l'appli Mac est faite par GitHub Actions (`.github/workflows/build.yml`).

Rejouer une partie enregistrée (réglage « Enregistrer mes parties », fichiers dans le dossier
de données de BoGo, sous-dossier `parties`) : les lectures repassent dans le moteur, qui raconte
ses changements d'étape, ses alertes et la fin du BO.

```bash
REPLAY=/chemin/vers/partie-1730190000.jsonl npx vitest run src/replay.test.ts --silent=false
```

## Projets dont on s'inspire

- [aoe4world/overlay](https://github.com/aoe4world/overlay) : détection de la partie via l'API AoE4World.
- [aoe4world/data](https://github.com/aoe4world/data) : coûts des TC et des passages d'âge.
- [FluffyMaguro/AoE4_Overlay](https://github.com/FluffyMaguro/AoE4_Overlay) : overlay de partie et de BO.
- [CraftySalamander/RTS_Overlay](https://github.com/CraftySalamander/RTS_Overlay) : format de BO, raccourcis globaux, mode chrono.
- [aoe4guides.com](https://aoe4guides.com) : les build orders, écrits par leurs auteurs.

## Contenus tiers

- **Code de BoGo** : licence MIT (fichier LICENSE), © 2026 Haaschs.
- **Visuels et données d'Age of Empires IV** (drapeaux des civilisations dans `src/assets/flags`,
  icônes du jeu chargées depuis le site de RTS Overlay, captures du HUD dans `docs/assets`,
  coûts dans `src/data/costs.json` dérivés d'aoe4world/data) : © Microsoft Corporation. Ils ne
  sont **pas** couverts par la licence du code et ne sont utilisables que selon les
  [Game Content Usage Rules](https://www.xbox.com/en-US/developers/rules) de Microsoft. Les dépôts
  aoe4world/overlay et aoe4world/data sont publiés sous licence MIT, mais cette licence ne porte
  que sur leur code, pas sur les éléments du jeu.
- **Build orders** : ils restent la propriété de leurs auteurs. BoGo garde pour chaque BO l'auteur
  et le lien d'origine, ne contient aucun BO dans son dépôt, et la traduction en français n'est
  qu'une aide de lecture locale. Données aoe4guides.com : merci à son auteur et aux créateurs de BO.

## Fair-play : ce que BoGo fait, et ne fera jamais

Aucune règle publique de Microsoft, World's Edge ou Relic n'autorise ni n'interdit à ce jour un
assistant qui lit l'écran. Des outils comparables existent depuis des années sans sanction connue.
BoGo n'a demandé ni reçu **aucune approbation**. Il reste défendable tant qu'il respecte ces limites,
qui sont des règles du projet :

- BoGo **lit uniquement les pixels de ta propre fenêtre** (GeForce Now) avec les API publiques du
  système, et fait la reconnaissance de texte sur ta machine. Rien n'est envoyé ; rien n'est
  enregistré, sauf si tu actives « Enregistrer mes parties » (fichier local).
- BoGo **n'envoie jamais de touche ni de clic** au jeu, **ne lit ni n'écrit la mémoire du jeu**,
  **n'injecte aucun code**, ne touche pas au trafic réseau ni aux fichiers du jeu.
- BoGo **n'affiche que ce que tu vois déjà** ou ce qui est public avant la partie : jamais d'information
  que le jeu te cache (brouillard de guerre, ressources adverses).
- BoGo ne garde ni n'affiche les pseudos des autres joueurs.
- En tournoi ou en cup : BoGo fermé, sauf accord écrit de l'organisateur. En stream : dis ce que
  fait BoGo, ou sors-le de la capture.
- Teste les nouvelles versions contre l'IA ou en partie personnalisée, jamais en classé ; ne quitte
  jamais une partie classée à cause d'un bug.

### Deux modes : VS (contre des joueurs) et IA (entraînement contre l'IA)

Contre l'IA, BoGo te coache. Contre un joueur, BoGo montre ton plan préparé avant la partie et tes
comptes en direct (ce que le jeu affiche déjà), mais ne te dit jamais quoi faire en cours de partie.

| | VS | IA |
|---|---|---|
| BO écrit, pages qui tournent toutes seules | oui | oui |
| Écran de choix, matchups, civ adverse en 1v1 | oui | oui |
| Prochain villageois | tel qu'écrit dans l'étape | calculé sur ta partie |
| Comptes réel / cible, stock du passage d'âge | oui | oui |
| « C'est le moment : clique ! », « envoie-les au bois » | non | oui |
| Alertes de répartition et d'inactifs | non | oui |

BoGo passe en VS dès qu'il ne sait pas contre qui tu joues : AoE4World prouve la présence de
joueurs, jamais celle de l'IA. En personnalisée contre un joueur, BoGo ne peut le voir qu'avec la
clé API : sans elle, c'est à toi de laisser VS. Ce découpage est une précaution que BoGo
s'impose ; il n'a été ni demandé ni validé par l'éditeur et ne garantit rien. Si l'éditeur
publie une règle, elle s'applique et BoGo s'y alignera.

## Données et confidentialité

- BoGo contacte trois sites : aoe4world.com (ta partie en cours, avec ton identifiant de profil et,
  si tu l'as saisie, ta clé API), aoe4guides.com (les BO que tu importes) et rts-overlay.github.io
  (les icônes du jeu, hébergées sur GitHub, qui journalise les adresses IP). Aucun serveur BoGo,
  aucune télémétrie.
- Ta clé API et ta bibliothèque sont stockées sur ta machine seulement. Ne partage jamais de capture
  des réglages ⚙ sans masquer la clé.
- Le **journal des parties** (civ, mode, carte, BO lancés et gardés ; ni nom ni identifiant
  d'adversaire) reste sur ta machine, dans `~/Library/Application Support/com.haaschs.bogo/journal.json` :
  il ne sert qu'à choisir le BO du début de partie.
- Supprimer les données de BoGo : supprimer l'appli et les dossiers `~/Library/WebKit/com.haaschs.bogo`
  et `~/Library/Application Support/com.haaschs.bogo`.

## Mentions légales

Age of Empires IV © Microsoft Corporation. BoGo was created under Microsoft's
["Game Content Usage Rules"](https://www.xbox.com/en-US/developers/rules) using assets from
Age of Empires IV, and it is not endorsed by or affiliated with Microsoft.

BoGo a été créé dans le cadre des « Game Content Usage Rules » de Microsoft avec des éléments
d'Age of Empires IV ; il n'est ni approuvé par Microsoft ni affilié à Microsoft.

Age of Empires est une marque de Microsoft ; GeForce NOW et NVIDIA sont des marques de NVIDIA.
BoGo n'est affilié ni à Microsoft, ni à NVIDIA, ni à AoE4World, ni à aoe4guides, ni à RTS Overlay.
BoGo est et restera gratuit, sans publicité.

BoGo est un outil expérimental, fourni tel quel, sans garantie : tu l'utilises sous ta propre
responsabilité. Seul le dépôt github.com/Haaschs-ae/BoGo est officiel.
