import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const memory = new Map();
const localStorage = {
  getItem: (key) => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, String(value)),
  removeItem: (key) => memory.delete(key)
};

const ctx = {
  window: {},
  console,
  Map,
  Set,
  Date,
  Math,
  Number,
  String,
  JSON,
  Array,
  Object,
  localStorage,
  document: { addEventListener() {}, removeEventListener() {} }
};
ctx.window = ctx;
vm.createContext(ctx);

function run(rel) {
  const url = new URL('../' + rel, import.meta.url);
  vm.runInContext(readFileSync(url, 'utf8'), ctx, { filename: rel });
}

const files = [
  'model/screen-cache.js',
  'pages/workspace-series.js',
  'pages/workspace-charts.js',
  'pages/compare-view.js',
  'chart-widgets.js',
  'chart-format.js',
  'charts.js',
  'charts-line.js',
  'charts-bars.js',
  'charts-stackedBars.js',
  'charts-donut.js',
  'charts-hbars.js',
  'charts-dualRing.js',
  'charts-calendar.js',
  'charts-hourBars.js',
  'app/store.js',
  'app/lifecycle.js'
];

describe('склейка скриптов', () => {
  it('общие значения видны соседним файлам, графики собраны', () => {
    for (const file of files) run(file);
    expect(ctx.NamiData.gamesModelCache).toBeInstanceOf(Map);
    expect(ctx.NamiData.WS_SERIES.players).toBeTruthy();
    expect(ctx.NamiData.EXTRA_CHARTS).toBeTruthy();
    expect(ctx.NamiData.COMPARE_COLORS.length).toBeGreaterThan(2);
    expect(typeof ctx.window.FoundersCharts.line).toBe('function');
    expect(typeof ctx.window.FoundersCharts.hourBars).toBe('function');
    expect(typeof ctx.window.FoundersCharts.donut).toBe('function');
  });

  it('ключи fa.* пишутся только через store', () => {
    ctx.window.NamiStore.setActiveAccount('acc-1');
    expect(ctx.window.NamiStore.state.activeAccountId).toBe('acc-1');
    expect(localStorage.getItem('fa.activeAccountId')).toBe('acc-1');
    ctx.window.NamiStore.setActiveAccount('');
    expect(localStorage.getItem('fa.activeAccountId')).toBe(null);
    ctx.window.NamiStore.setCompareExpand({ audience: false });
    expect(ctx.window.NamiStore.compareExpand().audience).toBe(false);
    ctx.window.NamiStore.markWorkspaceNavSeen();
    expect(ctx.window.NamiStore.workspaceNavSeen()).toBe(true);
    ctx.window.NamiStore.state.period = 'week';
    expect(ctx.window.NamiStore.state.period).toBe('week');
    expect(localStorage.getItem('fa.period')).toBe('week');
    ctx.window.NamiStore.state.gamesQuery = 'abc';
    expect(localStorage.getItem('fa.gamesQuery')).toBe(null);
  });

  it('слушатель страницы снимается при уходе', () => {
    let clicks = 0;
    const target = {
      addEventListener(_type, fn) {
        this.fn = fn;
      },
      removeEventListener() {
        this.fn = null;
      },
      fire() {
        if (this.fn) {
          clicks += 1;
          this.fn();
        }
      }
    };
    ctx.window.NamiLifecycle.listen('compare', target, 'click', () => {});
    target.fire();
    ctx.window.NamiLifecycle.destroy('compare');
    target.fire();
    expect(clicks).toBe(1);
  });
});
