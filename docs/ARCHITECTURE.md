# Архитектура

> Обновляй этот файл в том же коммите, где меняется структура. Последнее обновление: 2026-11-22

## 1. Что это

Десктоп-аналитика портфеля игр Яндекс Игр: расширение собирает ответы консоли, Tauri-приложение нормализует их в SQLite и показывает KPI, карту, таблицу и сравнение.

## 2. Стек

UI: Tauri 2 + WebView (ванильный JS) · Async: `tauri::async_runtime` + `spawn_blocking` · Данные: SQLite (`rusqlite`) · Логи: `tracing`

## 3. Карта крейтов

| Крейт | Ответственность | Зависит от | НЕ должен зависеть от |
|---|---|---|---|
| `fa-core` | доменные типы (`PeriodBounds`, даты) | - | UI, SQLite |
| `fa-analytics` | чистые расчёты (пока заглушка, логика в `src-tauri`) | fa-core | storage, app |
| `fa-storage` | БД (пока заглушка, схема и пути в `src-tauri`) | fa-core | analytics, app |
| `nami` (`src-tauri`) | UI IPC, ingest, normalize, analytics | fa-core | - |

Workspace: корневой `Cargo.toml`. Сборка Tauri: `scripts/tauri.sh` (локальный `CARGO_TARGET_DIR`).

## 4. Поток данных

```
расширение → HTTP ingest → raw_responses → normalize → SQLite
                                              ↓
                         games_screen / Dataset memos (earn + series)
                                              ↓
                         IPC JSON (агрегаты экрана) → renderer patch DOM
```

## 5. Поток интерфейса при смене фильтра

Intent (период/сравнение) → JS cache hit? → иначе `games_screen` async → `spawn_blocking` → memo/кэш экрана → generation на фронте → `patchGamesView` без полного скелетона при cache hit.

## 6. Ключевые типы

- `PeriodBounds` — `fa-core` / реэкспорт в `analytics`
- `SeriesMemo` / `EarnRow` — снапшоты в `analytics::memo`
- Screen cache — `AppState.screen_cache` по ключам `port|` / `heat|`

## 7. Куда класть новый код

| Задача | Куда |
|---|---|
| Новая метрика портфеля | `src-tauri/src/analytics/` новый модуль + регистрация |
| IPC-команда | `commands.rs` + `lib.rs` handler + `permissions/founders.toml` + `tauri-bridge.js` |
| Нормализация ручки API | `normalize.rs` + bump `NORMALIZER_VERSION` |
| UI раздела | `renderer/js/pages/`, данные экрана — `renderer/js/model/` |
| Вызов Rust | только `tauri-bridge.js`; страницы ходят в `NamiServices` |
| Общее состояние `fa.*` | `renderer/js/app/store.js` |
| Стили капсул/токенов | `renderer/styles/parts/base.css` |
| Текст интерфейса | ключ в `renderer/locales/ru.json` + `T()`; новый язык — файл `renderer/locales/<код>.json` с блоком `_meta` (`name`, `locale`); список языков собирает `scripts/sync_locales_index.js` в `locales/index.json`, правок кода не нужно |

## 8. Карта модулей analytics

| Модуль | Назначение |
|---|---|
| `mod.rs` | период, аккаунты, общие хелперы |
| `memo.rs` | кэш earnings + metric_series |
| `portfolio.rs` | list_games, overview, games_screen |
| `heatmap.rs` | тепловая карта |
| `coverage.rs` | покрытие / свечи |
| `tax.rs` | налог и ручные месяцы |
| `game.rs` | карточка игры |
| `compare.rs` | сравнение игр |
| `meta.rs` | overview/collector/history |

`backup.rs` (вне analytics) — выгрузка и восстановление всех данных: `VACUUM INTO` в файл `.nami` (SQLite + `meta.backup_*`), импорт через `ATTACH` и копирование общих колонок в одной транзакции, страховочная копия в `data/backups/`.

## 9. Фронтенд

Скрипты без бандлера, порядок в `renderer/index.html`.

```
store / lifecycle → NamiServices → model → pages → app.js
```

- `NamiStore` — страница, период, сравнение, аккаунт и остальные ключи `fa.*`. Пишет их только store.
- `NamiServices` — единственный вызов IPC из экранов. `invoke` остаётся в `tauri-bridge.js`.
- `model/` — доли, свечи, сравнение, кэш экрана. Поведение зафиксировано в `renderer/js/model/model.test.js`.
- `NamiLifecycle.listen` — вешает слушатель и снимает его в `destroy` при уходе со страницы или перед повторной привязкой.
- Разметка экрана — `*-view.js`, ряды и графики — отдельные файлы, страница их вызывает. Общие `var` (`WS_SERIES`, кэш экрана) видны соседним скриптам; `const` между файлами не виден.
- Смена фильтра по-прежнему: кэш модели → `patchGamesView`, скелетон только при входе в раздел.

Решения: `docs/ARCHITECTURE_DECISIONS.md`. Куда класть страницу и компонент: `docs/DEVELOPMENT.md`.

## 10. Решения (ADR)

Фронтенд: без Vite. Разметка — функции в `*-view.js` и `namiEl`. См. `docs/ARCHITECTURE_DECISIONS.md`.

## 11. Известные ограничения и долг

Открытые вопросы и ограничения — в [Issues](https://github.com/TommyNash/nami/issues).
