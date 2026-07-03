use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::time::{interval, timeout};

use crate::{config::AppConfig, markdown, state::DatabaseConnection, state::ConfigManager};

pub static LAST_FULL_SYNC_TIME: AtomicI64 = AtomicI64::new(0);
pub static SYNC_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

fn get_config_clone(app_handle: &AppHandle) -> Option<AppConfig> {
    let config_manager = app_handle.state::<ConfigManager>();
    config_manager.get_config().ok().map(|c| c.clone())
}

pub fn start_sync_task(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = interval(Duration::from_secs(5));

        loop {
            interval.tick().await;

            let config = match get_config_clone(&app_handle) {
                Some(c) => c,
                None => {
                    log::warn!("Failed to get config for sync task");
                    continue;
                }
            };
            
            if !config.sync_enabled {
                continue;
            }

            let sync_dir = match &config.sync_directory {
                Some(d) => d.clone(),
                None => continue,
            };

            if SYNC_IN_PROGRESS.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
                continue;
            }

            let app_handle_clone = app_handle.clone();
            let sync_dir_clone = sync_dir.clone();

            tauri::async_runtime::spawn_blocking(move || {
                match app_handle_clone.state::<DatabaseConnection>().get_adapter() {
                    Ok(mut adapter) => {
                        let _ = markdown::export_changed(&mut *adapter, Path::new(&sync_dir_clone));
                    }
                    Err(e) => {
                        log::warn!("Failed to get database adapter for sync: {}", e);
                    }
                };
            }).await.ok();

            SYNC_IN_PROGRESS.store(false, Ordering::SeqCst);
        }
    });
}

pub fn sync_on_exit(app_handle: AppHandle) {
    let config = match get_config_clone(&app_handle) {
        Some(c) => c,
        None => {
            log::warn!("Failed to get config for exit sync");
            return;
        }
    };
    
    if !config.sync_enabled {
        return;
    }
    
    let sync_dir = match &config.sync_directory {
        Some(d) => d.clone(),
        None => return,
    };

    tauri::async_runtime::spawn(async move {
        if SYNC_IN_PROGRESS.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return;
        }

        let _ = timeout(
            Duration::from_secs(3),
            tauri::async_runtime::spawn_blocking(move || {
                match app_handle.state::<DatabaseConnection>().get_adapter() {
                    Ok(mut adapter) => {
                        let _ = markdown::export_all(&mut *adapter, Path::new(&sync_dir));
                    }
                    Err(e) => {
                        log::warn!("Failed to get database adapter for exit sync: {}", e);
                    }
                };
            }),
        ).await;

        SYNC_IN_PROGRESS.store(false, Ordering::SeqCst);
    });
}

pub fn sync_on_minimize(app_handle: AppHandle) {
    let config = match get_config_clone(&app_handle) {
        Some(c) => c,
        None => {
            log::warn!("Failed to get config for minimize sync");
            return;
        }
    };
    
    if !config.sync_enabled {
        return;
    }
    
    let sync_dir = match &config.sync_directory {
        Some(d) => d.clone(),
        None => return,
    };

    tauri::async_runtime::spawn(async move {
        if SYNC_IN_PROGRESS.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return;
        }

        tauri::async_runtime::spawn_blocking(move || {
            match app_handle.state::<DatabaseConnection>().get_adapter() {
                Ok(mut adapter) => {
                    let _ = markdown::export_changed(&mut *adapter, Path::new(&sync_dir));
                }
                Err(e) => {
                    log::warn!("Failed to get database adapter for sync: {}", e);
                }
            };
        }).await.ok();

        SYNC_IN_PROGRESS.store(false, Ordering::SeqCst);
    });
}

pub fn sync_on_focus(app_handle: AppHandle) {
    let now = chrono::Utc::now().timestamp_millis();
    let last_full_sync = LAST_FULL_SYNC_TIME.load(Ordering::SeqCst);

    if now - last_full_sync < 3600000 {
        return;
    }

    let config = match get_config_clone(&app_handle) {
        Some(c) => c,
        None => {
            log::warn!("Failed to get config for focus sync");
            return;
        }
    };
    
    if !config.sync_enabled {
        return;
    }
    
    let sync_dir = match &config.sync_directory {
        Some(d) => d.clone(),
        None => return,
    };

    tauri::async_runtime::spawn(async move {
        if SYNC_IN_PROGRESS.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return;
        }

        let app_handle_clone = app_handle.clone();
        let sync_dir_clone = sync_dir.clone();

        tauri::async_runtime::spawn_blocking(move || {
            match app_handle_clone.state::<DatabaseConnection>().get_adapter() {
                Ok(mut adapter) => {
                    let _ = markdown::export_all(&mut *adapter, Path::new(&sync_dir_clone));
                    LAST_FULL_SYNC_TIME.store(chrono::Utc::now().timestamp_millis(), Ordering::SeqCst);
                }
                Err(e) => {
                    log::warn!("Failed to get database adapter for focus sync: {}", e);
                }
            };
        }).await.ok();

        SYNC_IN_PROGRESS.store(false, Ordering::SeqCst);
    });
}
