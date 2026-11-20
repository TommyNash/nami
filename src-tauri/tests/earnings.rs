use nami_lib::analytics;
use rusqlite::Connection;

#[test]
fn earnings_dedupe_and_daily_candles() {
    let Ok(src) = std::env::var("FA_DB") else {
        eprintln!("FA_DB не задан — пропуск");
        return;
    };
    let tmp = std::env::temp_dir().join(format!("fa-earn-{}.sqlite", std::process::id()));
    std::fs::copy(&src, &tmp).expect("copy db");
    for suffix in ["-wal", "-shm"] {
        let from = std::path::PathBuf::from(format!("{src}{suffix}"));
        if from.exists() {
            let _ = std::fs::copy(&from, format!("{}{suffix}", tmp.display()));
        }
    }
    let conn = Connection::open(&tmp).expect("open");

    // 1. Доход по месяцам — без двойного счёта повторных снимков
    let months = analytics::list_earn_months(&conn, None).unwrap();
    println!("--- месяцы ---");
    for m in months.as_array().cloned().unwrap_or_default().iter().take(4) {
        println!(
            "  {} {}..{} earn={} collected={:?}",
            m.get("key").and_then(|v| v.as_str()).unwrap_or(""),
            m.get("from").and_then(|v| v.as_str()).unwrap_or(""),
            m.get("to").and_then(|v| v.as_str()).unwrap_or(""),
            m.get("earn").and_then(|v| v.as_f64()).unwrap_or(0.0),
            m.get("collectedDay")
        );
    }

    // 2. KPI за месяц должен совпасть с месячной суммой
    let list = analytics::list_games(&conn, "month", None).unwrap();
    let kpi: f64 = list
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|g| g.get("period_earn").and_then(|v| v.as_f64()))
        .sum();
    let november = months
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .find(|m| m.get("key").and_then(|v| v.as_str()) == Some("2026-11"))
        .and_then(|m| m.get("earn").and_then(|v| v.as_f64()))
        .unwrap_or(0.0);
    println!("--- сверка ---");
    println!("  KPI за месяц (list_games month) = {kpi:.2}");
    println!("  Бар ноября (list_earn_months)   = {november:.2}");
    let over = november > kpi * 1.5;
    println!("  завышение бара: {over}");

    // 3. Дневные бакеты для свечей
    let cov = analytics::data_coverage(&conn, "month", None).unwrap();
    println!("--- дневные бакеты доходов ---");
    let buckets = cov
        .get("earnBuckets")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for b in buckets.iter().filter(|b| b.get("kind").and_then(|v| v.as_str()) == Some("day")) {
        println!(
            "  {} earn={:.2} games={} withValue={} hasValue={}",
            b.get("from").and_then(|v| v.as_str()).unwrap_or(""),
            b.get("earn").and_then(|v| v.as_f64()).unwrap_or(0.0),
            b.get("games").and_then(|v| v.as_i64()).unwrap_or(0),
            b.get("gamesWithValue").and_then(|v| v.as_i64()).unwrap_or(0),
            b.get("hasValue").and_then(|v| v.as_bool()).unwrap_or(false)
        );
    }

    assert!(!over, "месячный бар не должен вдвое превышать KPI");
    let _ = std::fs::remove_file(&tmp);
}
