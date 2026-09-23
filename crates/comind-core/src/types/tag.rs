use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn default_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 字段模板实体（Tag）：落库形态（ADR-0049 D1 / D6 / 2026-09-21 grill 定稿）。
///
/// 系统 Tag 与用户 Tag **共用本表**：系统 tag 由 seed 写入固定 id 行（`is_system = 1`，
/// 拒删拒改名），用户 tag 由 content `#foo` 联动自动建（`is_system = 0`）。
///
/// - `field_ids`：**自身**字段定义 id 列表（不含继承）。
///   继承不物化，由 `TagService::effective_field_ids` 读取侧解析（ADR-0050 D10）。
/// - `parent_id`：单父槽位（nullable）。继承链唯一真相源；成环由
///   `TagService::set_parent` 拒绝（ADR-0050 D10）。
/// - `description` / `color`：标签身份三要素之二 / 之三（ADR-0050 D11）；
///   空串 = 未填写 / 无色。
///
/// 术语说明：本类型是「字段模板」实体，与文本 `#tag` 语法解析（`TagParse` /
/// `tag_service`）同属 Tag 概念；联动后「文本 → Tag」不再是独立解析层，
/// 而是 update 派生写入的唯一打标入口（content 唯一入口，grill 决策 #1）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    /// 全局唯一标题（D6：Tag 以 title 为唯一标识，无 key 列）。
    pub title: String,
    /// 该模板**自身**包含的字段定义 id（继承不在其中，见 D10）。
    #[serde(default)]
    pub field_ids: Vec<String>,
    /// 单父 Tag id（None = 顶级标签）。
    #[serde(default)]
    pub parent_id: Option<String>,
    /// 标签身份三要素之二：单行描述（ADR-0050 D11）。空串 = 未填写。
    #[serde(default)]
    pub description: String,
    /// 标签身份三要素之三：调色板 token 名（如 `--tag-color-3`，ADR-0050 D11）。
    /// 空串 = 无色。**不用 `Option`**：sql.js 路径 NULL 与空串不可区分
    /// （`row_to_tag_js` 为 `parent_id` 已写「空串 → None」归一化），而这里的
    /// 空串是**有意义的值**，落库列 `NOT NULL DEFAULT ''`。
    #[serde(default)]
    pub color: String,
    /// 系统 tag 标记（seed 行 = true，拒删拒改名）。
    #[serde(default)]
    pub is_system: bool,
    #[serde(default = "default_timestamp")]
    pub created_at: i64,
    #[serde(default = "default_timestamp")]
    pub updated_at: i64,
    /// 单调递增版本号，用于同步 LWW 判断。
    #[serde(default)]
    pub version: i64,
    /// 软删除时间戳（毫秒）。NULL = 未删除。
    #[serde(default)]
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagCreateOptions {
    pub title: String,
    #[serde(default)]
    pub field_ids: Vec<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
}

/// Tag 更新入参（ADR-0050 D11）。
///
/// 用具名结构体而非位置参数：`title` / `description` / `color` 三者同为
/// `Option<&str>`，位置参数写反编译器不报错。字段语义一致 —— `None` = 保持不变；
/// `description` / `color` 的 `""` 是有效值（未填写 / 无色），可借此清空。
#[derive(Debug, Clone, Default)]
pub struct TagUpdateOptions<'a> {
    pub title: Option<&'a str>,
    pub field_ids: Option<Vec<String>>,
    pub description: Option<&'a str>,
    pub color: Option<&'a str>,
}

/// 标签树读接口的行（ADR-0050 D10）：原始行 + 读取侧解析结果。
///
/// - `effective_field_ids`：自身 > 直接父 > 更近祖先（同名近者胜）合成的字段集合。
/// - `descendant_ids`：后代标签 id 闭包（**不含自身**）；成员向上聚合时 `自身 + 闭包`。
///
/// 解析单源在 Rust；TS 侧只消费，不得重实现（避免双源漂移）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagTreeEntry {
    #[serde(flatten)]
    pub tag: Tag,
    pub effective_field_ids: Vec<String>,
    pub descendant_ids: Vec<String>,
}

impl Tag {
    /// 用户 tag 构造（is_system 恒 false；系统 tag 走 seed 固定 id 行）。
    pub fn new(options: TagCreateOptions) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Tag {
            id: Uuid::new_v4().to_string(),
            title: options.title,
            field_ids: options.field_ids,
            parent_id: options.parent_id,
            description: String::new(),
            color: String::new(),
            is_system: false,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
        }
    }

    /// 系统 tag seed 构造（固定 id，grill 决策 #5：系统 tag 全套落库）。
    pub fn seed(id: &str, title: &str, field_ids: Vec<String>) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        Tag {
            id: id.to_string(),
            title: title.to_string(),
            field_ids,
            parent_id: None,
            description: String::new(),
            color: String::new(),
            is_system: true,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_payload_without_identity_fields_deserializes() {
        // 跨设备同步（ADR-0050 D11）：旧版本 payload 缺 description / color 时不得反序列化失败。
        let legacy = r#"{"id":"t1","title":"工作","field_ids":[],"parent_id":null,
            "is_system":false,"created_at":1,"updated_at":1,"version":0,"deleted_at":null}"#;
        let tag: Tag = serde_json::from_str(legacy).expect("旧 payload 必须可反序列化");
        assert_eq!(tag.description, "");
        assert_eq!(tag.color, "");
    }

    #[test]
    fn identity_fields_round_trip_through_json() {
        let mut tag = Tag::seed("t1", "工作", Vec::new());
        tag.description = "工作相关的块".to_string();
        tag.color = "--tag-color-3".to_string();

        let value = serde_json::to_value(&tag).expect("serialize");
        assert_eq!(value["description"], "工作相关的块");
        assert_eq!(value["color"], "--tag-color-3");

        let back: Tag = serde_json::from_value(value).expect("deserialize");
        assert_eq!(back.description, "工作相关的块");
        assert_eq!(back.color, "--tag-color-3");
    }
}
