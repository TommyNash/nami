# Структура фронтенда

```
renderer/
  index.html          порядок скриптов
  js/tauri-bridge.js  invoke, единственное место IPC
  js/core/services.js NamiServices: app, portfolio, game, tax, settings
  js/core/ipc-contract.js  имена команд
  js/app/store.js     NamiStore, ключи fa.*
  js/app/lifecycle.js смена страницы
  js/app.js           хром, render, загрузка данных
  js/model/           чистые расчёты и кэш экрана
  js/ui/              DOM-хелперы и patchKpiCard
  js/chart-widgets.js подсказки графиков
  js/chart-format.js  оси, средние, даты
  js/charts.js        объект FoundersCharts
  js/charts-*.js      один тип графика на файл
  js/pages/*-view.js  разметка экрана
  js/pages/games-data.js    кэш и догрузка
  js/pages/games-table.js   клики таблицы
  js/pages/workspace-*.js   ряды, графики и разделы карточки
  js/pages/period-view.js   сегмент периода
  styles/parts/       стили по экранам, токены в base.css
```

Rust, SQLite и расширение не входят в этот слой.
