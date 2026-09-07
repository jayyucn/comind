use crate::types::PageSnapshot;
#[cfg(any(target_arch = "wasm32", test))]
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// PageSnapshot 的规范列顺序与列名 —— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能（Q4b）。
pub const PAGE_SNAPSHOT_COLS: &[&str] = &[
    "page_id", "date", "version", "content_json", "created_at",
];

pub fn page_snapshot_select_cols() -> String {
    PAGE_SNAPSHOT_COLS.join(", ")
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_page_snapshot_native(row: &rusqlite::Row) -> Result<PageSnapshot, rusqlite::Error> {
    Ok(PageSnapshot {
        page_id: row.get(0)?,
        date: row.get(1)?,
        version: row.get(2)?,
        content_json: row.get(3)?,
        created_at: row.get(4)?,
    })
}

/// sql.js 路径：按列名查表（顺序无关，列名唯一权威），与原生同源于 `PAGE_SNAPSHOT_COLS`。
/// 数值解析失败 → 0（sql.js 全以字符串返回，防御性兜底）。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_page_snapshot_js(row: &HashMap<String, String>) -> PageSnapshot {
    PageSnapshot {
        page_id: row.get("page_id").cloned().unwrap_or_default(),
        date: row.get("date").cloned().unwrap_or_default(),
        version: row.get("version").and_then(|v| v.parse().ok()).unwrap_or(0),
        content_json: row.get("content_json").cloned().unwrap_or_default(),
        created_at: row.get("created_at").and_then(|v| v.parse().ok()).unwrap_or(0),
    }
}

// ── 原生 / 事务共享：自由函数（收 &E where E: Executor） ────────────────

#[cfg(not(target_arch = "wasm32"))]
fn bx(e: rusqlite::Error) -> Box<dyn Error> {
    Box::new(e)
}

/// 按 page_id 读快照；无 → None。物化前的幂等检查与历史渲染都走这里。
#[cfg(not(target_arch = "wasm32"))]
pub fn page_snapshot_get_by_page_id<E: Executor>(exec: &E, page_id: &str) -> Result<Option<PageSnapshot>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM page_snapshots WHERE page_id = ?1",
        page_snapshot_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&page_id];
    let rows = exec.query_map(&sql, &params, |row| row_to_page_snapshot_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

/// 物化写入（幂等键 page_id）：INSERT OR IGNORE —— 已存在则保留旧行、不覆盖
/// （永不重物化、永不改写，ADR-0042 A2）。随后回读并返回**实际落库**的行：
/// 首次写入返回刚插入的行；重复物化返回既有行（不谎报"本次插入了"）。
#[cfg(not(target_arch = "wasm32"))]
pub fn page_snapshot_create<E: Executor>(exec: &E, snapshot: &PageSnapshot) -> Result<PageSnapshot, Box<dyn Error>> {
    let sql = format!(
        "INSERT OR IGNORE INTO page_snapshots ({}) VALUES (?1, ?2, ?3, ?4, ?5)",
        page_snapshot_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![
        &snapshot.page_id,
        &snapshot.date,
        &snapshot.version,
        &snapshot.content_json,
        &snapshot.created_at,
    ];
    exec.execute(&sql, &params).map_err(bx)?;
    page_snapshot_get_by_page_id(exec, &snapshot.page_id)?
        .ok_or_else(|| Box::new(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "PageSnapshot not found after insert",
        )) as Box<dyn Error>)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_page_snapshot_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("page_id".to_string(), "page-1".to_string());
        m.insert("date".to_string(), "2026-09-06".to_string());
        m.insert("version".to_string(), "1".to_string());
        m.insert("content_json".to_string(), "{\"blocks\":[]}".to_string());
        m.insert("created_at".to_string(), "1234".to_string());
        let s = row_to_page_snapshot_js(&m);
        assert_eq!(s.page_id, "page-1");
        assert_eq!(s.date, "2026-09-06");
        assert_eq!(s.version, 1);
        assert_eq!(s.content_json, "{\"blocks\":[]}");
        assert_eq!(s.created_at, 1234);
    }

    #[test]
    fn row_to_page_snapshot_js_defaults() {
        let mut m = HashMap::new();
        m.insert("page_id".to_string(), "page-2".to_string());
        // 数值缺失/解析失败 → 0
        m.insert("version".to_string(), "bad".to_string());
        let s = row_to_page_snapshot_js(&m);
        assert_eq!(s.page_id, "page-2");
        assert_eq!(s.date, "");
        assert_eq!(s.version, 0);
        assert_eq!(s.created_at, 0);
    }
}
