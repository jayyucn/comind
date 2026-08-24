use crate::storage::StorageAdapter;
use crate::types::{DateRef, Notification, NotificationConfig, Block, Page};
use std::error::Error;
use std::sync::OnceLock;

/// Notification engine migrated from TS notification-service.ts.
/// All recurrence/quiet-hours/batching logic now lives in Rust.
pub struct NotificationService;

impl NotificationService {
    /// Get notifications by block id. Thin forward for sync-changes collection in the write path.
    pub fn get_by_block_id(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
    ) -> Result<Vec<Notification>, Box<dyn Error>> {
        storage.notifications().get_by_block_id(block_id)
    }

    /// Check for due notifications and fire them. Returns newly created/activated notifications.
    /// This replaces the TS `NotificationService.checkAndFire()` with zero TS-side business logic.
    pub fn check_and_fire(
        storage: &mut dyn StorageAdapter,
        settings: &NotificationConfig,
    ) -> Result<Vec<Notification>, Box<dyn Error>> {
        if !settings.enabled {
            return Ok(vec![]);
        }

        if is_quiet_hours(settings) {
            return Ok(vec![]);
        }

        let now_ms = chrono::Utc::now().timestamp_millis();
        let mut fired: Vec<Notification> = vec![];

        // 1) Due non-recurring dateRefs (event_ts - lead*60*1000 <= now_ms, single SQL hit)
        let due_non_recurring = storage.date_refs().query_due_non_recurring(now_ms)?;

        // 2) All recurring dateRefs (small set, then calculate next event time in Rust)
        let recurring_refs = storage.date_refs().query_all_recurring()?;

        // Collect all unique block_ids
        let mut block_ids: Vec<String> = vec![];
        for r in due_non_recurring.iter().chain(recurring_refs.iter()) {
            if !block_ids.contains(&r.block_id) {
                block_ids.push(r.block_id.clone());
            }
        }

        if block_ids.is_empty() {
            return Ok(vec![]);
        }

        // Batch fetch blocks, pages, existing notifications
        let blocks = storage.blocks().get_by_ids(&block_ids)?;
        let notifications = storage.notifications().get_by_block_ids(&block_ids)?;

        let mut page_ids: Vec<String> = vec![];
        for b in &blocks {
            if !page_ids.contains(&b.page_id) {
                page_ids.push(b.page_id.clone());
            }
        }
        let pages = storage.pages().get_by_ids(&page_ids)?;

        // Lookup maps
        use std::collections::HashMap;
        let block_map: HashMap<String, &Block> = blocks.iter().map(|b| (b.id.clone(), b)).collect();
        let page_map: HashMap<String, &Page> = pages.iter().map(|p| (p.id.clone(), p)).collect();
        let notif_map: HashMap<String, &Notification> = notifications
            .iter()
            .map(|n| (format!("{}|{}|{}", n.block_id, n.kind, n.event_iso), n))
            .collect();

        // Process non-recurring
        for r in &due_non_recurring {
            if r.event_ts == 0 { continue; }
            let blk = match block_map.get(&r.block_id) { Some(b) => *b, None => continue };
            let pg = match page_map.get(&blk.page_id) { Some(p) => *p, None => continue };
            let key = format!("{}|{}|{}", r.block_id, r.kind, r.iso);
            let existing = notif_map.get(&key).copied();
            if let Some(n) = Self::fire_notification(storage, blk, pg, r, existing)? {
                fired.push(n);
            }
        }

        // Process recurring
        for r in &recurring_refs {
            let event_time = Self::calculate_next_event_time(&r.iso, &r.recurrence);
            if event_time == 0 { continue; }
            let effective_time = event_time - r.lead_minutes * 60 * 1000;
            if effective_time > now_ms { continue; }
            let blk = match block_map.get(&r.block_id) { Some(b) => *b, None => continue };
            let pg = match page_map.get(&blk.page_id) { Some(p) => *p, None => continue };
            let key = format!("{}|{}|{}", r.block_id, r.kind, r.iso);
            let existing = notif_map.get(&key).copied();
            if let Some(n) = Self::fire_notification(storage, blk, pg, r, existing)? {
                fired.push(n);
            }
        }

        // Cleanup old notifications (>30 days read notifications)
        let cutoff = chrono::Utc::now().timestamp_millis() - 30 * 24 * 60 * 60 * 1000;
        storage.notifications().delete_older_than(cutoff)?;

        Ok(fired)
    }

    /// Sync payload for all non-dismissed notifications of a block.
    /// Called from BlockService::update after content changes.
    /// Replaces TS `syncPayloadForBlock()`.
    pub fn sync_payload_for_block(
        storage: &mut dyn StorageAdapter,
        block: &Block,
        page: &Page,
    ) -> Result<(), Box<dyn Error>> {
        let date_refs = storage.date_refs().get_by_block_id(&block.id)?;
        for dr in &date_refs {
            if dr.kind == "ref" { continue; }
            let event_time = Self::calculate_next_event_time(&dr.iso, &dr.recurrence);
            if event_time == 0 { continue; }
            // Find existing non-dismissed notification by anchor (block_id, kind, event_iso)
            let notifs = storage.notifications().get_by_block_id(&block.id)?;
            let existing = notifs.iter().find(|n| {
                n.kind == dr.kind && n.event_iso == dr.iso && n.status != "dismissed"
            });
            if let Some(n) = existing {
                let payload = Self::build_payload(block, page, &dr.iso, &dr.kind);
                storage.notifications().update_payload(&n.id, &payload)?;
            }
        }
        Ok(())
    }

    /// Fire a single notification for a dateRef. Returns Some(notification) if created/activated.
    fn fire_notification(
        storage: &mut dyn StorageAdapter,
        block: &Block,
        page: &Page,
        date_ref: &DateRef,
        existing: Option<&Notification>,
    ) -> Result<Option<Notification>, Box<dyn Error>> {
        let event_iso = &date_ref.iso;

        if let Some(n) = existing {
            if n.status == "dismissed" {
                return Ok(None); // dismissed = soft-delete anchor, never rebuild
            }
            if n.status == "pending" {
                storage.notifications().update_status(&n.id, "unread")?;
                return Ok(Some(storage.notifications().get_by_id(&n.id)?));
            }
            // unread/read: reuse existing
            return Ok(Some(n.clone()));
        }

        // Create new notification
        let now = chrono::Utc::now().timestamp_millis();
        let payload = Self::build_payload(block, page, event_iso, &date_ref.kind);
        let id = format!("notif_{}_{}", now, uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("0"));
        let notification = Notification {
            id,
            block_id: block.id.clone(),
            page_id: page.id.clone(),
            kind: date_ref.kind.clone(),
            event_iso: event_iso.clone(),
            fired_at: now,
            status: "unread".to_string(),
            snooze_until: None,
            payload,
            created_at: now,
            updated_at: now,
        };
        storage.notifications().create(&notification)?;
        Ok(Some(notification))
    }

    fn build_payload(block: &Block, page: &Page, event_iso: &str, kind: &str) -> String {
        let block_snippet = strip_date_refs(&block.content)
            .trim()
            .chars()
            .take(100)
            .collect::<String>();
        let title = match kind {
            "deadline" => "截止日期提醒",
            "schedule" => "日程提醒",
            _ => "提醒",
        };
        let body = if block_snippet.is_empty() {
            page.title.clone()
        } else {
            block_snippet.clone()
        };
        serde_json::json!({
            "title": title,
            "body": body,
            "blockSnippet": block_snippet,
            "eventDisplay": event_iso,
            "blockId": block.id,
            "pageId": page.id,
            "pageTitle": page.title,
        }).to_string()
    }

    /// Replicates TS `calculateEventTime`: base ISO → local 9:00 → advance by recurrence rule.
    /// Returns UTC milliseconds or 0 on parse failure.
    pub fn calculate_next_event_time(iso: &str, recurrence: &str) -> i64 {
        use chrono::{NaiveDate, NaiveDateTime, Local, TimeZone, Datelike, Timelike};
        let base_dt: NaiveDateTime = if let Ok(dt) = NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M:%S") {
            dt
        } else if let Ok(dt) = NaiveDateTime::parse_from_str(iso, "%Y-%m-%dT%H:%M") {
            dt
        } else if let Ok(d) = NaiveDate::parse_from_str(&iso[..10.min(iso.len())], "%Y-%m-%d") {
            d.and_hms_opt(9, 0, 0).unwrap_or_default()
        } else {
            return 0;
        };

        let local_dt = match Local.from_local_datetime(&base_dt).single() {
            Some(dt) => dt,
            None => return 0,
        };

        let base_ms = local_dt.timestamp_millis();

        if recurrence.is_empty() || recurrence == "none" {
            return base_ms;
        }

        let now_ms = chrono::Utc::now().timestamp_millis();
        if base_ms > now_ms {
            return base_ms;
        }

        let day_ms: i64 = 24 * 60 * 60 * 1000;

        match recurrence {
            "daily" => {
                let days_diff = (now_ms - base_ms + day_ms - 1) / day_ms; // ceil
                base_ms + days_diff * day_ms
            }
            "weekly" => {
                let week_ms = 7 * day_ms;
                let weeks_diff = (now_ms - base_ms + week_ms - 1) / week_ms; // ceil
                base_ms + weeks_diff * week_ms
            }
            "monthly" => {
                let mut d = local_dt;
                while d.timestamp_millis() <= now_ms {
                    let day = d.day();
                    let next_month = d.month() + 1;
                    let year = d.year() + (next_month as i32 - 1) / 12;
                    let month = ((next_month - 1) % 12) + 1;
                    // Clamp day to last day of target month
                    let last_day = NaiveDate::from_ymd_opt(
                        year,
                        month + 1,
                        1,
                    ).map(|first_next| first_next.pred_opt().unwrap_or(first_next).day())
                    .unwrap_or(28);
                    let clamped_day = day.min(last_day);
                    let new_naive = NaiveDate::from_ymd_opt(year, month, clamped_day)
                        .and_then(|nd| nd.and_hms_opt(d.hour(), d.minute(), d.second()));
                    if let Some(ndt) = new_naive {
                        if let Some(ndt_local) = Local.from_local_datetime(&ndt).single() {
                            d = ndt_local;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                d.timestamp_millis()
            }
            "yearly" => {
                let mut d = local_dt;
                while d.timestamp_millis() <= now_ms {
                    let day = d.day();
                    let next_year = d.year() + 1;
                    let last_day = NaiveDate::from_ymd_opt(
                        next_year,
                        d.month() + 1,
                        1,
                    ).map(|first_next| first_next.pred_opt().unwrap_or(first_next).day())
                    .unwrap_or(28);
                    let clamped_day = day.min(last_day);
                    let new_naive = NaiveDate::from_ymd_opt(next_year, d.month(), clamped_day)
                        .and_then(|nd| nd.and_hms_opt(d.hour(), d.minute(), d.second()));
                    if let Some(ndt) = new_naive {
                        if let Some(ndt_local) = Local.from_local_datetime(&ndt).single() {
                            d = ndt_local;
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                d.timestamp_millis()
            }
            _ => base_ms,
        }
    }
}

/// Check if current local time is within quiet hours range.
/// Replicates TS `isQuietHours()`.
fn is_quiet_hours(settings: &NotificationConfig) -> bool {
    use chrono::Timelike;
    let start = match &settings.quiet_hours_start {
        Some(s) => s.as_str(),
        None => return false,
    };
    let end = match &settings.quiet_hours_end {
        Some(s) => s.as_str(),
        None => return false,
    };

    let parse_minutes = |s: &str| -> Option<i32> {
        let parts: Vec<&str> = s.split(':').collect();
        if parts.len() != 2 { return None; }
        let h: i32 = parts[0].parse().ok()?;
        let m: i32 = parts[1].parse().ok()?;
        if h > 23 || m > 59 { return None; }
        Some(h * 60 + m)
    };

    let start_min = match parse_minutes(start) { Some(v) => v, None => return false };
    let end_min = match parse_minutes(end) { Some(v) => v, None => return false };

    let now = chrono::Local::now();
    let now_min = now.hour() as i32 * 60 + now.minute() as i32;

    if start_min < end_min {
        now_min >= start_min && now_min < end_min
    } else {
        // Cross-midnight
        now_min >= start_min || now_min < end_min
    }
}

/// Strip dateRef syntax from content for snippet display.
fn strip_date_refs(content: &str) -> String {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"\{\{[^}]+\}\}").unwrap());
    re.replace_all(content, "").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_next_event_time_no_recurrence() {
        let ts = NotificationService::calculate_next_event_time("2026-08-08", "none");
        assert!(ts > 0);
    }

    #[test]
    fn test_calculate_next_event_time_daily() {
        let ts = NotificationService::calculate_next_event_time("2026-08-01", "daily");
        assert!(ts > 0);
        let now = chrono::Utc::now().timestamp_millis();
        assert!(ts >= now - 24 * 60 * 60 * 1000);
    }

    #[test]
    fn test_calculate_next_event_time_weekly() {
        let ts = NotificationService::calculate_next_event_time("2026-07-01", "weekly");
        assert!(ts > 0);
    }

    #[test]
    fn test_quiet_hours_normal() {
        let config = NotificationConfig {
            quiet_hours_start: Some("22:00".to_string()),
            quiet_hours_end: Some("08:00".to_string()),
            ..Default::default()
        };
        let _ = is_quiet_hours(&config);
    }

    #[test]
    fn test_quiet_hours_disabled() {
        let config = NotificationConfig {
            quiet_hours_start: None,
            quiet_hours_end: None,
            ..Default::default()
        };
        assert!(!is_quiet_hours(&config));
    }

    #[test]
    fn test_strip_date_refs() {
        let result = strip_date_refs("hello {{schedule:2026-08-01}} world {{deadline:2026-08-02}}");
        assert!(!result.contains("{{"));
        assert!(result.contains("hello"));
        assert!(result.contains("world"));
    }
}
