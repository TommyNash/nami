//! Список игр, KPI и экран «Игры».
use super::*;
use super::memo::{series_memo, earn_stats_through, select_earnings, earn_in_range, sample_ys, daily_slice};

pub(super) fn period_player_stats(
    conn: &Connection,
    from_day: &str,
    to_day: &str,
) -> AppResult<HashMap<String, (f64, f64)>> {
    let memo = series_memo(conn)?;
    let mut map = HashMap::new();
    for (id, series) in &memo.daily {
        if !memo.published.contains(id) {
            continue;
        }
        let Some(pts) = series.get("players: Всего") else {
            continue;
        };
        let mut sum = 0.0;
        let mut n = 0.0;
        for point in daily_slice(pts, from_day, to_day) {
            let Some(y) = point.y else { continue };
            if y > 0.0 {
                sum += y;
                n += 1.0;
            }
        }
        if n > 0.0 {
            map.insert(id.clone(), (sum / n, sum));
        }
    }
    Ok(map)
}

pub(super) fn period_player_avgs(conn: &Connection, from_day: &str, to_day: &str) -> AppResult<HashMap<String, f64>> {
    Ok(period_player_stats(conn, from_day, to_day)?
        .into_iter()
        .map(|(id, (avg, _))| (id, avg))
        .collect())
}

/// Дневные ряды за период для мини-графиков в таблице (игроки и доход).
pub(super) fn period_sparkline_series(
    conn: &Connection,
    from_day: &str,
    to_day: &str,
) -> AppResult<(HashMap<String, Vec<f64>>, HashMap<String, Vec<f64>>)> {
    let memo = series_memo(conn)?;
    let mut players: HashMap<String, Vec<f64>> = HashMap::new();
    let mut earn: HashMap<String, Vec<f64>> = HashMap::new();
    for (id, series) in &memo.daily {
        if !memo.published.contains(id) {
            continue;
        }
        if let Some(pts) = series.get("players: Всего") {
            let slice = daily_slice(pts, from_day, to_day);
            if !slice.is_empty() {
                let ys: Vec<f64> = slice.iter().map(|p| p.y.unwrap_or(0.0)).collect();
                players.insert(id.clone(), sample_ys(&ys));
            }
        }
        let mut by_ord: BTreeMap<i32, f64> = BTreeMap::new();
        for name in ["purchase_amount: Реклама", "purchase_amount: Инап-покупки"] {
            let Some(pts) = series.get(name) else { continue };
            for point in daily_slice(pts, from_day, to_day) {
                *by_ord.entry(point.ord).or_insert(0.0) += point.y.unwrap_or(0.0);
            }
        }
        if !by_ord.is_empty() {
            let ys: Vec<f64> = by_ord.into_values().collect();
            earn.insert(id.clone(), sample_ys(&ys));
        }
    }
    Ok((players, earn))
}

pub fn list_games(conn: &Connection, period: &str, account_id: Option<&str>) -> AppResult<Value> {
    let bounds = period_bounds(period);
    let earn_rows = load_earnings_for(conn, account_id)?;

    // Для «дня» и «недели» точного бакета почти никогда нет: коллектор запрашивает
    // окно в момент сбора, а границы периода сдвигаются каждый день. Поэтому
    // считаем через earn_in_range — он берёт точный бакет, покрывающий месячный
    // и пропорционально режет месячные/MTD данные.
    let prorated = period == "day" || period == "week";
    let mut earn_by: HashMap<String, f64> = HashMap::new();
    let mut exact_by: HashMap<String, f64> = HashMap::new();

    if prorated {
        let through = earn_stats_through(&earn_rows);
        earn_by = earn_in_range(&earn_rows, &bounds.from_day, &bounds.to_day, through.as_deref());
        for row in &earn_rows {
            if row.1 == bounds.from_day && row.2 == bounds.to_day {
                if let Some(v) = row.3.filter(|v| v.abs() > 1e-9) {
                    exact_by.insert(row.0.clone(), v);
                }
            }
        }
    } else {
        for row in select_earnings(&earn_rows, period, &bounds) {
            *earn_by.entry(row.0).or_insert(0.0) += row.3.unwrap_or(0.0);
        }
    }

    // Metrics as of period end (not the absolute latest snapshot).
    let mut metrics_stmt = conn.prepare(
        "SELECT m.game_id, m.players, m.rating_ru, m.play_time_per_player, m.game_ready, m.observation_day
         FROM game_metrics m
         INNER JOIN (
           SELECT game_id, MAX(observation_day) AS day
           FROM game_metrics
           WHERE observation_day <= ?1
           GROUP BY game_id
         ) t ON t.game_id = m.game_id AND t.day = m.observation_day",
    )?;
    let mut metrics_by: HashMap<String, (Option<f64>, Option<f64>, Option<f64>, Option<f64>, String)> =
        HashMap::new();
    for row in metrics_stmt.query_map([&bounds.to_day], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<f64>>(1)?,
            r.get::<_, Option<f64>>(2)?,
            r.get::<_, Option<f64>>(3)?,
            r.get::<_, Option<f64>>(4)?,
            r.get::<_, String>(5)?,
        ))
    })? {
        if let Ok((id, players, rating, play_time, ready, day)) = row {
            metrics_by.insert(id, (players, rating, play_time, ready, day));
        }
    }

    let player_stats = period_player_stats(conn, &bounds.from_day, &bounds.to_day)?;
    let (spark_players, spark_earn) = period_sparkline_series(conn, &bounds.from_day, &bounds.to_day)?;

    let aid = account_id_opt(account_id);
    let mut out = Vec::new();
    if let Some(aid) = aid {
        let mut stmt = conn.prepare(
            "SELECT g.id, g.title, g.status, g.icon_url, g.last_seen_at
             FROM games g
             WHERE g.owner_id = ?1
             ORDER BY g.last_seen_at DESC",
        )?;
        let rows = stmt.query_map([aid], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })?;
        push_game_rows(
            &mut out,
            rows,
            &earn_by,
            &exact_by,
            &player_stats,
            &metrics_by,
            &spark_players,
            &spark_earn,
            &bounds,
            prorated,
        );
    } else {
        let mut stmt = conn.prepare(
            "SELECT g.id, g.title, g.status, g.icon_url, g.last_seen_at
             FROM games g
             ORDER BY g.last_seen_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<String>>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })?;
        push_game_rows(
            &mut out,
            rows,
            &earn_by,
            &exact_by,
            &player_stats,
            &metrics_by,
            &spark_players,
            &spark_earn,
            &bounds,
            prorated,
        );
    }
    Ok(Value::Array(out))
}

fn push_game_rows<I>(
    out: &mut Vec<Value>,
    rows: I,
    earn_by: &HashMap<String, f64>,
    exact_by: &HashMap<String, f64>,
    player_stats: &HashMap<String, (f64, f64)>,
    metrics_by: &HashMap<String, (Option<f64>, Option<f64>, Option<f64>, Option<f64>, String)>,
    spark_players: &HashMap<String, Vec<f64>>,
    spark_earn: &HashMap<String, Vec<f64>>,
    bounds: &PeriodBounds,
    prorated: bool,
) where
    I: Iterator<
        Item = Result<(String, Option<String>, Option<String>, Option<String>, i64), rusqlite::Error>,
    >,
{
    for row in rows.flatten() {
        let id = row.0;
        let earn = earn_by.get(&id).copied();
        let (period_players, period_players_sum) = match player_stats.get(&id) {
            Some((avg, sum)) => (Some(*avg), Some(*sum)),
            None => (None, None),
        };
        let m = metrics_by.get(&id);
        let estimated = prorated && earn.is_some() && !exact_by.contains_key(&id);
        let spark_p = spark_players.get(&id).cloned().unwrap_or_default();
        let spark_e = spark_earn.get(&id).cloned().unwrap_or_default();
        out.push(json!({
            "id": id,
            "title": row.1,
            "status": row.2,
            "icon_url": row.3,
            "last_seen_at": row.4,
            "latest_players": m.and_then(|x| x.0),
            "period_players": period_players,
            "period_players_sum": period_players_sum,
            "spark_players": spark_p,
            "spark_earn": spark_e,
            "latest_rating_ru": m.and_then(|x| x.1),
            "latest_play_time": m.and_then(|x| x.2),
            "latest_game_ready": m.and_then(|x| x.3),
            "metrics_day": m.map(|x| x.4.clone()),
            "period_earn": earn,
            "period_earn_estimated": estimated,
            "latest_earn": earn,
            "period_bounds": {
                "fromDay": bounds.from_day,
                "toDay": bounds.to_day
            }
        }));
    }
}

pub fn analytics_overview(
    conn: &Connection,
    period: &str,
    account_id: Option<&str>,
) -> AppResult<Value> {
    let games = list_games(conn, period, account_id)?;
    analytics_overview_with(conn, period, account_id, &games)
}

pub fn analytics_overview_with(
    conn: &Connection,
    period: &str,
    account_id: Option<&str>,
    games: &Value,
) -> AppResult<Value> {
    let bounds = period_bounds(period);
    let arr = games.as_array().cloned().unwrap_or_default();
    let mut players = 0.0;
    let mut play_time = 0.0;
    let mut play_n = 0;
    let mut earn = 0.0;
    let mut estimated = false;
    let mut metrics_day: Option<String> = None;
    let mut metrics_days_with_data = 0i64;
    for g in &arr {
        // KPI портфеля — только опубликованные; черновики без статистики не считаем.
        if !is_published_status(g.get("status").and_then(|v| v.as_str())) {
            continue;
        }
        if let Some(p) = g.get("latest_players").and_then(|v| v.as_f64()) {
            players += p;
        }
        if let Some(pt) = g.get("latest_play_time").and_then(|v| v.as_f64()) {
            play_time += pt;
            play_n += 1;
        }
        if let Some(e) = g.get("period_earn").and_then(|v| v.as_f64()) {
            earn += e;
        }
        if g.get("period_earn_estimated").and_then(|v| v.as_bool()) == Some(true) {
            estimated = true;
        }
        if let Some(day) = g.get("metrics_day").and_then(|v| v.as_str()) {
            metrics_days_with_data += 1;
            if metrics_day.as_deref().map(|d| day > d).unwrap_or(true) {
                metrics_day = Some(day.to_string());
            }
        }
    }

    // Игроки по дням внутри периода: «Игроки в день» — среднее по полным срезам
    // опубликованных игр. Черновики не должны раздувать знаменатель «из N игр».
    let aid = account_id_opt(account_id);
    let mut daily: Vec<Value> = if let Some(aid) = aid {
        let mut daily_stmt = conn.prepare(
            "SELECT m.observation_day, COUNT(*), COALESCE(SUM(m.players),0)
             FROM game_metrics m
             INNER JOIN games g ON g.id = m.game_id AND g.status = 'published'
             WHERE m.observation_day BETWEEN ?1 AND ?2 AND g.owner_id = ?3
             GROUP BY m.observation_day
             ORDER BY m.observation_day ASC",
        )?;
        let rows: Vec<Value> = daily_stmt
            .query_map(params![&bounds.from_day, &bounds.to_day, aid], |r| {
                Ok(json!({
                    "day": r.get::<_, String>(0)?,
                    "games": r.get::<_, i64>(1)?,
                    "players": r.get::<_, f64>(2)?
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();
        rows
    } else {
        let mut daily_stmt = conn.prepare(
            "SELECT m.observation_day, COUNT(*), COALESCE(SUM(m.players),0)
             FROM game_metrics m
             INNER JOIN games g ON g.id = m.game_id AND g.status = 'published'
             WHERE m.observation_day BETWEEN ?1 AND ?2
             GROUP BY m.observation_day
             ORDER BY m.observation_day ASC",
        )?;
        let rows: Vec<Value> = daily_stmt
            .query_map(params![&bounds.from_day, &bounds.to_day], |r| {
                Ok(json!({
                    "day": r.get::<_, String>(0)?,
                    "games": r.get::<_, i64>(1)?,
                    "players": r.get::<_, f64>(2)?
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    let max_games_in_day = daily
        .iter()
        .filter_map(|d| d.get("games").and_then(|v| v.as_i64()))
        .max()
        .unwrap_or(0);
    // Порог полного среза — от числа опубликованных игр со статистикой,
    // а не от исторического максимума, куда попадали черновики.
    let eligible_games = published_tracked_count(conn, account_id).max(max_games_in_day);
    let full_threshold = ((eligible_games.max(1) as f64) * 0.9).ceil() as i64;

    let full_days: Vec<&Value> = daily
        .iter()
        .filter(|d| {
            let games = d.get("games").and_then(|v| v.as_i64()).unwrap_or(0);
            let players = d.get("players").and_then(|v| v.as_f64()).unwrap_or(0.0);
            games >= full_threshold && players > 0.0
        })
        .collect();

    let players_avg = if full_days.is_empty() {
        None
    } else {
        let sum: f64 = full_days
            .iter()
            .map(|d| d.get("players").and_then(|v| v.as_f64()).unwrap_or(0.0))
            .sum();
        Some(sum / full_days.len() as f64)
    };
    let full_day_name = full_days
        .last()
        .and_then(|d| d.get("day").and_then(|v| v.as_str()))
        .map(|s| s.to_string());
    let full_day_games = full_days
        .last()
        .and_then(|d| d.get("games").and_then(|v| v.as_i64()))
        .unwrap_or(0);

    let lag_days = full_day_name
        .as_deref()
        .and_then(parse_ymd)
        .map(|d| (parse_ymd(&bounds.to_day).unwrap_or(d) - d).num_days())
        .unwrap_or(-1);

    // В json нельзя сослаться на daily после заимствования — сортируем по дню.
    daily.sort_by(|a, b| {
        a.get("day")
            .and_then(|v| v.as_str())
            .cmp(&b.get("day").and_then(|v| v.as_str()))
    });

    Ok(json!({
        "period": period,
        "bounds": {
            "fromDay": bounds.from_day,
            "toDay": bounds.to_day
        },
        "games": arr.len(),
        "players": players,
        "playersAvg": players_avg,
        "playersDaily": daily,
        "playersDay": full_day_name,
        "playersDayGames": full_day_games,
        "playersDayLag": lag_days.max(0),
        "gamesWithMetrics": metrics_days_with_data,
        "avgPlayTime": if play_n > 0 { Some(play_time / play_n as f64) } else { None },
        "earnings": { "earn": earn, "estimated": estimated }
    }))
}

/// Список, KPI, покрытие и месяцы. Не зависят от режима сравнения карты,
/// поэтому кэшируются отдельно: смена «к прошлому месяцу / 7 дн.» не
/// пересчитывает портфель.
pub fn games_portfolio(
    conn: &Connection,
    period: &str,
    account_id: Option<&str>,
) -> AppResult<Value> {
    let games = list_games(conn, period, account_id)?;
    let overview = analytics_overview_with(conn, period, account_id, &games)?;
    let coverage = data_coverage(conn, period, account_id)?;
    let months = list_earn_months(conn, account_id)?;
    Ok(json!({
        "period": period,
        "accountId": account_id,
        "games": games,
        "overview": overview,
        "coverage": coverage,
        "months": months
    }))
}

/// Один проход для экрана «Игры»: список, KPI, карта, покрытие и месяцы.
/// Раньше UI звал это четырьмя командами, и каждая заново читала доходы.
pub fn games_screen(
    conn: &Connection,
    period: &str,
    compare_mode: &str,
    account_id: Option<&str>,
) -> AppResult<Value> {
    let _span = tracing::info_span!(
        "games_screen",
        period = period,
        compare = compare_mode
    )
    .entered();
    let portfolio = {
        let _p = tracing::info_span!("portfolio").entered();
        games_portfolio(conn, period, account_id)?
    };
    let heatmap = {
        let _h = tracing::info_span!("heatmap").entered();
        games_heatmap_with(
            conn,
            period,
            compare_mode,
            account_id,
            portfolio.get("games"),
        )?
    };
    Ok(json!({
        "period": period,
        "heatCompare": compare_mode,
        "accountId": account_id,
        "games": portfolio.get("games").cloned().unwrap_or(json!([])),
        "overview": portfolio.get("overview").cloned().unwrap_or(Value::Null),
        "heatmap": heatmap,
        "coverage": portfolio.get("coverage").cloned().unwrap_or(Value::Null),
        "months": portfolio.get("months").cloned().unwrap_or(json!([]))
    }))
}
