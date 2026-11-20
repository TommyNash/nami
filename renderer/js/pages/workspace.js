const WS_SERIES = {
  ads: 'purchase_amount: Реклама', // i18n-ignore
  inapp: 'purchase_amount: Инап-покупки', // i18n-ignore
  players: 'players: Всего', // i18n-ignore
  playersNew: 'players: Новые игроки', // i18n-ignore
  playTime: 'play_time_for_player: Всего', // i18n-ignore
  playTimeAlt: 'play_time: Всего', // i18n-ignore
  ratingRu: 'rating: Россия и СНГ', // i18n-ignore
  ratingWorld: 'rating: Остальной мир' // i18n-ignore
};
const WS_READY_ENDS = ['p50', 'p95', 'Запросы']; // i18n-ignore
const WS_REVENUE_ENDS = ['Реклама', 'Инап-покупки']; // i18n-ignore

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

function summaryCardsHtml(details, period, periodEarn, snap) {
  const g = details.seriesGrouped || {};
  const b = details.bounds || {};
  const periodAcc = summaryPeriodAcc(period);
  const geo = details.geography || [];
  const geoTotal = geo.reduce((s, x) => s + (Number(x.players) || 0), 0);
  const topGeo = geo[0];
  const topShare =
    topGeo && geoTotal > 0 ? `${F().num((Number(topGeo.players) / geoTotal) * 100)}%` : '';
  const earnSparkAds = seriesSpark(g, WS_SERIES.ads, b);
  const earnSparkInapp = seriesSpark(g, WS_SERIES.inapp, b);
  const earnSpark = earnSparkAds.length
    ? earnSparkAds.map((v, i) => v + (earnSparkInapp[i] || 0))
    : earnSparkInapp;
  const earnDelta = fmtDelta(seriesDeltaPct(g, WS_SERIES.ads, b));
  const readyDeltaRaw = fmtDelta(seriesDeltaPct(g, 'game_ready_api: p50', b));
  const readyDelta = { ...readyDeltaRaw };
  // Ниже секунды — лучше: цвет инвертируем, подпись чипа оставляем честной.
  if (readyDelta.tone === 'up') readyDelta.tone = 'down';
  else if (readyDelta.tone === 'down') readyDelta.tone = 'up';
  const cards = [
    {
      id: 'players',
      label: T('workspace.label.players'),
      value: F().num(snap.playersAvg, 0),
      note: T('workspace.perDayAvg'),
      delta: fmtDelta(seriesDeltaPct(g, WS_SERIES.players, b)),
      spark: seriesSpark(g, WS_SERIES.players, b),
      valueTip: T('workspace.card.playersTip', { period: periodAcc }),
      accent: false
    },
    {
      id: 'playtime',
      label: T('workspace.label.playtime'),
      value: F().num(snap.play),
      note: T('workspace.perPlayerMinutes'),
      delta: fmtDelta(seriesDeltaPct(g, WS_SERIES.playTime, b)),
      spark: seriesSpark(g, WS_SERIES.playTime, b),
      valueTip: T('workspace.card.playtimeTip', { period: periodAcc }),
      accent: false
    },
    {
      id: 'ready',
      label: T('workspace.label.ready'),
      value: T('workspace.card.seconds', { value: F().num(snap.ready) }),
      note: T('workspace.card.untilReady'),
      delta: readyDelta,
      spark: seriesSpark(g, 'game_ready_api: p50', b),
      valueTip: T('workspace.card.readyTip'),
      deltaTip: deltaInsideTip(readyDelta, 'ready'),
      accent: false
    },
    {
      id: 'rating',
      label: T('workspace.label.rating'),
      value: F().num(snap.ratingRu, 0),
      note: T('workspace.card.worldRating', { value: F().num(snap.ratingWorld, 0) }),
      delta: fmtDelta(seriesDeltaAbs(g, WS_SERIES.ratingRu, b), { suffix: '' }),
      spark: seriesSpark(g, WS_SERIES.ratingRu, b),
      valueTip: T('workspace.card.ratingTip'),
      deltaTip: deltaInsideTip(
        fmtDelta(seriesDeltaAbs(g, WS_SERIES.ratingRu, b), { suffix: '' }),
        'rating'
      ),
      accent: false
    },
    {
      id: 'revenue',
      label: T('workspace.label.revenue'),
      value: moneyFmt(periodEarn),
      note: periodAcc,
      delta: earnDelta,
      spark: earnSpark,
      valueTip: T('workspace.card.revenueTip', { period: periodAcc }),
      deltaTip: deltaInsideTip(earnDelta, 'revenue'),
      accent: true
    },
    {
      id: 'audience',
      label: T('workspace.label.audience'),
      value: T('workspace.card.countries', { count: geo.length || 0 }),
      note: topGeo ? `${topGeo.country} ${topShare}` : T('workspace.card.noData'),
      delta: { text: '—', tone: 'flat', raw: null },
      spark: seriesSpark(g, WS_SERIES.players, b),
      valueTip: T('workspace.card.audienceTip'),
      deltaTip: topGeo
        ? T('workspace.card.geoTip', { country: topGeo.country, share: topShare })
        : T('workspace.card.noGeo'),
      accent: false
    }
  ];
  cards.forEach((c) => {
    if (c.deltaTip == null) c.deltaTip = deltaInsideTip(c.delta, c.id);
  });
  const arrow = window.FoundersIcons ? window.FoundersIcons.svg('arrow-up-right', 16) : '↗';
  const sparkSize = { w: 120, h: 40 };
  return `<div class="summary-grid">
    ${cards
      .map((c) => {
        const spark = sparklineSvg(c.spark, c.delta.tone, null, sparkSize);
        return `<button type="button" class="sum-card ${c.accent ? 'is-accent' : ''}" data-section="${c.id}">
          <div class="sum-card-top">
            <span>${F().esc(c.label)}</span>
            <i class="sum-card-go">${arrow}</i>
          </div>
          <div class="sum-card-mid">
            ${sumHint(c.valueTip, `<b>${c.value}</b>`)}
            <span class="sum-spark">${spark}</span>
          </div>
          <div class="sum-card-foot">
            ${sumHint(
              c.deltaTip,
              `<span class="sum-pill is-${c.delta.tone}">${F().esc(c.delta.text)}</span>`
            )}
            ${sumHint(c.valueTip, `<span class="sum-note">${F().esc(c.note)}</span>`)}
          </div>
        </button>`;
      })
      .join('')}
  </div>`;
}

function workspaceGameHeadHtml(details) {
  const game = details.game || {};
  const title = game.title || game.id || T('workspace.game.fallbackTitle');
  const initials = String(title)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  const icon = game.icon_url
    ? `<img class="ws-game-icon" src="${F().esc(game.icon_url)}" alt="" />`
    : `<div class="ws-game-icon is-ph">${F().esc(initials || '?')}</div>`;
  const updated =
    game.last_seen_at != null
      ? F().date(game.last_seen_at > 1e12 ? game.last_seen_at : game.last_seen_at * 1000)
      : '';
  return `<div class="ws-game-head">
    ${icon}
    <div class="ws-game-copy">
      <h1 class="ws-game-title">${F().esc(title)}</h1>
      <div class="ws-game-sub">
        <span class="status-pill ${statusClass(game.status)}">${F().esc(statusLabel(game.status))}</span>
        <span class="muted">ID ${F().esc(String(game.id || ''))}${updated ? T('workspace.head.updated', { date: updated }) : ''}</span>
      </div>
    </div>
    <button type="button" class="ws-export-btn" id="wsExportAll">
      <i class="ph ph-download-simple" aria-hidden="true"></i>
      <span>${T('workspace.head.download')}</span>
    </button>
  </div>`;
}

function mountAudienceWidgets(root, details, snap) {
  const l = details.latest || {};
  const plats = (details.platforms || []).map((p) => ({
    label: platformLabel(p.platform),
    value: Number(p.players) || 0
  }));
  const platMerged = new Map();
  plats.forEach((p) => platMerged.set(p.label, (platMerged.get(p.label) || 0) + p.value));
  const platItems = [...platMerged.entries()].map(([label, value]) => ({ label, value }));
  const platTotal = platItems.reduce((s, p) => s + p.value, 0);
  const game = details.game || {};
  const period = details.period;
  const platEl = root.querySelector('#wsPlat');
  if (platEl) {
    if (platItems.length) {
      C().donut(platEl, platItems, {
        center: F().num(platTotal || snap.playersAvg || l.players, 0),
        centerSub: T('workspace.audience.playersUnit'),
        size: 150
      });
      placeChartExport(
        platEl,
        chartSpec({
          title: 'platforms',
          scope: game.title || game.id,
          gameId: game.id,
          period,
          metric: 'players',
          rows: platItems
            .map((item) =>
              tidyRow({
                gameId: game.id,
                gameTitle: game.title || game.id,
                metric: `platform_${exportMetricKey(item.label)}`,
                value: item.value,
                unit: 'count',
                dataset: 'platforms'
              })
            )
            .filter(Boolean)
        })
      );
    } else {
      platEl.innerHTML = `<div class="empty">${T('workspace.audience.noPlatforms')}</div>`;
    }
  }
  const geoEl = root.querySelector('#wsGeo');
  if (geoEl) {
    const geoRows = (details.geography || []).map((row) => ({
      label: row.country,
      value: Number(row.players) || 0
    }));
    C().hbars(geoEl, geoRows, { color: '#3dd68c', limit: 5 });
    if (geoRows.length) {
      placeChartExport(
        geoEl,
        chartSpec({
          title: 'geography',
          scope: game.title || game.id,
          gameId: game.id,
          period,
          metric: 'players',
          rows: geoRows
            .map((item) =>
              tidyRow({
                gameId: game.id,
                gameTitle: game.title || game.id,
                metric: `country_${exportMetricKey(item.label)}`,
                value: item.value,
                unit: 'count',
                dataset: 'geography'
              })
            )
            .filter(Boolean)
        })
      );
    }
  }
  const ringEl = root.querySelector('#wsRatingRing');
  if (ringEl && ringEl.dataset.mode === 'bars') {
    const ru = Number(snap.ratingRu) || 0;
    const world = Number(snap.ratingWorld) || 0;
    const gap = ru - world;
    C().hbars(
      ringEl,
      [
        { label: T('workspace.label.russiaCis'), value: ru, color: '#3dd68c' },
        { label: T('workspace.label.world'), value: world, color: '#5b8def' }
      ],
      { max: 100, raw: true, limit: 2 }
    );
    placeChartExport(
      ringEl,
      chartSpec({
        title: 'rating',
        scope: game.title || game.id,
        gameId: game.id,
        period,
        metric: 'rating',
        rows: [
          tidyRow({
            gameId: game.id,
            gameTitle: game.title || game.id,
            metric: 'rating_ru',
            value: ru,
            unit: 'score',
            dataset: 'rating'
          }),
          tidyRow({
            gameId: game.id,
            gameTitle: game.title || game.id,
            metric: 'rating_world',
            value: world,
            unit: 'score',
            dataset: 'rating'
          })
        ].filter(Boolean)
      })
    );
    if (Number.isFinite(gap)) {
      ringEl.insertAdjacentHTML(
        'beforeend',
        `<div class="cal-hint">${T(gap >= 0 ? 'workspace.rating.above' : 'workspace.rating.below', {
          n: Math.round(Math.abs(gap)),
          count: F().num(Math.abs(gap), 0)
        })}</div>`
      );
    }
  } else if (ringEl) {
    C().dualRing(ringEl, {
      max: 100,
      outer: { value: Number(snap.ratingRu) || 0, label: T('workspace.label.russiaCis'), color: '#3dd68c' },
      inner: { value: Number(snap.ratingWorld) || 0, label: T('workspace.label.world'), color: '#e3a93a' }
    });
  }
  const calEl = root.querySelector('#wsCalendar');
  if (calEl) {
    C().calendar(calEl, playersCalendarDays(details.seriesGrouped, details.bounds), {
      hint: T('workspace.calendar.playersByDay'),
      color: '#3dd68c'
    });
  }
}

/** Компактная цифра в шапке графика вместо правой kpi-card. */
function sectionHeadStat(active, details, period, periodEarn, snap) {
  if (active.id === 'players') {
    return { value: F().num(snap.playersAvg, 0), sub: T('workspace.perDayAvg') };
  }
  if (active.id === 'playtime') return { value: F().num(snap.play), sub: T('workspace.perPlayerMinutes') };
  if (active.id === 'ready') {
    return { value: F().num(snap.ready), sub: T('workspace.headStat.secondsUntilReady') };
  }
  if (active.id === 'rating') {
    return {
      value: F().num(snap.ratingRu, 0),
      sub: T('workspace.card.worldRating', { value: F().num(snap.ratingWorld, 0) })
    };
  }
  if (active.id === 'revenue') {
    return { value: moneyFmt(periodEarn), sub: F().periodAcc(period) };
  }
  if (active.id === 'audience') {
    const geoN = (details.geography || []).length;
    const platN = (details.platforms || []).length;
    return {
      value: F().num(snap.playersAvg, 0),
      sub: T('workspace.headStat.audience', { platforms: platN || 0, countries: geoN || 0 })
    };
  }
  return null;
}

async function renderWorkspaceOverview(body, details, period) {
  const l = details.latest || {};
  const periodEarn = (details.earnings || []).reduce((s, e) => s + (Number(e.earn) || 0), 0);
  const snap = periodSnapshot(details);
  const sectionId = window.FoundersApp.state.workspaceLayer || 'summary';

  const sections = [
    {
      id: 'players',
      label: T('workspace.label.players'),
      color: '#3dd68c',
      prefer: [WS_SERIES.players, WS_SERIES.playersNew]
    },
    {
      id: 'playtime',
      label: T('workspace.label.playtime'),
      color: '#e3a93a',
      prefer: [WS_SERIES.playTime, WS_SERIES.playTimeAlt],
      dual: true
    },
    {
      id: 'ready',
      label: T('workspace.label.ready'),
      color: '#3dd68c',
      prefix: 'game_ready_api',
      preferEnds: WS_READY_ENDS,
      dualLast: true
    },
    {
      id: 'rating',
      label: T('workspace.label.rating'),
      color: '#c084fc',
      prefer: [WS_SERIES.ratingRu, WS_SERIES.ratingWorld]
    },
    {
      id: 'revenue',
      label: T('workspace.label.revenue'),
      color: '#3dd68c',
      prefix: 'purchase_amount',
      preferEnds: WS_REVENUE_ENDS
    },
    { id: 'audience', label: T('workspace.label.audience'), color: '#8a8a8a', audience: true },
    { id: 'conversion', label: T('workspace.label.conversion'), color: '#e3a93a', chartsOnly: true }
  ];

  const active = sections.find((s) => s.id === sectionId) || { id: 'summary', label: T('workspace.label.summary'), summary: true };
  const showChart = active.id !== 'audience' && active.id !== 'summary' && !active.chartsOnly;
  const isSummary = active.id === 'summary' || active.summary;
  const headStat = !isSummary ? sectionHeadStat(active, details, period, periodEarn, snap) : null;
  const headStatHtml = headStat
    ? `<div class="ws-head-stat"><b>${headStat.value}</b><span>${F().esc(headStat.sub)}</span></div>`
    : '';

  const rangeLabel =
    details.bounds && details.bounds.fromDay
      ? `${F().date(details.bounds.fromDay)} – ${F().date(details.bounds.toDay)}`
      : '';
  const platN = (details.platforms || []).length;
  const geoN = (details.geography || []).length;
  const summaryHtml = `
    ${summaryCardsHtml(details, period, periodEarn, snap)}
    <div class="panel panel-chart is-overview-chart">
      <div class="panel-head">
        <div>
          <h2>${T('workspace.overview.playersPeriod')}</h2>
          <div class="sum-chart-sub">${
            rangeLabel
              ? T('workspace.overview.byDaysRange', { range: rangeLabel })
              : T('workspace.overview.byDays')
          }</div>
        </div>
        <div id="wsChartLegend" class="sum-chart-pills"></div>
      </div>
      <div class="panel-body"><div id="wsMainChart" class="ws-main-chart"></div></div>
    </div>
    <div class="report-bottom report-bottom-3">
      <div class="panel">
        <div class="panel-head"><h2>${T('workspace.label.platforms')}</h2><span class="muted">${platN ? `${platN}` : ''}</span></div>
        <div class="panel-body"><div id="wsPlat" class="ws-widget"></div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${T('workspace.label.countries')}</h2><span class="muted">${geoN ? `${geoN}` : ''}</span></div>
        <div class="panel-body"><div id="wsGeo" class="ws-widget"></div></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${T('workspace.label.rating')}</h2></div>
        <div class="panel-body"><div id="wsRatingRing" class="ws-widget" data-mode="bars"></div></div>
      </div>
    </div>`;

  body.innerHTML = `
    <div class="ws-slot-grid is-wide">
      <section class="report-main">
        ${workspaceGameHeadHtml(details)}
        ${isSummary ? summaryHtml : ''}
        ${
          showChart
            ? `<div class="panel panel-chart is-section-chart">
          <div class="panel-head">
            <div>
              <h2>${
                active.id === 'revenue'
                  ? T('workspace.revenue.byDay')
                  : F().esc(active.label)
              }</h2>
              ${
                active.id === 'revenue'
                  ? `<div class="sum-chart-sub">${
                      rangeLabel
                        ? T('workspace.revenue.adsAndPurchasesRange', { range: rangeLabel })
                        : T('workspace.revenue.adsAndPurchases')
                    }</div>${headStatHtml}`
                  : headStatHtml
              }
            </div>
            <div id="wsChartLegend" class="sum-chart-pills"></div>
          </div>
          <div class="panel-body"><div id="wsMainChart" class="ws-main-chart"></div></div>
        </div>`
            : ''
        }
        ${
          active.id === 'revenue'
            ? `<div class="panel">
          <div class="panel-head"><h2>${T('workspace.revenue.byWeek')}</h2><span class="muted">${T('workspace.revenue.adsAndPurchases')}</span></div>
          <div class="panel-body"><div id="wsEarnBars" class="ws-widget"></div></div>
        </div>`
            : ''
        }
        ${
          active.id === 'rating'
            ? `<div class="panel">
          <div class="panel-head"><h2>${T('workspace.rating.russiaAndWorld')}</h2></div>
          <div class="panel-body"><div id="wsRatingRing" class="ws-widget"></div></div>
        </div>`
            : ''
        }
        ${
          active.chartsOnly
            ? `<div class="report-section-title">${F().esc(active.label)}</div>`
            : ''
        }
        ${extraChartsHtml(active.id, { primaryFirst: Boolean(active.chartsOnly) })}
        ${
          active.audience
            ? `<div class="report-section-head">
          <div class="report-section-title" id="reportAudience">${T('workspace.label.audience')}</div>
          ${headStatHtml}
        </div>
        <div class="report-bottom">
          <div class="panel">
            <div class="panel-head"><h2>${T('workspace.label.platforms')}</h2></div>
            <div class="panel-body"><div id="wsPlat" class="ws-widget"></div></div>
          </div>
          <div class="panel">
            <div class="panel-head"><h2>${T('workspace.label.countries')}</h2></div>
            <div class="panel-body"><div id="wsGeo" class="ws-widget"></div></div>
          </div>
          <div class="panel">
            <div class="panel-head"><h2>${T('workspace.calendar.playersByDay')}</h2></div>
            <div class="panel-body"><div id="wsCalendar" class="ws-widget"></div></div>
          </div>
        </div>`
            : ''
        }
      </section>
    </div>
  `;

  const exportAll = body.querySelector('#wsExportAll');
  if (exportAll && window.FoundersExport) {
    exportAll.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.FoundersExport.open(exportAll, gameExportSpec(details, period));
    };
  }

  const openSection = (id) => {
    if (window.FoundersApp.showWorkspaceSection) window.FoundersApp.showWorkspaceSection(id);
  };
  body.querySelectorAll('[data-section]').forEach((btn) => {
    btn.onclick = () => openSection(btn.dataset.section);
  });

  const summaryChart = active.id === 'summary' || active.summary;
  if (showChart || summaryChart) {
    const chartLayer = summaryChart
      ? sections.find((s) => s.id === 'players')
      : active;
    const fromTs = details.bounds && details.bounds.fromDay ? Date.parse(`${details.bounds.fromDay}T00:00:00Z`) : null;
    const toTs = details.bounds && details.bounds.toDay ? Date.parse(`${details.bounds.toDay}T23:59:59Z`) : null;
    const bundle = layerSeriesBundle(chartLayer, details.seriesGrouped)
      .map((s, i, arr) => ({
        ...s,
        name: seriesLabel(s.name),
        axis: chartLayer.dualLast
          ? i === arr.length - 1
            ? 'right'
            : 'left'
          : chartLayer.dual && i > 0
            ? 'right'
            : 'left',
        data: (s.data || []).filter((p) => {
          const x = Number(p.x);
          if (!Number.isFinite(x) || fromTs == null || toTs == null) return true;
          return x >= fromTs && x <= toTs;
        })
      }))
      .filter((s) => s.data.length);
    const chartEl = document.getElementById('wsMainChart');
    if (bundle.length) {
      C().line(chartEl, bundle, {
        analysis: false,
        trend: false,
        trendWindow: 7,
        dualAxis: Boolean(chartLayer.dual || chartLayer.dualLast),
        normalizeX: true,
        nonNegative: true,
        smooth: true,
        dots: false,
        tipNote: false,
        showAvg: summaryChart,
        avgToggle: true,
        height: summaryChart ? 340 : undefined,
        legendHost: document.getElementById('wsChartLegend'),
        colors:
          active.id === 'revenue'
            ? ['#3dd68c', '#5b8def', '#e3a93a']
            : [chartLayer.color, '#5b8def', '#e3a93a']
      });
      const game = details.game || {};
      placeChartExport(
        chartEl,
        chartSpec({
          title: summaryChart ? T('workspace.overview.playersPeriod') : active.label,
          scope: game.title || game.id,
          gameId: game.id,
          period,
          metric: active.label,
          series: bundle
        })
      );
    } else {
      chartEl.innerHTML = `<div class="empty">${T('workspace.chart.noSeries')}</div>`;
    }
  }

  if (active.id === 'revenue') {
    const earnEl = document.getElementById('wsEarnBars');
    const weekStacks = weeklyEarnStacks(details.seriesGrouped, details.bounds);
    if (weekStacks.length) {
      C().stackedBars(earnEl, weekStacks, {
        height: 168,
        legend: [
          { label: T('workspace.revenue.ads'), color: '#3dd68c' },
          { label: T('workspace.revenue.purchases'), color: '#5b8def' }
        ],
        formatY: moneyFmt
      });
      const game = details.game || {};
      placeChartExport(
        earnEl,
        chartSpec({
          title: 'weekly_revenue',
          scope: game.title || game.id,
          gameId: game.id,
          period,
          metric: 'earn',
          rows: weekStacks
            .flatMap((row) => {
              const ads = (row.segments || []).find((seg) => seg.key !== 'inapp');
              const inn = (row.segments || []).find((seg) => seg.key === 'inapp');
              const base = {
                date: String(row.label || ''),
                gameId: game.id,
                gameTitle: game.title || game.id,
                dataset: 'earnings'
              };
              return [
                tidyRow({
                  ...base,
                  metric: 'earn_ads',
                  value: ads ? Number(ads.value) || 0 : 0,
                  unit: 'RUB'
                }),
                tidyRow({
                  ...base,
                  metric: 'earn_inapp',
                  value: inn ? Number(inn.value) || 0 : 0,
                  unit: 'RUB'
                })
              ];
            })
            .filter(Boolean)
        })
      );
    } else {
      const earnBars = (details.earnings || [])
        .slice()
        .reverse()
        .map((e) => ({
          label: String(e.period_from || '').slice(0, 7),
          value: Number(e.earn) || 0
        }));
      if (earnBars.length) {
        C().bars(earnEl, earnBars, { color: '#1e7a50', showAvg: false, height: 168 });
      } else if (earnEl) {
        earnEl.innerHTML = `<div class="empty">${T('workspace.revenue.empty')}</div>`;
      }
    }
  }

  if (active.id === 'rating' && !isSummary) {
    C().dualRing(document.getElementById('wsRatingRing'), {
      max: 100,
      outer: { value: Number(snap.ratingRu) || 0, label: T('workspace.label.russiaCis'), color: '#3dd68c' },
      inner: { value: Number(snap.ratingWorld) || 0, label: T('workspace.label.world'), color: '#e3a93a' }
    });
  }

  paintExtraCharts(active.id, details.seriesGrouped, details, period);

  if (isSummary || active.audience) {
    mountAudienceWidgets(body, details, snap);
  }
}

function resolveChartSeries(grouped, chart) {
  if (chart.prefix) return pickSeriesPrefix(grouped, chart.prefix, chart.preferEnds);
  if (chart.prefer) return pickSeries(grouped, chart.prefer);
  return [];
}

function paintMetricChart(el, seriesRaw, chart, chartOpts) {
  if (!el) return;
  if (!seriesRaw.length) {
    el.innerHTML = `<div class="empty">${T('workspace.chart.noData')}</div>`;
    return;
  }
  let series = seriesRaw.map((s) => ({ ...s, name: seriesLabel(s.name) }));
  const opts = {
    normalizeX: true,
    nonNegative: true,
    smooth: true,
    dots: false,
    showAvg: false,
    avgToggle: true,
    analysis: false,
    trend: false,
    trendWindow: 7,
    ...chartOpts
  };
  if (chart.dualPerPlayer) {
    series = series.map((s) => ({
      ...s,
      axis: /на игрока|play_time_for_player/i.test(String(s.name) + s.name) ? 'right' : 'left' // i18n-ignore
    }));
    opts.dualAxis = true;
    opts.formatYRight = (n) => (Number.isFinite(n) ? F().num(n, 2) : '');
  } else if (chart.dualSecond && series.length >= 2) {
    series = series.map((s, i) => ({ ...s, axis: i === 0 ? 'left' : 'right' }));
    opts.dualAxis = true;
  } else if (chart.dualLast && series.length >= 2) {
    series = series.map((s, i) => ({ ...s, axis: i === series.length - 1 ? 'right' : 'left' }));
    opts.dualAxis = true;
  }
  C().line(el, series, opts);
  if (opts.export) placeChartExport(el, opts.export);
}

/** Графики из «Всех метрик», разложенные по разделам. Базовый график раздела сюда не дублируется. */
const EXTRA_CHARTS = {
  // game-ready уже в базовом графике раздела Ready
  ready: ['tti'],
  // revenue-ads / revenue-inapp уже в базовом графике раздела
  revenue: ['arpdau', 'paying', 'arppu', 'inapp-count', 'ads-impr'],
  conversion: ['ctr-my', 'ctr-wo', 'ctr-cover', 'ctp', 'playtime-conv']
};

function chartsByIds(ids) {
  const all = METRIC_SECTIONS.flatMap((s) => s.charts);
  return (ids || []).map((id) => all.find((c) => c.id === id)).filter(Boolean);
}

function extraChartsHtml(sectionId, { primaryFirst = false } = {}) {
  const charts = chartsByIds(EXTRA_CHARTS[sectionId]);
  if (!charts.length) return '';
  return charts
    .map((c, i) => {
      const glow = primaryFirst && i === 0;
      return `<div class="panel ${glow ? 'panel-chart' : ''} is-metric-chart">
        <div class="panel-head">
          <div>
            <h2>${F().esc(c.title)}</h2>
            ${c.hint ? `<div class="sum-chart-sub">${F().esc(c.hint)}</div>` : ''}
          </div>
          <div id="mchart-legend-${F().esc(c.id)}" class="sum-chart-pills"></div>
        </div>
        <div class="panel-body"><div id="mchart-${F().esc(c.id)}" class="ws-extra-chart"></div></div>
      </div>`;
    })
    .join('');
}

function paintExtraCharts(sectionId, grouped, details, period) {
  const game = (details && details.game) || {};
  chartsByIds(EXTRA_CHARTS[sectionId]).forEach((chart) => {
    const series = resolveChartSeries(grouped, chart);
    paintMetricChart(document.getElementById(`mchart-${chart.id}`), series, chart, {
      analysis: false,
      trend: false,
      trendWindow: 7,
      showAvg: false,
      avgToggle: true,
      smooth: true,
      dots: false,
      tipNote: false,
      legendHost: document.getElementById(`mchart-legend-${chart.id}`),
      export: chartSpec({
        title: chart.title,
        scope: game.title || game.id || T('workspace.game.fallbackTitle'),
        gameId: game.id,
        period,
        metric: chart.title,
        series
      })
    });
  });
}

function extraSeriesPrefixes(grouped) {
  const found = new Set(
    Object.keys(grouped || {}).map((k) => String(k).split(':')[0]).filter(Boolean)
  );
  return [...found].filter((p) => !KNOWN_METRIC_PREFIXES.includes(p)).sort();
}

async function renderWorkspaceMetrics(body, details, period) {
  const sectionId = window.FoundersApp.state.metricsSection || 'product';
  const section = METRIC_SECTIONS.find((s) => s.id === sectionId) || METRIC_SECTIONS[0];
  const chartOpts = { analysis: true, trend: true, trendWindow: 7 };
  const extras = extraSeriesPrefixes(details.seriesGrouped);

  body.innerHTML = `
    ${scopeNote('earn', details.bounds)}
    ${
      period === 'day' || period === 'week'
        ? `<div class="scope-note">${T('workspace.metrics.yearNote', {
            period: F().esc(F().periodNoun(period))
          })}</div>`
        : `<div class="scope-note">${T('workspace.metrics.avgNote')}</div>`
    }
    <div class="seg metrics-seg" role="tablist" aria-label="${F().esc(T('workspace.metrics.sectionsAria'))}" data-thumb-key="metrics">
      ${METRIC_SECTIONS.map(
        (s) =>
          `<button type="button" class="seg-btn ${s.id === section.id ? 'active' : ''}" data-msection="${s.id}">${
            s.title
          }</button>`
      ).join('')}
    </div>
    <div class="scope-note">${T('workspace.metrics.cabinetNote', {
      title: section.title,
      count: KNOWN_METRIC_PREFIXES.length
    })}</div>
    ${section.charts
      .map(
        (c) => `
      <div class="panel">
        <div class="panel-head"><h2>${F().esc(c.title)}</h2>${
          c.hint ? `<span class="muted">${F().esc(c.hint)}</span>` : ''
        }</div>
        <div class="panel-body"><div id="mchart-${F().esc(c.id)}"></div></div>
      </div>`
      )
      .join('')}
    ${
      extras.length
        ? `<div class="panel"><div class="panel-head"><h2>${T('workspace.metrics.otherTitle')}</h2><span class="muted">${T('workspace.metrics.otherHint')}</span></div>
        <div class="panel-body">${extras.map((p) => `<span class="tag">${F().esc(p)}</span>`).join('')}</div></div>`
        : ''
    }
  `;

  body.querySelectorAll('[data-msection]').forEach((btn) => {
    btn.onclick = () => {
      window.FoundersApp.state.metricsSection = btn.dataset.msection;
      localStorage.setItem('fa.metricsSection', btn.dataset.msection);
      renderWorkspaceMetrics(body, details, period);
    };
  });

  for (const chart of section.charts) {
    const raw = resolveChartSeries(details.seriesGrouped, chart);
    paintMetricChart(document.getElementById(`mchart-${chart.id}`), raw, chart, chartOpts);
  }
}

async function renderWorkspacePurchases(body, gameId) {
  const page = await window.foundersApi.analyticsPurchases(gameId);
  body.innerHTML = `
    ${scopeNote('snapshot')}
    <div class="panel">
      <div class="panel-head"><h2>${T('workspace.purchases.metricsTitle')}</h2></div>
      <div class="panel-body">
        ${(page.metrics || [])
          .map(
            (m) =>
              `<span class="tag">${F().esc(m.metric_title || m.metric_slug)}: ${F().num(m.value)} ${F().esc(
                m.unit || ''
              )}</span>`
          )
          .join('') || `<div class="empty">${T('workspace.purchases.noMetrics')}</div>`}
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>${T('workspace.purchases.catalogTitle')}</h2></div>
      <div class="panel-body" style="padding:0">
        <table>
          <thead><tr><th>${T('workspace.purchases.sku')}</th><th>${T('workspace.purchases.name')}</th><th>${T('workspace.purchases.price')}</th></tr></thead>
          <tbody>
            ${(page.products || [])
              .map(
                (p) => `<tr>
                  <td class="mono">${F().esc(p.product_id)}</td>
                  <td>${F().esc(p.title || '—')}</td>
                  <td>${F().num(p.price_value)} ${F().esc(p.price_code || '')}</td>
                </tr>`
              )
              .join('') || `<tr><td colspan="3" class="empty">${T('workspace.purchases.noProducts')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function renderWorkspaceAudience(body, data, details, period) {
  const tab = data.audienceTab || 'reviews';
  const id = data.selectedGameId;
  const [reviewsPage, geo, plat] = await Promise.all([
    window.foundersApi.analyticsReviews(id),
    window.foundersApi.analyticsGeography(id),
    window.foundersApi.analyticsPlatforms(id)
  ]);
  const ratings = Array.isArray(reviewsPage.ratings)
    ? reviewsPage.ratings
    : reviewsPage.ratings
      ? [reviewsPage.ratings]
      : [];

  body.innerHTML = `
    <div class="tabs">
      <button type="button" class="tab ${tab === 'reviews' ? 'active' : ''}" data-atab="reviews">${T('workspace.label.reviews')}</button>
      <button type="button" class="tab ${tab === 'geo' ? 'active' : ''}" data-atab="geo">${T('workspace.audience.geography')}</button>
      <button type="button" class="tab ${tab === 'platforms' ? 'active' : ''}" data-atab="platforms">${T('workspace.label.platforms')}</button>
    </div>
    <div id="audInner"></div>
  `;
  const inner = document.getElementById('audInner');

  function paint(active) {
    window.FoundersApp.setAudienceTab(active);
    body.querySelectorAll('[data-atab]').forEach((b) => b.classList.toggle('active', b.dataset.atab === active));
    if (active === 'reviews') {
      inner.innerHTML = `
        ${scopeNote('period', details.bounds)}
        <div class="panel">
          <div class="panel-head"><h2>${T('workspace.label.rating')}</h2></div>
          <div class="panel-body" style="padding:0">
            <table>
              <thead><tr><th>${T('workspace.audience.average')}</th><th>1★</th><th>2★</th><th>3★</th><th>4★</th><th>5★</th><th>${T('workspace.audience.total')}</th></tr></thead>
              <tbody>
                ${ratings
                  .map(
                    (r) => `<tr>
                      <td>${F().num(r.avg_rating)}</td>
                      <td>${F().num(r.stars_1, 0)}</td>
                      <td>${F().num(r.stars_2, 0)}</td>
                      <td>${F().num(r.stars_3, 0)}</td>
                      <td>${F().num(r.stars_4, 0)}</td>
                      <td>${F().num(r.stars_5, 0)}</td>
                      <td>${F().num(r.total, 0)}</td>
                    </tr>`
                  )
                  .join('') || `<tr><td colspan="7" class="empty">${T('workspace.audience.noRatings')}</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>${T('workspace.label.reviews')}</h2></div>
          <div class="panel-body" style="padding:0">
            <table>
              <thead><tr><th>${T('workspace.audience.author')}</th><th>★</th><th>${T('workspace.audience.text')}</th><th>${T('workspace.audience.time')}</th></tr></thead>
              <tbody>
                ${(reviewsPage.reviews || [])
                  .slice(0, 40)
                  .map(
                    (r) => `<tr>
                      <td>${F().esc(r.author_name || '—')}</td>
                      <td>${F().num(r.rating, 0)}</td>
                      <td>${F().esc((r.text || '').slice(0, 160))}</td>
                      <td>${F().time(r.review_time)}</td>
                    </tr>`
                  )
                  .join('') || `<tr><td colspan="4" class="empty">${T('workspace.audience.noReviews')}</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>`;
    } else if (active === 'geo') {
      inner.innerHTML = `
        ${scopeNote('snapshot')}
        <div class="panel"><div class="panel-body"><div id="aGeo"></div></div></div>
        <div class="panel"><div class="panel-body" style="padding:0">
          <table><thead><tr><th>${T('workspace.audience.country')}</th><th>${T('workspace.label.players')}</th></tr></thead>
          <tbody>${geo.map((r) => `<tr><td>${F().esc(r.country)}</td><td>${F().num(r.players, 0)}</td></tr>`).join('') ||
            `<tr><td colspan="2" class="empty">${T('workspace.audience.noData')}</td></tr>`}</tbody></table>
        </div></div>`;
      C().bars(
        document.getElementById('aGeo'),
        geo.slice(0, 15).map((r) => ({ label: r.country, value: r.players }))
      );
    } else {
      inner.innerHTML = `
        ${scopeNote('snapshot')}
        <div class="panel"><div class="panel-body"><div id="aPlat"></div></div></div>
        <div class="panel"><div class="panel-body" style="padding:0">
          <table><thead><tr><th>${T('workspace.audience.platform')}</th><th>${T('workspace.label.players')}</th></tr></thead>
          <tbody>${plat.map((r) => `<tr><td>${F().esc(r.platform)}</td><td>${F().num(r.players, 0)}</td></tr>`).join('') ||
            `<tr><td colspan="2" class="empty">${T('workspace.audience.noData')}</td></tr>`}</tbody></table>
        </div></div>`;
      C().bars(
        document.getElementById('aPlat'),
        plat.map((r) => ({ label: r.platform, value: r.players })),
        { color: '#1e7a50' }
      );
    }
  }

  body.querySelectorAll('[data-atab]').forEach((b) => {
    b.onclick = () => paint(b.dataset.atab);
  });
  paint(tab);
}
