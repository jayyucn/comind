use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Property {
    pub id: String,
    pub block_id: String,
    pub key: String,
    pub value: String,
    pub r#type: String,
    pub sort_order: i64,
    pub is_hidden: i64,
    pub is_deleted: i64,
    pub schema_version: i64,
    #[serde(default = "default_timestamp")]
    pub created_at: i64,
    #[serde(default = "default_timestamp")]
    pub updated_at: i64,
}

fn default_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PropertyCreateOptions {
    pub block_id: String,
    pub key: String,
    pub value: String,
    pub r#type: String,
}

impl Property {
    pub fn new(options: PropertyCreateOptions) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Property {
            id: Uuid::new_v4().to_string(),
            block_id: options.block_id,
            key: options.key,
            value: options.value,
            r#type: options.r#type,
            sort_order: 0,
            is_hidden: 0,
            is_deleted: 0,
            schema_version: 1,
            created_at: now,
            updated_at: now,
        }
    }
}