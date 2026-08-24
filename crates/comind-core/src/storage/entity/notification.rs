use crate::types::Notification;
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// Notification 的规范列顺序与列名 —— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能（Q4b）。
///
/// 注意：列序与 `row_to_notification_native` 的位置索引必须一一对应，
/// 也与 `types/notification.rs` 中 `Notification` 的结构体字段顺序一致。
pub const NOTIFICATION_COLS: &[&str] = &[
    "id", "block_id", "page_id", "kind", "event_iso", "fired_at", "status",
    "snooze_until", "payload", "created_at", "updated_at",
];

pub fn notification_select_cols() -> String {
    NOTIFICATION_COLS.join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_insert_sql() -> String {
    let cols = notification_select_cols();
    let placeholders = vec!["?"; NOTIFICATION_COLS.len()].join(", ");
    format!("INSERT INTO Notification ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_notification_native(row: &rusqlite::Row) -> Result<Notification, rusqlite::Error> {
    Ok(Notification {
        id: row.get(0)?,
        block_id: row.get(1)?,
        page_id: row.get(2)?,
        kind: row.get(3)?,
        event_iso: row.get(4)?,
        fired_at: row.get(5)?,
        status: row.get(6)?,
        snooze_until: row.get(7)?,
        payload: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `NOTIFICATION_COLS`。
/// 保留原 sqljs 的语义：status 缺省 "unread"，snooze_until 空串→None，其余数值缺省 0。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_notification_js(row: &HashMap<String, String>) -> Notification {
    Notification {
        id: row.get("id").cloned().unwrap_or_default(),
        block_id: row.get("block_id").cloned().unwrap_or_default(),
        page_id: row.get("page_id").cloned().unwrap_or_default(),
        kind: row.get("kind").cloned().unwrap_or_default(),
        event_iso: row.get("event_iso").cloned().unwrap_or_default(),
        fired_at: row.get("fired_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        status: row.get("status").cloned().unwrap_or_else(|| "unread".to_string()),
        snooze_until: {
            let s = row.get("snooze_until").cloned().unwrap_or_default();
            if s.is_empty() { None } else { s.parse::<i64>().ok() }
        },
        payload: row.get("payload").cloned().unwrap_or_default(),
        created_at: row.get("created_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        updated_at: row.get("updated_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

// ── 原生 / 事务共享：自由函数（收 &E where E: Executor） ────────────────

#[cfg(not(target_arch = "wasm32"))]
fn bx(e: rusqlite::Error) -> Box<dyn Error> {
    Box::new(e)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_params(n: &Notification) -> Vec<&dyn ToSql> {
    vec![
        &n.id,
        &n.block_id,
        &n.page_id,
        &n.kind,
        &n.event_iso,
        &n.fired_at,
        &n.status,
        &n.snooze_until,
        &n.payload,
        &n.created_at,
        &n.updated_at,
    ]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<Notification, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM Notification WHERE id = ?1", notification_select_cols());
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_notification_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Notification not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_get_by_block_id<E: Executor>(
    exec: &E,
    block_id: &str,
) -> Result<Vec<Notification>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Notification WHERE block_id = ?1 ORDER BY fired_at DESC",
        notification_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&block_id];
    exec.query_map(&sql, &params, |row| row_to_notification_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_get_by_block_ids<E: Executor>(
    exec: &E,
    block_ids: &[String],
) -> Result<Vec<Notification>, Box<dyn Error>> {
    if block_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = (1..=block_ids.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "SELECT {} FROM Notification WHERE block_id IN ({}) ORDER BY fired_at DESC",
        notification_select_cols(),
        placeholders.join(", ")
    );
    let params: Vec<&dyn ToSql> = block_ids.iter().map(|id| id as &dyn ToSql).collect();
    exec.query_map(&sql, &params, |row| row_to_notification_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_find_by_event<E: Executor>(
    exec: &E,
    block_id: &str,
    kind: &str,
    event_iso: &str,
) -> Result<Option<Notification>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Notification WHERE block_id = ?1 AND kind = ?2 AND event_iso = ?3 LIMIT 1",
        notification_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&block_id, &kind, &event_iso];
    let rows = exec.query_map(&sql, &params, |row| row_to_notification_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_query_unread<E: Executor>(exec: &E) -> Result<Vec<Notification>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Notification WHERE status = 'unread' ORDER BY fired_at DESC",
        notification_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![];
    exec.query_map(&sql, &params, |row| row_to_notification_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_query_pending_due<E: Executor>(
    exec: &E,
    now_ms: i64,
) -> Result<Vec<Notification>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Notification WHERE status = 'pending' AND snooze_until IS NOT NULL AND snooze_until <= ?1 ORDER BY snooze_until ASC",
        notification_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&now_ms];
    exec.query_map(&sql, &params, |row| row_to_notification_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_query_recent<E: Executor>(
    exec: &E,
    limit: usize,
) -> Result<Vec<Notification>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Notification WHERE status IN ('unread', 'read') ORDER BY fired_at DESC LIMIT ?1",
        notification_select_cols()
    );
    let limit_i64: i64 = limit as i64;
    let params: Vec<&dyn ToSql> = vec![&limit_i64];
    exec.query_map(&sql, &params, |row| row_to_notification_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_create<E: Executor>(exec: &E, n: &Notification) -> Result<(), Box<dyn Error>> {
    let params = notification_params(n);
    exec.execute(&notification_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_batch_create<E: Executor>(
    exec: &E,
    notifications: &[Notification],
) -> Result<(), Box<dyn Error>> {
    for n in notifications {
        notification_create(exec, n)?;
    }
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_update_status<E: Executor>(
    exec: &E,
    id: &str,
    status: &str,
) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&status, &now, &id];
    exec.execute("UPDATE Notification SET status = ?1, updated_at = ?2 WHERE id = ?3", &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_set_snooze<E: Executor>(
    exec: &E,
    id: &str,
    snooze_until: i64,
    status: &str,
) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&snooze_until, &status, &now, &id];
    exec.execute(
        "UPDATE Notification SET snooze_until = ?1, status = ?2, updated_at = ?3 WHERE id = ?4",
        &params,
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    exec.execute("DELETE FROM Notification WHERE id = ?1", &[&id as &dyn ToSql])?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_delete_by_block_id<E: Executor>(
    exec: &E,
    block_id: &str,
) -> Result<(), Box<dyn Error>> {
    exec.execute(
        "DELETE FROM Notification WHERE block_id = ?1",
        &[&block_id as &dyn ToSql],
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_delete_by_block_and_kind<E: Executor>(
    exec: &E,
    block_id: &str,
    kind: &str,
) -> Result<(), Box<dyn Error>> {
    let params: Vec<&dyn ToSql> = vec![&block_id, &kind];
    exec.execute("DELETE FROM Notification WHERE block_id = ?1 AND kind = ?2", &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_delete_older_than<E: Executor>(
    exec: &E,
    timestamp: i64,
) -> Result<(), Box<dyn Error>> {
    let params: Vec<&dyn ToSql> = vec![&timestamp];
    exec.execute(
        "DELETE FROM Notification WHERE status = 'read' AND updated_at < ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_mark_all_read<E: Executor>(exec: &E) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&now];
    exec.execute(
        "UPDATE Notification SET status = 'read', updated_at = ?1 WHERE status = 'unread'",
        &params,
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_update_payload<E: Executor>(
    exec: &E,
    id: &str,
    payload: &str,
) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&payload, &now, &id];
    exec.execute("UPDATE Notification SET payload = ?1, updated_at = ?2 WHERE id = ?3", &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn notification_reschedule<E: Executor>(
    exec: &E,
    block_id: &str,
    kind: &str,
    new_event_iso: &str,
) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&new_event_iso, &now, &block_id, &kind];
    exec.execute(
        "UPDATE Notification SET event_iso = ?1, status = 'unread', snooze_until = NULL, updated_at = ?2 WHERE block_id = ?3 AND kind = ?4 AND status IN ('unread','read','dismissed')",
        &params,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_notification_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "n1".to_string());
        m.insert("block_id".to_string(), "b1".to_string());
        m.insert("page_id".to_string(), "p1".to_string());
        m.insert("kind".to_string(), "deadline".to_string());
        m.insert("event_iso".to_string(), "2026-01-01T00:00:00Z".to_string());
        m.insert("fired_at".to_string(), "100".to_string());
        m.insert("status".to_string(), "unread".to_string());
        m.insert("snooze_until".to_string(), "200".to_string());
        m.insert("payload".to_string(), "{}".to_string());
        m.insert("created_at".to_string(), "1".to_string());
        m.insert("updated_at".to_string(), "2".to_string());
        let n = row_to_notification_js(&m);
        assert_eq!(n.id, "n1");
        assert_eq!(n.block_id, "b1");
        assert_eq!(n.kind, "deadline");
        assert_eq!(n.fired_at, 100);
        assert_eq!(n.status, "unread");
        assert_eq!(n.snooze_until, Some(200));
    }

    #[test]
    fn row_to_notification_js_defaults() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "n2".to_string());
        m.insert("snooze_until".to_string(), "".to_string());
        let n = row_to_notification_js(&m);
        // status 缺省 "unread"，snooze_until 空串→None，数值缺省 0
        assert_eq!(n.status, "unread");
        assert_eq!(n.snooze_until, None);
        assert_eq!(n.fired_at, 0);
        assert_eq!(n.updated_at, 0);
    }
}
