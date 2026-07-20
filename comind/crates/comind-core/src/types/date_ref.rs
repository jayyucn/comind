use chrono::{Timelike, Utc};
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
    /// 把 `YYYY-MM-DD` 当 UTC 午夜 → 转本地 → 设本地 9:00 → 回 UTC → 毫秒。
    pub fn compute_event_ts(iso: &str) -> i64 {
        let naive = match chrono::NaiveDate::parse_from_str(iso, "%Y-%m-%d") {
            Ok(n) => n,
            Err(_) => return 0,
        };
        let naive_midnight = match naive.and_hms_opt(0, 0, 0) {
            Some(n) => n,
            None => return 0,
        };
        let midnight_utc = chrono::DateTime::<Utc>::from_naive_utc_and_offset(naive_midnight, Utc);
        let local: chrono::DateTime<chrono::Local> = midnight_utc.with_timezone(&chrono::Local);
        let mut local9 = local;
        if let Some(t) = local.with_hour(9) { local9 = t; }
        if let Some(t) = local9.with_minute(0) { local9 = t; }
        if let Some(t) = local9.with_second(0) { local9 = t; }
        if let Some(t) = local9.with_nanosecond(0) { local9 = t; }
        let utc9: chrono::DateTime<Utc> = local9.with_timezone(&Utc);
        utc9.timestamp_millis()
    }
}
