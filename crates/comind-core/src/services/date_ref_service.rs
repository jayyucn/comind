use crate::storage::StorageAdapter;
use crate::types::DateRef;
use chrono::Utc;
use regex::Regex;
use std::error::Error;
use std::sync::OnceLock;

/// 复用的 date-ref 正则，进程内只编译一次。
/// `extract_date_refs` 在 `build_segments` 中按 block 调用，若每次都 `Regex::new`
/// 会因该复杂 pattern 的编译成本（~10ms/次）把月度加载拖到 1.5s+。
fn date_ref_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r"(?:^|[^\w@])@(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?)(?:[ \u00A0]?(📅|⏰))?(?:\|(daily|weekly|monthly|yearly|none)?)?(?:\|(\d+))?",
        )
        .expect("date-ref regex must compile")
    })
}

pub struct DateRefService;

impl DateRefService {
    /// 从 block.content 提取 dateRef。
    /// 语法：@ISO[emoji][|recurrence|lead]
    ///   - @2026-08-03         → kind=ref
    ///   - @2026-08-03 📅      → kind=schedule
    ///   - @2026-08-03 ⏰      → kind=deadline
    ///
    /// 这是提取的**唯一事实来源**（Rust 侧）。前端 `src/utils/date-ref.ts` 的 `parseDateRefs`
    /// 仅保留展示用格式化，提取逻辑请勿以 TS 为准，避免两端语法漂移。
    pub fn extract_date_refs(content: &str) -> Vec<DateRef> {
        let mut out: Vec<DateRef> = Vec::new();

        // 注意：原 pattern 用了 lookbehind `(?<![\w@])`，但当前 regex crate
        // 不支持 look-around（编译期 Err），会导致整段提取静默返回空。
        // 改用 `(?:^|[^\w@])` 消费前置非 word/非@ 字符，语义等价且无 lookbehind。
        // 该正则较复杂（Unicode 类 + 多选 + 可选组），单次编译约 10ms；
        // 月度加载 160+ 个 block 时逐次编译会累积到 1.5s+，故用 OnceLock 只编一次。
        let re = date_ref_regex();

        for cap in re.captures_iter(content) {
            let iso = cap[1].trim().to_string();
            if iso.is_empty() {
                continue;
            }
            let emoji = cap.get(2).map(|m| m.as_str()).unwrap_or("");
            let kind = match emoji {
                "📅" => "schedule",
                "⏰" => "deadline",
                _ => "ref",
            };
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
        // ref kind 不参与通知系统，过滤掉
        let old_refs: Vec<_> = old_refs.iter().filter(|r| r.kind != "ref").collect();
        let new_refs: Vec<_> = new_refs.iter().filter(|r| r.kind != "ref").collect();
        // 1) 删除场景：old 有某 kind 的 dateRef，new 已无 → 该 kind 通知变孤儿，硬删除。
        //    （block 内容删掉 @... 📅/⏰ 时的清理，保留仍存在的另一 kind。）
        for oref in &old_refs {
            let still_present = new_refs.iter().any(|n| n.kind == oref.kind);
            if !still_present {
                storage
                    .notifications()
                    .delete_by_block_and_kind(block_id, &oref.kind)?;
            }
        }
        // 2) 改期场景：同 (kind) 上的旧 ref，仅当 iso 真的变化才原地改期。
        for nref in &new_refs {
            if nref.recurrence != "none" {
                continue;
            }
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
    fn extract_date_refs_basic() {
        let refs = DateRefService::extract_date_refs("task @2026-07-20T14:00 📅 @2026-07-25 ⏰");
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].kind, "schedule");
        assert_eq!(refs[1].kind, "deadline");
    }

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

    // ===== 删除 schedule/deadline 后通知清理集成测试 =====
    use crate::storage::sqlite::SQLiteAdapter;
    use crate::{NotificationRepository, DateRefRepository};
    use crate::types::Notification;
    use crate::services::{BlockService, PageService};

    // 建一个真实 page + block（满足 DateRef/Notification 的 FK 约束），返回 block_id。
    fn setup_block(storage: &mut SQLiteAdapter, content: &str) -> String {
        // page 需要一个宿主 block_id（page 同时是一个 block）
        let page = PageService::create(storage, "", "Test Page", None, None, None, None, None).unwrap();
        let block = BlockService::create(storage, &page.id, None, content, "{}", "bullet", None).unwrap();
        block.id
    }

    fn seed_notification(storage: &mut SQLiteAdapter, block_id: &str, kind: &str, event_iso: &str) {
        let now = chrono::Utc::now().timestamp_millis();
        let n = Notification {
            id: format!("{}-{}", block_id, kind),
            block_id: block_id.to_string(),
            page_id: "p1".to_string(),
            kind: kind.to_string(),
            event_iso: event_iso.to_string(),
            fired_at: now,
            status: "unread".to_string(),
            snooze_until: None,
            payload: "{}".to_string(),
            created_at: now,
            updated_at: now,
        };
        storage.notifications().create(&n).unwrap();
    }

    #[test]
    fn removing_one_kind_deletes_only_that_kinds_notification() {
        let mut storage = SQLiteAdapter::open_in_memory().unwrap();
        // old 内容同时有 schedule + deadline（建 block 时自动 sync dateRef）
        let old = "task @2026-07-20T14:00 📅 @2026-07-25 ⏰";
        let block_id = setup_block(&mut storage, old);
        seed_notification(&mut storage, &block_id, "schedule", "2026-07-20T14:00");
        seed_notification(&mut storage, &block_id, "deadline", "2026-07-25T09:00");
        // new 内容删掉 schedule，保留 deadline（走 BlockService::update，它会 sync + reschedule）
        let new = "task @2026-07-25 ⏰";
        BlockService::update(&mut storage, &block_id, Some(new), None, None, None, None).unwrap();
        // schedule 通知已删，deadline 通知仍在
        let remaining = NotificationRepository::get_by_block_id(&storage, &block_id).unwrap();
        assert_eq!(remaining.len(), 1, "only deadline notification should remain");
        assert_eq!(remaining[0].kind, "deadline");
        // DateRef 也只剩 deadline
        let refs = DateRefRepository::get_by_block_id(&storage, &block_id).unwrap();
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].kind, "deadline");
    }

    #[test]
    fn deleting_block_removes_all_its_notifications() {
        let mut storage = SQLiteAdapter::open_in_memory().unwrap();
        let content = "task @2026-07-20T14:00 📅 @2026-07-25 ⏰";
        let block_id = setup_block(&mut storage, content);
        seed_notification(&mut storage, &block_id, "schedule", "2026-07-20T14:00");
        seed_notification(&mut storage, &block_id, "deadline", "2026-07-25T09:00");
        // 走真实 BlockService::delete（应清 DateRef + 通知）
        BlockService::delete(&mut storage, &block_id).unwrap();
        let remaining = NotificationRepository::get_by_block_id(&storage, &block_id).unwrap();
        assert_eq!(remaining.len(), 0, "all notifications should be gone after block delete");
        let refs = DateRefRepository::get_by_block_id(&storage, &block_id).unwrap();
        assert_eq!(refs.len(), 0);
    }

    #[test]
    fn rescheduling_still_works_when_iso_changes() {
        let mut storage = SQLiteAdapter::open_in_memory().unwrap();
        let old = "task @2026-07-20T14:00 📅";
        let block_id = setup_block(&mut storage, old);
        seed_notification(&mut storage, &block_id, "schedule", "2026-07-20T14:00");
        // 改时间（非删除）：通知应保留并改期，不应被删
        let new = "task @2026-07-21T15:00 📅";
        BlockService::update(&mut storage, &block_id, Some(new), None, None, None, None).unwrap();
        let remaining = NotificationRepository::get_by_block_id(&storage, &block_id).unwrap();
        assert_eq!(remaining.len(), 1, "notification should be kept (rescheduled, not deleted)");
        assert_eq!(remaining[0].kind, "schedule");
    }
}
