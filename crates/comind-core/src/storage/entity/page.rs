use crate::types::Page;
#[cfg(any(target_arch = "wasm32", test))]
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// Page 的规范列顺序与列名 —— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能（Q4b）。
///
/// 注意：列序必须与 `row_to_page_native` 的位置索引、以及 INSERT/UPDATE 的参数顺序一一对应。
pub const PAGE_COLS: &[&str] = &[
    "id", "block_id", "title", "type", "icon", "cover", "aliases", "file_path",
    "children_count", "word_count", "deleted", "created_at", "updated_at", "version", "deleted_at",
];

pub fn page_select_cols() -> String {
    PAGE_COLS.join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_insert_sql() -> String {
    let cols = page_select_cols();
    let placeholders = vec!["?"; PAGE_COLS.len()].join(", ");
    format!("INSERT INTO Page ({}) VALUES ({})", cols, placeholders)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_update_sql() -> String {
    "UPDATE Page SET block_id = ?2, title = ?3, type = ?4, icon = ?5, cover = ?6, aliases = ?7, file_path = ?8, children_count = ?9, word_count = ?10, deleted = ?11, updated_at = ?12, version = version + 1 WHERE id = ?1".to_string()
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_page_native(row: &rusqlite::Row) -> Result<Page, rusqlite::Error> {
    Ok(Page {
        id: row.get(0)?,
        block_id: row.get(1)?,
        title: row.get(2)?,
        r#type: row.get(3)?,
        icon: row.get(4)?,
        cover: row.get(5)?,
        aliases: row.get(6)?,
        file_path: row.get(7)?,
        children_count: row.get(8)?,
        word_count: row.get(9)?,
        deleted: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        version: row.get(13)?,
        deleted_at: row.get(14)?,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `PAGE_COLS`。
/// 保留原 sqljs 的语义：空串 → None（block_id/icon/cover/file_path），数值缺省 0，deleted 缺省 0。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_page_js(row: &HashMap<String, String>) -> Page {
    Page {
        id: row.get("id").cloned().unwrap_or_default(),
        block_id: {
            let p = row.get("block_id").cloned().unwrap_or_default();
            if p.is_empty() { None } else { Some(p) }
        },
        title: row.get("title").cloned().unwrap_or_default(),
        r#type: row.get("type").cloned().unwrap_or_else(|| "normal".to_string()),
        icon: {
            let p = row.get("icon").cloned().unwrap_or_default();
            if p.is_empty() { None } else { Some(p) }
        },
        cover: {
            let p = row.get("cover").cloned().unwrap_or_default();
            if p.is_empty() { None } else { Some(p) }
        },
        aliases: row.get("aliases").cloned().unwrap_or_else(|| "[]".to_string()),
        file_path: {
            let p = row.get("file_path").cloned().unwrap_or_default();
            if p.is_empty() { None } else { Some(p) }
        },
        children_count: row.get("children_count").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        word_count: row.get("word_count").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        deleted: row.get("deleted").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        version: row.get("version").map(|s| s.parse::<i64>().unwrap_or(0)).unwrap_or(0),
        deleted_at: row.get("deleted_at").map(|s| s.parse::<i64>().ok()).unwrap_or(None),
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
pub fn page_params(p: &Page) -> Vec<&dyn ToSql> {
    vec![
        &p.id, &p.block_id, &p.title, &p.r#type, &p.icon, &p.cover, &p.aliases, &p.file_path,
        &p.children_count, &p.word_count, &p.deleted, &p.created_at, &p.updated_at, &p.version, &p.deleted_at,
    ]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_update_params(p: &Page) -> Vec<&dyn ToSql> {
    vec![
        &p.id, &p.block_id, &p.title, &p.r#type, &p.icon, &p.cover, &p.aliases, &p.file_path,
        &p.children_count, &p.word_count, &p.deleted, &p.updated_at,
    ]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<Page, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Page WHERE id = ?1 AND deleted = 0 AND deleted_at IS NULL",
        page_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_page_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Page not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_get_by_title_including_deleted<E: Executor>(exec: &E, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM Page WHERE title = ?1", page_select_cols());
    let params: Vec<&dyn ToSql> = vec![&title];
    let rows = exec.query_map(&sql, &params, |row| row_to_page_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_get_by_title<E: Executor>(exec: &E, title: &str) -> Result<Option<Page>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Page WHERE title = ?1 AND deleted = 0 AND deleted_at IS NULL",
        page_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&title];
    let rows = exec.query_map(&sql, &params, |row| row_to_page_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_get_all<E: Executor>(exec: &E) -> Result<Vec<Page>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Page WHERE deleted = 0 AND deleted_at IS NULL ORDER BY updated_at DESC",
        page_select_cols()
    );
    let params: &[&dyn ToSql] = &[];
    exec.query_map(&sql, params, |row| row_to_page_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_get_trash<E: Executor>(exec: &E) -> Result<Vec<Page>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Page WHERE deleted = 1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
        page_select_cols()
    );
    let params: &[&dyn ToSql] = &[];
    exec.query_map(&sql, params, |row| row_to_page_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_get_by_ids<E: Executor>(exec: &E, ids: &[String]) -> Result<Vec<Page>, Box<dyn Error>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = (1..=ids.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "SELECT {} FROM Page WHERE id IN ({}) AND deleted = 0 AND deleted_at IS NULL",
        page_select_cols(),
        placeholders.join(", ")
    );
    let params: Vec<&dyn ToSql> = ids.iter().map(|id| id as &dyn ToSql).collect();
    exec.query_map(&sql, &params, |row| row_to_page_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_get_ideas_by_month<E: Executor>(exec: &E, year: i32, month: u32) -> Result<Vec<Page>, Box<dyn Error>> {
    let start = format!("{}-{:02}-01", year, month);
    let end = if month == 12 {
        format!("{}-01-01", year + 1)
    } else {
        format!("{}-{:02}-01", year, month + 1)
    };
    let sql = format!(
        "SELECT {} FROM Page WHERE type IN ('ideas', 'journal') AND deleted = 0 AND deleted_at IS NULL AND title >= ?1 AND title < ?2 ORDER BY title DESC",
        page_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&start, &end];
    exec.query_map(&sql, &params, |row| row_to_page_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_get_ideas_months<E: Executor>(exec: &E) -> Result<Vec<String>, Box<dyn Error>> {
    let sql = "SELECT DISTINCT substr(title, 1, 7) AS month FROM Page WHERE type IN ('ideas', 'journal') AND deleted = 0 AND deleted_at IS NULL ORDER BY month DESC";
    let params: &[&dyn ToSql] = &[];
    exec.query_map(&sql, params, |row| row.get::<_, String>(0)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_create<E: Executor>(exec: &E, page: &Page) -> Result<Page, Box<dyn Error>> {
    let params = page_params(page);
    exec.execute(&page_insert_sql(), &params)?;
    Ok(page.clone())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_update<E: Executor>(exec: &E, page: &Page) -> Result<Page, Box<dyn Error>> {
    let params = page_update_params(page);
    exec.execute(&page_update_sql(), &params)?;
    Ok(page.clone())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn page_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&id, &now];
    exec.execute(
        "UPDATE Page SET deleted = 1, deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_page_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "p1".to_string());
        m.insert("block_id".to_string(), "".to_string());
        m.insert("title".to_string(), "Hello".to_string());
        m.insert("type".to_string(), "normal".to_string());
        m.insert("icon".to_string(), "".to_string());
        m.insert("cover".to_string(), "".to_string());
        m.insert("aliases".to_string(), "[]".to_string());
        m.insert("file_path".to_string(), "".to_string());
        m.insert("children_count".to_string(), "2".to_string());
        m.insert("word_count".to_string(), "100".to_string());
        m.insert("deleted".to_string(), "0".to_string());
        m.insert("version".to_string(), "1".to_string());
        m.insert("deleted_at".to_string(), "".to_string());
        m.insert("created_at".to_string(), "1".to_string());
        m.insert("updated_at".to_string(), "2".to_string());
        let p = row_to_page_js(&m);
        assert_eq!(p.id, "p1");
        assert_eq!(p.block_id, None);
        assert_eq!(p.title, "Hello");
        assert_eq!(p.icon, None);
        assert_eq!(p.children_count, 2);
        assert_eq!(p.word_count, 100);
        assert_eq!(p.deleted, 0);
        assert_eq!(p.version, 1);
        assert_eq!(p.deleted_at, None);
        assert_eq!(p.created_at, 1);
        assert_eq!(p.updated_at, 2);
    }

    #[test]
    fn row_to_page_js_block_id_some() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "p2".to_string());
        m.insert("block_id".to_string(), "bX".to_string());
        m.insert("deleted_at".to_string(), "123".to_string());
        let p = row_to_page_js(&m);
        assert_eq!(p.block_id, Some("bX".to_string()));
        // 缺省列依旧给出合理默认值
        assert_eq!(p.r#type, "normal");
        assert_eq!(p.aliases, "[]");
        assert_eq!(p.deleted, 0);
        assert_eq!(p.deleted_at, Some(123));
    }
}
