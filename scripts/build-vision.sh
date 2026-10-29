#!/usr/bin/env bash
# Compile bogo-vision (lecture de l'écran, macOS 14+) pour Apple Silicon et Intel,
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
