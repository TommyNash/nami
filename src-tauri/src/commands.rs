use crate::analytics;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tauri::State;

fn scope_tag(state: &AppState) -> &'static str {
    if state.is_demo() { "demo" } else { "live" }
}

fn acct_part(account_id: Option<&str>) -> &str {
    account_id.unwrap_or("")
}

/// Повторный фильтр берёт готовый JSON. Запись в базу сбрасывает кэш целиком.
fn cached_query(
    state: &AppState,
    key: String,
    build: impl FnOnce(&rusqlite::Connection) -> AppResult<Value>,
) -> AppResult<Value> {
    if let Some(hit) = state.screen_cached(&key) {
        return Ok(hit);
    }
    let db = state.db.lock();
    let value = build(&db)?;
    drop(db);
    state.screen_store(key, value.clone());
    Ok(value)
}

/// Тяжёлый расчёт вне async-рантайма Tauri: UI не ждёт Mutex на потоке команды.
pub(crate) async fn run_blocking<T, F>(f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> AppResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::msg(format!("worker join: {e}")))?
}

#[tauri::command]
pub fn get_info(state: State<'_, Arc<AppState>>) -> AppResult<Value> {
    let demo = state.is_demo();
    Ok(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "ingestPort": state.ingest_port,
        "ingestToken": state.token.lock().clone(),
        "userData": state.data_dir.parent().map(|p| p.display().to_string()).unwrap_or_else(|| state.data_dir.display().to_string()),
        "dbPath": if demo {
            state.demo_db_path.display().to_string()
        } else {
            state.live_db_path.display().to_string()
        },
        "liveDbPath": state.live_db_path.display().to_string(),
        "demoDbPath": state.demo_db_path.display().to_string(),
        "demoMode": demo,
        "canUseDemo": AppState::can_use_demo(),
        "extensionPath": state.app_root.join("extension").display().to_string(),
        "runtime": "tauri-rust"
    }))
}

#[tauri::command]
pub fn get_demo_state(state: State<'_, Arc<AppState>>) -> AppResult<Value> {
    Ok(json!({
        "canUseDemo": AppState::can_use_demo(),
        "demoMode": state.is_demo(),
        "demoDbPath": state.demo_db_path.display().to_string(),
        "liveDbPath": state.live_db_path.display().to_string()
    }))
}

#[tauri::command]
pub fn set_demo_mode(state: State<'_, Arc<AppState>>, enabled: bool) -> AppResult<Value> {
    state.set_demo_mode(enabled)?;
    Ok(json!({
        "ok": true,
        "demoMode": state.is_demo()
    }))
}

#[tauri::command]
pub fn reset_demo_data(state: State<'_, Arc<AppState>>) -> AppResult<Value> {
    state.reset_demo_data()?;
    Ok(json!({ "ok": true, "demoMode": state.is_demo() }))
}

#[tauri::command]
pub fn get_overview(state: State<'_, Arc<AppState>>) -> AppResult<Value> {
    let db = state.db.lock();
    analytics::overview(&db)
}

#[tauri::command]
pub fn get_collector(state: State<'_, Arc<AppState>>) -> AppResult<Value> {
    let db = state.db.lock();
    let mut base = analytics::collector_state(&db)?;
    if let Some(obj) = base.as_object_mut() {
        obj.insert("ingestPort".into(), json!(state.ingest_port));
        obj.insert(
            "lastExtensionConnection".into(),
            json!(state.last_connection_at()),
        );
    }
    Ok(base)
}

#[tauri::command]
pub fn list_accounts(state: State<'_, Arc<AppState>>) -> AppResult<Value> {
    let db = state.db.lock();
    analytics::list_accounts(&db)
}

#[tauri::command]
pub async fn list_games(
    state: State<'_, Arc<AppState>>,
    period: Option<String>,
    account_id: Option<String>,
) -> AppResult<Value> {
    let state = state.inner().clone();
    let period = period.unwrap_or_else(|| "month".into());
    run_blocking(move || {
        let acct = account_id.as_deref().unwrap_or("");
        let port_key = format!("port|{}|{period}|{acct}", scope_tag(&state));
        if let Some(port) = state.screen_cached(&port_key) {
            if let Some(games) = port.get("games").cloned() {
                return Ok(games);
            }
        }
        cached_query(
            &state,
            format!("list|{}|{period}|{acct}", scope_tag(&state)),
            |db| analytics::list_games(db, &period, account_id.as_deref()),
        )
    })
    .await
}

#[tauri::command]
pub async fn games_screen(
    state: State<'_, Arc<AppState>>,
    period: Option<String>,
    compare_mode: Option<String>,
    account_id: Option<String>,
) -> AppResult<Value> {
    let state = state.inner().clone();
    let period = period.unwrap_or_else(|| "month".into());
    let compare = compare_mode.unwrap_or_else(|| "prev_month".into());
    run_blocking(move || {
        let _span = tracing::info_span!(
            "ipc.games_screen",
            period = %period,
            compare = %compare
        )
        .entered();
        let scope = scope_tag(&state);
        let acct = acct_part(account_id.as_deref());
        let port_key = format!("port|{scope}|{period}|{acct}");
        let heat_key = format!("heat|{scope}|{period}|{compare}|{acct}");

        let portfolio = if let Some(hit) = state.screen_cached(&port_key) {
            hit
        } else {
            let db = state.db.lock();
            let value = analytics::games_portfolio(&db, &period, account_id.as_deref())?;
            drop(db);
            state.screen_store(port_key, value.clone());
            value
        };

        let heatmap = if let Some(hit) = state.screen_cached(&heat_key) {
            hit
        } else {
            let games = portfolio.get("games").cloned();
            let db = state.db.lock();
            let value = analytics::games_heatmap_with(
                &db,
                &period,
                &compare,
                account_id.as_deref(),
                games.as_ref(),
            )?;
            drop(db);
            state.screen_store(heat_key, value.clone());
            value
        };

        Ok(json!({
            "period": period,
            "heatCompare": compare,
            "accountId": account_id,
            "games": portfolio.get("games").cloned().unwrap_or(json!([])),
            "overview": portfolio.get("overview").cloned().unwrap_or(Value::Null),
            "coverage": portfolio.get("coverage").cloned().unwrap_or(Value::Null),
            "months": portfolio.get("months").cloned().unwrap_or(json!([])),
            "heatmap": heatmap
        }))
    })
    .await
}

#[tauri::command]
pub async fn games_heatmap(
    state: State<'_, Arc<AppState>>,
    period: Option<String>,
    compare_mode: Option<String>,
    account_id: Option<String>,
) -> AppResult<Value> {
    let state = state.inner().clone();
    let period = period.unwrap_or_else(|| "month".into());
    let compare = compare_mode.unwrap_or_else(|| "prev_month".into());
    run_blocking(move || {
        let scope = scope_tag(&state);
        let acct = acct_part(account_id.as_deref());
        let heat_key = format!("heat|{scope}|{period}|{compare}|{acct}");
        if let Some(hit) = state.screen_cached(&heat_key) {
            return Ok(hit);
        }
        let port_key = format!("port|{scope}|{period}|{acct}");
        let games = state
            .screen_cached(&port_key)
            .and_then(|port| port.get("games").cloned());
        let db = state.db.lock();
        let value = analytics::games_heatmap_with(
            &db,
            &period,
            &compare,
            account_id.as_deref(),
            games.as_ref(),
        )?;
        drop(db);
        state.screen_store(heat_key, value.clone());
        Ok(value)
    })
    .await
}

#[tauri::command]
pub fn list_earn_months(
    state: State<'_, Arc<AppState>>,
    account_id: Option<String>,
) -> AppResult<Value> {
    let acct = acct_part(account_id.as_deref());
    let scope = scope_tag(&state);
    let port_key = format!("port|{scope}|month|{acct}");
    if let Some(port) = state.screen_cached(&port_key) {
        if let Some(months) = port.get("months").cloned() {
            return Ok(months);
        }
    }
    cached_query(
        &state,
        format!("months|{scope}|{acct}"),
        |db| analytics::list_earn_months(db, account_id.as_deref()),
    )
}

#[tauri::command]
pub fn upsert_manual_earn_month(
    state: State<'_, Arc<AppState>>,
    account_id: Option<String>,
    month_key: String,
    earn: f64,
    note: Option<String>,
) -> AppResult<Value> {
    let db = state.db.lock();
    let result = analytics::upsert_manual_earn_month(
        &db,
        account_id.as_deref(),
        &month_key,
        earn,
        note.as_deref(),
    );
    drop(db);
    state.clear_screen_cache();
    result
}

#[tauri::command]
pub fn delete_manual_earn_month(
    state: State<'_, Arc<AppState>>,
    account_id: Option<String>,
    month_key: String,
) -> AppResult<Value> {
    let db = state.db.lock();
    let result = analytics::delete_manual_earn_month(&db, account_id.as_deref(), &month_key);
    drop(db);
    state.clear_screen_cache();
    result
}

#[tauri::command]
pub fn tax_sheet(
    state: State<'_, Arc<AppState>>,
    account_id: Option<String>,
) -> AppResult<Value> {
    let acct = acct_part(account_id.as_deref());
    cached_query(
        &state,
        format!("tax|{}|{acct}", scope_tag(&state)),
        |db| analytics::tax_sheet(db, account_id.as_deref()),
    )
}

#[tauri::command]
pub fn set_tax_settings(
    state: State<'_, Arc<AppState>>,
    rate: Option<f64>,
    shift: Option<i32>,
) -> AppResult<Value> {
    let db = state.db.lock();
    let result = analytics::set_tax_settings(&db, rate, shift);
    drop(db);
    state.clear_screen_cache();
    result
}

#[tauri::command]
pub async fn analytics_overview(
    state: State<'_, Arc<AppState>>,
    period: Option<String>,
    account_id: Option<String>,
) -> AppResult<Value> {
    let state = state.inner().clone();
    let period = period.unwrap_or_else(|| "month".into());
    run_blocking(move || {
        let acct = acct_part(account_id.as_deref());
        let scope = scope_tag(&state);
        let port_key = format!("port|{scope}|{period}|{acct}");
        if let Some(port) = state.screen_cached(&port_key) {
            if let Some(overview) = port.get("overview").cloned() {
                return Ok(overview);
            }
        }
        cached_query(
            &state,
            format!("overview|{scope}|{period}|{acct}"),
            |db| analytics::analytics_overview(db, &period, account_id.as_deref()),
        )
    })
    .await
}

#[tauri::command]
pub fn get_freshness(state: State<'_, Arc<AppState>>, game_id: Option<String>) -> AppResult<Value> {
    let db = state.db.lock();
    analytics::freshness(&db, game_id.as_deref())
}

#[tauri::command]
pub async fn get_data_coverage(
    state: State<'_, Arc<AppState>>,
    period: Option<String>,
    account_id: Option<String>,
) -> AppResult<Value> {
    let state = state.inner().clone();
    let period = period.unwrap_or_else(|| "month".into());
    run_blocking(move || {
        let acct = acct_part(account_id.as_deref());
        let scope = scope_tag(&state);
        let port_key = format!("port|{scope}|{period}|{acct}");
        if let Some(port) = state.screen_cached(&port_key) {
            if let Some(coverage) = port.get("coverage").cloned() {
                return Ok(coverage);
            }
        }
        cached_query(
            &state,
            format!("coverage|{scope}|{period}|{acct}"),
            |db| analytics::data_coverage(db, &period, account_id.as_deref()),
        )
    })
    .await
}

#[tauri::command]
pub fn get_db_stats(state: State<'_, Arc<AppState>>) -> AppResult<Value> {
    let db = state.db.lock();
    analytics::db_stats(&db)
}

#[tauri::command]
pub fn list_history(state: State<'_, Arc<AppState>>, limit: Option<i64>) -> AppResult<Value> {
    let db = state.db.lock();
    analytics::list_history(&db, limit.unwrap_or(50))
}

#[tauri::command]
pub fn list_requests(_state: State<'_, Arc<AppState>>, _opts: Option<Value>) -> AppResult<Value> {
    Ok(json!([]))
}

#[tauri::command]
pub fn list_raw(state: State<'_, Arc<AppState>>, opts: Option<Value>) -> AppResult<Value> {
    let limit = opts
        .as_ref()
        .and_then(|v| v.get("limit"))
        .and_then(|v| v.as_i64())
        .unwrap_or(50);
    let db = state.db.lock();
    let mut stmt = db.prepare(
        "SELECT id, event_id, game_id, category, pathname, status_code, captured_at, normalized
         FROM raw_responses ORDER BY captured_at DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([limit], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "event_id": r.get::<_, String>(1)?,
                "game_id": r.get::<_, Option<String>>(2)?,
                "category": r.get::<_, String>(3)?,
                "pathname": r.get::<_, String>(4)?,
                "status_code": r.get::<_, Option<i64>>(5)?,
                "captured_at": r.get::<_, i64>(6)?,
                "normalized": r.get::<_, i64>(7)?
            }))
        })?
        .filter_map(|r| r.ok())
        .collect();
    Ok(Value::Array(rows))
}

#[tauri::command]
pub fn get_raw(state: State<'_, Arc<AppState>>, id: i64) -> AppResult<Value> {
    let db = state.db.lock();
    db.query_row(
        "SELECT id, event_id, game_id, category, method, url, pathname, body_json, captured_at, normalized
         FROM raw_responses WHERE id = ?1",
        [id],
        |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?,
                "event_id": r.get::<_, String>(1)?,
                "game_id": r.get::<_, Option<String>>(2)?,
                "category": r.get::<_, String>(3)?,
                "method": r.get::<_, String>(4)?,
                "url": r.get::<_, String>(5)?,
                "pathname": r.get::<_, String>(6)?,
                "body_json": r.get::<_, String>(7)?,
                "captured_at": r.get::<_, i64>(8)?,
                "normalized": r.get::<_, i64>(9)?
            }))
        },
    )
    .map_err(Into::into)
}

#[tauri::command]
pub fn clear_raw(state: State<'_, Arc<AppState>>) -> AppResult<Value> {
    let db = state.db.lock();
    db.execute("DELETE FROM raw_responses", [])?;
    drop(db);
    state.clear_screen_cache();
    Ok(json!({"ok": true}))
}

#[tauri::command]
pub fn reprocess(state: State<'_, Arc<AppState>>, all: Option<bool>) -> AppResult<Value> {
    let db = state.db.lock();
    let result = crate::normalize::reprocess(&db, all.unwrap_or(false));
    drop(db);
    state.clear_screen_cache();
    result
}

#[tauri::command]
pub async fn analytics_game(
    state: State<'_, Arc<AppState>>,
    game_id: String,
    period: Option<String>,
) -> AppResult<Value> {
    let state = state.inner().clone();
    let period = period.unwrap_or_else(|| "month".into());
    run_blocking(move || {
        let id = game_id.clone();
        cached_query(
            &state,
            format!("game|{}|{id}|{period}", scope_tag(&state)),
            move |db| match analytics::game_details(db, &id, &period)? {
                Some(v) => Ok(v),
                None => Ok(Value::Null),
            },
        )
    })
    .await
}

#[tauri::command]
pub fn analytics_metrics(_state: State<'_, Arc<AppState>>, _period: Option<String>) -> AppResult<Value> {
    Ok(json!({}))
}

#[tauri::command]
pub async fn analytics_compare(
    state: State<'_, Arc<AppState>>,
    game_ids: Option<Vec<String>>,
    period: Option<String>,
) -> AppResult<Value> {
    let state = state.inner().clone();
    let period = period.unwrap_or_else(|| "month".into());
    let ids = game_ids.unwrap_or_default();
    run_blocking(move || {
        let key = format!(
            "cmp|{}|{period}|{}",
            scope_tag(&state),
            ids.join(",")
        );
        cached_query(&state, key, move |db| {
            analytics::compare_games(db, &ids, &period)
        })
    })
    .await
}

#[tauri::command]
pub fn analytics_geography(
    state: State<'_, Arc<AppState>>,
    game_id: Option<String>,
) -> AppResult<Value> {
    let Some(id) = game_id.filter(|s| !s.is_empty()) else {
        return Ok(json!([]));
    };
    cached_query(&state, format!("geo|{}|{id}", scope_tag(&state)), move |db| {
        analytics::game_geography(db, &id)
    })
}

#[tauri::command]
pub fn analytics_platforms(
    state: State<'_, Arc<AppState>>,
    game_id: Option<String>,
) -> AppResult<Value> {
    let Some(id) = game_id.filter(|s| !s.is_empty()) else {
        return Ok(json!([]));
    };
    cached_query(&state, format!("plat|{}|{id}", scope_tag(&state)), move |db| {
        analytics::game_platforms(db, &id)
    })
}

#[tauri::command]
pub fn analytics_reviews(
    state: State<'_, Arc<AppState>>,
    game_id: Option<String>,
) -> AppResult<Value> {
    let Some(id) = game_id.filter(|s| !s.is_empty()) else {
        return Ok(json!([]));
    };
    cached_query(&state, format!("rev|{}|{id}", scope_tag(&state)), move |db| {
        analytics::game_reviews(db, &id)
    })
}

#[tauri::command]
pub fn analytics_purchases(
    state: State<'_, Arc<AppState>>,
    game_id: Option<String>,
) -> AppResult<Value> {
    let Some(id) = game_id.filter(|s| !s.is_empty()) else {
        return Ok(json!({ "products": [], "metrics": [] }));
    };
    cached_query(&state, format!("buy|{}|{id}", scope_tag(&state)), move |db| {
        analytics::game_purchases_page(db, &id)
    })
}

#[tauri::command]
pub fn analytics_earnings(
    state: State<'_, Arc<AppState>>,
    game_id: Option<String>,
    period: Option<String>,
) -> AppResult<Value> {
    let Some(id) = game_id.filter(|s| !s.is_empty()) else {
        return Ok(json!({"rows": [], "period": "all", "bounds": null}));
    };
    let period = period.unwrap_or_else(|| "month".into());
    cached_query(
        &state,
        format!("earn|{}|{id}|{period}", scope_tag(&state)),
        move |db| analytics::game_earnings_page(db, &id, &period),
    )
}

#[tauri::command]
pub fn list_earn_daily(_state: State<'_, Arc<AppState>>, _period: Option<String>) -> AppResult<Value> {
    Ok(json!({"days": [], "estimated": false}))
}

fn downloads_dir() -> PathBuf {
    if let Some(home) = std::env::var_os("HOME") {
        let dir = PathBuf::from(home).join("Downloads");
        if dir.is_dir() {
            return dir;
        }
    }
    std::env::temp_dir()
}

fn safe_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let trimmed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = trimmed.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "Отчёт".into()
    } else {
        trimmed.chars().take(120).collect()
    }
}

fn unique_download(filename: &str) -> PathBuf {
    let dir = downloads_dir();
    let path = dir.join(filename);
    if !path.exists() {
        return path;
    }
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Отчёт");
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    for n in 2..50 {
        let name = if ext.is_empty() {
            format!("{stem} {n}")
        } else {
            format!("{stem} {n}.{ext}")
        };
        let candidate = dir.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    path
}

fn b64_val(byte: u8) -> Result<u8, String> {
    match byte {
        b'A'..=b'Z' => Ok(byte - b'A'),
        b'a'..=b'z' => Ok(byte - b'a' + 26),
        b'0'..=b'9' => Ok(byte - b'0' + 52),
        b'+' => Ok(62),
        b'/' => Ok(63),
        _ => Err("не удалось прочитать файл отчёта".into()),
    }
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let bytes: Vec<u8> = input
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return Err("пустой файл отчёта".into());
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for chunk in bytes.chunks(4) {
        let pad = chunk.iter().filter(|b| **b == b'=').count();
        if pad > 2 || (pad > 0 && chunk[3] != b'=' && chunk[2] != b'=') {
            return Err("не удалось прочитать файл отчёта".into());
        }
        let a = b64_val(chunk[0])?;
        let b = b64_val(chunk[1])?;
        let c = if chunk[2] == b'=' { 0 } else { b64_val(chunk[2])? };
        let d = if chunk[3] == b'=' { 0 } else { b64_val(chunk[3])? };
        out.push((a << 2) | (b >> 4));
        if pad < 2 {
            out.push((b << 4) | (c >> 2));
        }
        if pad < 1 {
            out.push((c << 6) | d);
        }
    }
    Ok(out)
}

/// Пишем отчёт сами: скачивание через окно на macOS падает
/// с sandbox_extension_issue_file (пустой путь назначения).
#[tauri::command]
pub fn save_report(filename: String, data_base64: String) -> AppResult<String> {
    let bytes = decode_base64(&data_base64).map_err(crate::error::AppError::msg)?;
    let name = safe_filename(&filename);
    let path = unique_download(&name);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, &bytes)?;
    #[cfg(target_os = "macos")]
    {
        let _ = Command::new("open").arg("-R").arg(&path).spawn();
    }
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn export_game(
    _state: State<'_, Arc<AppState>>,
    _game_id: String,
    _period: Option<String>,
) -> AppResult<Value> {
    Ok(json!(null))
}

#[tauri::command]
pub fn open_extension_folder(app: tauri::AppHandle, state: State<'_, Arc<AppState>>) -> AppResult<Value> {
    crate::extension_install::pack(&app, &state.app_root)
}

#[tauri::command]
pub fn open_extension_install(app: tauri::AppHandle, state: State<'_, Arc<AppState>>) -> AppResult<Value> {
    crate::extension_install::open_guide(&app, &state.app_root)
}

#[tauri::command]
pub fn pack_extension(app: tauri::AppHandle, state: State<'_, Arc<AppState>>) -> AppResult<Value> {
    crate::extension_install::pack(&app, &state.app_root)
}

pub fn load_or_create_token(data_dir: &PathBuf) -> AppResult<String> {
    use rand::RngCore;
    std::fs::create_dir_all(data_dir)?;
    let path = data_dir.join("ingest-token.txt");
    if path.exists() {
        return Ok(std::fs::read_to_string(path)?.trim().to_string());
    }
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    let token = hex::encode(bytes);
    std::fs::write(&path, &token)?;
    Ok(token)
}
