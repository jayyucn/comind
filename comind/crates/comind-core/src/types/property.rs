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
    /// 单调递增版本号，用于同步 LWW 判断。每次 update/delete 时 +1。
    #[serde(default)]
    pub version: i64,
    /// 软删除时间戳（毫秒）。NULL = 未删除。同步时传播删除操作。
    /// 替代旧 `is_deleted` 字段（兼容期内两者共存，查询优先用 deleted_at）。
    #[serde(default)]
    pub deleted_at: Option<i64>,
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
            version: 0,
            deleted_at: None,
        }
    }
}