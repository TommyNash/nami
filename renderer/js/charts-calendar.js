window.FoundersCharts.calendar = function(container, days, opts = {}) {
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
  }
