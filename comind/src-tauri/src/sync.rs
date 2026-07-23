use chrono::Utc;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::time::{interval, timeout};

use crate::{config::AppConfig, markdown, state::ConfigManager, state::DatabaseConnection};

pub static LAST_FULL_SYNC_TIME: AtomicI64 = AtomicI64::new(0);
pub static SYNC_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
pub static IS_FIRST_SYNC: AtomicBool = AtomicBool::new(true);

fn get_config_clone(app_handle: &AppHandle) -> Option<AppConfig> {
    let config_manager = app_handle.state::<ConfigManager>();
    config_manager.get_config().ok().map(|c| c.clone())
}

pub fn start_sync_task(app_handle: AppHandle) {
    log::info!("Starting periodic sync task");
    tauri::async_runtime::spawn(async move {
        let mut interval_secs: u64 = match get_config_clone(&app_handle) {
            Some(c) => {
                log::info!(
                    "Initial sync interval from config: {}s",
                    c.sync_interval_secs
                );
                c.sync_interval_secs
            }
            None => {
                log::warn!("Failed to get config, using default 5s interval");
                5
            }
        };
        let mut sync_interval = interval(Duration::from_secs(interval_secs));

        loop {
            sync_interval.tick().await;

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

            if config.sync_interval_secs != interval_secs {
                interval_secs = config.sync_interval_secs;
                sync_interval = interval(Duration::from_secs(interval_secs));
                log::info!("Sync interval changed to {}s", interval_secs);
            }

            if SYNC_IN_PROGRESS
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                continue;
            }

            log::info!("Starting periodic sync to directory: {}", sync_dir);

            let is_first = IS_FIRST_SYNC
                .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok();

            match app_handle.state::<DatabaseConnection>().get_adapter() {
                Ok(mut adapter) => {
                    if is_first {
                        log::info!("First sync detected, performing full export");
                        match markdown::export_all(&mut *adapter, Path::new(&sync_dir)) {
                            Ok(result) => {
                                log::info!(
                                    "Periodic sync (full) completed: {} pages, {} blocks",
                                    result.pages_exported,
                                    result.blocks_exported
                                );
                            }
                            Err(e) => {
                                log::error!("Full sync failed: {}", e);
                            }
                        }
                    } else {
                        let result = markdown::export_changed(&mut *adapter, Path::new(&sync_dir));
                        match result {
                            Ok(result) => {
                                if result.last_sync_time > Utc::now().timestamp_millis() {
                                    log::warn!("last_sync_time ({}) is in the future, performing full export", result.last_sync_time);
                                    match markdown::export_all(&mut *adapter, Path::new(&sync_dir))
                                    {
                                        Ok(full_result) => {
                                            log::info!("Periodic sync (full) completed: {} pages, {} blocks", full_result.pages_exported, full_result.blocks_exported);
                                        }
                                        Err(e) => {
                                            log::error!("Full sync failed: {}", e);
                                        }
                                    }
                                } else {
                                    log::info!(
                                        "Periodic sync completed: {} pages, {} blocks",
                                        result.pages_exported,
                                        result.blocks_exported
                                    );
                                }
                            }
                            Err(e) => {
                                log::error!("Periodic sync failed: {}", e);
                            }
                        }
                    }
                }
                Err(e) => {
                    log::error!("Failed to get database adapter for sync: {}", e);
                }
            };

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
        if SYNC_IN_PROGRESS
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }

        let _ = timeout(Duration::from_secs(3), async {
            match app_handle.state::<DatabaseConnection>().get_adapter() {
                Ok(mut adapter) => {
                    let _ = markdown::export_all(&mut *adapter, Path::new(&sync_dir));
                }
                Err(e) => {
                    log::warn!("Failed to get database adapter for exit sync: {}", e);
                }
            };
        })
        .await;

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
        if SYNC_IN_PROGRESS
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }

        match app_handle.state::<DatabaseConnection>().get_adapter() {
            Ok(mut adapter) => {
                let _ = markdown::export_changed(&mut *adapter, Path::new(&sync_dir));
            }
            Err(e) => {
                log::warn!("Failed to get database adapter for sync: {}", e);
            }
        };

        SYNC_IN_PROGRESS.store(false, Ordering::SeqCst);
    });
}

pub fn sync_on_focus(app_handle: AppHandle) {
    let now = Utc::now().timestamp_millis();
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
        if SYNC_IN_PROGRESS
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }

        match app_handle.state::<DatabaseConnection>().get_adapter() {
            Ok(mut adapter) => {
                let _ = markdown::export_all(&mut *adapter, Path::new(&sync_dir));
                LAST_FULL_SYNC_TIME.store(Utc::now().timestamp_millis(), Ordering::SeqCst);
            }
            Err(e) => {
                log::warn!("Failed to get database adapter for focus sync: {}", e);
            }
        };

        SYNC_IN_PROGRESS.store(false, Ordering::SeqCst);
    });
}
