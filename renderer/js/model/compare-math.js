// @ts-check
function compareInitials(title) {
  return (
    String(title || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'
  );
}

function compareBestIndex(games, key, better) {
  let best = -1;
  let bestVal = null;
  games.forEach((g, i) => {
    const v = Number(g[key]);
    if (!Number.isFinite(v)) return;
    if (bestVal == null) {
      best = i;
      bestVal = v;
      return;
    }
    if (better === 'min' ? v < bestVal : v > bestVal) {
      best = i;
      bestVal = v;
    }
  });
  return best;
}

function compareBarPct(game, games, key, better) {
  const vals = games.map((g) => Number(g[key])).filter((v) => Number.isFinite(v));
  if (!vals.length) return 0;
  const v = Number(game[key]);
  if (!Number.isFinite(v)) return 0;
  if (better === 'min') {
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    if (max === min) return 100;
    return Math.max(8, ((max - v) / (max - min)) * 100);
  }
  const max = Math.max(...vals.map((x) => Math.abs(x)));
  if (max <= 0) return 0;
  return Math.max(8, (Math.abs(v) / max) * 100);
}
