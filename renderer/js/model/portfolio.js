// @ts-check
function periodPlayersAvgOf(g) {
  if (!g || g.period_players == null || g.period_players === '') return null;
  const n = Number(g.period_players);
  return Number.isFinite(n) ? n : null;
}

function periodPlayersSumOf(g) {
  if (!g || g.period_players_sum == null || g.period_players_sum === '') return null;
  const n = Number(g.period_players_sum);
  return Number.isFinite(n) ? n : null;
}

function periodPlayersOf(g, mode = 'avg') {
  if (mode === 'sum') {
    const sum = periodPlayersSumOf(g);
    if (sum != null) return sum;
  }
  return periodPlayersAvgOf(g);
}

function periodEarnOf(g) {
  return Number(g && (g.period_earn != null ? g.period_earn : g.latest_earn)) || 0;
}

function gameShareOf(g, view) {
  const metric = view && view.shareMetric === 'earn' ? 'earn' : 'players';
  if (metric === 'earn') {
    const earn = periodEarnOf(g);
    const total = Number(view.totalEarn) || 0;
    if (!(earn > 0) || !(total > 0)) return null;
    return (earn / total) * 100;
  }
  const players = periodPlayersOf(g, view && view.playersMode);
  const total = Number(view.totalPlayers) || 0;
  if (players == null || !(total > 0)) return null;
  return (players / total) * 100;
}

function heatmapById(view) {
  if (view && view.heatById instanceof Map) return view.heatById;
  const map = new Map();
  const games = (view && view.heatmap && view.heatmap.games) || [];
  games.forEach((h) => {
    if (h && h.id != null) map.set(String(h.id), h);
  });
  return map;
}

function sparkNums(raw) {
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.map((v) => Number(v)).filter((n) => Number.isFinite(n));
}

function sparkPairOf(g, view, metric) {
  const heat = heatmapById(view).get(String(g.id));
  if (metric === 'earn') {
    return {
      cur: sparkNums((heat && heat.spark_earn) || (g && g.spark_earn)),
      prev: sparkNums(heat && heat.spark_earn_prev)
    };
  }
  return {
    cur: sparkNums((heat && heat.spark_players) || (g && g.spark_players)),
    prev: sparkNums(heat && heat.spark_players_prev)
  };
}
