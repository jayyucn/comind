use tauri::{Manager, WindowEvent};

mod assets;
mod commands;
mod config;
mod markdown;
mod state;
mod sync;
#[cfg(not(target_os = "android"))]
mod sync_server;
#[cfg(any(target_os = "android", test))]
mod sync_client;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    simple_logger::SimpleLogger::new()
        .with_level(log::LevelFilter::Warn)
        .init()
        .expect("Failed to initialize logger");

    log::info!("Starting comind application");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_handle = app.handle();

            let config_dir = app_handle
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            let app_config = config::AppConfig::load(&config_dir).unwrap_or_default();

            let workspace = config::get_workspace_path(&app_handle, &app_config);

            // 创建 workspace 子目录：sqlite/ 和 markdown/
            std::fs::create_dir_all(workspace.join("sqlite"))
                .expect("Failed to create sqlite directory");
            std::fs::create_dir_all(workspace.join("markdown"))
                .expect("Failed to create markdown directory");

            let db =
                state::DatabaseConnection::new(&workspace).expect("Failed to initialize database");
            // Get adapter before db is moved into manage
            let notif_adapter = db.adapter_arc();
            #[cfg(not(target_os = "android"))]
            let sync_adapter = db.adapter_arc();
            app.manage(db);

            // Seed + load notification settings (synchronous, runs at startup)
            {
                use comind_core::StorageAdapter;
                let mut adapter = notif_adapter.blocking_lock();
                if let Err(e) = comind_core::SQLiteAdapter::seed_notification_config(&adapter.conn) {
                    log::error!("Failed to seed notification config: {}", e);
                }
                let config = adapter
                    .notification_config()
                    .get()
                    .unwrap_or_default();
                drop(adapter);
                let notif_mgr = state::NotificationSettingsManager::new(config);
                app.manage(notif_mgr);
            }

            let config_manager = state::ConfigManager::new(app_config);
            app.manage(config_manager);
            app.manage(config_dir.clone());

            let sync_server_handle = state::SyncServerHandle::new();
            app.manage(sync_server_handle.clone());

            #[cfg(not(target_os = "android"))]
            {
                let db_path_for_sync = config::get_db_path(&workspace);
                let config_clone = config::AppConfig::load(&config_dir).unwrap_or_default();
                let device_name = config_clone.device_name;

                tauri::async_runtime::spawn(async move {
                    log::info!("SyncServer: initializing with db_path={}", db_path_for_sync.display());
                    let mut server = match sync_server::SyncServer::with_adapter(&db_path_for_sync, device_name, sync_adapter) {
                        Ok(s) => {
                            log::info!("SyncServer: created successfully");
                            s
                        }
                        Err(e) => {
                            log::error!("Failed to create SyncServer: {}", e);
                            return;
                        }
                    };

                    if let Err(e) = server.start(8080).await {
                        log::error!("Failed to start SyncServer: {}", e);
                        return;
                    }
                    log::info!("SyncServer: started on port 8080");

                    sync_server_handle.set_server(server).await;
                });
            }

            sync::start_sync_task(app_handle.clone());

            // 移动端注册扫码插件
            #[cfg(mobile)]
            {
                app.handle().plugin(tauri_plugin_barcode_scanner::init())
                    .expect("failed to init barcode-scanner plugin");
            }

            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title("comind [DEV]");
                }
            }

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
            commands::get_block_cards,
            commands::get_saved_filters,
            commands::save_saved_filter,
            commands::update_saved_filter,
            commands::delete_saved_filter,
            commands::upsert_book_highlight,
            commands::delete_book_highlight,
            commands::get_book_highlights,
            commands::get_book_progress,
            commands::upsert_book_progress,
            commands::get_screen_views,
            commands::create_screen,
            commands::create_tab,
            commands::update_screen,
            commands::update_tab,
            commands::delete_screen,
            commands::delete_screen_view,
            commands::set_default_screen,
            commands::get_page,
            commands::get_all_pages,
            commands::get_trash_pages,
            commands::get_ideas_pages_by_month,
            commands::get_ideas_months,
            commands::ensure_today_ideas_page,
            commands::get_backlinks,
            commands::get_outlinks,
            commands::search,
            commands::get_properties,
            commands::get_relationship_types,
            commands::get_templates,
            commands::save_block_tree,
            commands::delete_block,
            commands::save_page,
            commands::delete_page_cascade,
            commands::set_property,
            commands::delete_property,
            commands::execute_batch,
            commands::get_db_path,
            commands::get_workspace_path,
            commands::set_workspace_path,
            commands::reset_workspace_path,
            commands::open_workspace_path,
            commands::save_asset_file,
            commands::read_asset_file,
            commands::delete_asset_file,
            commands::save_book_file,
            commands::read_book_file,
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
            commands::delete_block_version,
            commands::get_notification,
            commands::get_notifications_by_block,
            commands::query_unread_notifications,
            commands::query_recent_notifications,
            commands::create_notification,
            commands::batch_create_notifications,
            commands::update_notification_status,
            commands::update_notification_payload,
            commands::set_notification_snooze,
            commands::delete_notification,
            commands::cleanup_notifications,
            commands::mark_all_notifications_read,
            commands::query_date_refs,
            commands::query_overdue_date_refs,
            commands::get_date_refs_by_block,
            commands::get_date_refs_by_page,
            commands::query_due_non_recurring_date_refs,
            commands::query_all_recurring_date_refs,
            commands::query_incomplete_tasks,
            commands::batch_check_and_fire_data,
            commands::build_graph_snapshot,
            commands::rebuild_date_refs,
            commands::get_notification_settings,
            commands::save_notification_settings,
            commands::check_and_fire,
            commands::sync_payload_for_block,
            commands::apply_relationship_type_to_block_content,
            commands::extract_links_from_content,
            commands::check_has_typed_link_to_target,
            // S6: date-parser / recurrence / journal-detect
            commands::parse_date_input,
            commands::parse_date_time_input,
            commands::calculate_next_recurrence,
            commands::is_journal_title,
            commands::normalize_journal_title,
            commands::is_today_title,
            commands::renumber_blocks,
            commands::build_document_order,
            commands::get_page_with_blocks,
            commands::get_pages_with_blocks,
            #[cfg(not(target_os = "android"))]
            commands::get_sync_qr,
            commands::get_paired_devices,
            commands::unpair_device,
            #[cfg(not(target_os = "android"))]
            commands::trigger_full_sync,
            #[cfg(not(target_os = "android"))]
            commands::get_sync_status,
            #[cfg(target_os = "android")]
            commands::connect_to_server,
            #[cfg(target_os = "android")]
            commands::disconnect_sync,
            #[cfg(target_os = "android")]
            commands::get_sync_status,
            #[cfg(target_os = "android")]
            commands::trigger_full_sync_mobile,
            #[cfg(target_os = "android")]
            commands::auto_reconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
