use crate::types::Tag;
#[cfg(any(target_arch = "wasm32", test))]
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// Tag 的规范列顺序与列名 —— 唯一来源（ADR-0049 D1 / D6）。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取。
///
/// - `field_ids`：物化后的字段定义 id 列表，落库为 JSON TEXT（D6/D8）。
/// - `extends`：多继承父 Tag id 列表，落库为 JSON TEXT（D8）。
pub const TAG_COLS: &[&str] = &[
    "id", "title", "field_ids", "extends", "created_at", "updated_at", "version", "deleted_at",
    // 末尾追加，不位移既有位置索引（同 Block.tags 追加策略）；grill 决策 #5
    "is_system",
];

pub fn tag_select_cols() -> String {
    TAG_COLS.join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn tag_insert_sql() -> String {
    let cols = tag_select_cols();
    let placeholders = vec!["?"; TAG_COLS.len()].join(", ");
    format!("INSERT INTO Tag ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_tag_native(row: &rusqlite::Row) -> Result<Tag, rusqlite::Error> {
    Ok(Tag {
        id: row.get(0)?,
        title: row.get(1)?,
        field_ids: row.get::<_, String>(2)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
        extends: row.get::<_, String>(3)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default(),
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        version: row.get(6)?,
        deleted_at: row.get(7)?,
        is_system: row.get::<_, i64>(8)? != 0,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `TAG_COLS`。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_tag_js(row: &HashMap<String, String>) -> Tag {
    Tag {
        id: row.get("id").cloned().unwrap_or_default(),
        title: row.get("title").cloned().unwrap_or_default(),
        field_ids: row
            .get("field_ids")
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default(),
        extends: row
            .get("extends")
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default(),
        created_at: row.get("created_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        updated_at: row.get("updated_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        version: row.get("version").map(|s| s.parse::<i64>().unwrap_or(0)).unwrap_or(0),
        deleted_at: row.get("deleted_at").map(|s| s.parse::<i64>().ok()).unwrap_or(None),
        is_system: row.get("is_system").map(|s| s == "1").unwrap_or(false),
    }
}

// ── 原生 / 事务共享：自由函数（收 &E where E: Executor） ────────────────

#[cfg(not(target_arch = "wasm32"))]
fn bx(e: rusqlite::Error) -> Box<dyn Error> {
    Box::new(e)
}

/// JSON 序列化辅助：Vec<String> → JSON TEXT（始终非空数组，非 NULL）。
#[cfg(not(target_arch = "wasm32"))]
fn vec_to_json(v: &[String]) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn tag_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<Tag, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Tag WHERE id = ?1 AND deleted_at IS NULL",
        tag_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_tag_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Tag not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn tag_get_by_title<E: Executor>(exec: &E, title: &str) -> Result<Option<Tag>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Tag WHERE title = ?1 AND deleted_at IS NULL",
        tag_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&title];
    let rows = exec.query_map(&sql, &params, |row| row_to_tag_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

/// 按 title 查找**含软删行**（联动复挂语义：软删行仍占 title UNIQUE，复活而非重建）。
#[cfg(not(target_arch = "wasm32"))]
pub fn tag_get_by_title_including_deleted<E: Executor>(
    exec: &E,
    title: &str,
) -> Result<Option<Tag>, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM Tag WHERE title = ?1", tag_select_cols());
    let params: Vec<&dyn ToSql> = vec![&title];
    let rows = exec.query_map(&sql, &params, |row| row_to_tag_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

/// 撤销软删（按 title 复活；与 tag_delete 的盖戳方式对称，只清 deleted_at）。
#[cfg(not(target_arch = "wasm32"))]
pub fn tag_undelete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    exec.execute(
        "UPDATE Tag SET deleted_at = NULL, version = version + 1, updated_at = ?2 WHERE id = ?1",
        &[&id, &chrono::Utc::now().timestamp_millis()],
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn tag_get_all<E: Executor>(exec: &E) -> Result<Vec<Tag>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Tag WHERE deleted_at IS NULL ORDER BY created_at",
        tag_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![];
    exec.query_map(&sql, &params, |row| row_to_tag_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn tag_create<E: Executor>(exec: &E, t: &Tag) -> Result<(), Box<dyn Error>> {
    // 内联 JSON 序列化：避免返回引用本地序列化变量的 Vec<&dyn ToSql>（悬垂引用）。
    let field_ids_json = vec_to_json(&t.field_ids);
    let extends_json = vec_to_json(&t.extends);
    let is_system_i64: i64 = if t.is_system { 1 } else { 0 };
    let params: Vec<&dyn ToSql> = vec![
        &t.id,
        &t.title,
        &field_ids_json,
        &extends_json,
        &t.created_at,
        &t.updated_at,
        &t.version,
        &t.deleted_at,
        &is_system_i64,
    ];
    exec.execute(&tag_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn tag_update<E: Executor>(exec: &E, t: &Tag) -> Result<(), Box<dyn Error>> {
    let field_ids_json = vec_to_json(&t.field_ids);
    let extends_json = vec_to_json(&t.extends);
    let sql = "UPDATE Tag SET title = ?2, field_ids = ?3, extends = ?4, updated_at = ?5, version = version + 1 \
               WHERE id = ?1";
    let params: Vec<&dyn ToSql> = vec![
        &t.id,
        &t.title,
        &field_ids_json,
        &extends_json,
        &t.updated_at,
    ];
    exec.execute(sql, &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn tag_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&id, &now];
    exec.execute(
        "UPDATE Tag SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_tag_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "t1".to_string());
        m.insert("title".to_string(), "Project".to_string());
        m.insert("field_ids".to_string(), "[\"f1\",\"f2\"]".to_string());
        m.insert("extends".to_string(), "[\"t0\"]".to_string());
        m.insert("created_at".to_string(), "1".to_string());
        m.insert("updated_at".to_string(), "2".to_string());
        m.insert("version".to_string(), "3".to_string());
        m.insert("deleted_at".to_string(), "".to_string());
        let t = row_to_tag_js(&m);
        assert_eq!(t.id, "t1");
        assert_eq!(t.title, "Project");
        assert_eq!(t.field_ids, vec!["f1".to_string(), "f2".to_string()]);
        assert_eq!(t.extends, vec!["t0".to_string()]);
        assert_eq!(t.version, 3);
        assert_eq!(t.deleted_at, None);
    }

    #[test]
    fn row_to_tag_js_defaults() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "t2".to_string());
        let t = row_to_tag_js(&m);
        // 缺省：field_ids / extends 为空数组（而非 None），符合 D6 设计
        assert_eq!(t.field_ids, Vec::<String>::new());
        assert_eq!(t.extends, Vec::<String>::new());
        assert_eq!(t.version, 0);
        assert_eq!(t.deleted_at, None);
    }
}
