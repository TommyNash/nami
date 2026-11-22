function patchKpiCard(card, { label, value, fmt, digits, sub }) {
  if (!card) return;
  if (label != null) {
    const el = card.querySelector('.kpi-label');
    const text = String(label);
    if (el && el.textContent !== text) el.textContent = text;
  }
  const valueEl = card.querySelector('[data-countup]');
  if (valueEl) {
    if (fmt) valueEl.dataset.countFmt = fmt;
    if (digits != null) valueEl.dataset.countDigits = String(digits);
    valueEl.dataset.countup = String(Number(value) || 0);
  }
  if (sub != null) {
    const el = card.querySelector('.kpi-sub');
    if (el) el.innerHTML = sub;
  }
}
