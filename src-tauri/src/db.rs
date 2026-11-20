use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OptionalExtension};
use std::path::{Path, PathBuf};

pub const SCHEMA_SQL: &str = include_str!("schema.sql");

const APP_DIR_NAME: &str = "Nami";
pub const LEGACY_APP_DIR_NAME: &str = "founders-analytics";
pub const DB_FILE: &str = "nami.sqlite";
pub const DEMO_DB_FILE: &str = "nami-demo.sqlite";
pub const LEGACY_DB_FILE: &str = "founders.sqlite";
pub const LEGACY_DEMO_DB_FILE: &str = "founders-demo.sqlite";

fn home_dir() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE")
            .or_else(|| std::env::var_os("HOME"))
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
    }
}

/// Каталог данных приложения по имени папки:
/// - macOS:   ~/Library/Application Support/<name>
/// - Windows: %APPDATA%\<name>
/// - Linux:   $XDG_DATA_HOME/<name> или ~/.local/share/<name>
pub fn app_dir(name: &str) -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home_dir().join("Library").join("Application Support").join(name)
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join("AppData").join("Roaming"))
            .join(name)
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join(".local").join("share"))
            .join(name)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        home_dir().join(format!(".{name}"))
    }
}

pub fn app_data_root() -> PathBuf {
    app_dir(APP_DIR_NAME)
}

/// Directory that holds SQLite + ingest token (`…/data`).
pub fn default_data_dir() -> PathBuf {
    app_data_root().join("data")
}

pub fn default_db_path() -> PathBuf {
    default_data_dir().join(DB_FILE)
}

pub fn demo_db_path() -> PathBuf {
    default_data_dir().join(DEMO_DB_FILE)
}

fn demo_mode_flag_path(data_dir: &Path) -> PathBuf {
    data_dir.join("demo_mode")
}

pub fn read_demo_mode_flag(data_dir: &Path) -> bool {
    std::fs::read_to_string(demo_mode_flag_path(data_dir))
        .map(|s| matches!(s.trim(), "1" | "true" | "yes"))
        .unwrap_or(false)
}

pub fn write_demo_mode_flag(data_dir: &Path, enabled: bool) -> AppResult<()> {
    if let Some(parent) = data_dir.parent() {
        let _ = std::fs::create_dir_all(data_dir);
        let _ = parent;
    } else {
        std::fs::create_dir_all(data_dir)?;
    }
    std::fs::create_dir_all(data_dir)?;
    std::fs::write(
        demo_mode_flag_path(data_dir),
        if enabled { "1" } else { "0" },
    )?;
    Ok(())
}

pub fn open_database(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
    ensure_schema(&conn)?;
    Ok(conn)
}

pub fn ensure_schema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    migrate(conn)
}

fn migrate(conn: &Connection) -> AppResult<()> {
    let raw_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(raw_responses)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !raw_cols.iter().any(|c| c == "normalized") {
        conn.execute_batch(
            "ALTER TABLE raw_responses ADD COLUMN normalized INTEGER NOT NULL DEFAULT 0;",
        )?;
    }
    let game_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(games)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !game_cols.iter().any(|c| c == "icon_url") {
        conn.execute_batch("ALTER TABLE games ADD COLUMN icon_url TEXT;")?;
    }
    // accounts появилась позже schema.sql на свежих БД; на старых — CREATE IF NOT EXISTS.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS accounts (
           id TEXT PRIMARY KEY,
           title TEXT,
           login TEXT,
           avatar_url TEXT,
           last_seen_at INTEGER NOT NULL,
           created_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_games_owner ON games(owner_id);",
    )?;
    // Ручные месячные доходы (налог / старая оплата) — не из консоли.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS manual_earn_months (
           account_id TEXT NOT NULL DEFAULT '',
           month_key TEXT NOT NULL,
           earn REAL NOT NULL,
           note TEXT,
           updated_at INTEGER NOT NULL,
           PRIMARY KEY (account_id, month_key)
         );",
    )?;
    Ok(())
}

#[allow(dead_code)] // DEBT-W1: helpers while storage migrates
pub fn meta_get(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .map_err(AppError::from)
}

#[allow(dead_code)] // DEBT-W1: helpers while storage migrates
pub fn meta_set(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}
