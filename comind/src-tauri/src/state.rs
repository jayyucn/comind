use comind_core::storage::SQLiteAdapter;
use std::sync::Mutex;
use std::path::Path;

pub struct DatabaseConnection {
    adapter: Mutex<SQLiteAdapter>,
    db_path: String,
}

impl DatabaseConnection {
    pub fn new(data_dir: &Path) -> Result<Self, String> {
        let db_path = data_dir.join("comind.db");
        let adapter = SQLiteAdapter::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;
        Ok(Self {
            adapter: Mutex::new(adapter),
            db_path: db_path.to_string_lossy().to_string(),
        })
    }

    pub fn get_adapter(&self) -> Result<std::sync::MutexGuard<'_, SQLiteAdapter>, String> {
        self.adapter.lock().map_err(|e| format!("Failed to lock database: {}", e))
    }

    pub fn get_db_path(&self) -> String {
        self.db_path.clone()
    }
}
