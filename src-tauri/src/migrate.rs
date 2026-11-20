use crate::db;
use crate::error::{AppError, AppResult};
use rusqlite::Connection;
use std::path::Path;

const DB_RENAMES: [(&str, &str); 2] = [
    (db::LEGACY_DB_FILE, db::DB_FILE),
    (db::LEGACY_DEMO_DB_FILE, db::DEMO_DB_FILE),
];

/// Переносит данные из каталога прежнего названия приложения. Вызывается до открытия баз.
pub fn migrate_legacy_data() -> AppResult<bool> {
    let old_root = db::app_dir(db::LEGACY_APP_DIR_NAME);
    let new_root = db::app_data_root();
    migrate_dirs(&old_root, &new_root).map_err(|e| {
        AppError::msg(format!(
            "Не удалось перенести данные из {} в {}: {e}. Данные не тронуты — закройте программы, использующие эти папки, и запустите Nami снова",
            old_root.display(),
            new_root.display()
        ))
    })
}

/// Переносится только `data/`: остальное в старой папке — кэши Electron.
pub(crate) fn migrate_dirs(old_root: &Path, new_root: &Path) -> AppResult<bool> {
    let old_data = old_root.join("data");
    let new_data = new_root.join("data");
    if !old_data.is_dir() || new_data.exists() {
        return Ok(false);
    }
    std::fs::create_dir_all(new_root)?;
    std::fs::rename(&old_data, &new_data)?;
    for (legacy, current) in DB_RENAMES {
        rename_database(&new_data, legacy, current)?;
    }
    let _ = std::fs::remove_dir(old_root);
    tracing::info!(from = %old_root.display(), to = %new_root.display(), "app data migrated");
    Ok(true)
}

/// Перед переименованием WAL сливается в основной файл: -wal/-shm привязаны к имени базы.
fn rename_database(dir: &Path, legacy: &str, current: &str) -> AppResult<()> {
    let from = dir.join(legacy);
    let to = dir.join(current);
    if !from.exists() || to.exists() {
        return Ok(());
    }
    if let Ok(conn) = Connection::open(&from) {
        let _ = conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
    }
    for suffix in ["-wal", "-shm"] {
        let side = dir.join(format!("{legacy}{suffix}"));
        if side.exists() {
            std::fs::rename(&side, dir.join(format!("{current}{suffix}")))?;
        }
    }
    std::fs::rename(&from, &to)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("nami-migrate-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn legacy_layout(root: &Path) {
        let data = root.join("data");
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("ingest-token.txt"), "token-123").unwrap();
        std::fs::write(data.join("demo_mode"), "0").unwrap();
        std::fs::write(root.join("Cookies"), "electron").unwrap();
        let conn = db::open_database(&data.join(db::LEGACY_DB_FILE)).unwrap();
        conn.execute(
            "INSERT INTO games(id, title, first_seen_at, last_seen_at) VALUES('g1', 'Game', 1, 1)",
            [],
        )
        .unwrap();
        let demo = db::open_database(&data.join(db::LEGACY_DEMO_DB_FILE)).unwrap();
        db::meta_set(&demo, "demo_seeded", "1").unwrap();
    }

    #[test]
    fn moves_data_and_renames_databases() {
        let base = temp_dir();
        let old_root = base.join("founders-analytics");
        let new_root = base.join("Nami");
        legacy_layout(&old_root);

        assert!(migrate_dirs(&old_root, &new_root).unwrap());

        let data = new_root.join("data");
        assert_eq!(std::fs::read_to_string(data.join("ingest-token.txt")).unwrap(), "token-123");
        assert!(!data.join(db::LEGACY_DB_FILE).exists());
        assert!(!data.join(db::LEGACY_DEMO_DB_FILE).exists());
        let conn = db::open_database(&data.join(db::DB_FILE)).unwrap();
        let games: i64 = conn.query_row("SELECT COUNT(*) FROM games", [], |r| r.get(0)).unwrap();
        assert_eq!(games, 1);
        let demo = db::open_database(&data.join(db::DEMO_DB_FILE)).unwrap();
        assert_eq!(db::meta_get(&demo, "demo_seeded").unwrap().as_deref(), Some("1"));
        assert!(old_root.join("Cookies").exists());
        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn second_run_and_fresh_install_do_nothing() {
        let base = temp_dir();
        let old_root = base.join("founders-analytics");
        let new_root = base.join("Nami");
        assert!(!migrate_dirs(&old_root, &new_root).unwrap());

        legacy_layout(&old_root);
        assert!(migrate_dirs(&old_root, &new_root).unwrap());
        assert!(!migrate_dirs(&old_root, &new_root).unwrap());
        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn existing_new_data_is_never_overwritten() {
        let base = temp_dir();
        let old_root = base.join("founders-analytics");
        let new_root = base.join("Nami");
        legacy_layout(&old_root);
        std::fs::create_dir_all(new_root.join("data")).unwrap();
        std::fs::write(new_root.join("data").join("marker"), "keep").unwrap();

        assert!(!migrate_dirs(&old_root, &new_root).unwrap());
        assert!(new_root.join("data").join("marker").exists());
        assert!(old_root.join("data").join(db::LEGACY_DB_FILE).exists());
        std::fs::remove_dir_all(base).ok();
    }
}
