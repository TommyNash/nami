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
