function openPeriodPop(anchor, period, months) {
  const pop = ensurePeriodPop();
  const range = parseRangePeriod(period);
  const now = new Date();
  const today = todayIso();
  let viewYear = now.getFullYear();
  // Целые месяцы — сетка месяцев с подсветкой; частичный диапазон — дни.
  const wholeMonths = !!(range && isWholeMonthRange(range.from, range.to, today));
  let mode = range && !wholeMonths ? 'days' : 'months';
  let calYear = now.getFullYear();
  let calMonth = now.getMonth() + 1;
  let drag = null;
  let swallowClick = false;
  let lastMonthTap = null;
  let pendingCommit = 0;

  if (typeof period === 'string' && period.startsWith('m:')) {
    viewYear = Number(period.slice(2, 6)) || viewYear;
    calYear = viewYear;
    calMonth = Number(period.slice(7, 9)) || calMonth;
  } else if (range) {
    // Для целых месяцев смотрим на начало диапазона — год сетки.
    const focus = wholeMonths ? range.from : range.to;
    viewYear = Number(focus.slice(0, 4)) || viewYear;
    calYear = viewYear;
    calMonth = Number(focus.slice(5, 7)) || calMonth;
  }

  const dataYears = (months || [])
    .map((m) => Number(String(m.key || '').slice(0, 4)))
    .filter((y) => Number.isFinite(y));
  const minYear = dataYears.length ? Math.min(...dataYears) : viewYear - 2;
  const maxYear = Math.max(now.getFullYear(), ...(dataYears.length ? dataYears : [viewYear]));
  const monthBounds = () => selectedMonthBounds(period, today);

  const selectionLabel = () => {
    if (drag && drag.from && drag.to) {
      if (drag.kind === 'months') {
        if (drag.from === drag.to) return formatMonthLabel(drag.from);
        const [start, end] = monthSpan(drag.from, drag.to, today);
        return formatRangeLabel(start, end);
      }
      const a = drag.from <= drag.to ? drag.from : drag.to;
      const b = drag.from <= drag.to ? drag.to : drag.from;
      return formatRangeLabel(a, b);
    }
    if (typeof period === 'string' && period.startsWith('m:')) return formatMonthLabel(period.slice(2));
    if (period === 'month') return T('period.currentMonth');
    if (range) return formatRangeLabel(range.from, range.to);
    return '';
  };

  const cancelPending = () => {
    if (!pendingCommit) return;
    clearTimeout(pendingCommit);
    pendingCommit = 0;
  };
  pop.__cancelPeriodCommit = cancelPending;

  const applyRange = (a, b) => {
    const from = a <= b ? a : b;
    const toRaw = a <= b ? b : a;
    const to = toRaw > today ? today : toRaw;
    closePeriodPop();
    window.FoundersApp.setPeriod(`r:${from}:${to}`);
  };

  const openDaysFor = (ym) => {
    const [y, m] = String(ym).split('-').map(Number);
    if (!y || !m) return;
    calYear = y;
    calMonth = m;
    viewYear = y;
    mode = 'days';
    drag = null;
    render();
    placePeriodPop(anchor);
  };

  const shiftMonth = (delta) => {
    const dt = new Date(calYear, calMonth - 1 + delta, 1);
    const nextKey = isoDate(dt.getFullYear(), dt.getMonth() + 1, 1).slice(0, 7);
    if (nextKey > today.slice(0, 7)) return false;
    calYear = dt.getFullYear();
    calMonth = dt.getMonth() + 1;
    return true;
  };

  const paint = () => {
    if (mode === 'months') {
      const bounds = monthBounds();
      const from = drag && drag.kind === 'months' ? drag.from : bounds && bounds.lo;
      const to = drag && drag.kind === 'months' ? drag.to : bounds && bounds.hi;
      const lo = from && to ? (from <= to ? from : to) : null;
      const hi = from && to ? (from <= to ? to : from) : null;
      pop.querySelectorAll('[data-pick-month]').forEach((btn) => {
        const key = btn.dataset.pickMonth;
        const inside = !!(lo && key >= lo && key <= hi);
        btn.classList.toggle('is-in', inside);
        btn.classList.toggle('is-start', !!(lo && key === lo));
        btn.classList.toggle('is-end', !!(hi && key === hi));
        btn.classList.toggle('is-active', !!(lo && hi && lo === hi && key === lo));
      });
      return;
    }
    const from = drag && drag.kind === 'days' ? drag.from : range ? range.from : null;
    const to = drag && drag.kind === 'days' ? drag.to : range ? range.to : null;
    const lo = from && to ? (from <= to ? from : to) : null;
    const hi = from && to ? (from <= to ? to : from) : null;
    pop.querySelectorAll('[data-day]').forEach((btn) => {
      const key = btn.dataset.day;
      const inside = !!(lo && hi && key >= lo && key <= hi && key <= today);
      btn.classList.toggle('is-in', inside);
      btn.classList.toggle('is-start', !!(lo && key === lo));
      btn.classList.toggle('is-end', !!(hi && key === hi));
      btn.classList.toggle('is-anchor', !!(drag && drag.kind === 'days' && key === drag.from));
    });
    const selEl = pop.querySelector('.period-pop-sel');
    const label = selectionLabel();
    if (selEl && label) selEl.textContent = label;
  };

  const infoIcon =
    window.FoundersIcons && window.FoundersIcons.svg
      ? window.FoundersIcons.svg('info', 14)
      : 'i';
  const isCustom =
    typeof period === 'string' && (period.startsWith('m:') || period.startsWith('r:'));

  const render = () => {
    const sel = selectionLabel();
    const hint =
      mode === 'days'
        ? T('period.hint.days')
        : T('period.hint.months');
    const foot = `
      <div class="period-pop-foot">
        <button type="button" class="period-pop-info" data-period-hint="${F().esc(
          hint
        )}" aria-label="${F().esc(hint)}">${infoIcon}</button>
        <button type="button" class="period-pop-quick" data-open-days ${
          mode === 'days' ? 'hidden' : ''
        }>${T('period.pickDays')}</button>
        <span class="period-pop-foot-spacer"></span>
        <button type="button" class="period-pop-reset" data-period-reset ${
          isCustom ? '' : 'hidden'
        }>${T('period.reset')}</button>
      </div>`;
    if (mode === 'days') {
      const cells = calendarCells(calYear, calMonth);
      const week = [
        T('period.weekdayShort.mon'),
        T('period.weekdayShort.tue'),
        T('period.weekdayShort.wed'),
        T('period.weekdayShort.thu'),
        T('period.weekdayShort.fri'),
        T('period.weekdayShort.sat'),
        T('period.weekdayShort.sun')
      ]
        .map((d) => `<span>${d}</span>`)
        .join('');
      const days = cells
        .map((c) => {
          const key = isoDate(c.y, c.m, c.d);
          const future = key > today;
          const cls = [
            'period-cal-day',
            c.out ? 'is-out' : '',
            future ? 'is-future' : '',
            key === today ? 'is-today' : ''
          ]
            .filter(Boolean)
            .join(' ');
          return `<button type="button" class="${cls}" data-day="${key}" ${
            future ? 'disabled' : ''
          }>${c.d}</button>`;
        })
        .join('');
      pop.innerHTML = `
        <div class="period-pop-head">
          <button type="button" class="period-pop-nav" data-back-months aria-label="${T('period.backToMonths')}">‹</button>
          <div class="period-pop-year">${F().esc(monthTitle(calYear, calMonth))}</div>
          <div class="period-pop-navpair">
            <button type="button" class="period-pop-nav" data-month-delta="-1" aria-label="${T('period.prevMonth')}">‹</button>
            <button type="button" class="period-pop-nav" data-month-delta="1" aria-label="${T('period.nextMonth')}">›</button>
          </div>
        </div>
        <div class="period-pop-sel">${F().esc(sel || T('period.selectDays'))}</div>
        <div class="period-cal-week">${week}</div>
        <div class="period-cal-grid">${days}</div>
        ${foot}`;
    } else {
      pop.innerHTML = `
        <div class="period-pop-head">
          <button type="button" class="period-pop-nav" data-year-delta="-1" ${
            viewYear <= minYear ? 'disabled' : ''
          } aria-label="${T('period.prevYear')}">‹</button>
          <div class="period-pop-year">${viewYear}</div>
          <button type="button" class="period-pop-nav" data-year-delta="1" ${
            viewYear >= maxYear ? 'disabled' : ''
          } aria-label="${T('period.nextYear')}">›</button>
        </div>
        <div class="period-pop-sel">${F().esc(sel || T('period.selectMonths'))}</div>
        <div class="period-pop-months">${periodPopMonthGrid(viewYear, period, months)}</div>
        ${foot}`;
    }
    paint();

    const stay = (fn) => (e) => {
      if (drag) return;
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    pop.querySelectorAll('[data-year-delta]').forEach((btn) => {
      btn.onclick = stay(() => {
        viewYear += Number(btn.dataset.yearDelta) || 0;
        viewYear = Math.max(minYear, Math.min(maxYear, viewYear));
        render();
        placePeriodPop(anchor);
      });
    });
    const back = pop.querySelector('[data-back-months]');
    if (back) {
      back.onclick = stay(() => {
        mode = 'months';
        viewYear = calYear;
        render();
        placePeriodPop(anchor);
      });
    }
    pop.querySelectorAll('[data-month-delta]').forEach((btn) => {
      btn.onclick = stay(() => {
        shiftMonth(Number(btn.dataset.monthDelta) || 0);
        render();
        placePeriodPop(anchor);
      });
    });
    const openDays = pop.querySelector('[data-open-days]');
    if (openDays) {
      openDays.onclick = stay(() => {
        const bounds = monthBounds();
        const key =
          (bounds && bounds.hi) ||
          `${calYear}-${String(calMonth).padStart(2, '0')}`;
        openDaysFor(key);
      });
    }
    const reset = pop.querySelector('[data-period-reset]');
    if (reset) {
      reset.onclick = stay(() => {
        cancelPending();
        closePeriodPop();
        window.FoundersApp.setPeriod('month');
      });
    }
    const infoBtn = pop.querySelector('.period-pop-info');
    if (infoBtn) {
      const showHint = () => {
        const tip = ensurePeriodHintTip();
        tip.textContent = infoBtn.dataset.periodHint || hint;
        tip.classList.add('is-open');
        const r = infoBtn.getBoundingClientRect();
        const tw = tip.offsetWidth || 220;
        const th = tip.offsetHeight || 40;
        let left = r.left;
        let top = r.top - th - 8;
        if (top < 8) top = r.bottom + 8;
        left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
      };
      const hideHint = () => {
        const tip = document.getElementById('periodHintTip');
        if (tip) tip.classList.remove('is-open');
      };
      infoBtn.onmouseenter = showHint;
      infoBtn.onmouseleave = hideHint;
      infoBtn.onfocus = showHint;
      infoBtn.onblur = hideHint;
      infoBtn.onclick = stay(() => {
        const tip = document.getElementById('periodHintTip');
        if (tip && tip.classList.contains('is-open')) hideHint();
        else showHint();
      });
    }
  };

  const zoomIntoDays = () => {
    if (!drag || drag.kind !== 'months') return;
    const startKey = drag.from <= drag.to ? drag.from : drag.to;
    const endKey = drag.from <= drag.to ? drag.to : drag.from;
    const [ey, em] = endKey.split('-').map(Number);
    calYear = ey;
    calMonth = em;
    viewYear = ey;
    const sameMonth = startKey === endKey;
    drag.kind = 'days';
    drag.from = isoDate(Number(startKey.slice(0, 4)), Number(startKey.slice(5, 7)), 1);
    drag.to = drag.from;
    drag.refine = sameMonth;
    drag.moved = false;
    mode = 'days';
    render();
  };

  const hit = (e) => document.elementFromPoint(e.clientX, e.clientY);

  const onPointerDown = (e) => {
    const month = e.target.closest && e.target.closest('[data-pick-month]');
    const day = e.target.closest && e.target.closest('[data-day]');
    if (month && !month.disabled && pop.contains(month)) {
      const key = month.dataset.pickMonth;
      const nowTs = Date.now();
      if (lastMonthTap && lastMonthTap.key === key && nowTs - lastMonthTap.at < 420) {
        cancelPending();
        lastMonthTap = null;
        openDaysFor(key);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      cancelPending();
      lastMonthTap = { key, at: nowTs };
      drag = {
        kind: 'months',
        from: key,
        to: key,
        moved: false,
        pointerId: e.pointerId
      };
      pop.setPointerCapture(e.pointerId);
      paint();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (day && !day.disabled && pop.contains(day)) {
      drag = {
        kind: 'days',
        from: day.dataset.day,
        to: day.dataset.day,
        moved: false,
        refine: false,
        pointerId: e.pointerId
      };
      pop.setPointerCapture(e.pointerId);
      paint();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const el = hit(e);
    if (!el || !el.closest) return;

    if (drag.kind === 'months') {
      const nav = el.closest('.period-pop-nav');
      if (nav && pop.contains(nav)) {
        zoomIntoDays();
        return;
      }
      const month = el.closest('[data-pick-month]');
      if (month && !month.disabled && pop.contains(month) && month.dataset.pickMonth !== drag.to) {
        drag.to = month.dataset.pickMonth;
        drag.moved = true;
        paint();
      }
      return;
    }

    const step = el.closest('[data-month-delta]');
    if (step && pop.contains(step) && !drag.shifting) {
      const delta = Number(step.dataset.monthDelta) || 0;
      drag.shifting = true;
      if (shiftMonth(delta)) {
        const last = new Date(calYear, calMonth, 0).getDate();
        let edge = delta < 0 ? isoDate(calYear, calMonth, 1) : isoDate(calYear, calMonth, last);
        if (edge > today) edge = today;
        if (drag.refine) {
          drag.from = edge;
          drag.refine = false;
        }
        drag.to = edge;
        drag.moved = true;
        render();
      }
      setTimeout(() => {
        if (drag) drag.shifting = false;
      }, 420);
      return;
    }
    const day = el.closest('[data-day]');
    if (!day || day.disabled || !pop.contains(day)) return;
    const key = day.dataset.day;
    if (!key || key > today || key === drag.to) return;
    if (drag.refine) {
      drag.from = key;
      drag.to = key;
      drag.refine = false;
    } else {
      drag.to = key;
    }
    drag.moved = true;
    const [y, m] = key.split('-').map(Number);
    if (y !== calYear || m !== calMonth) {
      calYear = y;
      calMonth = m;
      render();
    } else {
      paint();
    }
  };

  const onPointerUp = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const current = drag;
    drag = null;
    swallowClick = true;
    try {
      pop.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* уже отпущен */
    }
    if (current.kind === 'months') {
      if (!current.moved || current.from === current.to) {
        const key = current.from;
        cancelPending();
        pendingCommit = window.setTimeout(() => {
          pendingCommit = 0;
          if (drag) return;
          closePeriodPop();
          window.FoundersApp.setPeriod(`m:${key}`);
        }, 400);
        return;
      }
      cancelPending();
      lastMonthTap = null;
      const [start, end] = monthSpan(current.from, current.to, today);
      closePeriodPop();
      window.FoundersApp.setPeriod(`r:${start}:${end}`);
      return;
    }
    if (current.refine && !current.moved) return;
    if (!current.from || !current.to) return;
    applyRange(current.from, current.to);
  };

  if (pop.__offPeriod) pop.__offPeriod();
  const onClickCapture = (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  };
  pop.addEventListener('pointerdown', onPointerDown);
  pop.addEventListener('pointermove', onPointerMove);
  pop.addEventListener('pointerup', onPointerUp);
  pop.addEventListener('pointercancel', onPointerUp);
  pop.addEventListener('click', onClickCapture, true);
  pop.__offPeriod = () => {
    pop.removeEventListener('pointerdown', onPointerDown);
    pop.removeEventListener('pointermove', onPointerMove);
    pop.removeEventListener('pointerup', onPointerUp);
    pop.removeEventListener('pointercancel', onPointerUp);
    pop.removeEventListener('click', onClickCapture, true);
  };

  render();
  pop.hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
  placePeriodPop(anchor);
  requestAnimationFrame(() => placePeriodPop(anchor));
}

/** Обновить активный пункт уже смонтированного сегмента, не пересоздавая DOM. */
function syncPeriodSeg(seg, period) {
  if (!seg) return false;
  const buttons = seg.querySelectorAll('.seg-btn');
  if (!buttons.length) return false;
  const customActive = isCustomPeriod(period);
  const menuLabel = periodMenuLabel(period);
  buttons.forEach((btn) => {
    if (btn.hasAttribute('data-period-menu')) {
      btn.classList.toggle('active', customActive);
      btn.dataset.period = customActive ? String(period) : 'month';
      const label = btn.querySelector('.seg-month-label');
      if (label && label.textContent !== menuLabel) label.textContent = menuLabel;
      return;
    }
    btn.classList.toggle('active', !customActive && btn.dataset.period === period);
  });
  if (window.FoundersMotion && window.FoundersMotion.flush) {
    window.FoundersMotion.flush(seg);
  } else if (window.FoundersMotion && window.FoundersMotion.sync) {
    window.FoundersMotion.sync(seg);
  }
  return true;
}

function bindPeriod(root) {
  root.querySelectorAll('[data-period]:not([data-period-menu])').forEach((btn) => {
    btn.onclick = () => {
      closePeriodPop();
      window.FoundersApp.setPeriod(btn.dataset.period);
    };
  });
  root.querySelectorAll('[data-period-menu]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pop = ensurePeriodPop();
      if (!pop.hidden && btn.getAttribute('aria-expanded') === 'true') {
        closePeriodPop();
        return;
      }
      const months = await earnMonthsCached(activeAccountIdFrom(null) || null);
      const period = window.FoundersApp.state.period;
      openPeriodPop(btn, period, months);
    };
  });
}

async function earnMonthsCached(accountId) {
  const key = accountId ? String(accountId) : '';
  if (!window.__faEarnMonths || window.__faEarnMonthsAccount !== key) {
    window.__faEarnMonths = await window.NamiServices.portfolio.earnMonths(accountId || null);
    window.__faEarnMonthsAccount = key;
  }
  return window.__faEarnMonths || [];
}

function parseMoneyInput(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Отображение суммы в инпуте: «22 851,92». */
function formatMoneyInputValue(n) {
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Intl.NumberFormat(window.NamiI18n.locale, {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(n);
}

/** Живое форматирование при вводе: тысячи пробелом, запятая для копеек. */
function formatMoneyInputLive(raw) {
  let s = String(raw || '')
    .replace(/\s/g, '')
    .replace(/\./g, ',');
  if (!s) return '';
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  const hasComma = s.includes(',');
  let [intPart, fracPart = ''] = s.split(',');
  intPart = String(intPart || '').replace(/\D/g, '');
  fracPart = String(fracPart || '')
    .replace(/\D/g, '')
    .slice(0, 2);
  if (!intPart && !hasComma) return neg ? '-' : '';
  const intFmt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  let out = `${neg ? '-' : ''}${intFmt}`;
  if (hasComma) out += `,${fracPart}`;
  return out;
}

function setMoneyInputFormatted(inp, next) {
  if (!inp) return;
  const prev = String(inp.value || '');
  const sel = inp.selectionStart == null ? prev.length : inp.selectionStart;
  const digitsBefore = prev.slice(0, sel).replace(/\D/g, '').length;
  const hadCommaBeforeCaret = prev.slice(0, sel).includes(',') || prev.slice(0, sel).includes('.');
  inp.value = next;
  // Курсор — после того же числа цифр (и запятой, если она уже была слева).
  let seen = 0;
  let pos = next.length;
  for (let i = 0; i < next.length; i += 1) {
    const ch = next[i];
    if (/\d/.test(ch)) {
      seen += 1;
      if (seen >= digitsBefore && !hadCommaBeforeCaret) {
        pos = i + 1;
        break;
      }
      if (seen > digitsBefore) {
        pos = i;
        break;
      }
      pos = i + 1;
    } else if ((ch === ',' || ch === '.') && hadCommaBeforeCaret && seen >= digitsBefore) {
      pos = i + 1;
      break;
    }
  }
  try {
    inp.setSelectionRange(pos, pos);
  } catch (_) {
    /* ignore */
  }
}
