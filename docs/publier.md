# Publier une version de BoGo

BoGo se met à jour tout seul : au lancement, puis toutes les 6 heures (jamais en partie), il lit
`latest.json` sur la dernière version publiée du dépôt
(<https://github.com/Haaschs-ae/BoGo/releases/latest/download/latest.json>). Si le numéro est plus
grand que le sien, une bannière propose « Mettre à jour » : téléchargement, vérification de la
signature, installation, relance. Tes BO, matchups et réglages restent sur la machine.

## Publier

1. `node scripts/bump-version.mjs 0.2.1` (package.json, package-lock.json, tauri.conf.json, Cargo.toml).
2. Ajouter une section `## 0.2.1` à `docs/nouveautes.md`.
3. Committer et pousser sur `main` ou `claude/v1-etape1`.

Le workflow **Build** construit Mac et Windows ; le job **publish** crée la version `v0.2.1`
(dmg, installateur Windows, fichiers de mise à jour signés, `latest.json`) si elle n'existe pas
encore. Un numéro déjà publié n'est jamais republié : sans changement de version, rien ne part.

## Secrets du dépôt (Settings → Secrets and variables → Actions)

| Secret | Rôle |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Signe les mises à jour. Sans elle, rien n'est publié. BoGo refuse toute mise à jour qui n'est pas signée par cette clé (clé publique dans `tauri.conf.json`). |
| `MACOS_CERT_P12` | Certificat auto-signé « BoGo Self Signed » (p12 en base64) : toutes les versions Mac sont signées pareil, macOS garde l'autorisation d'enregistrer l'écran. |
| `MACOS_CERT_PASSWORD` | Mot de passe du p12. |

**Garder une copie de la clé privée et du certificat** hors de GitHub (gestionnaire de mots de
passe) : GitHub ne les rend jamais lisibles. Perdre la clé privée, c'est ne plus pouvoir publier
de mise à jour que les BoGo installés acceptent (il faudrait réinstaller à la main).

## Limites

- La toute première version qui contient la mise à jour automatique (0.2.0) s'installe à la main ;
  les suivantes arrivent toutes seules.
- Passer de la signature ad hoc au certificat « BoGo Self Signed » redemande une dernière fois
  l'autorisation d'enregistrer l'écran.
- Windows : l'installateur se lance en mode « passif » (barre de progression), ferme BoGo et le
  relance.
