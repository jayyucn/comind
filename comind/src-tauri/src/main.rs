use tauri::Manager;
use std::path::Path;

mod commands;
mod state;
mod config;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            
            let config_dir = app_handle.path().app_data_dir()
                .expect("Failed to get app data directory");
            
            let app_config = config::AppConfig::load(&config_dir).unwrap_or_default();
            
            let db_path = config::get_db_path(&app_handle, &app_config);
            
            if !db_path.exists() {
                std::fs::create_dir_all(&db_path).expect("Failed to create database directory");
            }

            let db = state::DatabaseConnection::new(&db_path)
                .expect("Failed to initialize database");
            app.manage(db);
            
            app.manage(app_config);
            app.manage(config_dir);

            Ok(())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
