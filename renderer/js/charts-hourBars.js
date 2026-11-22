window.FoundersCharts.hourBars = function(container, hours, opts = {}) {
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
