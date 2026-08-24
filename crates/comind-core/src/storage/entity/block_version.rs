use crate::types::BlockVersion;
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// BlockVersion 的规范列顺序与列名 —— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能（Q4b）。
///
/// 注意：列序与 `row_to_block_version_native` 的位置索引必须一一对应，
/// 也与 `types/block_version.rs` 中 `BlockVersion` 的结构体字段顺序一致。
pub const BLOCK_VERSION_COLS: &[&str] = &[
    "id", "block_id", "version", "snapshot", "hash", "message", "source",
    "restored_from_version_id", "created_at",
];

pub fn block_version_select_cols() -> String {
    BLOCK_VERSION_COLS.join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_version_insert_sql() -> String {
    let cols = block_version_select_cols();
    let placeholders = vec!["?"; BLOCK_VERSION_COLS.len()].join(", ");
    format!("INSERT INTO BlockVersion ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_block_version_native(row: &rusqlite::Row) -> Result<BlockVersion, rusqlite::Error> {
    Ok(BlockVersion {
        id: row.get(0)?,
        block_id: row.get(1)?,
        version: row.get(2)?,
        snapshot: row.get(3)?,
        hash: row.get(4)?,
        message: row.get(5)?,
        source: row.get(6)?,
        restored_from_version_id: row.get(7)?,
        created_at: row.get(8)?,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `BLOCK_VERSION_COLS`。
/// 保留原 sqljs 的语义：message / restored_from_version_id 空串→None，数值缺省 0。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_block_version_js(row: &HashMap<String, String>) -> BlockVersion {
    BlockVersion {
        id: row.get("id").cloned().unwrap_or_default(),
        block_id: row.get("block_id").cloned().unwrap_or_default(),
        version: row.get("version").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        snapshot: row.get("snapshot").cloned().unwrap_or_default(),
        hash: row.get("hash").cloned().unwrap_or_default(),
        message: {
            let p = row.get("message").cloned().unwrap_or_default();
            if p.is_empty() { None } else { Some(p) }
        },
        source: row.get("source").cloned().unwrap_or_default(),
        restored_from_version_id: {
            let p = row.get("restored_from_version_id").cloned().unwrap_or_default();
            if p.is_empty() { None } else { Some(p) }
        },
        created_at: row.get("created_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

// ── 原生 / 事务共享：自由函数（收 &E where E: Executor） ────────────────

#[cfg(not(target_arch = "wasm32"))]
fn bx(e: rusqlite::Error) -> Box<dyn Error> {
    Box::new(e)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_version_params(v: &BlockVersion) -> Vec<&dyn ToSql> {
    vec![
        &v.id,
        &v.block_id,
        &v.version,
        &v.snapshot,
        &v.hash,
        &v.message,
        &v.source,
        &v.restored_from_version_id,
        &v.created_at,
    ]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_version_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<BlockVersion, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM BlockVersion WHERE id = ?1",
        block_version_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_block_version_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "BlockVersion not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_version_get_by_block_id<E: Executor>(
    exec: &E,
    block_id: &str,
) -> Result<Vec<BlockVersion>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM BlockVersion WHERE block_id = ?1 ORDER BY version DESC",
        block_version_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&block_id];
    exec.query_map(&sql, &params, |row| row_to_block_version_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_version_get_latest_version<E: Executor>(
    exec: &E,
    block_id: &str,
) -> Result<Option<BlockVersion>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM BlockVersion WHERE block_id = ?1 ORDER BY version DESC LIMIT 1",
        block_version_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&block_id];
    let rows = exec.query_map(&sql, &params, |row| row_to_block_version_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_version_create<E: Executor>(exec: &E, v: &BlockVersion) -> Result<(), Box<dyn Error>> {
    let params = block_version_params(v);
    exec.execute(&block_version_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_version_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    exec.execute("DELETE FROM BlockVersion WHERE id = ?1", &[&id as &dyn ToSql])?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_version_delete_by_block_id<E: Executor>(
    exec: &E,
    block_id: &str,
) -> Result<(), Box<dyn Error>> {
    exec.execute(
        "DELETE FROM BlockVersion WHERE block_id = ?1",
        &[&block_id as &dyn ToSql],
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn block_version_delete_older_than<E: Executor>(
    exec: &E,
    block_id: &str,
    timestamp: i64,
) -> Result<(), Box<dyn Error>> {
    exec.execute(
        "DELETE FROM BlockVersion WHERE block_id = ?1 AND created_at < ?2",
        &[&block_id as &dyn ToSql, &timestamp as &dyn ToSql],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_block_version_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "v1".to_string());
        m.insert("block_id".to_string(), "b1".to_string());
        m.insert("version".to_string(), "3".to_string());
        m.insert("snapshot".to_string(), "{}".to_string());
        m.insert("hash".to_string(), "abc".to_string());
        m.insert("message".to_string(), "initial".to_string());
        m.insert("source".to_string(), "user".to_string());
        m.insert("restored_from_version_id".to_string(), "v0".to_string());
        m.insert("created_at".to_string(), "123".to_string());
        let v = row_to_block_version_js(&m);
        assert_eq!(v.id, "v1");
        assert_eq!(v.block_id, "b1");
        assert_eq!(v.version, 3);
        assert_eq!(v.message, Some("initial".to_string()));
        assert_eq!(v.restored_from_version_id, Some("v0".to_string()));
        assert_eq!(v.created_at, 123);
    }

    #[test]
    fn row_to_block_version_js_option_none() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "v2".to_string());
        m.insert("message".to_string(), "".to_string());
        m.insert("restored_from_version_id".to_string(), "".to_string());
        let v = row_to_block_version_js(&m);
        assert_eq!(v.message, None);
        assert_eq!(v.restored_from_version_id, None);
        assert_eq!(v.version, 0);
    }
}
