//! Нормализация сырых ответов консоли Яндекс Игр в аналитические таблицы.
//!
//! Раньше ingest только складывал raw_responses: новые ответы никогда не
//! попадали в game_metrics/game_earnings, поэтому метрики «не обновлялись».
//! Нормализатор ответов Яндекса (перенесён с прежнего Electron-бэкенда на Rust).

use crate::error::AppResult;
use chrono::{Datelike, Local, NaiveDate, TimeZone, Utc};
use rusqlite::Connection;
use serde_json::{Map, Value};

fn now_day(captured_at_ms: i64) -> String {
    match Utc.timestamp_millis_opt(captured_at_ms).single() {
        Some(dt) => dt.with_timezone(&Local).date_naive().to_string(),
        None => Local::now().date_naive().to_string(),
    }
}

fn num(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().replace(',', ".").parse::<f64>().ok(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

fn localized(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(s) => Some(s.clone()),
        Value::Object(map) => {
            for key in ["ru", "en"] {
                if let Some(Value::String(s)) = map.get(key) {
                    if !s.is_empty() {
                        return Some(s.clone());
                    }
                }
            }
            map.values().find_map(|v| v.as_str().map(|s| s.to_string()))
        }
        _ => None,
    }
}

fn version_of(item: &Map<String, Value>) -> Option<&Map<String, Value>> {
    item.get("published-version")
        .or_else(|| item.get("published_version"))
        .and_then(|v| v.as_object())
        .or_else(|| item.get("draft").and_then(|v| v.as_object()))
}

fn game_status(item: &Map<String, Value>) -> Option<String> {
    let version = version_of(item);
    let from = |v: Option<&Map<String, Value>>| -> Option<String> {
        let v = v?;
        if let Some(s) = v.get("status").and_then(|s| s.as_object()) {
            if let Some(st) = s.get("state").and_then(|x| x.as_str()) {
                return Some(st.to_string());
            }
        }
        None
    };
    from(version)
        .or_else(|| {
            item.get("status")
                .and_then(|s| s.as_object())
                .and_then(|s| s.get("state"))
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
        })
        .or_else(|| item.get("status").and_then(|s| s.as_str()).map(|s| s.to_string()))
}

fn game_icon(item: &Map<String, Value>) -> Option<String> {
    let version = version_of(item)?;
    let icon = version.get("icon")?;
    // icon бывает строкой, {ru: "url"}, {ru: {url}}, {prefix-url}
    match icon {
        Value::String(s) => Some(s.clone()),
        Value::Object(map) => {
            if let Some(Value::String(url)) = map.get("url") {
                return Some(url.clone());
            }
            if let Some(Value::String(prefix)) = map.get("prefix-url") {
                return Some(format!("{prefix}icon1"));
            }
            let pick = ["ru", "en"]
                .iter()
                .find_map(|k| map.get(*k))
                .or_else(|| map.values().next())?;
            match pick {
                Value::String(s) => Some(s.clone()),
                Value::Object(o) => o
                    .get("url")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| {
                        o.get("prefix-url")
                            .and_then(|v| v.as_str())
                            .map(|p| format!("{p}icon1"))
                    }),
                _ => None,
            }
        }
        _ => None,
    }
}

fn owner_fields(obj: &Map<String, Value>) -> Option<(String, Option<String>, Option<String>)> {
    let owner = obj.get("owner")?.as_object()?;
    let id = match owner.get("id") {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        _ => return None,
    };
    if id.is_empty() {
        return None;
    }
    let title = owner
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let login = owner
        .get("login")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    Some((id, title, login))
}

fn upsert_account(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    login: Option<&str>,
    now: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO accounts (id, title, login, avatar_url, last_seen_at, created_at)
         VALUES (?1, ?2, ?3, NULL, ?4, ?4)
         ON CONFLICT(id) DO UPDATE SET
           title = COALESCE(excluded.title, accounts.title),
           login = COALESCE(excluded.login, accounts.login),
           last_seen_at = excluded.last_seen_at",
        rusqlite::params![id, title, login, now],
    )?;
    Ok(())
}

fn upsert_game(
    conn: &Connection,
    id: &str,
    title: Option<&str>,
    title_json: Option<String>,
    status: Option<&str>,
    icon: Option<&str>,
    owner_id: Option<&str>,
    now: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO games (id, title, title_json, status, icon_url, owner_id, first_seen_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(id) DO UPDATE SET
           title = COALESCE(excluded.title, games.title),
           title_json = COALESCE(excluded.title_json, games.title_json),
           status = COALESCE(excluded.status, games.status),
           icon_url = COALESCE(excluded.icon_url, games.icon_url),
           owner_id = COALESCE(excluded.owner_id, games.owner_id),
           last_seen_at = excluded.last_seen_at",
        rusqlite::params![id, title, title_json, status, icon, owner_id, now],
    )?;
    Ok(())
}

fn panel_widget<'a>(body: &'a Value, id: &str) -> Option<&'a Map<String, Value>> {
    body.get("widgets")?
        .get("items")?
        .as_array()?
        .iter()
        .filter_map(|w| w.as_object())
        .find(|w| w.get("id").and_then(|v| v.as_str()) == Some(id))
}

fn widget_first_value(widget: Option<&Map<String, Value>>) -> Option<f64> {
    num(widget?.get("items")?.as_array()?.first()?.get("value"))
}

fn widget_difference(widget: Option<&Map<String, Value>>) -> Option<f64> {
    widget?
        .get("items")?
        .as_array()?
        .iter()
        .filter_map(|i| i.as_object())
        .find(|i| i.get("type").and_then(|v| v.as_str()) == Some("difference"))
        .and_then(|i| num(i.get("value")))
}

fn pie_points<'a>(body: &'a Value, id: &str) -> Vec<(String, Option<f64>)> {
    let pie = body
        .get("pieCharts")
        .and_then(|p| p.get("items"))
        .and_then(|i| i.as_array())
        .and_then(|arr| {
            arr.iter()
                .filter_map(|p| p.as_object())
                .find(|p| p.get("id").and_then(|v| v.as_str()) == Some(id))
        });
    let Some(pie) = pie else { return Vec::new() };
    pie.get("data")
        .and_then(|d| d.get("options"))
        .and_then(|o| o.get("series"))
        .and_then(|s| s.as_array())
        .and_then(|s| s.first())
        .and_then(|s| s.get("data"))
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| p.as_object())
                .filter_map(|p| {
                    let name = p.get("name").and_then(|v| v.as_str())?.to_string();
                    Some((name, num(p.get("y"))))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn normalize_panel(conn: &Connection, game_id: &str, body: &Value, day: &str, captured: i64, raw_id: i64) -> AppResult<bool> {
    let players = widget_first_value(panel_widget(body, "players"));
    let play_time = widget_first_value(panel_widget(body, "play_time_for_player"));
    let ready = widget_first_value(panel_widget(body, "game_ready_api"));
    let ready_delta = widget_difference(panel_widget(body, "game_ready_api"));

    let rating_widget = panel_widget(body, "rating");
    let rating_items = rating_widget
        .and_then(|w| w.get("items"))
        .and_then(|i| i.as_array())
        .cloned()
        .unwrap_or_default();
    let mut rating_ru = None;
    let mut rating_world = None;
    for item in rating_items {
        let Some(obj) = item.as_object() else { continue };
        let title = obj.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let value = num(obj.get("value"));
        if title.contains("СНГ") || title.contains("Россия") {
            rating_ru = value;
        } else if title.to_lowercase().contains("мир") || title.to_lowercase().contains("world") {
            rating_world = value;
        }
    }

    conn.execute(
        "INSERT INTO game_metrics (
           game_id, observation_day, captured_at, source_raw_id,
           players, play_time_per_player, game_ready, game_ready_delta, rating_ru, rating_world
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(game_id, observation_day) DO UPDATE SET
           captured_at = excluded.captured_at,
           source_raw_id = excluded.source_raw_id,
           players = COALESCE(excluded.players, game_metrics.players),
           play_time_per_player = COALESCE(excluded.play_time_per_player, game_metrics.play_time_per_player),
           game_ready = COALESCE(excluded.game_ready, game_metrics.game_ready),
           game_ready_delta = COALESCE(excluded.game_ready_delta, game_metrics.game_ready_delta),
           rating_ru = COALESCE(excluded.rating_ru, game_metrics.rating_ru),
           rating_world = COALESCE(excluded.rating_world, game_metrics.rating_world)",
        rusqlite::params![game_id, day, captured, raw_id, players, play_time, ready, ready_delta, rating_ru, rating_world],
    )?;

    for (country, value) in pie_points(body, "country") {
        conn.execute(
            "INSERT INTO game_geography (game_id, observation_day, captured_at, country, players, source_raw_id)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(game_id, observation_day, country) DO UPDATE SET
               captured_at = excluded.captured_at,
               players = excluded.players,
               source_raw_id = excluded.source_raw_id",
            rusqlite::params![game_id, day, captured, country, value, raw_id],
        )?;
    }

    for (platform, value) in pie_points(body, "device") {
        conn.execute(
            "INSERT INTO game_platforms (game_id, observation_day, captured_at, platform, players, source_raw_id)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(game_id, observation_day, platform) DO UPDATE SET
               captured_at = excluded.captured_at,
               players = excluded.players,
               source_raw_id = excluded.source_raw_id",
            rusqlite::params![game_id, day, captured, platform, value, raw_id],
        )?;
    }

    Ok(true)
}

fn is_ymd(s: &str) -> bool {
    s.len() == 10 && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

fn canonical_period(from: &str, to: &str) -> (String, String) {
    if !is_ymd(from) {
        return (from.to_string(), to.to_string());
    }
    let to = if is_ymd(to) { to } else { from };
    let a = NaiveDate::parse_from_str(from, "%Y-%m-%d").unwrap();
    let b = NaiveDate::parse_from_str(to, "%Y-%m-%d").unwrap();
    let days = (b - a).num_days() + 1;
    if days <= 1 {
        // Один день — оставляем как есть
        (from.to_string(), from.to_string())
    } else if days <= 8 {
        // Неделя — сохраняем точное окно
        (from.to_string(), to.to_string())
    } else {
        // Месяц и больше — канонизируем в календарный месяц
        let y = a.year();
        let m = a.month();
        let start = format!("{y:04}-{m:02}-01");
        let end = if m == 12 {
            NaiveDate::from_ymd_opt(y, 12, 31).unwrap()
        } else {
            NaiveDate::from_ymd_opt(y, m + 1, 1).unwrap().pred_opt().unwrap()
        };
        (start, end.to_string())
    }
}

fn date_ranges(search: &str) -> (String, String) {
    let mut dates: Vec<String> = Vec::new();
    for part in search.trim_start_matches('?').split('&') {
        if let Some(rest) = part.strip_prefix("date_range=") {
            let decoded = urldecode(rest);
            if !decoded.is_empty() {
                dates.push(decoded);
            }
        }
    }
    let from = dates.first().cloned().unwrap_or_default();
    let to = dates.get(1).cloned().unwrap_or_else(|| from.clone());
    (from, to)
}

fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = &s[i + 1..i + 3];
                if let Ok(v) = u8::from_str_radix(hex, 16) {
                    out.push(v as char);
                    i += 3;
                    continue;
                }
                out.push('%');
                i += 1;
            }
            b'+' => {
                out.push(' ');
                i += 1;
            }
            b => {
                out.push(b as char);
                i += 1;
            }
        }
    }
    out
}

fn normalize_earnings(
    conn: &Connection,
    body: &Value,
    search: &str,
    day: &str,
    captured: i64,
    raw_id: i64,
) -> AppResult<bool> {
    let (from_raw, to_raw) = date_ranges(search);
    let (period_from, period_to) = canonical_period(&from_raw, &to_raw);
    let period_from = if period_from.is_empty() { None } else { Some(period_from) };
    let period_to = if period_to.is_empty() { None } else { Some(period_to) };

    let items = body.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for item in items {
        let Some(obj) = item.as_object() else { continue };
        let Some(game_id) = obj.get("game_id").map(|v| match v {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            _ => String::new(),
        }) else {
            continue;
        };
        if game_id.is_empty() {
            continue;
        }

        if let Some(titles) = obj.get("game_title") {
            let title = localized(Some(titles));
            let title_json = titles.as_object().map(|_| titles.to_string());
            upsert_game(
                conn,
                &game_id,
                title.as_deref(),
                title_json,
                None,
                None,
                None,
                captured,
            )?;
        }

        conn.execute(
            "INSERT INTO game_earnings (
               game_id, period_from, period_to, observation_day, captured_at,
               earn, adv, rsya, intad, inapp, source_raw_id
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(game_id, period_from, period_to, observation_day) DO UPDATE SET
               captured_at = excluded.captured_at,
               earn = excluded.earn,
               adv = excluded.adv,
               rsya = excluded.rsya,
               intad = excluded.intad,
               inapp = excluded.inapp,
               source_raw_id = excluded.source_raw_id",
            rusqlite::params![
                game_id,
                period_from,
                period_to,
                day,
                captured,
                num(obj.get("earn")),
                num(obj.get("adv")),
                num(obj.get("rsya")),
                num(obj.get("intad")),
                num(obj.get("inapp")),
                raw_id
            ],
        )?;
    }
    Ok(true)
}

fn normalize_applications(conn: &Connection, body: &Value, captured: i64) -> AppResult<bool> {
    let items = body.get("data").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    for item in items {
        let Some(obj) = item.as_object() else { continue };
        let Some(id) = obj.get("id").map(|v| match v {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            _ => String::new(),
        }) else {
            continue;
        };
        if id.is_empty() {
            continue;
        }
        let owner = owner_fields(obj);
        if let Some((ref owner_id, ref owner_title, ref owner_login)) = owner {
            upsert_account(
                conn,
                owner_id,
                owner_title.as_deref(),
                owner_login.as_deref(),
                captured,
            )?;
        }
        let version = version_of(obj);
        let title = version
            .and_then(|v| localized(v.get("title")))
            .or_else(|| localized(obj.get("title")));
        let title_json = version
            .and_then(|v| v.get("title"))
            .and_then(|t| t.as_object())
            .map(|_| version.unwrap().get("title").unwrap().to_string());
        let status = game_status(obj);
        let icon = game_icon(obj);
        let owner_id = owner.as_ref().map(|(id, _, _)| id.as_str());
        upsert_game(
            conn,
            &id,
            title.as_deref(),
            title_json,
            status.as_deref(),
            icon.as_deref(),
            owner_id,
            captured,
        )?;
    }
    Ok(true)
}

fn normalize_panel_row(
    conn: &Connection,
    game_id: &str,
    body: &Value,
    day: &str,
    captured: i64,
    raw_id: i64,
) -> AppResult<bool> {
    normalize_panel(conn, game_id, body, day, captured, raw_id)
}

fn normalize_game_card(
    conn: &Connection,
    game_id: &str,
    body: &Value,
    captured: i64,
    raw_id: i64,
) -> AppResult<bool> {
    let payload = body.get("data").unwrap_or(body);
    let Some(obj) = payload.as_object() else { return Ok(false) };
    let owner = owner_fields(obj);
    if let Some((ref owner_id, ref owner_title, ref owner_login)) = owner {
        upsert_account(
            conn,
            owner_id,
            owner_title.as_deref(),
            owner_login.as_deref(),
            captured,
        )?;
    }
    let version = version_of(obj);
    let title = version
        .and_then(|v| localized(v.get("title")))
        .or_else(|| localized(obj.get("title")));
    let status = game_status(obj);
    let icon = game_icon(obj);
    let owner_id = owner.as_ref().map(|(id, _, _)| id.as_str());
    upsert_game(
        conn,
        game_id,
        title.as_deref(),
        None,
        status.as_deref(),
        icon.as_deref(),
        owner_id,
        captured,
    )?;
    let _ = raw_id;
    Ok(true)
}

/// `/console/api/metrics-engine/analytics/data` → metric_series.
///
/// Именно эти ряды рисуют графики в карточке игры и вкладку «Метрики».
/// Без них слой «Доход» показывал «Нет ряда для слоя».
fn normalize_series(
    conn: &Connection,
    game_id: &str,
    body: &Value,
    request_body: &str,
    day: &str,
    captured: i64,
    raw_id: i64,
) -> AppResult<bool> {
    // Ключ метрики (slug) приходит в теле запроса, а не в ответе.
    let metric_key = serde_json::from_str::<Value>(request_body)
        .ok()
        .and_then(|req| {
            let obj = req.as_object()?;
            for key in ["metric", "slug", "id", "name", "metric_id"] {
                if let Some(Value::String(s)) = obj.get(key) {
                    if !s.is_empty() {
                        return Some(s.clone());
                    }
                }
            }
            obj.get("filters")
                .and_then(|f| f.get("metric").or_else(|| f.get("slug")))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });

    let series = body
        .get("options")
        .and_then(|o| o.get("series"))
        .and_then(|s| s.as_array())
        .cloned()
        .unwrap_or_default();
    if series.is_empty() {
        return Ok(false);
    }

    let mut written = 0;
    for s in series {
        let Some(obj) = s.as_object() else { continue };
        let base = obj.get("name").and_then(|v| v.as_str()).unwrap_or("series");
        let name = match &metric_key {
            Some(k) => format!("{k}: {base}"),
            None => base.to_string(),
        };
        let points = obj.get("data").and_then(|d| d.as_array()).cloned().unwrap_or_default();
        for p in points {
            let Some(pt) = p.as_object() else { continue };
            let Some(x) = pt.get("x").and_then(|v| v.as_i64()) else {
                continue;
            };
            conn.execute(
                "INSERT INTO metric_series (
                   game_id, observation_day, captured_at, series_name, point_x, point_y, source_raw_id
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(game_id, observation_day, series_name, point_x) DO UPDATE SET
                   point_y = excluded.point_y,
                   captured_at = excluded.captured_at,
                   source_raw_id = excluded.source_raw_id",
                rusqlite::params![
                    game_id,
                    day,
                    captured,
                    name,
                    x,
                    num(pt.get("y")),
                    raw_id
                ],
            )?;
            written += 1;
        }
    }
    Ok(written > 0)
}

/// `/console/api/metrics-engine/in-app/data` → purchase_metrics.
fn normalize_inapp(
    conn: &Connection,
    game_id: &str,
    body: &Value,
    request_body: &str,
    day: &str,
    captured: i64,
    raw_id: i64,
) -> AppResult<bool> {
    let req = serde_json::from_str::<Value>(request_body).ok();
    let resolved_id = if game_id.is_empty() {
        req.as_ref()
            .and_then(|r| r.get("game_id"))
            .map(|v| match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                _ => String::new(),
            })
            .unwrap_or_default()
    } else {
        game_id.to_string()
    };
    if resolved_id.is_empty() {
        return Ok(false);
    }

    let slug = body.get("slug").and_then(|v| v.as_str()).unwrap_or("");
    let kind = body.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let is_matrix = kind == "payment_amounts_matrix" || kind == "table";

    // Обычный виджет: value = items[0].value
    if !slug.is_empty() && !is_matrix {
        let value = body
            .get("items")
            .and_then(|i| i.as_array())
            .and_then(|a| a.first())
            .and_then(|i| num(i.get("value")));
        let title = body
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or(slug)
            .to_string();
        conn.execute(
            "INSERT INTO purchase_metrics (
               game_id, observation_day, captured_at, metric_slug, metric_title, value, unit, source_raw_id
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(game_id, observation_day, metric_slug) DO UPDATE SET
               captured_at = excluded.captured_at,
               metric_title = excluded.metric_title,
               value = excluded.value,
               unit = excluded.unit,
               source_raw_id = excluded.source_raw_id",
            rusqlite::params![
                resolved_id,
                day,
                captured,
                slug,
                title,
                value,
                body.get("unit").and_then(|v| v.as_str()),
                raw_id
            ],
        )?;
        return Ok(true);
    }

    // Матрица: суммарное число платящих
    if is_matrix && !slug.is_empty() {
        let paying: Option<f64> = body.get("rows").and_then(|r| r.as_array()).map(|rows| {
            rows.iter()
                .filter_map(|r| num(r.get("totalPayingUsers")))
                .sum()
        });
        conn.execute(
            "INSERT INTO purchase_metrics (
               game_id, observation_day, captured_at, metric_slug, metric_title, value, unit, source_raw_id
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
             ON CONFLICT(game_id, observation_day, metric_slug) DO UPDATE SET
               captured_at = excluded.captured_at,
               metric_title = excluded.metric_title,
               value = excluded.value,
               unit = excluded.unit,
               source_raw_id = excluded.source_raw_id",
            rusqlite::params![
                resolved_id,
                day,
                captured,
                slug,
                body.get("title").and_then(|v| v.as_str()).unwrap_or(slug),
                paying,
                kind,
                raw_id
            ],
        )?;
        return Ok(true);
    }

    Ok(false)
}

/// `/console/api/application-reviews/{id}` → game_ratings + game_reviews.
fn normalize_reviews(
    conn: &Connection,
    game_id: &str,
    body: &Value,
    day: &str,
    captured: i64,
    raw_id: i64,
) -> AppResult<bool> {
    let stats = body.get("ratingStats").and_then(|v| v.as_object());

    conn.execute(
        "INSERT INTO game_ratings (
           game_id, observation_day, captured_at, avg_rating,
           stars_1, stars_2, stars_3, stars_4, stars_5, total, review_count, source_raw_id
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
         ON CONFLICT(game_id, observation_day) DO UPDATE SET
           captured_at = excluded.captured_at,
           avg_rating = excluded.avg_rating,
           stars_1 = excluded.stars_1,
           stars_2 = excluded.stars_2,
           stars_3 = excluded.stars_3,
           stars_4 = excluded.stars_4,
           stars_5 = excluded.stars_5,
           total = excluded.total,
           review_count = excluded.review_count,
           source_raw_id = excluded.source_raw_id",
        rusqlite::params![
            game_id,
            day,
            captured,
            stats.and_then(|s| num(s.get("avgRating"))),
            stats.and_then(|s| int(s.get("one"))),
            stats.and_then(|s| int(s.get("two"))),
            stats.and_then(|s| int(s.get("three"))),
            stats.and_then(|s| int(s.get("four"))),
            stats.and_then(|s| int(s.get("five"))),
            stats.and_then(|s| int(s.get("total"))),
            body.get("pager").and_then(|p| int(p.get("reviewCount"))),
            raw_id
        ],
    )?;

    let views = body
        .get("view")
        .and_then(|v| v.get("views"))
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for view in views {
        let Some(obj) = view.as_object() else { continue };
        if obj.get("type").and_then(|t| t.as_str()) != Some("/ugc/review") {
            continue;
        }
        let Some(id) = obj.get("id") else { continue };
        let id = match id {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => continue,
        };
        let author = obj.get("author").and_then(|a| a.get("name")).and_then(|v| v.as_str());
        let text = obj
            .get("text")
            .and_then(|v| v.as_str())
            .map(|t| t.chars().take(5000).collect::<String>());
        let rating = obj.get("rating").and_then(|r| num(r.get("val")));
        let reactions = obj.get("reactions");
        conn.execute(
            "INSERT INTO game_reviews (
               id, game_id, captured_at, review_time, author_name, text, rating, language, likes, dislikes, source_raw_id
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(id) DO UPDATE SET
               captured_at = excluded.captured_at,
               text = excluded.text,
               rating = excluded.rating,
               likes = excluded.likes,
               dislikes = excluded.dislikes,
               source_raw_id = excluded.source_raw_id",
            rusqlite::params![
                id,
                game_id,
                captured,
                int(obj.get("time")),
                author,
                text,
                rating,
                obj.get("textLanguage").and_then(|v| v.as_str()),
                reactions.and_then(|r| int(r.get("likesCount"))),
                reactions.and_then(|r| int(r.get("dislikesCount"))),
                raw_id
            ],
        )?;
    }

    Ok(true)
}

/// `/console/api/application-purchases/{id}` → game_purchases.
fn normalize_purchases(
    conn: &Connection,
    game_id: &str,
    body: &Value,
    day: &str,
    captured: i64,
    raw_id: i64,
) -> AppResult<bool> {
    let list = body
        .get("list")
        .and_then(|v| v.as_array())
        .or_else(|| body.get("data").and_then(|d| d.get("list")).and_then(|v| v.as_array()))
        .cloned()
        .unwrap_or_default();
    if list.is_empty() {
        return Ok(false);
    }

    for product in list {
        let Some(obj) = product.as_object() else { continue };
        let Some(pid) = obj.get("id") else { continue };
        let pid = match pid {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => continue,
        };
        let price = obj.get("price");
        let removed = obj
            .get("removed")
            .map(|v| v.as_bool().unwrap_or(false) || v.as_i64().unwrap_or(0) != 0)
            .unwrap_or(false);
        conn.execute(
            "INSERT INTO game_purchases (
               game_id, product_id, observation_day, captured_at, title, price_value, price_code, removed, source_raw_id
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
             ON CONFLICT(game_id, product_id, observation_day) DO UPDATE SET
               captured_at = excluded.captured_at,
               title = excluded.title,
               price_value = excluded.price_value,
               price_code = excluded.price_code,
               removed = excluded.removed,
               source_raw_id = excluded.source_raw_id",
            rusqlite::params![
                game_id,
                pid,
                day,
                captured,
                localized(obj.get("title")),
                price.and_then(|p| num(p.get("value"))),
                price.and_then(|p| p.get("code")).and_then(|v| v.as_str()),
                if removed { 1 } else { 0 },
                raw_id
            ],
        )?;
    }
    Ok(true)
}

fn int(v: Option<&Value>) -> Option<i64> {
    match v? {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => s.trim().parse::<i64>().ok(),
        _ => None,
    }
}

/// Нормализует одну строку raw_responses. Возвращает true, если строка разобрана.
pub fn normalize_row(conn: &Connection, raw_id: i64) -> AppResult<bool> {
    let row = conn.query_row(
        "SELECT COALESCE(game_id,''), COALESCE(pathname,''), COALESCE(search,''),
                body_json, captured_at, COALESCE(request_body_json,'')
         FROM raw_responses WHERE id = ?1",
        [raw_id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
            ))
        },
    );
    let Ok((game_id, pathname, search, body_json, captured, request_body)) = row else {
        return Ok(false);
    };

    let body: Value = match serde_json::from_str(&body_json) {
        Ok(v) => v,
        Err(_) => return Ok(false),
    };
    let day = now_day(captured);

    // Пустой ответ Яндекса (серия без точек за старый месяц) всё равно
    // считается обработанным: иначе очередь «сырых» растёт навсегда.
    let handled = if pathname == "/console/api/application-panel" && !game_id.is_empty() {
        let _ = normalize_panel_row(conn, &game_id, &body, &day, captured, raw_id)?;
        true
    } else if pathname == "/console/api/metrics-engine/total/data" {
        let _ = normalize_earnings(conn, &body, &search, &day, captured, raw_id)?;
        true
    } else if pathname == "/console/api/applications" {
        let _ = normalize_applications(conn, &body, captured)?;
        true
    } else if pathname == "/console/api/metrics-engine/analytics/data" && !game_id.is_empty() {
        let _ = normalize_series(conn, &game_id, &body, &request_body, &day, captured, raw_id)?;
        true
    } else if pathname == "/console/api/metrics-engine/in-app/data" {
        let _ = normalize_inapp(conn, &game_id, &body, &request_body, &day, captured, raw_id)?;
        true
    } else if pathname.starts_with("/console/api/application-reviews/") && !game_id.is_empty() {
        let _ = normalize_reviews(conn, &game_id, &body, &day, captured, raw_id)?;
        true
    } else if pathname.starts_with("/console/api/application-purchases/") && !game_id.is_empty() {
        let _ = normalize_purchases(conn, &game_id, &body, &day, captured, raw_id)?;
        true
    } else if pathname.starts_with("/console/api/application/") && !game_id.is_empty() {
        let _ = normalize_game_card(conn, &game_id, &body, captured, raw_id)?;
        true
    } else if is_ignored_pathname(&pathname) {
        // Layout/csrf/tags — для UI не нужны, но не должны висеть в очереди.
        true
    } else {
        false
    };

    if handled {
        conn.execute("UPDATE raw_responses SET normalized = 1 WHERE id = ?1", [raw_id])?;
    }
    Ok(handled)
}

fn is_ignored_pathname(pathname: &str) -> bool {
    pathname == "/console/api/csrf-token"
        || pathname == "/console/api/tags"
        || pathname == "/console/api/categories"
        || pathname == "/console/api/suggest-tags"
        || pathname == "/console/api/accounts_rel"
        || pathname == "/console/api/files/sources"
        || pathname == "/console/api/application-metrics"
        || pathname == "/console/api/metrics-engine/in-app/layout"
        || pathname.starts_with("/console/api/developer/")
        || pathname.starts_with("/console/api/moderation-")
        || pathname.starts_with("/console/api/currency-regional-prices/")
        || pathname.starts_with("/console/api/application-purchases-test-users/")
}

/// Версия логики нормализации. Увеличивать при добавлении новых ручек —
/// тогда при старте выполнится полный пересчёт (`reprocess(all=true)`),
/// иначе строки, помеченные normalized=1 старым кодом, останутся без данных.
///
/// 1 — панель, доходы, список игр, карточка игры
/// 2 — analytics/data → metric_series, in-app/data → purchase_metrics,
///     отзывы → game_ratings/game_reviews, покупки → game_purchases
/// 3 — accounts из applications.owner + games.owner_id
pub const NORMALIZER_VERSION: i64 = 3;

/// Нормализует пачку только что принятых ответов.
pub fn normalize_ids(conn: &Connection, ids: &[i64]) -> AppResult<i64> {
    let tx = conn.unchecked_transaction()?;
    let mut ok = 0;
    for id in ids {
        if normalize_row(&tx, *id).unwrap_or(false) {
            ok += 1;
        }
    }
    tx.commit()?;
    Ok(ok)
}

/// Полный пересчёт: все ненормализованные (и по требованию — все) ответы.
pub fn reprocess(conn: &Connection, all: bool) -> AppResult<Value> {
    let sql = if all {
        "SELECT id FROM raw_responses ORDER BY id ASC"
    } else {
        "SELECT id FROM raw_responses WHERE normalized = 0 ORDER BY id ASC"
    };
    let mut stmt = conn.prepare(sql)?;
    let ids: Vec<i64> = stmt
        .query_map([], |r| r.get::<_, i64>(0))?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);
    let ok = normalize_ids(conn, &ids)?;
    Ok(serde_json::json!({
        "ok": true,
        "total": ids.len(),
        "normalized": ok,
        "failed": ids.len() as i64 - ok
    }))
}

/// Полный пересчёт, если версия нормализатора в базе старше текущей.
pub fn reprocess_if_outdated(conn: &Connection) {
    let stored_version = crate::db::meta_get(conn, "normalizer_version")
        .ok()
        .flatten()
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    let full = stored_version < NORMALIZER_VERSION;
    match reprocess(conn, full) {
        Ok(res) => {
            let total = res.get("total").and_then(|v| v.as_i64()).unwrap_or(0);
            if total > 0 {
                tracing::info!(full, %res, "normalized");
            }
            if full {
                let _ = crate::db::meta_set(conn, "normalizer_version", &NORMALIZER_VERSION.to_string());
            }
        }
        Err(e) => tracing::warn!(error = %e, "normalize failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(crate::db::SCHEMA_SQL).unwrap();
        conn
    }

    fn raw(conn: &Connection, pathname: &str, search: &str, game_id: Option<&str>, body: &str) -> i64 {
        conn.execute(
            "INSERT INTO raw_responses(event_id, dedupe_key, game_id, category, method, url, pathname,
               search, status_code, content_type, page_url, transport, request_body_json, body_json,
               body_bytes, truncated, captured_at, received_at, schema_version, normalized)
             VALUES(?1,?1,?2,'x','GET','u',?3,?4,200,'json','p','extension',NULL,?5,
               length(?5),0,?6,?6,1,0)",
            rusqlite::params![
                uuid_like(),
                game_id,
                pathname,
                search,
                body,
                // 2026-11-09T12:00:00Z
                1_794_211_200_000i64
            ],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn uuid_like() -> String {
        format!("evt-{}", Local::now().timestamp_nanos_opt().unwrap_or(0))
    }

    #[test]
    fn period_canonicalization() {
        assert_eq!(
            canonical_period("2026-11-09", "2026-11-09"),
            ("2026-11-09".into(), "2026-11-09".into())
        );
        assert_eq!(
            canonical_period("2026-11-04", "2026-11-10"),
            ("2026-11-04".into(), "2026-11-10".into())
        );
        assert_eq!(
            canonical_period("2026-11-01", "2026-11-09"),
            ("2026-11-01".into(), "2026-11-30".into())
        );
        assert_eq!(
            canonical_period("2026-12-05", "2026-12-20"),
            ("2026-12-01".into(), "2026-12-31".into())
        );
    }

    #[test]
    fn search_date_ranges() {
        let (from, to) = date_ranges("?lang=ru&slug=total_earn&date_range=2026-11-09&date_range=2026-11-09");
        assert_eq!(from, "2026-11-09");
        assert_eq!(to, "2026-11-09");
        let (from, to) = date_ranges("?date_range=2026-11-04&date_range=2026-11-10");
        assert_eq!((from.as_str(), to.as_str()), ("2026-11-04", "2026-11-10"));
    }

    #[test]
    fn panel_goes_to_metrics_with_day() {
        let conn = mem();
        let body = serde_json::json!({
            "widgets": {"items": [
                {"id": "players", "items": [{"value": 533}]},
                {"id": "play_time_for_player", "items": [{"value": 12.5}]},
                {"id": "game_ready_api", "items": [
                    {"value": 4.2},
                    {"type": "difference", "value": -0.3}
                ]},
                {"id": "rating", "items": [
                    {"title": "Россия и СНГ", "value": 58},
                    {"title": "Мир", "value": 3.9}
                ]}
            ]},
            "pieCharts": {"items": [
                {"id": "country", "data": {"options": {"series": [
                    {"data": [{"name": "Россия", "y": 533}, {"name": "США", "y": 57}]}
                ]}}}
            ]}
        })
        .to_string();
        let id = raw(&conn, "/console/api/application-panel", "", Some("1001"), &body);
        assert!(normalize_row(&conn, id).unwrap());

        let day: String = conn
            .query_row(
                "SELECT observation_day FROM game_metrics WHERE game_id='1001'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(day, "2026-11-09");

        let (players, rating_ru): (f64, f64) = conn
            .query_row(
                "SELECT players, rating_ru FROM game_metrics WHERE game_id='1001'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert!((players - 533.0).abs() < 0.01);
        assert!((rating_ru - 58.0).abs() < 0.01);

        let geo: i64 = conn
            .query_row("SELECT COUNT(*) FROM game_geography", [], |r| r.get(0))
            .unwrap();
        assert_eq!(geo, 2);
    }

    #[test]
    fn earnings_use_search_bucket() {
        let conn = mem();
        let body = serde_json::json!({
            "items": [
                {"game_id": 1001, "earn": 12.5, "adv": 12.5, "game_title": {"ru": "Demo Game"}},
                {"game_id": 1002, "earn": 0}
            ]
        })
        .to_string();
        let id = raw(
            &conn,
            "/console/api/metrics-engine/total/data",
            "?lang=ru&slug=total_earn&date_range=2026-11-09&date_range=2026-11-09",
            None,
            &body,
        );
        assert!(normalize_row(&conn, id).unwrap());

        let (from, to, earn): (String, String, f64) = conn
            .query_row(
                "SELECT period_from, period_to, earn FROM game_earnings WHERE game_id='1001'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(from, "2026-11-09");
        assert_eq!(to, "2026-11-09");
        assert!((earn - 12.5).abs() < 0.01);

        let title: String = conn
            .query_row("SELECT title FROM games WHERE id='1001'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Demo Game");
    }

    #[test]
    fn applications_upsert_games() {
        let conn = mem();
        let body = serde_json::json!({
            "data": [
                {"id": 1001, "rating": 4.5,
                 "owner": {"id": 9001, "title": "Demo Studio", "login": "demo"},
                 "published-version": {"title": {"ru": "Demo Game"}, "status": {"state": "published"},
                                       "icon": {"ru": {"url": "https://example.test/icon1"}}}}
            ]
        })
        .to_string();
        let id = raw(&conn, "/console/api/applications", "", None, &body);
        assert!(normalize_row(&conn, id).unwrap());

        let (title, status, icon, owner_id): (String, String, String, String) = conn
            .query_row(
                "SELECT title, status, icon_url, owner_id FROM games WHERE id='1001'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(title, "Demo Game");
        assert_eq!(status, "published");
        assert_eq!(icon, "https://example.test/icon1");
        assert_eq!(owner_id, "9001");

        let (acc_title, acc_login): (String, String) = conn
            .query_row(
                "SELECT title, login FROM accounts WHERE id='9001'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(acc_title, "Demo Studio");
        assert_eq!(acc_login, "demo");
    }
}
