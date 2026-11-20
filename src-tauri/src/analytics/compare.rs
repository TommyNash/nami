//! Сравнение нескольких игр.
use super::*;
use super::game::{earnings_for_game, series_earn_points, series_period_points, series_period_value};

pub fn compare_games(conn: &Connection, game_ids: &[String], period: &str) -> AppResult<Value> {
    // Без жёсткого UX-лимита: таблица скроллится горизонтально.
    // Верхняя граница только от перегрузки IPC/SQLite на одном запросе.
    let ids: Vec<_> = game_ids.iter().map(|s| s.as_str()).take(40).collect();
    let bounds = period_bounds(period);
    let chart = series_bounds(period);
    let chart_all = if period == "all" { 1i64 } else { 0 };
    let from_ts = day_start_ms(&chart.from_day);
    let to_ts = day_end_ms(&chart.to_day);
    let day_count = days_between(
        parse_ymd(&bounds.from_day).unwrap_or_else(today),
        parse_ymd(&bounds.to_day).unwrap_or_else(today),
    )
    .max(1) as f64;

    if ids.is_empty() {
        return Ok(json!({
            "period": period,
            "bounds": bounds_value(&bounds),
            "games": []
        }));
    }

    let player_stats = period_player_stats(conn, &bounds.from_day, &bounds.to_day)?;

    let mut games = Vec::new();
    for id in ids {
        let row = conn
            .query_row(
                "SELECT g.id, g.title, g.icon_url, g.status,
                        m.players, m.play_time_per_player, m.game_ready, m.rating_ru, m.rating_world
                 FROM games g
                 LEFT JOIN game_metrics m ON m.game_id = g.id AND m.observation_day = (
                   SELECT MAX(observation_day) FROM game_metrics
                   WHERE game_id = g.id AND observation_day <= ?2
                 )
                 WHERE g.id = ?1",
                params![id, bounds.to_day],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<String>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<f64>>(4)?,
                        r.get::<_, Option<f64>>(5)?,
                        r.get::<_, Option<f64>>(6)?,
                        r.get::<_, Option<f64>>(7)?,
                        r.get::<_, Option<f64>>(8)?,
                    ))
                },
            )
            .optional()?;

        let Some((
            gid,
            title,
            icon_url,
            status,
            latest_players,
            panel_play,
            panel_ready,
            panel_rating_ru,
            panel_rating_world,
        )) = row
        else {
            continue;
        };

        let players = player_stats
            .get(&gid)
            .map(|(avg, _)| *avg)
            .or(latest_players);

        // Ряды метрик надёжнее снимка панели: play/ready/rating часто есть только там.
        let play_time = series_period_value(
            conn,
            &gid,
            "play_time_for_player: Всего",
            from_ts,
            to_ts,
            chart_all,
            "avg",
        )?
        .or(panel_play);
        let game_ready = series_period_value(
            conn,
            &gid,
            "game_ready_api: p50",
            from_ts,
            to_ts,
            chart_all,
            "avg",
        )?
        .or(panel_ready);
        let rating_ru = series_period_value(
            conn,
            &gid,
            "rating: Россия и СНГ",
            from_ts,
            to_ts,
            chart_all,
            "last",
        )?
        .or(panel_rating_ru);
        let rating_world = series_period_value(
            conn,
            &gid,
            "rating: Остальной мир",
            from_ts,
            to_ts,
            chart_all,
            "last",
        )?
        .or(panel_rating_world);

        let earn_rows = earnings_for_game(conn, &gid, period)?;
        let earn: f64 = earn_rows
            .iter()
            .filter_map(|r| r.get("earn").and_then(|v| v.as_f64()))
            .sum();
        let earn_opt = if earn.abs() > 1e-9 { Some(earn) } else { None };
        let earn_per_day = earn_opt.map(|e| e / day_count);
        // Наш расчёт: доход периода ÷ средние игроки в день.
        let earn_per_player = match (earn_opt, players) {
            (Some(e), Some(p)) if p > 0.0 => Some(e / p),
            _ => None,
        };
        // ARPDAU — эталон Яндекса из metric_series.
        let arpdau = series_period_value(
            conn,
            &gid,
            "arpu: ARPDAU",
            from_ts,
            to_ts,
            chart_all,
            "avg",
        )?;

        let players_series =
            series_period_points(conn, &gid, "players: Всего", from_ts, to_ts, chart_all)?;
        let play_series = series_period_points(
            conn,
            &gid,
            "play_time_for_player: Всего",
            from_ts,
            to_ts,
            chart_all,
        )?;
        let ready_series =
            series_period_points(conn, &gid, "game_ready_api: p50", from_ts, to_ts, chart_all)?;
        let rating_ru_series = series_period_points(
            conn,
            &gid,
            "rating: Россия и СНГ",
            from_ts,
            to_ts,
            chart_all,
        )?;
        let rating_world_series = series_period_points(
            conn,
            &gid,
            "rating: Остальной мир",
            from_ts,
            to_ts,
            chart_all,
        )?;
        let earn_series = series_earn_points(conn, &gid, from_ts, to_ts, chart_all)?;
        let arpdau_series =
            series_period_points(conn, &gid, "arpu: ARPDAU", from_ts, to_ts, chart_all)?;

        games.push(json!({
            "id": gid,
            "title": title,
            "icon_url": icon_url,
            "status": status,
            "players": players,
            "play_time_per_player": play_time,
            "game_ready": game_ready,
            "rating_ru": rating_ru,
            "rating_world": rating_world,
            "earn": earn_opt,
            "earn_per_day": earn_per_day,
            "earn_per_player": earn_per_player,
            "arpdau": arpdau,
            "players_series": players_series.clone(),
            "series": {
                "players": players_series,
                "play_time": play_series,
                "game_ready": ready_series,
                "rating_ru": rating_ru_series,
                "rating_world": rating_world_series,
                "earn": earn_series,
                "arpdau": arpdau_series
            }
        }));
    }

    Ok(json!({
        "period": period,
        "bounds": bounds_value(&bounds),
        "games": games
    }))
}

