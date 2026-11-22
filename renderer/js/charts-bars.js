window.FoundersCharts.bars = function(container, items, opts = {}) {
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
  }
