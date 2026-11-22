/* Сравнение игр ----------------------------------------------------------- */

const COMPARE_COLORS = ['#3dd68c', '#a78bfa', '#f0a45d', '#5b8def', '#f472b6', '#38bdf8', '#fbbf24', '#c084fc'];
window.NamiData = Object.assign(window.NamiData || {}, { COMPARE_COLORS });

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
  return window.NamiStore.setCompareIds(ids);
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
  return window.NamiStore.compareExpand();
}

function saveCompareExpand(map) {
  window.NamiStore.setCompareExpand(map);
}

function loadCompareChartMetric() {
  return window.NamiStore.compareChartMetric();
}

function saveCompareChartMetric(map) {
  window.NamiStore.setCompareChartMetric(map);
}

function compareFmt(value, fmt) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  if (fmt === 'money') return moneyFmt(value);
  if (fmt === 'num0') return F().num(value, 0);
  return F().num(value);
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
