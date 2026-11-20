use crate::db;
use crate::error::{AppError, AppResult};
use chrono::Local;
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const REQUIRED_TABLES: [&str; 2] = ["games", "raw_responses"];
const SAFETY_COPIES_KEPT: usize = 3;
pub const FILE_EXT: &str = "nami";

pub struct BackupInfo {
    pub games: i64,
    pub metrics: i64,
    pub earnings: i64,
    pub raw_responses: i64,
    pub created_at: Option<i64>,
    pub app_version: Option<String>,
    pub ui_prefs: Option<String>,
    pub size: u64,
}

impl BackupInfo {
    pub fn to_json(&self) -> Value {
        json!({
            "games": self.games,
            "metrics": self.metrics,
            "earnings": self.earnings,
            "rawResponses": self.raw_responses,
            "createdAt": self.created_at,
            "appVersion": self.app_version,
            "size": self.size,
        })
    }
}

fn not_a_backup() -> AppError {
    AppError::msg("Файл не похож на резервную копию Nami")
}

fn version_key(version: &str) -> Vec<u32> {
    version.split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

fn has_table(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [name],
        |_| Ok(()),
    )
    .is_ok()
}

fn count_rows(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |r| r.get(0))
        .unwrap_or(0)
}

fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

pub fn write_backup(conn: &Connection, dest: &Path, prefs: Option<&str>) -> AppResult<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if dest.exists() {
        std::fs::remove_file(dest)?;
    }
    let result = write_backup_inner(conn, dest, prefs);
    if result.is_err() {
        let _ = std::fs::remove_file(dest);
    }
    result
}

fn write_backup_inner(conn: &Connection, dest: &Path, prefs: Option<&str>) -> AppResult<()> {
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().to_string()])?;
    let out = Connection::open(dest)?;
    out.query_row("PRAGMA journal_mode = DELETE", [], |_| Ok(()))?;
    db::meta_set(&out, "backup_app_version", env!("CARGO_PKG_VERSION"))?;
    db::meta_set(
        &out,
        "backup_created_at",
        &chrono::Utc::now().timestamp_millis().to_string(),
    )?;
    if let Some(prefs) = prefs {
        db::meta_set(&out, "backup_ui_prefs", prefs)?;
    }
    Ok(())
}

pub fn read_info(path: &Path) -> AppResult<BackupInfo> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| not_a_backup())?;
    let check: String = conn
        .query_row("PRAGMA quick_check(1)", [], |r| r.get(0))
        .map_err(|_| not_a_backup())?;
    if check != "ok" {
        return Err(AppError::msg("Файл копии повреждён"));
    }
    if REQUIRED_TABLES.iter().any(|t| !has_table(&conn, t)) {
        return Err(not_a_backup());
    }
    let meta = |key: &str| db::meta_get(&conn, key).ok().flatten();
    let app_version = meta("backup_app_version");
    if let Some(v) = &app_version {
        if version_key(v) > version_key(env!("CARGO_PKG_VERSION")) {
            return Err(AppError::msg(format!(
                "Копия создана в более новой версии Nami ({v}). Обновите приложение"
            )));
        }
    }
    Ok(BackupInfo {
        games: count_rows(&conn, "games"),
        metrics: count_rows(&conn, "game_metrics"),
        earnings: count_rows(&conn, "game_earnings"),
        raw_responses: count_rows(&conn, "raw_responses"),
        created_at: meta("backup_created_at").and_then(|v| v.parse().ok()),
        app_version,
        ui_prefs: meta("backup_ui_prefs"),
        size: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
    })
}

fn table_names(conn: &Connection) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

fn column_names(conn: &Connection, schema: &str, table: &str) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT name FROM pragma_table_info(?1, ?2)")?;
    let rows = stmt.query_map([table, schema], |r| r.get::<_, String>(0))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// Копируем только общие колонки: копия из старой версии не ломает новую схему.
fn copy_table(conn: &Connection, table: &str) -> AppResult<()> {
    let dst = column_names(conn, "main", table)?;
    let src = column_names(conn, "backup", table)?;
    let common: Vec<String> = dst.into_iter().filter(|c| src.contains(c)).collect();
    let name = quote(table);
    conn.execute(&format!("DELETE FROM main.{name}"), [])?;
    if common.is_empty() {
        return Ok(());
    }
    let cols = common.iter().map(|c| quote(c)).collect::<Vec<_>>().join(", ");
    conn.execute(
        &format!("INSERT INTO main.{name} ({cols}) SELECT {cols} FROM backup.{name}"),
        [],
    )?;
    Ok(())
}

fn copy_all_tables(conn: &Connection) -> AppResult<()> {
    for table in table_names(conn)? {
        copy_table(conn, &table)?;
    }
    Ok(())
}

pub fn restore_into(conn: &Connection, src: &Path) -> AppResult<()> {
    conn.execute(
        "ATTACH DATABASE ?1 AS backup",
        [src.to_string_lossy().to_string()],
    )?;
    // Внешние ключи выключены на время подмены: таблицы очищаются не в порядке зависимостей.
    let result = conn
        .execute_batch("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;")
        .map_err(AppError::from)
        .and_then(|_| match copy_all_tables(conn) {
            Ok(()) => conn.execute_batch("COMMIT").map_err(AppError::from),
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                Err(e)
            }
        });
    let _ = conn.execute_batch("PRAGMA foreign_keys = ON; DETACH DATABASE backup;");
    result
}

pub fn staging_path(data_dir: &Path) -> PathBuf {
    data_dir.join(format!("import-staging.{FILE_EXT}"))
}

pub fn safety_copy_path(data_dir: &Path) -> PathBuf {
    data_dir.join("backups").join(format!(
        "before-import-{}.{FILE_EXT}",
        Local::now().format("%Y%m%d-%H%M%S")
    ))
}

pub fn prune_safety_copies(data_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(data_dir.join("backups")) else {
        return;
    };
    let mut names: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("before-import-"))
        })
        .collect();
    names.sort();
    while names.len() > SAFETY_COPIES_KEPT {
        let _ = std::fs::remove_file(names.remove(0));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nami-backup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn game(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO games(id, title, first_seen_at, last_seen_at) VALUES(?1, ?1, 1, 1)",
            [id],
        )
        .unwrap();
    }

    fn game_ids(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("SELECT id FROM games ORDER BY id").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    }

    #[test]
    fn roundtrip_replaces_current_data() {
        let dir = temp_dir();
        let source = db::open_database(&dir.join("a.sqlite")).unwrap();
        game(&source, "one");
        db::meta_set(&source, "tax_rate", "6").unwrap();
        let file = dir.join("copy.nami");
        write_backup(&source, &file, Some("{\"fa.period\":\"year\"}")).unwrap();

        let info = read_info(&file).unwrap();
        assert_eq!(info.games, 1);
        assert_eq!(info.ui_prefs.as_deref(), Some("{\"fa.period\":\"year\"}"));
        assert_eq!(info.app_version.as_deref(), Some(env!("CARGO_PKG_VERSION")));

        let target = db::open_database(&dir.join("b.sqlite")).unwrap();
        game(&target, "other");
        restore_into(&target, &file).unwrap();
        assert_eq!(game_ids(&target), vec!["one".to_string()]);
        assert_eq!(db::meta_get(&target, "tax_rate").unwrap().as_deref(), Some("6"));
        let fk: i64 = target.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn restore_accepts_older_schema() {
        let dir = temp_dir();
        let old_path = dir.join("old.nami");
        let old = Connection::open(&old_path).unwrap();
        old.execute_batch(
            "CREATE TABLE games(id TEXT PRIMARY KEY, title TEXT, first_seen_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
             CREATE TABLE raw_responses(id INTEGER PRIMARY KEY AUTOINCREMENT);
             INSERT INTO games VALUES('legacy', 'Legacy', 1, 1);",
        )
        .unwrap();
        drop(old);

        let target = db::open_database(&dir.join("b.sqlite")).unwrap();
        restore_into(&target, &old_path).unwrap();
        db::ensure_schema(&target).unwrap();
        assert_eq!(game_ids(&target), vec!["legacy".to_string()]);
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn read_info_rejects_foreign_files() {
        let dir = temp_dir();
        let junk = dir.join("junk.nami");
        std::fs::write(&junk, b"not a database at all").unwrap();
        assert!(read_info(&junk).is_err());

        let other = dir.join("other.nami");
        Connection::open(&other)
            .unwrap()
            .execute_batch("CREATE TABLE t(x)")
            .unwrap();
        assert!(read_info(&other).is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn read_info_rejects_newer_version() {
        let dir = temp_dir();
        let source = db::open_database(&dir.join("a.sqlite")).unwrap();
        let file = dir.join("copy.nami");
        write_backup(&source, &file, None).unwrap();
        let copy = Connection::open(&file).unwrap();
        db::meta_set(&copy, "backup_app_version", "99.0.0").unwrap();
        drop(copy);
        assert!(read_info(&file).is_err());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn prune_keeps_latest_safety_copies() {
        let dir = temp_dir();
        let backups = dir.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        for n in 1..=5 {
            std::fs::write(backups.join(format!("before-import-2026010{n}-000000.nami")), b"x").unwrap();
        }
        prune_safety_copies(&dir);
        let left = std::fs::read_dir(&backups).unwrap().count();
        assert_eq!(left, SAFETY_COPIES_KEPT);
        assert!(!backups.join("before-import-20260101-000000.nami").exists());
        std::fs::remove_dir_all(dir).ok();
    }
}
