use chrono::{TimeZone, Utc};
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
    /// 预计算的事件时间戳（毫秒）。由 `iso` 经 `compute_event_iso` 推算（本地 9:00 → UTC 毫秒）。
    /// 用于 `checkAndFire` 的到期查询：`event_ts - lead_minutes * 60000 <= now` 一条 SQL 命中，避免全量遍历 block。
    pub event_ts: i64,
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
        // event_ts 预计算：iso → compute_event_iso（本地 9:00 UTC 毫秒）。
        // 注意：compute_event_iso 定义在 date_ref_service.rs，此处用 trait 方法需避免循环依赖，
        // 故直接内联最小推算（与 DateRefService::compute_event_iso 同语义）。
        let event_ts = Self::compute_event_ts(iso);
        DateRef {
            id: Uuid::new_v4().to_string(),
            block_id: block_id.to_string(),
            kind: kind.to_string(),
            iso: iso.to_string(),
            date_day,
            recurrence: recurrence.to_string(),
            lead_minutes,
            event_ts,
            created_at: Utc::now().timestamp_millis(),
        }
    }

    /// 内联版本的 event_ts 推算，与 `DateRefService::compute_event_iso` 语义一致：
    /// - 带时间 `YYYY-MM-DDTHH:MM[:SS]`：取本地指定时间（lead_minutes 才有意义）
    /// - 仅日期 `YYYY-MM-DD`：本地 9:00（与 TS compute_event_iso 同语义）
    /// naive 一律当作「本地时间」解释（与 JS `new Date("...T..:..")` 一致），再转 UTC 毫秒。
    pub fn compute_event_ts(iso: &str) -> i64 {
        // 带秒：YYYY-MM-DDTHH:MM:SS
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S") {
            if let Some(ms) = local_to_utc_ms(dt) {
                return ms;
            }
        }
        // 带分：YYYY-MM-DDTHH:MM
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M") {
            if let Some(ms) = local_to_utc_ms(dt) {
                return ms;
            }
        }
        // 仅日期：本地 9:00
        let date_part = iso.get(0..10).unwrap_or(iso);
        if let Ok(d) = chrono::NaiveDate::parse_from_str(date_part, "%Y-%m-%d") {
            if let Some(dt) = d.and_hms_opt(9, 0, 0) {
                if let Some(ms) = local_to_utc_ms(dt) {
                    return ms;
                }
            }
        }
        0
    }
}

/// 把「本地 naive 时间」转成 UTC 毫秒（与 JS `new Date(localString).getTime()` 同语义）。
fn local_to_utc_ms(naive: chrono::NaiveDateTime) -> Option<i64> {
    let local = chrono::Local.from_local_datetime(&naive).single()?;
    Some(local.timestamp_millis())
}
