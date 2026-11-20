/**
 * Классификация только по реально исследованным path-паттернам.
 */

const RULES = [
  { category: 'Games', pattern: /^\/console\/api\/applications\/?$/ },
  { category: 'Games', pattern: /^\/console\/api\/application\/\d+\/?$/ },
  { category: 'Dashboard', pattern: /^\/console\/api\/application-panel\/?$/ },
  { category: 'Dashboard', pattern: /^\/console\/api\/metrics-engine\/total\/data\/?$/ },
  { category: 'Metrics', pattern: /^\/console\/api\/application-metrics\/?$/ },
  { category: 'Metrics', pattern: /^\/console\/api\/metrics-engine\/analytics\/data\/?$/ },
  { category: 'Purchases', pattern: /^\/console\/api\/metrics-engine\/in-app\/(layout|data)\/?$/ },
  { category: 'Purchases', pattern: /^\/console\/api\/application-purchases\/\d+\/?$/ },
  { category: 'Purchases', pattern: /^\/console\/api\/currency-regional-prices\/\d+\/?$/ },
  { category: 'Reviews', pattern: /^\/console\/api\/application-reviews\/\d+\/?$/ },
  { category: 'Advertising', pattern: /^\/console\/api\/app-settings\/?$/ },
  { category: 'Geography', pattern: /^\/console\/api\/regions\/?$/ },
  { category: 'Other', pattern: /^\/console\/api\/categories\/?$/ },
  { category: 'Other', pattern: /^\/console\/api\/developer\/\d+\/?$/ },
  { category: 'Other', pattern: /^\/console\/api\/application-purchases-test-users\/\d+\/?$/ }
];

const IGNORE = [
  /\/messenger\/api\//,
  /\/clck\/click/,
  /mc\.yandex/,
  /metrika/
];

export function shouldIgnore(url) {
  return IGNORE.some((re) => re.test(url));
}

export function classifyPath(pathname) {
  for (const rule of RULES) {
    if (rule.pattern.test(pathname)) return rule.category;
  }
  if (pathname.startsWith('/console/api/')) return 'Other';
  return null;
}

export function extractGameId(url, pathname, search) {
  const fromPath =
    pathname.match(/\/application\/(\d+)/) ||
    pathname.match(/\/application-reviews\/(\d+)/) ||
    pathname.match(/\/application-purchases(?:-test-users)?\/(\d+)/) ||
    pathname.match(/\/currency-regional-prices\/(\d+)/);
  if (fromPath) return fromPath[1];

  try {
    const params = new URLSearchParams(search || '');
    return params.get('game_id') || params.get('appId') || params.get('app_id') || null;
  } catch {
    return null;
  }
}

export function extractGameIdFromTabUrl(tabUrl) {
  if (!tabUrl) return null;
  const m = String(tabUrl).match(/\/console\/application\/(\d+)/);
  return m ? m[1] : null;
}

export { RULES };
