# ![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use tauri::{Manager, WindowEvent};

mod commands;
mod config;
mod markdown;
mod state;
mod sync;
fn main() {
    simple_logger::SimpleLogger::new()
        .with_level(log::LevelFilter::Warn)
        .init()
        .expect("Failed to initialize logger");
    
    log::info!("Starting comind application");
    
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_handle = app.handle();

            let config_dir = app_handle
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            let app_config = config::AppConfig::load(&config_dir).unwrap_or_default();

            let db_path = config::get_db_path(&app_handle, &app_config);

            if !db_path.exists() {
                std::fs::create_dir_all(&db_path).expect("Failed to create database directory");
            }

            let db =
                state::DatabaseConnection::new(&db_path).expect("Failed to initialize database");
            app.manage(db);

            let config_manager = state::ConfigManager::new(app_config);
            app.manage(config_manager);
            app.manage(config_dir);

            sync::start_sync_task(app_handle.clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(focused) = event {
                let app_handle = window.app_handle();
                if !focused {
                    sync::sync_on_minimize(app_handle.clone());
                } else {
                    sync::sync_on_focus(app_handle.clone());
                }
            }
            if let WindowEvent::CloseRequested { .. } = event {
                let app_handle = window.app_handle();
                sync::sync_on_exit(app_handle.clone());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_block,
            commands::get_blocks_by_page,
            commands::get_page,
            commands::get_all_pages,
            commands::get_backlinks,
            commands::get_outlinks,
            commands::search,
            commands::get_properties,
            commands::get_relationship_types,
            commands::save_block_tree,
            commands::save_page,
            commands::delete_page_cascade,
            commands::set_property,
            commands::delete_property,
            commands::execute_batch,
            commands::get_db_path,
            commands::set_db_path,
            commands::reset_db_path,
            commands::export_to_markdown,
            commands::import_from_markdown,
            commands::get_sync_config,
            commands::set_sync_config,
            commands::sync_now,
            commands::trigger_sync,
            commands::create_block_version,
            commands::get_block_versions,
            commands::get_block_version_by_id,
            commands::restore_block_version,
            commands::cleanup_block_versions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
