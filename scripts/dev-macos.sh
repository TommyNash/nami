#!/usr/bin/env bash
# Быстро открыть debug .app с Assets.car (иконка как в проде).
# Не делает полный rebuild: берёт уже собранный target/debug/Nami.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/src-tauri/target/debug/Nami"
ICONS="$ROOT/src-tauri/icons"
COMPOSER="$ROOT/assets/app-icons/default/icon.icon"
CAR="$ICONS/Assets.car"

cd "$ROOT"

if [[ ! -x "$BIN" ]]; then
  echo "Сначала один раз собери binary: npm run tauri:dev:bin" >&2
  echo "(или cargo tauri:dev — после появления binary снова npm run macos:app)" >&2
  exit 1
fi

# Assets.car только если нет или Icon.icon новее
need_icons=0
if [[ ! -f "$CAR" ]]; then
  need_icons=1
elif [[ -d "$COMPOSER" ]] && [[ "$COMPOSER/icon.json" -nt "$CAR" || "$COMPOSER/Assets/growth.png" -nt "$CAR" ]]; then
  need_icons=1
fi
if [[ "$need_icons" -eq 1 ]]; then
  echo "[macos:app] обновляю Assets.car из Icon Composer"
  npm run icons:prepare
fi

bash scripts/macos-wrap-app.sh debug
APP="$ROOT/src-tauri/target/debug/bundle/macos/Nami.app"
pkill -x "Nami" 2>/dev/null || true
sleep 0.2
open "$APP"
echo "[macos:app] $APP"
