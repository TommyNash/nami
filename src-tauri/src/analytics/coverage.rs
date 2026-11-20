//! Покрытие данными и дневные свечи.
use super::*;
use super::memo::{series_memo, earn_stats_through, ord_ymd};

pub(super) fn players_series_days(conn: &Connection, account_id: Option<&str>) -> AppResult<Vec<Value>> {
    let memo = series_memo(conn)?;
    let allow = account_game_ids(conn, account_id)?;
    let mut days: BTreeMap<i32, (f64, i64, i64)> = BTreeMap::new();
    for (id, series) in &memo.daily {
        if !memo.published.contains(id) {
            continue;
        }
        if let Some(set) = &allow {
            if !set.contains(id) {
                continue;
            }
        }
        let Some(pts) = series.get("players: Всего") else {
            continue;
        };
        for point in pts {
            let entry = days.entry(point.ord).or_insert((0.0, 0, 0));
            entry.2 += 1;
            if point.y.unwrap_or(0.0) > 0.0 {
                entry.0 += point.y.unwrap_or(0.0);
                entry.1 += 1;
            }
        }
    }
    Ok(days
        .into_iter()
        .map(|(ord, (players, with_value, games))| {
            json!({
                "day": ord_ymd(ord),
                "players": players,
                "gamesWithValue": with_value,
                "games": games,
                "source": "series"
            })
        })
        .collect())
}

/// Дневной доход из рядов «Реклама» + «Инап-покупки».
/// У Яндекса за прошлые месяцы часто есть только один бакет на месяц,
/// а по дням сумма лежит в metric_series — её и показываем на свечах.
pub(super) fn earn_series_days(conn: &Connection, account_id: Option<&str>) -> AppResult<Vec<Value>> {
    let memo = series_memo(conn)?;
    let allow = account_game_ids(conn, account_id)?;
    let mut days: BTreeMap<i32, (f64, i64, i64)> = BTreeMap::new();
    for (id, series) in &memo.daily {
        if !memo.published.contains(id) {
            continue;
        }
        if let Some(set) = &allow {
            if !set.contains(id) {
                continue;
            }
        }
        let mut seen: BTreeMap<i32, (f64, bool)> = BTreeMap::new();
        for name in ["purchase_amount: Реклама", "purchase_amount: Инап-покупки"] {
            let Some(pts) = series.get(name) else { continue };
            for point in pts {
                let entry = seen.entry(point.ord).or_insert((0.0, false));
                if point.y.unwrap_or(0.0) > 0.0 {
                    entry.0 += point.y.unwrap_or(0.0);
                    entry.1 = true;
                }
            }
        }
        for (ord, (sum, has_pos)) in seen {
            let entry = days.entry(ord).or_insert((0.0, 0, 0));
            entry.0 += sum;
            entry.2 += 1;
            if has_pos {
                entry.1 += 1;
            }
        }
    }
    Ok(days
        .into_iter()
        .map(|(ord, (earn, with_value, games))| {
            json!({
                "day": ord_ymd(ord),
                "earn": earn,
                "gamesWithValue": with_value,
                "games": games,
                "source": "series"
            })
        })
        .collect())
}

pub fn data_coverage(conn: &Connection, period: &str, account_id: Option<&str>) -> AppResult<Value> {
    let bounds = period_bounds(period);
    let aid = account_id_opt(account_id);

    let panel_days: Vec<Value> = if let Some(aid) = aid {
        let mut metrics_stmt = conn.prepare(
            "SELECT m.observation_day, COUNT(*), COALESCE(SUM(m.players),0)
             FROM game_metrics m
             INNER JOIN games g ON g.id = m.game_id AND g.status = 'published' AND g.owner_id = ?1
             GROUP BY m.observation_day
             ORDER BY m.observation_day ASC",
        )?;
        let rows: Vec<Value> = metrics_stmt
            .query_map([aid], |r| {
                Ok(json!({
                    "day": r.get::<_, String>(0)?,
                    "games": r.get::<_, i64>(1)?,
                    "players": r.get::<_, f64>(2)?,
                    "source": "panel"
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();
        rows
    } else {
        let mut metrics_stmt = conn.prepare(
            "SELECT m.observation_day, COUNT(*), COALESCE(SUM(m.players),0)
             FROM game_metrics m
             INNER JOIN games g ON g.id = m.game_id AND g.status = 'published'
             GROUP BY m.observation_day
             ORDER BY m.observation_day ASC",
        )?;
        let rows: Vec<Value> = metrics_stmt
            .query_map([], |r| {
                Ok(json!({
                    "day": r.get::<_, String>(0)?,
                    "games": r.get::<_, i64>(1)?,
                    "players": r.get::<_, f64>(2)?,
                    "source": "panel"
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    // Ряд аналитики покрывает историю дней; панель — только дни запуска сборщика.
    // Для свечей предпочитаем ряд, панель оставляем как запасной источник.
    let series_days = players_series_days(conn, account_id)?;
    let metrics_days = if series_days.is_empty() {
        panel_days.clone()
    } else {
        series_days.clone()
    };
    let eligible_games = published_tracked_count(conn, account_id);

    // Доходы по дням: суммируем реальные значения по играм, ничего не делим.
    // Ключ — бакет (from,to); суммы берём из дедуплицированных строк, иначе
    // повторные снимки одного диапазона удваивали доход.
    let earn_rows = load_earnings_for(conn, account_id)?;
    let mut bucket_sums: HashMap<(String, String), (f64, i64, i64, Option<String>)> =
        HashMap::new();
    // (earn_sum, games_with_value, games_total, max observation_day)
    for row in &earn_rows {
        let key = (row.1.clone(), row.2.clone());
        let entry = bucket_sums.entry(key).or_insert((0.0, 0, 0, None));
        entry.2 += 1;
        if let Some(v) = row.3 {
            if v.abs() > 1e-9 {
                entry.0 += v;
                entry.1 += 1;
            }
        }
        let day = if row.5.is_empty() { None } else { Some(row.5.clone()) };
        if let Some(d) = day {
            if entry.3.as_deref().map(|prev| d > prev.to_string()).unwrap_or(true) {
                entry.3 = Some(d);
            }
        }
    }

    let mut earn_buckets: Vec<Value> = bucket_sums
        .into_iter()
        .map(|((from, to), (earn, with_value, games, observed))| {
            let kind = if is_monthly_bucket(&from, &to) {
                "month"
            } else if earn_span_days(&from, &to) <= 1 {
                "day"
            } else {
                "range"
            };
            json!({
                "from": from,
                "to": to,
                "games": games,
                "gamesWithValue": with_value,
                "earn": earn,
                // false = Яндекс ещё не посчитал доход за этот бакет
                "hasValue": with_value > 0,
                "collectedDay": observed,
                "kind": kind
            })
        })
        .collect();
    earn_buckets.sort_by(|a, b| {
        a.get("from")
            .and_then(|v| v.as_str())
            .cmp(&b.get("from").and_then(|v| v.as_str()))
    });

    let latest_metrics = metrics_days
        .last()
        .and_then(|v| v.get("day").and_then(|d| d.as_str()))
        .map(|s| s.to_string());

    // «Полный» день: ≥90 % опубликованных игр со статистикой.
    let max_games = metrics_days
        .iter()
        .filter_map(|d| d.get("games").and_then(|v| v.as_i64()))
        .max()
        .unwrap_or(0);
    let universe = eligible_games.max(max_games).max(1);
    let full_threshold = ((universe as f64) * 0.9).ceil() as i64;
    let full_metrics = metrics_days
        .iter()
        .filter(|d| d.get("games").and_then(|v| v.as_i64()).unwrap_or(0) >= full_threshold.max(1))
        .filter_map(|d| d.get("day").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .max();

    let stats_earn_through = earn_stats_through(&earn_rows);

    let lag_days = full_metrics
        .as_deref()
        .and_then(parse_ymd)
        .map(|d| (today() - d).num_days())
        .unwrap_or(-1);
    let earn_lag_days = stats_earn_through
        .as_deref()
        .and_then(parse_ymd)
        .map(|d| (today() - d).num_days())
        .unwrap_or(-1);

    Ok(json!({
        "period": period,
        "today": ymd(today()),
        "bounds": { "fromDay": bounds.from_day, "toDay": bounds.to_day },
        "metricsDays": metrics_days,
        "panelDays": panel_days,
        "playersSeriesDays": series_days,
        "earnSeriesDays": earn_series_days(conn, account_id)?,
        "earnBuckets": earn_buckets,
        "eligibleGames": eligible_games,
        "latestMetricsDay": latest_metrics,
        "fullMetricsDay": full_metrics,
        "fullMetricsDayGames": universe,
        "latestMetricsLagDays": lag_days.max(0),
        "earnStatsThrough": stats_earn_through,
        "earnLagDays": earn_lag_days.max(0),
        // Яндекс отдаёт статистику не сразу: свежие дни могут быть пустыми.
        "expectedLagDays": 3
    }))
}

