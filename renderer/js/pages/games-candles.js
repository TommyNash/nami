function shortDay(day) {
  if (F().dateAxis) return F().dateAxis(day);
  const [, m, d] = String(day).split('-');
  return m && d ? `${d}.${m}` : String(day || '');
}

/* —— Тултип для дневных свечей ——
   Живёт в body: карточки обрезаны squircle clip-path, поэтому внутренний
   ::after был бы отрезан. Делегирование на document — не требует перепривязки. */
function ensureDaysTip() {
  let tip = document.getElementById('daysTip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'daysTip';
    tip.className = 'days-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function placeDaysTip(tip, rect) {
  const pad = 8;
  tip.style.left = '-9999px';
  tip.style.top = '0px';
  tip.classList.add('is-open');
  const w = tip.offsetWidth || 140;
  const h = tip.offsetHeight || 28;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));
  let top = rect.top - h - 8;
  if (top < pad) top = rect.bottom + 8;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function bindDaysTips() {
  const tip = ensureDaysTip();
  const hide = () => tip.classList.remove('is-open');

  document.addEventListener('mouseover', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const day = target.closest('.kpi-day');
    if (day) {
      const text = day.getAttribute('data-tip') || '';
      if (!text) return hide();
      tip.textContent = text;
      placeDaysTip(tip, day.getBoundingClientRect());
      return;
    }
    const strip = target.closest('.kpi-days');
    if (strip) {
      const text = strip.getAttribute('data-tip') || '';
      if (!text) return hide();
      tip.textContent = text;
      placeDaysTip(tip, strip.getBoundingClientRect());
      return;
    }
    hide();
  });

  // Прокрутка/уход курсора: тултип не должен «висеть»
  document.addEventListener('mouseleave', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}

/**
 * Дни периода для карточки дохода.
 * Показываем РЕАЛЬНЫЕ суммы за день, посчитанные по играм (дневные бакеты
 * Яндекса). Суммы за период/месяц НЕ размазываем по дням — это давало
 * фиктивные значения. День без дневного бакета = данных нет, либо
 * «только в сумме периода», если есть покрывающий range/month с доходом.
 */
function earnDaysOf(view) {
  const cov = view.coverage || {};
  const ov = view.overview || {};
  const { fromDay, toDay } = candleWindow(view.period, ov.bounds || cov.bounds, cov.today);
  if (!toDay) return [];

  const byDay = new Map();
  const covers = [];
  const seriesBy = indexDays(cov.earnSeriesDays);
  (cov.earnBuckets || []).forEach((b) => {
    if (!b || !b.from) return;
    // Однодневный бакет — это день, даже если бэкенд пометил 1-е число как month.
    const isDay = b.kind === 'day' || b.from === b.to;
    if (isDay) {
      // hasValue=false (или earn == null/0) → Яндекс ещё не посчитал день.
      const v = Number(b.earn);
      const hasValue = b.hasValue === true && Number.isFinite(v);
      byDay.set(b.from, {
        value: hasValue ? v : null,
        games: b.games,
        withValue: b.gamesWithValue
      });
      return;
    }
    if (b.hasValue === true && b.to) {
      covers.push({ from: b.from, to: b.to });
    }
  });

  return dayList(fromDay, toDay).map((day) => {
    const hit = byDay.get(day);
    const series = seriesBy.get(day);
    const seriesValue = series && Number(series.earn) > 0 ? Number(series.earn) : null;
    // Точный дневной бакет важнее ряда. Если его нет или Яндекс ещё не
    // посчитал — берём сумму рекламы и инапов по играм за этот день.
    if (hit && hit.value != null) {
      return { day, value: hit.value, reason: 'value', games: hit.games, withValue: hit.withValue };
    }
    if (seriesValue != null) {
      return {
        day,
        value: seriesValue,
        reason: 'series',
        games: series.games,
        withValue: series.gamesWithValue
      };
    }
    if (hit) {
      return { day, value: null, reason: 'pending', games: hit.games, withValue: hit.withValue };
    }
    const inSum = covers.some((c) => c.from <= day && day <= c.to);
    if (inSum) return { day, value: null, reason: 'est' };
    return { day, value: null, reason: 'none' };
  });
}

function indexDays(rows) {
  const map = new Map();
  (rows || []).forEach((d) => {
    if (d && d.day) map.set(d.day, d);
  });
  return map;
}

function coverageThreshold(rows, field) {
  const max = Math.max(
    ...[...(rows || [])].map((d) => Number(d && d[field]) || 0),
    0
  );
  return Math.max(1, Math.ceil(max * 0.9));
}

/** Дни периода для карточки игроков.
 *  Ряд «players: Всего» — история по дням. Снимок панели закрывает дни,
 *  которых в ряде ещё нет. В покрытие входят только опубликованные игры
 *  со статистикой — черновики не раздувают «из N игр». */
function playersDaysOf(view) {
  const cov = view.coverage || {};
  const ov = view.overview || {};
  const { fromDay, toDay } = candleWindow(view.period, ov.bounds || cov.bounds, cov.today);
  if (!toDay) return [];

  const series = cov.playersSeriesDays && cov.playersSeriesDays.length
    ? cov.playersSeriesDays
    : (cov.metricsDays || []).filter((d) => d && d.source === 'series');
  const panel = cov.panelDays && cov.panelDays.length
    ? cov.panelDays
    : series.length
      ? []
      : cov.metricsDays || ov.playersDaily || [];
  const seriesBy = indexDays(series);
  const panelBy = indexDays(panel);
  const eligible = Math.max(
    Number(cov.eligibleGames) || 0,
    coverageThreshold(series, 'gamesWithValue'),
    coverageThreshold(panel, 'games'),
    1
  );
  const fullCut = Math.max(1, Math.ceil(eligible * 0.9));
  const lag = Number(cov.expectedLagDays) || 3;
  const today = cov.today || toDay;

  return dayList(fromDay, toDay).map((day) => {
    const s = seriesBy.get(day);
    const p = panelBy.get(day);
    const seriesPlayers = s ? Number(s.players) || 0 : 0;
    const seriesGames = s ? Number(s.gamesWithValue != null ? s.gamesWithValue : s.games) || 0 : 0;
    if (seriesPlayers > 0 && seriesGames > 0) {
      const full = seriesGames >= fullCut;
        return {
        day,
        players: seriesPlayers,
        games: seriesGames,
        globalMax: eligible,
        state: full ? 'full' : 'partial',
        source: 'series'
      };
    }
    const panelPlayers = p ? Number(p.players) || 0 : 0;
    const panelGames = p ? Number(p.games) || 0 : 0;
    if (panelPlayers > 0 && panelGames > 0) {
      const full = panelGames >= fullCut;
      return {
        day,
        players: panelPlayers,
        games: panelGames,
        globalMax: eligible,
        state: full ? 'full' : 'partial',
        source: 'panel'
      };
    }
    const age = dayAgeDays(day, today);
    const pending = age >= 0 && age <= lag;
    // Ряд за этот день пришёл, но все игры — ноль: дыра Яндекса, не «не собирали».
    const hole = !!(s && Number(s.games) > 0);
    return {
      day,
      players: 0,
      games: 0,
      globalMax: eligible,
      state: 'none',
      reason: hole ? 'hole' : pending ? 'lag' : 'none'
        };
      });
}

function stripHtml(days, { mode = 'players', summary = '' } = {}) {
  if (!days.length) return '';
  const max = Math.max(...days.map((d) => Number(d.value ?? d.players) || 0), 1);

  const bars = days
    .map((d) => {
      let state;
      let tip;
      let height;

      if (mode === 'earn') {
        const has = d.value != null && Number.isFinite(d.value);
        const soft = !has && (d.reason === 'pending' || d.reason === 'est');
        // pending/est = запрос был / есть в сумме периода → бледная свеча, не серая.
        state = has ? 'is-full' : soft ? 'is-est' : 'is-none';
        height = has ? Math.max(26, Math.round(22 + (d.value / max) * 78)) : soft ? 40 : 12;
        if (has) {
          const gamesNote =
            d.withValue != null && d.games
              ? ` · ${T('games.strip.gamesOf', { n: d.games, withValue: d.withValue, games: d.games })}`
              : '';
          tip = `${shortDay(d.day)} — ${moneyFmt(d.value)}${gamesNote}${
            d.reason === 'series' ? ` · ${T('games.strip.sumByGames')}` : ''
          }`;
        } else if (d.reason === 'pending') {
          tip = T('games.strip.earnPending', { day: shortDay(d.day), games: d.games || 0 });
        } else if (d.reason === 'est') {
          tip = T('games.strip.earnEst', { day: shortDay(d.day) });
        } else {
          tip = T('games.strip.dayNotCollected', { day: shortDay(d.day) });
        }
      } else {
        const soft = d.state === 'none' && (d.reason === 'hole' || d.reason === 'lag');
        state =
          d.state === 'full'
            ? 'is-full'
            : d.state === 'partial'
              ? 'is-partial'
              : soft
                ? 'is-est'
                : 'is-none';
        height =
          d.state === 'none' && !soft
            ? 12
            : d.state === 'none'
              ? 40
              : Math.max(26, Math.round(22 + (d.players / max) * 78));
        const who =
          d.source === 'panel'
            ? ` · ${T('games.strip.sourcePanel')}`
            : d.source === 'series'
              ? ` · ${T('games.strip.sourceSeries')}`
              : '';
        tip =
          d.state === 'none'
            ? d.reason === 'hole'
              ? T('games.strip.playersHole', { day: shortDay(d.day) })
              : d.reason === 'lag'
                ? T('games.strip.playersLag', { day: shortDay(d.day) })
                : T('games.strip.playersNone', { day: shortDay(d.day) })
            : `${T('games.strip.playersDay', {
                n: d.players,
                day: shortDay(d.day),
                count: F().num(d.players, 0)
              })}${
                d.games && d.globalMax
                  ? ` ${T('games.strip.publishedOf', { games: d.games, max: d.globalMax })}`
                  : ''
              }${who}`;
      }

      return `<span class="kpi-day ${state}" style="--h:${height}%" data-tip="${F().esc(
        tip
      )}" aria-label="${F().esc(tip)}"></span>`;
    })
    .join('');

  return `<div class="kpi-days" role="img" aria-label="${F().esc(
    summary
  )}" data-tip="${F().esc(summary)}">${bars}</div>`;
}

/** Подпись-сводка для ховера: что именно получено за период. */
function daysSummary(days, mode) {
  if (!days.length) return T('games.strip.noData');
  const windowNote =
    days.length >= 31 && days[0] && days[days.length - 1]
      ? ` · ${T('games.strip.window', { from: shortDay(days[0].day), to: shortDay(days[days.length - 1].day) })}`
      : '';
  if (mode === 'earn') {
    // Свечи — это суммы по играм за конкретный день, ничего не делим.
    const got = days.filter((d) => d.value != null && Number.isFinite(d.value));
    const pending = days.filter((d) => d.reason === 'pending');
    const est = days.filter((d) => d.reason === 'est');
    const sum = got.reduce((a, d) => a + Number(d.value || 0), 0);
    const last = got[got.length - 1];
    const parts = [T('games.strip.earnDays', { got: got.length, total: days.length })];
    if (got.length) parts.push(T('games.strip.sum', { sum: moneyFmt(sum) }));
    if (pending.length) parts.push(T('games.strip.pendingDays', { n: pending.length }));
    if (est.length) parts.push(T('games.strip.estDays', { n: est.length }));
    if (last) parts.push(T('games.strip.lastDay', { day: shortDay(last.day) }));
    return parts.join(' · ') + windowNote;
  }
  const full = days.filter((d) => d.state === 'full').length;
  const partial = days.filter((d) => d.state === 'partial').length;
  const last = [...days].reverse().find((d) => d.state !== 'none');
  return `${T('games.strip.fullSlice', { full, total: days.length })}${
    partial ? `, ${T('games.strip.partial', { n: partial })}` : ''
  }${last ? `, ${T('games.strip.lastDay', { day: shortDay(last.day) })}` : ''}${windowNote}`;
}

function meanPlayers(days) {
  const full = (days || []).filter((d) => d.state === 'full' && Number(d.players) > 0);
  const use = full.length ? full : (days || []).filter((d) => Number(d.players) > 0);
  if (!use.length) return { value: 0, days: 0 };
  const value = use.reduce((s, d) => s + Number(d.players), 0) / use.length;
  return { value, days: use.length };
}

const dayStripCache = { coverage: null, overview: null, period: '', value: null };

function buildDayStrips(view) {
  if (
    dayStripCache.value &&
    dayStripCache.coverage === view.coverage &&
    dayStripCache.overview === view.overview &&
    dayStripCache.period === view.period
  ) {
    return dayStripCache.value;
  }
  const built = buildDayStripsUncached(view);
  dayStripCache.coverage = view.coverage;
  dayStripCache.overview = view.overview;
  dayStripCache.period = view.period;
  dayStripCache.value = built;
  return built;
}

function buildDayStripsUncached(view) {
  const ov = view.overview || {};
  const scoped = { ...view, period: view.period };
  const earnDays = earnDaysOf(scoped);
  const playersDays = playersDaysOf(scoped);
  const playersMean = meanPlayers(playersDays);

  const earnSummary = daysSummary(earnDays, 'earn');
  const playersSummary = daysSummary(playersDays, 'players');

  const lag = Number(ov.playersDayLag) || 0;
  const dataDay = ov.playersDay ? shortDay(ov.playersDay) : '';
  const playersIncomplete = (() => {
    const row = playersDays.find((d) => d.day === ov.playersDay);
    return !!row && row.state !== 'full';
    })();

  // На срезе «День» под цифрой свечи не нужны: это один день, не ряд.
  const showStrips = view.period !== 'day';

  return {
    earnStrip: showStrips ? stripHtml(earnDays, { mode: 'earn', summary: earnSummary }) : '',
    playersStrip: showStrips ? stripHtml(playersDays, { mode: 'players', summary: playersSummary }) : '',
    earnDays,
    playersDays,
    playersMean,
    earnSummary,
    playersSummary,
    playersIncomplete,
    playersSub: playersMean.days
      ? T('games.strip.meanOver', { n: playersMean.days, count: playersMean.days })
      : dataDay
        ? lag > 0
          ? T('games.strip.dataForLag', { day: dataDay, lag })
          : T('games.strip.dataFor', { day: dataDay })
        : T('games.strip.noPlayersSeries')
  };
}

