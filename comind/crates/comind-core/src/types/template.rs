use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserTemplate {
    pub id: String,
    pub name: String,
    pub category: String,
    pub content: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl UserTemplate {
    pub fn new(name: &str, category: &str, content: &str) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        UserTemplate {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            category: category.to_string(),
            content: content.to_string(),
            created_at: now,
            updated_at: now,
        }
    }
}