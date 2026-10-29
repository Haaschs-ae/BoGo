# BoGo

Overlay de build orders pour **Age of Empires IV**, dans l'esprit de Porofessor ou
OP.GG pour LoL : l'appli détecte ta partie et ta civilisation, te propose tes BO
pour cette civ (boom, agressif, fast castle…) et te guide étape par étape pendant
la partie.

## Fonctionnement prévu

1. **Démarrage autonome** : l'appli démarre avec Windows et attend en tâche de fond.
   Elle repère le lancement du jeu (processus `RelicCardinal.exe`, à confirmer).
2. **Détection de la partie et de la civ** : interrogation régulière de l'API
   AoE4World, `GET /api/v0/players/{profile_id}/games/last`, qui renvoie la partie en
   cours, son type et les civs de chaque joueur. Avec une clé API AoE4World et
   `include_custom=true`, les parties personnalisées remontent aussi. C'est ce que
   fait [l'overlay d'AoE4World](https://github.com/aoe4world/overlay).
3. **Choix du BO** : la bibliothèque de BO est rangée par civ et par style. Chaque BO
   est importé depuis [aoe4guides.com](https://aoe4guides.com), via son export
   « Overlay Tool » (format JSON de RTS_Overlay).
4. **Suivi en partie** : lecture de l'interface du jeu par capture d'écran
   (horloge, ressources, villageois par ressource) pour avancer automatiquement
   dans le BO. Aucune lecture de la mémoire du jeu, donc pas de risque anti-triche.
   Raccourcis clavier globaux pour avancer ou reculer à la main.

Le jeu doit être en **fenêtré sans bordure** : aucune fenêtre ne peut s'afficher
par-dessus un jeu en plein écran exclusif.

### Pourquoi lire l'interface plutôt qu'un chrono

Un chrono lancé au clic prend du retard si le joueur ne lance pas ses premiers
villageois à 0:00. BoGo se cale plutôt sur :

- **l'horloge du jeu** lue à l'écran, pour les étapes basées sur le temps ;
- **le nombre de villageois par ressource**, pour les étapes du type « 6 sur les
  moutons, puis 3 sur le bois ». L'étape suivante s'affiche quand la cible est
  atteinte, et l'appli peut signaler un écart avec le BO.

Le calibrage des zones à lire est dans [docs/hud-calibration.md](docs/hud-calibration.md).

## Feuille de route

- **V1** : overlay transparent toujours au premier plan, import d'un BO depuis
  aoe4guides, étapes à la main ou au chrono, choix de la civ et du style.
- **V2** : détection automatique de la partie et des civs via AoE4World,
  proposition des BO correspondants.
- **V3** : lecture de l'interface (horloge, villageois, ressources) et avancement
  automatique du BO, raccourcis clavier en secours.

## Projets dont on s'inspire

- [aoe4world/overlay](https://github.com/aoe4world/overlay) : détection de la partie via l'API AoE4World.
- [FluffyMaguro/AoE4_Overlay](https://github.com/FluffyMaguro/AoE4_Overlay) : overlay de partie et de BO.
- [CraftySalamander/RTS_Overlay](https://github.com/CraftySalamander/RTS_Overlay) : format de BO, raccourcis globaux, mode chrono.
