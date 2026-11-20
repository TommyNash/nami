function placeChartExport(fromEl, spec) {
  if (!fromEl || !spec || !window.FoundersExport) return;
  const root = fromEl.closest('.panel, .compare-section-chart');
  if (root) window.FoundersExport.place(root, spec);
}

function exportNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n);
  return Math.round(n * 10000) / 10000;
}

function exportMetricKey(name) {
  if (window.FoundersExport && window.FoundersExport.slug) {
    return window.FoundersExport.slug(name) || 'value';
  }
  return String(name || 'value')
    .toLowerCase()
    .replace(/[^\w]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}

function exportUnitOf(metricKey, label, explicit) {
  if (explicit != null && String(explicit).trim() !== '') {
    return normalizeExportUnit(explicit);
  }
  const text = `${metricKey || ''} ${label || ''}`.toLowerCase();
  if (/play_time|время игры|мин\b|minute/.test(text) && !/ready|tti|interactive/.test(text)) { // i18n-ignore
    return 'min';
  }
  if (/game_ready|time_to_interactive|tti|секунд|sec\b|_s\b/.test(text)) return 's'; // i18n-ignore
  if (/yan\b/.test(text)) return 'YAN';
  if (/rub|₽|earn|revenue|доход|arpu|arpdau|arppu|price|purchase_amount|выруч/.test(text)) { // i18n-ignore
    return 'RUB';
  }
  if (/pct|%|ctr|ctp|доля|конверс|paying_share: доля/.test(text)) return 'pct'; // i18n-ignore
  if (/rating|рейтинг/.test(text)) return 'score'; // i18n-ignore
  if (
    /player|игр|запрос|impress|показ|count|штук|количеств|paying|unique|покуп/.test(text) // i18n-ignore
  ) {
    return 'count';
  }
  if (/status|title|slug/.test(text)) return 'text';
  return 'unknown';
}

function normalizeExportUnit(unit) {
  const u = String(unit || '').trim();
  if (!u) return 'unknown';
  const low = u.toLowerCase();
  if (low === 'payment_amounts_matrix') return 'count';
  if (/^(rub|₽|rur|руб)/.test(low)) return 'RUB'; // i18n-ignore
  if (/^yan/.test(low)) return 'YAN';
  if (/^(s|sec|секунд)/.test(low)) return 's'; // i18n-ignore
  if (/^(min|мин)/.test(low)) return 'min'; // i18n-ignore
  if (/^(%|pct|percent|проц)/.test(low)) return 'pct'; // i18n-ignore
  if (/^(count|шт|unit|пользоват|player)/.test(low)) return 'count'; // i18n-ignore
  return u;
}

function tidyValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? exportNum(value) : null;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value).trim();
  if (!text) return null;
  if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) return exportNum(Number(text));
  return text;
}

function pointDay(point) {
  const x = Number(point && point.x);
  if (Number.isFinite(x)) return new Date(x).toISOString().slice(0, 10);
  return String((point && (point.label || point.day)) || '');
}

function seriesCoverage(data) {
  const days = (data || []).map(pointDay).filter(Boolean).sort();
  return { from: days[0] || '', to: days[days.length - 1] || '' };
}

function tidyRow({
  date,
  gameId,
  gameTitle,
  metric,
  value,
  unit,
  dataset,
  availableFrom,
  availableTo
}) {
  const parsed = tidyValue(value);
  if (parsed == null) return null;
  return {
    date: date || '',
    game_id: gameId == null ? '' : String(gameId),
    game_title: gameTitle || '',
    metric: metric || 'value',
    value: parsed,
    unit: unit || 'unknown',
    dataset: dataset || 'series',
    available_from: availableFrom || '',
    available_to: availableTo || ''
  };
}

const TIDY_COLUMNS = [
  { key: 'date' },
  { key: 'game_id' },
  { key: 'game_title' },
  { key: 'metric' },
  { key: 'value' },
  { key: 'unit' },
  { key: 'dataset' },
  { key: 'available_from' },
  { key: 'available_to' }
];

function pushTidy(rows, spec) {
  const row = tidyRow(spec);
  if (row) rows.push(row);
}

function seriesRows(series, { gameId = '', gameTitle = '', compare = false, metric = '' } = {}) {
  const rows = [];
  (series || []).forEach((item) => {
    const label = item.name || item.label || 'value';
    const metricKey = exportMetricKey(compare ? metric || item.metric || 'value' : label);
    const unit = exportUnitOf(metricKey, label, item.unit);
    const title = compare ? String(label) : gameTitle;
    const id = compare ? String(item.id || '') : gameId;
    const data = item.data || [];
    if (data.length) {
      const cover = seriesCoverage(data);
      data.forEach((point) => {
        // y = null/undefined пропускаем; y = 0 оставляем как реальный ноль.
        if (point == null || point.y == null || point.y === '') return;
        pushTidy(rows, {
          date: pointDay(point),
          gameId: id,
          gameTitle: title,
          metric: metricKey,
          value: point.y,
          unit,
          dataset: 'series',
          availableFrom: cover.from,
          availableTo: cover.to
        });
      });
      return;
    }
    if (item.label != null) {
      pushTidy(rows, {
        date: String(item.label),
        gameId: id,
        gameTitle: title,
        metric: metricKey,
        value: item.value,
        unit,
        dataset: 'series'
      });
      if (item.compare != null && item.compare !== '') {
        pushTidy(rows, {
          date: String(item.label),
          gameId: id,
          gameTitle: title,
          metric: `${metricKey}_compare`,
          value: item.compare,
          unit,
          dataset: 'series'
        });
      }
    }
  });
  return rows;
}

function chartSpec({ title, scope, gameId, period, metric, series, rows }) {
  const compare = scope === T('exportSpecs.scope.compare');
  const dataRows =
    rows ||
    seriesRows(series, {
      gameId,
      gameTitle: compare ? '' : scope || '',
      compare,
      metric
    });
  return {
    title,
    scope: scope || T('exportSpecs.scope.portfolio'),
    gameId: gameId || '',
    period,
    periodKey: period || '',
    periodLabel: period ? F().periodNoun(period) : '',
    metric: metric || title,
    columns: TIDY_COLUMNS,
    rows: (dataRows || []).filter(Boolean)
  };
}

function portfolioExportSpec() {
  const state = (window.FoundersApp && window.FoundersApp.state) || {};
  const games = state.games || [];
  const period = state.period || 'month';
  const playersMode = state.gamesPlayersMode || 'avg';
  const shareMetric = state.gamesShareMetric === 'earn' ? 'earn' : 'players';
  const totalPlayers = games.reduce((sum, game) => sum + (Number(periodPlayersOf(game, playersMode)) || 0), 0);
  const totalEarn = games.reduce((sum, game) => sum + periodEarnOf(game), 0);
  const view = { playersMode, shareMetric, totalPlayers, totalEarn };
  const rows = [];
  games.forEach((game) => {
    const players = periodPlayersOf(game, playersMode);
    const earnRaw = game.period_earn != null ? game.period_earn : game.latest_earn;
    const earn = earnRaw == null || earnRaw === '' ? null : Number(earnRaw);
    const share = gameShareOf(game, view);
    const base = {
      date: '',
      gameId: game.id,
      gameTitle: game.title || '',
      dataset: 'portfolio'
    };
    pushTidy(rows, { ...base, metric: 'status', value: String(game.status || ''), unit: 'text' });
    pushTidy(rows, {
      ...base,
      metric: playersMode === 'sum' ? 'players_sum' : 'players_avg',
      value: players,
      unit: 'count'
    });
    pushTidy(rows, {
      ...base,
      metric: 'earn',
      value: Number.isFinite(earn) ? earn : null,
      unit: 'RUB'
    });
    pushTidy(rows, { ...base, metric: 'share_pct', value: share, unit: 'pct' });
    if (players && Number.isFinite(earn)) {
      pushTidy(rows, {
        ...base,
        metric: 'earn_per_player',
        value: earn / players,
        unit: 'RUB'
      });
    }
  });
  return {
    title: 'portfolio',
    scope: T('exportSpecs.scope.portfolio'),
    period,
    periodKey: period,
    periodLabel: F().periodNoun(period),
    metric: 'portfolio',
    columns: TIDY_COLUMNS,
    rows
  };
}

function gameExportSpec(details, period) {
  const game = (details && details.game) || {};
  const gameId = String(game.id || '');
  const gameTitle = game.title || gameId || 'game';
  const snap = periodSnapshot(details);
  const grouped = (details && details.seriesGrouped) || {};
  const earnings = (details && details.earnings) || [];
  const earnSum = earnings.reduce((sum, row) => {
    const n = Number(row.earn);
    return Number.isFinite(n) ? sum + n : sum;
  }, 0);
  const rows = [];
  const push = (metric, value, unit, dataset = 'summary', date = '', cover = {}) => {
    pushTidy(rows, {
      date,
      gameId,
      gameTitle,
      metric,
      value,
      unit,
      dataset,
      availableFrom: cover.from,
      availableTo: cover.to
    });
  };

  push('players_avg', snap.playersAvg, 'count');
  push('players_new_avg', snap.playersNew, 'count');
  push('play_time_per_player', snap.play, 'min');
  push('game_ready_p50', snap.ready, 's');
  push('rating_ru', snap.ratingRu, 'score');
  push('rating_world', snap.ratingWorld, 'score');
  if (earnings.length) push('earn_period', earnSum, 'RUB');

  Object.keys(grouped)
    .sort()
    .forEach((name) => {
      seriesRows([{ name, data: grouped[name] || [] }], { gameId, gameTitle }).forEach((row) =>
        rows.push(row)
      );
    });

  (details.platforms || []).forEach((row) => {
    push(`platform_${exportMetricKey(platformLabel(row.platform))}`, row.players, 'count', 'platforms');
  });
  (details.geography || []).forEach((row) => {
    push(`country_${exportMetricKey(row.country)}`, row.players, 'count', 'geography');
  });
  earnings.forEach((row) => {
    if (row.earn == null || row.earn === '') return;
    push(
      'earn_bucket',
      row.earn,
      'RUB',
      'earnings',
      `${row.period_from || ''}..${row.period_to || ''}`,
      { from: row.period_from || '', to: row.period_to || '' }
    );
  });

  // Каталог инапов: цена SKU (количества по SKU кабинет не отдаёт).
  (details.purchases || []).forEach((row) => {
    const sku = String(row.product_id || row.title || '').trim();
    if (!sku) return;
    const key = exportMetricKey(sku);
    const day = row.observation_day || '';
    push(`iap_price_${key}`, row.price_value, row.price_code || 'YAN', 'purchases_catalog', day);
    if (row.title) push(`iap_title_${key}`, String(row.title), 'text', 'purchases_catalog', day);
  });

  // Агрегаты покупок (виджеты) + дневной ряд количества из metric_series.
  (details.purchaseMetrics || []).forEach((row) => {
    const slug = row.metric_slug || row.metric_title || 'purchase_metric';
    const unit = exportUnitOf(slug, row.metric_title || '', row.unit);
    push(
      exportMetricKey(slug),
      row.value,
      unit,
      'purchase_metrics',
      row.observation_day || ''
    );
  });

  (details.reviews || []).forEach((row) => {
    if (row.rating == null || row.rating === '') return;
    const day = row.review_time
      ? new Date(row.review_time > 1e12 ? row.review_time : row.review_time * 1000)
          .toISOString()
          .slice(0, 10)
      : '';
    push('review_rating', row.rating, 'score', 'reviews', day);
  });

  return {
    title: 'game_full',
    scope: gameTitle,
    gameId,
    period,
    periodKey: period || (details && details.period) || '',
    periodLabel: F().periodNoun(period || (details && details.period) || ''),
    metric: 'all',
    columns: TIDY_COLUMNS,
    rows,
    notes: {
      missing_is_null: true,
      iap_sku_counts: 'Yandex console does not expose per-SKU purchase counts; export iap_price_* catalog + inapp_purchases series totals',
      time_units: 'play_time* = minutes; game_ready* / time_to_interactive* = seconds'
    }
  };
}

function taxExportSpec({ rate, shift, rows }) {
  const out = [];
  (rows || []).forEach((r) => {
    const earnMonth = String(r.earnMonth || r.consoleMonth || '');
    const payMonth = String(r.payMonth || r.taxMonth || '');
    const base = {
      date: earnMonth ? `${earnMonth}-01` : '',
      gameId: '',
      gameTitle: '',
      dataset: 'tax'
    };
    if (earnMonth) {
      pushTidy(out, { ...base, metric: 'earn_month', value: earnMonth, unit: 'text' });
    }
    if (payMonth) {
      pushTidy(out, { ...base, metric: 'pay_month', value: payMonth, unit: 'text' });
    }
    pushTidy(out, { ...base, metric: 'console_earn', value: r.consoleEarn, unit: 'RUB' });
    pushTidy(out, { ...base, metric: 'fact_earn', value: r.taxEarn, unit: 'RUB' });
    pushTidy(out, { ...base, metric: 'tax_due', value: r.taxDue, unit: 'RUB' });
    const fact = r.taxEarn != null ? Number(r.taxEarn) : null;
    const due = r.taxDue != null ? Number(r.taxDue) : null;
    if (fact != null && Number.isFinite(fact) && due != null && Number.isFinite(due)) {
      pushTidy(out, { ...base, metric: 'net', value: fact - due, unit: 'RUB' });
    }
  });
  pushTidy(out, {
    date: '',
    gameId: '',
    gameTitle: '',
    metric: 'tax_rate_pct',
    value: rate,
    unit: 'pct',
    dataset: 'tax'
  });
  pushTidy(out, {
    date: '',
    gameId: '',
    gameTitle: '',
    metric: 'pay_shift_months',
    value: shift,
    unit: 'count',
    dataset: 'tax'
  });
  return {
    title: 'tax_sheet',
    scope: T('exportSpecs.scope.income'),
    period: '',
    periodKey: '',
    periodLabel: '',
    metric: 'tax',
    columns: TIDY_COLUMNS,
    rows: out,
    meta: {
      rate: Number(rate),
      shift: Number(shift)
    }
  };
}
