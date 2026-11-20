#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/extension/manifest.json').version")"
OUT_DIR="$ROOT/dist"
STAGE="$OUT_DIR/nami-collector"
ZIP="$OUT_DIR/nami-collector-v${VERSION}.zip"

rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE"

# Copy only runtime files
rsync -a \
  --exclude '.DS_Store' \
  --exclude '*.map' \
  --exclude '__MACOSX' \
  "$ROOT/extension/" "$STAGE/"

cp "$ROOT/extension/INSTALL.txt" "$OUT_DIR/INSTALL-Nami-Collector.txt"

(
  cd "$OUT_DIR"
  zip -r -q "nami-collector-v${VERSION}.zip" "nami-collector" \
    -x "*.DS_Store" -x "*__MACOSX*" -x "*/._*"
)

# sanity: must contain manifest (avoid SIGPIPE under pipefail)
unzip -l "$ZIP" | grep "nami-collector/manifest.json" >/dev/null

echo "Packed: $ZIP"
ls -lh "$ZIP"
