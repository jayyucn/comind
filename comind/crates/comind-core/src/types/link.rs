use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub id: String,
    pub source_block_id: String,
    pub target_page_id: String,
    pub display_text: String,
    pub relationship_type: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinkCreateOptions {
    pub source_block_id: String,
    pub target_page_id: String,
    pub display_text: String,
    pub relationship_type: Option<String>,
}

impl Link {
    pub fn new(options: LinkCreateOptions) -> Self {
        Link {
            id: Uuid::new_v4().to_string(),
            source_block_id: options.source_block_id,
            target_page_id: options.target_page_id,
            display_text: options.display_text,
            relationship_type: options.relationship_type,
            created_at: chrono::Utc::now().timestamp_millis(),
        }
    }
}