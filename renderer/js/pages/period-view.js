function parseRangePeriod(period) {
  const m = String(period || '').match(/^r:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
  return m ? { from: m[1], to: m[2] } : null;
}

function formatRangeLabel(from, to) {
  const fmt = (iso) => {
    const [y, m, d] = String(iso || '').split('-');
    if (!y || !m || !d) return iso;
    const nowY = String(new Date().getFullYear());
    return y === nowY ? `${d}.${m}` : `${d}.${m}.${y.slice(2)}`;
  };
  return `${fmt(from)}–${fmt(to)}`;
}

function periodMenuLabel(period) {
  const range = parseRangePeriod(period);
  if (range) return formatRangeLabel(range.from, range.to);
  if (typeof period === 'string' && period.startsWith('m:')) return formatMonthLabel(period.slice(2));
  return T('period.options.month');
}

function isCustomPeriod(period) {
  return (
    period === 'month' ||
    (typeof period === 'string' && (period.startsWith('m:') || !!parseRangePeriod(period)))
  );
}

function periodSeg(period, months, { compact = false } = {}) {
  const opts = [
    ['day', T('period.options.day')],
    ['week', T('period.options.week')],
    ['month', T('period.options.month')],
    ['year', T('period.options.year')],
    ['all', T('period.options.all')]
  ];
  const customActive = isCustomPeriod(period);
  const menuLabel = periodMenuLabel(period);
  const caret =
    window.FoundersIcons && window.FoundersIcons.svg
      ? window.FoundersIcons.svg('caret-down', 12)
      : '';

  const seg = `
    <div class="seg" role="group" aria-label="${T('period.label')}" data-thumb-key="${
      compact ? 'period-compact' : 'period'
    }" data-tauri-drag-region="false">
      ${opts
        .map(([v, label]) => {
          if (v === 'month') {
            return `<button type="button" class="seg-btn seg-period-btn ${
              customActive ? 'active' : ''
            }" data-period-menu="1" data-period="${F().esc(
              customActive ? String(period) : 'month'
            )}" aria-haspopup="dialog" aria-expanded="false">
              <span class="seg-month-label">${F().esc(menuLabel)}</span>
              ${caret}
            </button>`;
          }
          return `<button type="button" class="seg-btn ${
            !customActive && period === v ? 'active' : ''
          }" data-period="${v}">${label}</button>`;
        })
        .join('')}
    </div>`;

  if (compact) {
    return `<div class="period-bar">${seg}</div>`;
  }

  return `<div class="period-bar period-bar-chrome">${seg}</div>`;
}

function ensurePeriodPop() {
  let el = document.getElementById('periodPop');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'periodPop';
  el.className = 'period-pop';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', T('period.pickerLabel'));
  document.body.appendChild(el);
  return el;
}

function ensurePeriodHintTip() {
  let tip = document.getElementById('periodHintTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'periodHintTip';
    tip.className = 'period-hint-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function closePeriodPop() {
  const el = document.getElementById('periodPop');
  if (el && typeof el.__cancelPeriodCommit === 'function') el.__cancelPeriodCommit();
  if (el) el.hidden = true;
  const hint = document.getElementById('periodHintTip');
  if (hint) hint.classList.remove('is-open');
  document.querySelectorAll('[data-period-menu]').forEach((b) => {
    b.setAttribute('aria-expanded', 'false');
  });
}

function placePeriodPop(anchor) {
  const pop = ensurePeriodPop();
  if (!anchor || pop.hidden) return;
  const gap = 8;
  const margin = 12;
  const rect = anchor.getBoundingClientRect();
  const w = pop.offsetWidth || 320;
  const h = pop.offsetHeight || 360;
  let left = rect.left + rect.width / 2 - w / 2;
  let top = rect.bottom + gap;
  left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
  if (top + h > window.innerHeight - margin && rect.top - gap - h > margin) {
    top = rect.top - gap - h;
  }
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function selectedMonthBounds(period, today) {
  if (typeof period === 'string' && period.startsWith('m:')) {
    const key = period.slice(2);
    return { lo: key, hi: key };
  }
  if (period === 'month') {
    const key = String(today || todayIso()).slice(0, 7);
    return { lo: key, hi: key };
  }
  const range = parseRangePeriod(period);
  if (!range) return null;
  return { lo: range.from.slice(0, 7), hi: range.to.slice(0, 7) };
}

/** Диапазон закрывает целые месяцы (с 1-го по конец / сегодня текущего). */
function isWholeMonthRange(from, to, today) {
  if (!from || !to) return false;
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return false;
  if (fd !== 1) return false;
  const last = new Date(ty, tm, 0).getDate();
  const endOk = td === last || (to === today && today.slice(0, 7) === `${ty}-${String(tm).padStart(2, '0')}`);
  return endOk;
}

function periodPopMonthGrid(year, period, monthsWithData) {
  const dataSet = new Set((monthsWithData || []).map((m) => m.key));
  const now = new Date();
  const nowKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const bounds = selectedMonthBounds(period, nowKey + '-01');
  const names = [
    T('period.monthShort.jan'),
    T('period.monthShort.feb'),
    T('period.monthShort.mar'),
    T('period.monthShort.apr'),
    T('period.monthShort.may'),
    T('period.monthShort.jun'),
    T('period.monthShort.jul'),
    T('period.monthShort.aug'),
    T('period.monthShort.sep'),
    T('period.monthShort.oct'),
    T('period.monthShort.nov'),
    T('period.monthShort.dec')
  ];
  return names
    .map((name, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`;
      const future = key > nowKey;
      const hasData = dataSet.has(key);
      const inSel = !!(bounds && key >= bounds.lo && key <= bounds.hi);
      const cls = [
        'period-pop-month',
        inSel ? 'is-in' : '',
        bounds && key === bounds.lo ? 'is-start' : '',
        bounds && key === bounds.hi ? 'is-end' : '',
        bounds && bounds.lo === bounds.hi && key === bounds.lo ? 'is-active' : '',
        hasData ? 'has-data' : '',
        future ? 'is-future' : ''
      ]
        .filter(Boolean)
        .join(' ');
      return `<button type="button" class="${cls}" data-pick-month="${key}" ${
        future ? 'disabled' : ''
      }>${name}</button>`;
    })
    .join('');
}

function isoDate(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function todayIso() {
  const n = new Date();
  return isoDate(n.getFullYear(), n.getMonth() + 1, n.getDate());
}

function monthTitle(year, month) {
  try {
    const label = new Date(year, month - 1, 1).toLocaleDateString(window.NamiI18n.locale, {
      month: 'long',
      year: 'numeric'
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return `${month}.${year}`;
  }
}

function calendarCells(year, month) {
  const first = new Date(year, month - 1, 1);
  const pad = (first.getDay() + 6) % 7;
  const daysIn = new Date(year, month, 0).getDate();
  const prevDays = new Date(year, month - 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < pad; i += 1) {
    const dt = new Date(year, month - 2, prevDays - pad + 1 + i);
    cells.push({
      y: dt.getFullYear(),
      m: dt.getMonth() + 1,
      d: dt.getDate(),
      out: true
    });
  }
  for (let d = 1; d <= daysIn; d += 1) cells.push({ y: year, m: month, d, out: false });
  while (cells.length % 7) {
    const last = cells[cells.length - 1];
    const dt = new Date(last.y, last.m - 1, last.d + 1);
    cells.push({
      y: dt.getFullYear(),
      m: dt.getMonth() + 1,
      d: dt.getDate(),
      out: true
    });
  }
  return cells;
}

function monthSpan(a, b, today) {
  const from = a <= b ? a : b;
  const to = a <= b ? b : a;
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const start = isoDate(fy, fm, 1);
  let end = isoDate(ty, tm, new Date(ty, tm, 0).getDate());
  if (end > today) end = today;
  return [start, end];
}

