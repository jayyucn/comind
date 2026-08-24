use crate::types::ScreenView;
#[cfg(any(target_arch = "wasm32", test))]
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// ScreenView 的规范列（真实列名，INSERT 顺序）—— 唯一来源。
/// 注意：screen_view 表的 `SELECT` 列顺序与 INSERT 不同（见 `screen_view_select_cols`）：
/// 原生需 `COALESCE(config, '')` 把 NULL 映射为 ""，且 `entity`/`parent_id` 在 SELECT 中靠后，
/// 故 `row_to_screen_view_native` 按该 SELECT 位置序读取。sql.js 按名读取，两边 SELECT 列名一致（Q4b）。
pub const SCREEN_VIEW_COLS: &[&str] = &[
    "id", "entity", "parent_id", "name", "query_json", "view_type", "group_by",
    "is_default", "sort_order", "config", "created_at", "updated_at",
];

/// SELECT 列列表（原生位置序，含 `COALESCE(config, '')`）。两引擎共用，列序 drift 结构上不可能。
pub fn screen_view_select_cols() -> String {
    "id, name, query_json, view_type, group_by, is_default, sort_order, COALESCE(config, '') AS config, entity, parent_id, created_at, updated_at".to_string()
}

#[cfg(not(target_arch = "wasm32"))]
pub fn screen_view_insert_sql() -> String {
    let cols = SCREEN_VIEW_COLS.join(", ");
    let placeholders = vec!["?"; SCREEN_VIEW_COLS.len()].join(", ");
    format!("INSERT INTO screen_view ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_screen_view_native(row: &rusqlite::Row) -> Result<ScreenView, rusqlite::Error> {
    Ok(ScreenView {
        id: row.get(0)?,
        entity: row.get(8).unwrap_or_else(|_| "block".to_string()),
        parent_id: row.get(9).unwrap_or_default(),
        name: row.get(1)?,
        query_json: row.get(2)?,
        view_type: row.get(3)?,
        group_by: row.get(4)?,
        is_default: row.get(5)?,
        sort_order: row.get(6)?,
        config: row.get(7)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

/// sql.js 路径：按列名查表（顺序无关，列名唯一权威），与原生同源于 `screen_view_select_cols`。
/// 保留原 sqljs 的语义：entity 缺省 "block"，is_default/sort_order/created_at/updated_at 解析失败→0，
/// config 缺省 ""。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_screen_view_js(row: &HashMap<String, String>) -> ScreenView {
    ScreenView {
        id: row.get("id").cloned().unwrap_or_default(),
        entity: row.get("entity").cloned().unwrap_or_else(|| "block".to_string()),
        parent_id: row.get("parent_id").cloned().unwrap_or_default(),
        name: row.get("name").cloned().unwrap_or_default(),
        query_json: row.get("query_json").cloned().unwrap_or_default(),
        view_type: row.get("view_type").cloned().unwrap_or_default(),
        group_by: row.get("group_by").cloned().unwrap_or_default(),
        is_default: row.get("is_default").and_then(|v| v.parse().ok()).unwrap_or(0),
        sort_order: row.get("sort_order").and_then(|v| v.parse().ok()).unwrap_or(0),
        config: row.get("config").cloned().unwrap_or_default(),
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
pub fn screen_view_get_all_by_entity<E: Executor>(
    exec: &E,
    entity: &str,
) -> Result<Vec<ScreenView>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM screen_view WHERE entity = ?1 ORDER BY sort_order ASC, created_at DESC",
        screen_view_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&entity];
    exec.query_map(&sql, &params, |row| row_to_screen_view_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn screen_view_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<ScreenView, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM screen_view WHERE id = ?1", screen_view_select_cols());
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_screen_view_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "ScreenView not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn screen_view_create<E: Executor>(exec: &E, view: &ScreenView) -> Result<(), Box<dyn Error>> {
    let params: Vec<&dyn ToSql> = vec![
        &view.id,
        &view.entity,
        &view.parent_id,
        &view.name,
        &view.query_json,
        &view.view_type,
        &view.group_by,
        &view.is_default,
        &view.sort_order,
        &view.config,
        &view.created_at,
        &view.updated_at,
    ];
    exec.execute(&screen_view_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn screen_view_update<E: Executor>(exec: &E, view: &ScreenView) -> Result<(), Box<dyn Error>> {
    let sql = "UPDATE screen_view SET parent_id = ?2, name = ?3, query_json = ?4, view_type = ?5, group_by = ?6, is_default = ?7, sort_order = ?8, config = ?9, updated_at = ?10 WHERE id = ?1";
    let params: Vec<&dyn ToSql> = vec![
        &view.id,
        &view.parent_id,
        &view.name,
        &view.query_json,
        &view.view_type,
        &view.group_by,
        &view.is_default,
        &view.sort_order,
        &view.config,
        &view.updated_at,
    ];
    exec.execute(sql, &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn screen_view_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    exec.execute("DELETE FROM screen_view WHERE id = ?1", &[&id as &dyn ToSql])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_screen_view_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "v1".to_string());
        m.insert("entity".to_string(), "page".to_string());
        m.insert("parent_id".to_string(), "p0".to_string());
        m.insert("name".to_string(), "Table".to_string());
        m.insert("query_json".to_string(), "{}".to_string());
        m.insert("view_type".to_string(), "table".to_string());
        m.insert("group_by".to_string(), "".to_string());
        m.insert("is_default".to_string(), "1".to_string());
        m.insert("sort_order".to_string(), "5".to_string());
        m.insert("config".to_string(), "{\"x\":1}".to_string());
        m.insert("created_at".to_string(), "3".to_string());
        m.insert("updated_at".to_string(), "4".to_string());
        let v = row_to_screen_view_js(&m);
        assert_eq!(v.id, "v1");
        assert_eq!(v.entity, "page");
        assert_eq!(v.parent_id, "p0");
        assert_eq!(v.name, "Table");
        assert_eq!(v.view_type, "table");
        assert_eq!(v.is_default, 1);
        assert_eq!(v.sort_order, 5);
        assert_eq!(v.config, "{\"x\":1}");
        assert_eq!(v.created_at, 3);
    }

    #[test]
    fn row_to_screen_view_js_defaults() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "v2".to_string());
        m.insert("is_default".to_string(), "bad".to_string());
        let v = row_to_screen_view_js(&m);
        // entity 缺省 "block"，数值解析失败→0，config 缺省 ""
        assert_eq!(v.entity, "block");
        assert_eq!(v.is_default, 0);
        assert_eq!(v.sort_order, 0);
        assert_eq!(v.config, "");
    }
}
