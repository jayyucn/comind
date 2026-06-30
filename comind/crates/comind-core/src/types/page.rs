use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Page {
    pub id: String,
    pub block_id: Option<String>,
    pub title: String,
    pub r#type: String,
    pub icon: Option<String>,
    pub cover: Option<String>,
    pub aliases: String,
    pub file_path: Option<String>,
    pub children_count: i64,
    pub word_count: i64,
    pub deleted: i64,
    pub created_at: i64,
    pub updated_at: i64,
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