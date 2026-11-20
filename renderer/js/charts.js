/** Убрать дубли по X — иначе сплайн петляет назад. */
function dedupeCoords(coords) {
  const out = [];
  for (let i = 0; i < (coords || []).length; i += 1) {
    const c = coords[i];
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    if (!out.length || Math.abs(out[out.length - 1][0] - c[0]) > 0.05) out.push([c[0], c[1]]);
    else out[out.length - 1][1] = c[1];
  }
  return out;
}

/**
 * Монотонный кубический сплайн (Fritsch–Carlson).
 * Не уходит за локальные экстремумы и не плетётся назад по X —
 * в отличие от Catmull-Rom, который на пиках проваливался к нулю.
 */
function smoothPath(rawCoords) {
  const coords = dedupeCoords(rawCoords);
  if (coords.length < 2) return '';
  const fmt = (n) => Number(n).toFixed(1);
  if (coords.length === 2) {
    return `M${fmt(coords[0][0])} ${fmt(coords[0][1])} L${fmt(coords[1][0])} ${fmt(coords[1][1])}`;
  }

  const n = coords.length;
  const dx = new Array(n - 1);
  const m = new Array(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    dx[i] = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    m[i] = dx[i] !== 0 ? dy / dx[i] : 0;
  }

  const slopes = new Array(n);
  slopes[0] = m[0];
  slopes[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    slopes[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  }

  for (let i = 0; i < n - 1; i += 1) {
    if (Math.abs(m[i]) < 1e-12) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
      continue;
    }
    const a = slopes[i] / m[i];
    const b = slopes[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      slopes[i] = t * a * m[i];
      slopes[i + 1] = t * b * m[i];
    }
  }

  let d = `M${fmt(coords[0][0])} ${fmt(coords[0][1])}`;
  for (let i = 0; i < n - 1; i += 1) {
    const x0 = coords[i][0];
    const y0 = coords[i][1];
    const x1 = coords[i + 1][0];
    const y1 = coords[i + 1][1];
    const h = x1 - x0;
    if (!(h > 0)) {
      d += ` L${fmt(x1)} ${fmt(y1)}`;
      continue;
    }
    // Контрольные точки всегда между x0 и x1 — без отката назад.
    const c1x = x0 + h / 3;
    const c1y = y0 + (slopes[i] * h) / 3;
    const c2x = x1 - h / 3;
    const c2y = y1 - (slopes[i + 1] * h) / 3;
    d += ` C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(x1)} ${fmt(y1)}`;
  }
  return d;
}

/** Единый шаблон ховера для всех графиков. */
function tipDeltaHtml(deltaPct, note = T('charts.tip.vsPrevDay')) {
  if (deltaPct == null || !Number.isFinite(Number(deltaPct))) return '';
  return `<div class="tip-delta ${Number(deltaPct) >= 0 ? 'up' : 'down'}">${formatPct(
    Number(deltaPct),
    0
  )} <em>${escapeHtml(note)}</em></div>`;
}

function tipRowHtml({ color, name, value, deltaPct, deltaNote, solo } = {}) {
  const hasColor = !!(color && String(color).trim());
  const hasName = name != null && String(name).trim() !== '';
  const cls = `tip-row${solo || (!hasColor && !hasName) ? ' is-solo' : ''}${
    hasColor ? '' : ' no-swatch'
  }`;
  return `<div class="${cls}">
    ${hasColor ? `<i style="background:${escapeHtml(String(color))}"></i>` : '<i class="is-empty"></i>'}
    ${hasName ? `<span class="tip-name">${escapeHtml(String(name))}</span>` : '<span class="tip-name"></span>'}
    <b class="tip-val">${value == null ? '—' : value}</b>
    ${tipDeltaHtml(deltaPct, deltaNote)}
  </div>`;
}

function tipBodyHtml({ title, rows, note } = {}) {
  const list = (rows || []).filter(Boolean);
  const rowsHtml = list
    .map((r) =>
      tipRowHtml({
        color: r.color,
        name: r.name,
        value: r.value,
        deltaPct: r.deltaPct,
        deltaNote: r.deltaNote,
        solo: r.solo === true || (list.length === 1 && !r.name && !r.color)
      })
    )
    .join('');
  return `${
    title ? `<div class="chart-tooltip-date">${escapeHtml(String(title))}</div>` : ''
  }${rowsHtml}${
    note ? `<div class="tip-note">${typeof note === 'string' ? note : String(note)}</div>` : ''
  }`;
}

function tipPreferredWidth(rowCount, hostWidth) {
  const n = Math.max(1, Number(rowCount) || 1);
  const base = n >= 3 ? 280 : n === 2 ? 250 : 220;
  if (hostWidth > 0) return Math.min(360, Math.max(base, Math.min(hostWidth * 0.45, 360)));
  return base;
}

function placeTooltip(tipEl, wrapEl, preferred = {}) {
  if (!tipEl || !wrapEl) return;
  const tipW =
    preferred.width ||
    tipPreferredWidth(tipEl.querySelectorAll('.tip-row').length, wrapEl.clientWidth || 0);
  tipEl.style.width = `${tipW}px`;
  tipEl.style.maxWidth = `${Math.min(380, Math.max(200, wrapEl.clientWidth || tipW))}px`;

  let left = Number.isFinite(preferred.left) ? preferred.left : tipEl.offsetLeft || 8;
  let top = Number.isFinite(preferred.top) ? preferred.top : tipEl.offsetTop || 8;
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;

  const tipH = tipEl.offsetHeight || 48 + tipEl.querySelectorAll('.tip-row').length * 48;
  const wrapW = wrapEl.clientWidth || tipW;
  const wrapH = wrapEl.clientHeight || tipH;
  const anchorX = Number.isFinite(preferred.anchorX) ? preferred.anchorX : left;
  const anchorY = Number.isFinite(preferred.anchorY) ? preferred.anchorY : top;
  if (left + tipW > wrapW - 8) left = Math.max(8, anchorX - tipW - 14);
  if (left + tipW > wrapW - 8) left = Math.max(8, wrapW - tipW - 8);
  if (left < 8) left = 8;
  if (top + tipH > wrapH - 8) top = Math.max(8, anchorY - tipH - 12);
  if (top + tipH > wrapH - 8) top = Math.max(8, wrapH - tipH - 8);
  if (top < 8) top = 8;
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;

  const tipRect = tipEl.getBoundingClientRect();
  const margin = 10;
  left = tipEl.offsetLeft;
  top = tipEl.offsetTop;
  if (tipRect.right > window.innerWidth - margin) left -= tipRect.right - (window.innerWidth - margin);
  if (tipRect.left < margin) left += margin - tipRect.left;
  if (tipRect.bottom > window.innerHeight - margin) {
    top -= tipRect.bottom - (window.innerHeight - margin);
  }
  if (tipRect.top < margin) top += margin - tipRect.top;
  const maxLeft = Math.max(0, wrapW - tipEl.offsetWidth);
  const maxTop = Math.max(0, wrapH - tipEl.offsetHeight);
  tipEl.style.left = `${Math.round(Math.max(0, Math.min(left, maxLeft)))}px`;
  tipEl.style.top = `${Math.round(Math.max(0, Math.min(top, maxTop)))}px`;
}

function fillTooltip(tipEl, wrapEl, { title, rows, note, left, top, anchorX, width } = {}) {
  if (!tipEl) return;
  tipEl.hidden = false;
  tipEl.innerHTML = tipBodyHtml({ title, rows, note });
  placeTooltip(tipEl, wrapEl, { left, top, anchorX, width });
}

window.FoundersCharts = {
  smoothPath,
  tipRowHtml,
  tipBodyHtml,
  placeTooltip,
  fillTooltip,

  line(container, seriesList, opts = {}) {
    // Повторный mount в тот же container (смена фильтра сравнения и т.п.):
    // старые mousemove-слушатели держали прошлый seriesList и при ховере
    // перерисовывали «старый» график поверх нового.
    if (typeof container.__faLineCleanup === 'function') {
      try {
        container.__faLineCleanup();
      } catch (_) {
        /* ignore */
      }
      container.__faLineCleanup = null;
    }
    container.__faLinePointerBound = false;

    const width = opts.width || container.clientWidth || 640;
    const height = opts.height || 240;
    const palette = opts.colors || ['#3dd68c', '#5b8def', '#e3a93a', '#f472b6', '#a78bfa'];
    const colors = (seriesList || []).map(
      (s, i) => (s && s.color) || palette[i % palette.length]
    );
    const formatY = opts.formatY || formatNum;
    const formatYRight = opts.formatYRight || formatY;
    const formatX = opts.formatX || formatMaybeDate;
    const showAnalysis = opts.analysis !== false;
    const trendWindow = Math.max(3, Number(opts.trendWindow) || 7);
    const normalizeX = opts.normalizeX !== false;
    const nonNegative = opts.nonNegative !== false;
    const avgToggle = opts.avgToggle === true;
    const weekendToggle = opts.weekendToggle !== false;
    let showAvg = opts.showAvg === true;
    let showWeekend = opts.showWeekend === true;
    let showTrend = opts.trend === true;
    const smooth = opts.smooth !== false;
    const showDots = opts.dots === true;
    const tipNote = opts.tipNote === true;
    const brushEnabled = opts.brush !== false;
    const toolsHost = opts.toolsHost || null;

    const axes = assignAxes(seriesList, opts);
    const dual = axes.some((a) => a === 'right') && axes.some((a) => a === 'left');
    const pad = { t: 18, r: dual ? 52 : 16, b: 36, l: 52 };
    const navH = 52;

    const enabled = new Set((seriesList || []).map((_, i) => i));
    let tipX = null;
    let tipPointer = null; // { x, y } в координатах .chart-wrap — табличка следует за курсором
    const xWindow = normalizeX ? activeXWindow(seriesList) : null;
    let brush = null; // { minX, maxX } в единицах данных
    let brushDrag = null;
    let brushMoveHandler = null;
    let brushUpHandler = null;
    let alive = true;
    // Актуальная геометрия плота для стабильных pointer-слушателей на container.
    const plot = {
      width,
      height,
      pad,
      minX: 0,
      xSpan: 1
    };

    function basePoints(idx) {
      let pts = ((seriesList[idx] && seriesList[idx].data) || []).filter(
        (p) => Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))
      );
      if (xWindow) {
        pts = pts.filter((p) => Number(p.x) >= xWindow.minX && Number(p.x) <= xWindow.maxX);
      }
      return pts.sort((a, b) => Number(a.x) - Number(b.x));
    }

    function fullXDomain() {
      const xs = (seriesList || []).flatMap((_, idx) => basePoints(idx).map((p) => Number(p.x)));
      if (!xs.length) return null;
      return { minX: Math.min(...xs), maxX: Math.max(...xs) };
    }

    function ensureBrush() {
      const full = fullXDomain();
      if (!full) {
        brush = null;
        return null;
      }
      const span = full.maxX - full.minX;
      if (!brushEnabled || span <= 0 || xsCount() < 6) {
        brush = { minX: full.minX, maxX: full.maxX };
        return full;
      }
      if (!brush) brush = { minX: full.minX, maxX: full.maxX };
      brush.minX = Math.max(full.minX, Math.min(brush.minX, full.maxX));
      brush.maxX = Math.min(full.maxX, Math.max(brush.maxX, full.minX));
      if (brush.maxX < brush.minX) {
        const t = brush.minX;
        brush.minX = brush.maxX;
        brush.maxX = t;
      }
      return full;
    }

    function xsCount() {
      const set = new Set();
      (seriesList || []).forEach((_, idx) => {
        basePoints(idx).forEach((p) => set.add(Number(p.x)));
      });
      return set.size;
    }

    function seriesPoints(idx) {
      if (!enabled.has(idx)) return [];
      let pts = basePoints(idx);
      if (brush) {
        pts = pts.filter((p) => Number(p.x) >= brush.minX && Number(p.x) <= brush.maxX);
      }
      return pts;
    }

    function visiblePoints() {
      return (seriesList || []).flatMap((_, idx) => seriesPoints(idx));
    }

    function clampBrush(nextMin, nextMax, full) {
      const span = full.maxX - full.minX || 1;
      const minSpan = Math.max(span * 0.03, span > 1e11 ? 86400000 : span * 0.03);
      const mode = brushDrag && brushDrag.mode;
      if (mode === 'move') {
        const w = Math.max(minSpan, brushDrag.to0 - brushDrag.from0);
        let a = nextMin;
        if (a < full.minX) a = full.minX;
        if (a + w > full.maxX) a = full.maxX - w;
        brush = { minX: a, maxX: a + w };
        return;
      }
      let a = Math.max(full.minX, Math.min(nextMin, full.maxX));
      let b = Math.max(full.minX, Math.min(nextMax, full.maxX));
      if (b < a) {
        const t = a;
        a = b;
        b = t;
      }
      if (b - a < minSpan) {
        if (mode === 'left') a = Math.max(full.minX, b - minSpan);
        else b = Math.min(full.maxX, a + minSpan);
      }
      brush = { minX: a, maxX: b };
    }

    function yDomain(side) {
      const ys = (seriesList || [])
        .flatMap((s, idx) => (axes[idx] === side ? seriesPoints(idx) : []))
        .map((p) => Number(p.y));
      if (!ys.length) return { min: 0, max: 1 };
      let minY = Math.min(...ys);
      let maxY = Math.max(...ys);
      if (nonNegative && minY >= 0) minY = 0;
      if (minY === maxY) {
        const padY = Math.abs(minY) * 0.12 || 1;
        if (!(nonNegative && minY >= 0)) minY -= padY;
        maxY += padY;
      } else {
        const span = maxY - minY || 1;
        if (!(nonNegative && minY === 0)) minY -= span * 0.04;
        maxY += span * 0.08;
      }
      if (nonNegative && minY < 0 && Math.min(...ys) >= 0) minY = 0;
      return { min: minY, max: maxY };
    }

    function render() {
      if (!alive) return;
      const full = ensureBrush();
      const allPoints = visiblePoints();
      if (!allPoints.length) {
        container.innerHTML = `<div class="empty">${T('charts.noChartData')}</div>`;
        return;
      }

      const xs = allPoints.map((p) => Number(p.x));
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const showBrush = Boolean(
        brushEnabled && full && xsCount() >= 6 && full.maxX > full.minX
      );
      const left = yDomain('left');
      const right = dual ? yDomain('right') : left;
      const xSpan = maxX - minX || 1;
      plot.width = width;
      plot.height = height;
      plot.pad = pad;
      plot.minX = minX;
      plot.xSpan = xSpan;
      const leftSpan = left.max - left.min || 1;
      const rightSpan = right.max - right.min || 1;
      const sx = (x) => pad.l + ((x - minX) / xSpan) * (width - pad.l - pad.r);
      const syLeft = (y) => pad.t + (1 - (y - left.min) / leftSpan) * (height - pad.t - pad.b);
      const syRight = (y) => pad.t + (1 - (y - right.min) / rightSpan) * (height - pad.t - pad.b);
      const syFor = (idx, y) => (axes[idx] === 'right' ? syRight(y) : syLeft(y));

      const gridLeft = [0, 0.25, 0.5, 0.75, 1]
        .map((t) => {
          const y = pad.t + t * (height - pad.t - pad.b);
          const val = left.max - t * leftSpan;
          return `
            <line x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" stroke="#2a2a2a" stroke-dasharray="3 4" />
            <text x="${pad.l - 8}" y="${y + 3}" fill="#a0a0a0" font-size="10" text-anchor="end">${formatY(val)}</text>
          `;
        })
        .join('');

      const gridRight = dual
        ? [0, 0.25, 0.5, 0.75, 1]
            .map((t) => {
              const y = pad.t + t * (height - pad.t - pad.b);
              const val = right.max - t * rightSpan;
              return `<text x="${width - pad.r + 8}" y="${y + 3}" fill="#8a8a8a" font-size="11" text-anchor="start">${formatYRight(
                val
              )}</text>`;
            })
            .join('')
        : '';

      const avgGuides = showAvg
        ? (seriesList || [])
            .map((series, idx) => {
              if (!enabled.has(idx)) return '';
              const pts = seriesPoints(idx);
              if (pts.length < 2) return '';
              const avg = pts.reduce((s, p) => s + Number(p.y), 0) / pts.length;
              const y = syFor(idx, avg);
              const color = colors[idx % colors.length];
              return `<line class="chart-avg-line" x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" stroke="${color}" stroke-width="1.2" stroke-dasharray="2 5" opacity="0.55" />
                <text x="${width - pad.r - 4}" y="${y - 4}" fill="${color}" font-size="9" text-anchor="end" opacity="0.85">${T('charts.avgShort')} ${
                  axes[idx] === 'right' ? formatYRight(avg) : formatY(avg)
                }</text>`;
            })
            .join('')
        : '';

      const dateAxis = looksLikeDateAxis(
        full ? full.minX : minX,
        full ? full.maxX : maxX
      );
      const weekendHtml =
        showWeekend && dateAxis
          ? weekendBands(minX, maxX)
              .map((b) => {
                const x1 = sx(b.x1);
                const x2 = sx(b.x2);
                const w = Math.max(1, x2 - x1);
                return `<rect class="chart-weekend-band" x="${x1.toFixed(1)}" y="${pad.t}" width="${w.toFixed(
                  1
                )}" height="${height - pad.t - pad.b}" />`;
              })
              .join('')
          : '';

      const paths = seriesList
        .map((series, idx) => {
          if (!enabled.has(idx)) return '';
          const pts = seriesPoints(idx)
            .filter((p) => Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
            .sort((a, b) => a.x - b.x);
          if (!pts.length) return '';
          const color = colors[idx % colors.length];
          const coords = pts.map((p) => [sx(p.x), syFor(idx, Number(p.y))]);
          const d = smooth
            ? smoothPath(coords)
            : dedupeCoords(coords)
                .map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`)
                .join(' ');
          const dots = showDots
            ? pts
                .map(
                  (p) =>
                    `<circle class="chart-dot" data-s="${idx}" data-x="${p.x}" data-y="${p.y}" cx="${sx(p.x).toFixed(
                      1
                    )}" cy="${syFor(idx, Number(p.y)).toFixed(1)}" r="3" fill="${color}" />`
                )
                .join('')
            : '';
          let trendPath = '';
          if (showTrend && pts.length >= trendWindow) {
            const ma = movingAverage(pts, trendWindow);
            if (ma.length > 1) {
              const tcoords = ma.map((p) => [sx(p.x), syFor(idx, Number(p.y))]);
              const td = smooth
                ? smoothPath(tcoords)
                : tcoords
                    .map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`)
                    .join(' ');
              trendPath = `<path d="${td}" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="5 4" opacity="0.55" />`;
            }
          }
          return `${trendPath}<path class="chart-line-path" d="${d}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />${dots}`;
        })
        .join('');

      let tipHtml = '';
      let guide = '';
      let hoverDots = '';
      if (tipX != null && allPoints.length) {
        const nearest = allPoints.reduce((best, p) =>
          Math.abs(Number(p.x) - tipX) < Math.abs(Number(best.x) - tipX) ? p : best
        );
        const nx = Number(nearest.x);
        guide = `<line x1="${sx(nx)}" y1="${pad.t}" x2="${sx(nx)}" y2="${height - pad.b}" stroke="#555" stroke-dasharray="4 3" />`;
        const tipItems = seriesList
          .map((s, idx) => {
            if (!enabled.has(idx)) return null;
            const pts = seriesPoints(idx).sort((a, b) => a.x - b.x);
            if (!pts.length) return null;
            let nearestIdx = 0;
            for (let i = 1; i < pts.length; i += 1) {
              if (Math.abs(Number(pts[i].x) - nx) < Math.abs(Number(pts[nearestIdx].x) - nx)) nearestIdx = i;
            }
            const p = pts[nearestIdx];
            const prev = nearestIdx > 0 ? pts[nearestIdx - 1] : null;
            const yVal = Number(p.y);
            if (!Number.isFinite(yVal)) return null;
            const color = colors[idx % colors.length];
            const fmt = axes[idx] === 'right' ? formatYRight : formatY;
            const delta = prev ? yVal - Number(prev.y) : null;
            const deltaPct =
              prev && Number(prev.y) !== 0 ? (delta / Math.abs(Number(prev.y))) * 100 : null;
            return {
              idx,
              yVal,
              color,
              name: s.name || T('charts.seriesName', { n: idx + 1 }),
              value: fmt(yVal),
              deltaPct,
              cx: sx(Number(p.x)).toFixed(1),
              cy: syFor(idx, yVal).toFixed(1)
            };
          })
          .filter(Boolean)
          // Сверху — большее значение, как на графике в этот день
          .sort((a, b) => b.yVal - a.yVal || a.idx - b.idx);
        hoverDots = tipItems
          .map(
            (item) =>
              `<circle class="chart-hover-dot" cx="${item.cx}" cy="${item.cy}" r="4.5" fill="${item.color}" stroke="#111" stroke-width="1.5" />`
          )
          .join('');
        const rows = tipItems.map((item) =>
          tipRowHtml({
            color: item.color,
            name: item.name,
            value: item.value,
            deltaPct: item.deltaPct
          })
        );
        const tipW = tipPreferredWidth(rows.length, width);
        const cursorX = tipPointer && Number.isFinite(tipPointer.x) ? tipPointer.x : sx(nx) + 12;
        const cursorY = tipPointer && Number.isFinite(tipPointer.y) ? tipPointer.y : pad.t + 12;
        tipHtml = `<div class="chart-tooltip is-follow" style="left:${cursorX + 14}px;top:${
          cursorY + 12
        }px;width:${tipW}px" data-anchor-x="${cursorX.toFixed(1)}">
          <div class="chart-tooltip-date">${escapeHtml(formatTooltipDate(nx))}</div>
          ${rows.join('')}
          ${
            tipNote
              ? `<div class="tip-note">${icon('info')} ${T('charts.tip.changeVsPrevDay')}</div>`
              : ''
          }
        </div>`;
      }

      const seriesLegend = seriesList
        .map((s, i) => {
          const on = enabled.has(i);
          const side = dual ? (axes[i] === 'right' ? ' ▹' : ' ◃') : '';
          return `<button type="button" class="chart-legend-item ${on ? 'on' : 'off'}" data-idx="${i}">
            <i style="background:${colors[i % colors.length]};opacity:${on ? 1 : 0.25}"></i>${escapeHtml(
            s.name || T('charts.seriesName', { n: i + 1 })
          )}${side}
          </button>`;
        })
        .join('');
      const toolsLegend =
        (avgToggle
          ? `<button type="button" class="chart-legend-item ${showAvg ? 'on' : 'off'}" data-idx="avg"><i class="is-avg"></i>${T('charts.average')}</button>`
          : '') +
        (weekendToggle && dateAxis
          ? `<button type="button" class="chart-legend-item ${
              showWeekend ? 'on' : 'off'
            }" data-idx="weekend" title="${T('charts.weekendHint')}"><i class="is-weekend"></i>${T('charts.weekend')}</button>`
          : '');
      // Если настройки уходят наверх (toolsHost / sum-chart-pills) —
      // в нижней легенде остаются только игры/ряды.
      const legend = toolsHost ? seriesLegend : seriesLegend + toolsLegend;

      const analysisHtml = showAnalysis
        ? `${renderAnalysisLegend(trendWindow)}
          <div class="chart-analysis">${(seriesList || [])
            .map((s, idx) => {
              if (!enabled.has(idx)) return '';
              const stats = summarizeSeries(seriesPoints(idx));
              if (!stats) return '';
              const fmt = axes[idx] === 'right' ? formatYRight : formatY;
              const cls = stats.delta >= 0 ? 'up' : 'down';
              const trendIcon = stats.delta >= 0 ? 'trend-up' : 'trend-down';
              const firstLabel = formatX(stats.firstX);
              const lastLabel = formatX(stats.lastX);
              return `<div class="chart-stat">
                <div class="chart-stat-title" style="--c:${colors[idx % colors.length]}">${escapeHtml(
                  s.name || T('charts.seriesName', { n: idx + 1 })
                )}</div>
                <div class="chart-stat-grid">
                  ${metricChip({
                    icon: trendIcon,
                    label: T('charts.stats.change'),
                    hint: T('charts.stats.changeHint', { first: firstLabel, last: lastLabel }),
                    value: `${stats.delta >= 0 ? '+' : ''}${fmt(stats.delta)}${
                      stats.deltaPct != null ? ` (${formatPct(stats.deltaPct)})` : ''
                    }`,
                    valueClass: cls
                  })}
                  ${metricChip({
                    icon: 'wave-sine',
                    label: T('charts.average'),
                    hint: T('charts.stats.avgHint', { n: stats.n }),
                    value: fmt(stats.avg)
                  })}
                  ${metricChip({
                    icon: 'arrows-down-up',
                    label: T('charts.stats.minMax'),
                    hint: T('charts.stats.minMaxHint'),
                    value: `${fmt(stats.min)} / ${fmt(stats.max)}`
                  })}
                  ${
                    stats.wowPct != null
                      ? metricChip({
                          icon: 'arrows-left-right',
                          label: T('charts.stats.wow'),
                          hint: T('charts.stats.wowHint'),
                          value: formatPct(stats.wowPct),
                          valueClass: stats.wowPct >= 0 ? 'up' : 'down'
                        })
                      : metricChip({
                          icon: 'calendar-blank',
                          label: T('charts.stats.wow'),
                          hint: T('charts.stats.wowNeedData'),
                          value: T('charts.stats.notEnoughData'),
                          muted: true
                        })
                  }
                </div>
              </div>`;
            })
            .join('')}</div>
          <div class="chart-tools">
            <button type="button" class="chart-tool ${showTrend ? 'active' : ''}" data-tool="trend" title="${T('charts.trendToolHint', { days: trendWindow })}">
              ${icon('chart-line')} ${T('charts.smoothedTrend', { days: trendWindow })}
            </button>
          </div>`
        : '';

      let brushHtml = '';
      if (showBrush && full && brush) {
        const fullSpan = full.maxX - full.minX || 1;
        const nx = (x) => pad.l + ((x - full.minX) / fullSpan) * (width - pad.l - pad.r);
        const navPlotH = navH - 8;
        const navYs = (seriesList || [])
          .flatMap((_, idx) => (enabled.has(idx) ? basePoints(idx).map((p) => Number(p.y)) : []))
          .filter((y) => Number.isFinite(y));
        let nMin = navYs.length ? Math.min(...navYs) : 0;
        let nMax = navYs.length ? Math.max(...navYs) : 1;
        if (nonNegative && nMin >= 0) nMin = 0;
        if (nMin === nMax) nMax = nMin + 1;
        const nSpan = nMax - nMin || 1;
        const ny = (y) => 4 + (1 - (y - nMin) / nSpan) * navPlotH;
        const navPaths = (seriesList || [])
          .map((series, idx) => {
            if (!enabled.has(idx)) return '';
            const pts = basePoints(idx);
            if (pts.length < 2) return '';
            const coords = pts.map((p) => [nx(Number(p.x)), ny(Number(p.y))]);
            const d = smooth ? smoothPath(coords) : coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
            return `<path d="${d}" fill="none" stroke="${colors[idx % colors.length]}" stroke-width="1.4" opacity="0.75" />`;
          })
          .join('');
        const x1 = nx(brush.minX);
        const x2 = nx(brush.maxX);
        const leftW = Math.max(0, x1 - pad.l);
        const midW = Math.max(2, x2 - x1);
        const rightW = Math.max(0, width - pad.r - x2);
        const navWeekend =
          showWeekend && looksLikeDateAxis(full.minX, full.maxX)
            ? weekendBands(full.minX, full.maxX)
                .map((b) => {
                  const bx1 = nx(b.x1);
                  const bx2 = nx(b.x2);
                  return `<rect class="chart-weekend-band" x="${bx1.toFixed(1)}" y="2" width="${Math.max(
                    1,
                    bx2 - bx1
                  ).toFixed(1)}" height="${navH - 4}" opacity="0.7" />`;
                })
                .join('')
            : '';
        brushHtml = `<div class="chart-brush" style="height:${navH}px">
          <svg class="chart-brush-svg" viewBox="0 0 ${width} ${navH}" width="100%" height="${navH}">
            <rect x="${pad.l}" y="2" width="${width - pad.l - pad.r}" height="${navH - 4}" rx="6" fill="#141414" stroke="#2a2a2a" />
            ${navWeekend}
            ${navPaths}
            <rect class="chart-brush-mask" x="${pad.l}" y="2" width="${leftW}" height="${navH - 4}" fill="rgba(0,0,0,0.45)" />
            <rect class="chart-brush-mask" x="${x2}" y="2" width="${rightW}" height="${navH - 4}" fill="rgba(0,0,0,0.45)" />
            <rect class="chart-brush-win" data-brush="move" x="${x1}" y="2" width="${midW}" height="${navH - 4}" fill="rgba(61,214,140,0.12)" stroke="rgba(61,214,140,0.45)" />
            <rect class="chart-brush-hit" data-brush="left" x="${x1 - 10}" y="0" width="20" height="${navH}" fill="transparent" />
            <rect class="chart-brush-hit" data-brush="right" x="${x2 - 10}" y="0" width="20" height="${navH}" fill="transparent" />
            <rect class="chart-brush-handle" x="${x1 - 3}" y="8" width="6" height="${navH - 16}" rx="2" fill="#c8c8c8" pointer-events="none" />
            <rect class="chart-brush-handle" x="${x2 - 3}" y="8" width="6" height="${navH - 16}" rx="2" fill="#c8c8c8" pointer-events="none" />
            <text x="${pad.l}" y="${navH - 2}" fill="#6a6a6a" font-size="9">${formatX(full.minX)}</text>
            <text x="${width - pad.r}" y="${navH - 2}" fill="#6a6a6a" font-size="9" text-anchor="end">${formatX(full.maxX)}</text>
          </svg>
        </div>`;
      }

      const keepDrawn =
        tipX != null || brushDrag != null || container.querySelector('.chart-wrap.is-drawn');
      container.innerHTML = `
        <div class="chart-wrap interactive chart-animate ${keepDrawn ? 'is-drawn' : ''}">
          <svg class="chart-main-svg" viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">
            ${weekendHtml}
            ${gridLeft}
            ${gridRight}
            <line x1="${pad.l}" y1="${height - pad.b}" x2="${width - pad.r}" y2="${height - pad.b}" stroke="#2a2a2a" />
            <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${height - pad.b}" stroke="#2a2a2a" />
            ${
              dual
                ? `<line x1="${width - pad.r}" y1="${pad.t}" x2="${width - pad.r}" y2="${
                    height - pad.b
                  }" stroke="#3a3a3a" />`
                : ''
            }
            <text x="${pad.l}" y="${height - 10}" fill="#a0a0a0" font-size="10">${formatX(minX)}</text>
            <text x="${width - pad.r}" y="${height - 10}" fill="#a0a0a0" font-size="10" text-anchor="end">${formatX(
              maxX
            )}</text>
            ${avgGuides}
            ${paths}
            ${guide}
            ${hoverDots}
            <rect class="chart-hit" x="${pad.l}" y="${pad.t}" width="${width - pad.l - pad.r}" height="${
              height - pad.t - pad.b
            }" fill="transparent" />
          </svg>
          ${brushHtml}
          ${tipHtml}
          <div class="chart-legend">${legend}</div>
          ${
            toolsHost && toolsLegend
              ? `<div class="chart-legend chart-legend-tools" hidden>${toolsLegend}</div>`
              : ''
          }
          ${analysisHtml}
        </div>
      `;

      const wrapEl = container.querySelector('.chart-wrap');
      const tipEl = container.querySelector('.chart-tooltip');
      if (tipEl && wrapEl) {
        const anchorX = Number(tipEl.dataset.anchorX);
        placeTooltip(tipEl, wrapEl, {
          left: tipEl.offsetLeft,
          top: tipEl.offsetTop,
          anchorX: Number.isFinite(anchorX) ? anchorX : tipPointer?.x,
          anchorY: tipPointer?.y,
          width: tipEl.offsetWidth || tipPreferredWidth(tipEl.querySelectorAll('.tip-row').length, width)
        });
      }
      if (!keepDrawn && wrapEl) {
        container.querySelectorAll('.chart-line-path').forEach((path) => {
          try {
            const len = path.getTotalLength();
            path.style.strokeDasharray = `${len}`;
            path.style.strokeDashoffset = `${len}`;
          } catch {
            /* ignore */
          }
        });
        requestAnimationFrame(() => {
          requestAnimationFrame(() => wrapEl.classList.add('is-drawn'));
        });
      }

      const bindLegendClicks = (rootEl) => {
        if (!rootEl) return;
        rootEl.querySelectorAll('.chart-legend-item').forEach((btn) => {
          btn.onclick = (event) => {
            event.stopPropagation();
            if (btn.dataset.idx === 'avg') {
              showAvg = !showAvg;
              render();
              return;
            }
            if (btn.dataset.idx === 'weekend') {
              showWeekend = !showWeekend;
              render();
              return;
            }
            const idx = Number(btn.dataset.idx);
            if (enabled.has(idx)) {
              if (enabled.size > 1) enabled.delete(idx);
            } else enabled.add(idx);
            render();
          };
        });
      };
      bindLegendClicks(container);

      if (toolsHost) {
        const toolsEl = container.querySelector('.chart-legend-tools');
        if (toolsEl) {
          toolsEl.hidden = false;
          toolsHost.replaceChildren(toolsEl);
          toolsEl.classList.add('chart-legend');
          bindLegendClicks(toolsHost);
        } else {
          toolsHost.replaceChildren();
        }
      }
      if (opts.legendHost) {
        const legendEl = container.querySelector('.chart-wrap > .chart-legend:not(.chart-legend-tools)');
        if (legendEl) {
          opts.legendHost.replaceChildren(legendEl);
          bindLegendClicks(opts.legendHost);
        }
      }

      const trendBtn = container.querySelector('[data-tool="trend"]');
      if (trendBtn) {
        trendBtn.onclick = () => {
          showTrend = !showTrend;
          render();
        };
      }

      if (!brushDrag) bindBrushHandlers();
      ensurePointerBindings();
    }

    function clearTip() {
      if (!alive) return;
      if (tipX == null && tipPointer == null) return;
      tipX = null;
      tipPointer = null;
      render();
    }

    function ensurePointerBindings() {
      if (container.__faLinePointerBound) return;
      container.__faLinePointerBound = true;

      const onMove = (e) => {
        if (!alive || brushDrag) return;
        const svg = container.querySelector('.chart-main-svg');
        const wrap = container.querySelector('.chart-wrap');
        if (!svg || !wrap) return;
        const rect = svg.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) return;
        const localX = ((e.clientX - rect.left) / rect.width) * plot.width;
        const localY = ((e.clientY - rect.top) / rect.height) * plot.height;
        const { pad: p } = plot;
        const inPlot =
          localX >= p.l &&
          localX <= plot.width - p.r &&
          localY >= p.t &&
          localY <= plot.height - p.b;
        if (!inPlot) {
          clearTip();
          return;
        }
        const wrapRect = wrap.getBoundingClientRect();
        tipPointer = {
          x: e.clientX - wrapRect.left,
          y: e.clientY - wrapRect.top
        };
        const span = plot.width - p.l - p.r || 1;
        tipX = plot.minX + ((localX - p.l) / span) * plot.xSpan;
        render();
      };

      const onLeave = () => {
        clearTip();
      };

      const onDocPointer = (e) => {
        if (!alive || !container.isConnected) {
          document.removeEventListener('pointerdown', onDocPointer, true);
          return;
        }
        if (container.contains(e.target)) return;
        clearTip();
      };

      container.addEventListener('mousemove', onMove);
      container.addEventListener('mouseleave', onLeave);
      document.addEventListener('pointerdown', onDocPointer, true);

      container.__faLineCleanup = () => {
        alive = false;
        container.removeEventListener('mousemove', onMove);
        container.removeEventListener('mouseleave', onLeave);
        document.removeEventListener('pointerdown', onDocPointer, true);
        if (brushMoveHandler) window.removeEventListener('pointermove', brushMoveHandler);
        if (brushUpHandler) window.removeEventListener('pointerup', brushUpHandler);
        brushMoveHandler = null;
        brushUpHandler = null;
        brushDrag = null;
        tipX = null;
        tipPointer = null;
        container.__faLinePointerBound = false;
      };
    }

    function brushXFromClient(clientX, domain) {
      const el = container.querySelector('.chart-brush-svg');
      if (!el || !domain) return null;
      const rect = el.getBoundingClientRect();
      if (!(rect.width > 0)) return null;
      const localX = ((clientX - rect.left) / rect.width) * width;
      const t = (localX - pad.l) / (width - pad.l - pad.r);
      const span = domain.maxX - domain.minX || 1;
      return domain.minX + Math.min(1, Math.max(0, t)) * span;
    }

    function bindBrushHandlers() {
      const brushRoot = container.querySelector('.chart-brush-svg');
      const domain = fullXDomain();
      if (!brushRoot || !domain || !brush) return;

      let raf = 0;
      const applyDrag = (clientX) => {
        if (!alive || !brushDrag) return;
        const x = brushXFromClient(clientX, brushDrag.domain);
        if (x == null) return;
        const dx = x - brushDrag.originX;
        if (brushDrag.mode === 'left') {
          clampBrush(brushDrag.from0 + dx, brushDrag.to0, brushDrag.domain);
        } else if (brushDrag.mode === 'right') {
          clampBrush(brushDrag.from0, brushDrag.to0 + dx, brushDrag.domain);
        } else {
          clampBrush(brushDrag.from0 + dx, brushDrag.to0 + dx, brushDrag.domain);
        }
        tipX = null;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (alive) render();
        });
      };

      const onMove = (e) => applyDrag(e.clientX);
      const onUp = (e) => {
        if (brushDrag) applyDrag(e.clientX);
        brushDrag = null;
        brushMoveHandler = null;
        brushUpHandler = null;
        if (raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (alive) render();
      };

      // Делегирование: не вешаем pointerdown на каждый handle заново при render —
      // иначе копятся слушатели. Один обработчик на svg.
      if (!brushRoot.__faBrushBound) {
        brushRoot.__faBrushBound = true;
        brushRoot.addEventListener('pointerdown', (e) => {
          if (!alive) return;
          const hit = e.target && e.target.closest && e.target.closest('[data-brush]');
          if (!hit || !brushRoot.contains(hit)) return;
          e.preventDefault();
          e.stopPropagation();
          const liveDomain = fullXDomain();
          if (!liveDomain || !brush) return;
          const originX = brushXFromClient(e.clientX, liveDomain);
          if (originX == null) return;
          brushDrag = {
            mode: hit.dataset.brush,
            originX,
            from0: brush.minX,
            to0: brush.maxX,
            domain: { minX: liveDomain.minX, maxX: liveDomain.maxX }
          };
          brushMoveHandler = onMove;
          brushUpHandler = onUp;
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
      }
    }

    render();
  },

  bars(container, items, opts = {}) {
    const dense = opts.dense === true;
    const yAxisOn = opts.yAxis === true || opts.showYAxis === true;
    const width = opts.width || container.clientWidth || 640;
    const height = opts.height || (dense ? 220 : 260);
    const pad = dense
      ? { t: 18, r: 10, b: 20, l: 6 }
      : yAxisOn
        ? { t: 18, r: 14, b: 36, l: 52 }
        : { t: 28, r: 48, b: 44, l: 44 };
    const color = opts.color || '#1e7a50';
    const hiColor = opts.highlightColor || '#3dd68c';
    const formatV = opts.formatY || formatNum;
    const formatAxis = opts.formatAxis || formatAxisThousands;
    const showAvg = opts.showAvg !== false;
    const endLabelsOnly = opts.endLabelsOnly != null ? opts.endLabelsOnly === true : dense;
    const hideValueLabels = opts.hideValueLabels != null ? opts.hideValueLabels === true : dense;
    const data = (items || []).filter((i) => i && i.label != null && Number.isFinite(Number(i.value)));
    if (!data.length) {
      container.innerHTML = `<div class="empty">${T('charts.noData')}</div>`;
      return;
    }
    const values = data.map((d) => Number(d.value));
    const cmpVals = data.map((d) =>
      d.compare != null && Number.isFinite(Number(d.compare)) ? Number(d.compare) : null
    );
    const hasCompare = opts.compareLine === true && cmpVals.some((v) => v != null && v > 0);
    const maxBar = Math.max(...values, 0) || 1;
    const rawMax = hasCompare
      ? Math.max(maxBar, ...cmpVals.filter((v) => v != null && v > 0), 1)
      : maxBar;
    const scaleMax = yAxisOn ? niceCeil(rawMax) : rawMax;
    const avgVals = values.filter((v) => v > 0);
    const avg = avgVals.length ? avgVals.reduce((a, b) => a + b, 0) / avgVals.length : 0;
    const maxIdx = values.indexOf(Math.max(...values));
    const barW = (width - pad.l - pad.r) / data.length;
    const gapRatio = opts.gapRatio != null ? Number(opts.gapRatio) : dense ? 0.18 : 0.15;
    const cmpColor = opts.compareColor || '#8a8a8a';
    let active = null;

    const plotH = height - pad.t - pad.b;
    const yAxisHtml = yAxisOn
      ? yAxisGridHtml({ scaleMax, pad, width, height, formatY: formatAxis, ticks: 4 })
      : '';
    const bars = data
      .map((d, i) => {
        const val = Number(d.value);
        const h = val > 0 ? Math.max(3, Math.round((val / scaleMax) * plotH)) : 0;
        const gap = dense ? Math.min(3, barW * gapRatio) : barW * gapRatio;
        const x = pad.l + i * barW + gap / 2;
        const y = height - pad.b - h;
        const w = Math.max(dense ? 3 : 4, barW - gap);
        const isMax = i === maxIdx && maxBar > 0;
        const barColor = d.color || (isMax ? hiColor : color);
        const valueLabel =
          hideValueLabels || h < 18
            ? ''
            : `<text x="${x + w / 2}" y="${y - 4}" fill="#ededed" font-size="10" text-anchor="middle">${formatV(
                val
              )}</text>`;
        return `
          <g class="chart-bar" data-i="${i}" style="cursor:pointer; --bar-i:${i}">
            <rect class="chart-bar-hit" x="${pad.l + i * barW}" y="${pad.t}" width="${barW}" height="${plotH}" fill="transparent" />
            <rect class="chart-bar-fill" x="${x}" y="${y}" width="${w}" height="${h}" rx="${
              dense ? 2 : 3
            }" fill="${barColor}" data-base="${barColor}" style="--bar-i:${i}" />
            ${valueLabel}
          </g>
        `;
      })
      .join('');

    const allXLabels = opts.allXLabels === true;
    const endLabels = endLabelsOnly
      ? `<text x="${pad.l}" y="${height - 4}" fill="#a0a0a0" font-size="11">${escapeHtml(
          String(data[0].label)
        )}</text>
         <text x="${width - pad.r}" y="${height - 4}" fill="#a0a0a0" font-size="11" text-anchor="end">${escapeHtml(
           String(data[data.length - 1].label)
         )}</text>`
      : data
          .map((d, i) => {
            if (
              !allXLabels &&
              data.length > 8 &&
              i !== 0 &&
              i !== data.length - 1 &&
              i !== maxIdx &&
              i % 2 === 1
            ) {
              return '';
            }
            const x = pad.l + i * barW + barW / 2;
            const raw = String(d.label);
            const text = allXLabels ? raw : raw.slice(0, 6);
            return `<text x="${x}" y="${height - 4}" fill="#a0a0a0" font-size="10" text-anchor="middle">${escapeHtml(
              text
            )}</text>`;
          })
          .join('');

    const cmpPoints = [];
    if (hasCompare) {
      data.forEach((d, i) => {
        const v = cmpVals[i];
        if (v == null) return;
        const x = pad.l + i * barW + barW / 2;
        const y = height - pad.b - (v / scaleMax) * plotH;
        cmpPoints.push({ x, y, v, i });
      });
    }
    const cmpPath =
      cmpPoints.length > 1
        ? `<path class="chart-compare-line" d="${cmpPoints
            .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
            .join(' ')}" fill="none" stroke="${cmpColor}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" opacity="0.9" />`
        : '';
    const cmpDots = cmpPoints
      .map(
        (p, i) =>
          `<circle class="chart-compare-dot" style="--bar-i:${i}" cx="${p.x}" cy="${p.y}" r="2.5" fill="${cmpColor}" />`
      )
      .join('');

    const avgY = height - pad.b - (avg / scaleMax) * plotH;
    const avgLine =
      showAvg && avg > 0
        ? `<line x1="${pad.l}" y1="${avgY}" x2="${width - pad.r}" y2="${avgY}" stroke="#ededed" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.85" />
         <rect x="${width - pad.r - 108}" y="${avgY - 16}" width="108" height="14" rx="4" fill="rgba(14,14,14,0.75)" />
         <text x="${width - pad.r - 4}" y="${avgY - 5}" fill="#ededed" font-size="11" text-anchor="end">${T('charts.averageLower')} ${formatV(
            avg
          )}</text>`
        : '';

    let showTrend = opts.trend === true && data.length >= 3;
    const trendToggle = (opts.trend === true || opts.trendToggle === true) && data.length >= 3;
    const trendColor = opts.trendColor || '#8eb4ff';
    const trendWindow = Math.max(3, Math.min(Number(opts.trendWindow) || 3, data.length));
    const toolsHost = opts.toolsHost || null;
    let trendPath = '';
    if (data.length >= 3) {
      const smoothed = centeredMovingAverage(values, trendWindow);
      const coords = smoothed.map((yVal, i) => {
        const x = pad.l + i * barW + barW / 2;
        const y = height - pad.b - (Math.max(0, yVal) / scaleMax) * plotH;
        return [x, y];
      });
      const d = smoothPath(coords);
      if (d) {
        trendPath = `<path class="chart-trend-line" d="${d}" fill="none" stroke="${trendColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" ${
          showTrend ? '' : 'hidden'
        } />`;
      }
    }
    const toolsLegend =
      trendToggle && trendPath
        ? `<div class="chart-legend chart-legend-tools" hidden>
            <button type="button" class="chart-legend-item ${showTrend ? 'on' : 'off'}" data-tool="trend" title="${T('charts.movingAvgMonths', { months: trendWindow })}">
              <i class="is-trend" style="background:${trendColor}"></i>${T('charts.trend')}
            </button>
          </div>`
        : '';

    container.innerHTML = `
      <div class="chart-wrap interactive chart-animate ${dense ? 'dense' : ''}">
        ${toolsLegend}
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="${T('charts.barChart')}">
          ${yAxisHtml}
          ${bars}
          ${cmpPath}
          ${cmpDots}
          ${avgLine}
          ${trendPath}
          ${endLabels}
        </svg>
        <div class="chart-tooltip" hidden></div>
      </div>
    `;

    const wrap = container.querySelector('.chart-wrap');
    const tip = container.querySelector('.chart-tooltip');
    const fills = [...container.querySelectorAll('.chart-bar-fill')];
    const compareLine = container.querySelector('.chart-compare-line');
    const trendLine = container.querySelector('.chart-trend-line');
    const toolsEl = container.querySelector('.chart-legend-tools');
    if (toolsHost) {
      if (toolsEl) {
        toolsEl.hidden = false;
        toolsHost.replaceChildren(toolsEl);
        toolsEl.classList.add('chart-legend');
      } else {
        toolsHost.replaceChildren();
      }
    } else if (toolsEl) {
      toolsEl.hidden = false;
    }
    const trendBtn = (toolsHost || container).querySelector('[data-tool="trend"]');
    if (trendBtn && trendLine) {
      trendBtn.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        showTrend = !showTrend;
        trendBtn.classList.toggle('on', showTrend);
        trendBtn.classList.toggle('off', !showTrend);
        if (showTrend) trendLine.removeAttribute('hidden');
        else trendLine.setAttribute('hidden', '');
      };
    }
    if (compareLine) {
      try {
        const len = compareLine.getTotalLength();
        compareLine.style.setProperty('--path-len', `${len}`);
        compareLine.style.strokeDasharray = `${len}`;
        compareLine.style.strokeDashoffset = `${len}`;
      } catch {
        /* ignore */
      }
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => wrap && wrap.classList.add('is-drawn'));
    });

    function paint() {
      fills.forEach((rect, i) => {
        const base = rect.getAttribute('data-base') || color;
        if (active == null) {
          rect.setAttribute('fill', base);
          rect.setAttribute('opacity', '1');
        } else if (active === i) {
          rect.setAttribute('fill', hiColor);
          rect.setAttribute('opacity', '1');
        } else {
          rect.setAttribute('fill', base);
          rect.setAttribute('opacity', '0.38');
        }
      });
      if (active == null) {
        tip.hidden = true;
        tip.innerHTML = '';
        return;
      }
      const d = data[active];
      const cmp = cmpVals[active];
      const anchorX = pad.l + active * barW + barW / 2;
      const barHi = d.color || hiColor || color;
      const rows = [{ name: T('charts.tip.value'), value: formatV(Number(d.value)), color: barHi }];
      const hasManual = d.manualEarn != null && Number(d.manualEarn) > 0;
      if (hasManual) {
        if (d.consoleEarn != null && Number(d.consoleEarn) > 0) {
          rows.push({
            name: T('charts.tip.collected'),
            value: formatV(Number(d.consoleEarn)),
            color: '#1e7a50'
          });
        }
        rows.push({
          name: T('charts.tip.set'),
          value: formatV(Number(d.manualEarn)),
          color: '#5b7fd6'
        });
      }
      if (cmp != null) {
        rows.push({
          name: d.compareHint
            ? T('charts.tip.yearAgoWithHint', { hint: d.compareHint })
            : T('charts.tip.yearAgo'),
          value: formatV(cmp),
          color: cmpColor
        });
      }
      // Среднее уже на графике пунктиром — в тип не дублируем.
      if (!(showAvg && avg > 0)) {
        rows.push({ name: T('charts.average'), value: formatV(avg), color: '#8a8a8a' });
      }
      fillTooltip(tip, wrap, {
        title: d.title || d.label || d.hint,
        rows,
        left: anchorX + 12,
        top: 8,
        anchorX,
        width: tipPreferredWidth(rows.length, width)
      });
    }

    wrap.onmousemove = (event) => {
      const g = event.target.closest('.chart-bar');
      const next = g ? Number(g.dataset.i) : null;
      if (next === active) return;
      active = Number.isFinite(next) ? next : null;
      paint();
    };
    wrap.onmouseleave = () => {
      active = null;
      paint();
    };
    if (typeof opts.onBarClick === 'function') {
      wrap.onclick = (event) => {
        const g = event.target.closest('.chart-bar');
        if (!g) return;
        const i = Number(g.dataset.i);
        if (!Number.isFinite(i) || !data[i]) return;
        event.preventDefault();
        event.stopPropagation();
        opts.onBarClick(data[i], i, event);
      };
    }
  },

  /** Столбцы с сегментами (реклама / инап и т.п.). items: [{label, segments:[{key,value,color}]}] */
  stackedBars(container, items, opts = {}) {
    const width = opts.width || container.clientWidth || 640;
    const height = opts.height || 200;
    const yAxisOn = opts.yAxis === true || opts.showYAxis === true;
    const pad = yAxisOn
      ? { t: 14, r: 12, b: 28, l: 52 }
      : { t: 16, r: 12, b: 28, l: 12 };
    const formatV = opts.formatY || formatNum;
    const formatAxis = opts.formatAxis || formatAxisThousands;
    const data = (items || []).filter((i) => i && i.label != null);
    if (!data.length) {
      container.innerHTML = `<div class="empty">${T('charts.noData')}</div>`;
      return;
    }
    const totals = data.map((d) =>
      (d.segments || []).reduce((s, seg) => s + (Number(seg.value) || 0), 0)
    );
    const rawMax = Math.max(...totals, 1);
    const max = yAxisOn ? niceCeil(rawMax) : rawMax;
    const barW = (width - pad.l - pad.r) / data.length;
    const gapRatio = opts.gapRatio != null ? Number(opts.gapRatio) : 0.22;
    const plotH = height - pad.t - pad.b;
    const yAxisHtml = yAxisOn
      ? yAxisGridHtml({ scaleMax: max, pad, width, height, formatY: formatAxis, ticks: 4 })
      : '';
    const bars = data
      .map((d, i) => {
        const gap = barW * gapRatio;
        const x = pad.l + i * barW + gap / 2;
        const w = Math.max(10, barW - gap);
        let y = height - pad.b;
        const segs = (d.segments || [])
          .filter((s) => Number(s.value) > 0)
          .map((s) => {
            const h = Math.max(2, (Number(s.value) / max) * plotH);
            y -= h;
            return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${s.color || '#3dd68c'}" rx="2" />`;
          })
          .join('');
        const tipRows = (d.segments || [])
          .map((s) => ({
            color: s.color || '#3dd68c',
            name: s.key === 'inapp' ? T('charts.tip.purchases') : s.label || (s.key === 'ads' ? T('charts.tip.ads') : T('charts.tip.ads')),
            value: formatV(Number(s.value) || 0),
            _sort: Number(s.value) || 0
          }))
          .sort((a, b) => b._sort - a._sort)
          .map(({ color, name, value }) => ({ color, name, value }));
        if (!tipRows.length) tipRows.push({ name: T('charts.tip.total'), value: formatV(totals[i]) });
        else if (tipRows.length > 1) {
          tipRows.push({ name: T('charts.tip.total'), value: formatV(totals[i]) });
        }
        return `<g class="is-hov" data-hov="${escapeHtml(String(d.title || d.label))}" data-hovrows="${escapeHtml(
          JSON.stringify(tipRows)
        )}">
          <rect x="${x}" y="${pad.t}" width="${w}" height="${plotH}" fill="transparent"></rect>
          ${segs}
          <text x="${x + w / 2}" y="${height - 8}" fill="#a0a0a0" font-size="10" text-anchor="middle">${escapeHtml(
            String(d.label)
          )}</text>
        </g>`;
      })
      .join('');
    const legend = (opts.legend || [])
      .map(
        (l) =>
          `<span class="chart-mini-legend"><i style="background:${l.color}"></i>${escapeHtml(l.label)}</span>`
      )
      .join('');
    container.innerHTML = `
      <div class="chart-wrap chart-animate interactive">
        ${legend ? `<div class="chart-mini-legends">${legend}</div>` : ''}
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${yAxisHtml}${bars}</svg>
      </div>`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => container.querySelector('.chart-wrap')?.classList.add('is-drawn'));
    });
    bindWidgetHover(container);
    void formatV;
  },

  /** Кольцевая диаграмма. items: [{label, value, color?}] */
  donut(container, items, opts = {}) {
    const size = opts.size || Math.min(container.clientWidth || 220, 220);
    const data = (items || [])
      .map((d, i) => ({
        label: d.label,
        value: Number(d.value) || 0,
        color: d.color || ['#3dd68c', '#5b8def', '#e3a93a', '#c084fc', '#8a8a8a'][i % 5]
      }))
      .filter((d) => d.value > 0);
    if (!data.length) {
      container.innerHTML = `<div class="empty">${T('charts.noData')}</div>`;
      return;
    }
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.36;
    const stroke = size * 0.14;
    let angle = -Math.PI / 2;
    const arcs = data
      .map((d) => {
        const sweep = (d.value / total) * Math.PI * 2;
        const a0 = angle;
        const a1 = angle + sweep;
        angle = a1;
        const x0 = cx + r * Math.cos(a0);
        const y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1);
        const y1 = cy + r * Math.sin(a1);
        const large = sweep > Math.PI ? 1 : 0;
        const pct = formatNum((d.value / total) * 100);
        return `<path class="is-hov" data-hov="${escapeHtml(String(d.label))}" data-hovc="${escapeHtml(
          d.color
        )}" data-hovv="${escapeHtml(`${formatNum(d.value)} · ${pct}%`)}" d="M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}" fill="none" stroke="${d.color}" stroke-width="${stroke}" stroke-linecap="butt" />`;
      })
      .join('');
    const center = opts.center || formatNum(total);
    const centerSub = opts.centerSub || '';
    const legend = data
      .map(
        (d) =>
          `<div class="donut-legend-row is-hov" data-hov="${escapeHtml(String(d.label))}" data-hovc="${escapeHtml(
            d.color
          )}" data-hovv="${escapeHtml(
            `${formatNum(d.value)} · ${formatNum((d.value / total) * 100)}%`
          )}"><i style="background:${d.color}"></i><span>${escapeHtml(
            String(d.label)
          )}</span><b>${formatNum((d.value / total) * 100)}%</b></div>`
      )
      .join('');
    container.innerHTML = `
      <div class="donut-wrap interactive">
        <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#222" stroke-width="${stroke}" />
          ${arcs}
          <text x="${cx}" y="${cy - (centerSub ? 4 : 0)}" fill="#ededed" font-size="18" font-weight="700" text-anchor="middle">${escapeHtml(
            String(center)
          )}</text>
          ${
            centerSub
              ? `<text x="${cx}" y="${cy + 14}" fill="#a0a0a0" font-size="11" text-anchor="middle">${escapeHtml(
                  String(centerSub)
                )}</text>`
              : ''
          }
        </svg>
        <div class="donut-legend">${legend}</div>
      </div>`;
    bindWidgetHover(container);
  },

  /** Горизонтальные доли. items: [{label, value}] */
  hbars(container, items, opts = {}) {
    const data = (items || [])
      .map((d) => ({ label: d.label, value: Number(d.value) || 0, color: d.color }))
      .filter((d) => d.value > 0)
      .slice(0, opts.limit || 6);
    if (!data.length) {
      container.innerHTML = `<div class="empty">${T('charts.noData')}</div>`;
      return;
    }
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const color = opts.color || '#3dd68c';
    const rows = data
      .map((d, i) => {
        const pct = opts.max ? (d.value / opts.max) * 100 : (d.value / total) * 100;
        const right = opts.raw ? formatNum(d.value) : `${formatNum(pct)}%`;
        const fill = d.color || (opts.colors && opts.colors[i]) || color;
        return `<div class="hbar-row is-hov" data-hov="${escapeHtml(String(d.label))}" data-hovc="${escapeHtml(
          fill
        )}" data-hovv="${escapeHtml(right)}">
          <span class="hbar-label">${escapeHtml(String(d.label))}</span>
          <div class="hbar-track"><i style="width:${Math.max(2, Math.min(100, pct))}%;background:${fill}"></i></div>
          <b class="hbar-pct">${right}</b>
        </div>`;
      })
      .join('');
    container.innerHTML = `<div class="hbar-list interactive">${rows}</div>`;
    bindWidgetHover(container);
  },

  /** Два концентрических кольца 0..max (рейтинг). Размер задаёт CSS от ширины контейнера. */
  dualRing(container, opts = {}) {
    const max = Number(opts.max) || 100;
    const outer = opts.outer || { value: 0, label: '', color: '#3dd68c' };
    const inner = opts.inner || { value: 0, label: '', color: '#e3a93a' };
    const outerValue = Number(outer.value) || 0;
    const innerValue = Number(inner.value) || 0;
    const outerColor = outer.color || '#3dd68c';
    const innerColor = inner.color || '#e3a93a';
    const outerLabel = String(outer.label || '');
    const innerLabel = String(inner.label || T('charts.inner'));
    const ring = (r, value, color) => {
      const pct = Math.max(0, Math.min(100, ((Number(value) || 0) / max) * 100));
      const arc =
        pct > 0
          ? `<circle cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="8" pathLength="100" stroke-linecap="round" stroke-dasharray="${pct} 100" transform="rotate(-90 50 50)" />`
          : '';
      return `<circle cx="50" cy="50" r="${r}" fill="none" stroke="#2a2a2a" stroke-width="8" />${arc}`;
    };
    container.innerHTML = `
      <div class="dual-ring-wrap interactive">
        <div class="dual-ring-box">
          <svg viewBox="0 0 100 100" class="dual-ring-svg" role="img" aria-label="${escapeHtml(
            outerLabel
          )}: ${formatNum(outerValue)}">
            ${ring(38, outerValue, outerColor)}
            ${ring(26, innerValue, innerColor)}
          </svg>
          <div class="dual-ring-center">
            <b style="--c:${outerColor}">${formatNum(outerValue)}</b>
            <b style="--c:${innerColor}">${formatNum(innerValue)}</b>
          </div>
        </div>
        <div class="dual-ring-legend">
          <div class="is-hov" data-hov="${escapeHtml(outerLabel || T('charts.outer'))}" data-hovc="${escapeHtml(
            outerColor
          )}" data-hovv="${escapeHtml(formatNum(outerValue))}"><i style="background:${outerColor}"></i>${escapeHtml(
            outerLabel || T('charts.outer')
          )}: <b>${formatNum(outerValue)}</b></div>
          <div class="is-hov" data-hov="${escapeHtml(innerLabel)}" data-hovc="${escapeHtml(
            innerColor
          )}" data-hovv="${escapeHtml(formatNum(innerValue))}"><i style="background:${innerColor}"></i>${escapeHtml(
            innerLabel
          )}: <b>${formatNum(innerValue)}</b></div>
        </div>
      </div>`;
    bindWidgetHover(container);
  },

  /** Календарь активности по дням. days: [{day:'YYYY-MM-DD', value}] */
  calendar(container, days, opts = {}) {
    const data = (days || [])
      .map((d) => ({ day: String(d.day || ''), value: Number(d.value) || 0 }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.day));
    if (!data.length) {
      container.innerHTML = `<div class="empty">${T('charts.noData')}</div>`;
      return;
    }
    const byDay = new Map(data.map((d) => [d.day, d.value]));
    const sorted = [...byDay.keys()].sort();
    const start = sorted[0];
    const end = sorted[sorted.length - 1];
    const [y, m] = start.split('-').map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0));
    const max = Math.max(...byDay.values(), 1);
    const color = opts.color || '#3dd68c';
    const cells = [];
    const padStart = (monthStart.getUTCDay() + 6) % 7; // mon=0
    for (let i = 0; i < padStart; i += 1) cells.push('<div class="cal-cell is-pad"></div>');
    for (let day = 1; day <= monthEnd.getUTCDate(); day += 1) {
      const key = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const val = byDay.has(key) ? byDay.get(key) : 0;
      const t = val > 0 ? 0.18 + 0.82 * (val / max) : 0;
      const bg =
        val > 0
          ? `background:color-mix(in srgb, ${color} ${Math.round(t * 100)}%, #171717)`
          : 'background:#1a1a1a';
      cells.push(
        `<div class="cal-cell is-hov ${val > 0 ? 'has-val' : ''}" style="${bg}" data-hov="${escapeHtml(
          key
        )}" data-hovc="${escapeHtml(color)}" data-hovv="${escapeHtml(
          T('charts.playersValue', { value: formatNum(val) })
        )}"></div>`
      );
    }
    void end;
    container.innerHTML = `
      <div class="cal-wrap interactive">
        <div class="cal-grid">${cells.join('')}</div>
        <div class="cal-hint">${escapeHtml(opts.hint || T('charts.playersByDay'))}</div>
      </div>`;
    bindWidgetHover(container);
  },

  /** Почасовые столбцы 0..23. hours: [{hour:0..23, value}] */
  hourBars(container, hours, opts = {}) {
    const map = new Map((hours || []).map((h) => [Number(h.hour), Number(h.value) || 0]));
    const data = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      value: map.get(hour) || 0
    }));
    if (!data.some((d) => d.value > 0)) {
      container.innerHTML = `<div class="empty">${escapeHtml(opts.empty || T('charts.noHourlyData'))}</div>`;
      return;
    }
    const max = Math.max(...data.map((d) => d.value), 1);
    const width = opts.width || container.clientWidth || 640;
    const height = opts.height || 160;
    const pad = { t: 8, r: 6, b: 22, l: 6 };
    const barW = (width - pad.l - pad.r) / 24;
    const plotH = height - pad.t - pad.b;
    const bars = data
      .map((d, i) => {
        const h = d.value > 0 ? Math.max(2, (d.value / max) * plotH) : 0;
        const x = pad.l + i * barW + 1;
        const y = height - pad.b - h;
        const tod = d.hour < 6 ? '#e3a93a' : d.hour < 12 ? '#3dd68c' : d.hour < 18 ? '#5b8def' : '#7aa2ff';
        return `<rect x="${x}" y="${y}" width="${Math.max(2, barW - 2)}" height="${h}" rx="2" fill="${tod}" opacity="${
          d.value > 0 ? 1 : 0.15
        }" />`;
      })
      .join('');
    const labels = [0, 6, 12, 18, 23]
      .map((h) => {
        const x = pad.l + h * barW + barW / 2;
        return `<text x="${x}" y="${height - 6}" fill="#a0a0a0" font-size="10" text-anchor="middle">${String(h).padStart(
          2,
          '0'
        )}</text>`;
      })
      .join('');
    const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
    container.innerHTML = `
      <div class="chart-wrap">
        <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">${bars}${labels}</svg>
        ${
          peak.value > 0
            ? `<div class="cal-hint">${T('charts.peak', { time: `${String(peak.hour).padStart(2, '0')}:00` })}</div>`
            : ''
        }
      </div>`;
  }
};

/** Обрезает длинный «хвост нулей» в начале/конце — иначе график сплющен. */
function activeXWindow(seriesList) {
  const DAY = 86400000;
  const all = (seriesList || []).flatMap((s) =>
    ((s && s.data) || []).filter((p) => Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
  );
  if (!all.length) return null;
  const maxAbs = Math.max(...all.map((p) => Math.abs(Number(p.y))), 0);
  const eps = maxAbs > 0 ? maxAbs * 0.02 : 0;
  const active = all.filter((p) => Math.abs(Number(p.y)) > eps);
  if (!active.length) {
    return {
      minX: Math.min(...all.map((p) => Number(p.x))),
      maxX: Math.max(...all.map((p) => Number(p.x)))
    };
  }
  let minX = Math.min(...active.map((p) => Number(p.x)));
  let maxX = Math.max(...active.map((p) => Number(p.x)));
  // небольшой запас по краям
  minX -= DAY * 2;
  maxX += DAY * 2;
  const globalMin = Math.min(...all.map((p) => Number(p.x)));
  const globalMax = Math.max(...all.map((p) => Number(p.x)));
  return {
    minX: Math.max(globalMin, minX),
    maxX: Math.min(globalMax, maxX)
  };
}

/** Центрированное скользящее среднее по ряду значений. */
function centeredMovingAverage(values, windowSize) {
  const vals = (values || []).map((v) => Number(v));
  const n = vals.length;
  const w = Math.max(1, Math.min(Number(windowSize) || 3, n));
  const half = Math.floor((w - 1) / 2);
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    let lo = i - half;
    let hi = i + (w - 1 - half);
    if (lo < 0) {
      hi = Math.min(n - 1, hi - lo);
      lo = 0;
    }
    if (hi >= n) {
      lo = Math.max(0, lo - (hi - (n - 1)));
      hi = n - 1;
    }
    let sum = 0;
    let count = 0;
    for (let j = lo; j <= hi; j += 1) {
      if (!Number.isFinite(vals[j])) continue;
      sum += vals[j];
      count += 1;
    }
    out[i] = count ? sum / count : 0;
  }
  return out;
}

function movingAverage(pts, windowSize) {
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  const out = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const from = Math.max(0, i - windowSize + 1);
    const slice = sorted.slice(from, i + 1);
    const avg = slice.reduce((s, p) => s + Number(p.y), 0) / slice.length;
    out.push({ x: sorted[i].x, y: avg });
  }
  return out;
}

function summarizeSeries(pts) {
  const sorted = [...(pts || [])]
    .filter((p) => Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    .sort((a, b) => a.x - b.x);
  if (sorted.length < 2) return null;
  const ys = sorted.map((p) => Number(p.y));
  const first = ys[0];
  const last = ys[ys.length - 1];
  const delta = last - first;
  const deltaPct = first !== 0 ? (delta / Math.abs(first)) * 100 : null;
  const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  let wowPct = null;
  if (sorted.length >= 14) {
    const recent = ys.slice(-7);
    const prev = ys.slice(-14, -7);
    const a = recent.reduce((s, v) => s + v, 0) / recent.length;
    const b = prev.reduce((s, v) => s + v, 0) / prev.length;
    if (b !== 0) wowPct = ((a - b) / Math.abs(b)) * 100;
  }
  return {
    first,
    last,
    firstX: sorted[0].x,
    lastX: sorted[sorted.length - 1].x,
    delta,
    deltaPct,
    avg,
    min,
    max,
    wowPct,
    n: sorted.length
  };
}

function icon(name, size = 14) {
  return window.FoundersIcons && window.FoundersIcons.svg
    ? window.FoundersIcons.svg(name, size)
    : '';
}

function metricChip({ icon: iconName, label, hint, value, valueClass = '', muted = false }) {
  return `<div class="metric-chip ${muted ? 'muted' : ''}" title="${escapeHtml(hint || '')}">
    <div class="metric-chip-head">${icon(iconName)}<span>${escapeHtml(label)}</span></div>
    <div class="metric-chip-value ${valueClass}">${value}</div>
    <div class="metric-chip-hint">${escapeHtml(hint || '')}</div>
  </div>`;
}

function renderAnalysisLegend(trendWindow) {
  return `<div class="chart-help">
    <div class="chart-help-title">${icon('info')} ${T('charts.help.title')}</div>
    <ul>
      <li>${icon('trend-up')} ${T('charts.help.change')}</li>
      <li>${icon('wave-sine')} ${T('charts.help.average')}</li>
      <li>${icon('arrows-down-up')} ${T('charts.help.minMax')}</li>
      <li>${icon('arrows-left-right')} ${T('charts.help.wow')}</li>
      <li>${icon('chart-line')} ${T('charts.help.trend', { days: trendWindow })}</li>
      <li>${icon('minus')} ${T('charts.help.avgLine')}</li>
    </ul>
  </div>`;
}

/** Оси: series.axis = 'left'|'right', либо opts.dualAxis / авто при разном масштабе. */
function assignAxes(seriesList, opts = {}) {
  const list = seriesList || [];
  if (!list.length) return [];
  if (list.every((s) => s && (s.axis === 'left' || s.axis === 'right'))) {
    return list.map((s) => s.axis);
  }
  if (opts.dualAxis === false) return list.map(() => 'left');

  const maxes = list.map((s) => {
    const ys = ((s && s.data) || [])
      .map((p) => Number(p.y))
      .filter((v) => Number.isFinite(v));
    return ys.length ? Math.max(...ys.map(Math.abs)) : 0;
  });
  const globalMax = Math.max(...maxes, 0);
  if (opts.dualAxis === true || (globalMax > 0 && maxes.some((m) => m > 0 && globalMax / m >= 8))) {
    const primary = maxes.indexOf(globalMax);
    return list.map((_, i) => (i === primary ? 'left' : maxes[i] > 0 && globalMax / maxes[i] >= 8 ? 'right' : 'left'));
  }
  return list.map(() => 'left');
}

function formatNum(n) {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 0 : 2;
  return new Intl.NumberFormat(window.NamiI18n.locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: abs >= 100 || Number.isInteger(n) ? 0 : Math.min(digits, 2)
  }).format(n);
}

/** Верх шкалы с «красивым» шагом для оси Y. */
function niceCeil(max) {
  const n = Number(max);
  if (!(n > 0)) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const m = n / exp;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return nice * exp;
}

/** Подписи оси в тысячах: 0 · 20 тыс · 40 тыс. */
function formatAxisThousands(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (Math.abs(n) < 0.5) return '0';
  if (Math.abs(n) < 1000) return formatNum(n);
  const k = n / 1000;
  const digits = Math.abs(k) >= 10 ? 0 : 1;
  return `${new Intl.NumberFormat(window.NamiI18n.locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0
  }).format(k)} ${T('charts.thousandsShort')}`;
}

function yAxisGridHtml({ scaleMax, pad, width, height, formatY, ticks = 4 }) {
  const max = Math.max(Number(scaleMax) || 0, 1);
  const plotH = height - pad.t - pad.b;
  const fmt = typeof formatY === 'function' ? formatY : formatAxisThousands;
  let html = '';
  for (let i = 0; i <= ticks; i += 1) {
    const t = i / ticks;
    const val = max * (1 - t);
    const y = pad.t + t * plotH;
    html += `<line x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" stroke="#2a2a2a" stroke-dasharray="3 4" />
      <text x="${pad.l - 8}" y="${y + 3}" fill="#a0a0a0" font-size="10" text-anchor="end">${escapeHtml(
        String(fmt(val))
      )}</text>`;
  }
  return html;
}

function formatPct(n, digits = 1) {
  if (!Number.isFinite(n)) return '';
  const sign = n > 0 ? '+' : n < 0 ? '\u2212' : '';
  return (
    sign +
    new Intl.NumberFormat(window.NamiI18n.locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    }).format(Math.abs(n)) +
    '%'
  );
}

function formatMaybeDate(x) {
  if (!Number.isFinite(x)) return '';
  if (x > 1e11) {
    if (window.FoundersFormat && window.FoundersFormat.dateAxis) {
      return window.FoundersFormat.dateAxis(x);
    }
    try {
      return new Date(x).toLocaleDateString(window.NamiI18n.locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      });
    } catch {
      return String(x);
    }
  }
  return String(x);
}

function looksLikeDateAxis(minX, maxX) {
  return Number.isFinite(minX) && Number.isFinite(maxX) && minX > 1e11 && maxX >= minX;
}

/** Полосы пятница–воскресенье на оси дат (UTC-сутки). */
function weekendBands(minX, maxX) {
  const DAY = 86400000;
  if (!looksLikeDateAxis(minX, maxX)) return [];
  const bands = [];
  let day = Math.floor(minX / DAY) * DAY;
  let start = null;
  const last = Math.floor(maxX / DAY) * DAY + DAY;
  for (let t = day; t <= last; t += DAY) {
    const dow = new Date(t).getUTCDay();
    const isWe = dow === 5 || dow === 6 || dow === 0;
    if (isWe) {
      if (start == null) start = t;
    } else if (start != null) {
      bands.push({ x1: Math.max(start, minX), x2: Math.min(t, maxX) });
      start = null;
    }
  }
  if (start != null) bands.push({ x1: Math.max(start, minX), x2: maxX });
  return bands.filter((b) => b.x2 > b.x1);
}

function formatTooltipDate(x) {
  if (!Number.isFinite(x)) return '';
  if (x > 1e11 && window.FoundersFormat && window.FoundersFormat.dateFull) {
    return window.FoundersFormat.dateFull(x);
  }
  return formatMaybeDate(x);
}

function bindWidgetHover(container) {
  const wrap = container.querySelector('.interactive');
  if (!wrap) return;
  let tip = wrap.querySelector(':scope > .chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip';
    tip.hidden = true;
    wrap.appendChild(tip);
  }
  function hide() {
    tip.hidden = true;
  }
  wrap.addEventListener('mousemove', (event) => {
    const hit = event.target.closest('[data-hov]');
    if (!hit || !wrap.contains(hit)) {
      hide();
      return;
    }
    const box = wrap.getBoundingClientRect();
    const localX = event.clientX - box.left;
    const localY = event.clientY - box.top;
    let rows = [];
    const rawRows = hit.dataset.hovrows;
    if (rawRows) {
      try {
        const parsed = JSON.parse(rawRows);
        if (Array.isArray(parsed)) rows = parsed;
      } catch (_) {
        rows = [];
      }
    }
    if (!rows.length) {
      rows = [
        {
          color: hit.dataset.hovc || '',
          name: hit.dataset.hovn || '',
          value: hit.dataset.hovv || '—',
          solo: !hit.dataset.hovn
        }
      ];
    }
    fillTooltip(tip, wrap, {
      title: hit.dataset.hov || '',
      rows,
      left: localX + 14,
      top: Math.max(4, localY - 12),
      anchorX: localX,
      width: tipPreferredWidth(rows.length, box.width)
    });
  });
  wrap.addEventListener('mouseleave', hide);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
