function squarifyHeatmap(items, width = 100, height = 100) {
  const total = items.reduce((s, d) => s + d.layoutValue, 0);
  if (!total || width <= 0 || height <= 0) return [];
  const nodes = items.map((d) => ({
    ...d,
    area: (d.layoutValue / total) * width * height
  }));
  const out = [];

  function worst(row, side) {
    const s = row.reduce((a, b) => a + b.area, 0);
    if (s <= 0) return Infinity;
    let rmax = 0;
    let rmin = Infinity;
    for (const d of row) {
      if (d.area > rmax) rmax = d.area;
      if (d.area < rmin) rmin = d.area;
    }
    return Math.max((side * side * rmax) / (s * s), (s * s) / (side * side * rmin));
  }

  function layoutRow(row, x, y, w, h, alongHeight) {
    const s = row.reduce((a, b) => a + b.area, 0) || 1;
    let offset = 0;
    for (const item of row) {
      const frac = item.area / s;
      if (alongHeight) {
        const rh = h * frac;
        out.push({ ...item, x, y: y + offset, w, h: rh });
        offset += rh;
      } else {
        const rw = w * frac;
        out.push({ ...item, x: x + offset, y, w: rw, h });
        offset += rw;
      }
    }
  }

  function step(list, x, y, w, h) {
    if (!list.length || w <= 0 || h <= 0) return;
    if (list.length === 1) {
      out.push({ ...list[0], x, y, w, h });
      return;
    }
    const side = Math.min(w, h);
    const row = [];
    let i = 0;
    while (i < list.length) {
      const trial = row.concat(list[i]);
      if (row.length && worst(trial, side) > worst(row, side)) break;
      row.push(list[i]);
      i += 1;
    }
    const rest = list.slice(i);
    const rowArea = row.reduce((a, b) => a + b.area, 0);
    if (w >= h) {
      const rw = Math.min(w, rowArea / h);
      layoutRow(row, x, y, rw, h, true);
      step(rest, x + rw, y, w - rw, h);
    } else {
      const rh = Math.min(h, rowArea / w);
      layoutRow(row, x, y, w, rh, false);
      step(rest, x, y + rh, w, h - rh);
    }
  }

  step(nodes, 0, 0, width, height);
  return out;
}

function heatGameItem(g, key, deltaKey) {
  const prevKey = key === 'earn' ? 'prev_earn' : 'prev_players';
  return {
    id: g.id,
    title: g.title || g.id,
    icon_url: g.icon_url,
    value: Number(g[key]) || 0,
    prevValue: g[prevKey] != null && Number.isFinite(Number(g[prevKey])) ? Number(g[prevKey]) : null,
    delta: g[deltaKey],
    isOther: false,
    children: null
  };
}

function withLayoutValue(d) {
  return {
    ...d,
    layoutValue: Math.pow(Math.max(d.value, 1e-6), 0.55)
  };
}

function makeOtherBucket(children, metric) {
  const list = [...children].sort((a, b) => b.value - a.value);
  const value = list.reduce((s, g) => s + g.value, 0);
  const n = list.length;
  return withLayoutValue({
    id: '__other__',
    title: T('heatmap.otherGames', { n, count: n }),
    icon_url: null,
    value,
    delta: null,
    isOther: true,
    children: list,
    metric
  });
}

function prepareHeatmapItems(games, key, deltaKey) {
  const sorted = [...games]
    .filter((g) => Number(g[key]) > 0)
    .sort((a, b) => Number(b[key]) - Number(a[key]));
  if (!sorted.length) return [];

  // Show up to top-10 separately when they fit; remainder → «Ещё».
  const TOP = 10;
  if (sorted.length <= TOP) {
    return sorted.map((g) => withLayoutValue(heatGameItem(g, key, deltaKey)));
  }

  const head = sorted.slice(0, TOP).map((g) => heatGameItem(g, key, deltaKey));
  const tail = sorted.slice(TOP).map((g) => heatGameItem(g, key, deltaKey));
  return [...head.map(withLayoutValue), makeOtherBucket(tail, key)];
}

function mergeIntoOther(items, victim) {
  const next = items.filter((d) => d.id !== victim.id);
  let other = next.find((d) => d.isOther);
  const child = {
    id: victim.id,
    title: victim.title,
    icon_url: victim.icon_url,
    value: victim.value,
    prevValue: victim.prevValue,
    delta: victim.delta
  };
  if (!other) {
    next.push(makeOtherBucket([child], null));
    return next;
  }
  const children = [...(other.children || []), child];
  const idx = next.findIndex((d) => d.isOther);
  next[idx] = makeOtherBucket(children, null);
  return next;
}

function heatmapSizeClass(area) {
  if (area >= 1800) return 'heat-lg';
  if (area >= 900) return 'heat-md';
  if (area >= 520) return 'heat-sm';
  return 'heat-xs';
}

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

function ensureHeatPopover() {
  let el = document.getElementById('heatPopover');
  if (!el) {
    el = document.createElement('div');
    el.id = 'heatPopover';
    el.className = 'chart-tooltip heat-popover';
    el.setAttribute('hidden', '');
    document.body.appendChild(el);
  } else if (!el.classList.contains('chart-tooltip')) {
    el.classList.add('chart-tooltip');
  }
  return el;
}

function openHeatPopover(el) {
  el.removeAttribute('hidden');
  // force reflow for enter transition
  void el.offsetWidth;
  el.classList.add('is-open');
}

function closeHeatPopover(el) {
  el.classList.remove('is-open');
  const done = () => {
    if (!el.classList.contains('is-open')) el.setAttribute('hidden', '');
    el.removeEventListener('transitionend', done);
  };
  el.addEventListener('transitionend', done);
  setTimeout(done, 280);
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

function ensureHeatSheet() {
  let el = document.getElementById('heatSheet');
  if (!el) {
    el = document.createElement('div');
    el.id = 'heatSheet';
    el.className = 'heat-sheet';
    el.hidden = true;
    el.innerHTML = `
      <div class="heat-sheet-backdrop" data-heat-sheet-close="1"></div>
      <div class="heat-sheet-panel" role="dialog" aria-modal="true" aria-label="${F().esc(T('heatmap.sheet.aria'))}">
        <div class="heat-sheet-head">
          <h3 id="heatSheetTitle">${T('heatmap.sheet.title')}</h3>
          <button type="button" class="btn" data-heat-sheet-close="1">${T('heatmap.sheet.close')}</button>
        </div>
        <div class="heat-sheet-body" id="heatSheetBody"></div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const close = e.target.closest('[data-heat-sheet-close]');
      if (close) {
        el.hidden = true;
        return;
      }
      const open = e.target.closest('[data-open]');
      if (open && open.dataset.open) {
        el.hidden = true;
        window.FoundersApp.openGame(open.dataset.open);
      }
    });
  }
  return el;
}

function openHeatOtherSheet(other, metric, payload) {
  const sheet = ensureHeatSheet();
  const kids = other.children || [];
  const title = document.getElementById('heatSheetTitle');
  const body = document.getElementById('heatSheetBody');
  if (title) title.textContent = other.title || T('heatmap.sheet.title');
  const curB = formatHeatBounds(payload && payload.currentBounds);
  const cmpB = formatHeatBounds(payload && payload.compareBounds);
  const compareLabel = (payload && payload.compareLabel) || '';
  body.innerHTML = `
    <div class="heat-sheet-meta muted">${T('heatmap.sheet.meta', {
      current: F().esc(curB),
      label: F().esc(compareLabel),
      compare: F().esc(cmpB)
    })}</div>
    <div class="heat-sheet-list">
      ${kids
        .map((c) => {
          const v = metric === 'earn' ? moneyFmt(c.value) : F().num(c.value, 0);
          const icon = c.icon_url
            ? `<img class="game-icon" src="${F().esc(c.icon_url)}" alt="" loading="lazy" />`
            : `<div class="game-icon placeholder">${F().esc(
                String(c.title || '?').slice(0, 1).toUpperCase()
              )}</div>`;
          return `<button type="button" class="heat-sheet-row" data-open="${F().esc(c.id)}">
            ${icon}
            <span class="heat-sheet-row-text">
              <strong>${F().esc(c.title || c.id)}</strong>
              <span class="muted mono">ID ${F().esc(c.id)}</span>
            </span>
            <b>${v}</b>
          </button>`;
        })
        .join('') || `<div class="empty">${T('heatmap.sheet.noGames')}</div>`}
    </div>`;
  sheet.hidden = false;
}

function bindHeatmapUi(root, payload, metric, itemsById) {
  const pop = ensureHeatPopover();
  let hideTimer = null;

  function hidePop() {
    closeHeatPopover(pop);
  }

  function showPop(cell, g) {
    clearTimeout(hideTimer);
    pop.innerHTML = heatmapPopoverHtml(g, metric, payload);
    const rect = cell.getBoundingClientRect();
    const pad = 12;
    pop.style.left = '-9999px';
    pop.style.top = '0px';
    openHeatPopover(pop);
    const pw = pop.offsetWidth || 280;
    const ph = pop.offsetHeight || 160;
    let left = rect.right + 10;
    let top = rect.top;
    if (left + pw > window.innerWidth - pad) left = rect.left - pw - 10;
    if (left < pad) left = Math.max(pad, Math.min(rect.left, window.innerWidth - pw - pad));
    if (top + ph > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - ph - pad);
    if (top < pad) top = pad;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;

    pop.querySelectorAll('[data-open]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        hidePop();
        if (btn.dataset.open) window.FoundersApp.openGame(btn.dataset.open);
      };
    });
  }

  root.querySelectorAll('.heatmap-cell[data-heat-id]').forEach((cell) => {
    const id = cell.dataset.heatId;
    const g = itemsById.get(id);
    if (!g) return;

    cell.onmouseenter = () => showPop(cell, g);
    cell.onmouseleave = () => {
      hideTimer = setTimeout(hidePop, 120);
    };
    cell.onfocus = () => showPop(cell, g);
    cell.onblur = () => {
      hideTimer = setTimeout(hidePop, 120);
    };

    if (g.isOther) {
      cell.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        hidePop();
        openHeatOtherSheet(g, metric, payload);
      };
    } else {
      // Клик по обычной плитке открывает игру. BindGamesUi плитки не трогает,
      // поэтому обработчик назначается только здесь.
      cell.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        hidePop();
        if (g.id) window.FoundersApp.openGame(g.id);
      };
    }
  });

  pop.onmouseenter = () => clearTimeout(hideTimer);
  pop.onmouseleave = () => {
    hideTimer = setTimeout(hidePop, 80);
  };
}

/** Уже посчитанная раскладка для тех же данных: поиск и сортировка её не трогают. */
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

/* Раскладка по реальному соотношению сторон контейнера:
   иначе квадратная сетка растягивается в прямоугольник и плитки «плывут». */
function applyHeatmapLayout(mapEl, itemsById) {
  if (!mapEl || !itemsById || !itemsById.size) return;
  const rect = mapEl.getBoundingClientRect();
  const W = Math.max(1, rect.width);
  const H = Math.max(1, rect.height);
  if (W < 24 || H < 24) return;

  const laid = squarifyHeatmap([...itemsById.values()], W, H);
  const cells = new Map();
  mapEl.querySelectorAll('.heatmap-cell').forEach((cell) => {
    if (cell.dataset.heatId != null) cells.set(cell.dataset.heatId, cell);
  });

  laid.forEach((g) => {
    const cell = cells.get(String(g.id));
    if (!cell) return;
    cell.style.left = `${((g.x / W) * 100).toFixed(4)}%`;
    cell.style.top = `${((g.y / H) * 100).toFixed(4)}%`;
    cell.style.width = `${((g.w / W) * 100).toFixed(4)}%`;
    cell.style.height = `${((g.h / H) * 100).toFixed(4)}%`;
    const normArea = ((g.w * g.h) / (W * H)) * 10000;
    const sizeClass = heatmapSizeClass(normArea);
    if (!cell.classList.contains(sizeClass)) {
      cell.classList.remove('heat-lg', 'heat-md', 'heat-sm', 'heat-xs');
      cell.classList.add(sizeClass);
    }
    fitHeatmapTile(cell, g.w, g.h, sizeClass);
  });
}

/**
 * Подгонка содержимого плитки под её реальную форму:
 * иконка масштабируется от меньшей стороны, название переносится в колонку
 * на вытянутых плитках и скрывается там, где места уже нет.
 */
function fitHeatmapTile(cell, w, h, sizeClass) {
  const pad = sizeClass === 'heat-lg' ? 10 : sizeClass === 'heat-xs' ? 6 : 8;
  // 4px — это --heat-gap у самой ячейки
  const contentW = Math.max(0, w - 4 - pad * 2);
  const contentH = Math.max(0, h - 4 - pad * 2);

  const fontSize = sizeClass === 'heat-lg' ? 13 : sizeClass === 'heat-xs' ? 10.5 : 11.5;
  const lineHeight = fontSize * 1.3;
  const metaHeight = 26;

  const minSide = Math.min(w, h);
  const icon = Math.round(Math.max(18, Math.min(56, minSide * 0.34)));
  cell.style.setProperty('--heat-icon', `${icon}px`);

  const canColumn = contentH >= icon + 8 + lineHeight * 2 + metaHeight;
  const rowRoom = contentW - icon - 8;
  const column = h >= w * 1.05 && canColumn;

  // Некуда ставить название — скрываем, иконка остаётся крупной
  const tooNarrow = contentW < 76;
  const tooShort = contentH < 44;
  const hideTitle = tooNarrow || tooShort || (!column && rowRoom < 72);

  cell.classList.toggle('heat-tall', column && !hideTitle);
  cell.classList.toggle('heat-narrow', hideTitle);

  const titleWidth = column ? contentW : Math.max(0, rowRoom);
  const headSpace = Math.max(0, contentH - (column ? icon + 8 : 0) - metaHeight);
  const byHeight = Math.floor(headSpace / lineHeight);
  const byWidth = Math.floor((titleWidth * 2.1) / fontSize);
  const lines = Math.max(1, Math.min(3, Math.min(byHeight || 1, byWidth || 1)));
  cell.style.setProperty('--heat-clamp', String(hideTitle ? 1 : lines));

  // Названия нет — отдаём освободившееся место иконке
  if (hideTitle) {
    const bigger = Math.round(Math.max(20, Math.min(64, minSide * 0.42)));
    if (bigger > icon) cell.style.setProperty('--heat-icon', `${bigger}px`);
  }
}

let heatResizeObserver = null;

function observeHeatmapResize(mapEl, itemsById) {
  if (heatResizeObserver) {
    heatResizeObserver.disconnect();
    heatResizeObserver = null;
  }
  if (typeof ResizeObserver !== 'function') return;
  let lastKey = '';
  heatResizeObserver = new ResizeObserver(() => {
    if (!mapEl.isConnected) {
      heatResizeObserver.disconnect();
      return;
    }
    const rect = mapEl.getBoundingClientRect();
    const key = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (key === lastKey) return;
    lastKey = key;
    applyHeatmapLayout(mapEl, itemsById);
  });
  heatResizeObserver.observe(mapEl);
}

/** Рендер карты в конкретный контейнер: раскладка, размеры текста. */
function mountHeatmap(heatMount, payload, metric, precomputed, { animate = false } = {}) {
  if (!heatMount) return null;

  // Данные и метрика не менялись (например, переключили тогл или сортировку) —
  if (
    heatMountCache.mount === heatMount &&
    heatMountCache.payload === payload &&
    heatMountCache.metric === metric &&
    heatMount.querySelector('.heatmap')
  ) {
    return heatMountCache.heat;
  }

  const heat = precomputed || heatmapHtml(payload, metric);
  heatMount.innerHTML = heat.html;
  const map = heatMount.querySelector('.heatmap');
  if (map) {
    applyHeatmapLayout(map, heat.itemsById);
    observeHeatmapResize(map, heat.itemsById);
    bindHeatmapUi(heatMount, payload, metric, heat.itemsById);
    if (animate) {
      // Анимация «прорисовки» только при входе в раздел.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => map.classList.add('is-drawn'));
      });
    } else {
      // При смене периода/фильтров плитки показываем сразу: кадр с opacity: 0
      // выглядел как моргание карты.
      map.classList.add('is-drawn');
    }
  }
  heatMountCache.mount = heatMount;
  heatMountCache.payload = payload;
  heatMountCache.metric = metric;
  heatMountCache.heat = heat;
  return heat;
}

let lastHeatmapPayload = null;

// Что сейчас смонтировано в контейнере карты: если payload/метрика те же,
const heatMountCache = {
  mount: null,
  payload: null,
  metric: null,
  heat: null
};

// Кэш DOM-узла панели «Доход по месяцам»: график не зависит от периода,
// поэтому при смене периода переиспользуем его без перерисовки.
const earnPanelCache = { sig: null, node: null };

/* —— Единый слой данных страницы «Игры» ——
   Всё, что нужно экрану, грузится одним запросом на пару
   (период + база сравнения) и кэшируется. Повторные рендеры
   (фильтр, поиск, сортировка) берут данные из кэша: без IPC
   и без пересборки DOM. */
const gamesModelCache = new Map();
// Предупреждаем об отказе get_data_coverage только один раз за сессию.
let coverageWarned = false;
const gamesModelInflight = new Map();
const GAMES_MODEL_CACHE_LIMIT = 4;
