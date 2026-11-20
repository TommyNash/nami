//! Расширение Nami Collector: распаковка в папку «Загрузки».
//!
//! В собранном приложении нет исходников репозитория, поэтому папка `extension/`
//! входит в ресурсы бандла (`bundle.resources`). В dev-режиме используется
//! `extension/` из корня проекта. Chrome загружает расширение как распакованную
//! папку, поэтому архив не нужен.

use crate::error::AppResult;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const FOLDER_NAME: &str = "nami-collector";
const GUIDE_FILE: &str = "INSTALL.txt";

/// Папка с файлами расширения: ресурсы собранного приложения или `extension/` в dev-режиме.
fn bundled_source(app: &AppHandle, app_root: &Path) -> Option<PathBuf> {
    let from_resources = app.path().resource_dir().ok().map(|dir| dir.join("extension"));
    from_resources
        .into_iter()
        .chain(std::iter::once(app_root.join("extension")))
        .find(|dir| dir.join("manifest.json").is_file())
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') || name == "__MACOSX" {
            continue;
        }
        let target = dst.join(&name);
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Копирует расширение в «Загрузки/nami-collector». Старые файлы перезаписываются.
fn unpack(app: &AppHandle, app_root: &Path) -> Result<PathBuf, String> {
    let src = bundled_source(app, app_root).ok_or("файлы расширения не найдены в приложении")?;
    let downloads = app.path().download_dir().map_err(|e| e.to_string())?;
    let dst = downloads.join(FOLDER_NAME);
    copy_dir(&src, &dst).map_err(|e| e.to_string())?;
    Ok(dst)
}

fn result(outcome: Result<PathBuf, String>) -> Value {
    match outcome {
        Ok(path) => json!({"ok": true, "path": path.display().to_string()}),
        Err(error) => json!({"ok": false, "error": error}),
    }
}

/// Кнопки «Скачать» и «Открыть папку»: распаковать и показать папку в Finder или Проводнике.
pub fn pack(app: &AppHandle, app_root: &Path) -> AppResult<Value> {
    let outcome = unpack(app, app_root);
    if let Ok(path) = &outcome {
        let _ = open::that(path);
    }
    Ok(result(outcome))
}

/// Кнопка «Инструкция»: распаковать (если нужно) и открыть INSTALL.txt.
pub fn open_guide(app: &AppHandle, app_root: &Path) -> AppResult<Value> {
    let outcome = unpack(app, app_root);
    if let Ok(path) = &outcome {
        let _ = open::that(path.join(GUIDE_FILE));
    }
    Ok(result(outcome))
}
