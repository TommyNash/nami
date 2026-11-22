(() => {
  const titles = {
    games: T('app.titles.games'),
    workspace: T('app.titles.game'),
    compare: T('app.titles.compare'),
    tax: T('app.titles.tax'),
    collector: T('app.titles.collector'),
    settings: T('app.titles.settings'),
    game: T('app.titles.game'),
    metrics: T('app.titles.game'),
    earnings: T('app.titles.game'),
    purchases: T('app.titles.game'),
    audience: T('app.titles.game')
  };

  const state = window.NamiStore.state;

  function selectedGame() {
    return state.games.find((g) => String(g.id) === String(state.selectedGameId)) || null;
  }

  function formatClock(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleTimeString(window.NamiI18n.locale, { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '—';
    }
  }

  function formatUpdatedFull(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleString(window.NamiI18n.locale);
    } catch {
      return '—';
    }
  }

  function isCollectorOnline(collector) {
    const at = collector && collector.lastExtensionConnection;
    if (!at) return false;
    return Date.now() - Number(at) < 5 * 60 * 1000;
  }

  // Сбор считаем активным, пока события приходят: пауза больше 6 с — значит,
  // коллектор закончил (раньше флаг висел 22 с и индикатор «врал»).
  function refreshCollectFlag() {
    if (!state.collect.active) return;
    if (Date.now() - (state.collect.lastAt || 0) > 6000) {
      state.collect.active = false;
    }
  }

  function dataStatusMode() {
    refreshCollectFlag();
    if (state.collect.blocking || state.collect.active) return 'collecting';
    if (isCollectorOnline(state.collector)) return 'ok';
    const hasData = Number(state.freshness && state.freshness.lastUpdatedAt) > 0 || (state.games || []).length > 0;
    return hasData ? 'offline' : 'empty';
  }

  /** День, по который в базе есть статистика (не время последней проверки связи). */
  function dataThroughDay() {
    const cov = state.coverage || {};
    const ov = state.overview || {};
    return (
      cov.earnStatsThrough ||
      cov.fullMetricsDay ||
      cov.latestMetricsDay ||
      ov.playersDay ||
      null
    );
  }

  function formatDayShort(day) {
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return '';
    const [, m, d] = String(day).split('-');
    return `${d}.${m}`;
  }

  function formatDayHuman(day) {
    if (!day) return '—';
    try {
      if (window.FoundersFormat && window.FoundersFormat.date) {
        return window.FoundersFormat.date(day);
      }
    } catch (_) {
      /* ignore */
    }
    return formatDayShort(day) || String(day);
  }

  function renderDataStatus() {
    const host = document.getElementById('dataStatus');
    if (!host) return;
    const mode = dataStatusMode();
    const updatedTs =
      state.page === 'workspace' && state.selectedGameId
        ? state.freshness.gameUpdatedAt || state.freshness.lastUpdatedAt
        : state.freshness.lastUpdatedAt;
    const online = isCollectorOnline(state.collector);
    const through = dataThroughDay();
    const lag =
      Number(
        (state.coverage &&
          (state.coverage.earnLagDays != null
            ? state.coverage.earnLagDays
            : state.coverage.latestMetricsLagDays)) ||
          (state.overview && state.overview.playersDayLag) ||
          0
      ) || 0;

    const statusLabel =
      mode === 'collecting'
        ? T('app.status.collecting')
        : mode === 'empty'
          ? T('app.status.empty')
          : mode === 'ok'
            ? T('app.status.online')
            : T('app.status.offline');
    const pillInner = `<i class="ph ph-database" aria-hidden="true"></i>`;

    const open = state.statusOpen ? 'is-open' : '';
    const lagLine =
      through && lag > 0
        ? `<div class="status-pop-row"><span>${T('app.status.lag')}</span><b>${T('app.status.lagDays', {
            n: lag,
            count: lag
          })}</b></div>`
        : '';
    host.innerHTML = `
      <div class="data-status ${open}" data-mode="${mode}" data-tauri-drag-region="false">
        <button type="button" class="status-pill" id="statusPill" aria-expanded="${
          state.statusOpen ? 'true' : 'false'
        }" aria-label="${escapeHtml(statusLabel)}">
          ${pillInner}
        </button>
        <div class="status-pop" id="statusPop" role="dialog">
          <div class="status-pop-row"><span>${T('app.status.dataFor')}</span><b>${escapeHtml(
            formatDayHuman(through)
          )}</b></div>
          ${lagLine}
          <div class="status-pop-row"><span>${T('app.status.checked')}</span><b>${escapeHtml(
            formatUpdatedFull(updatedTs)
          )}</b></div>
          <div class="status-pop-row"><span>${T('app.status.console')}</span><b class="${online ? 'ok' : 'bad'}">${
            online ? T('app.status.consoleOnline') : T('app.status.consoleOffline')
          }</b></div>
          <button type="button" class="btn primary status-pop-cta" id="statusRefreshNow">
            <i class="ph ph-arrows-clockwise" aria-hidden="true"></i>
            ${T('app.status.refreshNow')}
          </button>
        </div>
      </div>
    `;

    const root = host.querySelector('.data-status');
    const pill = document.getElementById('statusPill');
    const refreshNow = document.getElementById('statusRefreshNow');
    if (root) {
      root.onmouseenter = () => {
        clearTimeout(root._statusClose);
        state.statusOpen = true;
        root.classList.add('is-open');
        if (pill) pill.setAttribute('aria-expanded', 'true');
      };
      root.onmouseleave = () => {
        clearTimeout(root._statusClose);
        root._statusClose = setTimeout(() => {
          state.statusOpen = false;
          root.classList.remove('is-open');
          if (pill) pill.setAttribute('aria-expanded', 'false');
        }, 160);
      };
    }
    if (pill) {
      pill.onclick = (e) => {
        e.stopPropagation();
        state.statusOpen = !state.statusOpen;
        if (root) root.classList.toggle('is-open', state.statusOpen);
        pill.setAttribute('aria-expanded', state.statusOpen ? 'true' : 'false');
      };
    }
    if (refreshNow) {
      refreshNow.onclick = async (e) => {
        e.stopPropagation();
        state.statusOpen = false;
        try {
          await window.NamiServices.app.reprocess();
        } catch (_) {
          /* ignore */
        }
        await refresh();
      };
    }
  }

  /* —— Индикаторы сбора без перерисовки страницы ——
     renderDataStatus пересобирает innerHTML виджета, поэтому при потоке
     событий вызываем его не чаще 4 раз в секунду. */
  let statusTimer = 0;
  let statusLastAt = 0;
  function queueDataStatus() {
    if (statusTimer) return;
    const wait = Math.max(0, 250 - (Date.now() - statusLastAt));
    statusTimer = setTimeout(() => {
      statusTimer = 0;
      statusLastAt = Date.now();
      renderDataStatus();
    }, wait);
  }

  /* —— Обновление данных во время сбора ——
     Один проход не чаще раза в 2.5 с, без скелетона и без пересборки карты,
     чтобы интерфейс не дёргался. */
  const INGEST_REFRESH_MS = 2500;
  const INGEST_IDLE_MS = 5000;
  let ingestTimer = null;
  let ingestIdleTimer = null;
  let ingestRunning = false;
  let ingestPending = false;
  let ingestPendingFinal = false;

  function scheduleIngestRefresh() {
    // Пока поверх приложения оверлей сбора, данные не трогаем: один проход в конце.
    if (state.collect.blocking) return;
    // Завершение сбора: последний «тихий» проход, чтобы добить хвост данных.
    clearTimeout(ingestIdleTimer);
    ingestIdleTimer = setTimeout(() => {
      ingestIdleTimer = null;
      if (state.collect.active) {
        state.collect.active = false;
        renderDataStatus();
        flushIngestRefresh({ final: true });
      }
    }, INGEST_IDLE_MS);

    if (ingestTimer) return;
    ingestTimer = setTimeout(() => {
      ingestTimer = null;
      flushIngestRefresh();
    }, INGEST_REFRESH_MS);
  }

  async function flushIngestRefresh({ final = false } = {}) {
    if (ingestRunning) {
      ingestPending = true;
      if (final) ingestPendingFinal = true;
      return;
    }
    ingestRunning = true;
    try {
      await loadData({ force: true, resetMonths: final });
      // Скелетон не рисуем, анимации не перезапускаем и шапку не трогаем:
      // только точечный патч контента. Карту и шапку пересобираем лишь
      // в финальном проходе, когда сбор закончился.
      await render({ animate: false, freezeHeatmap: !final, chrome: final });
    } catch (_) {
      /* ignore */
    } finally {
      ingestRunning = false;
      if (ingestPending) {
        const nextFinal = ingestPendingFinal;
        ingestPending = false;
        ingestPendingFinal = false;
        if (nextFinal) flushIngestRefresh({ final: true });
        else scheduleIngestRefresh();
      }
    }
  }

  function periodLabel(period) {
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
        day: T('app.period.day'),
        week: T('app.period.week'),
        month: T('app.period.month'),
        quarter: T('app.period.quarter'),
        year: T('app.period.year'),
        all: T('app.period.all')
      }[period] || period
    );
  }

  if (
    !['day', 'week', 'month', 'quarter', 'year', 'all'].includes(state.period) &&
    !/^m:\d{4}-\d{2}$/.test(String(state.period || '')) &&
    !/^r:\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(String(state.period || ''))
  ) {
    state.period = 'month';
  }

  // «Квартал» убрали из переключателя — старое сохранённое значение переносим на «Год»
  if (state.period === 'quarter') {
    window.NamiStore.setPeriod('year');
  }

  function periodAppliesToTab(tab) {
    return tab === 'metrics' || tab === 'earnings' || tab === 'overview' || tab === 'audience';
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 6) return T('app.greeting.night');
    if (h < 12) return T('app.greeting.morning');
    if (h < 18) return T('app.greeting.day');
    return T('app.greeting.evening');
  }

  async function loadData({ force = false, resetMonths = force } = {}) {
    // Кэш месяцев сбрасываем только при явном обновлении данных,
    // а не на каждом опросе и не на каждом событии сбора — иначе лишние IPC.
    if (resetMonths) invalidateMonths();
    const heatCompare = state.heatCompare || 'prev_month';

    const [info, overview, collector, freshness] = await Promise.all([
      window.NamiServices.app.info(),
      window.NamiServices.app.overview(),
      window.NamiServices.app.collector(),
      window.NamiServices.app.freshness(state.selectedGameId || null)
    ]);

    // Игры/месяцы/аналитика/карта — из общего кэша модели:
    // ровно один запрос на пару (период + сравнение), даже если рендер идёт параллельно.
    let model = null;
    try {
      model = await window.FoundersPages.model(state.period, heatCompare, { force });
    } catch (_) {
      model = null;
    }

    state.info = info;
    state.overview = overview;
    state.collector = collector;
    state.freshness = freshness || {};
    if (model) {
      state.games = model.games || [];
      state.gamesPeriod = state.period;
      state.coverage = model.coverage || null;
      // Периодный overview точнее для «данные за день», чем общий getOverview.
      if (model.overview) state.overview = { ...(state.overview || {}), ...model.overview };
    }

    renderDataStatus();
  }

  function invalidateMonths() {
    window.__faEarnMonths = null;
    window.__faEarnMonthsAccount = null;
  }

  function syncNav() {
    const navPage = state.page === 'workspace' ? 'games' : state.page;
    document.querySelectorAll('#nav button[data-page]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.page === navPage);
    });
    const dock = document.getElementById('nav');
    if (dock && window.FoundersMotion && window.FoundersMotion.sync) {
      window.FoundersMotion.sync(dock);
    }
  }

  function mountPeriod() {
    const mount = document.getElementById('periodMount');
    if (!mount || !window.FoundersPages || !window.FoundersPages.periodControls) {
      if (mount) mount.innerHTML = '';
      return;
    }
    // На настройках и налоге период в шапке не нужен.
    if (state.page === 'settings' || state.page === 'tax') {
      mount.innerHTML = '';
      const pop = document.getElementById('periodPop');
      if (pop) pop.hidden = true;
      if (state.page === 'settings') clearChromeActions();
      return;
    }
    clearChromeActions();
    window.FoundersPages.periodControls(mount, state.period);
  }

  function clearChromeActions() {
    const el = document.getElementById('chromeActions');
    if (!el) return;
    el.innerHTML = '';
    el.setAttribute('aria-hidden', 'true');
  }

  function updateChromeBack() {
    const mount = document.getElementById('chromeBack');
    if (!mount) return;
    const inWorkspace = state.page === 'workspace' && state.selectedGameId;
    const inTax = state.page === 'tax';
    // Слот слева всегда в DOM (без display:none), иначе период уезжает к светофору.
    if (!inWorkspace && !inTax) {
      mount.innerHTML = '';
      mount.setAttribute('aria-hidden', 'true');
      return;
    }
    const icon =
      window.FoundersIcons && window.FoundersIcons.svg
        ? window.FoundersIcons.svg('arrow-left', 14)
        : '←';
    mount.removeAttribute('aria-hidden');
    mount.innerHTML = `<button type="button" class="capsule-btn" id="chromeBackBtn">${icon}<span>${T('app.back')}</span></button>`;
    const btn = document.getElementById('chromeBackBtn');
    if (btn) {
      btn.onclick = () => {
        window.NamiStore.setPage('games');
        render({ skeleton: true });
      };
    }
  }

  function updateChrome() {
    updateChromeBack();
    syncNav();
    mountPeriod();
    document.body.classList.toggle('is-demo-mode', !!(state.info && state.info.demoMode));
    renderDataStatus();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  let renderToken = 0;
  let renderedPageKey = null;

  function prefersReducedMotion() {
    try {
      return !!(
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      );
    } catch (_) {
      return false;
    }
  }

  function canViewTransition() {
    return typeof document.startViewTransition === 'function' && !prefersReducedMotion();
  }

  async function render(opts = {}) {
    const token = ++renderToken;
    // Числа анимируем только при осознанной смене данных (вход в раздел, смена периода),
    // а не на каждом фоновом обновлении.
    state.animateNumbers = opts.animate !== undefined ? !!opts.animate : !!opts.skeleton;
    // Тепловая карта «прорисовывается» только при входе в раздел,
    // при обновлении данных плитки появляются сразу — без мигания.
    state.animateHeatmap = !!opts.skeleton;
    // Во время сбора карту не пересобираем: иконки перезагружались и плитки мигали.
    state.freezeHeatmap = !!opts.freezeHeatmap;
    // При тихих обновлениях шапку не пересобираем: пересоздание сегмента периода
    // сбрасывало «перетекающую» капсулу и вызывало лишний IPC за месяцами.
    if (opts.chrome !== false) updateChrome();
    const root = document.getElementById('pageRoot');

    if (state.page === 'workspace' && !state.selectedGameId) {
      window.NamiStore.setPage('games');
    }

    const pageKey = state.page === 'workspace' ? 'workspace' : state.page;
    const pageChanged = renderedPageKey != null && renderedPageKey !== pageKey;
    if (pageChanged) window.NamiLifecycle.destroy(renderedPageKey);
    const page = window.FoundersPages[pageKey];
    if (!page) {
      root.replaceChildren(namiEmpty(T('app.sectionWip')));
      renderedPageKey = pageKey;
      return;
    }

    const paint = async () => {
      const useSkeleton = !!opts.skeleton;
      const skeleton = useSkeleton ? pageSkeletonHtml(pageKey) : '';
      if (skeleton) {
        // Не перерисовываем уже показанный скелетон: иначе shimmer начинается заново
        if (root.dataset.skPage !== pageKey) {
          root.innerHTML = skeleton;
          root.dataset.skPage = pageKey;
        }
      } else if (!root.children.length) {
        root.replaceChildren(namiEmpty(T('app.loading')));
      }
      try {
        await page(root, state);
        if (token !== renderToken) return;
        delete root.dataset.skPage;
        // Дальнейшие обновления внутри того же раздела (фильтры, поиск, сортировка)
        // не должны заново проигрывать анимации появления.
        state.animateHeatmap = false;
        state.animateNumbers = false;
        state.freezeHeatmap = false;
      } catch (err) {
        if (token !== renderToken) return;
        delete root.dataset.skPage;
        root.replaceChildren(namiEmpty(T('app.error', { message: String(err && err.message ? err.message : err) })));
      }
    };

    // Кроссфейд только при смене раздела. Фильтры и период остаются на месте.
    if (pageChanged && opts.transition !== false && canViewTransition()) {
      try {
        const vt = document.startViewTransition(() => paint());
        await vt.finished;
      } catch (_) {
        if (token === renderToken) await paint();
      }
    } else {
      await paint();
    }
    if (token === renderToken) {
      renderedPageKey = pageKey;
      window.NamiLifecycle.enter(pageKey);
    }
  }

  function pageSkeletonHtml(pageKey) {
    try {
      const fn = window.FoundersPages && window.FoundersPages.skeleton;
      return (fn && fn(pageKey)) || '';
    } catch (_) {
      return '';
    }
  }

  // Счётчик вложенных загрузок: класс снимается только когда завершилась последняя.
  let loadingDepth = 0;

  function setPageLoading(on) {
    const root = document.getElementById('pageRoot');
    if (!root) return;
    loadingDepth = Math.max(0, loadingDepth + (on ? 1 : -1));
    root.classList.toggle('is-loading', loadingDepth > 0);
  }

  async function refresh(opts = {}) {
    // Явное обновление (кнопка «Обновить», событие сбора) всегда тянет свежие данные.
    await loadData({ force: opts.force !== false });
    await render(opts);
  }

  function openGame(gameId, tab = 'overview') {
    window.NamiStore.setSelectedGame(gameId);
    window.NamiStore.setWorkspaceTab(tab);
    window.NamiStore.setPage('workspace');
    render({ skeleton: true }).catch(() => {});
    loadData().catch(() => {});
  }

  function openTax() {
    window.NamiStore.setPage('tax');
    render({ skeleton: true }).catch(() => {});
  }

  function setWorkspaceTab(tab) {
    window.NamiStore.setWorkspaceTab(tab);
    render({ skeleton: true });
  }

  function afterPaint(fn) {
    // Два кадра: первый двигает капсулу, второй успевает её нарисовать
    // до тяжёлой перерисовки данных.
    requestAnimationFrame(() => {
      requestAnimationFrame(fn);
    });
  }

  function setPeriod(period) {
    if (!window.NamiStore.setPeriod(period)) return;

    // Капсула периода едет сразу. Данные подтягиваем после кадра,
    // иначе перерисовка блокирует поток и анимация стартует только потом.
    // Уже посчитанный период не затемняем: скелетон поверх карты выглядел как лаг.
    updateChrome();
    const cached =
      window.FoundersPages &&
      window.FoundersPages.peekModel &&
      window.FoundersPages.peekModel(period, state.heatCompare || 'prev_month');
    if (!cached) setPageLoading(true);
    afterPaint(() => {
      render({ animate: true, chrome: false })
        .catch(() => {})
        .finally(() => setPageLoading(false));
    });
  }

  function setPeriodQuiet(period) {
    if (!window.NamiStore.setPeriod(period)) return;
    updateChrome();
  }

  document.getElementById('nav').addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-page]');
    if (!btn) return;
    if (btn.dataset.page === state.page) return;
    window.NamiStore.setPage(btn.dataset.page);
    const heatCompare = state.heatCompare || 'prev_month';
    const cached =
      state.page === 'games' &&
      window.FoundersPages &&
      window.FoundersPages.peekModel &&
      window.FoundersPages.peekModel(state.period, heatCompare);
    // Скелетон только когда данных экрана ещё нет. Повторный заход в «Игры»
    // рисует кэш сразу, без второго полного монтажа DOM.
    await render({ skeleton: !cached });
  });

  const sponsorLink = document.getElementById('dockSponsorLink');
  if (sponsorLink) {
    sponsorLink.addEventListener('click', (event) => {
      event.preventDefault();
      const url =
        sponsorLink.getAttribute('data-external-url') ||
        sponsorLink.getAttribute('href') ||
        'https://kit.founders-universe.com/';
      window.NamiServices.app.openUrl(url).catch(() => {
        window.open(url, '_blank', 'noopener,noreferrer');
      });
    });
  }

  window.NamiServices.app.onIngest(() => {
    // Сбор идёт пачками: событий может быть несколько в секунду. Полный
    // refresh() на каждое событие перерисовывал страницу и «моргал»,
    // поэтому здесь только отметка активности и отложенное обновление данных.
    // Счётчики не ведём: в интерфейсе один индикатор — «Идёт сбор».
    state.collect.active = true;
    state.collect.lastAt = Date.now();
    queueDataStatus();
    scheduleIngestRefresh();
  });

  window.FoundersCollect.configure({
    onStart: () => {
      state.collect.blocking = true;
      clearTimeout(ingestTimer);
      ingestTimer = null;
      clearTimeout(ingestIdleTimer);
      ingestIdleTimer = null;
      renderDataStatus();
    },
    onEnd: () => {
      state.collect.blocking = false;
      state.collect.active = false;
      renderDataStatus();
      flushIngestRefresh({ final: true });
    }
  });
  window.NamiServices.app.onCollect((progress) => window.FoundersCollect.update(progress));

  document.addEventListener('click', (e) => {
    if (state.statusOpen) {
      if (!e.target.closest('#dataStatus')) {
        state.statusOpen = false;
        renderDataStatus();
      }
    }
    const pop = document.getElementById('periodPop');
    if (pop && !pop.hidden) {
      // Кнопки внутри попапа перерисовывают его и отцепляются от DOM
      // до всплытия клика — closest по target тогда пустой. Смотрим путь события.
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const inside = path.some(
        (node) =>
          node === pop ||
          (node instanceof Element &&
            (node.id === 'periodPop' || node.matches('[data-period-menu]')))
      );
      const target = e.target instanceof Element ? e.target : null;
      const viaTarget =
        !!(target && (target.closest('#periodPop') || target.closest('[data-period-menu]')));
      if (!inside && !viaTarget) {
        if (window.FoundersPages && window.FoundersPages.closePeriodPop) {
          window.FoundersPages.closePeriodPop();
        } else {
          pop.hidden = true;
        }
      }
    }
  });

  window.addEventListener('resize', () => {
    const pop = document.getElementById('periodPop');
    const anchor = document.querySelector('[data-period-menu][aria-expanded="true"]');
    if (pop && !pop.hidden && anchor && window.FoundersPages && window.FoundersPages.placePeriodPop) {
      window.FoundersPages.placePeriodPop(anchor);
    }
  });

  function runSplash(done) {
    const splash = document.getElementById('splash');
    sessionStorage.removeItem('nami.skipSplash');
    if (!splash || getComputedStyle(splash).display === 'none') {
      if (splash) splash.remove();
      done();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      splash.remove();
      done();
    };
    splash.addEventListener('animationend', (event) => {
      if (event.animationName === 'splash-out') finish();
    });
    setTimeout(finish, 2500);
  }

  window.FoundersApp = {
    refresh,
    render,
    state,
    openGame,
    openTax,
    selectedGame,
    periodLabel,
    periodAppliesToTab,
    greeting,
    setWorkspaceTab,
    setPeriod,
    setPeriodQuiet,
    loading: setPageLoading,
    setAudienceTab(tab) {
      window.NamiStore.setAudienceTab(tab);
    },
    setPublishedOnly(on) {
      window.NamiStore.setPublishedOnly(on);
    },
    setHeatMetric(metric) {
      window.NamiStore.setHeatMetric(metric);
    },
    setGamesPlayersMode(mode) {
      window.NamiStore.setGamesPlayersMode(mode);
    },
    setGamesShareMetric(metric) {
      window.NamiStore.setGamesShareMetric(metric);
    },
    setGamesDynamicsMetric(metric) {
      window.NamiStore.setGamesDynamicsMetric(metric);
    },
    setHeatCompare(mode) {
      window.NamiStore.setHeatCompare(mode);
    },
    setWorkspaceLayer(layer) {
      window.NamiStore.setWorkspaceLayer(layer);
    }
  };
  // Скелетон сразу, данные — параллельно
  render({ skeleton: true }).catch(() => {});
  loadData({ force: true }).catch(() => {});
  runSplash(() => window.NamiOnboarding.maybeOpen());
  // Фоновый опрос — только данные без перерисовки страницы. force:false,
  // чтобы не сбрасывать кэш модели (иначе каждый тик — пять IPC и лишние
  // пересборки карты/таблицы при следующем рендере).
  setInterval(
    () =>
      loadData({ force: false })
        .then(() => queueDataStatus())
        .catch(() => {}),
    8000
  );
})();
