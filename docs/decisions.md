# Journal des décisions

Une ligne par décision, avec sa date et sa raison, pour ne pas la rediscuter sans nouvel élément.

- **2026-10-29 · Licence du code : MIT, © Haaschs.** Aucun code GPL repris (vérifié ligne à
  ligne contre RTS_Overlay et AoE4_Overlay). MIT est simple, compatible avec l'écosystème Tauri
  et avec une signature gratuite (SignPath) plus tard. Les visuels et données du jeu restent
  © Microsoft, hors licence (Game Content Usage Rules).
- **2026-10-29 · Public visé : soi-même et quelques joueurs, par téléchargement GitHub.**
  Pas de store, pas de signature payante pour le moment : installation « Ouvrir quand même »,
  Release GitHub avec sommes SHA-256 quand une version sera validée. À revoir si BoGo est
  diffusé plus largement (Apple Developer 99 $/an, signature Windows).
- **2026-10-29 · Clé API AoE4World : pas régénérée** (choix du propriétaire ; portée limitée à
  la lecture des parties personnalisées). Elle est désormais masquée dans ⚙ et absente des
  messages d'erreur.
- **2026-10-29 · Tests : versions expérimentales contre l'IA ou en partie personnalisée
  seulement ; le classé est réservé aux versions validées ; jamais quitter une partie classée
  pour déboguer.** Prochaine étape : enregistrer 2-3 parties contre l'IA (lignes JSON de
  bogo-vision + enregistrement d'écran) pour régler moteur et interface en rejeu, sans dépenser
  d'heures GFN.
- **2026-10-29 · Support Age of Empires : écrire (ticket privé, description factuelle) une fois
  l'ensemble des fonctions terminé et validé**, pas avant. Jusque-là : deux modes prévus,
  Entraînement (tout) et Classé sobre (étape + point de ralliement, sans alertes correctives).
- **2026-10-29 · Lancement automatique du BO conseillé après 8 s : conservé**, avec ses
  garde-fous (jamais en équipe, jamais un BO jamais joué, jamais si la civ est incertaine, jamais
  si un BO a été choisi avant la partie).
- **2026-10-29 · Adversaires : civ adverse affichée et utilisée en 1v1 seulement.** À plusieurs,
  rien sur les adversaires.
- **2026-10-29 · Une étape à la fois : « Ensuite » caché par défaut ; nom écrit à côté des icônes
  peu connues ; chaque nom une seule fois à l'écran ; les chiffres seulement dans les barres et
  les consignes.**
- **2026-10-29 · Ordre des chantiers : P0 (légal, clé, fair-play, quatre correctifs de jeu) →
  banc de rejeu et fiabilité du moteur → structure (machine à états, deux fenêtres, icône
  système) → écran C → Windows.** Détail dans docs/audit.md.
- **2026-10-29 · Mac et Windows : une seule base de code, deux installateurs.** Un projet commun
  (moteur, interface, données) ; ce qui diffère est isolé : `src/platform.ts` (raccourcis,
  libellés, lecture de l'écran), `tauri.macos.conf.json` / `tauri.windows.conf.json`, le code
  Rust propre à chaque système. Raccourcis Windows : Ctrl+Maj (pas Ctrl+Alt = AltGr en AZERTY),
  à valider avec des testeurs Windows. L'édition Windows est expérimentale (suivi manuel) tant
  que la lecture d'écran Windows n'existe pas.
- **2026-10-29 · Pas de version « libre » (coaching complet en classé).** Envisagée puis écartée
  par le joueur : elle annulerait la protection voulue vis-à-vis de World's Edge. On garde VS / IA.
- **2026-10-29 · Deux modes : VS (contre des joueurs, par défaut) et IA (entraînement contre
  l'IA).** Remplace « Classé sobre / Entraînement en personnalisée » : une personnalisée contre un
  joueur est en VS. VS = BO papier qui tourne ses pages (ni alertes, ni comptes en direct, ni
  « clique ! », prochain villageois tel qu'écrit, pages au nombre de villageois écrit). IA
  seulement sur choix explicite, dès 0:00 (choix du joueur : la première minute compte à
  l'entraînement), pour une partie ; VS forcé dès qu'AoE4World voit une classée, une rapide ou un
  joueur en face.
  Voir docs/profil-et-modes.md.
- **2026-10-29 · Mes matchups : 📌 BO de base par civ et règles civ × adversaire × carte.**
  Ce que tu as réglé passe avant ce que BoGo déduit (mémoire, habitude). Ordre : adversaire et
  carte, puis carte, puis adversaire, puis 📌. La carte passe avant l'adversaire (carte d'eau) ;
  en cas de conflit, pas de lancement auto. « Contre » en 1v1 classé ou rapide seulement. Un BO de
  tes matchups peut partir tout seul même jamais joué : exception à « jamais un BO jamais joué »,
  pour les seuls choix explicites.
- **2026-10-29 · Écran de choix, v1 sur la bibliothèque** (sans attendre les données
  aoe4guides). Règles : BO choisi avant la partie, mémoire contre la civ adverse (1v1), habitude
  avec la civ, bibliothèque ; catégories = celles de la bibliothèque (1 Boom, 2 Agressif, 3 Fast
  Castle, 4 Autre). Journal local dans un fichier app-data. Raccourcis de choix inscrits
  seulement de la détection au premier passage d'âge (5 min au plus), modifiables comme les
  autres. Pas encore : patch récent, cartes d'eau, plan « Âge II 4:20 », résultats.
- **2026-10-29 · Raccourcis modifiables (⚙ › Raccourcis).** Combinaison avec ⌘/⌃/⌥ (Ctrl/Alt
  sous Windows) ou touche F seule. Refusés : touche seule ou avec ⇧ (gênerait la frappe),
  Ctrl+Alt+lettre sous Windows (AltGr), raccourcis du système, doublons ; un raccourci que le
  système refuse (déjà pris par une autre appli) n'est pas gardé. Garde-fou : sans raccourci
  « Verrouiller » (ou « Afficher / masquer ») en place, BoGo ne se verrouille pas (ne se masque
  pas), faute de moyen d'y revenir.
- **2026-10-29 · Alertes : on garde le grand bandeau actuel** (texte + icônes, pleine largeur)
  plutôt que l'emplacement compact en pictogrammes de la maquette v3.
- **2026-10-29 · En partie, BoGo se verrouille (clics vers le jeu) au lancement d'un BO ; ✕ masque
  au lieu de quitter ; quitter demande un second clic.**
