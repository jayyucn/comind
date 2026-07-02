use serde::{Serialize, Deserialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
pub struct AppConfig {
    pub database_path: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            database_path: None,
        }
    }
}

impl AppConfig {
    pub fn load(config_dir: &Path) -> Result<Self, String> {
        let config_path = config_dir.join("config.json");
        if config_path.exists() {
            let content = fs::read_to_string(&config_path)
                .map_err(|e| format!("Failed to read config file: {}", e))?;
            serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse config file: {}", e))
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self, config_dir: &Path) -> Result<(), String> {
        if !config_dir.exists() {
            fs::create_dir_all(config_dir)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }
        let config_path = config_dir.join("config.json");
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        let mut file = File::create(&config_path)
            .map_err(|e| format!("Failed to create config file: {}", e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write config file: {}", e))
    }
}

pub fn get_default_db_path(app_handle: &tauri::AppHandle) -> PathBuf {
    if let Ok(exe_dir) = app_handle.path().executable_dir() {
        return exe_dir.join("sqlite");
    }
    app_handle.path().app_data_dir().expect("Failed to get app data directory")
}

pub fn get_db_path(app_handle: &tauri::AppHandle, config: &AppConfig) -> PathBuf {
    if let Some(db_path) = &config.database_path {
        PathBuf::from(db_path)
    } else {
        get_default_db_path(app_handle)
    }
}