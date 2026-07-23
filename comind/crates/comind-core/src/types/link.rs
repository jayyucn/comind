use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Link {
    pub id: String,
    pub source_block_id: String,
    pub target_page_id: String,
    pub display_text: String,
    pub relationship_type: Option<String>,
    #[serde(default = "default_timestamp")]
    pub created_at: i64,
    #[serde(default = "default_timestamp")]
    pub updated_at: i64,
    /// 单调递增版本号，用于同步 LWW 判断。每次 update/delete 时 +1。
    #[serde(default)]
    pub version: i64,
    /// 软删除时间戳（毫秒）。NULL = 未删除。同步时传播删除操作。
    #[serde(default)]
    pub deleted_at: Option<i64>,
}

fn default_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
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
            updated_at: chrono::Utc::now().timestamp_millis(),
            version: 0,
            deleted_at: None,
        }
    }
}