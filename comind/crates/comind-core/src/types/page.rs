use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    #[serde(default = "default_id")]
    pub id: String,
    pub block_id: Option<String>,
    pub title: String,
    #[serde(default = "default_type")]
    pub r#type: String,
    pub icon: Option<String>,
    pub cover: Option<String>,
    #[serde(default = "default_aliases")]
    pub aliases: String,
    pub file_path: Option<String>,
    #[serde(default)]
    pub children_count: i64,
    #[serde(default)]
    pub word_count: i64,
    #[serde(default = "default_deleted")]
    pub deleted: i64,
    #[serde(default = "default_timestamp")]
    pub created_at: i64,
    #[serde(default = "default_timestamp")]
    pub updated_at: i64,
}

fn default_id() -> String {
    Uuid::new_v4().to_string()
}

fn default_type() -> String {
    "normal".to_string()
}

fn default_aliases() -> String {
    "[]".to_string()
}

fn default_deleted() -> i64 {
    0
}

fn default_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PageType {
    Normal,
    Journal,
}

impl Page {
    pub fn new(title: &str) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Page {
            id: Uuid::new_v4().to_string(),
            block_id: None,
            title: title.to_string(),
            r#type: "normal".to_string(),
            icon: None,
            cover: None,
            aliases: "[]".to_string(),
            file_path: None,
            children_count: 0,
            word_count: 0,
            deleted: 0,
            created_at: now,
            updated_at: now,
        }
    }
}