window.FoundersCharts.dualRing = function(container, opts = {}) {
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
  }
