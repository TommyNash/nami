use crate::db;
use crate::demo;
use crate::error::{AppError, AppResult};
use parking_lot::Mutex;
use rusqlite::Connection;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct AppState {
    /// Активная БД для UI и аналитики (live или demo).
    pub db: Mutex<Connection>,
    /// Всегда рабочая БД — сюда пишет ingest, даже в демо-режиме.
    pub ingest_db: Mutex<Connection>,
    pub demo_mode: AtomicBool,
    pub live_db_path: PathBuf,
    pub demo_db_path: PathBuf,
    pub token: Mutex<String>,
    pub data_dir: PathBuf,
    pub app_root: PathBuf,
    pub ingest_port: u16,
    pub last_connection: Arc<Mutex<Option<i64>>>,
    /// Готовые срезы аналитики: повторное переключение фильтра не ходит в SQLite.
    screen_cache: Mutex<ScreenCache>,
}

struct ScreenCache {
    map: HashMap<String, Value>,
    order: VecDeque<String>,
}

const SCREEN_CACHE_CAP: usize = 128;

impl AppState {
    pub fn new(
        live_db: Connection,
        token: String,
        data_dir: PathBuf,
        app_root: PathBuf,
        ingest_port: u16,
        demo_mode: bool,
    ) -> AppResult<Self> {
        let live_db_path = db::default_db_path();
        let demo_db_path = db::demo_db_path();

        let (ui_db, ingest_db) = if demo_mode {
            let demo = db::open_database(&demo_db_path)?;
            demo::seed_demo(&demo, false)?;
            (demo, live_db)
        } else {
            // Второй коннект к live (WAL) для UI; ingest держит первый.
            let ui = db::open_database(&live_db_path)?;
            (ui, live_db)
        };

        Ok(Self {
            db: Mutex::new(ui_db),
            ingest_db: Mutex::new(ingest_db),
            demo_mode: AtomicBool::new(demo_mode),
            live_db_path,
            demo_db_path,
            token: Mutex::new(token),
            data_dir,
            app_root,
            ingest_port,
            last_connection: Arc::new(Mutex::new(None)),
            screen_cache: Mutex::new(ScreenCache {
                map: HashMap::new(),
                order: VecDeque::new(),
            }),
        })
    }

    pub fn screen_cached(&self, key: &str) -> Option<Value> {
        let mut cache = self.screen_cache.lock();
        if !cache.map.contains_key(key) {
            return None;
        }
        if let Some(pos) = cache.order.iter().position(|k| k == key) {
            cache.order.remove(pos);
        }
        cache.order.push_back(key.to_string());
        cache.map.get(key).cloned()
    }

    pub fn screen_store(&self, key: String, value: Value) {
        let mut cache = self.screen_cache.lock();
        if cache.map.contains_key(&key) {
            if let Some(pos) = cache.order.iter().position(|k| k == &key) {
                cache.order.remove(pos);
            }
        } else {
            while cache.map.len() >= SCREEN_CACHE_CAP {
                let Some(old) = cache.order.pop_front() else {
                    break;
                };
                cache.map.remove(&old);
            }
        }
        cache.order.push_back(key.clone());
        cache.map.insert(key, value);
    }

    pub fn clear_screen_cache(&self) {
        let mut cache = self.screen_cache.lock();
        cache.map.clear();
        cache.order.clear();
        drop(cache);
        crate::analytics::clear_earn_memo();
    }

    pub fn last_connection_at(&self) -> Option<i64> {
        *self.last_connection.lock()
    }

    pub fn is_demo(&self) -> bool {
        self.demo_mode.load(Ordering::SeqCst)
    }

    pub fn can_use_demo() -> bool {
        cfg!(debug_assertions) || std::env::var_os("FA_ALLOW_DEMO").is_some()
    }

    pub fn set_demo_mode(&self, enabled: bool) -> AppResult<()> {
        if enabled && !Self::can_use_demo() {
            return Err(AppError::Msg(
                "Демо-режим доступен только в debug-сборке".into(),
            ));
        }
        if enabled == self.is_demo() {
            return Ok(());
        }
        if enabled {
            let conn = db::open_database(&self.demo_db_path)?;
            demo::seed_demo(&conn, false)?;
            *self.db.lock() = conn;
        } else {
            let conn = db::open_database(&self.live_db_path)?;
            *self.db.lock() = conn;
        }
        self.demo_mode.store(enabled, Ordering::SeqCst);
        self.clear_screen_cache();
        db::write_demo_mode_flag(&self.data_dir, enabled)?;
        Ok(())
    }

    pub fn reset_demo_data(&self) -> AppResult<()> {
        if !Self::can_use_demo() {
            return Err(AppError::Msg(
                "Демо-режим доступен только в debug-сборке".into(),
            ));
        }
        let conn = db::open_database(&self.demo_db_path)?;
        demo::seed_demo(&conn, true)?;
        if self.is_demo() {
            *self.db.lock() = conn;
        }
        self.clear_screen_cache();
        Ok(())
    }
}
