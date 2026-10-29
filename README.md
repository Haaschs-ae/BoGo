# BoGo

Overlay de build orders pour **Age of Empires IV**, dans l'esprit de Porofessor ou
OP.GG pour LoL : l'appli détecte ta partie et ta civilisation, te propose tes BO
pour cette civ (boom, agressif, fast castle…) et te guide étape par étape pendant
la partie.

Cible : **macOS, avec AoE4 joué sur GeForce Now** (appli GeForce Now en plein écran).
L'appli est faite avec [Tauri](https://tauri.app) et pourra aussi tourner sous Windows.

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

BoGo n'a pas d'icône dans le Dock : c'est une fenêtre flottante. Le bouton ✕ la ferme.

## Utilisation

- **Premier lancement** : colle le lien de ton profil `aoe4world.com/players/…` dans les
  réglages (⚙). La clé API AoE4World est facultative : elle sert à détecter aussi les
  parties personnalisées (connecté sur aoe4world.com, ouvre
  `aoe4world.com/account/profile_token` et copie la valeur de `api_key`).
- **Détection de la partie** : toutes les 10 secondes, BoGo demande à AoE4World ta
  dernière partie. Quand une nouvelle partie commence, le point vert s'allume dans
  l'en-tête et la bibliothèque se filtre sur ta civ, avec un bandeau
  « Ta civ contre la civ adverse ». AoE4World voit la partie quelques secondes après
  son lancement.
- **Importer un BO** : colle un lien `aoe4guides.com/builds/…` et choisis son style
  (Boom, Agressif, Fast Castle, Autre). Si le téléchargement échoue, colle à la place
  le JSON de l'export « Overlay Tool » d'aoe4guides (menu ⋮ du build).
- **Choisir** : filtre par civ et par style, puis ▶ sur le BO voulu.
- **Pendant la partie** : l'étape en cours (villageois visés, répartition par
  ressource, âge, temps visé), ses consignes et un aperçu de la suivante.

| Raccourci | Action |
|-----------|--------|
| ⌘ ⌥ → / ⌘ ⌥ ← | Étape suivante / précédente |
| ⌘ ⌥ L | Verrouiller : les clics traversent l'overlay et vont au jeu |
| ⌘ ⌥ B | Afficher / masquer l'overlay |

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
  BO pour ta civ (fait), BO calé sur l'horloge du jeu lue à l'écran (à venir).
- **Étape 3** : avancement automatique selon les villageois par ressource.
- **Ensuite** : version autonome, qui démarre avec le Mac et s'ouvre seule quand
  une partie commence.

## Développement

```bash
npm install
npm test            # tests de la logique (format des BO, bibliothèque)
npm run tauri dev   # lance l'appli en local (Rust + Node requis)
```

La compilation de l'appli Mac est faite par GitHub Actions (`.github/workflows/build.yml`).

## Projets dont on s'inspire

- [aoe4world/overlay](https://github.com/aoe4world/overlay) : détection de la partie via l'API AoE4World.
- [FluffyMaguro/AoE4_Overlay](https://github.com/FluffyMaguro/AoE4_Overlay) : overlay de partie et de BO.
- [CraftySalamander/RTS_Overlay](https://github.com/CraftySalamander/RTS_Overlay) : format de BO, raccourcis globaux, mode chrono.
  Les icônes du jeu affichées dans les consignes sont chargées depuis son site.
