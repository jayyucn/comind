use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DateRef {
    pub id: String,
    pub block_id: String,
    pub kind: String,
    pub iso: String,
    pub date_day: String,
    pub recurrence: String,
    pub lead_minutes: i64,
    pub created_at: i64,
}

impl DateRef {
    pub fn new(
        block_id: &str,
        kind: &str,
        iso: &str,
        recurrence: &str,
        lead_minutes: i64,
    ) -> Self {
        // date_day 由 iso 截断到天（'YYYY-MM-DD'），用于范围/逾期查询与索引。
        let date_day = iso.get(0..10).unwrap_or(iso).to_string();
        DateRef {
            id: Uuid::new_v4().to_string(),
            block_id: block_id.to_string(),
            kind: kind.to_string(),
            iso: iso.to_string(),
            date_day,
            recurrence: recurrence.to_string(),
            lead_minutes,
            created_at: Utc::now().timestamp_millis(),
        }
    }
}
