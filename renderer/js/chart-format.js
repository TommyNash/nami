
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
