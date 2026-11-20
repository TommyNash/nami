# Nami

Локальная аналитика игр из кабинета [Яндекс Игр](https://games.yandex.ru/console/).

Расширение **Nami Collector** для Chrome передаёт данные в приложение Nami. Всё хранится на вашем компьютере в SQLite: доход, игроки, метрики, сравнение игр и выгрузка отчётов.

## Скачать

Готовые сборки для macOS (`.dmg`) и Windows (`.exe`) лежат в [Releases](https://github.com/TommyNash/nami/releases/latest).

Сборки не подписаны Apple и Microsoft. На macOS при первом запуске откройте приложение через правый клик → «Открыть». Если macOS пишет, что приложение «повреждено», выполните в Терминале:

```bash
xattr -cr "/Applications/Nami.app"
```

## Расширение Nami Collector

1. Откройте в Nami раздел **Настройки** → **Расширение для Chrome** и нажмите **Скачать**. Папка `nami-collector` появится в «Загрузках».
2. В Chrome откройте `chrome://extensions`, включите **Режим разработчика** и нажмите **Загрузить распакованное**.
3. Выберите папку `nami-collector` из «Загрузок».
4. В popup расширения нажмите **Подключить к приложению**.

## Разработка

Нужны Node.js, Rust и Tauri CLI.

```bash
npm install
npm start            # запуск приложения в режиме разработки
npm run pack:extension   # сборка ZIP расширения в dist/
```

Подробнее о структуре: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Структура

```
src-tauri/   приложение Tauri: IPC, ingest, normalize, SQLite
crates/      доменные crates: core, storage, analytics
renderer/    интерфейс приложения (ванильный JS)
extension/   Nami Collector (Chrome MV3)
scripts/     сборка, проверки, генерация служебных файлов
docs/        архитектура приложения
```

## Безопасность

- Приём данных только с `localhost`.
- Токен сопряжения выдаётся локально.
- Секреты и CSRF-токены вырезаются перед сохранением.

## Участие в проекте

Предложения и правки приветствуются: см. [CONTRIBUTING.md](CONTRIBUTING.md).

## Лицензия

Nami распространяется по лицензии [PolyForm Noncommercial 1.0.0](LICENSE). Вы можете использовать, менять и распространять проект в некоммерческих целях.

Коммерческое использование, продажа и платное распространение возможны только с согласия Founders Games: см. [COMMERCIAL.md](COMMERCIAL.md).
