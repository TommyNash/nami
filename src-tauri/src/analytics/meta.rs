//! Служебные срезы: overview, collector, history.
use super::*;

pub fn overview(conn: &Connection) -> AppResult<Value> {
    let games: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))?;
    let raw: i64 = conn.query_row("SELECT COUNT(*) FROM raw_responses", [], |r| r.get(0))?;
    let raw_pending: i64 = conn.query_row(
        "SELECT COUNT(*) FROM raw_responses WHERE normalized = 0",
        [],
        |r| r.get(0),
    )?;
    let last: Option<i64> = conn
        .query_row(
            "SELECT MAX(captured_at) FROM raw_responses",
            [],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    Ok(json!({
        "games": games,
        "rawResponses": raw,
        "rawPending": raw_pending,
        "rawNormalized": (raw - raw_pending).max(0),
        "lastCapturedAt": last
    }))
}

pub fn collector_state(conn: &Connection) -> AppResult<Value> {
    let sessions: i64 =
        conn.query_row("SELECT COUNT(*) FROM collector_sessions", [], |r| r.get(0))?;
    let last_seen: Option<i64> = conn
        .query_row(
            "SELECT MAX(last_seen_at) FROM collector_sessions",
            [],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    Ok(json!({
        "sessions": sessions,
        "lastSeenAt": last_seen
    }))
}

pub fn freshness(conn: &Connection, game_id: Option<&str>) -> AppResult<Value> {
    let last: Option<i64> = conn
        .query_row(
            "SELECT MAX(captured_at) FROM raw_responses",
            [],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    let mut game_updated: Option<i64> = None;
    if let Some(id) = game_id {
        game_updated = conn
            .query_row(
                "SELECT MAX(captured_at) FROM raw_responses WHERE game_id = ?1",
                [id],
                |r| r.get(0),
            )
            .ok()
            .flatten();
    }
    Ok(json!({
        "lastUpdatedAt": last,
        "gameUpdatedAt": game_updated
    }))
}

pub fn db_stats(conn: &Connection) -> AppResult<Value> {
    let games: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0))?;
    let raw: i64 = conn.query_row("SELECT COUNT(*) FROM raw_responses", [], |r| r.get(0))?;
    let raw_pending: i64 = conn.query_row(
        "SELECT COUNT(*) FROM raw_responses WHERE normalized = 0",
        [],
        |r| r.get(0),
    )?;
    let metrics: i64 = conn.query_row("SELECT COUNT(*) FROM game_metrics", [], |r| r.get(0))?;
    let earnings: i64 = conn.query_row("SELECT COUNT(*) FROM game_earnings", [], |r| r.get(0))?;
    Ok(json!({
        "games": games,
        "rawResponses": raw,
        "rawPending": raw_pending,
        "rawNormalized": (raw - raw_pending).max(0),
        "metrics": metrics,
        "earnings": earnings
    }))
}

pub fn list_history(conn: &Connection, limit: i64) -> AppResult<Value> {
    let mut stmt = conn.prepare(
        "SELECT id, started_at, finished_at, source, accepted, duplicates, errors, notes
         FROM collection_history ORDER BY id DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "started_at": r.get::<_, Option<i64>>(1)?,
                "finished_at": r.get::<_, Option<i64>>(2)?,
                "source": r.get::<_, Option<String>>(3)?,
                "accepted": r.get::<_, i64>(4)?,
                "duplicates": r.get::<_, i64>(5)?,
                "errors": r.get::<_, i64>(6)?,
                "notes": r.get::<_, Option<String>>(7)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(Value::Array(rows))
}

