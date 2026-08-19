use crate::types::Block;
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// Block 的规范列顺序与列名 —— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能（Q4b）。
///
/// 注意：列序与 `row_to_block_native` 的位置索引必须一一对应。
pub const BLOCK_COLS: &[&str] = &[
    "id", "page_id", "parent_id", "pos", "content", "format", "type",
    "created_at", "updated_at", "version", "deleted_at",
];

pub fn block_select_cols() -> String {
    BLOCK_COLS.join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_insert_sql() -> String {
    let cols = block_select_cols();
    let placeholders = vec!["?"; BLOCK_COLS.len()].join(", ");
    format!("INSERT INTO Block ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_block_native(row: &rusqlite::Row) -> Result<Block, rusqlite::Error> {
    Ok(Block {
        id: row.get(0)?,
        page_id: row.get(1)?,
        parent_id: row.get(2)?,
        pos: row.get(3)?,
        content: row.get(4)?,
        format: row.get(5)?,
        r#type: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
        version: row.get(9)?,
        deleted_at: row.get(10)?,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `BLOCK_COLS`。
/// 保留原 sqljs 的语义：parent_id 空串→None，format 缺省 "{}"，type 缺省 "bullet"。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_block_js(row: &HashMap<String, String>) -> Block {
    Block {
        id: row.get("id").cloned().unwrap_or_default(),
        page_id: row.get("page_id").cloned().unwrap_or_default(),
        parent_id: {
            let p = row.get("parent_id").cloned().unwrap_or_default();
            if p.is_empty() { None } else { Some(p) }
        },
        pos: row.get("pos").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        content: row.get("content").cloned().unwrap_or_default(),
        format: row.get("format").cloned().unwrap_or_else(|| "{}".to_string()),
        r#type: row.get("type").cloned().unwrap_or_else(|| "bullet".to_string()),
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
pub fn block_params(b: &Block) -> Vec<&dyn ToSql> {
    vec![
        &b.id, &b.page_id, &b.parent_id, &b.pos, &b.content, &b.format,
        &b.r#type, &b.created_at, &b.updated_at, &b.version, &b.deleted_at,
    ]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_get_all<E: Executor>(exec: &E) -> Result<Vec<Block>, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM Block WHERE deleted_at IS NULL", block_select_cols());
    let params: &[&dyn ToSql] = &[];
    exec.query_map(&sql, params, |row| row_to_block_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<Block, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM Block WHERE id = ?1 AND deleted_at IS NULL", block_select_cols());
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_block_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Block not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_get_by_page_id<E: Executor>(exec: &E, page_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Block WHERE page_id = ?1 AND deleted_at IS NULL ORDER BY pos",
        block_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&page_id];
    exec.query_map(&sql, &params, |row| row_to_block_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_get_children<E: Executor>(exec: &E, parent_id: &str) -> Result<Vec<Block>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Block WHERE parent_id = ?1 AND deleted_at IS NULL ORDER BY pos",
        block_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&parent_id];
    exec.query_map(&sql, &params, |row| row_to_block_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_get_by_ids<E: Executor>(exec: &E, ids: &[String]) -> Result<Vec<Block>, Box<dyn Error>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "SELECT {} FROM Block WHERE id IN ({}) AND deleted_at IS NULL",
        block_select_cols(),
        placeholders.join(", ")
    );
    let params: Vec<&dyn ToSql> = ids.iter().map(|id| id as &dyn ToSql).collect();
    exec.query_map(&sql, &params, |row| row_to_block_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_insert<E: Executor>(exec: &E, b: &Block) -> Result<(), Box<dyn Error>> {
    let params = block_params(b);
    exec.execute(&block_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_update<E: Executor>(exec: &E, b: &Block) -> Result<(), Box<dyn Error>> {
    let sql = "UPDATE Block SET page_id = ?2, parent_id = ?3, pos = ?4, content = ?5, format = ?6, type = ?7, updated_at = ?8, version = version + 1 WHERE id = ?1";
    let params: Vec<&dyn ToSql> = vec![
        &b.id, &b.page_id, &b.parent_id, &b.pos, &b.content, &b.format, &b.r#type, &b.updated_at,
    ];
    exec.execute(sql, &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_soft_delete_by_id<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&id, &now];
    exec.execute(
        "UPDATE Block SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_ids_by_page_id<E: Executor>(exec: &E, page_id: &str) -> Result<Vec<String>, Box<dyn Error>> {
    let params: Vec<&dyn ToSql> = vec![&page_id];
    exec.query_map(
        "SELECT id FROM Block WHERE page_id = ?1 AND deleted_at IS NULL",
        &params,
        |row| row.get(0),
    ).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_soft_delete_by_page_id<E: Executor>(exec: &E, page_id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&page_id, &now];
    exec.execute(
        "UPDATE Block SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE page_id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_block_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "b1".to_string());
        m.insert("page_id".to_string(), "p1".to_string());
        m.insert("parent_id".to_string(), "".to_string());
        m.insert("pos".to_string(), "1000".to_string());
        m.insert("content".to_string(), "hello".to_string());
        m.insert("format".to_string(), "{}".to_string());
        m.insert("type".to_string(), "bullet".to_string());
        m.insert("created_at".to_string(), "1".to_string());
        m.insert("updated_at".to_string(), "2".to_string());
        m.insert("version".to_string(), "3".to_string());
        m.insert("deleted_at".to_string(), "".to_string());
        let b = row_to_block_js(&m);
        assert_eq!(b.id, "b1");
        assert_eq!(b.parent_id, None);
        assert_eq!(b.pos, 1000);
        assert_eq!(b.version, 3);
        assert_eq!(b.deleted_at, None);
    }

    #[test]
    fn row_to_block_js_parent_id_some() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "b2".to_string());
        m.insert("parent_id".to_string(), "p2".to_string());
        m.insert("pos".to_string(), "0".to_string());
        let b = row_to_block_js(&m);
        assert_eq!(b.parent_id, Some("p2".to_string()));
        // 缺省列依旧给出合理默认值
        assert_eq!(b.format, "{}");
        assert_eq!(b.r#type, "bullet");
    }
}
