#!/usr/bin/env bash
# Genera las versiones empaquetadas para Chrome y Firefox en dist/
set -euo pipefail
cd "$(dirname "$0")"
SRC="src"
FILES="background.js content.js popup.html popup.js download.html download.js icons"
rm -rf dist && mkdir -p dist/chrome dist/firefox
for target in chrome firefox; do
  for f in $FILES; do [ -e "$SRC/$f" ] && cp -r "$SRC/$f" "dist/$target/"; done
  cp LICENSE "dist/$target/"
done
cp "$SRC/manifest.json" dist/chrome/manifest.json
cp "$SRC/manifest.firefox.json" dist/firefox/manifest.json
(cd dist/chrome && zip -qr ../chrome.zip .)
(cd dist/firefox && zip -qr ../firefox.zip .)
echo "Listo: dist/chrome.zip y dist/firefox.zip"
