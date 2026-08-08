use serde::{Deserialize, Serialize};

/// 用户通知偏好设置（单行表 notification_config，id=1）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationConfig {
    #[serde(default = "default_id")]
    pub id: i64,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub schedule_enabled: bool,
    #[serde(default = "default_true")]
    pub deadline_enabled: bool,
    #[serde(default = "default_true")]
    pub overdue_enabled: bool,
    #[serde(default)]
    pub quiet_hours_start: Option<String>,
    #[serde(default)]
    pub quiet_hours_end: Option<String>,
    #[serde(default)]
    pub web_browser_notifications_enabled: bool,
}

fn default_id() -> i64 {
    1
}

fn default_true() -> bool {
    true
}

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            id: 1,
            enabled: true,
            schedule_enabled: true,
            deadline_enabled: true,
            overdue_enabled: true,
            quiet_hours_start: Some("22:00".to_string()),
            quiet_hours_end: Some("08:00".to_string()),
            web_browser_notifications_enabled: false,
        }
    }
}

impl NotificationConfig {
    /// 创建写库用的默认配置（id=1，默认值）
    pub fn seed() -> Self {
        Self::default()
    }
}
