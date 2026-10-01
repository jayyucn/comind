use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn default_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 字段值实体（ADR-0049 D6 / D9）。
///
/// 重构自 `Property`：每个 Block 的某字段值落一行，强引用现存 `FieldDefinition`
/// （`field_definition_id`），无定义即无值，孤儿概念消失（D9）。删除定义时级联清值。
///
/// - `value_json`：值的 JSON 文本（typed 单列存储，D6 裁定项）。
/// - `value_type`：值的类型，落库为 denormalized 副本（来自 `FieldDefinition.r#type`），
///   使得值的反序列化不依赖额外 join（D9）。
/// - `seq`：同一 block 的多个值（如 list / multi-select）的有序序号。
///
/// **`key` 不是落库列**：它是 `FieldDefinition.key` 的反规范化副本，由服务层
/// `FieldValueService` join 定义表后填充（追加于结构体末尾，不参与 DB 列序映射）。
/// 读路径拿到行后 `key` 恒为有效值；写入路径以 `key` 定位 `FieldDefinition`
/// （未知 key 自动建定义，与 content `#foo` 自动建 Tag 同一哲学）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldValue {
    pub id: String,
    pub block_id: String,
    pub field_definition_id: String,
    /// 值的 JSON 文本（typed 单列存储）。
    pub value_json: String,
    /// 值的类型（denormalized 自 FieldDefinition.r#type），用于反序列化。
    pub value_type: String,
    /// 同一 block 多值（list / multi-select）的有序序号。
    #[serde(default)]
    pub seq: i64,
    #[serde(default = "default_timestamp")]
    pub created_at: i64,
    #[serde(default = "default_timestamp")]
    pub updated_at: i64,
    #[serde(default)]
    pub version: i64,
    /// 软删除时间戳（毫秒）。NULL = 未删除。
    #[serde(default)]
    pub deleted_at: Option<i64>,
    /// 所属字段定义的 key（**非落库列**，服务层 join 填充）。
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldValueCreateOptions {
    pub block_id: String,
    pub field_definition_id: String,
    pub value_json: String,
    pub value_type: String,
    #[serde(default)]
    pub seq: i64,
}

impl FieldValue {
    pub fn new(options: FieldValueCreateOptions) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        FieldValue {
            id: Uuid::new_v4().to_string(),
            block_id: options.block_id,
            field_definition_id: options.field_definition_id,
            value_json: options.value_json,
            value_type: options.value_type,
            seq: options.seq,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
            key: String::new(),
        }
    }
}
