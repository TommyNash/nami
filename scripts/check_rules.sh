#!/usr/bin/env bash
# Автопроверка правил RULES.md. Копируется в проект: scripts/check_rules.sh
# Лимиты можно менять переменными окружения. Исключения - файл scripts/rules_allowlist.txt (по одному пути на строку).
set -u
MAX_FILE="${MAX_FILE:-400}"
MAX_FN="${MAX_FN:-80}"
ALLOW="scripts/rules_allowlist.txt"
fail=0
allowed() { [ -f "$ALLOW" ] && grep -qxF "$1" "$ALLOW"; }
FILES=$(find . -name '*.rs' \
  -not -path './target/*' \
  -not -path './src-tauri/target/*' \
  -not -path './.git/*' \
  -not -path '*/tests/*' \
  -not -path '*/benches/*' \
  -not -name 'tests_manual.rs')

echo "[R2] файлы > $MAX_FILE строк"
for f in $FILES; do
  n=$(wc -l < "$f"); allowed "$f" && continue
  [ "$n" -gt "$MAX_FILE" ] && { echo "  FAIL $f ($n)"; fail=1; }
done

echo "[R3] файлы-свалки"
for f in $FILES; do
  case "$(basename "$f")" in utils.rs|helpers.rs|misc.rs|common.rs) allowed "$f" || { echo "  FAIL $f"; fail=1; };; esac
done

echo "[R6] запрещено в UI-слое: block_on, thread::sleep"
UI_DIRS="${UI_DIRS:-src-tauri/src}"
# В Tauri UI — WebView; в Rust-командах spawn_blocking допустим, block_on/sleep — нет.
for d in $UI_DIRS; do
  [ -d "$d" ] && grep -rnE 'block_on\(|thread::sleep' --include='*.rs' "$d" && fail=1
done

echo "[R15] println!/dbg! вне тестов"
grep -rnE '\b(println!|eprintln!|dbg!)' --include='*.rs' $(echo "$FILES") 2>/dev/null | grep -v '// allow-print' && fail=1

echo "[R14] unwrap()/expect() вне тестов (предупреждение через clippy; здесь - грубая проверка)"
grep -rnE '\.unwrap\(\)' --include='*.rs' $(echo "$FILES") 2>/dev/null | grep -v '#\[cfg(test)\]' | head -20

echo "[R16] TODO/allow без ссылки на DEBT"
grep -rnE 'TODO|FIXME|HACK|#\[allow\(' --include='*.rs' $(echo "$FILES") 2>/dev/null | grep -v 'DEBT-' && fail=1

echo "[R1] зависимости analytics/core не тянут UI/IO"
for c in crates/fa-core crates/fa-analytics; do
  [ -f "$c/Cargo.toml" ] && grep -nE '^(tauri|egui|eframe|iced|slint|tokio|rusqlite|sqlx|reqwest)\b' "$c/Cargo.toml" && fail=1
done

echo "[R22] локализация интерфейса"
node scripts/check_i18n.js >/dev/null 2>&1 || { node scripts/check_i18n.js | head -20; fail=1; }

[ "$fail" -eq 0 ] && echo "OK" || { echo "Правила нарушены"; exit 1; }
