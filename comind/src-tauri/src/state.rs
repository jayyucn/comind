use comind_core::storage::SQLiteAdapter;
use std::path::Path;
use std::sync::{Arc, Mutex};
use comind_core::sync::message::SyncTable;

pub struct DatabaseConnection {
    adapter: Mutex<SQLiteAdapter>,
    db_path: String,
}

impl DatabaseConnection {
    /// 接收 workspace 路径，在 workspace/sqlite/comind.db 处打开数据库
    pub fn new(workspace_path: &Path) -> Result<Self, String> {
        let db_path = workspace_path.join("sqlite").join("comind.db");
        let adapter =
            SQLiteAdapter::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;
        Ok(Self {
            adapter: Mutex::new(adapter),
            db_path: db_path.to_string_lossy().to_string(),
        })
    }

    pub fn get_adapter(&self) -> Result<std::sync::MutexGuard<'_, SQLiteAdapter>, String> {
        self.adapter
            .lock()
            .map_err(|e| format!("Failed to lock database: {}", e))
    }

    pub fn get_db_path(&self) -> String {
        self.db_path.clone()
    }
}

pub struct ConfigManager {
    config: Mutex<crate::config::AppConfig>,
}

impl ConfigManager {
    pub fn new(config: crate::config::AppConfig) -> Self {
        Self {
            config: Mutex::new(config),
        }
    }

    pub fn get_config(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, crate::config::AppConfig>, String> {
        self.config
            .lock()
            .map_err(|e| format!("Failed to lock config: {}", e))
    }

    pub fn update_config(&self, new_config: crate::config::AppConfig) -> Result<(), String> {
        let mut config = self
            .config
            .lock()
            .map_err(|e| format!("Failed to lock config: {}", e))?;
        *config = new_config;
        Ok(())
    }
}

/// 统一的同步状态管理
/// - PC 端：持有 SyncServer
/// - Android 端：持有 SyncClient
pub struct SyncServerHandle {
    #[cfg(not(target_os = "android"))]
    server: Arc<tokio::sync::RwLock<Option<crate::sync_server::SyncServer>>>,
    #[cfg(target_os = "android")]
    client: Arc<tokio::sync::RwLock<Option<crate::sync_client::SyncClient>>>,
}

impl SyncServerHandle {
    pub fn new() -> Self {
        Self {
            #[cfg(not(target_os = "android"))]
            server: Arc::new(tokio::sync::RwLock::new(None)),
            #[cfg(target_os = "android")]
            client: Arc::new(tokio::sync::RwLock::new(None)),
        }
    }

    // ===== PC 端方法 =====

    #[cfg(not(target_os = "android"))]
    pub async fn set_server(&self, server: crate::sync_server::SyncServer) {
        *self.server.write().await = Some(server);
    }

    #[cfg(not(target_os = "android"))]
    pub async fn get_server(&self) -> Option<crate::sync_server::SyncServer> {
        let server = self.server.read().await;
        server.as_ref().cloned()
    }

    // ===== Android 端方法 =====

    #[cfg(target_os = "android")]
    pub async fn set_client(&self, client: crate::sync_client::SyncClient) {
        *self.client.write().await = Some(client);
    }

    #[cfg(target_os = "android")]
    pub async fn get_client(&self) -> Option<crate::sync_client::SyncClient> {
        self.client.read().await.as_ref().cloned()
    }

    // ===== 统一接口 =====

    /// 触发同步通知（写命令调用）
    /// - PC 端：通过 SyncServer 推送
    /// - Android 端：通过 SyncClient 推送
    pub async fn record_and_notify(&self, table: SyncTable, ids: Vec<String>) {
        #[cfg(not(target_os = "android"))]
        {
            if let Some(server) = self.get_server().await {
                if let Err(e) = server.record_and_notify(table, ids).await {
                    log::error!("record_and_notify failed: {}", e);
                }
            }
        }
        #[cfg(target_os = "android")]
        {
            if let Some(client) = self.get_client().await {
                if let Err(e) = client.record_and_notify(table, ids.clone()).await {
                    log::error!("record_and_notify failed: {}", e);
                }
            } else {
                log::warn!("record_and_notify: no sync client (not paired?), table={:?}, ids={:?}", table, ids);
            }
        }
    }
}

impl Clone for SyncServerHandle {
    fn clone(&self) -> Self {
        Self {
            #[cfg(not(target_os = "android"))]
            server: self.server.clone(),
            #[cfg(target_os = "android")]
            client: self.client.clone(),
        }
    }
}
