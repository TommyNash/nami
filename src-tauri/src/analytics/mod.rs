//! Аналитика портфеля: периоды, доходы, карта, покрытие, налог.
use crate::error::AppResult;
use chrono::{Datelike, Duration, Local, NaiveDate, NaiveTime, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
mod compare;
mod coverage;
mod game;
mod heatmap;
mod memo;
mod meta;
mod portfolio;
mod tax;
#[cfg(test)]
#[path = "tests_manual.rs"]
mod manual_earn_tests;

pub use compare::*;
pub use coverage::*;
pub use game::*;
pub use heatmap::*;
pub use meta::*;
pub use portfolio::*;
pub use tax::*;
pub use memo::{clear_earn_memo, warm_memos};

type EarnRow = (String, String, String, Option<f64>, i64, String);

fn account_id_opt(account_id: Option<&str>) -> Option<&str> {
    account_id.map(str::trim).filter(|s| !s.is_empty())
}

fn account_game_ids(
    conn: &Connection,
    account_id: Option<&str>,
) -> AppResult<Option<HashSet<String>>> {
    let Some(aid) = account_id_opt(account_id) else {
        return Ok(None);
    };
    let mut stmt = conn.prepare("SELECT id FROM games WHERE owner_id = ?1")?;
    let set = stmt
        .query_map([aid], |r| r.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect::<HashSet<_>>();
    Ok(Some(set))
}

fn retain_account_rows(rows: Vec<EarnRow>, games: &Option<HashSet<String>>) -> Vec<EarnRow> {
    match games {
        None => rows,
        Some(set) => rows.into_iter().filter(|r| set.contains(&r.0)).collect(),
    }
}

fn load_earnings_for(
    conn: &Connection,
    account_id: Option<&str>,
) -> AppResult<Vec<EarnRow>> {
    let rows = memo::load_earnings(conn)?;
    let games = account_game_ids(conn, account_id)?;
    Ok(retain_account_rows(rows, &games))
}

pub use fa_core::PeriodBounds;

fn ymd(d: NaiveDate) -> String {
    fa_core::ymd(d)
}

fn today() -> NaiveDate {
    fa_core::today()
}

fn parse_ymd(s: &str) -> Option<NaiveDate> {
    fa_core::parse_ymd(s)
}

fn days_between(from: NaiveDate, to: NaiveDate) -> i64 {
    fa_core::days_between(from, to)
}

/// Опубликованные игры, у которых когда-либо была статистика игроков.
/// Черновики/отклонённые и «пустые» карточки без метрик в покрытие не входят.
fn published_tracked_count(conn: &Connection, account_id: Option<&str>) -> i64 {
    let aid = account_id_opt(account_id);
    if let Some(aid) = aid {
        conn.query_row(
            "SELECT COUNT(DISTINCT g.id)
             FROM games g
             WHERE g.status = 'published'
               AND g.owner_id = ?1
               AND (
                 EXISTS (
                   SELECT 1 FROM game_metrics m
                   WHERE m.game_id = g.id AND COALESCE(m.players, 0) > 0
                 )
                 OR EXISTS (
                   SELECT 1 FROM metric_series s
                   WHERE s.game_id = g.id
                     AND s.series_name = 'players: Всего'
                     AND COALESCE(s.point_y, 0) > 0
                 )
               )",
            [aid],
            |r| r.get(0),
        )
        .unwrap_or(0)
    } else {
        conn.query_row(
            "SELECT COUNT(DISTINCT g.id)
             FROM games g
             WHERE g.status = 'published'
               AND (
                 EXISTS (
                   SELECT 1 FROM game_metrics m
                   WHERE m.game_id = g.id AND COALESCE(m.players, 0) > 0
                 )
                 OR EXISTS (
                   SELECT 1 FROM metric_series s
                   WHERE s.game_id = g.id
                     AND s.series_name = 'players: Всего'
                     AND COALESCE(s.point_y, 0) > 0
                 )
               )",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0)
    }
}

pub fn list_accounts(conn: &Connection) -> AppResult<Value> {
    let mut stmt = conn.prepare(
        "SELECT a.id,
                a.title,
                a.login,
                a.avatar_url,
                a.last_seen_at,
                (SELECT COUNT(*) FROM games g WHERE g.owner_id = a.id) AS games_count
         FROM accounts a
         ORDER BY a.last_seen_at DESC, a.title COLLATE NOCASE ASC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "title": r.get::<_, Option<String>>(1)?,
                "login": r.get::<_, Option<String>>(2)?,
                "avatar_url": r.get::<_, Option<String>>(3)?,
                "last_seen_at": r.get::<_, i64>(4)?,
                "games_count": r.get::<_, i64>(5)?,
            }))
        })?
        .filter_map(|r| r.ok())
        .collect::<Vec<_>>();
    Ok(Value::Array(rows))
}

fn is_published_status(status: Option<&str>) -> bool {
    matches!(status, Some("published"))
}

fn day_start_ms(day: &str) -> i64 {
    let d = parse_ymd(day).unwrap_or_else(today);
    let ndt = d.and_time(NaiveTime::from_hms_opt(0, 0, 0).unwrap());
    Local
        .from_local_datetime(&ndt)
        .single()
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

fn day_end_ms(day: &str) -> i64 {
    let d = parse_ymd(day).unwrap_or_else(today);
    let ndt = d.and_time(NaiveTime::from_hms_opt(23, 59, 59).unwrap());
    Local
        .from_local_datetime(&ndt)
        .single()
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

fn bounds_value(b: &PeriodBounds) -> Value {
    let mut v = json!({
        "fromDay": b.from_day,
        "toDay": b.to_day,
        "fromTs": day_start_ms(&b.from_day),
        "toTs": day_end_ms(&b.to_day),
    });
    if let Some(k) = &b.month_key {
        v["monthKey"] = json!(k);
    }
    if let Some(c) = b.month_complete {
        v["monthComplete"] = json!(c);
    }
    v
}

fn series_bounds(period: &str) -> PeriodBounds {
    if period == "day" || period == "week" {
        period_bounds("year")
    } else {
        period_bounds(period)
    }
}

pub fn period_bounds(period: &str) -> PeriodBounds {
    let end = today();
    if let Some(ym) = period.strip_prefix("m:") {
        if ym.len() == 7 {
            let y: i32 = ym[0..4].parse().unwrap_or(end.year());
            let m: u32 = ym[5..7].parse().unwrap_or(end.month());
            let from = NaiveDate::from_ymd_opt(y, m, 1).unwrap_or(end);
            let month_end = if m == 12 {
                NaiveDate::from_ymd_opt(y + 1, 1, 1).unwrap().pred_opt().unwrap()
            } else {
                NaiveDate::from_ymd_opt(y, m + 1, 1).unwrap().pred_opt().unwrap()
            };
            let to = if ym == end.format("%Y-%m").to_string() {
                end
            } else {
                month_end
            };
            return PeriodBounds {
                from_day: ymd(from),
                to_day: ymd(to),
                month_key: Some(ym.to_string()),
                month_complete: Some(to == month_end),
            };
        }
    }
    // Произвольный диапазон: r:YYYY-MM-DD:YYYY-MM-DD
    if let Some(rest) = period.strip_prefix("r:") {
        let parts: Vec<&str> = rest.split(':').collect();
        if parts.len() == 2 {
            if let (Some(a), Some(b)) = (parse_ymd(parts[0]), parse_ymd(parts[1])) {
                let (from, to_raw) = if a <= b { (a, b) } else { (b, a) };
                let to = if to_raw > end { end } else { to_raw };
                return PeriodBounds {
                    from_day: ymd(from),
                    to_day: ymd(to),
                    month_key: None,
                    month_complete: None,
                };
            }
        }
    }

    let mut start = end;
    match period {
        "day" => {}
        "week" => start = end - Duration::days(6),
        "month" => start = NaiveDate::from_ymd_opt(end.year(), end.month(), 1).unwrap_or(end),
        "quarter" => {
            let q = ((end.month() - 1) / 3) * 3 + 1;
            start = NaiveDate::from_ymd_opt(end.year(), q, 1).unwrap_or(end);
        }
        "year" => start = NaiveDate::from_ymd_opt(end.year(), 1, 1).unwrap_or(end),
        "all" => start = NaiveDate::from_ymd_opt(2018, 1, 1).unwrap_or(end),
        _ => start = NaiveDate::from_ymd_opt(end.year(), end.month(), 1).unwrap_or(end),
    }
    PeriodBounds {
        from_day: ymd(start),
        to_day: ymd(end),
        month_key: None,
        month_complete: None,
    }
}

fn is_monthly_bucket(from: &str, to: &str) -> bool {
    if from.len() < 10 || !from.ends_with("-01") || from == to {
        return false;
    }
    if from.get(0..7) != to.get(0..7) {
        return false;
    }
    let Some(a) = parse_ymd(from) else { return false };
    let Some(b) = parse_ymd(to) else { return false };
    // Полный календарный месяц, не «1-е .. сегодня» и не один день.
    let month_end = {
        let next = if a.month() == 12 {
            NaiveDate::from_ymd_opt(a.year() + 1, 1, 1)
        } else {
            NaiveDate::from_ymd_opt(a.year(), a.month() + 1, 1)
        };
        next.and_then(|d| d.pred_opt())
    };
    month_end == Some(b)
}

fn earn_span_days(from: &str, to: &str) -> i64 {
    let Some(a) = parse_ymd(from) else { return 99 };
    let Some(b) = parse_ymd(to) else { return 99 };
    days_between(a, b).max(1)
}


