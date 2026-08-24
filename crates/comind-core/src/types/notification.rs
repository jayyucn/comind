use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub block_id: String,
    pub page_id: String,
    pub kind: String,
    pub event_iso: String,
    pub fired_at: i64,
    pub status: String,
    pub snooze_until: Option<i64>,
    pub payload: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationSettings {
    pub enabled: bool,
    pub schedule_enabled: bool,
    pub deadline_enabled: bool,
    pub overdue_enabled: bool,
    pub quiet_hours_start: Option<String>,
    pub quiet_hours_end: Option<String>,
    pub web_browser_notifications_enabled: bool,
}

impl Default for NotificationSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            schedule_enabled: true,
            deadline_enabled: true,
            overdue_enabled: true,
            quiet_hours_start: None,
            quiet_hours_end: None,
            web_browser_notifications_enabled: false,
        }
    }
}