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

var EXTRA_CHARTS = {
  // game-ready уже в базовом графике раздела Ready
  ready: ['tti'],
  // revenue-ads / revenue-inapp уже в базовом графике раздела
  revenue: ['arpdau', 'paying', 'arppu', 'inapp-count', 'ads-impr'],
  conversion: ['ctr-my', 'ctr-wo', 'ctr-cover', 'ctp', 'playtime-conv']
}

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
