use crate::types::SavedFilter;
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// SavedFilter 的规范列顺序与列名 —— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能（Q4b）。
///
/// 注意：列序与 `row_to_saved_filter_native` 的位置索引必须一一对应，
/// 也与 `types/saved_filter.rs` 中 `SavedFilter` 的结构体字段顺序一致。
pub const SAVED_FILTER_COLS: &[&str] = &[
    "id", "name", "query_json", "created_at", "updated_at",
];

pub fn saved_filter_select_cols() -> String {
    SAVED_FILTER_COLS.join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn saved_filter_insert_sql() -> String {
    let cols = saved_filter_select_cols();
    let placeholders = vec!["?"; SAVED_FILTER_COLS.len()].join(", ");
    format!("INSERT INTO SavedFilter ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_saved_filter_native(row: &rusqlite::Row) -> Result<SavedFilter, rusqlite::Error> {
    Ok(SavedFilter {
        id: row.get(0)?,
        name: row.get(1)?,
        query_json: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `SAVED_FILTER_COLS`。
/// 保留原 sqljs 的语义：created_at / updated_at 解析失败→0，其余缺省空串。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_saved_filter_js(row: &HashMap<String, String>) -> SavedFilter {
    SavedFilter {
        id: row.get("id").cloned().unwrap_or_default(),
        name: row.get("name").cloned().unwrap_or_default(),
        query_json: row.get("query_json").cloned().unwrap_or_default(),
        created_at: row.get("created_at").and_then(|v| v.parse().ok()).unwrap_or(0),
        updated_at: row.get("updated_at").and_then(|v| v.parse().ok()).unwrap_or(0),
    }
}

// ── 原生 / 事务共享：自由函数（收 &E where E: Executor） ────────────────

#[cfg(not(target_arch = "wasm32"))]
fn bx(e: rusqlite::Error) -> Box<dyn Error> {
    Box::new(e)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn saved_filter_params(f: &SavedFilter) -> Vec<&dyn ToSql> {
    vec![&f.id, &f.name, &f.query_json, &f.created_at, &f.updated_at]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn saved_filter_get_all<E: Executor>(exec: &E) -> Result<Vec<SavedFilter>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM SavedFilter ORDER BY created_at DESC",
        saved_filter_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![];
    exec.query_map(&sql, &params, |row| row_to_saved_filter_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn saved_filter_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<SavedFilter, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM SavedFilter WHERE id = ?1", saved_filter_select_cols());
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_saved_filter_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "SavedFilter not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn saved_filter_create<E: Executor>(exec: &E, f: &SavedFilter) -> Result<(), Box<dyn Error>> {
    let params = saved_filter_params(f);
    exec.execute(&saved_filter_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn saved_filter_update<E: Executor>(exec: &E, f: &SavedFilter) -> Result<(), Box<dyn Error>> {
    let sql = "UPDATE SavedFilter SET name = ?2, query_json = ?3, updated_at = ?4 WHERE id = ?1";
    let params: Vec<&dyn ToSql> = vec![&f.id, &f.name, &f.query_json, &f.updated_at];
    exec.execute(sql, &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn saved_filter_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    exec.execute("DELETE FROM SavedFilter WHERE id = ?1", &[&id as &dyn ToSql])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_saved_filter_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "f1".to_string());
        m.insert("name".to_string(), "Active".to_string());
        m.insert("query_json".to_string(), "{\"q\":1}".to_string());
        m.insert("created_at".to_string(), "10".to_string());
        m.insert("updated_at".to_string(), "20".to_string());
        let f = row_to_saved_filter_js(&m);
        assert_eq!(f.id, "f1");
        assert_eq!(f.name, "Active");
        assert_eq!(f.query_json, "{\"q\":1}");
        assert_eq!(f.created_at, 10);
        assert_eq!(f.updated_at, 20);
    }

    #[test]
    fn row_to_saved_filter_js_defaults() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "f2".to_string());
        m.insert("created_at".to_string(), "bad".to_string());
        let f = row_to_saved_filter_js(&m);
        // 数值解析失败→0
        assert_eq!(f.created_at, 0);
        assert_eq!(f.updated_at, 0);
    }
}
