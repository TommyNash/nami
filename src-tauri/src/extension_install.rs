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

/// Файлы, на которые ссылается manifest.json (service worker, popup, скрипты, иконки).
fn manifest_files(manifest: &Value) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    let mut push = |value: Option<&Value>| {
        if let Some(path) = value.and_then(Value::as_str) {
            files.push(path.to_string());
        }
    };
    push(manifest.pointer("/background/service_worker"));
    push(manifest.pointer("/action/default_popup"));
    for pointer in ["/icons", "/action/default_icon"] {
        if let Some(icons) = manifest.pointer(pointer).and_then(Value::as_object) {
            icons.values().for_each(|icon| push(Some(icon)));
        }
    }
    if let Some(scripts) = manifest.get("content_scripts").and_then(Value::as_array) {
        for script in scripts {
            if let Some(list) = script.get("js").and_then(Value::as_array) {
                list.iter().for_each(|js| push(Some(js)));
            }
        }
    }
    files
}

/// Проверяет, что в папке расширения есть все файлы из manifest.json.
/// Chrome иначе пишет «Could not load manifest», не объясняя причины.
fn validate(dir: &Path) -> Result<(), String> {
    let text = std::fs::read_to_string(dir.join("manifest.json")).map_err(|e| e.to_string())?;
    let manifest: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let missing: Vec<String> = manifest_files(&manifest)
        .into_iter()
        .filter(|path| !dir.join(path).is_file())
        .collect();
    if missing.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "в сборке приложения неполное расширение (нет: {}). Скачайте архив nami-collector из релиза на GitHub",
            missing.join(", ")
        ))
    }
}

/// Копирует расширение в «Загрузки/nami-collector». Старые файлы перезаписываются.
fn unpack(app: &AppHandle, app_root: &Path) -> Result<PathBuf, String> {
    let src = bundled_source(app, app_root).ok_or("файлы расширения не найдены в приложении")?;
    validate(&src)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("nami-ext-{name}-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    const MANIFEST: &str = r#"{
        "background": {"service_worker": "background/sw.js"},
        "action": {"default_popup": "popup/popup.html"},
        "icons": {"16": "icons/icon16.png"},
        "content_scripts": [{"js": ["content/bridge.js"]}]
    }"#;

    #[test]
    fn rejects_flat_layout() {
        let dir = temp_dir("flat");
        fs::write(dir.join("manifest.json"), MANIFEST).unwrap();
        for name in ["sw.js", "popup.html", "icon16.png", "bridge.js"] {
            fs::write(dir.join(name), "").unwrap();
        }
        let error = validate(&dir).unwrap_err();
        assert!(error.contains("background/sw.js"), "{error}");
        assert!(error.contains("popup/popup.html"), "{error}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn accepts_full_layout() {
        let dir = temp_dir("full");
        fs::write(dir.join("manifest.json"), MANIFEST).unwrap();
        for path in ["background/sw.js", "popup/popup.html", "icons/icon16.png", "content/bridge.js"] {
            let file = dir.join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, "").unwrap();
        }
        assert!(validate(&dir).is_ok());
        let _ = fs::remove_dir_all(&dir);
    }
}
