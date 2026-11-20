//! Карточка игры и связанные срезы.
use super::*;
use super::memo::{series_memo, load_earnings, select_earnings, daily_winners, series_hits};

pub(super) fn map_metric_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>(0)?,
        "game_id": r.get::<_, String>(1)?,
        "observation_day": r.get::<_, String>(2)?,
        "captured_at": r.get::<_, i64>(3)?,
        "players": r.get::<_, Option<f64>>(4)?,
        "play_time_per_player": r.get::<_, Option<f64>>(5)?,
        "game_ready": r.get::<_, Option<f64>>(6)?,
        "game_ready_delta": r.get::<_, Option<f64>>(7)?,
        "rating_ru": r.get::<_, Option<f64>>(8)?,
        "rating_world": r.get::<_, Option<f64>>(9)?
    }))
}

const METRIC_SELECT: &str = "id, game_id, observation_day, captured_at, players, play_time_per_player, game_ready, game_ready_delta, rating_ru, rating_world";

pub(super) fn earnings_for_game(conn: &Connection, game_id: &str, period: &str) -> AppResult<Vec<Value>> {
    let bounds = period_bounds(period);
    let all = load_earnings(conn)?;
    let game_rows: Vec<_> = all.into_iter().filter(|r| r.0 == game_id).collect();
    let mut selected = select_earnings(&game_rows, period, &bounds);
    selected.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(selected
        .into_iter()
        .map(|r| {
            json!({
                "game_id": r.0,
                "period_from": r.1,
                "period_to": r.2,
                "earn": r.3,
                "captured_at": r.4
            })
        })
        .collect())
}

pub fn game_earnings_page(conn: &Connection, game_id: &str, period: &str) -> AppResult<Value> {
    let bounds = period_bounds(period);
    let rows = earnings_for_game(conn, game_id, period)?;
    Ok(json!({
        "period": period,
        "bounds": bounds_value(&bounds),
        "rows": rows
    }))
}

pub fn game_details(conn: &Connection, game_id: &str, period: &str) -> AppResult<Option<Value>> {
    let game = conn
        .query_row(
            "SELECT id, title, title_json, status, rating, owner_id, icon_url, first_seen_at, last_seen_at
             FROM games WHERE id = ?1",
            [game_id],
            |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "title": r.get::<_, Option<String>>(1)?,
                    "title_json": r.get::<_, Option<String>>(2)?,
                    "status": r.get::<_, Option<String>>(3)?,
                    "rating": r.get::<_, Option<i64>>(4)?,
                    "owner_id": r.get::<_, Option<String>>(5)?,
                    "icon_url": r.get::<_, Option<String>>(6)?,
                    "first_seen_at": r.get::<_, i64>(7)?,
                    "last_seen_at": r.get::<_, i64>(8)?
                }))
            },
        )
        .optional()?;
    let Some(game) = game else {
        return Ok(None);
    };

    let bounds = period_bounds(period);
    let chart = series_bounds(period);
    let chart_all = if period == "all" { 1i64 } else { 0 };
    let from_day = &chart.from_day;
    let to_day = &chart.to_day;
    let from_ts = day_start_ms(from_day);
    let to_ts = day_end_ms(to_day);

    let mut metrics_stmt = conn.prepare(&format!(
        "SELECT {METRIC_SELECT} FROM game_metrics
         WHERE game_id = ?1
           AND (?2 = 1 OR observation_day BETWEEN ?3 AND ?4)
         ORDER BY observation_day ASC, captured_at ASC
         LIMIT 120"
    ))?;
    let metrics_history: Vec<Value> = metrics_stmt
        .query_map(params![game_id, chart_all, from_day, to_day], map_metric_row)?
        .filter_map(|r| r.ok())
        .collect();

    let latest = conn
        .query_row(
            &format!(
                "SELECT {METRIC_SELECT} FROM game_metrics
                 WHERE game_id = ?1 ORDER BY captured_at DESC LIMIT 1"
            ),
            [game_id],
            map_metric_row,
        )
        .optional()?;

    let obs_day = latest
        .as_ref()
        .and_then(|v| v.get("observation_day"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let geography: Vec<Value> = if let Some(day) = &obs_day {
        let mut stmt = conn.prepare(
            "SELECT country, players FROM game_geography
             WHERE game_id = ?1 AND observation_day = ?2
             ORDER BY players DESC",
        )?;
        let rows: Vec<Value> = stmt
            .query_map(params![game_id, day], |r| {
                Ok(json!({
                    "country": r.get::<_, String>(0)?,
                    "players": r.get::<_, Option<f64>>(1)?
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();
        rows
    } else {
        Vec::new()
    };

    let platforms: Vec<Value> = if let Some(day) = &obs_day {
        let mut stmt = conn.prepare(
            "SELECT platform, players FROM game_platforms
             WHERE game_id = ?1 AND observation_day = ?2
             ORDER BY players DESC",
        )?;
        let rows: Vec<Value> = stmt
            .query_map(params![game_id, day], |r| {
                Ok(json!({
                    "platform": r.get::<_, String>(0)?,
                    "players": r.get::<_, Option<f64>>(1)?
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();
        rows
    } else {
        Vec::new()
    };

    let mut ratings_stmt = conn.prepare(
        "SELECT id, game_id, observation_day, captured_at, avg_rating, stars_1, stars_2, stars_3, stars_4, stars_5, total, review_count
         FROM game_ratings
         WHERE game_id = ?1
           AND (?2 = 1 OR observation_day BETWEEN ?3 AND ?4)
         ORDER BY observation_day ASC, captured_at ASC",
    )?;
    let ratings_history: Vec<Value> = ratings_stmt
        .query_map(params![game_id, chart_all, from_day, to_day], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "game_id": r.get::<_, String>(1)?,
                "observation_day": r.get::<_, String>(2)?,
                "captured_at": r.get::<_, i64>(3)?,
                "avg_rating": r.get::<_, Option<f64>>(4)?,
                "stars_1": r.get::<_, Option<i64>>(5)?,
                "stars_2": r.get::<_, Option<i64>>(6)?,
                "stars_3": r.get::<_, Option<i64>>(7)?,
                "stars_4": r.get::<_, Option<i64>>(8)?,
                "stars_5": r.get::<_, Option<i64>>(9)?,
                "total": r.get::<_, Option<i64>>(10)?,
                "review_count": r.get::<_, Option<i64>>(11)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();
    let ratings = ratings_history.last().cloned();

    let mut reviews_stmt = conn.prepare(
        "SELECT id, game_id, captured_at, review_time, author_name, text, rating, language, likes, dislikes
         FROM game_reviews WHERE game_id = ?1 ORDER BY review_time DESC LIMIT 100",
    )?;
    let reviews: Vec<Value> = reviews_stmt
        .query_map([game_id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "game_id": r.get::<_, String>(1)?,
                "captured_at": r.get::<_, i64>(2)?,
                "review_time": r.get::<_, Option<i64>>(3)?,
                "author_name": r.get::<_, Option<String>>(4)?,
                "text": r.get::<_, Option<String>>(5)?,
                "rating": r.get::<_, Option<f64>>(6)?,
                "language": r.get::<_, Option<String>>(7)?,
                "likes": r.get::<_, Option<i64>>(8)?,
                "dislikes": r.get::<_, Option<i64>>(9)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut purchases_stmt = conn.prepare(
        "SELECT product_id, observation_day, captured_at, title, price_value, price_code, removed
         FROM game_purchases
         WHERE game_id = ?1 AND observation_day = (
           SELECT MAX(observation_day) FROM game_purchases WHERE game_id = ?1
         )
         ORDER BY product_id",
    )?;
    let purchases: Vec<Value> = purchases_stmt
        .query_map([game_id], |r| {
            Ok(json!({
                "product_id": r.get::<_, String>(0)?,
                "observation_day": r.get::<_, String>(1)?,
                "captured_at": r.get::<_, i64>(2)?,
                "title": r.get::<_, Option<String>>(3)?,
                "price_value": r.get::<_, Option<f64>>(4)?,
                "price_code": r.get::<_, Option<String>>(5)?,
                "removed": r.get::<_, i64>(6)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut pm_stmt = conn.prepare(
        "SELECT observation_day, captured_at, metric_slug, metric_title, value, unit
         FROM purchase_metrics
         WHERE game_id = ?1 AND observation_day = (
           SELECT MAX(observation_day) FROM purchase_metrics WHERE game_id = ?1
         )",
    )?;
    let purchase_metrics: Vec<Value> = pm_stmt
        .query_map([game_id], |r| {
            Ok(json!({
                "observation_day": r.get::<_, String>(0)?,
                "captured_at": r.get::<_, i64>(1)?,
                "metric_slug": r.get::<_, String>(2)?,
                "metric_title": r.get::<_, Option<String>>(3)?,
                "value": r.get::<_, Option<f64>>(4)?,
                "unit": r.get::<_, Option<String>>(5)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut series_stmt = conn.prepare(
        "SELECT series_name, point_x, point_y, observation_day, captured_at
         FROM metric_series
         WHERE game_id = ?1
           AND (?2 = 1 OR point_x BETWEEN ?3 AND ?4)
         ORDER BY series_name, point_x",
    )?;
    let series_rows: Vec<(String, i64, Option<f64>, String, i64)> = series_stmt
        .query_map(params![game_id, chart_all, from_ts, to_ts], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Option<f64>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut best: HashMap<String, (i64, Option<f64>, i64)> = HashMap::new();
    for (name, x, y, _day, captured) in &series_rows {
        let key = format!("{name}|{x}");
        if let Some(prev) = best.get(&key) {
            if *captured <= prev.2 {
                continue;
            }
        }
        best.insert(key, (*x, *y, *captured));
    }
    let mut series_grouped: HashMap<String, Vec<Value>> = HashMap::new();
    for (key, (x, y, _)) in best {
        let name = key.split('|').next().unwrap_or("").to_string();
        series_grouped
            .entry(name)
            .or_default()
            .push(json!({ "x": x, "y": y }));
    }
    for points in series_grouped.values_mut() {
        points.sort_by(|a, b| {
            a.get("x")
                .and_then(|v| v.as_i64())
                .cmp(&b.get("x").and_then(|v| v.as_i64()))
        });
    }

    let earnings = earnings_for_game(conn, game_id, period)?;

    Ok(Some(json!({
        "game": game,
        "period": period,
        "bounds": bounds_value(&bounds),
        "chartBounds": bounds_value(&chart),
        "latest": latest,
        "metricsHistory": metrics_history,
        "geography": geography,
        "platforms": platforms,
        "ratings": ratings,
        "ratingsHistory": ratings_history,
        "reviews": reviews,
        "purchases": purchases,
        "earnings": earnings,
        "seriesGrouped": series_grouped,
        "purchaseMetrics": purchase_metrics
    })))
}

/// Точки ряда за период (один снимок на день).
pub(super) fn series_period_points(
    conn: &Connection,
    game_id: &str,
    series_name: &str,
    from_ts: i64,
    to_ts: i64,
    all: i64,
) -> AppResult<Vec<Value>> {
    let memo = series_memo(conn)?;
    let pts = series_hits(&memo, game_id, series_name);
    Ok(daily_winners(pts, from_ts, to_ts, all == 1)
        .into_iter()
        .map(|p| json!({ "x": p.x, "y": p.y }))
        .collect())
}

/// Дневной доход: сумма рекламы и инапов из metric_series.
pub(super) fn series_earn_points(
    conn: &Connection,
    game_id: &str,
    from_ts: i64,
    to_ts: i64,
    all: i64,
) -> AppResult<Vec<Value>> {
    let memo = series_memo(conn)?;
    let mut acc: BTreeMap<i64, f64> = BTreeMap::new();
    for name in ["purchase_amount: Реклама", "purchase_amount: Инап-покупки"] {
        for point in daily_winners(series_hits(&memo, game_id, name), from_ts, to_ts, all == 1) {
            *acc.entry(point.x).or_insert(0.0) += point.y.unwrap_or(0.0);
        }
    }
    Ok(acc
        .into_iter()
        .map(|(x, y)| json!({ "x": x, "y": y }))
        .collect())
}

/// Среднее или последнее значение ряда метрик за период (как в карточке игры).
pub(super) fn series_period_value(
    conn: &Connection,
    game_id: &str,
    series_name: &str,
    from_ts: i64,
    to_ts: i64,
    all: i64,
    mode: &str,
) -> AppResult<Option<f64>> {
    let memo = series_memo(conn)?;
    let winners = daily_winners(
        series_hits(&memo, game_id, series_name),
        from_ts,
        to_ts,
        all == 1,
    );
    if mode == "last" {
        return Ok(winners.last().and_then(|p| p.y));
    }
    let mut sum = 0.0;
    let mut n = 0.0;
    for point in &winners {
        if let Some(y) = point.y {
            sum += y;
            n += 1.0;
        }
    }
    Ok(if n > 0.0 { Some(sum / n) } else { None })
}

pub fn game_geography(conn: &Connection, game_id: &str) -> AppResult<Value> {
    let day: Option<String> = conn
        .query_row(
            "SELECT observation_day FROM game_metrics WHERE game_id = ?1 ORDER BY captured_at DESC LIMIT 1",
            [game_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(day) = day else {
        return Ok(json!([]));
    };
    let mut stmt = conn.prepare(
        "SELECT country, players FROM game_geography
         WHERE game_id = ?1 AND observation_day = ?2 ORDER BY players DESC",
    )?;
    let rows = stmt
        .query_map(params![game_id, day], |r| {
            Ok(json!({
                "country": r.get::<_, String>(0)?,
                "players": r.get::<_, Option<f64>>(1)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(Value::Array(rows))
}

pub fn game_platforms(conn: &Connection, game_id: &str) -> AppResult<Value> {
    let day: Option<String> = conn
        .query_row(
            "SELECT observation_day FROM game_metrics WHERE game_id = ?1 ORDER BY captured_at DESC LIMIT 1",
            [game_id],
            |r| r.get(0),
        )
        .optional()?;
    let Some(day) = day else {
        return Ok(json!([]));
    };
    let mut stmt = conn.prepare(
        "SELECT platform, players FROM game_platforms
         WHERE game_id = ?1 AND observation_day = ?2 ORDER BY players DESC",
    )?;
    let rows = stmt
        .query_map(params![game_id, day], |r| {
            Ok(json!({
                "platform": r.get::<_, String>(0)?,
                "players": r.get::<_, Option<f64>>(1)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(Value::Array(rows))
}

pub fn game_reviews(conn: &Connection, game_id: &str) -> AppResult<Value> {
    let mut reviews_stmt = conn.prepare(
        "SELECT id, author_name, text, rating, review_time, likes, dislikes, language
         FROM game_reviews WHERE game_id = ?1 ORDER BY review_time DESC LIMIT 100",
    )?;
    let reviews: Vec<Value> = reviews_stmt
        .query_map([game_id], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "author_name": r.get::<_, Option<String>>(1)?,
                "text": r.get::<_, Option<String>>(2)?,
                "rating": r.get::<_, Option<f64>>(3)?,
                "review_time": r.get::<_, Option<i64>>(4)?,
                "likes": r.get::<_, Option<i64>>(5)?,
                "dislikes": r.get::<_, Option<i64>>(6)?,
                "language": r.get::<_, Option<String>>(7)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut ratings_stmt = conn.prepare(
        "SELECT avg_rating, stars_1, stars_2, stars_3, stars_4, stars_5, total, review_count, observation_day
         FROM game_ratings WHERE game_id = ?1
         ORDER BY observation_day DESC, captured_at DESC LIMIT 5",
    )?;
    let ratings: Vec<Value> = ratings_stmt
        .query_map([game_id], |r| {
            Ok(json!({
                "avg_rating": r.get::<_, Option<f64>>(0)?,
                "stars_1": r.get::<_, Option<i64>>(1)?,
                "stars_2": r.get::<_, Option<i64>>(2)?,
                "stars_3": r.get::<_, Option<i64>>(3)?,
                "stars_4": r.get::<_, Option<i64>>(4)?,
                "stars_5": r.get::<_, Option<i64>>(5)?,
                "total": r.get::<_, Option<i64>>(6)?,
                "review_count": r.get::<_, Option<i64>>(7)?,
                "observation_day": r.get::<_, String>(8)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(json!({
        "reviews": reviews,
        "ratings": ratings
    }))
}

pub fn game_purchases_page(conn: &Connection, game_id: &str) -> AppResult<Value> {
    let mut products_stmt = conn.prepare(
        "SELECT product_id, title, price_value, price_code, removed, observation_day
         FROM game_purchases
         WHERE game_id = ?1 AND observation_day = (
           SELECT MAX(observation_day) FROM game_purchases WHERE game_id = ?1
         )
         ORDER BY product_id",
    )?;
    let products: Vec<Value> = products_stmt
        .query_map([game_id], |r| {
            Ok(json!({
                "product_id": r.get::<_, String>(0)?,
                "title": r.get::<_, Option<String>>(1)?,
                "price_value": r.get::<_, Option<f64>>(2)?,
                "price_code": r.get::<_, Option<String>>(3)?,
                "removed": r.get::<_, i64>(4)?,
                "observation_day": r.get::<_, String>(5)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut pm_stmt = conn.prepare(
        "SELECT metric_slug, metric_title, value, unit
         FROM purchase_metrics
         WHERE game_id = ?1 AND observation_day = (
           SELECT MAX(observation_day) FROM purchase_metrics WHERE game_id = ?1
         )",
    )?;
    let metrics: Vec<Value> = pm_stmt
        .query_map([game_id], |r| {
            Ok(json!({
                "metric_slug": r.get::<_, String>(0)?,
                "metric_title": r.get::<_, Option<String>>(1)?,
                "value": r.get::<_, Option<f64>>(2)?,
                "unit": r.get::<_, Option<String>>(3)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(json!({
        "products": products,
        "metrics": metrics
    }))
}

