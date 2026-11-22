(() => {
  const EARN_MONTHS = 12;
  const PAGE_SIZE = 50;
  const GAME_DELAY_MS = 650;
  const MAX_RETRIES = 4;
  // 401/403/419 — это истёкшая сессия/CSRF: повторять бесполезно,
  // нужна перезагрузка страницы. 429/5xx — временные, их повторяем.
  const AUTH_STATUSES = new Set([401, 403, 419]);
  const RETRYABLE = new Set([429, 500, 502, 503, 504]);
  const AUTH_RETRY_WAIT_MS = 1500;
  const AUTH_STREAK_LIMIT = 2;
  const BACKOFF_CAP_MS = 8000;
  const PACE_MIN_MS = 700;
  const PACE_MAX_MS = 4000;
  const RESUME_KEY = 'fa-auto-resume';
  const RESUME_STORAGE_KEY = 'faCollectResume';
  // После блокировки экрана сбор может стоять часами — короткий TTL сжигал прогресс.
  const RESUME_TTL_MS = 6 * 60 * 60 * 1000;
  const FETCH_TIMEOUT_MS = 45000;
  const STALL_MS = 120000;
  // Все известные slug’и /console/api/metrics-engine/analytics/data (как в кабинете).
  const METRIC_GROUPS = {
    product: ['players', 'rating', 'play_time', 'play_time_for_player'],
    conversion: [
      'conversion_to_play',
      'playtime_conversions',
      'ctr_cover',
      'ctr_icon_my_games',
      'ctr_icon_wo_my_games'
    ],
    monetization: [
      'purchase_amount',
      'arpu',
      'paying_share',
      'average_inapp_revenue_per_paying_user',
      'inapp_purchases',
      'interstitial',
      'rewarded',
      'sticky'
    ],
    performance: ['game_ready_api', 'time_to_interactive']
  };
  const METRIC_SLUGS = [
    ...METRIC_GROUPS.product,
    ...METRIC_GROUPS.conversion,
    ...METRIC_GROUPS.monetization,
    ...METRIC_GROUPS.performance
  ];
  const INAPP_SLUGS = [
    'widget_total_amount',
    'widget_total_arpu',
    'widget_total_unique_users',
    'payment_amounts'
  ];

  let running = false;
  let abort = false;
  let startedAt = 0;
  let paceMs = 1200;
  let consecutiveSoftFails = 0;
  // Сколько 401/403 подряд: после AUTH_STREAK_LIMIT считаем сессию мёртвой.
  let authStreak = 0;
  let authBlocked = false;
  let metricsDown = false;
  let lastBeatAt = 0;
  let stallRecovering = false;
  let activeFetchAbort = null;
  // CSRF: POST-запросы метрик без токена отдают 403. Токен берём из
  // /console/api/csrf-token и обновляем при протухании.
  let csrfToken = null;
  let csrfFetchedAt = 0;
  const CSRF_TTL_MS = 15 * 60 * 1000;

  /** @type {{ok:number,fail:number,retried:number,recovered:number,byStatus:Record<string,number>,failures:any[],gamesOk:number,gamesPartial:number,gamesFail:number}} */
  let quality = emptyQuality();
  let stages = emptyStages();
  let stage = null;

  function emptyStages() {
    return {
      games: { done: 0, total: 0 },
      earn: { done: 0, total: 0 },
      audience: { done: 0, total: 0 },
      purchases: { done: 0, total: 0 }
    };
  }

  let work = emptyWork();

  function emptyWork() {
    return {
      earn: { done: 0, total: 0, ms: 0 },
      games: { done: 0, total: 0, ms: 0 },
      tickAt: 0
    };
  }

  function trackWork() {
    if (!work.tickAt) return;
    const bucket = work[stage === 'earn' ? 'earn' : 'games'];
    const now = Date.now();
    bucket.ms += now - work.tickAt;
    work.tickAt = now;
    bucket.done += 1;
    if (bucket.done > bucket.total) bucket.total = bucket.done;
  }

  function unitMs(bucket, priorMs) {
    const WEIGHT = 3;
    return (bucket.ms + priorMs * WEIGHT) / (bucket.done + WEIGHT);
  }

  function workSnapshot() {
    if (!work.tickAt) return null;
    const earnLeft = Math.max(0, work.earn.total - work.earn.done);
    const gamesLeft = Math.max(0, work.games.total - work.games.done);
    const earnPrior = Math.max(paceMs, 700) + 250;
    const gamesPrior = Math.max(260, Math.floor(paceMs * 0.28)) + 250;
    return {
      done: work.earn.done + work.games.done,
      total: work.earn.total + work.games.total,
      etaMs: Math.round(earnLeft * unitMs(work.earn, earnPrior) + gamesLeft * unitMs(work.games, gamesPrior))
    };
  }

  function gameRequestCount(range) {
    const slices = monthSlices(range.from, range.to).length;
    return 3 + METRIC_SLUGS.length * slices + 1 + INAPP_SLUGS.length * slices + 2 + 1;
  }

  function stagesSnapshot() {
    const out = {};
    for (const key of Object.keys(stages)) out[key] = { ...stages[key] };
    return out;
  }

  function stageDone(key) {
    const s = stages[key];
    if (s) s.done = Math.min(s.total, s.done + 1);
  }

  function emptyQuality() {
    return {
      ok: 0,
      fail: 0,
      retried: 0,
      recovered: 0,
      byStatus: {},
      failures: [],
      gamesOk: 0,
      gamesPartial: 0,
      gamesFail: 0
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function touchBeat() {
    lastBeatAt = Date.now();
  }

  function resumeFresh(state) {
    return state && typeof state === 'object' && Date.now() - Number(state.at || 0) <= RESUME_TTL_MS;
  }

  /* —— Resume после перезагрузки / сна ——
     sessionStorage переживает reload вкладки; chrome.storage — если Chrome
     выгрузил вкладку после блокировки экрана. */
  function saveResume(state) {
    const payload = { ...state, at: Date.now() };
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify(payload));
    } catch (_) {
      /* ignore */
    }
    try {
      chrome.storage.local.set({ [RESUME_STORAGE_KEY]: payload });
    } catch (_) {
      /* ignore */
    }
    return payload;
  }

  function loadResumeSync() {
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      if (!raw) return null;
      const state = JSON.parse(raw);
      if (!resumeFresh(state)) {
        clearResume();
        return null;
      }
      return state;
    } catch (_) {
      return null;
    }
  }

  async function loadResume() {
    const local = loadResumeSync();
    if (local) return local;
    try {
      const data = await chrome.storage.local.get(RESUME_STORAGE_KEY);
      const state = data[RESUME_STORAGE_KEY];
      if (!resumeFresh(state)) {
        if (state) clearResume();
        return null;
      }
      try {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify(state));
      } catch (_) {
        /* ignore */
      }
      return state;
    } catch (_) {
      return null;
    }
  }

  function clearResume() {
    try {
      sessionStorage.removeItem(RESUME_KEY);
    } catch (_) {
      /* ignore */
    }
    try {
      chrome.storage.local.remove(RESUME_STORAGE_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  function startFromResume(state) {
    runPortfolio({
      delayMs: state.delayMs || 900,
      resume: state,
      autoReload: true,
      collectMode: state.collectMode,
      refreshWindow: state.refreshWindow,
      earnMonths: state.historyMonths,
      onlyPublished: state.onlyPublished
    });
  }

  /** После reload / сна: если остался план с autoResume — продолжаем сами. */
  function maybeAutoResume() {
    if (!/\/console/i.test(location.pathname + location.href)) return false;

    const probe = async () => {
      try {
        const res = await fetch('/console/api/csrf-token', {
          credentials: 'include',
          signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined
        });
        return res.ok;
      } catch (_) {
        return false;
      }
    };

    (async () => {
      const state = await loadResume();
      if (!state || !state.autoResume) return;
      await sleep(2000);
      const alive = await probe();
      if (alive) {
        startFromResume(state);
        return;
      }
      await sleep(3000);
      if (await probe()) startFromResume(state);
      else {
        saveResume({ ...state, autoResume: false });
        reportProgress({
          running: false,
          label: 'Сессия истекла — нужен вход',
          detail: `войдите в кабинет заново, затем нажмите «Продолжить» — собранное (${(state.doneIds || []).length} игр) сохранится`,
          etaMs: 0,
          phase: 'done',
          finishedAt: Date.now(),
          failures: (state.failures || []).slice(0, 80)
        });
      }
    })();
    return true;
  }

  /**
   * После блокировки экрана fetch/таймеры часто «замирают»: running=true,
   * прогресс не двигается. Сохраняем план и перезагружаем вкладку — autoResume
   * подхватит с того же места.
   */
  function recoverAfterWake(reason) {
    if (!running || stallRecovering || abort) return false;
    const idle = Date.now() - (lastBeatAt || startedAt || 0);
    if (idle < STALL_MS) return false;
    stallRecovering = true;
    if (activeFetchAbort) {
      try {
        activeFetchAbort.abort();
      } catch (_) {
        /* ignore */
      }
    }
    const state = loadResumeSync() || {};
    saveResume({
      ...state,
      autoResume: true,
      delayMs: state.delayMs || paceMs || 900
    });
    reportProgress({
      running: false,
      label: 'Пауза экрана — продолжаю',
      detail: reason || 'перезагрузка вкладки, прогресс сохранён',
      etaMs: 800,
      phase: 'reload',
      startedAt,
      finishedAt: Date.now()
    });
    running = false;
    setTimeout(() => {
      try {
        location.reload();
      } catch (_) {
        stallRecovering = false;
      }
    }, 600);
    return true;
  }

  function installWakeWatch() {
    const kick = (why) => {
      setTimeout(() => recoverAfterWake(why), 700);
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') kick('экран разблокирован');
    });
    window.addEventListener('online', () => kick('сеть снова онлайн'));
    window.addEventListener('pageshow', (ev) => {
      if (ev.persisted) kick('страница из кэша');
    });
    setInterval(() => {
      if (running) recoverAfterWake('нет прогресса после паузы');
    }, 20000);
  }

  function currentGameId() {
    const m = location.pathname.match(/\/console\/application\/(\d+)/);
    return m ? m[1] : null;
  }

  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function ymdCompact(d) {
    return ymd(d).replace(/-/g, '');
  }

  function monthRange(offsetMonths) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() - offsetMonths;
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    return {
      from: ymd(start),
      to: ymd(end),
      label: start.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    };
  }

  function yearRange() {
    const to = new Date();
    const from = new Date(to.getFullYear() - 1, to.getMonth(), to.getDate());
    return { from: ymd(from), to: ymd(to) };
  }

  function daysBackRange(days) {
    const to = new Date();
    const n = Math.max(1, Number(days) || 7);
    const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (n - 1));
    return { from: ymd(from), to: ymd(to) };
  }

  function currentMonthToDateRange() {
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), 1);
    return { from: ymd(from), to: ymd(to) };
  }

  function fullMonthsRange(months) {
    const to = new Date();
    const depth = Math.min(24, Math.max(1, Number(months) || EARN_MONTHS));
    const from = new Date(to.getFullYear(), to.getMonth() - (depth - 1), 1);
    return { from: ymd(from), to: ymd(to) };
  }

  function listDaysInclusive(fromYmd, toYmd) {
    const start = new Date(`${fromYmd}T00:00:00`);
    const end = new Date(`${toYmd}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
    const out = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push(ymd(d));
    }
    return out;
  }

  /**
   * План сбора:
   * - refresh/7d — только последние 7 дней (метрики одним срезом, доход по дням окна)
   * - refresh/month — текущий месяц до сегодня
   * - full/N — N месяцев назад с 1-го числа, помесячные срезы
   */
  function resolveCollectPlan(payload = {}, resume = null) {
    if (resume && resume.range && resume.range.from && resume.range.to) {
      const earnDays = Array.isArray(resume.earnDaysPlan)
        ? resume.earnDaysPlan
        : listDaysInclusive(resume.range.from, resume.range.to);
      return {
        mode: resume.collectMode || payload.collectMode || 'full',
        refreshWindow: resume.refreshWindow || payload.refreshWindow || null,
        range: resume.range,
        historyMonths: Number(resume.historyMonths != null ? resume.historyMonths : payload.earnMonths) || 0,
        earnDays,
        includeWeek: resume.includeWeek !== false,
        label: resume.planLabel || `${resume.range.from} → ${resume.range.to}`
      };
    }

    if (payload.rangeFrom && payload.rangeTo) {
      const range = { from: payload.rangeFrom, to: payload.rangeTo };
      const months = Math.min(24, Math.max(0, Number(payload.earnMonths) || 0));
      return {
        mode: payload.collectMode || 'full',
        refreshWindow: payload.refreshWindow || null,
        range,
        historyMonths: months,
        earnDays: listDaysInclusive(range.from, range.to),
        includeWeek: true,
        label: `${range.from} → ${range.to}`
      };
    }

    const mode = payload.collectMode === 'refresh' ? 'refresh' : 'full';
    if (mode === 'refresh') {
      const window = payload.refreshWindow === 'month' ? 'month' : '7d';
      if (window === 'month') {
        const range = currentMonthToDateRange();
        return {
          mode,
          refreshWindow: window,
          range,
          historyMonths: 1,
          earnDays: listDaysInclusive(range.from, range.to),
          includeWeek: true,
          label: `актуализация · месяц ${range.from.slice(0, 7)}`
        };
      }
      const range = daysBackRange(7);
      return {
        mode,
        refreshWindow: window,
        range,
        historyMonths: 0,
        earnDays: listDaysInclusive(range.from, range.to),
        includeWeek: true,
        label: `актуализация · 7 дней (${range.from} → ${range.to})`
      };
    }

    const months = Math.min(24, Math.max(1, Number(payload.earnMonths) || EARN_MONTHS));
    const range = fullMonthsRange(months);
    return {
      mode: 'full',
      refreshWindow: null,
      range,
      historyMonths: months,
      earnDays: currentMonthDays(),
      includeWeek: true,
      label: `полный · ${months} мес. (${range.from} → ${range.to})`
    };
  }

  function rememberCollect(plan, ok, extra = {}) {
    if (!ok || !plan) return;
    const stamp = {
      at: Date.now(),
      mode: plan.mode,
      refreshWindow: plan.refreshWindow || null,
      months: plan.historyMonths,
      from: plan.range && plan.range.from,
      to: plan.range && plan.range.to,
      games: extra.games != null ? Number(extra.games) : null,
      quality: extra.quality || null
    };
    const patch = { faLastCollect: stamp };
    if (plan.mode === 'full') patch.faLastFullCollect = stamp;
    try {
      chrome.storage.local.set(patch);
    } catch (_) {
      /* ignore */
    }
  }

  // Годовой запрос Яндекс режет почти все ряды до ~60 последних дней
  // (игроки, конверсии, CTR, Game Ready). Доход в purchase_amount приходит
  // целиком, но помесячный обход одинаков для всех метрик и ничего не теряет.
  function monthSlices(fromYmd, toYmd) {
    const start = new Date(`${fromYmd}T00:00:00`);
    const end = new Date(`${toYmd}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [{ from: fromYmd, to: toYmd }];
    const out = [];
    let y = start.getFullYear();
    let m = start.getMonth();
    while (y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) {
      const monthStart = new Date(y, m, 1);
      const monthEnd = new Date(y, m + 1, 0);
      const sliceFrom = monthStart < start ? start : monthStart;
      const sliceTo = monthEnd > end ? end : monthEnd;
      if (sliceFrom <= sliceTo) out.push({ from: ymd(sliceFrom), to: ymd(sliceTo) });
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
    return out.length ? out : [{ from: fromYmd, to: toYmd }];
  }

  /**
   * Статус игры из элемента списка /console/api/applications.
   * Опубликованные лежат в published-version.status.state, черновики — в draft.
   */
  function gameStatus(item) {
    if (!item || typeof item !== 'object') return null;
    const pub = item['published-version'] || item.published_version;
    const draft = item.draft;
    const state = (v) => (v && v.status && v.status.state ? String(v.status.state) : null);
    return state(pub) || state(draft) || (item.status && item.status.state) || null;
  }

  function isPublished(item) {
    return gameStatus(item) === 'published';
  }

  function qualitySummary() {    const q = quality;
    const grade =
      q.fail === 0 ? 'ok' : q.ok > 0 && q.fail > 0 ? 'partial' : q.ok === 0 && q.fail > 0 ? 'fail' : 'ok';
    return {
      grade,
      ok: q.ok,
      fail: q.fail,
      retried: q.retried,
      recovered: q.recovered,
      byStatus: { ...q.byStatus },
      pendingFails: q.failures.length,
      gamesOk: q.gamesOk,
      gamesPartial: q.gamesPartial,
      gamesFail: q.gamesFail
    };
  }

  function reportProgress(payload) {
    if (payload && payload.running) touchBeat();
    const workState = payload && payload.running ? workSnapshot() : null;
    const measured = workState && !/retry|reload/.test(payload.phase || '');
    chrome.runtime
      .sendMessage({
        type: 'auto-progress',
        payload: {
          ...payload,
          work: workState,
          etaMs: measured ? workState.etaMs : payload.etaMs,
          at: Date.now(),
          startedAt: payload.startedAt || startedAt,
          gameId: payload.gameId || currentGameId(),
          quality: qualitySummary(),
          stage,
          stages: stagesSnapshot(),
          paceMs,
          idleMs: lastBeatAt ? Date.now() - lastBeatAt : null
        }
      })
      .catch(() => {});
  }

  function bridge(pathname, search, status, body, requestBody, sourceTransport) {
    chrome.runtime
      .sendMessage({
        type: 'network-response',
        payload: {
          capturedAt: Date.now(),
          method: requestBody ? 'POST' : 'GET',
          url: `https://games.yandex.ru${pathname}${search || ''}`,
          pathname,
          search: search || '',
          status,
          contentType: 'application/json',
          durationMs: null,
          requestBody: requestBody || null,
          responseBody: typeof body === 'string' ? body : JSON.stringify(body),
          pageUrl: location.href,
          sourceTransport
        }
      })
      .catch(() => {});
  }

  async function fetchJson(pathWithSearch, init) {
    const ctrl = new AbortController();
    activeFetchAbort = ctrl;
    const timer = setTimeout(() => {
      try {
        ctrl.abort();
      } catch (_) {
        /* ignore */
      }
    }, FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(pathWithSearch, {
        credentials: 'include',
        headers: { accept: 'application/json', ...(init && init.headers) },
        ...init,
        signal: ctrl.signal
      });
      touchBeat();
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { res, body };
    } catch (err) {
      const aborted = Boolean(err && (err.name === 'AbortError' || /abort/i.test(String(err))));
      return {
        res: { ok: false, status: aborted ? 408 : 0 },
        body: null,
        error: String(err && err.message ? err.message : err),
        aborted
      };
    } finally {
      clearTimeout(timer);
      if (activeFetchAbort === ctrl) activeFetchAbort = null;
    }
  }

  async function ensureCsrf(force = false) {
    const fresh = csrfToken && Date.now() - csrfFetchedAt < CSRF_TTL_MS;
    if (fresh && !force) return csrfToken;
    try {
      const res = await fetch('/console/api/csrf-token', {
        credentials: 'include',
        headers: { accept: 'application/json' }
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      const token =
        data && (data.token || data.csrf || data.csrfToken || (data.data && data.data.token));
      if (token) {
        csrfToken = String(token);
        csrfFetchedAt = Date.now();
        return csrfToken;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  let csrfWarned = false;
  async function ensureCsrfOrWarn(force) {
    const token = await ensureCsrf(force);
    if (!token && !csrfWarned) {
      csrfWarned = true;
      reportProgress({
        running: true,
        label: 'CSRF-токен недоступен',
        detail: 'POST метрик может отдавать 403 — обновите страницу кабинета',
        etaMs: 0,
        phase: 'auth'
      });
    }
    return token;
  }

  function noteStatus(status) {
    const key = String(status || 'err');
    quality.byStatus[key] = (quality.byStatus[key] || 0) + 1;
  }

  function pushFailure(job) {
    const key = `${job.method}|${job.pathname}|${job.search || ''}|${job.requestBody || ''}`;
    if (quality.failures.some((f) => f.key === key)) return;
    quality.failures.push({ ...job, key, at: Date.now() });
  }

  function bumpPaceOnSoftFail(status) {
    if (status === 403 || status === 429) {
      consecutiveSoftFails += 1;
      paceMs = Math.min(PACE_MAX_MS, Math.round(paceMs * (1.2 + consecutiveSoftFails * 0.06)));
    }
  }

  function bodyText(body) {
    if (body == null) return '';
    if (typeof body === 'string') return body;
    try {
      return JSON.stringify(body);
    } catch (_) {
      return '';
    }
  }

  function isMaintenance(body) {
    return /техническ\w*\s+работ|приходите позднее|technical\s+works?|under\s+maintenance/i.test(
      bodyText(body)
    );
  }

  function isMetricsApi(pathname) {
    return (
      pathname === '/console/api/application-metrics' ||
      String(pathname || '').indexOf('/console/api/metrics-engine/') === 0
    );
  }

  function noteMetricsDown(job, status) {
    metricsDown = true;
    reportProgress({
      running: true,
      label: 'Метрики недоступны',
      detail: 'техработы в консоли · собираю остальное',
      etaMs: 0,
      phase: 'retry',
      gameId: job.gameId || null
    });
    noteStatus(status || 'maint');
  }

  function easePaceOnSuccess() {
    consecutiveSoftFails = 0;
    // Ускоряемся быстрее, чем замедлялись: иначе после одного 403
    // темп «залипал» на секундах и сбор тянулся.
    paceMs = Math.max(PACE_MIN_MS, Math.round(paceMs * 0.78));
  }

  /**
   * Запрос с ретраями.
   * 401/403 — сессия истекла: один короткий повтор, затем блокируем сбор.
   * 429/5xx — экспоненциальная пауза, но не дольше BACKOFF_CAP_MS.
   * При окончательном фейле кладёт job в очередь повторного прогона.
   */
  async function requestWithRetry(job, attemptFn) {
    let last = { ok: false, status: 0, body: null };
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
      if (abort || authBlocked) return { ok: false, aborted: true, status: 0, body: null };
      touchBeat();
      try {
        last = await attemptFn();
      } catch (err) {
        last = { ok: false, status: 0, body: null, error: String(err && err.message ? err.message : err) };
      }

      noteStatus(last.status || 'net');

      if (last.ok) {
        quality.ok += 1;
        if (attempt > 1) quality.recovered += 1;
        authStreak = 0;
        easePaceOnSuccess();
        touchBeat();
        return last;
      }

      // Таймаут после сна/блокировки экрана — не считаем сессию мёртвой.
      if (Number(last.status) === 408 || last.aborted) {
        quality.retried += 1;
        reportProgress({
          running: true,
          label: 'Таймаут запроса — повтор',
          detail: job.pathname,
          etaMs: 1200,
          phase: 'retry',
          gameId: job.gameId || null
        });
        await sleep(1200);
        continue;
      }

      const status = Number(last.status);
      const isAuth = AUTH_STATUSES.has(status);
      if (isAuth) {
        if (job.optional) {
          reportProgress({
            running: true,
            label: `Пропуск · HTTP ${status}`,
            detail: job.pathname,
            etaMs: 0,
            phase: 'retry',
            gameId: job.gameId || null
          });
          break;
        }

        // 403 на POST — сначала обновляем CSRF, потом считаем сессию мёртвой.
        const csrfRetry = job.method === 'POST' && !job._csrfTried && status === 403;
        if (csrfRetry) {
          csrfToken = null;
          csrfFetchedAt = 0;
          job._csrfTried = true;
          job._csrfForced = true;
          quality.retried += 1;
          reportProgress({
            running: true,
            label: 'Обновляю CSRF-токен',
            detail: job.pathname,
            etaMs: AUTH_RETRY_WAIT_MS,
            phase: 'auth',
            gameId: job.gameId || null
          });
          await sleep(AUTH_RETRY_WAIT_MS);
          continue;
        }

        // Техработы / metrics-engine при живой сессии — не рвём весь сбор.
        const sessionAlive = quality.ok > 0;
        if (
          isMaintenance(last.body) ||
          (isMetricsApi(job.pathname) && sessionAlive && (job.method !== 'POST' || job._csrfTried))
        ) {
          noteMetricsDown(job, status);
          break;
        }

        authStreak += 1;
        bumpPaceOnSoftFail(status);
        if (attempt >= 2 || authStreak >= AUTH_STREAK_LIMIT) {
          authBlocked = true;
          break;
        }
        quality.retried += 1;
        reportProgress({
          running: true,
          label: `Сессия: HTTP ${status}`,
          detail: `${job.pathname} · повтор через ${AUTH_RETRY_WAIT_MS / 1000}с`,
          etaMs: AUTH_RETRY_WAIT_MS,
          phase: 'auth',
          gameId: job.gameId || null
        });
        await sleep(AUTH_RETRY_WAIT_MS);
        continue;
      }

      authStreak = 0;
      const retryable = RETRYABLE.has(status);
      if (!retryable || attempt >= MAX_RETRIES) break;

      quality.retried += 1;
      bumpPaceOnSoftFail(status);
      const wait = Math.min(
        BACKOFF_CAP_MS,
        Math.round(paceMs * Math.pow(1.5, attempt - 1) + Math.random() * 400)
      );
      reportProgress({
        running: true,
        label: `Повтор ${attempt}/${MAX_RETRIES - 1} · HTTP ${status}`,
        detail: `${job.pathname} · пауза ${(wait / 1000).toFixed(1)}с (pace ${paceMs}мс)`,
        etaMs: wait,
        phase: 'retry',
        gameId: job.gameId || null
      });
      await sleep(wait);
    }

    quality.fail += 1;
    bumpPaceOnSoftFail(last.status);
    if (
      (job.optional || metricsDown || isMaintenance(last.body)) &&
      AUTH_STATUSES.has(Number(last.status))
    ) {
      return last;
    }
    pushFailure({
      method: job.method || 'GET',
      pathname: job.pathname,
      search: job.search || '',
      requestBody: job.requestBody || null,
      source: job.source,
      gameId: job.gameId || null,
      status: last.status || 0,
      label: job.label || job.pathname
    });
    return last;
  }

  async function collectAndBridge(pathname, search, source, meta = {}) {
    const job = {
      method: 'GET',
      pathname,
      search: search || '',
      source,
      gameId: meta.gameId || null,
      label: meta.label || pathname,
      optional: Boolean(meta.optional)
    };
    const result = await requestWithRetry(job, async () => {
      const { res, body, aborted } = await fetchJson(`${pathname}${search || ''}`);
      if (body != null) bridge(pathname, search || '', res.status, body, null, source);
      return { ok: Boolean(res && res.ok), status: (res && res.status) || 0, body, aborted };
    });
    trackWork();
    return result;
  }

  async function postAndBridge(pathname, payload, source, meta = {}) {
    const requestBody = JSON.stringify(payload);
    const job = {
      method: 'POST',
      pathname,
      search: '',
      requestBody,
      source,
      gameId: meta.gameId || payload.game_id || null,
      label: meta.label || `${pathname} · ${payload.slug || ''}`
    };
    const result = await requestWithRetry(job, async () => {
      const token = await ensureCsrfOrWarn(Boolean(job._csrfForced));
      job._csrfForced = false;
      const headers = { 'content-type': 'application/json', accept: 'application/json' };
      if (token) {
        headers['x-csrf-token'] = token;
        headers['csrf-token'] = token;
      }
      const { res, body, aborted } = await fetchJson(pathname, {
        method: 'POST',
        headers,
        body: requestBody
      });
      if (body != null) bridge(pathname, '', res.status, body, requestBody, source);
      return { ok: Boolean(res && res.ok), status: (res && res.status) || 0, body, aborted };
    });
    trackWork();
    return result;
  }

  async function replayFailures(delayMs) {
    const queue = [...quality.failures];
    quality.failures = [];
    if (!queue.length) return { replayed: 0, left: 0 };

    reportProgress({
      running: true,
      step: 0,
      total: queue.length,
      label: `Повтор ошибок: ${queue.length}`,
      detail: 'очередь 403/5xx',
      etaMs: queue.length * Math.max(paceMs, delayMs),
      phase: 'replay'
    });

    let replayed = 0;
    for (let i = 0; i < queue.length; i += 1) {
      if (abort || authBlocked) {
        quality.failures.push(...queue.slice(i));
        break;
      }
      const job = queue[i];
      reportProgress({
        running: true,
        step: i + 1,
        total: queue.length,
        label: `Повтор ${i + 1}/${queue.length}`,
        detail: job.label || job.pathname,
        etaMs: (queue.length - i) * Math.max(paceMs, delayMs),
        phase: 'replay',
        gameId: job.gameId || null
      });

      // Сбрасываем счётчик fail для этого job — requestWithRetry снова учтёт
      const beforeFail = quality.fail;
      if (job.method === 'POST' && job.requestBody) {
        let payload = null;
        try {
          payload = JSON.parse(job.requestBody);
        } catch {
          payload = null;
        }
        if (payload) {
          await postAndBridge(job.pathname, payload, `${job.source || 'auto'}-replay`, {
            gameId: job.gameId,
            label: job.label
          });
        } else {
          pushFailure(job);
        }
      } else {
        await collectAndBridge(job.pathname, job.search || '', `${job.source || 'auto'}-replay`, {
          gameId: job.gameId,
          label: job.label
        });
      }
      // если снова зафейлилось — fail уже увеличен; если ок — recovered
      if (quality.fail === beforeFail) replayed += 1;
      await sleep(Math.max(paceMs, delayMs));
    }

    return { replayed, left: quality.failures.length };
  }

  /** Кликает Gravity UI селекты периода/платформы на открытой странице метрик. */
  async function pokeGravitySelects(delayMs) {
    const controls = [...document.querySelectorAll('.g-select-control, [class*="g-select-control"]')];
    let clicks = 0;
    for (const el of controls.slice(0, 8)) {
      if (abort || authBlocked) break;
      try {
        el.click();
        await sleep(400);
        const options = [
          ...document.querySelectorAll(
            '.g-select-list__option, .g-popup [role="option"], .g-menu__item, [class*="select-list"] [class*="option"]'
          )
        ];
        const want = options.find((o) => /год|year|все|desktop|mobile|tv|всего/i.test((o.textContent || '').trim()));
        if (want) {
          want.click();
          clicks += 1;
          await sleep(Math.max(600, delayMs));
        } else {
          document.body.click();
        }
      } catch {
        /* ignore */
      }
    }
    return clicks;
  }

  async function listAllGames(delayMs) {
    const games = [];
    let page = 0;
    let total = null;

    while (!abort) {
      const search = `?page-size=${PAGE_SIZE}&page-number=${page}&relation_context=-1&filter-field=${encodeURIComponent(
        'hide-delete-drafts:true'
      )}&filter-mode=and&order-by=${encodeURIComponent('version.changed:desc')}`;

      reportProgress({
        running: true,
        step: page + 1,
        total: total != null ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : page + 2,
        label: `Список игр · стр. ${page + 1}`,
        detail: total != null ? `${games.length} / ${total}` : 'загрузка…',
        etaMs: 0,
        phase: 'applications'
      });

      const result = await collectAndBridge('/console/api/applications', search, 'auto-applications', {
        label: `applications p${page}`
      });
      const chunk = (result.body && result.body.data) || [];
      const records =
        result.body && (result.body['records-count'] != null ? result.body['records-count'] : result.body.recordsCount);
      if (records != null) total = Number(records);
      for (const item of chunk) {
        if (item && item.id != null) games.push(item);
      }
      if (!chunk.length || (total != null && games.length >= total) || chunk.length < PAGE_SIZE) break;
      page += 1;
      await sleep(Math.min(450, Math.max(paceMs, delayMs)));
    }

    const map = new Map();
    for (const g of games) map.set(String(g.id), g);
    return [...map.values()];
  }

  async function fetchEarnRange(from, to, label, step, totalSteps, delayMs) {
    stage = 'earn';
    reportProgress({
      running: true,
      step,
      total: totalSteps,
      label: `Доходы: ${label}`,
      detail: `${from} → ${to}`,
      // Яндекс отдаёт доход за свежие дни с задержкой (обычно 1–3 дня),
      // поэтому ноль здесь — нормальный ответ, а не ошибка сбора.
      hint: 'Свежие дни могут вернуться с нулём: Яндекс считает доход с задержкой',
      etaMs: (totalSteps - step) * Math.max(paceMs, delayMs),
      phase: 'earnings'
    });
    const search = `?lang=ru&slug=total_earn&date_range=${encodeURIComponent(from)}&date_range=${encodeURIComponent(
      to
    )}`;
    await collectAndBridge('/console/api/metrics-engine/total/data', search, 'auto-earn-fetch', {
      label: `earn ${label}`
    });
    stageDone('earn');
    await sleep(Math.max(paceMs, delayMs));
  }

  /** Список дней текущего месяца по сегодня — для дневных свечей дохода. */
  function currentMonthDays() {
    const now = new Date();
    const out = [];
    const last = now.getDate();
    // Не больше 31 дня; для «месяца» в UI этого достаточно.
    for (let d = 1; d <= last; d += 1) {
      out.push(ymd(new Date(now.getFullYear(), now.getMonth(), d)));
    }
    return out;
  }

  async function collectEarnPeriods(delayMs, stepOffset, totalSteps, months, opts = {}) {
    const todayDate = new Date();
    const weekDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - 6);
    const today = ymd(todayDate);
    const weekFrom = ymd(weekDate);
    let step = stepOffset;

    // Дни с конца окна: даже при обрыве сессии свежие дни уже заполнены.
    // earnDaysDone в resume — чтобы после reload не начинать сначала.
    const doneDays = new Set(opts.earnDaysDone || []);
    const days = Array.isArray(opts.earnDays)
      ? [...opts.earnDays].reverse()
      : opts.dailyEarn === false
        ? []
        : [...currentMonthDays()].reverse();
    for (const day of days) {
      if (abort || authBlocked) break;
      step += 1;
      if (doneDays.has(day)) {
        stageDone('earn');
        continue;
      }
      await fetchEarnRange(day, day, day.slice(5), step, totalSteps, delayMs);
      doneDays.add(day);
      if (typeof opts.onEarnDayDone === 'function') opts.onEarnDayDone([...doneDays]);
    }

    if (!abort && !authBlocked && !opts.skipRanges && opts.includeWeek !== false) {
      step += 1;
      await fetchEarnRange(weekFrom, today, '7 дней', step, totalSteps, delayMs);
    }

    const historyMonths = Math.max(0, Number(months) || 0);
    if (!opts.skipRanges && historyMonths > 0) {
      for (let i = 0; i < historyMonths; i += 1) {
        if (abort || authBlocked) break;
        const range = monthRange(i);
        step += 1;
        await fetchEarnRange(range.from, range.to, range.label, step, totalSteps, delayMs);
      }
    }

    return { earnDaysDone: [...doneDays] };
  }

  async function collectGameDeep(game, index, totalGames, delayMs, baseStep, totalSteps, opts) {
    const id = String(game.id);
    const title =
      (game['published-version'] &&
        game['published-version'].title &&
        (game['published-version'].title.ru || game['published-version'].title.en)) ||
      (game.draft && game.draft.title && (game.draft.title.ru || game.draft.title.en)) ||
      id;
    const range = opts.range;
    const mobile = opts.mobileSlice || '__total__';
    const step = baseStep + index + 1;
    const failsBefore = quality.fail;
    let criticalOk = true;

    const announce = (next, detail) => {
      stage = next;
      reportProgress({
        running: true,
        step,
        total: totalSteps,
        label: `Игра ${index + 1}/${totalGames}: ${title}`,
        detail,
        etaMs: (totalSteps - step) * Math.max(GAME_DELAY_MS, paceMs, delayMs),
        phase: 'game-metrics',
        gameId: id
      });
    };

    stage = 'games';
    reportProgress({
      running: true,
      step,
      total: totalSteps,
      label: `Игра ${index + 1}/${totalGames}: ${title}`,
      detail: `панель + метрики ${range.from}…${range.to} + инапы · pace ${paceMs}мс`,
      etaMs: (totalSteps - step) * Math.max(GAME_DELAY_MS, paceMs, delayMs),
      phase: 'game',
      gameId: id
    });

    const panel = await collectAndBridge(
      '/console/api/application-panel',
      `?game_id=${encodeURIComponent(id)}&lang=ru`,
      'auto-panel',
      { gameId: id, label: `panel ${id}` }
    );
    if (!panel.ok) criticalOk = false;
    if (abort || authBlocked) return { id, grade: 'abort' };

    await collectAndBridge(`/console/api/application/${id}`, '', 'auto-application', {
      gameId: id,
      label: `app ${id}`
    });
    if (abort || authBlocked) return { id, grade: 'abort' };

    await collectAndBridge(
      '/console/api/application-metrics',
      `?game_id=${encodeURIComponent(id)}&lang=ru`,
      'auto-metrics-layout',
      { gameId: id, label: `metrics-layout ${id}`, optional: true }
    );
    if (abort || authBlocked) return { id, grade: 'abort' };

    let metricsOk = 0;
    if (!metricsDown) {
      for (let si = 0; si < METRIC_SLUGS.length; si += 1) {
        if (abort || authBlocked || metricsDown) break;
        const slug = METRIC_SLUGS[si];
        reportProgress({
          running: true,
          step,
          total: totalSteps,
          label: `Игра ${index + 1}/${totalGames}: ${title}`,
          detail: `метрика ${si + 1}/${METRIC_SLUGS.length}: ${slug}`,
          etaMs: (totalSteps - step) * Math.max(GAME_DELAY_MS, paceMs, delayMs),
          phase: 'game-metrics',
          gameId: id
        });
        const slices = monthSlices(range.from, range.to);
        let slugOk = false;
        for (let mi = 0; mi < slices.length; mi += 1) {
          if (abort || authBlocked || metricsDown) break;
          const slice = slices[mi];
          if (slices.length > 1) {
            reportProgress({
              running: true,
              step,
              total: totalSteps,
              label: `Игра ${index + 1}/${totalGames}: ${title}`,
              detail: `метрика ${slug} ${slice.from.slice(0, 7)} (${mi + 1}/${slices.length})`,
              etaMs: (totalSteps - step) * Math.max(GAME_DELAY_MS, paceMs, delayMs),
              phase: 'game-metrics',
              gameId: id
            });
          }
          const r = await postAndBridge(
            '/console/api/metrics-engine/analytics/data',
            {
              slug,
              game_id: id,
              lang: 'ru',
              mobile_slice: mobile,
              country_slice: '__total__',
              date_range: [slice.from, slice.to]
            },
            'auto-analytics',
            { gameId: id, label: `analytics ${slug} ${slice.from}` }
          );
          if (r.ok) slugOk = true;
          await sleep(Math.max(260, Math.floor(paceMs * 0.28)));
        }
        if (slugOk) metricsOk += 1;
      }
    }
    if (abort || authBlocked) return { id, grade: 'abort' };
    stageDone('games');

    announce('purchases', 'инапы');
    let inappOk = 0;
    if (!metricsDown) {
      await collectAndBridge(
        '/console/api/metrics-engine/in-app/layout',
        `?game_id=${encodeURIComponent(id)}&lang=ru`,
        'auto-inapp-layout',
        { gameId: id, label: `inapp-layout ${id}`, optional: true }
      );

      const inSlices = monthSlices(range.from, range.to);
      for (const slug of INAPP_SLUGS) {
        if (abort || authBlocked || metricsDown) break;
        let slugOk = false;
        for (const slice of inSlices) {
          if (abort || authBlocked || metricsDown) break;
          const r = await postAndBridge(
            '/console/api/metrics-engine/in-app/data',
            {
              slug,
              game_id: id,
              lang: 'ru',
              block: 'in-app',
              date_range: [slice.from.replace(/-/g, ''), slice.to.replace(/-/g, '')],
              mobile_slice: mobile,
              country_slice: '__total__',
              sku_slice: '__total__'
            },
            'auto-inapp',
            { gameId: id, label: `inapp ${slug} ${slice.from}` }
          );
          if (r.ok) slugOk = true;
          await sleep(Math.max(230, Math.floor(paceMs * 0.25)));
        }
        if (slugOk) inappOk += 1;
      }
    }
    if (abort || authBlocked) return { id, grade: 'abort' };

    announce('audience', 'отзывы');
    for (const offset of [0, 20]) {
      if (abort || authBlocked) break;
      await collectAndBridge(
        `/console/api/application-reviews/${id}`,
        `?offset=${offset}&sort=-time`,
        'auto-reviews',
        { gameId: id, label: `reviews ${id} o${offset}` }
      );
    }
    if (abort || authBlocked) return { id, grade: 'abort' };
    stageDone('audience');

    announce('purchases', 'покупки');
    await collectAndBridge(`/console/api/application-purchases/${id}`, '', 'auto-purchases', {
      gameId: id,
      label: `purchases ${id}`
    });
    if (!abort && !authBlocked) stageDone('purchases');
    await sleep(Math.max(GAME_DELAY_MS, Math.floor(Math.max(paceMs, delayMs) * 0.6)));

    const failsAfter = quality.fail - failsBefore;
    let grade = 'ok';
    if (!criticalOk) grade = 'fail';
    else if (metricsOk === 0 && !metricsDown) grade = 'fail';
    else if (
      metricsDown ||
      failsAfter > 0 ||
      metricsOk < METRIC_SLUGS.length ||
      inappOk < INAPP_SLUGS.length
    ) {
      grade = 'partial';
    }

    if (grade === 'ok') quality.gamesOk += 1;
    else if (grade === 'partial') quality.gamesPartial += 1;
    else quality.gamesFail += 1;

    return { id, title, grade, metricsOk, inappOk, fails: failsAfter };
  }

  async function runPortfolio(payload = {}) {
    if (running) return { ok: false, error: 'already-running' };
    if (!/games\.yandex\.ru/i.test(location.hostname) || !/\/console/i.test(location.pathname + location.href)) {
      return { ok: false, error: 'not-on-console' };
    }

    running = true;
    abort = false;
    authBlocked = false;
    authStreak = 0;
    metricsDown = false;
    stallRecovering = false;
    startedAt = Date.now();
    touchBeat();
    quality = emptyQuality();
    stages = emptyStages();
    work = emptyWork();
    stage = null;
    paceMs = Math.max(PACE_MIN_MS, Number(payload.delayMs) || 900);
    consecutiveSoftFails = 0;

    const delayMs = Math.max(PACE_MIN_MS, Number(payload.delayMs) || 900);
    const includeEarnings = payload.includeEarnings !== false;
    const mobileSlice = payload.mobileSlice || '__total__';
    const replayOnly = Boolean(payload.replayOnly);
    // Продолжение после перезагрузки страницы: пропускаем уже собранные игры.
    const doneIds = new Set((payload.resume && payload.resume.doneIds) || []);
    const resume = payload.resume || null;
    // Ручной запуск всегда начинает с чистого листа: старый план не мешает.
    if (!resume && !replayOnly) clearResume();
    // Очередь ошибок из прошлого прохода тоже продолжаем, а не теряем.
    if (resume && Array.isArray(resume.failures) && resume.failures.length) {
      quality.failures = resume.failures.map((f) => ({
        ...f,
        key: f.key || `${f.method || 'GET'}|${f.pathname}|${f.search || ''}`
      }));
    }
    const plan = resolveCollectPlan(payload, resume);
    const range = plan.range;
    const months = Math.max(0, Number(plan.historyMonths) || 0);
    const earnDaysPlan = Array.isArray(plan.earnDays) ? plan.earnDays : currentMonthDays();

    try {
      if (replayOnly && Array.isArray(payload.failures) && payload.failures.length) {
        quality.failures = payload.failures.map((f) => ({ ...f, key: f.key || `${f.method}|${f.pathname}` }));
        const replay = await replayFailures(delayMs);
        const q = qualitySummary();
        reportProgress({
          running: false,
          step: 1,
          total: 1,
          label: q.pendingFails ? 'Повтор с ошибками' : 'Повтор завершён',
          detail: `восстановлено ${replay.replayed}, осталось ${replay.left} · grade ${q.grade}`,
          etaMs: 0,
          phase: 'done',
          finishedAt: Date.now(),
          startedAt,
          failures: quality.failures.slice(0, 80)
        });
        return { ok: true, replay, quality: q, failures: quality.failures };
      }

      if (/#(metrics|inapp)/i.test(location.hash)) {
        reportProgress({
          running: true,
          step: 0,
          total: 1,
          label: 'Селекты кабинета',
          detail: 'g-select-control: период / платформа',
          etaMs: 0,
          phase: 'ui-selects',
          startedAt
        });
        await pokeGravitySelects(delayMs);
      }

      reportProgress({
        running: true,
        step: 0,
        total: 1,
        label: 'Старт сбора портфеля',
        detail: `${plan.label} · pace ${paceMs}мс`,
        etaMs: 0,
        phase: 'init',
        startedAt
      });

      // Список игр собирается всегда целиком (один запрос на страницу):
      // UI должен видеть весь портфель, включая черновики.
      const allGames = await listAllGames(delayMs);

      // Остановка пользователем: отчёт и выход. Если сессия умерла на списке
      // игр (authBlocked) — идём дальше в общую ветку reload+resume.
      if (abort) {
        reportProgress({
          running: false,
          label: 'Остановлено',
          detail: 'на списке игр',
          etaMs: 0,
          phase: 'done',
          finishedAt: Date.now(),
          startedAt,
          failures: quality.failures.slice(0, 80)
        });
        return { ok: true, aborted: true, games: allGames.length, quality: qualitySummary() };
      }

      // Тогл «только опубликованные»: глубокий сбор (панель + метрики
      // помесячно + инапы + отзывы) делаем лишь для игр со статусом published.
      // Черновики и отклонённые остаются в списке игр (он собирается одним
      // запросом), но не тратят сотни запросов каждая.
      const onlyPublished = payload.onlyPublished !== false;
      const games = onlyPublished ? allGames.filter(isPublished) : allGames;
      const skipped = allGames.length - games.length;
      const skippedNote = skipped
        ? ` · пропущено ${skipped} неопубликованных`
        : '';

      if (onlyPublished && !games.length) {
        reportProgress({
          running: false,
          step: 1,
          total: 1,
          label: 'Нет опубликованных игр',
          detail: `в портфеле ${allGames.length} игр, все неопубликованные — выключите «Только опубликованные»`,
          etaMs: 0,
          phase: 'done',
          finishedAt: Date.now(),
          startedAt,
          failures: quality.failures.slice(0, 80)
        });
        return { ok: true, games: 0, skipped, quality: qualitySummary(), failures: quality.failures };
      }

      // Недельный бакет + дневные бакеты окна + помесячная история (0 для refresh/7d).
      const dailyEarn = payload.dailyEarn !== false;
      const dailyEarnCount = dailyEarn ? earnDaysPlan.length : 0;
      const weekSteps = plan.includeWeek === false ? 0 : 1;
      const earnSteps = includeEarnings ? months + weekSteps + dailyEarnCount : 0;
      const totalSteps = Math.max(1, 1 + earnSteps + games.length);

      const resumedGames = games.filter((g) => doneIds.has(String(g.id))).length;
      stages.earn.total = earnSteps;
      for (const key of ['games', 'audience', 'purchases']) {
        stages[key].total = games.length;
        stages[key].done = resumedGames;
      }

      const earnDaysKnown = new Set((resume && resume.earnDaysDone) || []);
      const earnDaysLeft =
        includeEarnings && dailyEarn ? earnDaysPlan.filter((d) => !earnDaysKnown.has(d)).length : 0;
      const earnRangesLeft = resume && resume.earningsDone ? 0 : earnSteps - dailyEarnCount;
      work = emptyWork();
      work.earn.total = includeEarnings ? earnDaysLeft + Math.max(0, earnRangesLeft) : 0;
      work.games.total = (games.length - resumedGames) * gameRequestCount(range);
      work.tickAt = Date.now();

      reportProgress({
        running: true,
        step: 1,
        total: totalSteps,
        label: `Игр к сбору: ${games.length}`,
        detail: `${plan.label} · доходы ${months} мес. + ${dailyEarnCount} дн.${skippedNote}`,
        etaMs: (totalSteps - 1) * Math.max(paceMs, delayMs),
        phase: 'listed',
        startedAt
      });

      const resumeBase = () => ({
        ...(resume || {}),
        collectMode: plan.mode,
        refreshWindow: plan.refreshWindow,
        historyMonths: months,
        earnDaysPlan,
        includeWeek: plan.includeWeek !== false,
        planLabel: plan.label,
        range,
        delayMs,
        onlyPublished,
        failures: quality.failures.slice(0, 80),
        at: Date.now()
      });

      let stepOffset = 1;
      let earnDaysDone = [...((resume && resume.earnDaysDone) || [])];
      if (includeEarnings && !abort && !authBlocked) {
        // Дневные бакеты добираем всегда (даже если months уже собраны):
        // иначе после старого resume свечи недели остаются серыми.
        const needDays =
          dailyEarn && earnDaysPlan.some((d) => !earnDaysDone.includes(d));
        const needRanges = !resume || !resume.earningsDone;
        if (needDays || needRanges) {
          const earnResult = await collectEarnPeriods(delayMs, stepOffset, totalSteps, months, {
            dailyEarn,
            earnDays: earnDaysPlan,
            includeWeek: plan.includeWeek !== false,
            earnDaysDone,
            skipRanges: !needRanges,
            onEarnDayDone: (days) => {
              earnDaysDone = days;
              saveResume({
                ...resumeBase(),
                doneIds: [...doneIds],
                earnDaysDone: days,
                earningsDone: false
              });
            }
          });
          earnDaysDone = earnResult.earnDaysDone || earnDaysDone;
          const rangesDone = authBlocked
            ? false
            : needRanges
              ? true
              : !!(resume && resume.earningsDone);
          saveResume({
            ...resumeBase(),
            doneIds: [...doneIds],
            earnDaysDone,
            // Если сессия умерла на доходах — их надо будет добрать после reload.
            earningsDone: rangesDone
          });
        }
        stepOffset += earnSteps;
        if (!abort && !authBlocked) stages.earn.done = stages.earn.total;
      }

      for (let i = 0; i < games.length; i += 1) {
        if (abort || authBlocked) break;
        const gameId = String(games[i].id);
        if (doneIds.has(gameId)) continue;
        await collectGameDeep(games[i], i, games.length, delayMs, stepOffset, totalSteps, {
          range,
          mobileSlice
        });
        // Фиксируем прогресс: после перезагрузки продолжим с этого места.
        // Игру считаем собранной, только если сессия не умерла на ней.
        if (!authBlocked) doneIds.add(gameId);
        saveResume({
          ...resumeBase(),
          doneIds: [...doneIds],
          earnDaysDone,
          earningsDone: (resume && resume.earningsDone) || !authBlocked
        });
      }

      // Сессия истекла: дальше долбить API бессмысленно — перезагружаем
      // страницу (новые cookie/CSRF) и продолжаем с этого же места.
      if (authBlocked && !abort) {
        const reloads = Number((resume && resume.reloads) || 0);
        // Две перезагрузки подряд без успеха — значит дело не в cookie,
        // и дальше зацикливаться нельзя.
        const canReload = payload.autoReload !== false && reloads < 2;
        saveResume({
          ...resumeBase(),
          doneIds: [...doneIds],
          earnDaysDone,
          earningsDone: (resume && resume.earningsDone) || false,
          reloads: reloads + (canReload ? 1 : 0),
          autoResume: canReload
        });
        const q0 = qualitySummary();
        reportProgress({
          running: false,
          step: totalSteps,
          total: totalSteps,
          label: canReload ? 'Сессия истекла — перезагрузка' : 'Сессия истекла — нужен вход',
          detail: canReload
            ? `собрано игр ${doneIds.size} из ${games.length}, продолжаем автоматически`
            : `перезагрузка не помогла. Войдите в кабинет заново, затем запустите сбор — собранное (${doneIds.size} игр) сохранится`,
          etaMs: canReload ? AUTH_RETRY_WAIT_MS + 800 : 0,
          phase: canReload ? 'reload' : 'done',
          startedAt,
          quality: q0,
          failures: quality.failures.slice(0, 80)
        });
        if (!canReload) clearResume();
        running = false;
        if (canReload) {
          await sleep(AUTH_RETRY_WAIT_MS);
          location.reload();
        }
        return {
          ok: true,
          authBlocked: true,
          reloading: canReload,
          games: games.length,
          done: doneIds.size,
          quality: q0,
          failures: quality.failures
        };
      }

      // Финальный прогон очереди ошибок
      let replay = { replayed: 0, left: 0 };
      if (!abort && quality.failures.length) {
        replay = await replayFailures(Math.max(paceMs, delayMs + 400));
      }

      const q = qualitySummary();
      const finishedOk = !abort && !authBlocked;
      if (finishedOk) {
        rememberCollect(plan, true, { games: games.length, quality: q.grade || null });
        clearResume();
      } else if (abort) {
        // Стоп пользователем / зависание: прогресс оставляем, чтобы «Продолжить».
        saveResume({
          ...resumeBase(),
          doneIds: [...doneIds],
          earnDaysDone,
          earningsDone: (resume && resume.earningsDone) || false,
          autoResume: false
        });
      }

      const label = abort
        ? 'Остановлено · можно продолжить'
        : q.grade === 'ok'
          ? 'Готово · чисто'
          : q.grade === 'partial'
            ? 'Готово · частично'
            : 'Готово · с ошибками';

      reportProgress({
        running: false,
        step: totalSteps,
        total: totalSteps,
        label,
        detail: abort
          ? `сохранено ${doneIds.size}/${games.length} игр · нажмите «Продолжить»`
          : `${plan.label} · игр ${games.length}${skipped ? ` (пропущено ${skipped})` : ''} (ok ${q.gamesOk} / partial ${q.gamesPartial} / fail ${q.gamesFail}) · req ok ${q.ok} fail ${q.fail} · retry ${q.retried} recovered ${q.recovered}${
              replay.left ? ` · осталось ${replay.left}` : ''
            }`,
        etaMs: 0,
        phase: 'done',
        finishedAt: Date.now(),
        startedAt,
        failures: quality.failures.slice(0, 80),
        canContinue: Boolean(abort && doneIds.size)
      });

      return {
        ok: true,
        aborted: abort,
        games: games.length,
        done: doneIds.size,
        totalSteps,
        range,
        plan,
        quality: q,
        replay,
        failures: quality.failures
      };
    } finally {
      running = false;
    }
  }

  chrome.runtime.sendMessage({ type: 'console-ping', payload: { href: location.href } }).catch(() => {});

  // После перезагрузки на странице кабинета: если был незавершённый сбор —
  // продолжаем автоматически, пропуская уже собранные игры.
  maybeAutoResume();
  installWakeWatch();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return false;

    if (message.type === 'auto-start') {
      const payload = message.payload || {};
      // Явный continue / resume из popup.
      if (payload.resume || payload.continueFromResume) {
        loadResume().then((state) => {
          if (payload.continueFromResume && state) {
            runPortfolio({ ...payload, resume: state, autoReload: true }).then(sendResponse);
            return;
          }
          runPortfolio(payload).then(sendResponse);
        });
        return true;
      }
      runPortfolio(payload).then(sendResponse);
      return true;
    }

    if (message.type === 'auto-stop') {
      abort = true;
      if (activeFetchAbort) {
        try {
          activeFetchAbort.abort();
        } catch (_) {
          /* ignore */
        }
      }
      reportProgress({
        running: false,
        label: 'Остановка…',
        detail: 'прогресс сохранится — можно продолжить',
        etaMs: 0,
        phase: 'stopping',
        startedAt
      });
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'auto-watchdog') {
      const recovered = recoverAfterWake('watchdog: нет прогресса');
      sendResponse({
        ok: true,
        running,
        recovering: recovered || stallRecovering,
        idleMs: lastBeatAt ? Date.now() - lastBeatAt : null
      });
      return true;
    }

    if (message.type === 'auto-status') {
      sendResponse({
        ok: true,
        running,
        href: location.href,
        gameId: currentGameId(),
        consoleOpen: true,
        quality: qualitySummary(),
        paceMs,
        csrf: Boolean(csrfToken),
        idleMs: lastBeatAt ? Date.now() - lastBeatAt : null,
        stallRecovering
      });
      return true;
    }

    return false;
  });
})();
