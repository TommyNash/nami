#!/usr/bin/env bash
set -euo pipefail

export PATH="${HOME}/.cargo/bin:${PATH}"
if [[ -f "${HOME}/.cargo/env" ]]; then
  # shellcheck disable=SC1091
  source "${HOME}/.cargo/env"
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo не найден. Установите Rust: https://rustup.rs" >&2
  echo "Затем: source \"\$HOME/.cargo/env\"" >&2
  exit 127
fi

# На внешнем диске macOS кладёт AppleDouble (._*) рядом с файлами.
# Tauri читает permissions/*.toml как UTF-8 и падает на таком мусоре.
root="$(cd "$(dirname "$0")/.." && pwd)"
find "${root}/src-tauri" -name target -type d -prune -o -name '._*' -type f -exec rm -f {} + 2>/dev/null || true

# Кэш сборки — на локальный диск: WD Blue плодит ._ в target и ломает tauri build.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-${HOME}/Library/Caches/founders-analytics-target}"
mkdir -p "${CARGO_TARGET_DIR}"

# Список языков интерфейса собирается из renderer/locales/*.json.
if command -v node >/dev/null 2>&1; then
  node "${root}/scripts/sync_locales_index.js" >/dev/null || true
fi

exec cargo tauri "$@"
