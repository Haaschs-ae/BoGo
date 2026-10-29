#!/usr/bin/env bash
# Compile bogo-vision (lecture de l'écran, macOS 14+) et bogo-translate pour Apple Silicon et Intel,
# aux noms attendus par Tauri pour un binaire externe (« sidecar »).
set -euo pipefail

cd "$(dirname "$0")/../src-tauri"
mkdir -p binaries

for arch in arm64:aarch64 x86_64:x86_64; do
  swift_arch="${arch%%:*}"
  rust_arch="${arch##*:}"
  swiftc -O -swift-version 5 -target "${swift_arch}-apple-macos14" \
    vision/main.swift -o "binaries/bogo-vision-${rust_arch}-apple-darwin"
done

lipo -create -output binaries/bogo-vision-universal-apple-darwin \
  binaries/bogo-vision-aarch64-apple-darwin binaries/bogo-vision-x86_64-apple-darwin

# bogo-translate : traduction des BO avec la traduction intégrée de macOS (macOS 15+). Sur un
# macOS plus ancien, il ne se lance pas et BoGo garde son dictionnaire.
for arch in arm64:aarch64 x86_64:x86_64; do
  swift_arch="${arch%%:*}"
  rust_arch="${arch##*:}"
  swiftc -O -swift-version 5 -target "${swift_arch}-apple-macos15" \
    translator/main.swift -o "binaries/bogo-translate-${rust_arch}-apple-darwin"
done

lipo -create -output binaries/bogo-translate-universal-apple-darwin \
  binaries/bogo-translate-aarch64-apple-darwin binaries/bogo-translate-x86_64-apple-darwin
