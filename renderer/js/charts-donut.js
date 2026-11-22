window.FoundersCharts.donut = function(container, items, opts = {}) {
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
  }
