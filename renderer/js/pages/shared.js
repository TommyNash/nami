const F = () => window.FoundersFormat;
const C = () => window.FoundersCharts;

function moneyFmt(n) {
  return F().money(n);
}

const STATUS_RU = {
  published: T('shared.status.published'),
  draft: T('shared.status.draft'),
  created: T('shared.status.created'),
  moderation: T('shared.status.moderation'),
  need_work: T('shared.status.need_work'),
  rejected: T('shared.status.rejected'),
  banned: T('shared.status.banned'),
  removed: T('shared.status.removed'),
  archived: T('shared.status.archived')
};

function statusLabel(status) {
  if (!status) return T('shared.status.none');
  return STATUS_RU[status] || status;
}

function statusClass(status) {
  if (!status) return 'st-unknown';
  if (status === 'published') return 'st-ok';
  if (status === 'moderation' || status === 'need_work') return 'st-warn';
  if (status === 'rejected' || status === 'banned' || status === 'removed') return 'st-bad';
  return 'st-neutral';
}

/* Плавный «набег» чисел ---------------------------------------------------- */

// Что уже показали по каждому ключу: чтобы анимировать только реальные изменения
// и не «перещёлкивать» те же цифры на каждом перерендере.
const countValues = new Map();

function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_) {
    return false;
  }
}

function countFormatter(fmt, digits) {
  const NBSP = F().NBSP;
  if (fmt === 'money') {
    const d = digits == null ? 2 : digits;
    const nf = new Intl.NumberFormat(window.NamiI18n.locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    });
    return (v) => nf.format(v) + NBSP + T('format.currency');
  }
  if (fmt === 'pct') {
    const d = digits == null ? 1 : digits;
    const nf = new Intl.NumberFormat(window.NamiI18n.locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    });
    return (v) => nf.format(v) + '%';
  }
  const d = digits == null ? 0 : digits;
  const nf = new Intl.NumberFormat(window.NamiI18n.locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: d
  });
  return (v) => nf.format(v);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function countFinalText(value, fmt, digits) {
  const f = F();
  if (fmt === 'money') return f.money(value, digits == null ? 2 : digits);
  if (fmt === 'pct') return `${f.num(value, digits == null ? 1 : digits)}%`;
  return f.num(value, digits == null ? 0 : digits);
}

function counterMeta(node) {
  return {
    target: Number(node.dataset.countup),
    fmt: node.dataset.countFmt || 'num',
    digits: node.dataset.countDigits == null ? null : Number(node.dataset.countDigits),
    key: node.dataset.countKey || ''
  };
}

function animateCounter(node, from) {
  const { target, fmt, digits, key } = counterMeta(node);
  if (!Number.isFinite(target)) return;

  const startValue = Number.isFinite(from) ? from : 0;
  const format = countFormatter(fmt, digits);
  const finalText = countFinalText(target, fmt, digits);

  if (prefersReducedMotion() || startValue === target) {
    node.textContent = finalText;
    node.classList.remove('is-counting');
    return;
  }

  node.classList.add('is-counting');
  const startedAt = performance.now();
  const delta = target - startValue;
  const duration = 620 + Math.min(280, Math.log10(Math.abs(delta) + 1) * 90);

  const tick = (now) => {
    if (!node.isConnected || !node.classList.contains('is-counting')) return;
    const t = Math.min(1, (now - startedAt) / duration);
    if (t < 1) {
      node.textContent = format(startValue + delta * easeOutCubic(t));
      requestAnimationFrame(tick);
    } else {
      node.textContent = finalText;
      node.classList.remove('is-counting');
    }
  };
  requestAnimationFrame(tick);
}

/**
 * Анимация чисел в блоке.
 * `enabled: false` — просто выставить значения (фоновые обновления, чтобы не надоедало).
 * Анимируем только если значение реально изменилось с прошлого показа.
 */
function animateCounters(root, { stagger = 55, enabled = true } = {}) {
  if (!root) return;
  const nodes = root.querySelectorAll('[data-countup]');
  if (!nodes.length) return;

  nodes.forEach((node, i) => {
    const { target, fmt, digits, key } = counterMeta(node);
    if (!Number.isFinite(target)) return;

    const finalText = countFinalText(target, fmt, digits);
    const prev = key ? countValues.get(key) : null;
    if (key) countValues.set(key, { text: finalText, value: target });

    // Уже идёт анимация к этому же значению — не мешаем
    if (node.classList.contains('is-counting') && prev && prev.text === finalText) return;

    const changed = !prev || prev.text !== finalText;
    if (!enabled || !changed) {
      node.classList.remove('is-counting');
      node.textContent = finalText;
      return;
    }

    const from = prev && Number.isFinite(prev.value) ? prev.value : 0;
    const explicit = node.dataset.countDelay;
    const delay = explicit != null ? Number(explicit) : i * stagger;
    if (delay > 0) {
      node.textContent = countFormatter(fmt, digits)(from);
      setTimeout(() => {
        if (!node.isConnected) return;
        if (countValues.get(key) && countValues.get(key).text !== finalText) return;
        animateCounter(node, from);
      }, delay);
    } else {
      animateCounter(node, from);
    }
  });
}

function pickSeries(grouped, prefer) {
  const entries = Object.entries(grouped || {});
  if (!entries.length) return [];
  const preferred = prefer
    .map((name) => entries.find(([k]) => k === name || k.endsWith(`: ${name}`) || k.startsWith(`${name}:`)))
    .filter(Boolean);
  if (preferred.length) return preferred.map(([name, data]) => ({ name, data }));
  // fallback: Всего / Россия
  const scored = entries
    .map(([name, data]) => ({
      name,
      data,
      score: /Всего|Россия|СНГ/i.test(name) ? 2 : /Новые|Категория/i.test(name) ? 0 : 1 // i18n-ignore
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map(({ name, data }) => ({ name, data }));
}

/** Все ряды с префиксом slug (без «Категория …», если есть основные). */
function pickSeriesPrefix(grouped, prefix, preferEnds) {
  const entries = Object.entries(grouped || {}).filter(
    ([k]) => k === prefix || k.startsWith(`${prefix}:`)
  );
  if (!entries.length) return [];
  if (preferEnds && preferEnds.length) {
    const preferred = preferEnds
      .map((end) => entries.find(([k]) => k === `${prefix}: ${end}` || k.endsWith(`: ${end}`)))
      .filter(Boolean);
    if (preferred.length) return preferred.map(([name, data]) => ({ name, data }));
  }
  const main = entries.filter(([k]) => !/Категория/i.test(k)); // i18n-ignore
  return (main.length ? main : entries).map(([name, data]) => ({ name, data }));
}

function formatMonthLabel(ym) {
  try {
    const [y, mo] = String(ym).split('-').map(Number);
    const label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(window.NamiI18n.locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return String(ym || '');
  }
}

/** Короткое имя месяца для оси графика: «Декабрь», при другом годе — «дек 25». */
function formatMonthAxis(ym, { peerKey = '' } = {}) {
  try {
    const [y, mo] = String(ym).split('-').map(Number);
    if (!y || !mo) return String(ym || '');
    const peerY = peerKey ? Number(String(peerKey).slice(0, 4)) : y;
    const dt = new Date(Date.UTC(y, mo - 1, 1));
    if (peerY && peerY !== y) {
      const short = dt.toLocaleDateString(window.NamiI18n.locale, {
        month: 'short',
        timeZone: 'UTC'
      });
      const name = short.replace(/\./g, '').trim();
      return `${name} ${String(y).slice(2)}`;
    }
    const long = dt.toLocaleDateString(window.NamiI18n.locale, {
      month: 'long',
      timeZone: 'UTC'
    });
    return long.charAt(0).toUpperCase() + long.slice(1);
  } catch {
    return String(ym || '');
  }
}

/** Компактная ось без года: «окт.», «сент.». */
function formatMonthShort(ym) {
  try {
    const [y, mo] = String(ym).split('-').map(Number);
    if (!y || !mo) return String(ym || '');
    const dt = new Date(Date.UTC(y, mo - 1, 1));
    let short = dt
      .toLocaleDateString(window.NamiI18n.locale, { month: 'short', timeZone: 'UTC' })
      .replace(/\./g, '')
      .trim()
      .toLowerCase();
    if (short.length > 4) short = short.slice(0, 4);
    return `${short}.`;
  } catch {
    return String(ym || '');
  }
}

function openTaxPage() {
  if (window.FoundersApp && typeof window.FoundersApp.openTax === 'function') {
    window.FoundersApp.openTax();
    return;
  }
  const app = window.FoundersApp;
  if (!app || !app.state) return;
  window.NamiStore.setPage('tax');
  if (typeof app.render === 'function') app.render({ skeleton: true }).catch(() => {});
}

function accountInitials(title) {
  const parts = String(title || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0];
  if (parts.length === 1) return first.slice(0, 2).toLocaleUpperCase(window.NamiI18n.locale);
  return `${first[0] || ''}${parts[1][0] || ''}`.toLocaleUpperCase(window.NamiI18n.locale);
}

function readStoredAccountId() {
  return (window.NamiStore && window.NamiStore.state.activeAccountId) || '';
}

function writeStoredAccountId(id) {
  window.NamiStore.setActiveAccount(id);
}

var accountsCache = null;

async function loadAccounts() {
  if (accountsCache) return accountsCache;
  if (!window.NamiServices || typeof window.NamiServices.portfolio.accounts !== 'function') {
    return [];
  }
  try {
    const rows = await window.NamiServices.portfolio.accounts();
    accountsCache = Array.isArray(rows) ? rows : [];
    return accountsCache;
  } catch (err) {
    console.warn('[accounts] list_accounts:', err);
    return [];
  }
}

function resolveActiveAccount(accounts) {
  if (!accounts || !accounts.length) return null;
  const stored = readStoredAccountId();
  if (stored) {
    const hit = accounts.find((a) => String(a.id) === String(stored));
    if (hit) return hit;
  }
  return accounts[0];
}

function accountLabel(account) {
  if (!account) return '';
  return String(account.title || account.login || account.id || '').trim();
}

function accountChipHtml(account, accounts) {
  if (!account) return '';
  const title = accountLabel(account);
  const canSwitch = (accounts || []).length >= 2;
  const initials = F().esc(accountInitials(title));
  const name = F().esc(title);
  const avatar = account.avatar_url
    ? `<img class="account-avatar-img" src="${F().esc(account.avatar_url)}" alt="">`
    : `<span class="account-avatar" aria-hidden="true">${initials}</span>`;
  const caret = canSwitch
    ? `<span class="account-chip-caret" aria-hidden="true">${
        window.FoundersIcons && window.FoundersIcons.svg
          ? window.FoundersIcons.svg('caret-down', 12)
          : '▾'
      }</span>`
    : '';
  const menu = canSwitch
    ? `<div class="account-pop" id="accountPop" hidden role="menu">
        ${(accounts || [])
          .map((a) => {
            const label = accountLabel(a);
            const active = String(a.id) === String(account.id);
            const av = a.avatar_url
              ? `<img class="account-avatar-img" src="${F().esc(a.avatar_url)}" alt="">`
              : `<span class="account-avatar" aria-hidden="true">${F().esc(
                  accountInitials(label)
                )}</span>`;
            return `<button type="button" class="account-pop-item${
              active ? ' is-active' : ''
            }" role="menuitem" data-account-id="${F().esc(String(a.id))}">
              ${av}
              <span class="account-pop-text">
                <span class="account-pop-title">${F().esc(label)}</span>
                ${
                  a.login
                    ? `<span class="account-pop-login">${F().esc(String(a.login))}</span>`
                    : ''
                }
              </span>
            </button>`;
          })
          .join('')}
      </div>`
    : '';
  return `<span class="account-chip-wrap">
    <button type="button" class="account-chip${canSwitch ? ' is-switchable' : ''}"
      data-account-chip
      aria-haspopup="${canSwitch ? 'menu' : 'false'}"
      aria-expanded="false"
      ${canSwitch ? '' : 'tabindex="-1"'}
      ${canSwitch ? '' : 'disabled'}>
      ${avatar}<span class="account-name">${name}</span>${caret}
    </button>
    ${menu}
  </span>`;
}

function scopeNote(kind, bounds) {
  const period = window.FoundersApp.state.period;
  const label = window.FoundersApp.periodLabel(period);
  const range =
    bounds && bounds.fromDay ? `${F().esc(bounds.fromDay)} → ${F().esc(bounds.toDay)}` : label;
  if (kind === 'live') {
    return `<div class="scope-note">${T('shared.scope.live', { label, range })}</div>`;
  }
  if (kind === 'earn') {
    const tip =
      period === 'day' || period === 'week'
        ? T('shared.scope.earnTip')
        : '';
    return `<div class="scope-note">${T('shared.scope.earn', { label, range, tip })}</div>`;
  }
  return `<div class="scope-note">${T('shared.scope.period', { label, range })}</div>`;
}

function seriesLabel(name) {
  const map = {
    'players: Всего': T('shared.series.players'), // i18n-ignore
    'players: Новые игроки': T('shared.series.newPlayers'), // i18n-ignore
    'rating: Россия и СНГ': T('shared.series.ratingRu'), // i18n-ignore
    'rating: Остальной мир': T('shared.series.ratingWorld'), // i18n-ignore
    'play_time_for_player: Всего': T('shared.series.playTimePerPlayer'), // i18n-ignore
    'play_time: Всего': T('shared.series.playTime'), // i18n-ignore
    'purchase_amount: Инап-покупки': T('shared.series.inapp'), // i18n-ignore
    'purchase_amount: Реклама': T('shared.series.ads'), // i18n-ignore
    'arpu: ARPDAU': T('shared.series.arpdau'),
    'paying_share: Доля': T('shared.series.payingShare'), // i18n-ignore
    'paying_share: Количество платящих игроков': T('shared.series.payingCount'), // i18n-ignore
    'average_inapp_revenue_per_paying_user: Средняя выручка': T('shared.series.arppu'), // i18n-ignore
    'inapp_purchases: Количество': T('shared.series.inappCount'), // i18n-ignore
    'interstitial: Показы': T('shared.series.interstitial'), // i18n-ignore
    'rewarded: Показы': T('shared.series.rewarded'), // i18n-ignore
    'sticky: Показы': T('shared.series.sticky'), // i18n-ignore
    'ctr_cover: CTR': T('shared.series.ctrCover'),
    'ctr_cover: Показы': T('shared.series.coverImpressions'), // i18n-ignore
    'ctr_icon_my_games: CTR': T('shared.series.ctrMyGames'),
    'ctr_icon_my_games: Показы': T('shared.series.myGamesImpressions'), // i18n-ignore
    'ctr_icon_wo_my_games: CTR': T('shared.series.ctrOutsideMyGames'),
    'ctr_icon_wo_my_games: Показы': T('shared.series.outsideMyGamesImpressions'), // i18n-ignore
    'conversion_to_play: CTP': T('shared.series.conversionToPlay'),
    'conversion_to_play: Новые игроки': T('shared.series.newPlayers'), // i18n-ignore
    'game_ready_api: p50': T('shared.series.gameReadyP50'),
    'game_ready_api: p95': T('shared.series.p95'),
    'game_ready_api: Запросы': T('shared.series.requests'), // i18n-ignore
    'time_to_interactive: p50': T('shared.series.ttiP50'),
    'time_to_interactive: p95': T('shared.series.p95'),
    'time_to_interactive: Запросы': T('shared.series.requests') // i18n-ignore
  };
  return map[name] || String(name).replace(/^[^:]+:\s*/, '');
}

/** Разделы как в кабинете: Продуктовые / Монетизация / CTR / Технические */
var METRIC_SECTIONS = [
  {
    id: 'product',
    title: T('shared.metrics.sections.product'),
    charts: [
      { id: 'players', title: T('shared.series.players'), prefer: ['players: Всего', 'players: Новые игроки'] }, // i18n-ignore
      {
        id: 'playtime',
        title: T('shared.series.playTime'),
        hint: T('shared.metrics.hints.playTime'),
        prefer: ['play_time: Всего', 'play_time_for_player: Всего'], // i18n-ignore
        dualPerPlayer: true
      },
      { id: 'rating', title: T('shared.metrics.charts.rating'), prefer: ['rating: Россия и СНГ', 'rating: Остальной мир'] } // i18n-ignore
    ]
  },
  {
    id: 'monetization',
    title: T('shared.metrics.sections.monetization'),
    charts: [
      {
        id: 'revenue-ads',
        title: T('shared.metrics.charts.revenueAds'),
        hint: T('shared.metrics.hints.daily'),
        prefix: 'purchase_amount',
        preferEnds: ['Реклама'] // i18n-ignore
      },
      {
        id: 'revenue-inapp',
        title: T('shared.metrics.charts.revenueInapp'),
        hint: T('shared.metrics.hints.separateScale'),
        prefix: 'purchase_amount',
        preferEnds: ['Инап-покупки'] // i18n-ignore
      },
      {
        id: 'revenue-both',
        title: T('shared.metrics.charts.revenueBoth'),
        hint: T('shared.metrics.hints.adsInapp'),
        prefix: 'purchase_amount',
        preferEnds: ['Реклама', 'Инап-покупки'], // i18n-ignore
        dualSecond: true
      },
      { id: 'arpdau', title: T('shared.metrics.charts.arpdau'), prefix: 'arpu', preferEnds: ['ARPDAU'] },
      {
        id: 'paying',
        title: T('shared.metrics.charts.paying'),
        hint: T('shared.metrics.hints.payingShare'),
        prefix: 'paying_share',
        preferEnds: ['Доля', 'Количество платящих игроков'], // i18n-ignore
        dualSecond: true
      },
      {
        id: 'arppu',
        title: T('shared.metrics.charts.arppu'),
        prefix: 'average_inapp_revenue_per_paying_user',
        preferEnds: ['Средняя выручка'] // i18n-ignore
      },
      {
        id: 'inapp-count',
        title: T('shared.metrics.charts.inappCount'),
        prefix: 'inapp_purchases',
        preferEnds: ['Количество'] // i18n-ignore
      },
      {
        id: 'ads-impr',
        title: T('shared.metrics.charts.adsImpressions'),
        prefer: ['interstitial: Показы', 'rewarded: Показы', 'sticky: Показы'] // i18n-ignore
      }
    ]
  },
  {
    id: 'conversion',
    title: T('shared.metrics.sections.conversion'),
    charts: [
      {
        id: 'ctr-my',
        title: T('shared.metrics.charts.ctrMy'),
        hint: T('shared.metrics.hints.ctr'),
        prefix: 'ctr_icon_my_games',
        preferEnds: ['CTR', 'Показы'], // i18n-ignore
        dualSecond: true
      },
      {
        id: 'ctr-wo',
        title: T('shared.metrics.charts.ctrWo'),
        hint: T('shared.metrics.hints.ctr'),
        prefix: 'ctr_icon_wo_my_games',
        preferEnds: ['CTR', 'Показы'], // i18n-ignore
        dualSecond: true
      },
      {
        id: 'ctr-cover',
        title: T('shared.series.ctrCover'),
        hint: T('shared.metrics.hints.ctr'),
        prefix: 'ctr_cover',
        preferEnds: ['CTR', 'Показы'], // i18n-ignore
        dualSecond: true
      },
      {
        id: 'ctp',
        title: T('shared.metrics.charts.ctp'),
        prefix: 'conversion_to_play',
        preferEnds: ['CTP', 'Новые игроки'] // i18n-ignore
      },
      { id: 'playtime-conv', title: T('shared.metrics.charts.playtimeConv'), prefix: 'playtime_conversions' }
    ]
  },
  {
    id: 'tech',
    title: T('shared.metrics.sections.tech'),
    charts: [
      {
        id: 'game-ready',
        title: T('shared.metrics.charts.gameReady'),
        prefix: 'game_ready_api',
        preferEnds: ['p50', 'p95', 'Запросы'], // i18n-ignore
        dualLast: true
      },
      {
        id: 'tti',
        title: T('shared.metrics.charts.tti'),
        prefix: 'time_to_interactive',
        preferEnds: ['p50', 'p95', 'Запросы'], // i18n-ignore
        dualLast: true
      }
    ]
  }
];

var KNOWN_METRIC_PREFIXES = [
  'players',
  'rating',
  'play_time',
  'play_time_for_player',
  'purchase_amount',
  'arpu',
  'paying_share',
  'average_inapp_revenue_per_paying_user',
  'inapp_purchases',
  'interstitial',
  'rewarded',
  'sticky',
  'ctr_cover',
  'ctr_icon_my_games',
  'ctr_icon_wo_my_games',
  'conversion_to_play',
  'playtime_conversions',
  'game_ready_api',
  'time_to_interactive'
];

function buildAttention(games, periodEarnSum) {
  const items = [];
  const rejected = games.filter((g) => /reject|banned|need_work|moderation/i.test(String(g.status || '')));
  for (const g of rejected.slice(0, 3)) {
    items.push({
      tone: 'warn',
      title: `${g.title || g.id}`,
      detail: T('shared.attention.statusDetail', { status: statusLabel(g.status) })
    });
  }
  const noEarn = games.filter((g) => !(Number(g.period_earn) > 0) && g.latest_players != null);
  if (noEarn.length) {
    items.push({
      tone: 'muted',
      title: T('shared.attention.noEarn', { n: noEarn.length, count: noEarn.length }),
      detail: T('shared.attention.noEarnDetail')
    });
  }
  const noMetrics = games.filter((g) => g.latest_players == null);
  if (noMetrics.length) {
    items.push({
      tone: 'warn',
      title: T('shared.attention.noMetrics', { n: noMetrics.length, count: noMetrics.length }),
      detail: T('shared.attention.noMetricsDetail')
    });
  }
  if (!periodEarnSum) {
    items.push({
      tone: 'warn',
      title: T('shared.attention.emptyEarnTitle'),
      detail: T('shared.attention.emptyEarnDetail')
    });
  }
  return items.slice(0, 6);
}

/** Squarified treemap. `layoutValue` drives area; coords in px of the given space. */
