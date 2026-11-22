// @ts-check
const gamesModelCache = new Map();
const gamesModelInflight = new Map();
const GAMES_MODEL_CACHE_LIMIT = 4;
window.NamiData = Object.assign(window.NamiData || {}, {
  gamesModelCache,
  gamesModelInflight,
  GAMES_MODEL_CACHE_LIMIT
});

function screenCacheKey(period, heatCompare, accountId) {
  return `${period}|${heatCompare}|${accountId || ''}`;
}

function putScreenModel(cache, key, model, limit) {
  cache.set(key, model);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
}

function staleScreen(cache, generation, current, prefetch, fallbackKey) {
  if (prefetch || generation === current) return null;
  return cache.get(fallbackKey) || null;
}
