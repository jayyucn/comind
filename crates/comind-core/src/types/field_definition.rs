use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn default_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 字段定义实体（ADR-0049 D3 / D6 / D9）。
///
/// 系统 12 字段 seed 进本表（固定 uuid id，`is_system = true`，seed 行不可删）；
/// 用户自定义字段同样落本表。全局 `key` 唯一（含系统字段不撞），是值的稳定引用。
///
/// - `closed_values`：选项型字段（select / multi-select）的候选值；非选项型为 `None`，
///   落库为 JSON TEXT。
/// - `value_type` 对齐本定义：值表 `FieldValue` 按 `value_type` 反序列化 `value_json`（D9）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldDefinition {
    pub id: String,
    /// 全局唯一 key（含系统字段不撞），引用稳定。
    pub key: String,
    pub title: String,
    /// 字段类型：text / select / number / date / page_ref / list 等。
    pub r#type: String,
    /// 选项型字段的候选值（select / multi-select）；非选项型为 None，落库为 JSON TEXT。
    #[serde(default)]
    pub closed_values: Option<Vec<String>>,
    /// 系统字段 seed 进表后标记，seed 行不可删（D3）。
    #[serde(default)]
    pub is_system: bool,
    #[serde(default = "default_timestamp")]
    pub created_at: i64,
    #[serde(default = "default_timestamp")]
    pub updated_at: i64,
    #[serde(default)]
    pub version: i64,
    #[serde(default)]
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldDefinitionCreateOptions {
    pub key: String,
    pub title: String,
    pub r#type: String,
    #[serde(default)]
    pub closed_values: Option<Vec<String>>,
    #[serde(default)]
    pub is_system: bool,
}

impl FieldDefinition {
    pub fn new(options: FieldDefinitionCreateOptions) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        FieldDefinition {
            id: Uuid::new_v4().to_string(),
            key: options.key,
            title: options.title,
            r#type: options.r#type,
            closed_values: options.closed_values,
            is_system: options.is_system,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
        }
    }
}

/// 用固定 uuid 创建系统字段（seed 用，保证 id 稳定，D3 裁定项 ④）。
impl FieldDefinition {
    pub fn seed(id: &str, key: &str, title: &str, r#type: &str, closed_values: Option<Vec<String>>) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        FieldDefinition {
            id: id.to_string(),
            key: key.to_string(),
            title: title.to_string(),
            r#type: r#type.to_string(),
            closed_values,
            is_system: true,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
        }
    }
}

/// ADR-0049 D3/D6：系统 12 字段 seed 行（固定 id，不可删）。
/// 与 TS `SYSTEM_TAGS` 展平的 12 个内置字段一一对应（key 相同）。
/// 所有系统字段 `type = "string"`；仅 `status` / `priority` 有 `closed_values`（候选值 value 数组）。
pub fn system_field_definitions() -> Vec<FieldDefinition> {
    vec![
        FieldDefinition::seed(
            "80000000-0000-4000-8000-000000000001",
            "status", "状态", "string",
            Some(vec!["Todo".into(), "Doing".into(), "Done".into(), "Canceled".into()]),
        ),
        FieldDefinition::seed(
            "80000000-0000-4000-8000-000000000002",
            "priority", "优先级", "string",
            Some(vec!["Low".into(), "Medium".into(), "High".into(), "Urgent".into()]),
        ),
        FieldDefinition::seed("80000000-0000-4000-8000-000000000003", "project", "项目", "string", None),
        FieldDefinition::seed("80000000-0000-4000-8000-000000000004", "area", "领域", "string", None),
        FieldDefinition::seed("80000000-0000-4000-8000-000000000005", "book", "书名", "string", None),
        FieldDefinition::seed("80000000-0000-4000-8000-000000000006", "part", "部/卷", "string", None),
        FieldDefinition::seed("80000000-0000-4000-8000-000000000007", "chapter", "章节", "string", None),
        FieldDefinition::seed("80000000-0000-4000-8000-000000000008", "cfi", "原文锚点", "string", None),
        FieldDefinition::seed("80000000-0000-4000-8000-000000000009", "quote", "原文", "string", None),
        FieldDefinition::seed("80000000-0000-4000-8000-00000000000a", "sourceBlockId", "来源块 ID", "string", None),
        FieldDefinition::seed("80000000-0000-4000-8000-00000000000b", "sourcePageId", "来源页面 ID", "string", None),
        FieldDefinition::seed("80000000-0000-4000-8000-00000000000c", "language", "语言", "string", None),
    ]
}
