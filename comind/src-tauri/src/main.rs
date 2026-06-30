use tauri::Manager;
use std::path::Path;

mod commands;
mod state;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_handle = app.handle();
            let data_dir = app_handle.path().app_data_dir()
                .expect("Failed to get app data directory");
            
            if !data_dir.exists() {
                std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");
            }

            let db = state::DatabaseConnection::new(&data_dir)
                .expect("Failed to initialize database");
            app.manage(db);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_block,
            commands::get_blocks_by_page,
            commands::get_page,
            commands::get_all_pages,
            commands::get_backlinks,
            commands::search,
            commands::get_properties,
            commands::get_relationship_types,
            commands::save_block_tree,
            commands::save_page,
            commands::delete_page_cascade,
            commands::set_property,
            commands::delete_property,
            commands::execute_batch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
