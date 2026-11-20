#!/usr/bin/env bash
# Собирает .app с Assets.car из Icon Composer — иначе Dock берёт плоский icns/PNG
# и macOS 27 рисует «свет наискосок».
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${1:-debug}"
BIN="$ROOT/src-tauri/target/$PROFILE/Nami"
ICONS="$ROOT/src-tauri/icons"
APP_OUT="${2:-$ROOT/src-tauri/target/$PROFILE/bundle/macos/Nami.app}"

if [[ ! -x "$BIN" ]]; then
  echo "Нет бинарника: $BIN — сначала npm run tauri:dev или cargo build" >&2
  exit 1
fi
if [[ ! -f "$ICONS/Assets.car" ]]; then
  echo "Нет Assets.car — запусти npm run icons:prepare" >&2
  exit 1
fi

CONTENTS="$APP_OUT/Contents"
MACOS="$CONTENTS/MacOS"
RES="$CONTENTS/Resources"
rm -rf "$APP_OUT"
mkdir -p "$MACOS" "$RES"

cp "$BIN" "$MACOS/Nami"
chmod +x "$MACOS/Nami"
cp "$ICONS/Assets.car" "$RES/Assets.car"
[[ -f "$ICONS/icon.icns" ]] && cp "$ICONS/icon.icns" "$RES/icon.icns"

# Info.plist: CFBundleIconName=Icon → системный свет сверху из Composer
cat > "$CONTENTS/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleDisplayName</key>
	<string>Nami</string>
	<key>CFBundleExecutable</key>
	<string>Nami</string>
	<key>CFBundleIconFile</key>
	<string>icon.icns</string>
	<key>CFBundleIconName</key>
	<string>Icon</string>
	<key>CFBundleIdentifier</key>
	<string>app.nami.desktop</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>Nami</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>0.2.0</string>
	<key>CFBundleVersion</key>
	<string>0.2.0</string>
	<key>LSMinimumSystemVersion</key>
	<string>26.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
PLIST

echo "Готово: $APP_OUT"
echo "Открой этот .app — в Dock будет Icon Composer (свет сверху), не PNG."
