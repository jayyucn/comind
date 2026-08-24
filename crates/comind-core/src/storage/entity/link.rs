use crate::types::Link;
#[cfg(any(target_arch = "wasm32", test))]
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// Link 的规范列顺序与列名 —— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能（Q4b）。
///
/// 注意：列序与 `row_to_link_native` 的位置索引必须一一对应，
/// 也与 `types/link.rs` 中 `Link` 的结构体字段顺序一致。
pub const LINK_COLS: &[&str] = &[
    "id", "source_block_id", "target_page_id", "display_text",
    "relationship_type", "created_at", "updated_at", "version", "deleted_at",
];

pub fn link_select_cols() -> String {
    LINK_COLS.join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn link_insert_sql() -> String {
    let cols = link_select_cols();
    let placeholders = vec!["?"; LINK_COLS.len()].join(", ");
    format!("INSERT INTO Link ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_link_native(row: &rusqlite::Row) -> Result<Link, rusqlite::Error> {
    Ok(Link {
        id: row.get(0)?,
        source_block_id: row.get(1)?,
        target_page_id: row.get(2)?,
        display_text: row.get(3)?,
        relationship_type: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
        version: row.get(7)?,
        deleted_at: row.get(8)?,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `LINK_COLS`。
/// 保留原 sqljs 的语义：relationship_type 空串→None，deleted_at 解析失败→None。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_link_js(row: &HashMap<String, String>) -> Link {
    Link {
        id: row.get("id").cloned().unwrap_or_default(),
        source_block_id: row.get("source_block_id").cloned().unwrap_or_default(),
        target_page_id: row.get("target_page_id").cloned().unwrap_or_default(),
        display_text: row.get("display_text").cloned().unwrap_or_default(),
        relationship_type: {
            let p = row.get("relationship_type").cloned().unwrap_or_default();
            if p.is_empty() { None } else { Some(p) }
        },
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
pub fn link_params(l: &Link) -> Vec<&dyn ToSql> {
    vec![
        &l.id,
        &l.source_block_id,
        &l.target_page_id,
        &l.display_text,
        &l.relationship_type,
        &l.created_at,
        &l.updated_at,
        &l.version,
        &l.deleted_at,
    ]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn link_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<Link, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Link WHERE id = ?1 AND deleted_at IS NULL",
        link_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_link_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Link not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn link_get_by_source_block_id<E: Executor>(
    exec: &E,
    source_block_id: &str,
) -> Result<Vec<Link>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Link WHERE source_block_id = ?1 AND deleted_at IS NULL",
        link_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&source_block_id];
    exec.query_map(&sql, &params, |row| row_to_link_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn link_get_by_source_block_ids<E: Executor>(
    exec: &E,
    source_block_ids: &[String],
) -> Result<Vec<Link>, Box<dyn Error>> {
    if source_block_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = (1..=source_block_ids.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "SELECT {} FROM Link WHERE source_block_id IN ({}) AND deleted_at IS NULL",
        link_select_cols(),
        placeholders.join(", ")
    );
    let params: Vec<&dyn ToSql> = source_block_ids.iter().map(|id| id as &dyn ToSql).collect();
    exec.query_map(&sql, &params, |row| row_to_link_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn link_get_by_target_page_id<E: Executor>(
    exec: &E,
    target_page_id: &str,
) -> Result<Vec<Link>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Link WHERE target_page_id = ?1 AND deleted_at IS NULL",
        link_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&target_page_id];
    exec.query_map(&sql, &params, |row| row_to_link_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn link_insert<E: Executor>(exec: &E, l: &Link) -> Result<(), Box<dyn Error>> {
    let params = link_params(l);
    exec.execute(&link_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn link_create_many<E: Executor>(exec: &E, links: &[Link]) -> Result<(), Box<dyn Error>> {
    for l in links {
        link_insert(exec, l)?;
    }
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn link_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&id, &now];
    exec.execute(
        "UPDATE Link SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn link_delete_by_source_block_id<E: Executor>(
    exec: &E,
    source_block_id: &str,
) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&source_block_id, &now];
    exec.execute(
        "UPDATE Link SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE source_block_id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn link_delete_by_target_page_id<E: Executor>(
    exec: &E,
    target_page_id: &str,
) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&target_page_id, &now];
    exec.execute(
        "UPDATE Link SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE target_page_id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_link_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "l1".to_string());
        m.insert("source_block_id".to_string(), "b1".to_string());
        m.insert("target_page_id".to_string(), "p1".to_string());
        m.insert("display_text".to_string(), "link".to_string());
        m.insert("relationship_type".to_string(), "ref".to_string());
        m.insert("created_at".to_string(), "1".to_string());
        m.insert("updated_at".to_string(), "2".to_string());
        m.insert("version".to_string(), "3".to_string());
        m.insert("deleted_at".to_string(), "100".to_string());
        let l = row_to_link_js(&m);
        assert_eq!(l.id, "l1");
        assert_eq!(l.source_block_id, "b1");
        assert_eq!(l.target_page_id, "p1");
        assert_eq!(l.display_text, "link");
        assert_eq!(l.relationship_type, Some("ref".to_string()));
        assert_eq!(l.version, 3);
        assert_eq!(l.deleted_at, Some(100));
    }

    #[test]
    fn row_to_link_js_relationship_none() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "l2".to_string());
        m.insert("relationship_type".to_string(), "".to_string());
        m.insert("deleted_at".to_string(), "".to_string());
        let l = row_to_link_js(&m);
        assert_eq!(l.relationship_type, None);
        assert_eq!(l.deleted_at, None);
        // 缺省列依旧给出合理默认值
        assert_eq!(l.version, 0);
    }
}
