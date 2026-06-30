use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelationshipType {
    pub id: String,
    pub r#type: String,
    pub inverse: Option<String>,
    pub label: String,
    pub inverse_label: String,
    pub color: String,
    pub order: i64,
    pub strength: String,
    pub deleted: i64,
    pub builtin: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl RelationshipType {
    pub fn new(r#type: &str, label: &str, inverse_label: &str, color: &str) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        RelationshipType {
            id: Uuid::new_v4().to_string(),
            r#type: r#type.to_string(),
            inverse: None,
            label: label.to_string(),
            inverse_label: inverse_label.to_string(),
            color: color.to_string(),
            order: 0,
            strength: "medium".to_string(),
            deleted: 0,
            builtin: 0,
            created_at: now,
            updated_at: now,
        }
    }
}