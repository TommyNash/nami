// @ts-check
const NamiStore = (() => {
  const read = (key, fallback) => {
    try {
      const v = localStorage.getItem(key);
      return v == null || v === '' ? fallback : v;
    } catch (_) {
      return fallback;
    }
  };
  let compareIds = [];
  try {
    const raw = localStorage.getItem('fa.compareIds');
    const arr = raw ? JSON.parse(raw) : [];
    compareIds = Array.isArray(arr) ? arr.map(String) : [];
  } catch (_) {
    compareIds = [];
  }

  const state = {
    page: read('fa.page', 'games'),
    workspaceTab: read('fa.workspaceTab', 'overview'),
    period: read('fa.period', 'month'),
    info: null,
    overview: null,
    collector: null,
    games: [],
    selectedGameId: read('fa.selectedGameId', null),
    compareIds,
    freshness: { lastUpdatedAt: null, gameUpdatedAt: null },
    coverage: null,
    audienceTab: read('fa.audienceTab', 'reviews'),
    metricsSection: read('fa.metricsSection', 'product'),
    gamesQuery: '',
    gamesPublishedOnly: read('fa.publishedOnly', '') === '1',
    workspaceLayer: read('fa.workspaceLayer', 'players'),
    heatMetric: read('fa.heatMetric', 'players'),
    heatCompare: read('fa.heatCompare', 'prev_month'),
    gamesPlayersMode: read('fa.gamesPlayersMode', '') === 'sum' ? 'sum' : 'avg',
    gamesShareMetric: read('fa.gamesShareMetric', '') === 'earn' ? 'earn' : 'players',
    gamesDynamicsMetric: read('fa.gamesDynamicsMetric', '') === 'earn' ? 'earn' : 'players',
    activeAccountId: read('fa.activeAccountId', ''),
    statusOpen: false,
    animateNumbers: false,
    animateHeatmap: false,
    freezeHeatmap: false,
    collect: { active: false, blocking: false, lastAt: 0 }
  };

  const WORKSPACE_TABS = new Set(['overview', 'metrics', 'earnings', 'purchases', 'audience']);
  const HEAT = new Set(['prev_period', 'prev_month', 'd7', 'd14', 'd30']);
  const LAYERS = new Set([
    'summary', 'players', 'playtime', 'ready', 'rating', 'revenue',
    'audience', 'conversion', 'metrics', 'purchases', 'earnings'
  ]);

  function save(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {}
  }

  function readJson(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : null;
    } catch (_) {
      return null;
    }
  }

  function saveJson(key, value) {
    save(key, JSON.stringify(value || {}));
  }

  if (['game', 'metrics', 'earnings', 'purchases', 'audience', 'reviews', 'geography', 'platforms'].includes(state.page)) {
    if (state.page !== 'game') {
      const map = { game: 'overview', reviews: 'audience', geography: 'audience', platforms: 'audience' };
      state.workspaceTab = map[state.page] || state.page;
      save('fa.workspaceTab', state.workspaceTab);
    }
    state.page = 'workspace';
    save('fa.page', 'workspace');
  }
  if (state.page === 'collector') {
    state.page = 'settings';
    save('fa.page', 'settings');
  }
  if (state.page === 'overview' || state.page === 'portfolio') {
    state.page = 'games';
    save('fa.page', 'games');
  }

  const api = {
    state,
    setPage(page) {
      state.page = page;
      save('fa.page', page);
    },
    setPeriod(period) {
      if (!period || period === state.period) return false;
      state.period = period;
      save('fa.period', period);
      return true;
    },
    setWorkspaceTab(tab) {
      state.workspaceTab = WORKSPACE_TABS.has(tab) ? tab : 'overview';
      save('fa.workspaceTab', state.workspaceTab);
      return state.workspaceTab;
    },
    setSelectedGame(id) {
      state.selectedGameId = id ? String(id) : null;
      if (state.selectedGameId) save('fa.selectedGameId', state.selectedGameId);
    },
    setCompareIds(ids) {
      const next = [...new Set((ids || []).map(String))];
      state.compareIds = next;
      save('fa.compareIds', JSON.stringify(next));
      return next;
    },
    setAudienceTab(tab) {
      state.audienceTab = tab;
      save('fa.audienceTab', tab);
    },
    setPublishedOnly(on) {
      state.gamesPublishedOnly = !!on;
      save('fa.publishedOnly', state.gamesPublishedOnly ? '1' : '0');
    },
    setHeatMetric(metric) {
      state.heatMetric = metric === 'earn' ? 'earn' : 'players';
      save('fa.heatMetric', state.heatMetric);
    },
    setHeatCompare(mode) {
      state.heatCompare = HEAT.has(mode) ? mode : 'prev_month';
      save('fa.heatCompare', state.heatCompare);
    },
    setGamesPlayersMode(mode) {
      state.gamesPlayersMode = mode === 'sum' ? 'sum' : 'avg';
      save('fa.gamesPlayersMode', state.gamesPlayersMode);
    },
    setGamesShareMetric(metric) {
      state.gamesShareMetric = metric === 'earn' ? 'earn' : 'players';
      save('fa.gamesShareMetric', state.gamesShareMetric);
    },
    setGamesDynamicsMetric(metric) {
      state.gamesDynamicsMetric = metric === 'earn' ? 'earn' : 'players';
      save('fa.gamesDynamicsMetric', state.gamesDynamicsMetric);
    },
    setWorkspaceLayer(layer) {
      let id = LAYERS.has(String(layer)) ? String(layer) : 'summary';
      if (id === 'earnings') id = 'revenue';
      if (id === 'metrics') id = 'conversion';
      state.workspaceLayer = id;
      save('fa.workspaceLayer', id);
      return id;
    },
    setMetricsSection(section) {
      state.metricsSection = section;
      save('fa.metricsSection', section);
    },
    workspaceNavSeen() {
      return read('fa.workspaceNavV2', '') === '1';
    },
    markWorkspaceNavSeen() {
      save('fa.workspaceNavV2', '1');
    },
    compareExpand() {
      const obj = readJson('fa.compareExpand');
      return obj || { audience: true };
    },
    setCompareExpand(map) {
      saveJson('fa.compareExpand', map || {});
    },
    compareChartMetric() {
      return readJson('fa.compareChartMetric') || {};
    },
    setCompareChartMetric(map) {
      saveJson('fa.compareChartMetric', map || {});
    },
    setActiveAccount(id) {
      state.activeAccountId = id ? String(id) : '';
      if (state.activeAccountId) save('fa.activeAccountId', state.activeAccountId);
      else {
        try {
          localStorage.removeItem('fa.activeAccountId');
        } catch (_) {}
      }
    }
  };
  const persist = {
    page: (value) => api.setPage(value),
    period: (value) => api.setPeriod(value),
    workspaceTab: (value) => api.setWorkspaceTab(value),
    selectedGameId: (value) => api.setSelectedGame(value),
    compareIds: (value) => api.setCompareIds(Array.isArray(value) ? value : []),
    audienceTab: (value) => api.setAudienceTab(value),
    metricsSection: (value) => api.setMetricsSection(value),
    gamesPublishedOnly: (value) => api.setPublishedOnly(value),
    workspaceLayer: (value) => api.setWorkspaceLayer(value),
    heatMetric: (value) => api.setHeatMetric(value),
    heatCompare: (value) => api.setHeatCompare(value),
    gamesPlayersMode: (value) => api.setGamesPlayersMode(value),
    gamesShareMetric: (value) => api.setGamesShareMetric(value),
    gamesDynamicsMetric: (value) => api.setGamesDynamicsMetric(value),
    activeAccountId: (value) => api.setActiveAccount(value)
  };
  api.state = new Proxy(state, {
    set(target, key, value) {
      const write = persist[key];
      if (write) {
        write(value);
        return true;
      }
      target[key] = value;
      return true;
    }
  });
  return api;
})();
window.NamiStore = NamiStore;
