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

