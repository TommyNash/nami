(function () {
  try {
    const isTauri = !!(window.__TAURI__ || window.__TAURI_INTERNALS__);
    const ua = navigator.userAgent || '';
    const isMac = /Mac|Macintosh|Darwin/i.test(ua) || navigator.platform === 'MacIntel';
    document.documentElement.classList.toggle('tauri-app', isTauri);
    document.documentElement.classList.toggle('tauri-macos', isTauri && isMac);
  } catch (_) {
    /* ignore */
  }

  function getInvoke() {
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
      return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
    }
    if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
      return window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
    }
    return null;
  }

  function getListen() {
    if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
      return window.__TAURI__.event.listen.bind(window.__TAURI__.event);
    }
    return null;
  }

  function subscribe(eventName, handler) {
    const listen = getListen();
    if (!listen) return () => {};
    let unlisten = null;
    listen(eventName, (event) => handler(event.payload)).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (typeof unlisten === 'function') unlisten();
    };
  }

  async function invoke(cmd, args) {
    const fn = getInvoke();
    if (!fn) {
      throw new Error('Tauri IPC недоступен. Запустите через `npm run tauri:dev`.'); // i18n-ignore
    }
    return fn(cmd, args || {});
  }

  window.foundersApi = {
    getInfo: () => invoke('get_info'),
    getOverview: () => invoke('get_overview'),
    getCollector: () => invoke('get_collector'),
    listRequests: (opts) => invoke('list_requests', { opts: opts || null }),
    listRaw: (opts) => invoke('list_raw', { opts: opts || null }),
    getRaw: (id) => invoke('get_raw', { id }),
    listAccounts: () => invoke('list_accounts'),
    listGames: (period, accountId) =>
      invoke('list_games', {
        period: period || null,
        accountId: accountId || null
      }),
    gamesScreen: (period, compareMode, accountId) =>
      invoke('games_screen', {
        period: period || 'month',
        compareMode: compareMode || 'prev_month',
        accountId: accountId || null
      }),
    gamesHeatmap: (period, compareMode, accountId) =>
      invoke('games_heatmap', {
        period: period || 'month',
        compareMode: compareMode || 'prev_month',
        accountId: accountId || null
      }),
    listHistory: (limit) => invoke('list_history', { limit: limit || null }),
    getDbStats: () => invoke('get_db_stats'),
    getFreshness: (gameId) => invoke('get_freshness', { gameId: gameId || null }),
    getDataCoverage: (period, accountId) =>
      invoke('get_data_coverage', {
        period: period || null,
        accountId: accountId || null
      }),
    clearRaw: () => invoke('clear_raw'),
    reprocess: (all) => invoke('reprocess', { all: all === true }),
    analyticsOverview: (period, accountId) =>
      invoke('analytics_overview', {
        period: period || null,
        accountId: accountId || null
      }),
    analyticsGame: (gameId, period) =>
      invoke('analytics_game', { gameId, period: period || null }),
    analyticsMetrics: (period) => invoke('analytics_metrics', { period: period || null }),
    analyticsCompare: (gameIds, period) =>
      invoke('analytics_compare', { gameIds: gameIds || null, period: period || null }),
    analyticsGeography: (gameId) =>
      invoke('analytics_geography', { gameId: gameId || null }),
    analyticsPlatforms: (gameId) =>
      invoke('analytics_platforms', { gameId: gameId || null }),
    analyticsReviews: (gameId) => invoke('analytics_reviews', { gameId: gameId || null }),
    analyticsPurchases: (gameId) =>
      invoke('analytics_purchases', { gameId: gameId || null }),
    analyticsEarnings: (gameId, period) =>
      invoke('analytics_earnings', { gameId: gameId || null, period: period || null }),
    listEarnMonths: (accountId) =>
      invoke('list_earn_months', { accountId: accountId || null }),
    upsertManualEarnMonth: (accountId, monthKey, earn, note) =>
      invoke('upsert_manual_earn_month', {
        accountId: accountId || null,
        monthKey,
        earn: Number(earn) || 0,
        note: note || null
      }),
    deleteManualEarnMonth: (accountId, monthKey) =>
      invoke('delete_manual_earn_month', {
        accountId: accountId || null,
        monthKey
      }),
    taxSheet: (accountId) => invoke('tax_sheet', { accountId: accountId || null }),
    setTaxSettings: (rate, shift) =>
      invoke('set_tax_settings', {
        rate: rate == null ? null : Number(rate),
        shift: shift == null ? null : Number(shift)
      }),
    listEarnDaily: (period) => invoke('list_earn_daily', { period: period || 'month' }),
    exportGame: (gameId, period) =>
      invoke('export_game', { gameId, period: period || null }),
    saveReport: (filename, dataBase64) =>
      invoke('save_report', { filename, dataBase64 }),
    openExtensionFolder: () => invoke('open_extension_folder'),
    packExtension: () => invoke('pack_extension'),
    openExtensionInstall: () => invoke('open_extension_install'),
    openUrl: async (url) => {
      const href = String(url || '').trim();
      if (!href) return;
      const shell = window.__TAURI__ && window.__TAURI__.shell;
      if (shell && typeof shell.open === 'function') {
        await shell.open(href);
        return;
      }
      // fallback: plugin command name in Tauri 2
      try {
        await invoke('plugin:shell|open', { path: href });
        return;
      } catch (_) {
        /* browser / no ACL */
      }
      window.open(href, '_blank', 'noopener,noreferrer');
    },
    getDemoState: () => invoke('get_demo_state'),
    setDemoMode: (enabled) => invoke('set_demo_mode', { enabled: !!enabled }),
    resetDemoData: () => invoke('reset_demo_data'),
    exportBackup: (prefs) => invoke('export_backup', { prefs: prefs || null }),
    pickBackup: () => invoke('pick_backup'),
    importBackup: (apply) => invoke('import_backup', { apply: !!apply }),
    onIngestEvent: (handler) => subscribe('ingest-event', handler),
    onCollectProgress: (handler) => subscribe('collect-progress', handler)
  };
})();
