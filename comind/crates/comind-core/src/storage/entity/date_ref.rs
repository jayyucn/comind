use crate::types::DateRef;
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// DateRef 的规范列顺序与列名 —— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能。
pub const DATE_REF_COLS: &[&str] = &[
    "id", "block_id", "kind", "iso", "date_day", "recurrence",
    "lead_minutes", "created_at", "event_ts", "updated_at", "version", "deleted_at",
];

pub fn date_ref_select_cols() -> String {
    DATE_REF_COLS.join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_insert_sql() -> String {
    let cols = date_ref_select_cols();
    let placeholders = vec!["?"; DATE_REF_COLS.len()].join(", ");
    format!("INSERT INTO DateRef ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_date_ref_native(row: &rusqlite::Row) -> Result<DateRef, rusqlite::Error> {
    Ok(DateRef {
        id: row.get(0)?,
        block_id: row.get(1)?,
        kind: row.get(2)?,
        iso: row.get(3)?,
        date_day: row.get(4)?,
        recurrence: row.get(5)?,
        lead_minutes: row.get(6)?,
        created_at: row.get(7)?,
        event_ts: row.get(8)?,
        updated_at: row.get(9)?,
        version: row.get(10)?,
        deleted_at: row.get(11)?,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `DATE_REF_COLS`。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_date_ref_js(row: &HashMap<String, String>) -> DateRef {
    DateRef {
        id: row.get("id").cloned().unwrap_or_default(),
        block_id: row.get("block_id").cloned().unwrap_or_default(),
        kind: row.get("kind").cloned().unwrap_or_default(),
        iso: row.get("iso").cloned().unwrap_or_default(),
        date_day: row.get("date_day").cloned().unwrap_or_default(),
        recurrence: row.get("recurrence").cloned().unwrap_or_default(),
        lead_minutes: row.get("lead_minutes").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        event_ts: row.get("event_ts").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        created_at: row.get("created_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        updated_at: row.get("updated_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        version: row.get("version").map(|s| s.parse::<i64>().unwrap_or(0)).unwrap_or(0),
        deleted_at: row.get("deleted_at").map(|s| s.parse::<i64>().ok()).unwrap_or(None),
    }
}

// ── 原生 / 事务共享：自由函数（收 &E where E: Executor） ────────────────

#[cfg(not(target_arch = "wasm32"))]
fn bx(e: rusqlite::Error) -> Box<dyn Error> {
    Box::new(e)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_params(d: &DateRef) -> Vec<&dyn ToSql> {
    vec![
        &d.id, &d.block_id, &d.kind, &d.iso, &d.date_day, &d.recurrence,
        &d.lead_minutes, &d.created_at, &d.event_ts, &d.updated_at, &d.version, &d.deleted_at,
    ]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_get_all<E: Executor>(exec: &E) -> Result<Vec<DateRef>, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM DateRef WHERE deleted_at IS NULL", date_ref_select_cols());
    let params: &[&dyn ToSql] = &[];
    exec.query_map(&sql, params, |row| row_to_date_ref_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<DateRef, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM DateRef WHERE id = ? AND deleted_at IS NULL", date_ref_select_cols());
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_date_ref_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "DateRef not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_get_by_block_id<E: Executor>(exec: &E, block_id: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM DateRef WHERE block_id = ? AND deleted_at IS NULL", date_ref_select_cols());
    let params: Vec<&dyn ToSql> = vec![&block_id];
    exec.query_map(&sql, &params, |row| row_to_date_ref_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_query_by_date_range<E: Executor>(exec: &E, kind: &str, from: &str, to: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM DateRef WHERE (kind = ?1 OR ?1 = '*') AND date_day BETWEEN ?2 AND ?3 AND deleted_at IS NULL ORDER BY date_day, block_id",
        date_ref_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&kind, &from, &to];
    exec.query_map(&sql, &params, |row| row_to_date_ref_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_query_overdue<E: Executor>(exec: &E, today: &str) -> Result<Vec<DateRef>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM DateRef WHERE kind = 'deadline' AND date_day < ? AND deleted_at IS NULL ORDER BY date_day",
        date_ref_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&today];
    exec.query_map(&sql, &params, |row| row_to_date_ref_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_query_due_non_recurring<E: Executor>(exec: &E, now_ms: i64) -> Result<Vec<DateRef>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM DateRef WHERE recurrence = 'none' AND kind != 'ref' AND (event_ts - lead_minutes * 60000) <= ?1 AND deleted_at IS NULL",
        date_ref_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&now_ms];
    exec.query_map(&sql, &params, |row| row_to_date_ref_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_query_all_recurring<E: Executor>(exec: &E) -> Result<Vec<DateRef>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM DateRef WHERE recurrence != 'none' AND kind != 'ref' AND deleted_at IS NULL",
        date_ref_select_cols()
    );
    let params: &[&dyn ToSql] = &[];
    exec.query_map(&sql, params, |row| row_to_date_ref_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_create<E: Executor>(exec: &E, d: &DateRef) -> Result<DateRef, Box<dyn Error>> {
    let params = date_ref_params(d);
    exec.execute(&date_ref_insert_sql(), &params)?;
    Ok(d.clone())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_create_many<E: Executor>(exec: &E, ds: &[DateRef]) -> Result<Vec<DateRef>, Box<dyn Error>> {
    for d in ds {
        date_ref_create(exec, d)?;
    }
    Ok(ds.to_vec())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&now, &id];
    exec.execute(
        "UPDATE DateRef SET deleted_at = ?1, version = version + 1, updated_at = ?1 WHERE id = ?2",
        &params,
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn date_ref_delete_by_block_id<E: Executor>(exec: &E, block_id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&now, &block_id];
    exec.execute(
        "UPDATE DateRef SET deleted_at = ?1, version = version + 1, updated_at = ?1 WHERE block_id = ?2",
        &params,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_date_ref_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "x".to_string());
        m.insert("block_id".to_string(), "b".to_string());
        m.insert("kind".to_string(), "deadline".to_string());
        m.insert("iso".to_string(), "2026-08-20".to_string());
        m.insert("date_day".to_string(), "2026-08-20".to_string());
        m.insert("recurrence".to_string(), "none".to_string());
        m.insert("lead_minutes".to_string(), "15".to_string());
        m.insert("event_ts".to_string(), "999".to_string());
        m.insert("created_at".to_string(), "1".to_string());
        m.insert("updated_at".to_string(), "1".to_string());
        m.insert("version".to_string(), "2".to_string());
        m.insert("deleted_at".to_string(), "".to_string());
        let dr = row_to_date_ref_js(&m);
        assert_eq!(dr.id, "x");
        assert_eq!(dr.lead_minutes, 15);
        assert_eq!(dr.event_ts, 999);
        assert_eq!(dr.version, 2);
        assert_eq!(dr.deleted_at, None);
    }
}
