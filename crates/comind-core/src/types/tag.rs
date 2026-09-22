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
            is_system: true,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
        }
    }
}
