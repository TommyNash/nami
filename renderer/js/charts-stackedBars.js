window.FoundersCharts.stackedBars = function(container, items, opts = {}) {
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
  }
