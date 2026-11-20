# Как помочь Nami

Спасибо, что хотите улучшить проект. Перед PR прочитайте [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Процесс

1. Сделайте форк и создайте ветку от `main`.
2. Внесите изменения небольшими коммитами.
3. Откройте PR с описанием: что изменилось и как проверить.

## Перед PR

```bash
export CARGO_TARGET_DIR="$HOME/Library/Caches/nami-target-test"
cargo test --lib
node scripts/check_i18n.js
bash scripts/check_rules.sh
```

- Новые строки интерфейса — только через ключи `T()` / `data-i18n` в `renderer/locales/<код>.json`.
- Новая IPC-команда регистрируется в трёх местах: `src-tauri/src/lib.rs`, `src-tauri/permissions/founders.toml`, `renderer/js/tauri-bridge.js`.

## Что не коммитить

- `src-tauri/target/`, `node_modules/`, `dist/nami-collector/`;
- базы и выгрузки (`*.sqlite`, `data/`), токены, `.env`, сертификаты;
- личные данные из кабинета Яндекс Игр (ответы консоли, идентификаторы аккаунтов).

## Лицензия вклада

Отправляя PR, вы соглашаетесь, что вклад распространяется по [LICENSE](LICENSE) (PolyForm Noncommercial 1.0.0). Коммерческое использование проекта — только по [COMMERCIAL.md](COMMERCIAL.md).
