use comind_core::storage::SQLiteAdapter;
use std::path::Path;
use std::sync::{Arc, Mutex};
use comind_core::sync::message::SyncTable;

pub struct DatabaseConnection {
    adapter: Mutex<SQLiteAdapter>,
    db_path: String,
}

impl DatabaseConnection {
    pub fn new(data_dir: &Path) -> Result<Self, String> {
        let db_path = data_dir.join("comind.db");
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

pub struct SyncServerHandle {
    server: Arc<tokio::sync::RwLock<Option<crate::sync_server::SyncServer>>>,
}

impl SyncServerHandle {
    pub fn new() -> Self {
        Self {
            server: Arc::new(tokio::sync::RwLock::new(None)),
        }
    }

    pub async fn set_server(&self, server: crate::sync_server::SyncServer) {
        *self.server.write().await = Some(server);
    }

    pub async fn get_server(&self) -> Option<crate::sync_server::SyncServer> {
        let server = self.server.read().await;
        server.as_ref().cloned()
    }

    pub async fn record_and_notify(&self, table: SyncTable, ids: Vec<String>) {
        if let Some(server) = self.get_server().await {
            if let Err(e) = server.record_and_notify(table, ids).await {
                log::error!("record_and_notify failed: {}", e);
            }
        }
    }
}

impl Clone for SyncServerHandle {
    fn clone(&self) -> Self {
        Self {
            server: self.server.clone(),
        }
    }
}
