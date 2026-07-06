use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Block {
    pub id: String,
    pub page_id: String,
    pub parent_id: Option<String>,
    pub pos: i64,
    pub content: String,
    pub format: String,
    pub r#type: String,
    #[serde(default = "default_timestamp")]
    pub created_at: i64,
    #[serde(default = "default_timestamp")]
    pub updated_at: i64,
}

fn default_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockCreateOptions {
    pub page_id: String,
    pub parent_id: Option<String>,
    pub content: String,
    pub r#type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockUpdateOptions {
    pub content: Option<String>,
    pub parent_id: Option<String>,
    pub pos: Option<i64>,
    pub format: Option<String>,
    pub r#type: Option<String>,
}

impl Block {
    pub fn new(options: BlockCreateOptions) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Block {
            id: Uuid::new_v4().to_string(),
            page_id: options.page_id,
            parent_id: options.parent_id,
            pos: 1000,
            content: options.content,
            format: "{}".to_string(),
            r#type: options.r#type.unwrap_or_else(|| "bullet".to_string()),
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone)]
pub struct BlockTree {
    pub block_map: HashMap<String, Block>,
    pub root_blocks: Vec<String>,
    pub children_map: HashMap<String, Vec<String>>,
}