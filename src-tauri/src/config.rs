use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub sync_enabled: bool,
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
            workspace_path: None,
            sync_enabled: false,
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

    /// 加载配置文件，并处理旧字段（database_path / sync_directory）向 workspace_path 的迁移。
    /// 检测到旧字段时会派生 workspace_path 并以新格式回写磁盘，丢弃旧字段。
    pub fn load(config_dir: &Path) -> Result<Self, String> {
        let config_path = config_dir.join(Self::config_filename());
        if !config_path.exists() {
            return Ok(Self::default());
        }
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config file: {}", e))?;

        // 先解析为 serde_json::Value 以检测旧字段
        let raw: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config file: {}", e))?;

        let has_workspace = raw.get("workspace_path").is_some();
        let has_database_path = raw.get("database_path").is_some();

        let config: Self = if has_workspace {
            // 新格式直接解析
            serde_json::from_value(raw.clone())
                .map_err(|e| format!("Failed to parse config file: {}", e))?
        } else if has_database_path {
            // 旧格式：从 database_path 派生 workspace_path（取父目录）
            let db_path_str = raw
                .get("database_path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let workspace = if db_path_str.is_empty() {
                None
            } else {
                PathBuf::from(&db_path_str)
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
            };
            let mut cfg = Self::default();
            cfg.workspace_path = workspace;
            cfg.sync_enabled = raw
                .get("sync_enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            cfg.sync_interval_secs = raw
                .get("sync_interval_secs")
                .and_then(|v| v.as_u64())
                .unwrap_or(300);
            cfg.client_id = raw
                .get("client_id")
                .and_then(|v| v.as_str())
                .unwrap_or(&uuid::Uuid::new_v4().to_string())
                .to_string();
            cfg.device_name = raw
                .get("device_name")
                .and_then(|v| v.as_str())
                .unwrap_or("Device")
                .to_string();
            cfg
        } else {
            // 无 workspace_path 也无 database_path，使用默认值
            serde_json::from_value(raw.clone())
                .map_err(|e| format!("Failed to parse config file: {}", e))?
        };

        // 如果发生了迁移（旧字段存在但 workspace_path 之前不存在），回写新格式以丢弃旧字段
        if !has_workspace && has_database_path {
            let _ = config.save(config_dir);
        }

        Ok(config)
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

/// 默认 workspace 路径
/// - Windows release: D:/workspace
/// - 其他平台 / debug: exe_dir/workspace-dev（移动端回退到 app_data_dir/workspace-dev）
/// - release（非 Windows）: app_data_dir
pub fn get_default_workspace_path(app_handle: &tauri::AppHandle) -> PathBuf {
    // Windows 正式版默认工作空间为 D:/workspace（仅新安装、未显式设置时生效）
    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    {
        return PathBuf::from("D:/workspace");
    }

    #[cfg(not(target_os = "android"))]
    #[cfg(debug_assertions)]
    if let Ok(exe_dir) = app_handle.path().executable_dir() {
        return exe_dir.join("workspace-dev");
    }

    let base_dir = app_handle
        .path()
        .app_data_dir()
        .expect("Failed to get app data directory");

    #[cfg(debug_assertions)]
    {
        base_dir.join("workspace-dev")
    }
    #[cfg(not(debug_assertions))]
    {
        base_dir
    }
}

/// 根据配置返回当前 workspace 路径
pub fn get_workspace_path(app_handle: &tauri::AppHandle, config: &AppConfig) -> PathBuf {
    if let Some(ws) = &config.workspace_path {
        PathBuf::from(ws)
    } else {
        get_default_workspace_path(app_handle)
    }
}

/// 从 workspace 派生数据库文件路径：workspace/sqlite/comind.db
pub fn get_db_path(workspace: &Path) -> PathBuf {
    workspace.join("sqlite").join("comind.db")
}

/// 从 workspace 派生 Markdown 同步目录路径：workspace/markdown
pub fn get_markdown_path(workspace: &Path) -> PathBuf {
    workspace.join("markdown")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir().join(format!("comind-config-test-{}-{}", name, uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn load_missing_file_returns_default() {
        let dir = TempDir::new("missing");
        let config = AppConfig::load(dir.path()).unwrap();
        assert!(config.workspace_path.is_none());
        assert!(!config.sync_enabled);
        assert_eq!(config.sync_interval_secs, 300);
        assert!(!config.client_id.is_empty());
        assert!(!config.device_name.is_empty());
    }

    #[test]
    fn load_new_format_parses_workspace_path() {
        let dir = TempDir::new("new-format");
        let content = r#"{
            "workspace_path": "/home/user/comind-workspace",
            "sync_enabled": true,
            "sync_interval_secs": 60,
            "client_id": "client-123",
            "device_name": "TestDevice"
        }"#;
        std::fs::write(dir.path().join(AppConfig::config_filename()), content).unwrap();

        let config = AppConfig::load(dir.path()).unwrap();
        assert_eq!(config.workspace_path, Some("/home/user/comind-workspace".to_string()));
        assert!(config.sync_enabled);
        assert_eq!(config.sync_interval_secs, 60);
        assert_eq!(config.client_id, "client-123");
        assert_eq!(config.device_name, "TestDevice");
    }

    #[test]
    fn load_old_format_migrates_database_path() {
        let dir = TempDir::new("old-format");
        let content = r#"{
            "database_path": "/home/user/comind-data/comind.db",
            "sync_enabled": true,
            "sync_interval_secs": 120,
            "client_id": "legacy-client",
            "device_name": "LegacyDevice"
        }"#;
        std::fs::write(dir.path().join(AppConfig::config_filename()), content).unwrap();

        let config = AppConfig::load(dir.path()).unwrap();
        // workspace_path 应取 database_path 的父目录
        assert_eq!(config.workspace_path, Some("/home/user/comind-data".to_string()));
        assert!(config.sync_enabled);
        assert_eq!(config.sync_interval_secs, 120);
        assert_eq!(config.client_id, "legacy-client");
        assert_eq!(config.device_name, "LegacyDevice");

        // 迁移后应回写为新格式，旧字段被丢弃
        let rewritten = std::fs::read_to_string(dir.path().join(AppConfig::config_filename())).unwrap();
        assert!(rewritten.contains("workspace_path"));
        assert!(!rewritten.contains("database_path"));
    }

    #[test]
    fn load_old_format_empty_database_path() {
        let dir = TempDir::new("old-empty");
        let content = r#"{
            "database_path": ""
        }"#;
        std::fs::write(dir.path().join(AppConfig::config_filename()), content).unwrap();

        let config = AppConfig::load(dir.path()).unwrap();
        assert!(config.workspace_path.is_none());
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = TempDir::new("roundtrip");
        let mut config = AppConfig::default();
        config.workspace_path = Some("/tmp/comind-roundtrip".to_string());
        config.sync_enabled = true;
        config.sync_interval_secs = 42;
        config.client_id = "roundtrip-client".to_string();
        config.device_name = "RoundtripDevice".to_string();

        config.save(dir.path()).unwrap();
        let loaded = AppConfig::load(dir.path()).unwrap();

        assert_eq!(loaded.workspace_path, config.workspace_path);
        assert_eq!(loaded.sync_enabled, config.sync_enabled);
        assert_eq!(loaded.sync_interval_secs, config.sync_interval_secs);
        assert_eq!(loaded.client_id, config.client_id);
        assert_eq!(loaded.device_name, config.device_name);
    }

    #[test]
    fn path_derivation_from_workspace() {
        let workspace = PathBuf::from("/home/user/comind-workspace");
        assert_eq!(get_db_path(&workspace), PathBuf::from("/home/user/comind-workspace/sqlite/comind.db"));
        assert_eq!(get_markdown_path(&workspace), PathBuf::from("/home/user/comind-workspace/markdown"));
    }

    #[test]
    fn default_config_has_required_fields() {
        let config = AppConfig::default();
        assert!(config.workspace_path.is_none());
        assert!(!config.sync_enabled);
        assert_eq!(config.sync_interval_secs, 300);
        assert!(!config.client_id.is_empty());
        assert!(!config.device_name.is_empty());
    }
}
