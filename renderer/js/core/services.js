// @ts-check
const api = () => window.foundersApi;

window.NamiServices = {
  app: {
    info: () => api().getInfo(),
    overview: () => api().getOverview(),
    collector: () => api().getCollector(),
    freshness: (gameId) => api().getFreshness(gameId),
    stats: () => api().getDbStats(),
    reprocess: (all) => api().reprocess(all),
    clearRaw: () => api().clearRaw(),
    listRaw: (opts) => api().listRaw(opts),
    openUrl: (url) => api().openUrl(url),
    onIngest: (fn) => api().onIngestEvent(fn),
    onCollect: (fn) => api().onCollectProgress(fn)
  },
  portfolio: {
    screen: (period, compare, accountId) => api().gamesScreen(period, compare, accountId),
    heatmap: (period, compare, accountId) => api().gamesHeatmap(period, compare, accountId),
    list: (period, accountId) => api().listGames(period, accountId),
    overview: (period, accountId) => api().analyticsOverview(period, accountId),
    accounts: () => api().listAccounts(),
    earnMonths: (accountId) => api().listEarnMonths(accountId)
  },
  game: {
    details: (id, period) => api().analyticsGame(id, period),
    reviews: (id) => api().analyticsReviews(id),
    geography: (id) => api().analyticsGeography(id),
    platforms: (id) => api().analyticsPlatforms(id),
    purchases: (id) => api().analyticsPurchases(id),
    compare: (ids, period) => api().analyticsCompare(ids, period)
  },
  tax: {
    sheet: (accountId) => api().taxSheet(accountId),
    setSettings: (rate, shift) => api().setTaxSettings(rate, shift),
    upsertMonth: (accountId, month, earn, note) => api().upsertManualEarnMonth(accountId, month, earn, note),
    deleteMonth: (accountId, month) => api().deleteManualEarnMonth(accountId, month)
  },
  settings: {
    packExtension: () => api().packExtension(),
    openExtensionFolder: () => api().openExtensionFolder(),
    openExtensionInstall: () => api().openExtensionInstall(),
    demoGet: () => api().getDemoState(),
    demoSet: (on) => api().setDemoMode(on),
    demoReset: () => api().resetDemoData(),
    saveReport: (name, data) => api().saveReport(name, data),
    exportBackup: (prefs) => api().exportBackup(prefs),
    pickBackup: () => api().pickBackup(),
    importBackup: (apply) => api().importBackup(apply)
  }
};
