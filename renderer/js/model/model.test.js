import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function load(file) {
  const ctx = { Map, Number, String, Date, Math, window: {} };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), ctx);
  return ctx;
}

const days = load('./days.js');
const portfolio = load('./portfolio.js');
const compare = load('./compare-math.js');
const cache = load('./screen-cache.js');

describe('дни и свечи', () => {
  it('dayList включает оба конца', () => {
    expect(days.dayList('2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
  });
  it('candleWindow для дня — один день', () => {
    expect(days.candleWindow('day', { fromDay: '2026-11-01', toDay: '2026-11-20' }, '2026-11-20')).toEqual({
      fromDay: '2026-11-20',
      toDay: '2026-11-20'
    });
  });
  it('candleWindow длиннее 31 дня обрезает с конца', () => {
    const w = days.candleWindow('year', { fromDay: '2026-01-01', toDay: '2026-03-15' }, '2026-03-15');
    expect(days.dayList(w.fromDay, w.toDay)).toHaveLength(31);
    expect(w.toDay).toBe('2026-03-15');
  });
});

describe('доля и игроки', () => {
  const game = { period_players: 10, period_players_sum: 40, period_earn: 25 };
  it('сумма игроков, иначе среднее', () => {
    expect(portfolio.periodPlayersOf(game, 'sum')).toBe(40);
    expect(portfolio.periodPlayersOf(game, 'avg')).toBe(10);
    expect(portfolio.periodPlayersOf({ period_players: 3 }, 'sum')).toBe(3);
  });
  it('доля от дохода и от игроков', () => {
    expect(portfolio.gameShareOf(game, { shareMetric: 'earn', totalEarn: 100 })).toBe(25);
    expect(portfolio.gameShareOf(game, { shareMetric: 'players', playersMode: 'avg', totalPlayers: 40 })).toBe(25);
    expect(portfolio.gameShareOf(game, { shareMetric: 'earn', totalEarn: 0 })).toBe(null);
  });
  it('spark берёт heatmap, иначе поле игры', () => {
    const view = { heatmap: { games: [{ id: 1, spark_players: [1, 2], spark_players_prev: [0] }] } };
    expect(portfolio.sparkPairOf({ id: 1, spark_players: [9] }, view, 'players')).toEqual({
      cur: [1, 2],
      prev: [0]
    });
  });
});

describe('сравнение', () => {
  const games = [{ earn: 10 }, { earn: 30 }, { earn: 20 }];
  it('лучший индекс по max и min', () => {
    expect(compare.compareBestIndex(games, 'earn', 'max')).toBe(1);
    expect(compare.compareBestIndex(games, 'earn', 'min')).toBe(0);
  });
  it('ширина бара', () => {
    expect(compare.compareBarPct(games[1], games, 'earn', 'max')).toBe(100);
    expect(compare.compareBarPct(games[0], games, 'earn', 'max')).toBeCloseTo((10 / 30) * 100);
  });
});

describe('кэш экрана', () => {
  it('вытесняет старые ключи', () => {
    const map = new Map();
    cache.putScreenModel(map, 'a', 1, 2);
    cache.putScreenModel(map, 'b', 2, 2);
    cache.putScreenModel(map, 'c', 3, 2);
    expect([...map.keys()]).toEqual(['b', 'c']);
  });
  it('устаревшее поколение отдаёт свежий ключ', () => {
    const map = new Map([['month|prev_month|', { ok: 1 }]]);
    expect(cache.staleScreen(map, 1, 2, false, 'month|prev_month|')).toEqual({ ok: 1 });
    expect(cache.staleScreen(map, 2, 2, false, 'month|prev_month|')).toBe(null);
    expect(cache.staleScreen(map, 1, 2, true, 'month|prev_month|')).toBe(null);
  });
});
