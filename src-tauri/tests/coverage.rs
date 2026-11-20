use nami_lib::analytics;
use rusqlite::Connection;

#[test]
fn coverage_on_real_db() {
    let Ok(src) = std::env::var("FA_DB") else {
        eprintln!("FA_DB не задан — пропуск");
        return;
    };
    let tmp = std::env::temp_dir().join(format!("fa-cov-{}.sqlite", std::process::id()));
    std::fs::copy(&src, &tmp).expect("copy db");
    for suffix in ["-wal", "-shm"] {
        let from = std::path::PathBuf::from(format!("{src}{suffix}"));
        if from.exists() {
            let _ = std::fs::copy(&from, format!("{}{suffix}", tmp.display()));
        }
    }
    let conn = Connection::open(&tmp).expect("open");

    for period in ["day", "week", "month"] {
        match analytics::data_coverage(&conn, period, None) {
            Ok(v) => {
                println!("--- {period} ---");
                println!("  today={:?}", v.get("today"));
                println!("  bounds={:?}", v.get("bounds"));
                println!("  metricsDays={:?}", v.get("metricsDays"));
                println!("  earnStatsThrough={:?}", v.get("earnStatsThrough"));
                println!("  earnLagDays={:?}", v.get("earnLagDays"));
                println!(
                    "  earnBuckets(kind)= {:?}",
                    v.get("earnBuckets")
                        .and_then(|b| b.as_array())
                        .map(|a| a
                            .iter()
                            .map(|x| format!(
                                "{}..{}={:?}",
                                x.get("from").and_then(|s| s.as_str()).unwrap_or(""),
                                x.get("to").and_then(|s| s.as_str()).unwrap_or(""),
                                x.get("kind").and_then(|s| s.as_str()).unwrap_or("")
                            ))
                            .collect::<Vec<_>>())
                );
            }
            Err(e) => println!("--- {period} --- ОШИБКА: {e}"),
        }
    }
    let _ = std::fs::remove_file(&tmp);
}
