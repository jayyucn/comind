use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn default_timestamp() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// 「隐藏」规则的合法取值（ADR-0050 D18）。落库为 TEXT，未知 / 缺失一律归一为 `"never"`。
pub const FIELD_HIDE_WHEN_VALUES: &[&str] = &[
    "never",
    "when_empty",
    "when_not_empty",
    "when_default",
    "always",
];

/// 白名单归一：不在取值表内的输入（历史脏数据 / 恶意参数）回落 `"never"`，绝不静默放行。
pub fn normalize_hide_when(s: &str) -> String {
    if FIELD_HIDE_WHEN_VALUES.contains(&s) {
        s.to_string()
    } else {
        "never".to_string()
    }
}

fn default_hide_when() -> String {
    "never".to_string()
}

/// 「展示形态」用户覆盖的合法取值（ADR-0050 D21 决策 5）。落库为 TEXT，
/// 未知 / 缺失 / 空一律归一为 `"auto"`（跟随类型默认映射）。
pub const FIELD_DISPLAY_FORM_OVERRIDE_VALUES: &[&str] =
    &["auto", "icon", "icon-text", "text", "chip"];

/// 白名单归一：不在取值表内的输入回落 `"auto"`，绝不静默放行。
pub fn normalize_display_form_override(s: &str) -> String {
    if FIELD_DISPLAY_FORM_OVERRIDE_VALUES.contains(&s) {
        s.to_string()
    } else {
        "auto".to_string()
    }
}

fn default_display_form_override() -> String {
    "auto".to_string()
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
    /// 字段默认值：JSON 文本（与 `FieldValue.value_json` 同形，按 `type` 反序列化）；
    /// None = 无默认。打标时按此值为新成员块自动建 FieldValue（ADR-0050 D13）。
    #[serde(default)]
    pub default_value: Option<String>,
    /// 块属性展示的隐藏规则（ADR-0050 D18）：never / when_empty / when_not_empty /
    /// when_default / always。作用于块级字段区（BlockTagFields）；定义级全局共享。
    #[serde(default = "default_hide_when")]
    pub hide_when: String,
    /// 块字段区展示形态的用户覆盖（ADR-0050 D21 决策 5）：auto / icon / icon-text /
    /// text / chip。`auto` = 跟随类型默认映射；系统字段不可配，恒 `auto`（决策 6）。
    #[serde(default = "default_display_form_override")]
    pub display_form_override: String,
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
    /// 预设标记（ADR-0049 系统标签三态模型，2026-09-30 修订）：随应用首启分发、用户可改可删、删后可恢复。
    /// 域字段（project/area/book/...）落此标记；系统字段（status/priority）此列恒 0。
    #[serde(default)]
    pub is_preset: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldDefinitionCreateOptions {
    pub key: String,
    pub title: String,
    pub r#type: String,
    #[serde(default)]
    pub closed_values: Option<Vec<String>>,
    /// 字段默认值（JSON 文本）；建定义时一般留 None，随后经 UpdateFieldDefinition 设置。
    #[serde(default)]
    pub default_value: Option<String>,
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
            default_value: options.default_value,
            hide_when: "never".to_string(),
            display_form_override: "auto".to_string(),
            is_system: options.is_system,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
            is_preset: false,
        }
    }
}

/// 系统字段 seed 数据：单一来源 = `src/types/systemFieldSeed.json`
/// （同时驱动 TS `SYSTEM_TAGS` 的字段数据，见该 JSON 与 tag.ts；ADR-0049 D3 修订 + 2026-09-30 三态模型）。
/// Rust 侧在编译期 `include_str!` 嵌入并反序列化，不再在 .rs 里硬编码 12 行重复数据。
/// 三态分类（is_system / is_preset）由 JSON 携带。
#[derive(Debug, Clone, Deserialize)]
struct SeedFieldJson {
    id: String,
    key: String,
    title: String,
    r#type: String,
    #[serde(default, rename = "isSystem")]
    is_system: bool,
    #[serde(default, rename = "isPreset")]
    is_preset: bool,
    #[serde(default, rename = "closedValues")]
    closed_values: Option<Vec<String>>,
    /// 字段默认值（JSON 文本，ADR-0050 D13）。缺省 None = 无默认。
    #[serde(default, rename = "defaultValue")]
    default_value: Option<String>,
    /// 块属性展示隐藏规则（ADR-0050 D18）：never / when_empty / when_not_empty / when_default / always。
    /// 缺省 "never"（非法值经 `normalize_hide_when` 归一）。
    #[serde(default, rename = "hideWhen")]
    hide_when: String,
}

#[derive(Debug, Clone, Deserialize)]
struct SeedTagJson {
    key: String,
    title: String,
    /// 标签身份之描述（ADR-0050 D11）。缺省空串 = 未填写。
    #[serde(default)]
    description: String,
    /// 标签身份之配色：**调色板 token 名**（`--tag-color-N`，ADR-0050 D11），非 hex。缺省空串 = 无色。
    #[serde(default)]
    color: String,
    /// 引用顶层 `fields` 的 id（uuid）。字段定义已独立为顶层配置，tag 仅引用（grill 决策：字段与 tag 解耦）。
    #[serde(default, rename = "fieldIds")]
    field_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct SeedCatalogJson {
    /// 顶层字段定义（独立配置；系统 / 预设字段均在此声明，tag 经 `fieldIds` 引用）。
    fields: Vec<SeedFieldJson>,
    tags: Vec<SeedTagJson>,
}

/// 单一来源：解析 systemFieldSeed.json（TS 与 Rust 共享——字段数据与标签分组均从此派生）。
fn load_seed_catalog() -> SeedCatalogJson {
    serde_json::from_str(include_str!("../../../../src/types/systemFieldSeed.json"))
        .expect("systemFieldSeed.json must be valid JSON and match SeedCatalogJson")
}

/// ADR-0049 D3/D6 + 系统标签三态模型（2026-09-30 修订）：字段 seed 行（固定 id，不可删）。
///
/// 三态拆分（grilling 锁定）：
/// - **系统核心** `is_system = true, is_preset = false`：`status`（必锁，role:'status' 驱动看板分组 +
///   完成态）、`priority`（卡面字段 + 特殊描述符）。代码承重，用户不可改/删。
/// - **预设** `is_system = false, is_preset = true`：域字段（book/part/chapter/cfi/quote/
///   sourceBlockId/sourcePageId/language）。随应用首启分发，用户可改可删、删后可恢复。
/// - 字段定义独立为 `systemFieldSeed.json` 的顶层 `fields` 数组（不再内嵌在 tag 下），tag 经
///   `fieldIds` 引用；`default_value` / `hide_when` 也由此单一来源派生（ADR-0050 D13/D18）。
/// - 与 TS `SYSTEM_TAGS` 的字段一一对应（key 相同），数据单一来源为 systemFieldSeed.json。
///   所有字段 `type = "string"`；仅 `status` / `priority` 有 `closed_values`（候选值 value 数组）。
pub fn system_field_definitions() -> Vec<FieldDefinition> {
    let raw = load_seed_catalog();
    let now = chrono::Utc::now().timestamp_millis();
    raw.fields
        .iter()
        .map(|f| FieldDefinition {
            id: f.id.clone(),
            key: f.key.clone(),
            title: f.title.clone(),
            r#type: f.r#type.clone(),
            closed_values: f.closed_values.clone(),
            // default_value 列在 DB 中存 **JSON 文本**（与 UI 编辑路径 `JSON.stringify` 同形；
            // `decodeDefault` 经 `JSON.parse` 还原）。故此处把配置里的原始值编码为 JSON 文本，
            // 让 seed 的新建插入 / 回填三条路径与用户编辑路径一致地落库。None → 列存 NULL。
            default_value: f
                .default_value
                .as_ref()
                .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "null".to_string())),
            hide_when: normalize_hide_when(&f.hide_when),
            display_form_override: "auto".to_string(),
            is_system: f.is_system,
            is_preset: f.is_preset,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
        })
        .collect()
}

/// 从 JSON 派生系统 Tag 的 seed 规格（固定 db id、is_system=1、field_ids 引用顶层字段 uuid）。
///
/// db id 由 JSON `key` 推导（`"sys-tag-" + key`）；db title **等于** JSON `title`（单一来源，
/// 不叠加「系统」前缀——显示区分靠 `is_system` 标志 + UI 样式，而非标题文本）。
/// `field_ids` 直接读 tag 的 `fieldIds`（已是顶层字段的 uuid），不再做 key→uuid 映射、
/// 也不再内嵌字段数据——字段与 tag 在配置层解耦（grill 决策）。
/// 身份三要素之二 / 之三：description / color 直接透传 JSON（token 名，非 hex）。
pub fn system_tag_seeds() -> Vec<(String, String, Vec<String>, String, String)> {
    let raw = load_seed_catalog();
    raw.tags
        .iter()
        .map(|t| {
            let db_id = format!("sys-tag-{}", t.key);
            // db title 与 JSON title 一致（单一来源，不叠加「系统」前缀；显示区分靠 is_system 标志 + UI 样式）。
            let db_title = t.title.clone();
            // field_ids 直接引用顶层 fields 的 uuid（JSON 已声明，无需映射）。
            let field_ids = t.field_ids.clone();
            (db_id, db_title, field_ids, t.description.clone(), t.color.clone())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_catalog_json_is_single_source_of_10_fields() {
        let defs = system_field_definitions();
        assert_eq!(defs.len(), 10, "systemFieldSeed.json 必须展平为 10 个字段（project/area 已主动取消）");
        let keys: Vec<&str> = defs.iter().map(|d| d.key.as_str()).collect();
        assert_eq!(
            keys,
            vec![
                "status", "priority", "book", "part", "chapter", "cfi",
                "quote", "sourceBlockId", "sourcePageId", "language"
            ]
        );
    }

    #[test]
    fn seed_classification_matches_three_state_model() {
        let defs = system_field_definitions();
        let by_key = |k: &str| defs.iter().find(|d| d.key == k).unwrap();
        // 系统核心：不可改/删
        assert!(by_key("status").is_system && !by_key("status").is_preset);
        assert!(by_key("priority").is_system && !by_key("priority").is_preset);
        // 预设：用户可改可删、删后可恢复
        assert!(!by_key("book").is_system && by_key("book").is_preset);
        assert!(!by_key("language").is_system && by_key("language").is_preset);
    }

    #[test]
    fn seed_closed_values_come_from_json() {
        let defs = system_field_definitions();
        let status = defs.iter().find(|d| d.key == "status").unwrap();
        assert_eq!(
            status.closed_values,
            Some(vec![
                "Todo".to_string(),
                "Doing".to_string(),
                "Done".to_string(),
                "Canceled".to_string()
            ])
        );
        let book = defs.iter().find(|d| d.key == "book").unwrap();
        assert!(book.closed_values.is_none());
    }

    #[test]
    fn seed_field_default_and_hide_come_from_json() {
        let defs = system_field_definitions();
        // 字段独立配置后，default_value / hide_when 也由 JSON 派生（ADR-0050 D13/D18）。
        let status = defs.iter().find(|d| d.key == "status").unwrap();
        // default_value 在模型中即 DB 列的 JSON 文本形态（与 UI `JSON.stringify` 同形）。
        assert_eq!(status.default_value, Some("\"Todo\"".to_string()));
        assert_eq!(status.hide_when, "never");
        // 非法 hide_when 经 normalize_hide_when 归一为 never（配置层兜底，不静默放行）。
        let bogus = SeedFieldJson {
            id: "x".to_string(),
            key: "x".to_string(),
            title: "x".to_string(),
            r#type: "string".to_string(),
            is_system: false,
            is_preset: false,
            closed_values: None,
            default_value: None,
            hide_when: "bogus".to_string(),
        };
        assert_eq!(normalize_hide_when(&bogus.hide_when), "never");
    }

    #[test]
    fn seed_tag_grouping_derived_from_json() {
        let tags = system_tag_seeds();
        assert_eq!(tags.len(), 2, "JSON 必须定义 2 个系统 tag");
        let by_id = |id: &str| tags.iter().find(|(i, _, _, _, _)| i == id).unwrap();
        let (_, task_title, task_fields, task_desc, task_color) = by_id("sys-tag-system-task");
        assert_eq!(task_title, "任务");
        assert_eq!(task_fields.len(), 2);
        // 身份三要素：description / color 由 JSON 透传（token 名，非 hex）
        assert_eq!(task_desc, "系统任务");
        assert_eq!(task_color, "--tag-color-4");
        let (_, book_title, book_fields, book_desc, book_color) = by_id("sys-tag-system-book-note");
        assert_eq!(book_title, "书笔记");
        assert_eq!(book_fields.len(), 8);
        assert_eq!(book_desc, "系统书笔记");
        assert_eq!(book_color, "--tag-color-8");
        // field_ids 直接引用顶层字段 uuid（不在此硬编码，仅校验形状与数量）
        assert!(task_fields.iter().all(|u| u.len() == 36));
        assert!(book_fields.iter().all(|u| u.len() == 36));
    }
}
