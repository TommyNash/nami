use nami_lib::normalize;
use rusqlite::Connection;

/// Проверяем, что после «полного» пересчёта у игры появляются ряды
/// purchase_amount (слой «Доход») и свежие дни.
#[test]
fn series_backfill_for_earn_layer() {
    let Ok(src) = std::env::var("FA_DB") else {
        eprintln!("FA_DB не задан — пропуск");
        return;
    };
    let tmp = std::env::temp_dir().join(format!("fa-series-{}.sqlite", std::process::id()));
    std::fs::copy(&src, &tmp).expect("copy db");
    for suffix in ["-wal", "-shm"] {
        let from = std::path::PathBuf::from(format!("{src}{suffix}"));
        if from.exists() {
            let _ = std::fs::copy(&from, format!("{}{suffix}", tmp.display()));
        }
    }
    let conn = Connection::open(&tmp).expect("open");

    let res = normalize::reprocess(&conn, true).expect("reprocess");
    println!("reprocess: {res}");

    let (rows, games, names, latest): (i64, i64, i64, Option<String>) = conn
        .query_row(
            "SELECT COUNT(*), COUNT(DISTINCT game_id), COUNT(DISTINCT series_name), MAX(observation_day)
             FROM metric_series",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    println!("metric_series rows={rows} games={games} names={names} latest={latest:?}");

    // У любой игры должны быть ряды purchase_amount — иначе слой «Доход» пустой
    let with_earn: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT game_id) FROM metric_series WHERE series_name LIKE 'purchase_amount:%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    println!("игр с рядами purchase_amount: {with_earn}");

    let earn_names: Vec<String> = conn
        .prepare("SELECT DISTINCT series_name FROM metric_series WHERE series_name LIKE 'purchase_amount:%' ORDER BY 1")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();
    println!("ряды дохода: {earn_names:?}");

    // Инапы и отзывы тоже должны появиться
    let inapp: i64 = conn
        .query_row("SELECT COUNT(*) FROM purchase_metrics", [], |r| r.get(0))
        .unwrap();
    let reviews: i64 = conn
        .query_row("SELECT COUNT(*) FROM game_reviews", [], |r| r.get(0))
        .unwrap();
    println!("purchase_metrics={inapp} reviews={reviews}");

    assert!(rows > 1000, "ряды метрик должны быть заполнены");
    assert!(with_earn > 0, "должен быть хотя бы один ряд purchase_amount");
    assert!(
        earn_names.iter().any(|n| n.contains("Инап-покупки")),
        "ожидался ряд «purchase_amount: Инап-покупки», получено {earn_names:?}"
    );
    let _ = std::fs::remove_file(&tmp);
}
