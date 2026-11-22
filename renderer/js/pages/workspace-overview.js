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
