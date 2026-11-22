// @ts-check
/**
 * Контракт IPC. Реализация — tauri-bridge.js, вызов из UI — только NamiServices.
 *
 * @typedef {Object} IpcContract
 * @property {() => Promise<Object>} get_info
 * @property {(period: string, compareMode: string, accountId: string|null) => Promise<Object>} games_screen
 * @property {(period: string, compareMode: string, accountId: string|null) => Promise<Object>} games_heatmap
 * @property {(period: string|null, accountId: string|null) => Promise<Array>} list_games
 * @property {(gameId: string, period: string|null) => Promise<Object>} analytics_game
 * @property {(gameIds: string[]|null, period: string|null) => Promise<Object>} analytics_compare
 * @property {(accountId: string|null) => Promise<Object>} tax_sheet
 * @property {() => Promise<Object>} pack_extension
 * @property {(filename: string, dataBase64: string) => Promise<Object>} save_report
 * @property {(prefs: Object|null) => Promise<Object>} export_backup
 * @property {(apply: boolean) => Promise<Object>} import_backup
 */
void 0;
