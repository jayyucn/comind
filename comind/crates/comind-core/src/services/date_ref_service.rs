use crate::storage::StorageAdapter;
use crate::types::DateRef;
use chrono::Utc;
use regex::Regex;
use std::error::Error;

pub struct DateRefService;

impl DateRefService {
    /// 从 block.content 提取 dateRef。
    /// 语法：{{kind:ISO|recurrence?|leadMinutes?}}，kind ∈ schedule|deadline。
    ///
    /// 这是提取的**唯一事实来源**（Rust 侧）。前端 `src/utils/date-ref.ts` 的 `parseDateRefs`
    /// 仅保留展示用格式化，提取逻辑请勿以 TS 为准，避免两端语法漂移。
    pub fn extract_date_refs(content: &str) -> Vec<DateRef> {
        let re = match Regex::new(
            r"\{\{(schedule|deadline):([^}|]+?)(?:\|([^}|]*))?(?:\|([^}]+?))?\}\}",
        ) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        let mut out: Vec<DateRef> = Vec::new();
        for cap in re.captures_iter(content) {
            let kind = &cap[1];
            let iso = cap[2].trim().to_string();
            if iso.is_empty() {
                continue;
            }
            let recurrence = cap
                .get(3)
                .map(|m| m.as_str().trim())
                .filter(|s| !s.is_empty())
                .unwrap_or("none");
            let lead = cap
                .get(4)
                .and_then(|m| m.as_str().trim().parse::<i64>().ok())
                .unwrap_or(0);
            out.push(DateRef::new("", kind, &iso, recurrence, lead));
        }
        out
    }

    /// 删除该 block 旧行 + 按新 content 重插。供 block 写入路径（BlockService / save_block_tree）调用。
    ///
    /// 注意：调用方传入的是 `&mut dyn StorageAdapter`（**非事务型**），
    /// 因此此处直接 delete + create_many，不要套 `storage.transaction(...)`。
    /// 非原子可接受——派生索引中途崩溃留脏行可经 `rebuild_all` 恢复。
    pub fn sync_date_refs_for_block(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        content: &str,
    ) -> Result<(), Box<dyn Error>> {
        storage.date_refs().delete_by_block_id(block_id)?;
        if !content.is_empty() {
            let refs: Vec<DateRef> = Self::extract_date_refs(content)
                .into_iter()
                .map(|mut r| {
                    r.block_id = block_id.to_string();
                    r
                })
                .collect();
            if !refs.is_empty() {
                storage.date_refs().create_many(&refs)?;
            }
        }
        Ok(())
    }

    pub fn query_by_date_range(
        storage: &mut dyn StorageAdapter,
        kind: &str,
        from: &str,
        to: &str,
    ) -> Result<Vec<DateRef>, Box<dyn Error>> {
        storage.date_refs().query_by_date_range(kind, from, to)
    }

    pub fn query_overdue(
        storage: &mut dyn StorageAdapter,
        today: &str,
    ) -> Result<Vec<DateRef>, Box<dyn Error>> {
        storage.date_refs().query_overdue(today)
    }

    pub fn get_by_block(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
    ) -> Result<Vec<DateRef>, Box<dyn Error>> {
        storage.date_refs().get_by_block_id(block_id)
    }

    /// 到期且非 recurring 的 dateRef（event_ts - lead_minutes 已到期）。
    /// 供 checkAndFire 热路径使用，避免每 60s 全表扫描。
    pub fn query_due_non_recurring(
        storage: &mut dyn StorageAdapter,
        now_ms: i64,
    ) -> Result<Vec<DateRef>, Box<dyn Error>> {
        storage.date_refs().query_due_non_recurring(now_ms)
    }

    /// 所有 recurring dateRef（数量小，全量扫，由 checkAndFire 在 TS 侧算下一周期）。
    pub fn query_all_recurring(
        storage: &mut dyn StorageAdapter,
    ) -> Result<Vec<DateRef>, Box<dyn Error>> {
        storage.date_refs().query_all_recurring()
    }

    /// 扫描所有 page 的 block 重新同步。幂等（先 delete 后插）。
    /// DB 打开后调用一次，用于回填历史 block（它们从未触发过写入即维护）。
    pub fn rebuild_all(storage: &mut dyn StorageAdapter) -> Result<usize, Box<dyn Error>> {
        let pages = storage.pages().get_all()?;
        let mut synced = 0usize;
        for page in pages {
            let blocks = storage.blocks().get_by_page_id(&page.id)?;
            for b in blocks {
                Self::sync_date_refs_for_block(storage, &b.id, &b.content)?;
                synced += 1;
            }
        }
        Ok(synced)
    }

    /// 复刻 TS 的 event_iso 计算（非 recurring 分支）：
    /// `new Date(iso).setHours(9,0,0,0)` 本地 → `toISOString().slice(0,16)` UTC。
    ///
    /// 单一事实来源在 `DateRef::compute_event_ts`（类型层），此处复用其毫秒结果再格式化为 ISO 串，
    /// 避免两端/两层各算一份导致漂移。
    pub fn compute_event_iso(iso: &str) -> String {
        let ms = DateRef::compute_event_ts(iso);
        if ms == 0 {
            return iso.to_string();
        }
        match chrono::DateTime::<Utc>::from_timestamp_millis(ms) {
            Some(dt) => dt.format("%Y-%m-%dT%H:%M").to_string(),
            None => iso.to_string(),
        }
    }

    /// 非 recurring 通知原地改期（方案 A）。
    ///
    /// block 内容改时间后，把匹配 `(block_id, kind)` 的通知随 dateRef 一起挪动：
    /// 改 `event_iso` 为新的计算值、重置 `status='unread'`、清空 `snooze_until`。
    /// 仅对非 recurring（`recurrence='none'`）生效——recurring 每轮 `event_iso` 天然不同，
    /// 走独立的 `findExistingNotification` 去重逻辑，不需要原地改期。
    ///
    /// 调用点：`BlockService::update` 在 `sync_date_refs_for_block` 之后。
    pub fn reschedule_notifications_on_change(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        old_content: &str,
        new_content: &str,
    ) -> Result<(), Box<dyn Error>> {
        let old_refs = Self::extract_date_refs(old_content);
        let new_refs = Self::extract_date_refs(new_content);
        for nref in &new_refs {
            if nref.recurrence != "none" {
                continue;
            }
            // 同 (kind) 上的旧 ref：仅当 iso 真的变化才改期
            if let Some(old) = old_refs.iter().find(|o| o.kind == nref.kind) {
                if old.iso != nref.iso {
                    let new_event_iso = Self::compute_event_iso(&nref.iso);
                    storage
                        .notifications()
                        .reschedule(block_id, &nref.kind, &new_event_iso)?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_event_iso_matches_js_local_9am() {
        // 复刻 TS: new Date("2026-07-20").setHours(9,0,0,0) 本地 -> toISOString().slice(0,16)
        // Rust 与 JS 共用本地时区，结果在任何时区都应与同环境 JS 一致。
        let result = DateRefService::compute_event_iso("2026-07-20");
        assert_eq!(result.len(), 16);
        assert!(result.starts_with("2026-07-20T"));
        assert!(result.ends_with(":00"));
    }

    #[test]
    fn compute_event_iso_falls_back_on_garbage() {
        assert_eq!(DateRefService::compute_event_iso("not-a-date"), "not-a-date");
    }

    #[test]
    fn dateref_new_event_ts_nonzero_for_timed_iso() {
        // 核心回归：带时间的 iso（如 "2026-07-20T14:00"）必须算出非零 event_ts，
        // 否则 checkAndFire 会 if (!eventTime) continue 跳过 → 通知创建不出。
        let r = DateRef::new("", "schedule", "2026-07-20T14:00", "none", 0);
        assert!(r.event_ts > 0, "timed iso must yield nonzero event_ts, got {}", r.event_ts);
        // 仅日期 iso 也应非零（本地 9:00）
        let r2 = DateRef::new("", "deadline", "2026-07-20", "none", 0);
        assert!(r2.event_ts > 0, "date-only iso must yield nonzero event_ts, got {}", r2.event_ts);
        // timed iso 的毫秒应大于 date-only 9:00 的毫秒（同日 14:00 > 9:00）
        assert!(r.event_ts > r2.event_ts);
    }
}
