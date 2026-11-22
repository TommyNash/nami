function invalidateGamesModels() {
  gamesModelCache.clear();
  gamesModelInflight.clear();
  prefetchedScreens.clear();
  accountsCache = null;
  window.__faEarnMonths = null;
  window.__faEarnMonthsAccount = null;
}

function activeAccountIdFrom(data) {
  if (data && data.activeAccountId) return String(data.activeAccountId);
  if (window.FoundersApp && window.FoundersApp.state && window.FoundersApp.state.activeAccountId) {
    return String(window.FoundersApp.state.activeAccountId);
  }
  return '';
}

let gamesModelGeneration = 0;

function loadGamesModel(period, heatCompare, { force = false, accountId = null, prefetch = false } = {}) {
  const aid = accountId != null ? accountId : activeAccountIdFrom(null);
  const key = `${period}|${heatCompare}|${aid || ''}`;
  if (!force) {
    const cached = gamesModelCache.get(key);
    if (cached) return Promise.resolve(cached);
  }
  // Дедупликация: параллельные вызовы (render + loadData) ждут один и тот же запрос.
  const running = gamesModelInflight.get(key);
  if (running) return running;

  if (!prefetch) {
    prefetchPaused = true;
    gamesModelGeneration += 1;
  }
  const generation = gamesModelGeneration;

  const task = window.NamiServices.portfolio
    .screen(period, heatCompare, aid || null)
    .then((screen) => {
      const model = {
        period,
        heatCompare,
        accountId: aid || null,
        games: (screen && screen.games) || [],
        months: (screen && screen.months) || [],
        overview: (screen && screen.overview) || null,
        heatmap: (screen && screen.heatmap) || null,
        coverage: (screen && screen.coverage) || null
      };
      putScreenModel(gamesModelCache, key, model, GAMES_MODEL_CACHE_LIMIT);
      const currentPeriod =
        (window.FoundersApp && window.FoundersApp.state && window.FoundersApp.state.period) || period;
      const currentCompare =
        (window.FoundersApp && window.FoundersApp.state && window.FoundersApp.state.heatCompare) ||
        heatCompare;
      const newer = staleScreen(
        gamesModelCache,
        generation,
        gamesModelGeneration,
        prefetch,
        screenCacheKey(currentPeriod, currentCompare, aid)
      );
      if (newer) return newer;
      return model;
    })
    .finally(() => {
      gamesModelInflight.delete(key);
      if (!prefetch) prefetchPaused = false;
      pumpPrefetch();
    });

  gamesModelInflight.set(key, task);
  return task;
}

const PREFETCH_PERIODS = ['day', 'week', 'month', 'year', 'all'];
const PREFETCH_COMPARES = ['prev_month', 'prev_period', 'd7', 'd14', 'd30'];
const prefetchedScreens = new Set();
const prefetchQueue = [];
let prefetchPump = null;
let prefetchPaused = false;

function pageIsLoading() {
  const root = document.getElementById('pageRoot');
  return !!(root && root.classList.contains('is-loading'));
}

/** Фоновые запросы идут по одному и уступают клику по фильтру. */
function scheduleIdleTask(task) {
  if (typeof task !== 'function') return;
  prefetchQueue.push(task);
  pumpPrefetch();
}

function pumpPrefetch() {
  if (prefetchPump) return;
  const step = () => {
    prefetchPump = null;
    if (prefetchPaused || gamesModelInflight.size > 0 || pageIsLoading()) {
      prefetchPump = setTimeout(step, 80);
      return;
    }
    const task = prefetchQueue.shift();
    if (!task) return;
    let done = Promise.resolve();
    try {
      done = Promise.resolve(task());
    } catch (_) {
      done = Promise.resolve();
    }
    done.finally(() => {
      prefetchPump = setTimeout(step, 16);
    });
  };
  prefetchPump = setTimeout(step, 60);
}

function enqueueScreen(period, heatCompare, accountId) {
  const aid = accountId || '';
  const key = `${period}|${heatCompare}|${aid}`;
  if (gamesModelCache.has(key) || gamesModelInflight.has(key)) return;
  if (prefetchQueue.some((job) => job && job.screenKey === key)) return;
  const task = () => loadGamesModel(period, heatCompare, { accountId: aid || null, prefetch: true });
  task.screenKey = key;
  prefetchQueue.push(task);
}

/** Соседние периоды и режимы карты считаем заранее, по одному запросу.
 *  Смена сравнения прогревает только карту текущего периода, без повторного
 *  пересчёта дня/недели/года. */
function prefetchPeriodScreens(accountId, heatCompare) {
  const aid = accountId || '';
  const cmp = heatCompare || 'prev_month';
  const current =
    (window.FoundersApp && window.FoundersApp.state && window.FoundersApp.state.period) || 'month';
  // Сначала соседние периоды: их кликают сразу, сравнение карты — реже.
  const periodStamp = `${aid}|${cmp}|periods`;
  if (!prefetchedScreens.has(periodStamp)) {
    prefetchedScreens.add(periodStamp);
    for (const period of PREFETCH_PERIODS) {
      if (period !== current) enqueueScreen(period, cmp, aid);
    }
  }
  const compareStamp = `${aid}|${current}|compares`;
  if (!prefetchedScreens.has(compareStamp)) {
    prefetchedScreens.add(compareStamp);
    for (const compare of PREFETCH_COMPARES) enqueueScreen(current, compare, aid);
  }
  pumpPrefetch();
}

/** Смена фильтров карты без перерисовки всей страницы. */
function updateHeatmapOnly(root, data, { refetch = false } = {}) {
  const mount = root && root.querySelector('#heatmapMount');
  if (!mount) return Promise.resolve();
  const metric = data.heatMetric || 'players';
  if (!refetch && lastHeatmapPayload) {
    mountHeatmap(mount, lastHeatmapPayload, metric);
    return Promise.resolve();
  }
  // Пока грузим новую базу сравнения, оставляем старую карту и гасим её скелетоном
  // на месте — так панель не «прыгает» и не пустеет.
  if (window.FoundersApp && typeof window.FoundersApp.loading === 'function') {
    window.FoundersApp.loading(true);
  }
  const aid = activeAccountIdFrom(data);
  return window.NamiServices.portfolio
    .heatmap(data.period || 'month', data.heatCompare || 'prev_month', aid || null)
    .then((payload) => {
      lastHeatmapPayload = payload;
      mountHeatmap(mount, payload, metric);
    })
    .catch(() => {})
    .finally(() => {
      if (window.FoundersApp && typeof window.FoundersApp.loading === 'function') {
        window.FoundersApp.loading(false);
      }
    });
}

/* —— Отрисовка страницы «Игры»: полная и точечная —— */

/* —— Свечи по дням внутри KPI-карточек ——
   Вместо текста под цифрой показываем дни периода: есть данные / нет данных.
   Ховер на свече — значение за день, ховер на полосе — сводка по периоду. */
