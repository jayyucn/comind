use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub database_path: Option<String>,
    #[serde(default)]
    pub sync_enabled: bool,
    #[serde(default)]
    pub sync_directory: Option<String>,
    #[serde(default = "default_sync_interval")]
    pub sync_interval_secs: u64,
    #[serde(default)]
    pub client_id: String,
    #[serde(default)]
    pub device_name: String,
}

fn default_sync_interval() -> u64 {
    5
}

impl Default for AppConfig {
    fn default() -> Self {
        let device_name = get_device_name();
        Self {
            database_path: None,
            sync_enabled: false,
            sync_directory: None,
            sync_interval_secs: 300,
            client_id: uuid::Uuid::new_v4().to_string(),
            device_name,
        }
    }
}

fn get_device_name() -> String {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        match Command::new("hostname").output() {
            Ok(output) => String::from_utf8_lossy(&output.stdout).trim().to_string(),
            Err(_) => "PC".to_string(),
        }
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        match Command::new("scutil").arg("--get").arg("ComputerName").output() {
            Ok(output) => String::from_utf8_lossy(&output.stdout).trim().to_string(),
            Err(_) => "Mac".to_string(),
        }
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        match Command::new("hostname").output() {
            Ok(output) => String::from_utf8_lossy(&output.stdout).trim().to_string(),
            Err(_) => "Linux".to_string(),
        }
    }
    #[cfg(target_os = "android")]
    {
        "Android".to_string()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux", target_os = "android")))]
    {
        "Device".to_string()
    }
}

impl AppConfig {
    pub fn config_filename() -> &'static str {
        #[cfg(debug_assertions)]
        {
            "config.dev.json"
        }
        #[cfg(not(debug_assertions))]
        {
            "config.json"
        }
    }

    pub fn load(config_dir: &Path) -> Result<Self, String> {
        let config_path = config_dir.join(Self::config_filename());
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
        let config_path = config_dir.join(Self::config_filename());
        let content = serde_json::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        let mut file = File::create(&config_path)
            .map_err(|e| format!("Failed to create config file: {}", e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("Failed to write config file: {}", e))
    }
}

pub fn get_default_db_path(app_handle: &tauri::AppHandle) -> PathBuf {
    // executable_dir() is not available on mobile targets
    #[cfg(not(target_os = "android"))]
    if let Ok(exe_dir) = app_handle.path().executable_dir() {
        #[cfg(debug_assertions)]
        {
            return exe_dir.join("sqlite-dev");
        }
        #[cfg(not(debug_assertions))]
        {
            return exe_dir.join("sqlite");
        }
    }
    let base_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    #[cfg(debug_assertions)]
    {
        base_dir.join("sqlite-dev")
    }
    #[cfg(not(debug_assertions))]
    {
        base_dir
    }
}

pub fn get_db_path(app_handle: &tauri::AppHandle, config: &AppConfig) -> PathBuf {
    if let Some(db_path) = &config.database_path {
        PathBuf::from(db_path)
    } else {
        get_default_db_path(app_handle)
    }
}
