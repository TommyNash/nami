window.FoundersCharts.line = function(container, seriesList, opts = {}) {
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
  }
