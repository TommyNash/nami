//! Проверка нормализатора на копии реальной базы.
//! Запуск: FA_DB=/path/to/nami.sqlite cargo test --test real_db -- --nocapture

use nami_lib::normalize;
use rusqlite::Connection;

#[test]
fn replay_real_raw_responses() {
    let Ok(src) = std::env::var("FA_DB") else {
        eprintln!("FA_DB не задан — тест пропущен");
        return;
    };
    let tmp = std::env::temp_dir().join(format!("fa-test-{}.sqlite", std::process::id()));
    std::fs::copy(&src, &tmp).expect("copy db");
    // WAL: свежие строки могут лежать ещё в -wal, без него копия неполная.
    for suffix in ["-wal", "-shm"] {
        let from = std::path::PathBuf::from(format!("{src}{suffix}"));
        if from.exists() {
            let _ = std::fs::copy(&from, format!("{}{suffix}", tmp.display()));
        }
    }
    let conn = Connection::open(&tmp).expect("open db");

    let result = normalize::reprocess(&conn, true).expect("reprocess");
    println!("reprocess: {result}");

    // Какие ручки не разобрались
    let mut stmt = conn
        .prepare(
            "SELECT pathname, COUNT(*) FROM raw_responses WHERE normalized = 0 GROUP BY 1 ORDER BY 2 DESC",
        )
        .unwrap();
    let left: Vec<String> = stmt
        .query_map([], |r| {
            Ok(format!(
                "{} ×{}",
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    println!("не разобрано: {}", left.join(" | "));

    let mut stmt = conn
        .prepare("SELECT observation_day, COUNT(*), SUM(players) FROM game_metrics GROUP BY 1 ORDER BY 1 DESC LIMIT 10")
        .unwrap();
    let days: Vec<String> = stmt
        .query_map([], |r| {
            Ok(format!(
                "{} games={} players={}",
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, f64>(2)?
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    println!("metrics days: {}", days.join(" | "));

    let mut stmt = conn
        .prepare("SELECT period_from, period_to, COUNT(*), ROUND(SUM(earn),2) FROM game_earnings GROUP BY 1,2 ORDER BY 1 DESC LIMIT 8")
        .unwrap();
    let buckets: Vec<String> = stmt
        .query_map([], |r| {
            Ok(format!(
                "{}→{} games={} earn={}",
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<f64>>(3)?.unwrap_or(0.0)
            ))
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    println!("earn buckets: {}", buckets.join(" | "));

    let games: i64 = conn
        .query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))
        .unwrap();
    println!("games={games}");

    // Ряды метрик: именно они питают графики в карточке игры и вкладку «Метрики»
    let series_total: i64 = conn
        .query_row("SELECT COUNT(*) FROM metric_series", [], |r| r.get(0))
        .unwrap();
    let series_days: i64 = conn
        .query_row("SELECT COUNT(DISTINCT observation_day) FROM metric_series", [], |r| r.get(0))
        .unwrap();
    let series_latest: Option<String> = conn
        .query_row("SELECT MAX(observation_day) FROM metric_series", [], |r| r.get(0))
        .ok();
    let series_games: i64 = conn
        .query_row("SELECT COUNT(DISTINCT game_id) FROM metric_series", [], |r| r.get(0))
        .unwrap();
    let series_names: i64 = conn
        .query_row("SELECT COUNT(DISTINCT series_name) FROM metric_series", [], |r| r.get(0))
        .unwrap();
    println!(
        "metric_series: rows={series_total} games={series_games} names={series_names} days={series_days} latest={series_latest:?}"
    );

    let purchases: i64 = conn
        .query_row("SELECT COUNT(*) FROM game_purchases", [], |r| r.get(0))
        .unwrap();
    let reviews: i64 = conn
        .query_row("SELECT COUNT(*) FROM game_reviews", [], |r| r.get(0))
        .unwrap();
    let ratings: i64 = conn
        .query_row("SELECT COUNT(*) FROM game_ratings", [], |r| r.get(0))
        .unwrap();
    let inapp: i64 = conn
        .query_row("SELECT COUNT(*) FROM purchase_metrics", [], |r| r.get(0))
        .unwrap();
    println!("purchases={purchases} reviews={reviews} ratings={ratings} purchase_metrics={inapp}");

    // Главное: доход за день/неделю больше не ноль, а оценка по последнему дню.
    for period in ["day", "week", "month"] {
        let list = nami_lib::analytics::list_games(&conn, period, None).unwrap();
        let rows = list.as_array().cloned().unwrap_or_default();
        let earn: f64 = rows
            .iter()
            .filter_map(|g| g.get("period_earn").and_then(|v| v.as_f64()))
            .sum();
        let estimated = rows
            .iter()
            .filter(|g| g.get("period_earn_estimated").and_then(|v| v.as_bool()) == Some(true))
            .count();
        println!("list_games({period}): games={} earn={earn:.2} estimated={estimated}", rows.len());

        let ov = nami_lib::analytics::analytics_overview(&conn, period, None).unwrap();
        println!(
            "  overview: playersDay={:?} lag={:?} playersAvg={:?} earn={:.2}",
            ov.get("playersDay"),
            ov.get("playersDayLag"),
            ov.get("playersAvg"),
            ov.get("earnings").and_then(|e| e.get("earn")).and_then(|v| v.as_f64()).unwrap_or(0.0)
        );
    }

    let cov = nami_lib::analytics::data_coverage(&conn, "week", None).unwrap();
    let days = cov.get("metricsDays").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    println!(
        "coverage: today={} latestMetricsDay={:?} lag={} metricsDays={}",
        cov.get("today").and_then(|v| v.as_str()).unwrap_or(""),
        cov.get("latestMetricsDay"),
        cov.get("latestMetricsLagDays").and_then(|v| v.as_i64()).unwrap_or(-1),
        days.len()
    );

    let unnormalized: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM raw_responses WHERE normalized = 0
             AND (pathname = '/console/api/application-panel'
               OR pathname = '/console/api/metrics-engine/total/data'
               OR pathname = '/console/api/applications')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(unnormalized, 0, "ключевые ручки должны разбираться");
    let _ = std::fs::remove_file(&tmp);
}
