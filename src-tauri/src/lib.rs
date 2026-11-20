pub mod analytics;
mod backup;
mod commands;
mod db;
mod demo;
mod error;
mod extension_install;
mod ingest;
mod migrate;
pub mod normalize;
mod state;

use crate::state::AppState;
use std::sync::Arc;
use tauri::Manager;

pub const INGEST_PORT: u16 = 17321;

fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| std::path::PathBuf::from("."));

            migrate::migrate_legacy_data()?;
            let data_dir = db::default_data_dir();
            let db_path = db::default_db_path();
            let want_demo =
                crate::state::AppState::can_use_demo() && db::read_demo_mode_flag(&data_dir);

            let conn = db::open_database(&db_path)?;
            crate::normalize::reprocess_if_outdated(&conn);
            let token = commands::load_or_create_token(&data_dir)?;

            let state = Arc::new(AppState::new(
                conn,
                token,
                data_dir,
                app_root,
                INGEST_PORT,
                want_demo,
            )?);

            {
                let db = state.db.lock();
                if let Err(e) = analytics::warm_memos(&db) {
                    tracing::warn!(error = %e, "warm_memos failed");
                }
            }

            ingest::start_ingest_server(state.clone(), app.handle().clone(), INGEST_PORT)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_info,
            commands::get_overview,
            commands::get_collector,
            commands::list_accounts,
            commands::list_games,
            commands::games_screen,
            commands::games_heatmap,
            commands::list_earn_months,
            commands::upsert_manual_earn_month,
            commands::delete_manual_earn_month,
            commands::tax_sheet,
            commands::set_tax_settings,
            commands::analytics_overview,
            commands::get_freshness,
            commands::get_data_coverage,
            commands::get_db_stats,
            commands::list_history,
            commands::list_requests,
            commands::list_raw,
            commands::get_raw,
            commands::clear_raw,
            commands::reprocess,
            commands::analytics_game,
            commands::analytics_metrics,
            commands::analytics_compare,
            commands::analytics_geography,
            commands::analytics_platforms,
            commands::analytics_reviews,
            commands::analytics_purchases,
            commands::analytics_earnings,
            commands::list_earn_daily,
            commands::export_game,
            commands::save_report,
            commands::open_extension_folder,
            commands::open_extension_install,
            commands::pack_extension,
            commands::get_demo_state,
            commands::set_demo_mode,
            commands::reset_demo_data,
            backup::export_backup,
            backup::pick_backup,
            backup::import_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nami");
}
