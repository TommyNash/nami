use crate::error::AppResult;
use crate::state::AppState;
use serde_json::{json, Value};
use std::io::Read;
use std::sync::Arc;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server, StatusCode};

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn is_collector_source(payload: &Value) -> bool {
    matches!(
        payload.get("source").and_then(|v| v.as_str()),
        Some("nami-collector" | "founders-collector")
    )
}

fn is_local(addr: &str) -> bool {
    addr == "127.0.0.1"
        || addr == "::1"
        || addr.starts_with("127.")
        || addr.contains("127.0.0.1")
}

fn json_response(status: u16, body: &Value) -> Response<std::io::Cursor<Vec<u8>>> {
    let bytes = serde_json::to_vec(body).unwrap_or_else(|_| b"{}".to_vec());
    let mut res = Response::from_data(bytes).with_status_code(StatusCode(status));
    for (k, v) in [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Headers", "content-type, x-founders-token"),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
    ] {
        if let Ok(h) = Header::from_bytes(k.as_bytes(), v.as_bytes()) {
            res.add_header(h);
        }
    }
    res
}

fn ingest_events(
    state: &AppState,
    events: &[Value],
    user_agent: Option<&str>,
    ext: Option<&str>,
) -> AppResult<Value> {
    let mut accepted = 0i64;
    let mut duplicates = 0i64;
    let mut errors = 0i64;
    let mut new_ids: Vec<i64> = Vec::new();
    let received_at = now_ms();

    {
        // Ingest всегда пишет в рабочую БД, даже если UI в демо-режиме.
        let db = state.ingest_db.lock();
        if let Some(ua) = user_agent {
            let _ = db.execute(
                "INSERT INTO collector_sessions(connected_at, last_seen_at, user_agent, extension_version)
                 VALUES(?1, ?1, ?2, ?3)",
                rusqlite::params![received_at, ua, ext.unwrap_or("")],
            );
        }

        for ev in events {
            let event_id = ev
                .get("eventId")
                .or_else(|| ev.get("event_id"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let dedupe = ev
                .get("dedupeKey")
                .or_else(|| ev.get("dedupe_key"))
                .and_then(|v| v.as_str())
                .unwrap_or(event_id.as_str())
                .to_string();
            let exists: bool = db
                .query_row(
                    "SELECT 1 FROM raw_responses WHERE event_id = ?1 OR dedupe_key = ?2 LIMIT 1",
                    rusqlite::params![event_id, dedupe],
                    |_| Ok(true),
                )
                .unwrap_or(false);
            if exists {
                duplicates += 1;
                continue;
            }

            let body = ev.get("body").cloned().unwrap_or(json!({}));
            let body_str = serde_json::to_string(&body).unwrap_or_else(|_| "{}".into());
            let pathname = ev
                .get("pathname")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let category = ev
                .get("category")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let method = ev
                .get("method")
                .and_then(|v| v.as_str())
                .unwrap_or("GET")
                .to_string();
            let url = ev.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let game_id = ev
                .get("gameId")
                .or_else(|| ev.get("game_id"))
                .and_then(|v| v.as_str());
            let status_code = ev
                .get("statusCode")
                .or_else(|| ev.get("status_code"))
                .and_then(|v| v.as_i64());
            let captured_at = ev
                .get("capturedAt")
                .or_else(|| ev.get("captured_at"))
                .and_then(|v| v.as_i64())
                .unwrap_or(received_at);

            match db.execute(
                "INSERT INTO raw_responses(
                    event_id, dedupe_key, game_id, category, method, url, pathname, search,
                    status_code, content_type, page_url, transport, request_body_json, body_json,
                    body_bytes, truncated, captured_at, received_at, schema_version, normalized
                 ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,0,?16,?17,1,0)",
                rusqlite::params![
                    event_id,
                    dedupe,
                    game_id,
                    category,
                    method,
                    url,
                    pathname,
                    ev.get("search").and_then(|v| v.as_str()),
                    status_code,
                    ev.get("contentType").and_then(|v| v.as_str()),
                    ev.get("pageUrl").and_then(|v| v.as_str()),
                    ev.get("transport")
                        .and_then(|v| v.as_str())
                        .unwrap_or("extension"),
                    ev.get("requestBody").map(|v| v.to_string()),
                    body_str,
                    body_str.len() as i64,
                    captured_at,
                    received_at
                ],
            ) {
                Ok(_) => {
                    accepted += 1;
                    // Сразу нормализуем: иначе метрики/доходы не попадут
                    // в аналитические таблицы и UI будет «стоять».
                    new_ids.push(db.last_insert_rowid());
                }
                Err(_) => errors += 1,
            }
        }

        // Нормализация в той же сессии: game_metrics / game_earnings / games.
        if !new_ids.is_empty() {
            let _ = crate::normalize::normalize_ids(&db, &new_ids);
        }

        let _ = db.execute(
            "INSERT INTO collection_history(started_at, finished_at, source, accepted, duplicates, errors, notes)
             VALUES(?1,?1,'extension',?2,?3,?4,NULL)",
            rusqlite::params![received_at, accepted, duplicates, errors],
        );
    }

    if accepted > 0 && !state.is_demo() {
        state.clear_screen_cache();
    }

    Ok(json!({
        "accepted": accepted,
        "duplicates": duplicates,
        "errors": errors
    }))
}

fn read_json_body(request: &mut tiny_http::Request, limit: u64) -> Option<Value> {
    let mut body = String::new();
    request
        .as_reader()
        .take(limit)
        .read_to_string(&mut body)
        .ok()?;
    serde_json::from_str(&body).ok()
}

pub fn start_ingest_server(state: Arc<AppState>, app: AppHandle, port: u16) -> AppResult<()> {
    let server = Server::http(format!("127.0.0.1:{port}"))
        .map_err(|e| crate::error::AppError::msg(format!("ingest bind failed: {e}")))?;
    let last = state.last_connection.clone();

    thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let remote = request
                .remote_addr()
                .map(|a| a.ip().to_string())
                .unwrap_or_default();
            if !is_local(&remote) {
                let _ = request.respond(json_response(
                    403,
                    &json!({"ok":false,"error":"localhost only"}),
                ));
                continue;
            }

            if request.method() == &Method::Options {
                let _ = request.respond(json_response(204, &json!({"ok":true})));
                continue;
            }

            let url = request.url().to_string();
            let path = url.split('?').next().unwrap_or("/");
            let token_ok = {
                let expected = state.token.lock().clone();
                let open = path == "/health" || path == "/pair";
                if open || expected.is_empty() {
                    true
                } else {
                    request
                        .headers()
                        .iter()
                        .find(|h| h.field.equiv("X-Founders-Token"))
                        .map(|h| h.value.as_str() == expected)
                        .unwrap_or(false)
                }
            };
            if !token_ok {
                let _ = request.respond(json_response(
                    401,
                    &json!({"ok":false,"error":"invalid token"}),
                ));
                continue;
            }

            *last.lock() = Some(now_ms());

            let response_body = if request.method() == &Method::Get && path == "/health" {
                json!({
                    "ok": true,
                    "service": "nami-ingest",
                    "version": "2.0.0-tauri",
                    "port": port,
                    "requiresToken": true,
                    "lastConnectionAt": *last.lock()
                })
            } else if request.method() == &Method::Get && path == "/pair" {
                let token = state.token.lock().clone();
                json!({
                    "ok": true,
                    "service": "nami-ingest",
                    "port": port,
                    "token": token,
                    "pairedAt": now_ms()
                })
            } else if request.method() == &Method::Post && path == "/progress" {
                match read_json_body(&mut request, 64 * 1024) {
                    Some(payload) if is_collector_source(&payload) => {
                        let progress = payload.get("progress").cloned().unwrap_or_else(|| json!({}));
                        let _ = app.emit("collect-progress", &progress);
                        json!({"ok": true})
                    }
                    _ => {
                        let _ = request.respond(json_response(
                            400,
                            &json!({"ok":false,"error":"invalid payload"}),
                        ));
                        continue;
                    }
                }
            } else if request.method() == &Method::Post && path == "/ingest" {
                let mut body = String::new();
                if request
                    .as_reader()
                    .take(8 * 1024 * 1024)
                    .read_to_string(&mut body)
                    .is_err()
                {
                    let _ = request.respond(json_response(
                        400,
                        &json!({"ok":false,"error":"read failed"}),
                    ));
                    continue;
                }
                let payload: Value = match serde_json::from_str(&body) {
                    Ok(v) => v,
                    Err(_) => {
                        let _ = request.respond(json_response(
                            400,
                            &json!({"ok":false,"error":"invalid json"}),
                        ));
                        continue;
                    }
                };
                if !is_collector_source(&payload) {
                    let _ = request.respond(json_response(
                        400,
                        &json!({"ok":false,"error":"invalid payload"}),
                    ));
                    continue;
                }
                let events = match payload.get("events").and_then(|v| v.as_array()) {
                    Some(a) if a.len() <= 100 => a.clone(),
                    Some(_) => {
                        let _ = request.respond(json_response(
                            400,
                            &json!({"ok":false,"error":"too many events"}),
                        ));
                        continue;
                    }
                    None => {
                        let _ = request.respond(json_response(
                            400,
                            &json!({"ok":false,"error":"invalid payload"}),
                        ));
                        continue;
                    }
                };
                let ua = request
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv("User-Agent"))
                    .map(|h| h.value.as_str().to_string());
                let ext = payload
                    .get("extensionVersion")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                match ingest_events(&state, &events, ua.as_deref(), ext.as_deref()) {
                    Ok(result) => {
                        let mut body = json!({"ok": true});
                        if let Some(obj) = result.as_object() {
                            for (k, v) in obj {
                                body[k] = v.clone();
                            }
                        }
                        let _ = app.emit("ingest-event", &body);
                        body
                    }
                    Err(e) => {
                        let _ = request.respond(json_response(
                            500,
                            &json!({"ok":false,"error": e.to_string()}),
                        ));
                        continue;
                    }
                }
            } else {
                json!({"ok":false,"error":"not found"})
            };

            let status = if response_body.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                200
            } else if response_body.get("error").and_then(|v| v.as_str()) == Some("not found") {
                404
            } else {
                200
            };
            let _ = request.respond(json_response(status, &response_body));
        }
    });

    Ok(())
}
