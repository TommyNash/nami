window.FoundersCharts.hbars = function(container, items, opts = {}) {
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
  }
