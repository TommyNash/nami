use nami_lib::normalize;
use rusqlite::Connection;

#[test]
fn reprocess_pending_on_live_db() {
    let Ok(src) = std::env::var("FA_DB") else {
        eprintln!("FA_DB не задан — пропуск");
        return;
    };
    if std::env::var("FA_REPROCESS").ok().as_deref() != Some("1") {
        eprintln!("FA_REPROCESS=1 не задан — пропуск (тест пишет в живую БД)");
        return;
    }
    let conn = Connection::open(&src).expect("open live db");
    let before: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM raw_responses WHERE normalized = 0",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let res = normalize::reprocess(&conn, false).expect("reprocess");
    let after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM raw_responses WHERE normalized = 0",
            [],
            |r| r.get(0),
        )
        .unwrap();
    println!("pending before={before} after={after} result={res}");
}
