mod snapshot;

use crate::commands::run_blocking;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use chrono::Local;
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use snapshot::{prune_safety_copies, read_info, restore_into, safety_copy_path, staging_path, write_backup, FILE_EXT};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

fn open_live_reader(path: &Path) -> AppResult<Connection> {
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?)
}

fn dialog_path(picked: Option<tauri_plugin_dialog::FilePath>) -> AppResult<Option<PathBuf>> {
    picked
        .map(|p| p.into_path().map_err(|e| AppError::msg(e.to_string())))
        .transpose()
}

fn choose_save_path(app: &AppHandle, window: &WebviewWindow, name: &str) -> AppResult<Option<PathBuf>> {
    let picked = app
        .dialog()
        .file()
        .set_parent(window)
        .set_file_name(name)
        .add_filter("Резервная копия Nami", &[FILE_EXT])
        .blocking_save_file();
    Ok(dialog_path(picked)?.map(|mut p| {
        if p.extension().is_none() {
            p.set_extension(FILE_EXT);
        }
        p
    }))
}

fn choose_open_path(app: &AppHandle, window: &WebviewWindow) -> AppResult<Option<PathBuf>> {
    let picked = app
        .dialog()
        .file()
        .set_parent(window)
        .add_filter("Резервная копия Nami", &[FILE_EXT, "sqlite"])
        .blocking_pick_file();
    dialog_path(picked)
}

fn reveal(path: &Path) {
    #[cfg(target_os = "macos")]
    let _ = Command::new("open").arg("-R").arg(path).spawn();
    #[cfg(not(target_os = "macos"))]
    if let Some(parent) = path.parent() {
        let _ = open::that(parent);
    }
}

fn is_live_db_file(state: &AppState, path: &Path) -> bool {
    path == state.live_db_path || path == state.demo_db_path
}

#[tauri::command]
pub async fn export_backup(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    prefs: Option<String>,
) -> AppResult<Value> {
    let state = state.inner().clone();
    run_blocking(move || {
        let name = format!("Nami-backup-{}.{FILE_EXT}", Local::now().format("%Y-%m-%d"));
        let Some(dest) = choose_save_path(&app, &window, &name)? else {
            return Ok(json!({ "ok": false, "cancelled": true }));
        };
        if is_live_db_file(&state, &dest) {
            return Err(AppError::msg("Выберите другое место: это рабочая база Nami"));
        }
        let conn = open_live_reader(&state.live_db_path)?;
        write_backup(&conn, &dest, prefs.as_deref())?;
        let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        reveal(&dest);
        Ok(json!({ "ok": true, "path": dest.display().to_string(), "size": size }))
    })
    .await
}

/// Файл копии сначала копируется в каталог данных: пользовательский файл
/// не открывается напрямую и не меняется между проверкой и импортом.
#[tauri::command]
pub async fn pick_backup(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
) -> AppResult<Value> {
    let state = state.inner().clone();
    run_blocking(move || {
        let Some(src) = choose_open_path(&app, &window)? else {
            return Ok(json!({ "ok": false, "cancelled": true }));
        };
        let staged = staging_path(&state.data_dir);
        std::fs::copy(&src, &staged)?;
        match read_info(&staged) {
            Ok(info) => Ok(json!({ "ok": true, "info": info.to_json() })),
            Err(e) => {
                let _ = std::fs::remove_file(&staged);
                Err(e)
            }
        }
    })
    .await
}

fn apply_import(state: &AppState, staged: &Path) -> AppResult<Value> {
    let info = read_info(staged)?;
    let safety = safety_copy_path(&state.data_dir);
    let live = state.ingest_db.lock();
    write_backup(&live, &safety, None)?;
    prune_safety_copies(&state.data_dir);
    restore_into(&live, staged)?;
    db::ensure_schema(&live)?;
    crate::normalize::reprocess_if_outdated(&live);
    live.execute("DELETE FROM meta WHERE key LIKE 'backup\\_%' ESCAPE '\\'", [])?;
    let _ = live.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
    drop(live);
    state.clear_screen_cache();
    if let Err(e) = crate::analytics::warm_memos(&state.db.lock()) {
        tracing::warn!(error = %e, "warm_memos after import failed");
    }
    Ok(json!({
        "ok": true,
        "uiPrefs": info.ui_prefs,
        "safetyCopy": safety.display().to_string(),
    }))
}

#[tauri::command]
pub async fn import_backup(state: State<'_, Arc<AppState>>, apply: bool) -> AppResult<Value> {
    let state = state.inner().clone();
    run_blocking(move || {
        let staged = staging_path(&state.data_dir);
        if !apply {
            let _ = std::fs::remove_file(&staged);
            return Ok(json!({ "ok": true, "discarded": true }));
        }
        if !staged.exists() {
            return Err(AppError::msg("Сначала выберите файл копии"));
        }
        let result = apply_import(&state, &staged);
        let _ = std::fs::remove_file(&staged);
        result
    })
    .await
}

