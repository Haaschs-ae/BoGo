# Maquettes

Pages HTML autonomes, rendues sur une capture du jeu (`bg.webp`, pseudos des autres joueurs
floutés) ou sur un bureau neutre. Elles servent de référence pour l'interface à coder ; elles ne
sont pas chargées par l'appli.

- `audit.html?v=jeu|pastille|accueil|civ|assistant1|assistant3|reglages|apropos|erreurs|windows`
  avec `audit.css` : maquettes d'amélioration issues de l'audit (`docs/audit.md`, section
  « Brief des maquettes »).
- `choix-c-v2.html` avec `choix.css` : écran de choix du BO au début de la partie (écran C,
  version 2), voir `docs/conseil-bo.md`.
- `render.cjs` : rendu en PNG avec Playwright (`node render.cjs jeu pastille …`).

Les icônes dans `icons/` sont des éléments d'Age of Empires IV © Microsoft (Game Content
Usage Rules), reprises de RTS Overlay et d'aoe4world/overlay pour ces maquettes.
