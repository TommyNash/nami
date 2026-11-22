var WS_SERIES = {
  ads: 'purchase_amount: Реклама', // i18n-ignore
  inapp: 'purchase_amount: Инап-покупки', // i18n-ignore
  players: 'players: Всего', // i18n-ignore
  playersNew: 'players: Новые игроки', // i18n-ignore
  playTime: 'play_time_for_player: Всего', // i18n-ignore
  playTimeAlt: 'play_time: Всего', // i18n-ignore
  ratingRu: 'rating: Россия и СНГ', // i18n-ignore
  ratingWorld: 'rating: Остальной мир' // i18n-ignore
};
var WS_READY_ENDS = ['p50', 'p95', 'Запросы']; // i18n-ignore
var WS_REVENUE_ENDS = ['Реклама', 'Инап-покупки']; // i18n-ignore

function platformLabel(name) {
  const s = String(name || '');
  if (/mobile|android|ios|phone|моб/i.test(s)) return T('workspace.platform.mobile'); // i18n-ignore
  if (/desktop|pc|web|деск/i.test(s)) return T('workspace.platform.desktop'); // i18n-ignore
  if (/tablet|pad|планш/i.test(s)) return T('workspace.platform.tablet'); // i18n-ignore
  if (/tv|тв/i.test(s)) return T('workspace.platform.tv'); // i18n-ignore
  return s || T('workspace.platform.other');
}

function dayKeyFromX(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return '';
  try {
    return new Date(n).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function seriesPointsMap(grouped, name) {
  const raw = (grouped && grouped[name]) || [];
  const map = new Map();
  raw.forEach((p) => {
    const day = dayKeyFromX(p.x);
    if (!day) return;
    const y = Number(p.y);
    if (!Number.isFinite(y)) return;
    map.set(day, y);
  });
  return map;
}

/** Недельные стеки реклама/инап внутри выбранного периода. */
function weeklyEarnStacks(grouped, bounds) {
  const ads = seriesPointsMap(grouped, WS_SERIES.ads);
  const inapp = seriesPointsMap(grouped, WS_SERIES.inapp);
  const days = [...new Set([...ads.keys(), ...inapp.keys()])].sort();
  const from = bounds && bounds.fromDay;
  const to = bounds && bounds.toDay;
  const inBounds = days.filter((d) => (!from || d >= from) && (!to || d <= to));
  const use = inBounds.length ? inBounds : days;
  if (!use.length) return [];
  const start = use[0];
  const buckets = new Map();
  use.forEach((day) => {
    const offset = Math.floor(
      (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000
    );
    const bi = Math.floor(Math.max(0, offset) / 7);
    if (!buckets.has(bi)) {
      buckets.set(bi, { from: day, to: day, ads: 0, inapp: 0 });
    }
    const b = buckets.get(bi);
    b.to = day;
    b.ads += ads.get(day) || 0;
    b.inapp += inapp.get(day) || 0;
  });
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, b]) => {
      const a = Number(String(b.from).slice(8, 10));
      const z = Number(String(b.to).slice(8, 10));
      return {
        label: a === z ? String(a) : `${a}–${z}`,
        segments: [
          { key: 'ads', value: b.ads, color: '#3dd68c' },
          { key: 'inapp', value: b.inapp, color: '#5b8def' }
        ]
      };
    })
    .filter((row) => row.segments.some((s) => s.value > 0));
}

function playersCalendarDays(grouped, bounds) {
  const map = seriesPointsMap(grouped, WS_SERIES.players);
  const from = bounds && bounds.fromDay;
  const to = bounds && bounds.toDay;
  return [...map.entries()]
    .filter(([day]) => (!from || day >= from) && (!to || day <= to))
    .map(([day, value]) => ({ day, value }));
}

function layerSeriesBundle(layer, grouped) {
  if (layer.prefix) return pickSeriesPrefix(grouped, layer.prefix, layer.preferEnds);
  return pickSeries(grouped, layer.prefer || []);
}

function periodPoints(grouped, name, bounds) {
  const map = seriesPointsMap(grouped, name);
  const from = bounds && bounds.fromDay;
  const to = bounds && bounds.toDay;
  return [...map.entries()]
    .filter(([day]) => (!from || day >= from) && (!to || day <= to))
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, v]) => v);
}

function periodAgg(grouped, name, bounds, mode) {
  const vals = periodPoints(grouped, name, bounds);
  if (!vals.length) return null;
  if (mode === 'last') return vals[vals.length - 1];
  if (mode === 'sum') return vals.reduce((s, v) => s + v, 0);
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

/** Числа за выбранный период, а не последний снимок панели. */
function periodSnapshot(details) {
  const g = details.seriesGrouped || {};
  const b = details.bounds || {};
  const l = details.latest || {};
  const playersAvg = periodAgg(g, WS_SERIES.players, b, 'avg');
  const playersLast = periodAgg(g, WS_SERIES.players, b, 'last');
  return {
    playersAvg: playersAvg != null ? playersAvg : l.players,
    playersLast,
    playersNew: periodAgg(g, WS_SERIES.playersNew, b, 'avg'),
    play: periodAgg(g, WS_SERIES.playTime, b, 'avg') ?? l.play_time_per_player,
    ready: periodAgg(g, 'game_ready_api: p50', b, 'avg') ?? l.game_ready,
    ratingRu: periodAgg(g, WS_SERIES.ratingRu, b, 'last') ?? l.rating_ru,
    ratingWorld: periodAgg(g, WS_SERIES.ratingWorld, b, 'last') ?? l.rating_world,
    fromSeries: playersAvg != null
  };
}

function seriesDeltaPct(grouped, name, bounds) {
  const vals = periodPoints(grouped, name, bounds);
  if (vals.length < 4) return null;
  const third = Math.max(1, Math.floor(vals.length / 3));
  const head = vals.slice(0, third);
  const tail = vals.slice(-third);
  const a = head.reduce((s, v) => s + v, 0) / head.length;
  const b = tail.reduce((s, v) => s + v, 0) / tail.length;
  if (!(a > 1e-9)) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

function seriesSpark(grouped, name, bounds) {
  return periodPoints(grouped, name, bounds);
}

function fmtDelta(pct, { suffix = '%', compare = T('workspace.delta.sinceStart') } = {}) {
  if (pct == null || !Number.isFinite(pct)) return { text: '—', tone: 'flat', raw: null };
  const sign = pct > 0 ? '+' : '';
  const value = `${sign}${F().num(pct, 0)}${suffix}`;
  return {
    text: compare ? `${value} ${compare}` : value,
    tone: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat',
    raw: pct
  };
}

function seriesDeltaAbs(grouped, name, bounds) {
  const vals = periodPoints(grouped, name, bounds);
  if (vals.length < 2) return null;
  return vals[vals.length - 1] - vals[0];
}

function summaryPeriodAcc(period) {
  return F().periodAcc(period);
}

function sumHint(text, innerHtml) {
  if (!text) return innerHtml;
  return `<span class="sum-hint">${innerHtml}<span class="sum-hint-pop" role="tooltip">${F().esc(
    text
  )}</span></span>`;
}

function deltaInsideTip(delta, metric = 'value') {
  if (!delta || delta.text === '—' || delta.raw == null) {
    return T('workspace.deltaTip.noData');
  }
  const up = delta.raw > 0.5;
  const down = delta.raw < -0.5;
  const kind = ['players', 'playtime', 'ready', 'rating', 'revenue'].includes(metric) ? metric : 'generic';
  const dir = up ? 'up' : down ? 'down' : 'flat';
  return T(`workspace.deltaTip.${kind}.${dir}`);
}

