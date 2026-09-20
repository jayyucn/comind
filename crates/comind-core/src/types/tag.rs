use serde::{Deserialize, Serialize};

/// 字段模板实体（Tag）：系统内置与用户自定义共用此类型（ADR-0049 D1）。
///
/// - 系统 Tag 为编译期常量（TS 侧 `SYSTEM_TAGS`，不落库）。
/// - 用户 Tag 落 SQLite 新表 `tag`（D6 待评审）。
/// - `extends` 继承字段先预留，继承能力另立 ADR（ADR-0049 D8）。
///
/// 术语说明：本类型是「字段模板」实体，与文本 `#tag` 语法解析（`TagParse` / `tag_service`）
/// 同属 Tag 概念，但后者是「文本 → Tag」的解析层，两者互不替代（ADR-0049 D7）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub key: String,
    pub title: String,
    /// 字段模板（JSON 数组）；与 D6 存储形态 `fields_json` 对齐，暂以 JSON 值承载，
    /// 避免在字段 schema 未定（D6 待评审）时过早固定 Rust 侧 `FieldDefinition` 结构。
    pub fields: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_system: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extends: Option<String>,
}
