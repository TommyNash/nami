//! Тепловая карта портфеля.
use super::*;
use super::memo::{earn_stats_through, earn_in_range, add_days};
use super::portfolio::{period_player_avgs, period_sparkline_series};

fn players_near_day(conn: &Connection, day: &str) -> AppResult<HashMap<String, f64>> {
    let mut stmt = conn.prepare(
        "SELECT m.game_id, m.players
         FROM game_metrics m
         INNER JOIN (
           SELECT game_id, MAX(observation_day) AS day
           FROM game_metrics
           WHERE observation_day <= ?1
           GROUP BY game_id
         ) t ON t.game_id = m.game_id AND t.day = m.observation_day",
    )?;
    let mut map = HashMap::new();
    for row in stmt.query_map([day], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<f64>>(1)?)))? {
        if let Ok((id, Some(p))) = row {
            map.insert(id, p);
        }
    }
    Ok(map)
}

pub fn games_heatmap(
    conn: &Connection,
    period: &str,
    compare_mode: &str,
    account_id: Option<&str>,
) -> AppResult<Value> {
    games_heatmap_with(conn, period, compare_mode, account_id, None)
}

pub fn games_heatmap_with(
    conn: &Connection,
    period: &str,
    compare_mode: &str,
    account_id: Option<&str>,
    games: Option<&Value>,
) -> AppResult<Value> {
    let bounds = period_bounds(period);
    let (cur_from, cur_to, cmp_from, cmp_to, label) = match compare_mode {
        "d7" | "d14" | "d30" => {
            let n: i64 = match compare_mode {
                "d7" => 7,
                "d14" => 14,
                _ => 30,
            };
            let cur_to = bounds.to_day.clone();
            let cur_from = add_days(&cur_to, -(n - 1)).unwrap_or(cur_to.clone());
            let cmp_to = add_days(&cur_from, -1).unwrap_or(cur_from.clone());
            let cmp_from = add_days(&cmp_to, -(n - 1)).unwrap_or(cmp_to.clone());
            (
                cur_from,
                cur_to,
                cmp_from,
                cmp_to,
                format!("к предыдущим {n}\u{00a0}дн."),
            )
        }
        _ => {
            let from = parse_ymd(&bounds.from_day).unwrap_or_else(today);
            let to = parse_ymd(&bounds.to_day).unwrap_or_else(today);
            let cur_days = days_between(from, to).max(1);
            let mut y = from.year();
            let mut m = from.month();
            if m == 1 {
                m = 12;
                y -= 1;
            } else {
                m -= 1;
            }
            let prev_start = NaiveDate::from_ymd_opt(y, m, 1).unwrap();
            let prev_end_month = if m == 12 {
                NaiveDate::from_ymd_opt(y + 1, 1, 1).unwrap().pred_opt().unwrap()
            } else {
                NaiveDate::from_ymd_opt(y, m + 1, 1).unwrap().pred_opt().unwrap()
            };
            let prev_end = (prev_start + Duration::days(cur_days - 1)).min(prev_end_month);
            (
                bounds.from_day.clone(),
                bounds.to_day.clone(),
                ymd(prev_start),
                ymd(prev_end),
                format!("к тем же {cur_days}\u{00a0}дн. прошлого месяца"),
            )
        }
    };

    let earn_rows = load_earnings_for(conn, account_id)?;
    let through = earn_stats_through(&earn_rows);
    let current_earn = earn_in_range(&earn_rows, &cur_from, &cur_to, through.as_deref());
    let compare_earn = earn_in_range(&earn_rows, &cmp_from, &cmp_to, through.as_deref());
    let mut current_players = period_player_avgs(conn, &cur_from, &cur_to)?;
    if current_players.is_empty() {
        current_players = players_near_day(conn, &cur_to)?;
    }
    let mut compare_players = period_player_avgs(conn, &cmp_from, &cmp_to)?;
    if compare_players.is_empty() {
        compare_players = players_near_day(conn, &cmp_to)?;
    }
    // Sparkline текущего и прошлого окон — одна шкала в UI, серая «тень» прошлого.
    let (spark_players_cur, spark_earn_cur) = period_sparkline_series(conn, &cur_from, &cur_to)?;
    let (spark_players_prev, spark_earn_prev) = period_sparkline_series(conn, &cmp_from, &cmp_to)?;
    let arr = match games.and_then(|v| v.as_array()).cloned() {
        Some(items) => items,
        None => list_games(conn, period, account_id)?
            .as_array()
            .cloned()
            .unwrap_or_default(),
    };

    let mut out = Vec::new();
    for g in arr {
        let id = g.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let players = current_players
            .get(&id)
            .copied()
            .or_else(|| g.get("latest_players").and_then(|v| v.as_f64()))
            .unwrap_or(0.0);
        let prev_players = compare_players.get(&id).copied();
        let earn = current_earn
            .get(&id)
            .copied()
            .or_else(|| g.get("period_earn").and_then(|v| v.as_f64()))
            .unwrap_or(0.0);
        let prev_earn = compare_earn.get(&id).copied();
        let players_delta = prev_players.filter(|p| *p > 0.0).map(|p| (players - p) / p * 100.0);
        let earn_delta = prev_earn.filter(|e| e.abs() > 1e-9).map(|e| (earn - e) / e * 100.0);
        out.push(json!({
            "id": id,
            "title": g.get("title"),
            "icon_url": g.get("icon_url"),
            "status": g.get("status"),
            "players": players,
            "prev_players": prev_players,
            "players_delta_pct": players_delta,
            "earn": earn,
            "prev_earn": prev_earn,
            "earn_delta_pct": earn_delta,
            "spark_players": spark_players_cur.get(&id).cloned().unwrap_or_default(),
            "spark_earn": spark_earn_cur.get(&id).cloned().unwrap_or_default(),
            "spark_players_prev": spark_players_prev.get(&id).cloned().unwrap_or_default(),
            "spark_earn_prev": spark_earn_prev.get(&id).cloned().unwrap_or_default()
        }));
    }

    Ok(json!({
        "period": period,
        "compareMode": compare_mode,
        "compareLabel": label,
        "currentBounds": { "fromDay": cur_from, "toDay": cur_to },
        "compareBounds": { "fromDay": cmp_from, "toDay": cmp_to },
        "games": out
    }))
}

