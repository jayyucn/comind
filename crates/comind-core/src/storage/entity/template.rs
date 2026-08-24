use crate::types::UserTemplate;
#[cfg(any(target_arch = "wasm32", test))]
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// UserTemplate 的规范列顺序与列名 —— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能（Q4b）。
///
/// 注意：列序与 `row_to_template_native` 的位置索引必须一一对应，
/// 也与 `types/template.rs` 中 `UserTemplate` 的结构体字段顺序一致。
pub const TEMPLATE_COLS: &[&str] = &[
    "id", "name", "category", "content", "created_at", "updated_at",
];

pub fn template_select_cols() -> String {
    TEMPLATE_COLS.join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn template_insert_sql() -> String {
    let cols = template_select_cols();
    let placeholders = vec!["?"; TEMPLATE_COLS.len()].join(", ");
    format!("INSERT INTO UserTemplate ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_template_native(row: &rusqlite::Row) -> Result<UserTemplate, rusqlite::Error> {
    Ok(UserTemplate {
        id: row.get(0)?,
        name: row.get(1)?,
        category: row.get(2)?,
        content: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `TEMPLATE_COLS`。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_template_js(row: &HashMap<String, String>) -> UserTemplate {
    UserTemplate {
        id: row.get("id").cloned().unwrap_or_default(),
        name: row.get("name").cloned().unwrap_or_default(),
        category: row.get("category").cloned().unwrap_or_default(),
        content: row.get("content").cloned().unwrap_or_default(),
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
pub fn template_params(t: &UserTemplate) -> Vec<&dyn ToSql> {
    vec![&t.id, &t.name, &t.category, &t.content, &t.created_at, &t.updated_at]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn template_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<UserTemplate, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM UserTemplate WHERE id = ?1", template_select_cols());
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_template_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "UserTemplate not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn template_get_by_name<E: Executor>(exec: &E, name: &str) -> Result<Option<UserTemplate>, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM UserTemplate WHERE name = ?1", template_select_cols());
    let params: Vec<&dyn ToSql> = vec![&name];
    let rows = exec.query_map(&sql, &params, |row| row_to_template_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn template_get_all<E: Executor>(exec: &E) -> Result<Vec<UserTemplate>, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM UserTemplate ORDER BY name", template_select_cols());
    let params: Vec<&dyn ToSql> = vec![];
    exec.query_map(&sql, &params, |row| row_to_template_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn template_create<E: Executor>(exec: &E, t: &UserTemplate) -> Result<(), Box<dyn Error>> {
    let params = template_params(t);
    exec.execute(&template_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn template_update<E: Executor>(exec: &E, t: &UserTemplate) -> Result<(), Box<dyn Error>> {
    let sql = "UPDATE UserTemplate SET name = ?2, category = ?3, content = ?4, updated_at = ?5 WHERE id = ?1";
    let params: Vec<&dyn ToSql> = vec![&t.id, &t.name, &t.category, &t.content, &t.updated_at];
    exec.execute(sql, &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn template_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    let params: Vec<&dyn ToSql> = vec![&id];
    exec.execute("DELETE FROM UserTemplate WHERE id = ?1", &params)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_template_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "t1".to_string());
        m.insert("name".to_string(), "Meeting".to_string());
        m.insert("category".to_string(), "work".to_string());
        m.insert("content".to_string(), "body".to_string());
        m.insert("created_at".to_string(), "1".to_string());
        m.insert("updated_at".to_string(), "2".to_string());
        let t = row_to_template_js(&m);
        assert_eq!(t.id, "t1");
        assert_eq!(t.name, "Meeting");
        assert_eq!(t.category, "work");
        assert_eq!(t.content, "body");
        assert_eq!(t.created_at, 1);
        assert_eq!(t.updated_at, 2);
    }

    #[test]
    fn row_to_template_js_defaults() {
        let m = HashMap::new();
        let t = row_to_template_js(&m);
        assert_eq!(t.id, "");
        assert_eq!(t.created_at, 0);
        assert_eq!(t.updated_at, 0);
    }
}
