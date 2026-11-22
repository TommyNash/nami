function heatmapIconHtml(g) {
  if (g.isOther) {
    const kids = g.children || [];
    const shown = kids.slice(0, 3);
    const rest = kids.length - shown.length;
    if (!shown.length) {
      return `<span class="heatmap-icon placeholder" aria-hidden="true">+</span>`;
    }
    return `<span class="heatmap-icon-stack" aria-hidden="true">
      ${shown
        .map((c) =>
          c.icon_url
            ? `<img class="heatmap-icon" src="${F().esc(c.icon_url)}" alt="" loading="lazy" />`
            : `<span class="heatmap-icon placeholder">${F().esc(
                String(c.title || '?').slice(0, 1).toUpperCase()
              )}</span>`
        )
        .join('')}
      ${rest > 0 ? `<span class="heatmap-icon-more">+${rest}</span>` : ''}
    </span>`;
  }
  if (g.icon_url) {
    return `<img class="heatmap-icon" src="${F().esc(g.icon_url)}" alt="" loading="lazy" />`;
  }
  return `<span class="heatmap-icon placeholder" aria-hidden="true">${F().esc(
    String(g.title || '?').slice(0, 1).toUpperCase()
  )}</span>`;
}

function formatHeatBounds(b) {
  if (!b || !b.fromDay) return '—';
  const a = F().date(b.fromDay);
  const c = F().date(b.toDay || b.fromDay);
  return a === c ? a : `${a} → ${c}`;
}

function heatmapPopoverHtml(g, metric, payload) {
  const tipMetric = metric === 'earn' ? T('heatmap.metric.earn') : T('heatmap.metric.players');
  const valueText = metric === 'earn' ? moneyFmt(g.value) : F().num(g.value, 0);
  const hasDelta = g.delta != null && Number.isFinite(g.delta);
  const deltaText = hasDelta ? F().pct(g.delta, 0) : g.isOther ? T('heatmap.pop.tailSum') : T('heatmap.pop.noBase');
  const prevText =
    g.prevValue != null
      ? metric === 'earn'
        ? moneyFmt(g.prevValue)
        : F().num(g.prevValue, 0)
      : '—';
  const curB = formatHeatBounds(payload && payload.currentBounds);
  const cmpB = formatHeatBounds(payload && payload.compareBounds);
  const compareLabel = (payload && payload.compareLabel) || T('heatmap.pop.vsPrevious');
  const kids = g.isOther ? g.children || [] : [];
  const list =
    kids.length > 0
      ? `<div class="heat-pop-list">${kids
          .slice(0, 10)
          .map((c) => {
            const v = metric === 'earn' ? moneyFmt(c.value) : F().num(c.value, 0);
            return `<button type="button" class="heat-pop-item" data-open="${F().esc(c.id)}">
              <span>${F().esc(String(c.title || c.id))}</span><b>${v}</b>
            </button>`;
          })
          .join('')}${
          kids.length > 10
            ? `<div class="tip-note">${T('heatmap.pop.andMore', { count: kids.length - 10 })}</div>`
            : ''
        }</div>`
      : '';

  const Charts = window.FoundersCharts;
  const body =
    Charts && Charts.tipBodyHtml
      ? Charts.tipBodyHtml({
          title: String(g.title || g.id),
          rows: [
            {
              name: tipMetric,
              value: valueText,
              color: metric === 'earn' ? '#3dd68c' : '#6ea8fe',
              deltaPct: hasDelta ? g.delta : null,
              deltaNote: compareLabel
            },
            {
              name: T('heatmap.pop.was', { label: compareLabel }),
              value: prevText,
              color: '#8a8a8a'
            },
            !hasDelta ? { name: T('heatmap.pop.change'), value: deltaText } : null
          ],
          note: T('heatmap.pop.note', { current: F().esc(curB), compare: F().esc(cmpB) })
        })
      : `<div class="chart-tooltip-date">${F().esc(String(g.title || g.id))}</div>`;

  return `
    ${body}
    ${list}
    ${
      g.isOther
        ? `<div class="tip-note">${T('heatmap.pop.otherHint')}</div>`
        : ''
    }
  `;
}

function gamesSkeletonHtml() {
  return `
    <div class="home sk-page">
      <div class="home-hero">
        <div class="sk sk-title"></div>
        <div class="sk sk-line"></div>
      </div>
      <div class="kpi-row">
        ${Array.from({ length: 4 }, () => `<div class="kpi-card sk-card"><div class="sk sk-label"></div><div class="sk sk-value"></div><div class="sk sk-sub"></div></div>`).join('')}
      </div>
      <div class="home-grid home-grid-2">
        <div class="panel stretch">
          <div class="panel-head"><div class="sk sk-heading"></div><div class="sk sk-filters"></div></div>
          <div class="panel-body"><div class="sk sk-heatmap"></div></div>
        </div>
        <div class="panel panel-chart">
          <div class="panel-head"><div class="sk sk-heading"></div></div>
          <div class="panel-body"><div class="sk sk-chart"></div></div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><div class="sk sk-heading"></div></div>
        <div class="panel-body sk-table">
          ${Array.from({ length: 6 }, () => `<div class="sk sk-row"></div>`).join('')}
        </div>
      </div>
    </div>`;
}

function kpiSkeletonCardHtml() {
  return `<div class="kpi-card sk-card"><div class="sk sk-label"></div><div class="sk sk-value"></div><div class="sk sk-sub"></div></div>`;
}

function overviewSkeletonHtml() {
  return `
    <div class="sk-page">
      <div class="toolbar-row">
        <div>
          <div class="sk sk-kicker"></div>
          <div class="sk sk-title"></div>
        </div>
        <div class="sk sk-filters"></div>
      </div>
      <div class="sk sk-note"></div>
      <div class="grid-cards">
        ${Array.from(
          { length: 4 },
          () =>
            `<div class="card sk-card"><div class="sk sk-label"></div><div class="sk sk-value"></div><div class="sk sk-sub"></div></div>`
        ).join('')}
      </div>
      <div class="split">
        <div class="panel">
          <div class="panel-head"><div class="sk sk-heading"></div></div>
          <div class="panel-body sk-table">
            ${Array.from({ length: 5 }, () => `<div class="sk sk-row"></div>`).join('')}
          </div>
        </div>
        <div class="panel">
          <div class="panel-head"><div class="sk sk-heading"></div></div>
          <div class="panel-body"><div class="sk sk-value"></div><div class="sk sk-sub"></div></div>
        </div>
      </div>
    </div>`;
}

function workspaceSkeletonHtml() {
  return `
    <div class="sk-page">
      <div class="workspace-head compact">
        <div class="tabs workspace-tabs">
          ${Array.from({ length: 5 }, () => `<div class="sk sk-tab"></div>`).join('')}
        </div>
      </div>
      <div class="game-report">
        <aside class="layers">
          <div class="sk sk-mini-label"></div>
          ${Array.from({ length: 5 }, () => `<div class="sk sk-row" style="height:44px"></div>`).join('')}
        </aside>
        <section class="report-main">
          <div class="panel panel-chart">
            <div class="panel-head"><div class="sk sk-heading"></div></div>
            <div class="panel-body"><div class="sk sk-chart" style="height:min(42vh,320px);min-height:240px"></div></div>
          </div>
          <div class="report-bottom">
            ${Array.from({ length: 6 }, () => `<div class="panel"><div class="panel-body"><div class="sk sk-chart" style="height:140px"></div></div></div>`).join('')}
          </div>
        </section>
        <aside class="report-side">
          ${Array.from({ length: 4 }, kpiSkeletonCardHtml).join('')}
        </aside>
      </div>
    </div>`;
}

function compareSkeletonHtml() {
  return `
    <div class="sk-page home compare-page">
      <div class="home-hero">
        <div class="sk sk-title" style="height:32px;width:280px"></div>
        <div class="sk sk-sub" style="height:16px;width:420px;margin-top:10px"></div>
      </div>
      <div class="compare-bar">
        ${Array.from({ length: 3 }, () => `<div class="sk" style="height:40px;width:160px;border-radius:999px"></div>`).join('')}
        <div class="sk" style="height:40px;width:140px;border-radius:999px"></div>
      </div>
      <div class="panel" style="margin-bottom:14px">
        <div class="panel-body sk-table">
          ${Array.from({ length: 8 }, () => `<div class="sk sk-row"></div>`).join('')}
        </div>
      </div>
      <div class="home-grid home-grid-2">
        <div class="panel panel-chart"><div class="panel-body"><div class="sk sk-chart" style="height:min(36vh,280px);min-height:220px"></div></div></div>
        <div class="panel"><div class="panel-body"><div class="sk sk-heading"></div>${Array.from({ length: 4 }, () => `<div class="sk sk-row" style="margin-top:10px"></div>`).join('')}</div></div>
      </div>
    </div>`;
}

function pageSkeletonHtml(pageKey) {
  if (pageKey === 'games') return gamesSkeletonHtml();
  if (pageKey === 'overview') return overviewSkeletonHtml();
  if (pageKey === 'workspace') return workspaceSkeletonHtml();
  if (pageKey === 'compare') return compareSkeletonHtml();
  if (pageKey === 'tax') {
    return `<div class="tax-page sk-page">
      <div class="home-hero"><div class="sk" style="height:32px;width:200px;border-radius:8px"></div>
      <div class="sk" style="height:14px;width:280px;border-radius:6px;margin-top:8px"></div></div>
      <div class="kpi-row">${Array.from({ length: 4 }, () => kpiSkeletonCardHtml()).join('')}</div>
      <div class="panel"><div class="panel-body"><div class="sk" style="height:320px;width:100%;border-radius:12px"></div></div></div>
    </div>`;
  }
  if (pageKey === 'settings') {
    return `<div class="settings-page sk-page">
      <div class="home-hero settings-hero"><div class="sk" style="height:32px;width:180px;border-radius:8px"></div></div>
      <section class="settings-section">
        <div class="sk" style="height:18px;width:140px;border-radius:6px"></div>
        <div class="sk" style="height:12px;width:220px;border-radius:6px;margin-top:6px"></div>
        <div class="sk" style="height:72px;width:100%;border-radius:16px;margin-top:10px"></div>
        <div class="sk" style="height:160px;width:100%;border-radius:16px;margin-top:10px"></div>
      </section>
      <section class="settings-section">
        <div class="sk" style="height:18px;width:100px;border-radius:6px"></div>
        <div class="sk" style="height:180px;width:100%;border-radius:16px;margin-top:10px"></div>
      </section>
    </div>`;
  }
  return '';
}

function heatmapView(payload, metric = 'players') {
  if (
    heatMountCache.payload === payload &&
    heatMountCache.metric === metric &&
    heatMountCache.heat
  ) {
    return heatMountCache.heat;
  }
  return heatmapHtml(payload, metric);
}

function heatmapHtml(payload, metric = 'players') {
  const games = (payload && payload.games) || [];
  const key = metric === 'earn' ? 'earn' : 'players';
  const deltaKey = metric === 'earn' ? 'earn_delta_pct' : 'players_delta_pct';
  let items = prepareHeatmapItems(games, key, deltaKey);
  if (!items.length) {
    return {
      html: `<div class="empty">${
        metric === 'earn' ? T('heatmap.emptyEarn') : T('heatmap.emptyPlayers')
      }</div>`,
      itemsById: new Map()
    };
  }

  // Merge smallest named tiles into «Ещё» until all tiles stay readable.
  const MIN_AREA = 520;
  for (let i = 0; i < 12 && items.length > 5; i += 1) {
    const laid = squarifyHeatmap(items);
    const tiny = laid
      .filter((c) => c.w * c.h < MIN_AREA && !c.isOther)
      .sort((a, b) => a.w * a.h - b.w * b.h);
    if (!tiny.length) break;
    const victim = items.find((d) => d.id === tiny[0].id);
    if (!victim) break;
    items = mergeIntoOther(items, victim);
  }

  const max = Math.max(...items.map((g) => g.value), 1);
  const laid = squarifyHeatmap(items);
  const itemsById = new Map(items.map((d) => [String(d.id), d]));

  const html = `<div class="heatmap" role="img" aria-label="${
    F().esc(metric === 'earn' ? T('heatmap.ariaEarn') : T('heatmap.ariaPlayers'))
  }">${laid
    .map((g) => {
      const value = g.value;
      const share = value / max;
      const area = g.w * g.h;
      const sizeClass = heatmapSizeClass(area);
      const delta = g.delta;
      let tone = 'flat';
      if (delta != null && Number.isFinite(delta)) {
        if (delta > 3) tone = 'up';
        else if (delta < -3) tone = 'down';
      } else if (g.isOther) {
        tone = 'cool';
      } else {
        tone = share > 0.55 ? 'hot' : share > 0.25 ? 'warm' : 'cool';
      }
      const hasDelta = delta != null && Number.isFinite(delta);
      const deltaText = hasDelta ? F().pct(delta, 0) : g.isOther ? T('heatmap.tile.list') : '—';
      const deltaClass = !hasDelta ? 'muted' : delta < 0 ? 'neg' : delta > 0 ? 'pos' : 'flat';
      const valueText = metric === 'earn' ? moneyFmt(value) : F().num(value, 0);
      const title = String(g.title || g.id || T('heatmap.tile.untitled'));
      const openAttr = g.isOther ? '' : ` data-open="${F().esc(g.id)}"`;
      const style = `left:${g.x.toFixed(3)}%;top:${g.y.toFixed(3)}%;width:${g.w.toFixed(
        3
      )}%;height:${g.h.toFixed(3)}%`;
      return `<button type="button" class="heatmap-cell ${tone} ${sizeClass}${
        g.isOther ? ' heat-other' : ''
      }" style="${style}" data-heat-id="${F().esc(String(g.id))}"${openAttr} aria-label="${F().esc(
        title
      )}: ${valueText}, ${deltaText}">
        <span class="heatmap-inner">
          <span class="heatmap-head">
            ${heatmapIconHtml(g)}
            <span class="heatmap-title">${F().esc(title)}</span>
          </span>
          <span class="heatmap-meta">
            <span class="heatmap-value">${valueText}</span>
            <span class="heatmap-delta ${deltaClass}">${hasDelta ? deltaText : g.isOther ? T('heatmap.tile.open') : '—'}</span>
          </span>
        </span>
      </button>`;
    })
    .join('')}</div>`;

  return { html, itemsById };
}
