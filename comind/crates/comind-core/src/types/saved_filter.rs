use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedFilter {
    pub id: String,
    pub name: String,
    pub query_json: String,   // serialized BlockQuery
    pub created_at: i64,
    pub updated_at: i64,
}

impl SavedFilter {
    pub fn new(name: &str, query_json: &str) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        SavedFilter {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            query_json: query_json.to_string(),
            created_at: now,
            updated_at: now,
        }
    }
}
