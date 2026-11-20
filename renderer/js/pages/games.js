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

  const task = window.foundersApi
    .gamesScreen(period, heatCompare, aid || null)
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
      gamesModelCache.set(key, model);
      while (gamesModelCache.size > GAMES_MODEL_CACHE_LIMIT) {
        gamesModelCache.delete(gamesModelCache.keys().next().value);
      }
      // Устаревший клик по периоду не должен подменять свежий экран.
      if (!prefetch && generation !== gamesModelGeneration) {
        const newer = gamesModelCache.get(
          `${(window.FoundersApp && window.FoundersApp.state && window.FoundersApp.state.period) || period}|${
            (window.FoundersApp && window.FoundersApp.state && window.FoundersApp.state.heatCompare) ||
            heatCompare
          }|${aid || ''}`
        );
        if (newer) return newer;
      }
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
  return window.foundersApi
    .gamesHeatmap(data.period || 'month', data.heatCompare || 'prev_month', aid || null)
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
function ymdFromDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
      ).padStart(2, '0')}`;
}

function dayList(fromDay, toDay) {
  const from = new Date(`${fromDay}T00:00:00Z`);
  const to = new Date(`${toDay}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return [];
  const total = Math.round((to - from) / 86400000) + 1;
  const out = [];
  for (let i = 0; i < total; i += 1) {
    out.push(ymdFromDate(new Date(from.getTime() + i * 86400000)));
  }
  return out;
}

/** Окно свечей строго по выбранному периоду.
 *  Длинные окна (год / всё / свой диапазон на много месяцев) — последние
 *  31 день выбранного отрезка: иначе полоса ломается сотнями свечей. */
function candleWindow(period, bounds, today) {
  const toDay = (bounds && bounds.toDay) || today || '';
  let fromDay = (bounds && bounds.fromDay) || toDay;
  if (!toDay) return { fromDay: '', toDay: '' };
  if (period === 'day') return { fromDay: toDay, toDay };

  const MAX_CANDLES = 31;
  const days = dayList(fromDay, toDay);
  if (days.length > MAX_CANDLES) {
    fromDay = days[days.length - MAX_CANDLES];
  }
  return { fromDay, toDay };
}

function shortDay(day) {
  if (F().dateAxis) return F().dateAxis(day);
  const [, m, d] = String(day).split('-');
  return m && d ? `${d}.${m}` : String(day || '');
}

/* —— Тултип для дневных свечей ——
   Живёт в body: карточки обрезаны squircle clip-path, поэтому внутренний
   ::after был бы отрезан. Делегирование на document — не требует перепривязки. */
function ensureDaysTip() {
  let tip = document.getElementById('daysTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'daysTip';
    tip.className = 'days-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function placeDaysTip(tip, rect) {
  const pad = 8;
  tip.style.left = '-9999px';
  tip.style.top = '0px';
  tip.classList.add('is-open');
  const w = tip.offsetWidth || 140;
  const h = tip.offsetHeight || 28;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
  let top = rect.top - h - 8;
  if (top < pad) top = rect.bottom + 8;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function bindDaysTips() {
  const tip = ensureDaysTip();
  const hide = () => tip.classList.remove('is-open');

  document.addEventListener('mouseover', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const day = target.closest('.kpi-day');
    if (day) {
      const text = day.getAttribute('data-tip') || '';
      if (!text) return hide();
      tip.textContent = text;
      placeDaysTip(tip, day.getBoundingClientRect());
      return;
    }
    const strip = target.closest('.kpi-days');
    if (strip) {
      const text = strip.getAttribute('data-tip') || '';
      if (!text) return hide();
      tip.textContent = text;
      placeDaysTip(tip, strip.getBoundingClientRect());
      return;
    }
    hide();
  });

  // Прокрутка/уход курсора: тултип не должен «висеть»
  document.addEventListener('mouseleave', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}

/**
 * Дни периода для карточки дохода.
 * Показываем РЕАЛЬНЫЕ суммы за день, посчитанные по играм (дневные бакеты
 * Яндекса). Суммы за период/месяц НЕ размазываем по дням — это давало
 * фиктивные значения. День без дневного бакета = данных нет, либо
 * «только в сумме периода», если есть покрывающий range/month с доходом.
 */
function earnDaysOf(view) {
  const cov = view.coverage || {};
  const ov = view.overview || {};
  const { fromDay, toDay } = candleWindow(view.period, ov.bounds || cov.bounds, cov.today);
  if (!toDay) return [];

  const byDay = new Map();
  const covers = [];
  const seriesBy = indexDays(cov.earnSeriesDays);
  (cov.earnBuckets || []).forEach((b) => {
    if (!b || !b.from) return;
    // Однодневный бакет — это день, даже если бэкенд пометил 1-е число как month.
    const isDay = b.kind === 'day' || b.from === b.to;
    if (isDay) {
      // hasValue=false (или earn == null/0) → Яндекс ещё не посчитал день.
      const v = Number(b.earn);
      const hasValue = b.hasValue === true && Number.isFinite(v);
      byDay.set(b.from, {
        value: hasValue ? v : null,
        games: b.games,
        withValue: b.gamesWithValue
      });
      return;
    }
    if (b.hasValue === true && b.to) {
      covers.push({ from: b.from, to: b.to });
    }
  });

  return dayList(fromDay, toDay).map((day) => {
    const hit = byDay.get(day);
    const series = seriesBy.get(day);
    const seriesValue = series && Number(series.earn) > 0 ? Number(series.earn) : null;
    // Точный дневной бакет важнее ряда. Если его нет или Яндекс ещё не
    // посчитал — берём сумму рекламы и инапов по играм за этот день.
    if (hit && hit.value != null) {
      return { day, value: hit.value, reason: 'value', games: hit.games, withValue: hit.withValue };
    }
    if (seriesValue != null) {
      return {
        day,
        value: seriesValue,
        reason: 'series',
        games: series.games,
        withValue: series.gamesWithValue
      };
    }
    if (hit) {
      return { day, value: null, reason: 'pending', games: hit.games, withValue: hit.withValue };
    }
    const inSum = covers.some((c) => c.from <= day && day <= c.to);
    if (inSum) return { day, value: null, reason: 'est' };
    return { day, value: null, reason: 'none' };
  });
}

function indexDays(rows) {
  const map = new Map();
  (rows || []).forEach((d) => {
    if (d && d.day) map.set(d.day, d);
  });
  return map;
}

function coverageThreshold(rows, field) {
  const max = Math.max(
    ...[...(rows || [])].map((d) => Number(d && d[field]) || 0),
    0
  );
  return Math.max(1, Math.ceil(max * 0.9));
}

/** Дни периода для карточки игроков.
 *  Ряд «players: Всего» — история по дням. Снимок панели закрывает дни,
 *  которых в ряде ещё нет. В покрытие входят только опубликованные игры
 *  со статистикой — черновики не раздувают «из N игр». */
function playersDaysOf(view) {
  const cov = view.coverage || {};
  const ov = view.overview || {};
  const { fromDay, toDay } = candleWindow(view.period, ov.bounds || cov.bounds, cov.today);
  if (!toDay) return [];

  const series = cov.playersSeriesDays && cov.playersSeriesDays.length
    ? cov.playersSeriesDays
    : (cov.metricsDays || []).filter((d) => d && d.source === 'series');
  const panel = cov.panelDays && cov.panelDays.length
    ? cov.panelDays
    : series.length
      ? []
      : cov.metricsDays || ov.playersDaily || [];
  const seriesBy = indexDays(series);
  const panelBy = indexDays(panel);
  const eligible = Math.max(
    Number(cov.eligibleGames) || 0,
    coverageThreshold(series, 'gamesWithValue'),
    coverageThreshold(panel, 'games'),
    1
  );
  const fullCut = Math.max(1, Math.ceil(eligible * 0.9));
  const lag = Number(cov.expectedLagDays) || 3;
  const today = cov.today || toDay;

  return dayList(fromDay, toDay).map((day) => {
    const s = seriesBy.get(day);
    const p = panelBy.get(day);
    const seriesPlayers = s ? Number(s.players) || 0 : 0;
    const seriesGames = s ? Number(s.gamesWithValue != null ? s.gamesWithValue : s.games) || 0 : 0;
    if (seriesPlayers > 0 && seriesGames > 0) {
      const full = seriesGames >= fullCut;
        return {
        day,
        players: seriesPlayers,
        games: seriesGames,
        globalMax: eligible,
        state: full ? 'full' : 'partial',
        source: 'series'
      };
    }
    const panelPlayers = p ? Number(p.players) || 0 : 0;
    const panelGames = p ? Number(p.games) || 0 : 0;
    if (panelPlayers > 0 && panelGames > 0) {
      const full = panelGames >= fullCut;
      return {
        day,
        players: panelPlayers,
        games: panelGames,
        globalMax: eligible,
        state: full ? 'full' : 'partial',
        source: 'panel'
      };
    }
    const age = dayAgeDays(day, today);
    const pending = age >= 0 && age <= lag;
    // Ряд за этот день пришёл, но все игры — ноль: дыра Яндекса, не «не собирали».
    const hole = !!(s && Number(s.games) > 0);
    return {
      day,
      players: 0,
      games: 0,
      globalMax: eligible,
      state: 'none',
      reason: hole ? 'hole' : pending ? 'lag' : 'none'
        };
      });
}

function dayAgeDays(day, today) {
  const a = new Date(`${day}T00:00:00Z`);
  const b = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return -1;
  return Math.round((b - a) / 86400000);
}

function stripHtml(days, { mode = 'players', summary = '' } = {}) {
  if (!days.length) return '';
  const max = Math.max(...days.map((d) => Number(d.value ?? d.players) || 0), 1);

  const bars = days
    .map((d) => {
      let state;
      let tip;
      let height;

      if (mode === 'earn') {
        const has = d.value != null && Number.isFinite(d.value);
        const soft = !has && (d.reason === 'pending' || d.reason === 'est');
        // pending/est = запрос был / есть в сумме периода → бледная свеча, не серая.
        state = has ? 'is-full' : soft ? 'is-est' : 'is-none';
        height = has ? Math.max(26, Math.round(22 + (d.value / max) * 78)) : soft ? 40 : 12;
        if (has) {
          const gamesNote =
            d.withValue != null && d.games
              ? ` · ${T('games.strip.gamesOf', { n: d.games, withValue: d.withValue, games: d.games })}`
              : '';
          tip = `${shortDay(d.day)} — ${moneyFmt(d.value)}${gamesNote}${
            d.reason === 'series' ? ` · ${T('games.strip.sumByGames')}` : ''
          }`;
        } else if (d.reason === 'pending') {
          tip = T('games.strip.earnPending', { day: shortDay(d.day), games: d.games || 0 });
        } else if (d.reason === 'est') {
          tip = T('games.strip.earnEst', { day: shortDay(d.day) });
        } else {
          tip = T('games.strip.dayNotCollected', { day: shortDay(d.day) });
        }
      } else {
        const soft = d.state === 'none' && (d.reason === 'hole' || d.reason === 'lag');
        state =
          d.state === 'full'
            ? 'is-full'
            : d.state === 'partial'
              ? 'is-partial'
              : soft
                ? 'is-est'
                : 'is-none';
        height =
          d.state === 'none' && !soft
            ? 12
            : d.state === 'none'
              ? 40
              : Math.max(26, Math.round(22 + (d.players / max) * 78));
        const who =
          d.source === 'panel'
            ? ` · ${T('games.strip.sourcePanel')}`
            : d.source === 'series'
              ? ` · ${T('games.strip.sourceSeries')}`
              : '';
        tip =
          d.state === 'none'
            ? d.reason === 'hole'
              ? T('games.strip.playersHole', { day: shortDay(d.day) })
              : d.reason === 'lag'
                ? T('games.strip.playersLag', { day: shortDay(d.day) })
                : T('games.strip.playersNone', { day: shortDay(d.day) })
            : `${T('games.strip.playersDay', {
                n: d.players,
                day: shortDay(d.day),
                count: F().num(d.players, 0)
              })}${
                d.games && d.globalMax
                  ? ` ${T('games.strip.publishedOf', { games: d.games, max: d.globalMax })}`
                  : ''
              }${who}`;
      }

      return `<span class="kpi-day ${state}" style="--h:${height}%" data-tip="${F().esc(
        tip
      )}" aria-label="${F().esc(tip)}"></span>`;
    })
    .join('');

  return `<div class="kpi-days" role="img" aria-label="${F().esc(
    summary
  )}" data-tip="${F().esc(summary)}">${bars}</div>`;
}

/** Подпись-сводка для ховера: что именно получено за период. */
function daysSummary(days, mode) {
  if (!days.length) return T('games.strip.noData');
  const windowNote =
    days.length >= 31 && days[0] && days[days.length - 1]
      ? ` · ${T('games.strip.window', { from: shortDay(days[0].day), to: shortDay(days[days.length - 1].day) })}`
      : '';
  if (mode === 'earn') {
    // Свечи — это суммы по играм за конкретный день, ничего не делим.
    const got = days.filter((d) => d.value != null && Number.isFinite(d.value));
    const pending = days.filter((d) => d.reason === 'pending');
    const est = days.filter((d) => d.reason === 'est');
    const sum = got.reduce((a, d) => a + Number(d.value || 0), 0);
    const last = got[got.length - 1];
    const parts = [T('games.strip.earnDays', { got: got.length, total: days.length })];
    if (got.length) parts.push(T('games.strip.sum', { sum: moneyFmt(sum) }));
    if (pending.length) parts.push(T('games.strip.pendingDays', { n: pending.length }));
    if (est.length) parts.push(T('games.strip.estDays', { n: est.length }));
    if (last) parts.push(T('games.strip.lastDay', { day: shortDay(last.day) }));
    return parts.join(' · ') + windowNote;
  }
  const full = days.filter((d) => d.state === 'full').length;
  const partial = days.filter((d) => d.state === 'partial').length;
  const last = [...days].reverse().find((d) => d.state !== 'none');
  return `${T('games.strip.fullSlice', { full, total: days.length })}${
    partial ? `, ${T('games.strip.partial', { n: partial })}` : ''
  }${last ? `, ${T('games.strip.lastDay', { day: shortDay(last.day) })}` : ''}${windowNote}`;
}

function meanPlayers(days) {
  const full = (days || []).filter((d) => d.state === 'full' && Number(d.players) > 0);
  const use = full.length ? full : (days || []).filter((d) => Number(d.players) > 0);
  if (!use.length) return { value: 0, days: 0 };
  const value = use.reduce((s, d) => s + Number(d.players), 0) / use.length;
  return { value, days: use.length };
}

const dayStripCache = { coverage: null, overview: null, period: '', value: null };

function buildDayStrips(view) {
  if (
    dayStripCache.value &&
    dayStripCache.coverage === view.coverage &&
    dayStripCache.overview === view.overview &&
    dayStripCache.period === view.period
  ) {
    return dayStripCache.value;
  }
  const built = buildDayStripsUncached(view);
  dayStripCache.coverage = view.coverage;
  dayStripCache.overview = view.overview;
  dayStripCache.period = view.period;
  dayStripCache.value = built;
  return built;
}

function buildDayStripsUncached(view) {
  const ov = view.overview || {};
  const scoped = { ...view, period: view.period };
  const earnDays = earnDaysOf(scoped);
  const playersDays = playersDaysOf(scoped);
  const playersMean = meanPlayers(playersDays);

  const earnSummary = daysSummary(earnDays, 'earn');
  const playersSummary = daysSummary(playersDays, 'players');

  const lag = Number(ov.playersDayLag) || 0;
  const dataDay = ov.playersDay ? shortDay(ov.playersDay) : '';
  const playersIncomplete = (() => {
    const row = playersDays.find((d) => d.day === ov.playersDay);
    return !!row && row.state !== 'full';
    })();

  // На срезе «День» под цифрой свечи не нужны: это один день, не ряд.
  const showStrips = view.period !== 'day';

  return {
    earnStrip: showStrips ? stripHtml(earnDays, { mode: 'earn', summary: earnSummary }) : '',
    playersStrip: showStrips ? stripHtml(playersDays, { mode: 'players', summary: playersSummary }) : '',
    earnDays,
    playersDays,
    playersMean,
    earnSummary,
    playersSummary,
    playersIncomplete,
    playersSub: playersMean.days
      ? T('games.strip.meanOver', { n: playersMean.days, count: playersMean.days })
      : dataDay
        ? lag > 0
          ? T('games.strip.dataForLag', { day: dataDay, lag })
          : T('games.strip.dataFor', { day: dataDay })
        : T('games.strip.noPlayersSeries')
  };
}

function gamesFullHtml(view) {
  const compares = [
    ['prev_period', T('games.heat.compare.prev_period')],
    ['prev_month', T('games.heat.compare.prev_month')],
    ['d7', T('games.heat.compare.d7')],
    ['d14', T('games.heat.compare.d14')],
    ['d30', T('games.heat.compare.d30')]
  ]
    .map(
      ([id, label]) =>
        `<button type="button" class="seg-btn ${
          view.heatCompare === id ? 'active' : ''
        }" data-heat-compare="${id}">${label}</button>`
    )
    .join('');

  return `
    <div class="home" data-view="games">
        <div class="home-hero">
        <h1 class="home-greet" data-account-sig="${F().esc(view.accountSig || '')}">${F().esc(
    view.greet
  )}.${view.accountChipHtml || ''}</h1>
        <p class="home-lead">${view.leadHtml}</p>
        </div>

        <div class="kpi-row">
        <div class="kpi-card kpi-card-earn" data-kpi="earn">
          <div class="kpi-label">${F().esc(view.earnLabel)}</div>
          <div class="kpi-value" data-countup="${view.periodEarnSum}" data-count-fmt="money" data-count-key="home.earnCard" data-count-delay="0">${moneyFmt(
    view.periodEarnSum
  )}</div>
          ${view.earnStrip || `<div class="kpi-sub">${view.earnSub}</div>`}
          </div>
        <div class="kpi-card" data-kpi="avg">
            <div class="kpi-label">${T('games.kpi.avgPerDay')}</div>
          <div class="kpi-value" data-countup="${view.avgPerDay}" data-count-fmt="money" data-count-key="home.avgDayCard" data-count-delay="70">${moneyFmt(
    view.avgPerDay
  )}</div>
          <div class="kpi-sub">${view.avgSub}</div>
          </div>
        <div class="kpi-card" data-kpi="players">
            <div class="kpi-label">${T('games.kpi.playersPerDay')}</div>
          <div class="kpi-value" data-countup="${view.playersValue}" data-count-fmt="num" data-count-digits="0" data-count-key="home.playersCard" data-count-delay="140">${F().num(
    view.playersValue,
    0
            )}</div>
          ${view.playersStrip || `<div class="kpi-sub">${view.playersSub}</div>`}
          </div>
        <div class="kpi-card" data-kpi="arpu">
            <div class="kpi-label">${T('games.kpi.earnPerPlayer')}</div>
          <div class="kpi-value" data-countup="${view.arpu}" data-count-fmt="money" data-count-key="home.arpuCard" data-count-delay="210">${moneyFmt(
    view.arpu
  )}</div>
            <div class="kpi-sub">${T('games.kpi.ownCalc')}</div>
          </div>
        </div>

        <div class="home-grid home-grid-2">
          <div class="panel stretch">
            <div class="panel-head table-head-row">
              <div class="panel-title-row">
                <h2 id="heatTitle">${
                  view.heatMetric === 'earn' ? T('games.heat.byEarn') : T('games.heat.byPlayers')
                }</h2>
              </div>
              <div class="heatmap-filters">
              <div class="seg seg--compact" role="group" aria-label="${T('games.heat.metricAria')}" data-thumb-key="heat-metric">
                <button type="button" class="seg-btn ${
                  view.heatMetric === 'players' ? 'active' : ''
                }" data-heat-metric="players">${T('games.common.players')}</button>
                <button type="button" class="seg-btn ${
                  view.heatMetric === 'earn' ? 'active' : ''
                }" data-heat-metric="earn">${T('games.common.earn')}</button>
                </div>
              <div class="seg seg--compact" role="group" aria-label="${T('games.heat.compareAria')}" data-thumb-key="heat-compare">${compares}</div>
              </div>
            </div>
            <div class="panel-body" id="heatmapMount"></div>
          </div>
          <div class="panel panel-chart panel-earn-days">
            <div class="panel-head earn-days-head">
              <div>
                <h2>${T('games.earn.byMonth')}</h2>
              <div class="earn-days-sub muted">${view.maxMonthMeta}</div>
              </div>
              <button type="button" class="earn-manual-btn" data-open-tax title="${T('games.earn.taxTitle')}" aria-label="${T('games.earn.taxTitle')}">${
                window.FoundersIcons && window.FoundersIcons.svg
                  ? window.FoundersIcons.svg('arrow-right', 18)
                  : '→'
              }</button>
            </div>
            <div class="panel-body earn-days-body"><div id="homeEarnBars"></div></div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head table-head-row">
            <h2>${T('games.table.heading')}</h2>
            <div class="table-filters">
            <button
              type="button"
              class="toggle ${view.publishedOnly ? 'is-on' : ''}"
              id="hideInactive"
              role="switch"
              aria-checked="${view.publishedOnly ? 'true' : 'false'}"
              title="${T('games.table.publishedOnlyTitle')}"
            >
              <span class="toggle-track"><i class="toggle-knob"></i></span>
              <span class="toggle-text">${T('games.table.hideInactive')}</span>
            </button>
              <input id="gamesSearch" class="search compact" placeholder="${T('games.table.searchPlaceholder')}" value="${F().esc(
              view.gamesQuery || ''
              )}" />
            </div>
          </div>
        <div class="panel-body" style="padding:0" id="gamesTableWrap"></div>
      </div>
    </div>`;
}

/** Обновление карточки KPI без пересоздания DOM: элемент остаётся на месте,
 *  поэтому squircle не пересчитывает clip-path и значения не «моргают». */
function patchKpiCard(card, { label, value, fmt, digits, sub }) {
  if (!card) return;
  if (label != null) {
    const el = card.querySelector('.kpi-label');
    const text = String(label);
    if (el && el.textContent !== text) el.textContent = text;
  }
  const valueEl = card.querySelector('[data-countup]');
  if (valueEl) {
    if (fmt) valueEl.dataset.countFmt = fmt;
    if (digits != null) valueEl.dataset.countDigits = String(digits);
    valueEl.dataset.countup = String(Number(value) || 0);
  }
  if (sub != null) {
    const el = card.querySelector('.kpi-sub');
    if (el) el.innerHTML = sub;
  }
}

/** Точечное обновление уже показанной страницы «Игры». */
function patchGamesView(home, view) {
  const greetEl = home.querySelector('.home-greet');
  if (greetEl) {
    const next = `${F().esc(view.greet)}.${view.accountChipHtml || ''}`;
    if (greetEl.dataset.accountSig !== view.accountSig) {
      greetEl.innerHTML = next;
      greetEl.dataset.accountSig = view.accountSig || '';
    }
  }

  const leadEl = home.querySelector('.home-lead');
  if (leadEl) leadEl.innerHTML = view.leadHtml;

  const card = (name) => home.querySelector(`.kpi-card[data-kpi="${name}"]`);
  patchKpiCard(card('earn'), {
    label: view.earnLabel,
    value: view.periodEarnSum,
    fmt: 'money',
    sub: view.earnSub
  });
  patchKpiCard(card('avg'), {
    label: T('games.kpi.avgPerDay'),
    value: view.avgPerDay,
    fmt: 'money',
    sub: view.avgSub
  });
  patchKpiCard(card('players'), {
    label: T('games.kpi.playersPerDay'),
    value: view.playersValue,
    fmt: 'num',
    digits: 0,
    sub: view.playersSub
  });
  patchKpiCard(card('arpu'), {
    label: T('games.kpi.earnPerPlayer'),
    value: view.arpu,
    fmt: 'money',
    sub: T('games.kpi.ownCalc')
  });

  const sub = home.querySelector('.earn-days-sub');
  if (sub) sub.textContent = view.maxMonthMeta;

  // Свечи по дням в карточках дохода и игроков: пересобираем только при смене
  const paintStrip = (cardName, html, subHtml) => {
    const card = home.querySelector(`.kpi-card[data-kpi="${cardName}"]`);
    if (!card) return;
    const current = card.querySelector('.kpi-days');
    if (!html) {
      if (!current) {
        const sub = card.querySelector('.kpi-sub');
        if (sub && subHtml != null) sub.innerHTML = subHtml;
        return;
      }
      const sub = document.createElement('div');
      sub.className = 'kpi-sub';
      sub.innerHTML = subHtml || '';
      current.replaceWith(sub);
      return;
    }
    // Подпись без замены DOM оставляла старое число свечей при смене периода:
    // цифры KPI обновлялись, а полоса — нет.
    if (current && current.dataset.sig === html) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    const node = tmp.firstElementChild;
    if (!node) return;
    node.dataset.sig = html;
    if (current) current.replaceWith(node);
    else {
      const prev = card.querySelector('.kpi-sub');
      if (prev) prev.replaceWith(node);
      else card.appendChild(node);
    }
  };
  paintStrip('earn', view.earnStrip, view.earnSub);
  paintStrip('players', view.playersStrip, view.playersSub);

  syncGamesTable(home, view);

  const toggle = home.querySelector('#hideInactive');
  if (toggle) {
    toggle.classList.toggle('is-on', view.publishedOnly);
    toggle.setAttribute('aria-checked', view.publishedOnly ? 'true' : 'false');
  }

  home.querySelectorAll('[data-heat-metric]').forEach((b) => {
    b.classList.toggle('active', b.dataset.heatMetric === view.heatMetric);
  });
  home.querySelectorAll('[data-heat-compare]').forEach((b) => {
    b.classList.toggle('active', b.dataset.heatCompare === view.heatCompare);
  });
  const heatTitle = home.querySelector('#heatTitle');
  if (heatTitle) {
    heatTitle.textContent =
      view.heatMetric === 'earn' ? T('games.heat.byEarn') : T('games.heat.byPlayers');
  }
}

/* —— Таблица игр без пересоздания строк ——
   Причина моргания иконок: раньше таблица перерисовывалась через innerHTML,
   и каждый <img> загружался заново. Теперь строки живут в DOM, меняются только
   порядок, видимость и числовые ячейки. */
const gamesTableState = { rows: new Map(), orderSig: '' };

function periodPlayersAvgOf(g) {
  if (!g || g.period_players == null || g.period_players === '') return null;
  const n = Number(g.period_players);
  return Number.isFinite(n) ? n : null;
}

function periodPlayersSumOf(g) {
  if (!g || g.period_players_sum == null || g.period_players_sum === '') return null;
  const n = Number(g.period_players_sum);
  return Number.isFinite(n) ? n : null;
}

/** Игроки в таблице: среднее/день или сумма дневных за период. */
function periodPlayersOf(g, mode = 'avg') {
  if (mode === 'sum') {
    const sum = periodPlayersSumOf(g);
    if (sum != null) return sum;
  }
  return periodPlayersAvgOf(g);
}

function periodEarnOf(g) {
  return Number(g && (g.period_earn != null ? g.period_earn : g.latest_earn)) || 0;
}

/** Доля строки: от выбранной метрики игроков или от дохода периода. */
function gameShareOf(g, view) {
  const metric = view && view.shareMetric === 'earn' ? 'earn' : 'players';
  if (metric === 'earn') {
    const earn = periodEarnOf(g);
    const total = Number(view.totalEarn) || 0;
    if (!(earn > 0) || !(total > 0)) return null;
    return (earn / total) * 100;
  }
  const players = periodPlayersOf(g, view && view.playersMode);
  const total = Number(view.totalPlayers) || 0;
  if (players == null || !(total > 0)) return null;
  return (players / total) * 100;
}

function heatmapById(view) {
  if (view && view.heatById instanceof Map) return view.heatById;
  const map = new Map();
  const games = (view && view.heatmap && view.heatmap.games) || [];
  games.forEach((h) => {
    if (h && h.id != null) map.set(String(h.id), h);
  });
  return map;
}

function sparkNums(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.map((v) => Number(v)).filter((n) => Number.isFinite(n));
}

/** Текущий и прошлый ряд: сначала из heatmap (окно сравнения), иначе из list_games. */
function sparkPairOf(g, view, metric) {
  const heat = heatmapById(view).get(String(g.id));
  if (metric === 'earn') {
    const cur = sparkNums((heat && heat.spark_earn) || (g && g.spark_earn));
    const prev = sparkNums(heat && heat.spark_earn_prev);
    return { cur, prev };
  }
  const cur = sparkNums((heat && heat.spark_players) || (g && g.spark_players));
  const prev = sparkNums(heat && heat.spark_players_prev);
  return { cur, prev };
}

function sparklinePath(coords) {
  if (window.FoundersCharts && typeof window.FoundersCharts.smoothPath === 'function') {
    return window.FoundersCharts.smoothPath(coords);
  }
  if (coords.length < 2) return '';
  return coords
    .map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)} ${c[1].toFixed(1)}`)
    .join(' ');
}

function sparkCoords(pts, w, h, padX, padY, min, span) {
  if (pts.length < 2) return [];
  const step = (w - padX * 2) / (pts.length - 1);
  return pts.map((y, i) => {
    const x = padX + i * step;
    const yy = h - padY - ((y - min) / span) * (h - padY * 2);
    return [x, yy];
  });
}

function sparklineSvg(values, tone = 'flat', prevValues = null, size = null) {
  const pts = (values || []).filter((n) => Number.isFinite(n));
  const prev = (prevValues || []).filter((n) => Number.isFinite(n));
  const w = (size && size.w) || 64;
  const h = (size && size.h) || 22;
  if (pts.length < 2 && prev.length < 2) {
    return `<svg class="dyn-spark is-empty" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"></svg>`;
  }
  const padX = 1;
  const padY = 3;
  const all = pts.concat(prev);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const curCoords = sparkCoords(pts, w, h, padX, padY, min, span);
  const prevCoords = sparkCoords(prev, w, h, padX, padY, min, span);
  const curLine = sparklinePath(curCoords);
  const prevLine = sparklinePath(prevCoords);
  const baseY = (h - 1).toFixed(1);
  const area =
    curCoords.length >= 2
      ? `${curLine} L${curCoords[curCoords.length - 1][0].toFixed(1)} ${baseY} L${curCoords[0][0].toFixed(
          1
        )} ${baseY} Z`
      : '';
  return `<svg class="dyn-spark is-${tone}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
    ${prevLine ? `<path class="dyn-spark-prev" d="${prevLine}" fill="none"></path>` : ''}
    ${area ? `<path class="dyn-spark-fill" d="${area}"></path>` : ''}
    ${curLine ? `<path class="dyn-spark-line" d="${curLine}" fill="none"></path>` : ''}
  </svg>`;
}

/** Динамика: % к окну сравнения + sparkline текущего и прошлого окон. */
function gameDynamicsOf(g, view) {
  const metric = view && view.dynamicsMetric === 'earn' ? 'earn' : 'players';
  const { cur: spark, prev: sparkPrev } = sparkPairOf(g, view, metric);
  const heat = heatmapById(view).get(String(g.id));
  const compareLabel = (view && view.dynamicsCompareLabel) || T('games.dyn.vsDefault');
  const metricLabel = metric === 'earn' ? T('games.common.earn') : T('games.common.players');
  if (!heat) {
    return {
      pct: null,
      metric,
      metricLabel,
      compareLabel,
      cur: null,
      prev: null,
      fmtCur: '—',
      fmtPrev: '—',
      spark,
      sparkPrev,
      tone: 'flat'
    };
  }
  const pct =
    metric === 'earn'
      ? heat.earn_delta_pct != null
        ? Number(heat.earn_delta_pct)
        : null
      : heat.players_delta_pct != null
        ? Number(heat.players_delta_pct)
        : null;
  const prev =
    metric === 'earn'
      ? heat.prev_earn != null
        ? Number(heat.prev_earn)
        : null
      : heat.prev_players != null
        ? Number(heat.prev_players)
        : null;
  const cur =
    metric === 'earn'
      ? heat.earn != null
        ? Number(heat.earn)
        : null
      : heat.players != null
        ? Number(heat.players)
        : null;
  const fmtPrev =
    metric === 'earn'
      ? prev == null
        ? '—'
        : moneyFmt(prev)
      : prev == null
        ? '—'
        : F().num(prev, 0);
  const fmtCur =
    metric === 'earn'
      ? cur == null
        ? '—'
        : moneyFmt(cur)
      : cur == null
        ? '—'
        : F().num(cur, 0);
  const tone =
    pct == null || !Number.isFinite(pct) ? 'flat' : pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat';
  return {
    pct: pct != null && Number.isFinite(pct) ? pct : null,
    metric,
    metricLabel,
    compareLabel,
    cur,
    prev,
    fmtCur,
    fmtPrev,
    spark,
    sparkPrev,
    tone
  };
}

function dynamicsPayload(dyn) {
  if (!dyn) return null;
  return {
    metric: dyn.metric || 'players',
    metricLabel: dyn.metricLabel || T('games.common.players'),
    compareLabel: dyn.compareLabel || T('games.dyn.vsDefault'),
    pct: dyn.pct,
    fmtCur: dyn.fmtCur || '—',
    fmtPrev: dyn.fmtPrev || '—'
  };
}

function dynamicsCellHtml(dyn) {
  const spark = sparklineSvg(dyn && dyn.spark, (dyn && dyn.tone) || 'flat', dyn && dyn.sparkPrev);
  const payload = dynamicsPayload(dyn);
  const dataAttr = payload
    ? ` data-dyn="${F().esc(JSON.stringify(payload))}"`
    : '';
  if (!dyn || dyn.pct == null || !Number.isFinite(dyn.pct)) {
    return `<div class="dyn-cell"${dataAttr}>${spark}<span class="dyn-pct is-none">—</span></div>`;
  }
  const cls = dyn.tone === 'up' ? 'is-up' : dyn.tone === 'down' ? 'is-down' : 'is-flat';
  const sign = dyn.pct > 0 ? '+' : '';
  return `<div class="dyn-cell"${dataAttr}>${spark}<span class="dyn-pct ${cls}">${sign}${F().num(
    dyn.pct,
    1
  )}%</span></div>`;
}

function dynamicsPopoverHtml(title, data) {
  const Charts = window.FoundersCharts;
  if (!Charts || !Charts.tipBodyHtml || !data) {
    return `<div class="chart-tooltip-date">${F().esc(title || T('games.common.dynamics'))}</div>`;
  }
  const hasDelta = data.pct != null && Number.isFinite(Number(data.pct));
  const color = data.metric === 'earn' ? '#3dd68c' : '#6ea8fe';
  const compareLabel = data.compareLabel || T('games.dyn.vsDefault');
  return Charts.tipBodyHtml({
    title: title || T('games.common.dynamics'),
    rows: [
      {
        name: data.metricLabel || (data.metric === 'earn' ? T('games.common.earn') : T('games.common.players')),
        value: data.fmtCur || '—',
        color,
        deltaPct: hasDelta ? Number(data.pct) : null,
        deltaNote: compareLabel
      },
      {
        name: T('games.dyn.was', { compare: compareLabel }),
        value: data.fmtPrev || '—',
        color: '#8a8a8a'
      },
      !hasDelta ? { name: T('games.dyn.change'), value: T('games.dyn.noBase') } : null
    ]
  });
}

function ensureDynPopover() {
  let el = document.getElementById('dynPopover');
  if (!el) {
    el = document.createElement('div');
    el.id = 'dynPopover';
    el.className = 'chart-tooltip heat-popover dyn-popover';
    el.setAttribute('hidden', '');
    document.body.appendChild(el);
  }
  return el;
}

function bindDynamicsTips() {
  const pop = ensureDynPopover();
  let hideTimer = null;
  let active = null;

  const hide = () => {
    closeHeatPopover(pop);
    active = null;
  };

  const show = (cell) => {
    let data = null;
    try {
      data = JSON.parse(cell.getAttribute('data-dyn') || 'null');
    } catch (_) {
      data = null;
    }
    if (!data) return hide();
    const row = cell.closest('tr');
    const titleEl = row && row.querySelector('.game-title');
    const title = (titleEl && titleEl.textContent) || T('games.common.dynamics');
    clearTimeout(hideTimer);
    active = cell;
    pop.innerHTML = dynamicsPopoverHtml(title, data);
    const rect = cell.getBoundingClientRect();
    const pad = 12;
    pop.style.left = '-9999px';
    pop.style.top = '0px';
    openHeatPopover(pop);
    const pw = pop.offsetWidth || 280;
    const ph = pop.offsetHeight || 120;
    let left = rect.right + 10;
    let top = rect.top + rect.height / 2 - ph / 2;
    if (left + pw > window.innerWidth - pad) left = rect.left - pw - 10;
    if (left < pad) left = Math.max(pad, window.innerWidth - pw - pad);
    if (top + ph > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - ph - pad);
    if (top < pad) top = pad;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  };

  document.addEventListener('mouseover', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    if (target.closest('#dynPopover')) {
      clearTimeout(hideTimer);
      return;
    }
    const cell = target.closest('.dyn-cell');
    if (cell && cell.hasAttribute('data-dyn')) {
      if (cell !== active) show(cell);
      else clearTimeout(hideTimer);
      return;
    }
    if (active) hideTimer = setTimeout(hide, 120);
  });

  pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pop.addEventListener('mouseleave', () => {
    hideTimer = setTimeout(hide, 80);
  });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}

function gameRowHtml(g, view) {
  const players = periodPlayersOf(g, view.playersMode);
  const earn = periodEarnOf(g);
  const share = gameShareOf(g, view);
  const avg = periodPlayersAvgOf(g);
  const per = avg > 0 ? earn / avg : null;
  const dyn = gameDynamicsOf(g, view);
  return `<tr class="click-row" data-row-id="${F().esc(String(g.id))}" data-open="${F().esc(g.id)}">
    <td class="cell-sticky"><div class="game-cell"><span class="game-icon-slot"></span><div>
                              <div class="game-title">${F().esc(g.title || T('games.common.noTitle'))}</div>
                              <div class="mono muted">ID ${F().esc(g.id)}</div>
                            </div></div></td>
    <td><span class="status-pill ${statusClass(g.status)}">${F().esc(statusLabel(g.status))}</span></td>
    <td class="cell-players">${players == null ? '—' : F().num(players, 0)}</td>
    <td><div class="share-bar"><i style="width:${share == null ? 0 : Math.min(100, share)}%"></i><span>${
      share == null ? '—' : `${F().num(share, 1)}%`
    }</span></div></td>
    <td class="cell-earn">${moneyFmt(earn)}</td>
    <td class="cell-dynamics">${dynamicsCellHtml(dyn)}</td>
    <td class="cell-per">${per == null ? '—' : moneyFmt(per)}</td>
                          </tr>`;
}

function gameIconNode(g) {
  if (g.icon_url) {
    const img = document.createElement('img');
    img.className = 'game-icon';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = g.icon_url;
    return img;
  }
  const div = document.createElement('div');
  div.className = 'game-icon placeholder';
  div.textContent = 'FA';
  return div;
}

function playersModeLabel(mode) {
  return mode === 'sum' ? T('games.table.modeSum') : T('games.table.modeAvg');
}

function shareMetricLabel(metric) {
  return metric === 'earn' ? T('games.table.shareEarn') : T('games.table.sharePlayers');
}

function dynamicsCompareShort(mode) {
  return (
    {
      prev_month: T('games.dyn.short.prev_month'),
      prev_period: T('games.dyn.short.prev_period'),
      d7: T('games.dyn.short.d7'),
      d14: T('games.dyn.short.d14'),
      d30: T('games.dyn.short.d30')
    }[mode] || T('games.dyn.vsDefault')
  );
}

function dynamicsTriggerLabel(metric, compare) {
  const m = metric === 'earn' ? T('games.dyn.metricEarnLower') : T('games.dyn.metricPlayersLower');
  return T('games.dyn.trigger', { metric: m, compare: dynamicsCompareShort(compare) });
}

function thMenuCheck() {
  return window.FoundersIcons
    ? window.FoundersIcons.svg('check', 14)
    : '<span class="th-menu-check-fallback">✓</span>';
}

function thMenuCaret() {
  return window.FoundersIcons
    ? window.FoundersIcons.svg('caret-down', 12)
    : '<span class="th-menu-caret-fallback">▾</span>';
}

function thMenuItemHtml(value, label, active) {
  return `<button type="button" class="th-menu-item ${active ? 'is-active' : ''}" role="option" data-value="${F().esc(
    value
  )}" aria-selected="${active ? 'true' : 'false'}"><span>${F().esc(label)}</span>${
    active ? `<i class="th-menu-check">${thMenuCheck()}</i>` : ''
  }</button>`;
}

function closeAllThMenus(root) {
  const scope = root || document;
  scope.querySelectorAll('.th-menu.is-open').forEach((menu) => {
    menu.classList.remove('is-open');
    menu.hidden = true;
  });
  scope.querySelectorAll('.th-menu-trigger[aria-expanded="true"]').forEach((btn) => {
    btn.setAttribute('aria-expanded', 'false');
  });
}

function positionThMenu(trigger, menu) {
  const r = trigger.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  menu.style.left = '0px';
  menu.style.minWidth = `${Math.max(168, Math.round(r.width))}px`;
  menu.hidden = false;
  menu.classList.add('is-open');
  const mw = menu.offsetWidth || 200;
  const left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8);
  menu.style.left = `${Math.round(left)}px`;
  trigger.setAttribute('aria-expanded', 'true');
}

function syncGamesTable(home, view) {
  const wrap = home.querySelector('#gamesTableWrap');
  if (!wrap) return;

  let table = wrap.querySelector('table.games-table');
  // Старая шапка с native <select> — пересоздаём один раз.
  if (table && !table.querySelector('#dynamicsMenu')) {
    wrap.innerHTML = '';
    table = null;
    gamesTableState.rows.clear();
    gamesTableState.orderSig = '';
  }
  if (!table) {
    const cmp = view.heatCompare || 'prev_month';
    const check = thMenuCheck();
    const caret = thMenuCaret();
    wrap.innerHTML = `<div class="games-table-scroll">
      <table class="games-table dense">
      <thead><tr>
        <th class="cell-sticky" data-sort="title">${T('games.table.colGame')}</th>
        <th data-sort="status">${T('games.table.colStatus')}</th>
        <th class="th-metric" data-sort="players">
          <div class="th-metric-top">${T('games.common.players')}${view.sortKey === 'players' ? (view.sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</div>
          <button type="button" class="th-menu-trigger" id="playersModeSelect" aria-haspopup="listbox" aria-expanded="false" title="${T('games.table.playersModeTitle')}">
            <span class="th-menu-label">${F().esc(playersModeLabel(view.playersMode))}</span>
            <span class="th-menu-caret" aria-hidden="true">${caret}</span>
          </button>
          <div class="th-menu" id="playersModeMenu" hidden role="listbox">
            ${thMenuItemHtml('avg', T('games.table.menuAvg'), view.playersMode === 'avg')}
            ${thMenuItemHtml('sum', T('games.table.menuSum'), view.playersMode === 'sum')}
          </div>
        </th>
        <th class="th-metric" data-sort="share">
          <div class="th-metric-top">${T('games.table.colShare')}${view.sortKey === 'share' ? (view.sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</div>
          <button type="button" class="th-menu-trigger" id="shareMetricSelect" aria-haspopup="listbox" aria-expanded="false" title="${T('games.table.shareMetricTitle')}">
            <span class="th-menu-label">${F().esc(shareMetricLabel(view.shareMetric))}</span>
            <span class="th-menu-caret" aria-hidden="true">${caret}</span>
          </button>
          <div class="th-menu" id="shareMetricMenu" hidden role="listbox">
            ${thMenuItemHtml('players', T('games.table.menuFromPlayers'), view.shareMetric === 'players')}
            ${thMenuItemHtml('earn', T('games.table.menuFromEarn'), view.shareMetric === 'earn')}
          </div>
        </th>
        <th data-sort="earn" title="${T('games.table.colEarnTitle')}">${T('games.common.earn')}</th>
        <th class="th-metric th-dynamics" data-sort="dynamics">
          <div class="th-metric-top">${T('games.common.dynamics')}${view.sortKey === 'dynamics' ? (view.sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</div>
          <button type="button" class="th-menu-trigger" id="dynamicsMenuTrigger" aria-haspopup="listbox" aria-expanded="false" title="${T('games.table.dynamicsTitle')}">
            <span class="th-menu-label">${F().esc(
              dynamicsTriggerLabel(view.dynamicsMetric, cmp)
            )}</span>
            <span class="th-menu-caret" aria-hidden="true">${caret}</span>
          </button>
          <div class="th-menu th-menu-wide" id="dynamicsMenu" hidden role="listbox">
            <div class="th-menu-cap">${T('games.table.capShow')}</div>
            <button type="button" class="th-menu-item ${
              view.dynamicsMetric === 'players' ? 'is-active' : ''
            }" data-field="metric" data-value="players" role="option" aria-selected="${
              view.dynamicsMetric === 'players' ? 'true' : 'false'
            }"><span>${T('games.common.players')}</span>${
              view.dynamicsMetric === 'players' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
            <button type="button" class="th-menu-item ${
              view.dynamicsMetric === 'earn' ? 'is-active' : ''
            }" data-field="metric" data-value="earn" role="option" aria-selected="${
              view.dynamicsMetric === 'earn' ? 'true' : 'false'
            }"><span>${T('games.common.earn')}</span>${
              view.dynamicsMetric === 'earn' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
            <div class="th-menu-cap">${T('games.table.capCompareWith')}</div>
            <button type="button" class="th-menu-item ${
              cmp === 'prev_month' ? 'is-active' : ''
            }" data-field="compare" data-value="prev_month" role="option" aria-selected="${
              cmp === 'prev_month' ? 'true' : 'false'
            }"><span>${T('games.table.vs.prev_month')}</span>${
              cmp === 'prev_month' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
            <button type="button" class="th-menu-item ${
              cmp === 'prev_period' ? 'is-active' : ''
            }" data-field="compare" data-value="prev_period" role="option" aria-selected="${
              cmp === 'prev_period' ? 'true' : 'false'
            }"><span>${T('games.table.vs.prev_period')}</span>${
              cmp === 'prev_period' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
            <button type="button" class="th-menu-item ${
              cmp === 'd7' ? 'is-active' : ''
            }" data-field="compare" data-value="d7" role="option" aria-selected="${
              cmp === 'd7' ? 'true' : 'false'
            }"><span>${T('games.table.vs.d7')}</span>${
              cmp === 'd7' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
            <button type="button" class="th-menu-item ${
              cmp === 'd14' ? 'is-active' : ''
            }" data-field="compare" data-value="d14" role="option" aria-selected="${
              cmp === 'd14' ? 'true' : 'false'
            }"><span>${T('games.table.vs.d14')}</span>${
              cmp === 'd14' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
            <button type="button" class="th-menu-item ${
              cmp === 'd30' ? 'is-active' : ''
            }" data-field="compare" data-value="d30" role="option" aria-selected="${
              cmp === 'd30' ? 'true' : 'false'
            }"><span>${T('games.table.vs.d30')}</span>${
              cmp === 'd30' ? `<i class="th-menu-check">${check}</i>` : ''
            }</button>
          </div>
        </th>
        <th title="${T('games.table.colPerPlayerTitle')}">${T('games.table.colPerPlayer')}</th>
      </tr></thead>
      <tbody></tbody>
    </table>
        </div>
    <div class="empty" id="gamesEmpty" hidden></div>`;
    table = wrap.querySelector('table.games-table');
    gamesTableState.rows.clear();
  }

  const tbody = table.querySelector('tbody');
  const empty = wrap.querySelector('#gamesEmpty');

  // создавала новые <img> и иконки мигали.
  const template = document.createElement('tbody');
  const wanted = new Set();

  view.ordered.forEach((g) => {
    const id = String(g.id);
    wanted.add(id);
    const iconUrl = g.icon_url || '';
    let row = gamesTableState.rows.get(id);

    if (!row) {
      template.innerHTML = gameRowHtml(g, view);
      row = template.firstElementChild;
      row.querySelector('.game-icon-slot').replaceWith(gameIconNode(g));
      row.dataset.icon = iconUrl;
      gamesTableState.rows.set(id, row);
      tbody.appendChild(row);
    } else {
      // Числа
      const players = periodPlayersOf(g, view.playersMode);
      const earn = periodEarnOf(g);
      const share = gameShareOf(g, view);
      const avg = periodPlayersAvgOf(g);
      const per = avg > 0 ? earn / avg : null;
      const setText = (sel, text) => {
        const el = row.querySelector(sel);
        if (el && el.textContent !== text) el.textContent = text;
      };
      setText('.cell-players', players == null ? '—' : F().num(players, 0));
      setText('.cell-earn', moneyFmt(earn));
      setText('.cell-per', per == null ? '—' : moneyFmt(per));
      const bar = row.querySelector('.share-bar i');
      if (bar) bar.style.width = `${share == null ? 0 : Math.min(100, share)}%`;
      const shareText = row.querySelector('.share-bar span');
      if (shareText) shareText.textContent = share == null ? '—' : `${F().num(share, 1)}%`;
      const dynCell = row.querySelector('.cell-dynamics');
      if (dynCell) {
        const next = dynamicsCellHtml(gameDynamicsOf(g, view));
        if (dynCell.innerHTML !== next) dynCell.innerHTML = next;
      }

      // Название, статус и иконка — только при фактическом изменении
      const title = g.title || T('games.common.noTitle');
      const titleEl = row.querySelector('.game-title');
      if (titleEl && titleEl.textContent !== title) titleEl.textContent = title;

      const pill = row.querySelector('.status-pill');
      const pillClass = `status-pill ${statusClass(g.status)}`;
      const pillText = statusLabel(g.status);
      if (pill) {
        if (pill.className !== pillClass) pill.className = pillClass;
        if (pill.textContent !== pillText) pill.textContent = pillText;
      }
      if (row.dataset.icon !== iconUrl) {
        const cell = row.querySelector('.game-cell');
        const old = cell && cell.querySelector('.game-icon');
        const next = gameIconNode(g);
        if (old) old.replaceWith(next);
        else if (cell) cell.prepend(next);
        row.dataset.icon = iconUrl;
      }
    }

    const shouldHide = !view.visibleIds.has(id);
    if (row.hidden !== shouldHide) row.hidden = shouldHide;
  });

  // Удаляем строки игр, которых больше нет в данных
  for (const [id, row] of gamesTableState.rows) {
    if (!wanted.has(id)) {
      row.remove();
      gamesTableState.rows.delete(id);
    }
  }

  const orderSig = view.ordered
    .map((g) => String(g.id))
    .filter((id) => view.visibleIds.has(id))
    .join(',');
  if (gamesTableState.orderSig !== orderSig) {
    view.ordered.forEach((g) => {
      const row = gamesTableState.rows.get(String(g.id));
      if (row) tbody.appendChild(row);
    });
    gamesTableState.orderSig = orderSig;
  }

  const marks = { title: '', status: '', players: '', share: '', earn: '', dynamics: '' };
  if (view.sortKey in marks) marks[view.sortKey] = view.sortDir === 'asc' ? ' ↑' : ' ↓';
  table.querySelectorAll('th[data-sort="title"], th[data-sort="status"], th[data-sort="earn"]').forEach((th) => {
    const key = th.dataset.sort;
    const labels = {
      title: T('games.table.colGame'),
      status: T('games.table.colStatus'),
      earn: T('games.common.earn')
    };
    const next = `${labels[key]}${marks[key] || ''}`;
    if (th.textContent !== next) th.textContent = next;
  });
  const setMetricTop = (sel, label, mark) => {
    const el = table.querySelector(sel);
    if (!el) return;
    const next = `${label}${mark || ''}`;
    if (el.textContent !== next) el.textContent = next;
  };
  setMetricTop('th[data-sort="players"] .th-metric-top', T('games.common.players'), marks.players);
  setMetricTop('th[data-sort="share"] .th-metric-top', T('games.table.colShare'), marks.share);
  setMetricTop('th[data-sort="dynamics"] .th-metric-top', T('games.common.dynamics'), marks.dynamics);

  const syncTriggerLabel = (sel, text) => {
    const el = table.querySelector(`${sel} .th-menu-label`);
    if (el && el.textContent !== text) el.textContent = text;
  };
  const syncMenuItems = (menuSel, value, field) => {
    const menu = table.querySelector(menuSel);
    if (!menu) return;
    const check = thMenuCheck();
    menu.querySelectorAll('.th-menu-item').forEach((btn) => {
      if (field && btn.dataset.field !== field) return;
      const on = btn.dataset.value === value;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      const mark = btn.querySelector('.th-menu-check');
      if (on && !mark) {
        const i = document.createElement('i');
        i.className = 'th-menu-check';
        i.innerHTML = check;
        btn.appendChild(i);
      } else if (!on && mark) {
        mark.remove();
      }
    });
  };
  const cmp = view.heatCompare || 'prev_month';
  syncTriggerLabel('#playersModeSelect', playersModeLabel(view.playersMode));
  syncTriggerLabel('#shareMetricSelect', shareMetricLabel(view.shareMetric));
  syncTriggerLabel(
    '#dynamicsMenuTrigger',
    dynamicsTriggerLabel(view.dynamicsMetric, cmp)
  );
  syncMenuItems('#playersModeMenu', view.playersMode);
  syncMenuItems('#shareMetricMenu', view.shareMetric);
  syncMenuItems('#dynamicsMenu', view.dynamicsMetric, 'metric');
  syncMenuItems('#dynamicsMenu', cmp, 'compare');

  const visibleCount = view.visibleIds.size;
  table.hidden = visibleCount === 0;
  if (empty) {
    empty.hidden = visibleCount !== 0;
    empty.textContent = view.publishedOnly ? T('games.table.noPublished') : T('games.table.noSearch');
  }
}

function paintEarnChart(home, view) {
  const panel = home.querySelector('.panel-earn-days');
  if (!panel) return;

  const sub = panel.querySelector('.earn-days-sub');
  if (sub && view.maxMonthMeta != null) sub.textContent = view.maxMonthMeta;

  if (earnPanelCache.sig === view.earnSig && earnPanelCache.node === panel) return;

  const host = panel.querySelector('#homeEarnBars');
  if (!host) return;

  if (view.monthBars.some((d) => d.value > 0)) {
    const grid = home.querySelector('.home-grid-2');
    const raw = grid ? getComputedStyle(grid).getPropertyValue('--home-map-h') : '';
    const h = Math.max(200, Math.round(parseFloat(raw)) || 400);
    C().bars(host, view.monthBars, {
        dense: true,
        endLabelsOnly: true,
        hideValueLabels: true,
        height: h,
        color: '#1e7a50',
        highlightColor: '#3dd68c',
        showAvg: true,
        compareLine: true,
        compareColor: '#8a8a8a',
        formatY: (n) => (Number.isFinite(n) ? F().money(n, 0) : '')
      });
  } else {
    host.innerHTML =
      `<div class="empty">${T('games.earn.noMonths')}<br><button type="button" class="earn-empty-add" data-open-tax>${T('games.earn.openTax')}</button></div>`;
  }

  earnPanelCache.sig = view.earnSig;
  earnPanelCache.node = panel;
}

function closeAccountPop(root) {
  const scope = root || document;
  scope.querySelectorAll('.account-pop').forEach((pop) => {
    pop.hidden = true;
  });
  scope.querySelectorAll('[data-account-chip]').forEach((btn) => {
    btn.setAttribute('aria-expanded', 'false');
  });
}

function bindAccountChip(root, data) {
  const wrap = root.querySelector('.account-chip-wrap');
  if (!wrap) return;
  const chip = wrap.querySelector('[data-account-chip]');
  const pop = wrap.querySelector('#accountPop');
  if (!chip || !pop) return;
  if (!chip.classList.contains('is-switchable')) return;

  chip.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const open = !pop.hidden;
    closeAccountPop(root);
    if (!open) {
      pop.hidden = false;
      chip.setAttribute('aria-expanded', 'true');
    }
  };

  pop.querySelectorAll('[data-account-id]').forEach((item) => {
    item.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const nextId = String(item.dataset.accountId || '');
      const cur = String((data && data.activeAccountId) || '');
      closeAccountPop(root);
      if (!nextId || nextId === cur) return;
      writeStoredAccountId(nextId);
      if (window.FoundersApp && window.FoundersApp.state) {
        window.FoundersApp.state.activeAccountId = nextId;
      }
      invalidateGamesModels();
      if (window.FoundersApp && typeof window.FoundersApp.loading === 'function') {
        window.FoundersApp.loading(true);
      }
      try {
        await window.FoundersPages.games(root, {
          ...window.FoundersApp.state,
          forceReload: true,
          animateNumbers: false,
          animateHeatmap: false
        });
        if (window.FoundersPages.periodControls) {
          const mount = document.getElementById('periodMount');
          if (mount) {
            await window.FoundersPages.periodControls(
              mount,
              window.FoundersApp.state.period || 'month'
            );
          }
        }
      } finally {
        if (window.FoundersApp && typeof window.FoundersApp.loading === 'function') {
          window.FoundersApp.loading(false);
        }
      }
    };
  });

  if (!bindAccountChip._docBound) {
    document.addEventListener('click', () => closeAccountPop());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAccountPop();
    });
    bindAccountChip._docBound = true;
  }
}

/** Обработчики страницы «Игры»: переназначаются на каждом рендере (идемпотентно). */
function bindGamesUi(root, data) {
  const rerender = () => window.FoundersPages.games(root, window.FoundersApp.state);
  bindAccountChip(root, data);

    root.querySelectorAll('[data-heat-metric]').forEach((btn) => {
      btn.onclick = () => {
        window.FoundersApp.setHeatMetric(btn.dataset.heatMetric);
        root.querySelectorAll('[data-heat-metric]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        const seg = btn.closest('.seg');
        if (seg && window.FoundersMotion && window.FoundersMotion.flush) {
          window.FoundersMotion.flush(seg);
        }
        requestAnimationFrame(() => {
          requestAnimationFrame(() => updateHeatmapOnly(root, window.FoundersApp.state));
        });
      };
    });

    const rememberSearch = () => {
      const search = root.querySelector('#gamesSearch');
      if (search) window.FoundersApp.state.gamesQuery = search.value;
    };

    const bindThMenu = (triggerSel, menuSel, onPick) => {
      const trigger = root.querySelector(triggerSel);
      const menu = root.querySelector(menuSel);
      if (!trigger || !menu) return;
      trigger.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const open = menu.classList.contains('is-open');
        closeAllThMenus(root);
        if (!open) positionThMenu(trigger, menu);
      };
      menu.onclick = (e) => e.stopPropagation();
      menu.querySelectorAll('.th-menu-item').forEach((item) => {
        item.onclick = (e) => {
          e.stopPropagation();
          onPick(item.dataset.value, item.dataset.field || null);
          closeAllThMenus(root);
          rememberSearch();
          rerender();
        };
      });
    };

    bindThMenu('#playersModeSelect', '#playersModeMenu', (v) =>
      window.FoundersApp.setGamesPlayersMode(v)
    );
    bindThMenu('#shareMetricSelect', '#shareMetricMenu', (v) =>
      window.FoundersApp.setGamesShareMetric(v)
    );
    bindThMenu('#dynamicsMenuTrigger', '#dynamicsMenu', (v, field) => {
      if (field === 'metric') {
        window.FoundersApp.setGamesDynamicsMetric(v);
        return;
      }
      window.FoundersApp.setHeatCompare(v);
      root.querySelectorAll('[data-heat-compare]').forEach((b) => {
        b.classList.toggle('active', b.dataset.heatCompare === v);
      });
    });

    if (!bindGamesUi._thMenuDocBound) {
      document.addEventListener('click', () => closeAllThMenus());
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllThMenus();
      });
      window.addEventListener(
        'scroll',
        () => closeAllThMenus(),
        true
      );
      bindGamesUi._thMenuDocBound = true;
    }

    root.querySelectorAll('[data-heat-compare]').forEach((btn) => {
      btn.onclick = () => {
        window.FoundersApp.setHeatCompare(btn.dataset.heatCompare);
        root.querySelectorAll('[data-heat-compare]').forEach((b) => {
          b.classList.toggle('active', b === btn);
        });
        rerender();
      };
    });

  const hideInactive = root.querySelector('#hideInactive');
  if (hideInactive) {
    hideInactive.onclick = () => {
      const app = window.FoundersApp;
      app.setPublishedOnly(!app.state.gamesPublishedOnly);
      const search = root.querySelector('#gamesSearch');
      if (search) app.state.gamesQuery = search.value;
      // Таблица обновляется на месте: строки не пересоздаются, иконки не мигают.
      rerender();
    };
  }

  const search = root.querySelector('#gamesSearch');
    if (search) {
      search.oninput = () => {
        window.FoundersApp.state.gamesQuery = search.value;
      rerender();
      const next = root.querySelector('#gamesSearch');
      // После перерисовки таблицы поле не пересоздаётся, но фокус сохраняем на всякий случай
      if (next && next !== search) {
        next.focus();
        next.setSelectionRange(next.value.length, next.value.length);
      }
    };
  }

    root.querySelectorAll('th[data-sort]').forEach((th) => {
      th.style.cursor = 'pointer';
      th.onclick = (e) => {
        if (e.target.closest('.th-menu-trigger, .th-menu')) return;
        const st = window.FoundersApp.state;
        const key = th.dataset.sort;
        if (st.gamesSortKey === key) st.gamesSortDir = st.gamesSortDir === 'asc' ? 'desc' : 'asc';
        else {
          st.gamesSortKey = key;
          st.gamesSortDir = key === 'title' || key === 'status' ? 'asc' : 'desc';
        }
        rerender();
      };
    });

  // Плитки тепловой карты обрабатывает bindHeatmapUi («Ещё» открывает список),
  root.querySelectorAll('[data-open]:not(.heatmap-cell)').forEach((el) => {
      el.onclick = (e) => {
        e.stopPropagation();
      const host = el.closest('[data-open]') || el;
      const id = el.dataset.open || (host && host.dataset.open);
        if (id) window.FoundersApp.openGame(id);
      };
    });

  root.querySelectorAll('[data-open-tax]').forEach((btn) => {
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTaxPage();
    };
  });
}

// Тултип для свечей вешаем один раз: обработчик делегирован на document.
bindDaysTips();
bindDynamicsTips();

/* Сравнение игр ----------------------------------------------------------- */

const COMPARE_COLORS = ['#3dd68c', '#a78bfa', '#f0a45d', '#5b8def', '#f472b6', '#38bdf8', '#fbbf24', '#c084fc'];

function compareInitials(title) {
  return String(title || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';
}

function compareGameIconHtml(game, color) {
  const title = game.title || game.id || '';
  if (game.icon_url) {
    return `<img class="compare-icon" src="${F().esc(game.icon_url)}" alt="" loading="lazy" />`;
  }
  return `<span class="compare-icon is-ph" style="--cmp-color:${F().esc(color)}">${F().esc(
    compareInitials(title)
  )}</span>`;
}

function setCompareIds(ids) {
  const next = [...new Set((ids || []).map(String))];
  window.FoundersApp.state.compareIds = next;
  try {
    localStorage.setItem('fa.compareIds', JSON.stringify(next));
  } catch (_) {}
  return next;
}

function compareMetricDefs(period) {
  const earnTitle = T('games.compare.earnPeriod', { period: F().periodNoun(period) });
  return [
    {
      id: 'audience',
      label: T('games.compare.audience'),
      chartTitle: T('games.compare.audienceChart'),
      charts: [
        { id: 'players', label: T('games.common.players'), seriesKey: 'players', fmt: 'num0' },
        { id: 'play_time', label: T('games.compare.playTime'), seriesKey: 'play_time', fmt: 'num' }
      ],
      rows: [
        { key: 'players', label: T('games.kpi.playersPerDay'), fmt: 'num0', better: 'max' },
        { key: 'play_time_per_player', label: T('games.compare.playTimeMin'), fmt: 'num', better: 'max' }
      ]
    },
    {
      id: 'quality',
      label: T('games.compare.quality'),
      chartTitle: T('games.compare.qualityChart'),
      charts: [
        { id: 'game_ready', label: T('games.compare.gameReady'), seriesKey: 'game_ready', fmt: 'num' },
        { id: 'rating_ru', label: T('games.compare.ratingCis'), seriesKey: 'rating_ru', fmt: 'num0' },
        { id: 'rating_world', label: T('games.compare.ratingWorld'), seriesKey: 'rating_world', fmt: 'num0' }
      ],
      rows: [
        { key: 'game_ready', label: T('games.compare.gameReadySec'), fmt: 'num', better: 'min' },
        { key: 'rating_ru', label: T('games.compare.ratingRuFull'), fmt: 'num0', better: 'max' },
        { key: 'rating_world', label: T('games.compare.ratingWorldFull'), fmt: 'num0', better: 'max' }
      ]
    },
    {
      id: 'earn',
      label: earnTitle,
      chartTitle: T('games.compare.earnChart'),
      charts: [
        { id: 'earn', label: T('games.compare.earnByDay'), seriesKey: 'earn', fmt: 'money' },
        { id: 'arpdau', label: T('games.compare.arpdau'), seriesKey: 'arpdau', fmt: 'money' }
      ],
      rows: [
        { key: 'earn', label: T('games.common.earn'), fmt: 'money', better: 'max' },
        { key: 'earn_per_day', label: T('games.compare.earnPerDay'), fmt: 'money', better: 'max' },
        {
          key: 'arpdau',
          label: T('games.compare.arpdauRef'),
          fmt: 'money',
          better: 'max'
        },
        {
          key: 'earn_per_player',
          label: T('games.kpi.earnPerPlayer'),
          fmt: 'money',
          better: 'max'
        }
      ]
    }
  ];
}

function loadCompareExpand() {
  try {
    const raw = localStorage.getItem('fa.compareExpand');
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === 'object') return obj;
  } catch (_) {}
  return { audience: true };
}

function saveCompareExpand(map) {
  try {
    localStorage.setItem('fa.compareExpand', JSON.stringify(map || {}));
  } catch (_) {}
}

function loadCompareChartMetric() {
  try {
    const raw = localStorage.getItem('fa.compareChartMetric');
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === 'object') return obj;
  } catch (_) {}
  return {};
}

function saveCompareChartMetric(map) {
  try {
    localStorage.setItem('fa.compareChartMetric', JSON.stringify(map || {}));
  } catch (_) {}
}

function compareFmt(value, fmt) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  if (fmt === 'money') return moneyFmt(value);
  if (fmt === 'num0') return F().num(value, 0);
  return F().num(value);
}

function compareBestIndex(games, key, better) {
  let best = -1;
  let bestVal = null;
  games.forEach((g, i) => {
    const v = Number(g[key]);
    if (!Number.isFinite(v)) return;
    if (bestVal == null) {
      best = i;
      bestVal = v;
      return;
    }
    if (better === 'min' ? v < bestVal : v > bestVal) {
      best = i;
      bestVal = v;
    }
  });
  return best;
}

function compareBarPct(game, games, key, better) {
  const vals = games.map((g) => Number(g[key])).filter((v) => Number.isFinite(v));
  if (!vals.length) return 0;
  const v = Number(game[key]);
  if (!Number.isFinite(v)) return 0;
  if (better === 'min') {
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    if (max === min) return 100;
    return Math.max(8, ((max - v) / (max - min)) * 100);
  }
  const max = Math.max(...vals.map((x) => Math.abs(x)));
  if (max <= 0) return 0;
  return Math.max(8, (Math.abs(v) / max) * 100);
}

function compareInsights(games, colors) {
  if (!games || games.length < 2) return [];
  const items = [];
  const by = (key, better = 'max') => {
    const idx = compareBestIndex(games, key, better);
    return idx >= 0 ? { game: games[idx], color: colors[idx], idx } : null;
  };

  const earn = by('earn');
  if (earn && Number(earn.game.earn) > 0) {
    items.push({
      color: earn.color,
      text: T('games.compare.insight.topEarn', {
        title: earn.game.title || earn.game.id,
        value: moneyFmt(earn.game.earn)
      })
    });
  }

  const ready = by('game_ready', 'min');
  if (ready && Number(ready.game.game_ready) > 0) {
    items.push({
      color: ready.color,
      text: T('games.compare.insight.fastest', {
        title: ready.game.title || ready.game.id,
        sec: F().num(ready.game.game_ready)
      })
    });
  }

  const players = by('players');
  const earnLow = (() => {
    const idx = compareBestIndex(games, 'earn', 'min');
    return idx >= 0 ? { game: games[idx], color: colors[idx], idx } : null;
  })();
  if (
    players &&
    earnLow &&
    players.idx !== earnLow.idx &&
    Number(players.game.players) > 0 &&
    Number(earnLow.game.earn) >= 0
  ) {
    items.push({
      color: players.color,
      text: T('games.compare.insight.audienceNoEarn', { title: players.game.title || players.game.id })
    });
  }

  const arpdau = by('arpdau');
  if (arpdau && Number(arpdau.game.arpdau) > 0) {
    items.push({
      color: arpdau.color,
      text: T('games.compare.insight.topArpdau', {
        title: arpdau.game.title || arpdau.game.id,
        value: moneyFmt(arpdau.game.arpdau)
      })
    });
  }

  const ourArpu = by('earn_per_player');
  if (
    ourArpu &&
    Number(ourArpu.game.earn_per_player) > 0 &&
    (!arpdau || ourArpu.idx !== arpdau.idx)
  ) {
    items.push({
      color: ourArpu.color,
      text: T('games.compare.insight.topOwnArpu', {
        title: ourArpu.game.title || ourArpu.game.id,
        value: moneyFmt(ourArpu.game.earn_per_player)
      })
    });
  }

  const rating = by('rating_ru');
  if (rating && Number(rating.game.rating_ru) > 0) {
    items.push({
      color: rating.color,
      text: T('games.compare.insight.topRating', { title: rating.game.title || rating.game.id })
    });
  }

  return items.slice(0, 5);
}

function compareTableHtml(games, period, colors, expandMap, chartMetricMap) {
  if (!games.length) {
    return `<div class="compare-empty muted">${T('games.compare.pickAtLeast2')}</div>`;
  }
  const groups = compareMetricDefs(period);
  const colSpan = games.length + 1;
  const head = `
    <tr>
      <th class="compare-metric-col">${T('games.compare.metricCol')}</th>
      ${games
        .map((g, i) => {
          const color = colors[i];
          return `<th class="compare-game-col" style="--cmp-color:${F().esc(color)}">
            <div class="compare-col-head">
              ${compareGameIconHtml(g, color)}
              <div class="compare-col-copy">
                <div class="compare-col-title">${F().esc(g.title || g.id)}</div>
                <div class="compare-col-id muted">ID ${F().esc(String(g.id))}</div>
              </div>
              <button type="button" class="compare-col-x" data-compare-remove="${F().esc(
                String(g.id)
              )}" aria-label="${T('games.compare.remove')}">×</button>
            </div>
          </th>`;
        })
        .join('')}
    </tr>`;

  const body = groups
    .map((group) => {
      const open = !!(expandMap && expandMap[group.id]);
      const activeChart =
        (chartMetricMap && chartMetricMap[group.id]) ||
        (group.charts && group.charts[0] && group.charts[0].id) ||
        '';
      const segs = (group.charts || [])
        .map(
          (c) =>
            `<button type="button" class="seg-btn ${
              c.id === activeChart ? 'active' : ''
            }" data-compare-chart-metric="${F().esc(group.id)}" data-metric="${F().esc(
              c.id
            )}">${F().esc(c.label)}</button>`
        )
        .join('');
      const groupRow = `<tr class="compare-group-row">
        <td class="compare-metric-label compare-group-cell">
          <div class="compare-group-cell-inner">
            <span class="compare-group-label">${F().esc(group.label)}</span>
            <button type="button" class="compare-expand-btn ${open ? 'is-open' : ''}" data-compare-expand="${F().esc(
              group.id
            )}" aria-expanded="${open ? 'true' : 'false'}">
              <span>${open ? T('games.compare.hide') : T('games.compare.chart')}</span>
              <i class="ph ph-caret-down" aria-hidden="true"></i>
            </button>
          </div>
        </td>
        <td class="compare-group-actions" colspan="${games.length}"></td>
      </tr>`;
      const rows = group.rows
        .map((row) => {
          const best = compareBestIndex(games, row.key, row.better);
          const cells = games
            .map((g, i) => {
              const raw = g[row.key];
              const text = compareFmt(raw, row.fmt);
              const isBest = best === i && raw != null && Number.isFinite(Number(raw));
              const pct = compareBarPct(g, games, row.key, row.better);
              const color = colors[i];
              return `<td class="compare-val-cell ${isBest ? 'is-best' : ''}" style="--cmp-color:${F().esc(
                color
              )}">
                <div class="compare-val-row">
                  <span class="compare-val">${text}</span>
                  ${isBest ? `<span class="compare-best">${T('games.compare.best')}</span>` : ''}
                </div>
                <div class="rating-bar compare-bar"><i style="width:${pct.toFixed(
                  1
                )}%;background:${F().esc(color)}"></i></div>
              </td>`;
            })
            .join('');
          return `<tr class="compare-metric-row">
            <td class="compare-metric-label">${F().esc(row.label)}</td>
            ${cells}
          </tr>`;
        })
        .join('');
      const chartRow = `<tr class="compare-chart-row ${open ? 'is-open' : ''}" data-compare-chart-row="${F().esc(
        group.id
      )}" ${open ? '' : 'hidden'}>
        <td colspan="${colSpan}">
          <div class="compare-section-chart compare-sticky-pane">
            <div class="compare-section-chart-head">
              <div class="compare-section-chart-copy">
                <div class="compare-section-chart-title">${F().esc(group.chartTitle || T('games.compare.periodChartTitle'))}</div>
                ${
                  (group.charts || []).length > 1
                    ? `<div class="seg seg--compact" data-thumb-key="compare-chart-${F().esc(
                        group.id
                      )}" role="group" aria-label="${T('games.compare.chartMetricAria')}">${segs}</div>`
                    : ''
                }
              </div>
              <div class="sum-chart-pills" data-compare-chart-tools="${F().esc(group.id)}"></div>
            </div>
            <div class="compare-section-chart-mount" data-compare-chart-mount="${F().esc(
              group.id
            )}"></div>
          </div>
        </td>
      </tr>`;
      return groupRow + rows + chartRow;
    })
    .join('');

  return `<div class="compare-table-wrap"><table class="compare-table">
    <thead>${head}</thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function compareChipsHtml(selectedGames, colors) {
  return selectedGames
    .map((g, i) => {
      const color = colors[i];
      return `<div class="compare-chip" style="--cmp-color:${F().esc(color)}">
        ${compareGameIconHtml(g, color)}
        <span class="compare-chip-title">${F().esc(g.title || g.id)}</span>
        <button type="button" class="compare-chip-x" data-compare-remove="${F().esc(
          String(g.id)
        )}" aria-label="${T('games.compare.remove')}">×</button>
      </div>`;
    })
    .join('');
}

function comparePickerHtml(allGames, selectedIds) {
  const selected = new Set(selectedIds.map(String));
  const sorted = [...(allGames || [])].sort((a, b) => {
    const aSel = selected.has(String(a.id)) ? 1 : 0;
    const bSel = selected.has(String(b.id)) ? 1 : 0;
    if (aSel !== bSel) return bSel - aSel;
    const ap = Number(a.period_players != null ? a.period_players : a.latest_players) || 0;
    const bp = Number(b.period_players != null ? b.period_players : b.latest_players) || 0;
    if (bp !== ap) return bp - ap;
    return String(a.title || a.id).localeCompare(String(b.title || b.id), window.NamiI18n.locale);
  });
  const rows =
    sorted
      .map((g) => {
        const id = String(g.id);
        const checked = selected.has(id);
        const players = g.period_players != null ? g.period_players : g.latest_players;
        const meta =
          players != null && Number.isFinite(Number(players))
            ? T('games.compare.perDay', { count: F().num(players, 0) })
            : '';
        return `<label class="compare-pick-row ${checked ? 'is-checked' : ''}">
          <input type="checkbox" value="${F().esc(id)}" ${checked ? 'checked' : ''}/>
          ${compareGameIconHtml(g, '#3dd68c')}
          <span class="compare-pick-title">${F().esc(g.title || g.id)}</span>
          ${meta ? `<span class="compare-pick-meta">${F().esc(meta)}</span>` : '<span class="compare-pick-meta"></span>'}
        </label>`;
      })
      .join('') || `<div class="empty">${T('games.compare.noGames')}</div>`;

  return `<div class="compare-picker" id="comparePicker" hidden>
    <div class="compare-picker-search">
      <input type="search" id="comparePickSearch" class="search compact" placeholder="${T('games.compare.searchPlaceholder')}" autocomplete="off" />
    </div>
    <div class="compare-picker-list" id="comparePickList">${rows}</div>
  </div>`;
}

function compareSeriesPoints(game, seriesKey) {
  const fromSeries = game.series && game.series[seriesKey];
  const fallback = seriesKey === 'players' ? game.players_series : null;
  const raw = fromSeries || fallback || [];
  return raw
    .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function paintCompareSectionChart(mount, games, colors, chartDef, toolsHost) {
  if (!mount || !chartDef) return;
  if (!games.length) {
    mount.innerHTML = `<div class="empty">${T('games.compare.noChartData')}</div>`;
    return;
  }
  const series = games.map((g, i) => ({
    id: g.id,
    name: g.title || g.id,
    color: colors[i],
    data: compareSeriesPoints(g, chartDef.seriesKey)
  }));
  if (!series.some((s) => s.data.length)) {
    mount.innerHTML = `<div class="empty">${T('games.compare.noSeries', { label: F().esc(chartDef.label) })}</div>`;
    if (toolsHost) toolsHost.replaceChildren();
    return;
  }
  const fmtY =
    chartDef.fmt === 'money'
      ? (v) => moneyFmt(v)
      : chartDef.fmt === 'num0'
        ? (v) => F().num(v, 0)
        : (v) => F().num(v);
  C().line(mount, series, {
    height: Math.max(240, Math.min(340, Math.round(window.innerHeight * 0.34))),
    formatY: fmtY,
    colors,
    brush: true,
    avgToggle: true,
    showAvg: false,
    weekendToggle: true,
    showWeekend: true,
    tipNote: false,
    analysis: false,
    dots: false,
    normalizeX: true,
    nonNegative: true,
    smooth: true,
    toolsHost: toolsHost || null
  });
  placeChartExport(
    mount,
    chartSpec({
      title: chartDef.label || T('games.compare.title'),
      scope: T('games.compare.title'),
      period: window.FoundersApp && window.FoundersApp.state && window.FoundersApp.state.period,
      metric: chartDef.label,
      series
    })
  );
}

function paintCompareOpenCharts(root, games, colors, period, expandMap, chartMetricMap) {
  const groups = compareMetricDefs(period);
  groups.forEach((group) => {
    if (!(expandMap && expandMap[group.id])) return;
    const mount = root.querySelector(`[data-compare-chart-mount="${group.id}"]`);
    if (!mount) return;
    const toolsHost = root.querySelector(`[data-compare-chart-tools="${group.id}"]`);
    const activeId =
      (chartMetricMap && chartMetricMap[group.id]) ||
      (group.charts && group.charts[0] && group.charts[0].id);
    const def = (group.charts || []).find((c) => c.id === activeId) || (group.charts || [])[0];
    paintCompareSectionChart(mount, games, colors, def, toolsHost);
  });
}

function paintCompareInsights(mount, games, colors) {
  if (!mount) return;
  const items = compareInsights(games, colors);
  if (!items.length) {
    mount.innerHTML =
      games.length < 2
        ? `<div class="muted">${T('games.compare.addOne')}</div>`
        : `<div class="muted">${T('games.compare.littleData')}</div>`;
    return;
  }
  mount.innerHTML = `<ul class="compare-insights">${items
    .map(
      (it) => `<li style="--cmp-color:${F().esc(it.color)}"><span class="compare-insight-dot"></span><span>${F().esc(
        it.text
      )}</span></li>`
    )
    .join('')}</ul>`;
}
