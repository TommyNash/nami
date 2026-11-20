const NBSP = '\u00a0';
const MINUS = '\u2212';

function parseDateInput(ts) {
  if (ts == null || ts === '') return null;
  if (ts instanceof Date) return Number.isFinite(ts.getTime()) ? ts : null;
  const raw = String(ts);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const n = Number(ts);
  if (Number.isFinite(n) && n > 1e11) {
    const d = new Date(n);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(ts);
  return Number.isFinite(d.getTime()) ? d : null;
}

function isYmd(ts) {
  return typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts);
}

window.FoundersFormat = {
  NBSP,
  esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\x22/g, '&quot;');
  },
  plural(n, forms) {
    const a = Math.abs(Number(n)) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  },
  time(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString(window.NamiI18n.locale);
    } catch {
      return '—';
    }
  },
  /** Дата с днём недели: «пн, 10 октября». */
  date(ts, opts = {}) {
    const d = parseDateInput(ts);
    if (!d) return '—';
    try {
      const tz = isYmd(ts) ? 'UTC' : undefined;
      if (opts.compact) {
        return d.toLocaleDateString(window.NamiI18n.locale, {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          timeZone: tz
        });
      }
      if (opts.full) {
        return d.toLocaleDateString(window.NamiI18n.locale, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          timeZone: tz
        });
      }
      if (opts.weekday === false) {
        return d.toLocaleDateString(window.NamiI18n.locale, {
          day: 'numeric',
          month: opts.month || 'long',
          year: opts.year,
          timeZone: tz
        });
      }
      return d.toLocaleDateString(window.NamiI18n.locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
        timeZone: tz
      });
    } catch {
      return '—';
    }
  },
  /** Коротко для осей: «пн, 10 окт». */
  dateAxis(ts) {
    return this.date(ts, { compact: true });
  },
  /** Для подсказок графика: «понедельник, 10 октября». */
  dateFull(ts) {
    return this.date(ts, { full: true });
  },
  num(value, digits = 2) {
    if (value == null || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat(window.NamiI18n.locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: Number.isInteger(n) ? 0 : Math.min(digits, 2)
    }).format(n);
  },
  money(value, digits = 2) {
    if (value == null || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return (
      new Intl.NumberFormat(window.NamiI18n.locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }).format(n) +
      NBSP +
      T('format.currency')
    );
  },
  pct(value, digits = 0) {
    if (value == null || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const sign = n > 0 ? '+' : n < 0 ? MINUS : '';
    const body = new Intl.NumberFormat(window.NamiI18n.locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    }).format(Math.abs(n));
    return `${sign}${body}%`;
  },
  periodAcc(period) {
    if (typeof period === 'string' && /^m:\d{4}-\d{2}$/.test(period)) {
      const [y, m] = period.slice(2).split('-').map(Number);
      try {
        const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(window.NamiI18n.locale, {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC'
        });
        return T('format.periodAcc.for', { label });
      } catch {
        return T('format.periodAcc.for', { label: period.slice(2) });
      }
    }
    const range = String(period || '').match(/^r:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
    if (range) {
      const fmt = (iso) => {
        const [, m, d] = iso.split('-');
        return `${d}.${m}`;
      };
      return T('format.periodAcc.range', { from: fmt(range[1]), to: fmt(range[2]) });
    }
    return (
      {
        day: T('format.periodAcc.day'),
        week: T('format.periodAcc.week'),
        month: T('format.periodAcc.month'),
        quarter: T('format.periodAcc.quarter'),
        year: T('format.periodAcc.year'),
        all: T('format.periodAcc.all')
      }[period] || T('format.periodAcc.other')
    );
  },
  periodNoun(period) {
    if (typeof period === 'string' && /^m:\d{4}-\d{2}$/.test(period)) {
      const [y, m] = period.slice(2).split('-').map(Number);
      try {
        return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(window.NamiI18n.locale, {
          month: 'long',
          year: 'numeric',
          timeZone: 'UTC'
        });
      } catch {
        return period.slice(2);
      }
    }
    const range = String(period || '').match(/^r:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/);
    if (range) {
      const fmt = (iso) => {
        const [y, m, d] = iso.split('-');
        return `${d}.${m}.${y.slice(2)}`;
      };
      return `${fmt(range[1])} – ${fmt(range[2])}`;
    }
    return (
      {
        day: T('format.periodNoun.day'),
        week: T('format.periodNoun.week'),
        month: T('format.periodNoun.month'),
        quarter: T('format.periodNoun.quarter'),
        year: T('format.periodNoun.year'),
        all: T('format.periodNoun.all')
      }[period] || String(period || '')
    );
  }
};
