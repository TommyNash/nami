/**
 * Локальная проверка ingest + нормализации.
 * node scripts/smoke-ingest.js [token] [port]
 */
const token = process.argv[2] || '';
const port = Number(process.argv[3] || 17321);
const dayKey = new Date().toISOString().slice(0, 10);

async function post(events) {
  const res = await fetch(`http://127.0.0.1:${port}/ingest`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-founders-token': token } : {})
    },
    body: JSON.stringify({
      source: 'nami-collector',
      schemaVersion: 1,
      events
    })
  });
  const json = await res.json();
  console.log('ingest', res.status, json);
  return json;
}

function event(partial) {
  return {
    id: `${partial.id || 'smoke'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    dedupeKey: `${partial.dedupeKey || partial.pathname}-${dayKey}-${Math.random().toString(36).slice(2, 5)}`,
    capturedAt: Date.now(),
    method: partial.method || 'GET',
    url: partial.url,
    pathname: partial.pathname,
    search: partial.search || '',
    status: 200,
    contentType: 'application/json',
    category: partial.category,
    gameId: partial.gameId || null,
    transport: 'smoke',
    body: partial.body,
    schemaVersion: 1
  };
}

async function main() {
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  console.log('health', health.status, await health.json());

  await post([
    event({
      category: 'Dashboard',
      gameId: '1001',
      pathname: '/console/api/application-panel',
      url: 'https://games.yandex.ru/console/api/application-panel?game_id=1001&lang=ru',
      search: '?game_id=1001&lang=ru',
      body: {
        show: true,
        widgets: {
          items: [
            { id: 'players', title: 'Игроки', items: [{ type: 'average', value: '894' }] },
            {
              id: 'rating',
              title: 'Рейтинг',
              items: [
                { title: 'Россия и СНГ', value: 62 },
                { title: 'Остальной мир', value: 58 }
              ]
            },
            { id: 'play_time_for_player', title: 'Время', items: [{ type: 'average', value: '12,08' }] },
            {
              id: 'game_ready_api',
              title: 'Game Ready',
              items: [
                { type: 'average', value: '16,44' },
                { type: 'difference', value: '–7,2%' }
              ]
            }
          ]
        },
        pieCharts: {
          items: [
            {
              id: 'country',
              title: 'Страны',
              data: {
                options: {
                  series: [{ data: [{ name: 'Россия', y: 677 }, { name: 'США', y: 51 }] }]
                }
              }
            },
            {
              id: 'device',
              title: 'Платформы',
              data: {
                options: {
                  series: [{ data: [{ name: 'mobile', y: 462 }, { name: 'desktop', y: 430 }] }]
                }
              }
            }
          ]
        }
      }
    }),
    event({
      category: 'Reviews',
      gameId: '1001',
      pathname: '/console/api/application-reviews/1001',
      url: 'https://games.yandex.ru/console/api/application-reviews/1001?offset=0&sort=by_time',
      search: '?offset=0&sort=by_time',
      body: {
        pager: { reviewCount: 103, totalCount: 103 },
        ratingStats: { avgRating: 4.3, one: 10, two: 5, three: 8, four: 20, five: 100, total: 143 },
        view: {
          views: [
            {
              id: 'smoke-review-1',
              type: '/ugc/review',
              time: Date.now(),
              author: { name: 'Player' },
              text: 'Отличная игра',
              rating: { val: 5, max: 5 },
              textLanguage: 'RU',
              reactions: { likesCount: 2, dislikesCount: 0 }
            }
          ]
        }
      }
    }),
    event({
      category: 'Dashboard',
      pathname: '/console/api/metrics-engine/total/data',
      url: 'https://games.yandex.ru/console/api/metrics-engine/total/data?lang=ru&slug=total_earn&date_range=2026-11-01&date_range=2026-11-07',
      search: '?lang=ru&slug=total_earn&date_range=2026-11-01&date_range=2026-11-07',
      body: {
        type: 'data',
        slug: 'total_earn',
        totals: { earn: 100, adv: 80, inapp: 20 },
        items: [
          {
            game_id: 1001,
            game_title: { ru: 'Demo Game' },
            earn: 50,
            adv: 40,
            rsya: 30,
            intad: 10,
            inapp: 10
          }
        ]
      }
    }),
    event({
      category: 'Metrics',
      gameId: '1001',
      method: 'POST',
      pathname: '/console/api/metrics-engine/analytics/data',
      url: 'https://games.yandex.ru/console/api/metrics-engine/analytics/data',
      body: {
        type: 'graph_wizard_node',
        constructor_type: 'stockChart',
        options: {
          series: [
            {
              name: 'Россия и СНГ',
              data: [
                { x: Date.now() - 86400000 * 2, y: 55 },
                { x: Date.now() - 86400000, y: 60 },
                { x: Date.now(), y: 62 }
              ]
            }
          ]
        }
      }
    })
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
