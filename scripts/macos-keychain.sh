#!/usr/bin/env bash
# CI macOS : importe le certificat auto-signé de BoGo (secret MACOS_CERT_P12) pour signer
# toujours avec la même identité. macOS garde alors l'autorisation « Enregistrement de
# l'écran » d'une version à l'autre ; avec une signature ad hoc, elle saute à chaque version.
set -euo pipefail

if [ -z "${MACOS_CERT_P12:-}" ]; then
  echo "::warning::Secret MACOS_CERT_P12 absent : signature ad hoc (l'autorisation d'enregistrer l'écran sera redemandée à chaque version)."
  exit 0
fi

identity="BoGo Self Signed"
keychain="$RUNNER_TEMP/bogo.keychain-db"
keychain_password=$(openssl rand -hex 16)

echo "$MACOS_CERT_P12" | base64 --decode > "$RUNNER_TEMP/bogo.p12"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
security import "$RUNNER_TEMP/bogo.p12" -k "$keychain" -P "${MACOS_CERT_PASSWORD:-}" -T /usr/bin/codesign
rm "$RUNNER_TEMP/bogo.p12"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" > /dev/null
# Le trousseau temporaire rejoint la liste de recherche (codesign y trouve l'identité).
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')

# Certificat auto-signé : on le déclare de confiance pour la signature de code sur ce runner.
security find-certificate -c "$identity" -p "$keychain" > "$RUNNER_TEMP/bogo.pem"
sudo security add-trusted-cert -d -r trustRoot -p codeSign -k /Library/Keychains/System.keychain "$RUNNER_TEMP/bogo.pem" \
  || echo "::warning::Confiance non ajoutée au certificat (la signature peut quand même marcher)."
security find-identity -p codesigning "$keychain"

# Lu par la CLI Tauri à la place de signingIdentity ("-") de tauri.macos.conf.json.
echo "APPLE_SIGNING_IDENTITY=$identity" >> "$GITHUB_ENV"
