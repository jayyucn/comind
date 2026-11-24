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
    /// 单调递增版本号，用于同步 LWW 判断。每次 update/delete 时 +1。
    #[serde(default)]
    pub version: i64,
    /// 软删除时间戳（毫秒）。NULL = 未删除。同步时传播删除操作。
    #[serde(default)]
    pub deleted_at: Option<i64>,
    /// 反规范化：本块直接打上的 Tag id 列表（ADR-0049 D6）。
    /// 与 FieldValue（按字段物化的值）互为冗余，用于快速读取块所属 Tag；
    /// 真值由 TagService 在打标时同步维护两者。
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 块正文类型的规范名（ADR-0063 D1）。**写入路径一律用它**。
pub const DEFAULT_BLOCK_TYPE: &str = "text";

/// 读侧类型归一（ADR-0063 D1）：历史值 `bullet` 与缺失值都归一为 `text`，其余原样。
///
/// 这是双读归一的**唯一落点**：只在从存储读出的位置调用，写入路径不得调用
/// （写入只写规范值，否则等于隐式迁移）。
pub fn normalize_block_type(raw: Option<&str>) -> String {
    match raw {
        None | Some("bullet") | Some("") => DEFAULT_BLOCK_TYPE.to_string(),
        Some(other) => other.to_string(),
    }
}

/// 需要生成 renderSegments 的块类型（正文类）。
///
/// `bullet` 是历史名，保留到存量数据清空为止；`text` 是规范名。
/// **新增正文类块类型（如 callout-*）必须加进这里**，否则该类型块的正文
/// 不会生成 renderSegments，渲染层拿到的是空片段。
pub fn is_text_like(block_type: &str) -> bool {
    matches!(block_type, "text" | "bullet" | "property")
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
            r#type: options.r#type.unwrap_or_else(|| DEFAULT_BLOCK_TYPE.to_string()),
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
            tags: Vec::new(),
        }
    }
}

/// 查询结果：未完成任务（block + page_title + date_refs）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncompleteTask {
    pub id: String,
    pub page_id: String,
    pub parent_id: Option<String>,
    pub pos: i64,
    pub content: String,
    pub r#format: String,
    pub r#type: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub version: i64,
    #[serde(default)]
    pub deleted_at: Option<i64>,
    pub page_title: String,
    pub page_type: String,
    /// DateRefs on this block (schedule/deadline). Pre-joined from DateRef table
    /// so TS side doesn't need to call parseDateRefs or extra IPC per task.
    #[serde(default)]
    pub date_refs: Vec<crate::DateRef>,
}

#[derive(Debug, Clone)]
pub struct BlockTree {
    pub block_map: HashMap<String, Block>,
    pub root_blocks: Vec<String>,
    pub children_map: HashMap<String, Vec<String>>,
}