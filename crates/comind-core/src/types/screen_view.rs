use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenView {
    pub id: String,
    pub entity: String,       // 所属实体键（'block' | 'page' | ...），用于按实体隔离命名视图
    pub parent_id: String,    // 两级层级：空串 = Screen（命名容器）；非空 = Tab，值为所属 Screen 的 id
    pub name: String,
    pub query_json: String,   // inline full BlockQuery (NOT foreign key to saved_filters)
    pub view_type: String,    // "table" | "board" | "calendar"
    pub group_by: String,     // "" = no grouping
    pub is_default: i64,      // 0 | 1
    pub sort_order: i64,
    pub config: String,       // JSON blob (LayoutConfig); nullable in DB, "" when absent
    pub created_at: i64,
    pub updated_at: i64,
}

impl ScreenView {
    pub fn new(entity: &str, parent_id: &str, name: &str, query_json: &str, view_type: &str, group_by: &str, is_default: bool, sort_order: i64, config: &str) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        ScreenView {
            id: Uuid::new_v4().to_string(),
            entity: entity.to_string(),
            parent_id: parent_id.to_string(),
            name: name.to_string(),
            query_json: query_json.to_string(),
            view_type: view_type.to_string(),
            group_by: group_by.to_string(),
            is_default: if is_default { 1 } else { 0 },
            sort_order,
            config: config.to_string(),
            created_at: now,
            updated_at: now,
        }
    }
}
