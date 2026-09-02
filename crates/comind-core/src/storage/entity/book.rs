use crate::types::{BookHighlight, BookProgress};
#[cfg(any(target_arch = "wasm32", test))]
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// BookHighlight 的规范列顺序与列名 —— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能（Q4b）。
pub const BOOK_HIGHLIGHT_COLS: &[&str] = &[
    "id", "book_page_id", "cfi", "text", "chapter", "color", "block_id", "created_at", "updated_at",
];

pub fn book_highlight_select_cols() -> String {
    BOOK_HIGHLIGHT_COLS.join(", ")
}

/// BookProgress 的规范列（book_page_id 为主键，每书一行）。
pub const BOOK_PROGRESS_COLS: &[&str] = &["book_page_id", "cfi", "updated_at"];

pub fn book_progress_select_cols() -> String {
    BOOK_PROGRESS_COLS.join(", ")
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_book_highlight_native(row: &rusqlite::Row) -> Result<BookHighlight, rusqlite::Error> {
    Ok(BookHighlight {
        id: row.get(0)?,
        book_page_id: row.get(1)?,
        cfi: row.get(2)?,
        text: row.get(3)?,
        chapter: row.get(4)?,
        color: row.get(5)?,
        block_id: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

/// sql.js 路径：按列名查表（顺序无关，列名唯一权威），与原生同源于 `BOOK_HIGHLIGHT_COLS`。
/// block_id 空串/缺失 → None（NULL 经 sql.js query 归一为 ""）。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_book_highlight_js(row: &HashMap<String, String>) -> BookHighlight {
    BookHighlight {
        id: row.get("id").cloned().unwrap_or_default(),
        book_page_id: row.get("book_page_id").cloned().unwrap_or_default(),
        cfi: row.get("cfi").cloned().unwrap_or_default(),
        text: row.get("text").cloned().unwrap_or_default(),
        chapter: row.get("chapter").cloned().unwrap_or_default(),
        color: row.get("color").cloned().unwrap_or_default(),
        block_id: row.get("block_id").filter(|v| !v.is_empty()).cloned(),
        created_at: row.get("created_at").and_then(|v| v.parse().ok()).unwrap_or(0),
        updated_at: row.get("updated_at").and_then(|v| v.parse().ok()).unwrap_or(0),
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_book_progress_native(row: &rusqlite::Row) -> Result<BookProgress, rusqlite::Error> {
    Ok(BookProgress {
        book_page_id: row.get(0)?,
        cfi: row.get(1)?,
        updated_at: row.get(2)?,
    })
}

#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_book_progress_js(row: &HashMap<String, String>) -> BookProgress {
    BookProgress {
        book_page_id: row.get("book_page_id").cloned().unwrap_or_default(),
        cfi: row.get("cfi").cloned().unwrap_or_default(),
        updated_at: row.get("updated_at").and_then(|v| v.parse().ok()).unwrap_or(0),
    }
}

// ── 原生 / 事务共享：自由函数（收 &E where E: Executor） ────────────────

#[cfg(not(target_arch = "wasm32"))]
fn bx(e: rusqlite::Error) -> Box<dyn Error> {
    Box::new(e)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn book_highlight_params(h: &BookHighlight) -> Vec<&dyn ToSql> {
    vec![
        &h.id, &h.book_page_id, &h.cfi, &h.text, &h.chapter, &h.color, &h.block_id,
        &h.created_at, &h.updated_at,
    ]
}

/// 按 id upsert：冲突时更新阅读器态字段，created_at 未出现在 SET 中、保留首插值（D7）。
#[cfg(not(target_arch = "wasm32"))]
pub fn book_highlight_upsert<E: Executor>(exec: &E, h: &BookHighlight) -> Result<(), Box<dyn Error>> {
    let sql = format!(
        "INSERT INTO BookHighlight ({}) VALUES ({}) \
         ON CONFLICT(id) DO UPDATE SET \
            book_page_id = excluded.book_page_id, \
            cfi = excluded.cfi, \
            text = excluded.text, \
            chapter = excluded.chapter, \
            color = excluded.color, \
            block_id = excluded.block_id, \
            updated_at = excluded.updated_at",
        book_highlight_select_cols(),
        vec!["?"; BOOK_HIGHLIGHT_COLS.len()].join(", ")
    );
    let params = book_highlight_params(h);
    exec.execute(&sql, &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn book_highlight_get_by_book_page_id<E: Executor>(exec: &E, book_page_id: &str) -> Result<Vec<BookHighlight>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM BookHighlight WHERE book_page_id = ?1 ORDER BY created_at ASC",
        book_highlight_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&book_page_id];
    exec.query_map(&sql, &params, |row| row_to_book_highlight_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn book_highlight_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    exec.execute("DELETE FROM BookHighlight WHERE id = ?1", &[&id as &dyn ToSql])?;
    Ok(())
}

/// 进度 upsert：每书一行（book_page_id 主键），只挪 CFI 锚点与时间戳（D6）。
#[cfg(not(target_arch = "wasm32"))]
pub fn book_progress_upsert<E: Executor>(exec: &E, p: &BookProgress) -> Result<(), Box<dyn Error>> {
    let sql = format!(
        "INSERT INTO BookProgress ({}) VALUES ({}) \
         ON CONFLICT(book_page_id) DO UPDATE SET cfi = excluded.cfi, updated_at = excluded.updated_at",
        book_progress_select_cols(),
        vec!["?"; BOOK_PROGRESS_COLS.len()].join(", ")
    );
    let params: Vec<&dyn ToSql> = vec![&p.book_page_id, &p.cfi, &p.updated_at];
    exec.execute(&sql, &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn book_progress_get<E: Executor>(exec: &E, book_page_id: &str) -> Result<Option<BookProgress>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM BookProgress WHERE book_page_id = ?1",
        book_progress_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&book_page_id];
    let rows = exec.query_map(&sql, &params, |row| row_to_book_progress_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_book_highlight_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "h1".to_string());
        m.insert("book_page_id".to_string(), "p1".to_string());
        m.insert("cfi".to_string(), "epubcfi(/6/4!/4/10/2:0)".to_string());
        m.insert("text".to_string(), "划线文字".to_string());
        m.insert("chapter".to_string(), "第一章".to_string());
        m.insert("color".to_string(), "yellow".to_string());
        m.insert("block_id".to_string(), "blk-1".to_string());
        m.insert("created_at".to_string(), "10".to_string());
        m.insert("updated_at".to_string(), "20".to_string());
        let h = row_to_book_highlight_js(&m);
        assert_eq!(h.id, "h1");
        assert_eq!(h.book_page_id, "p1");
        assert_eq!(h.cfi, "epubcfi(/6/4!/4/10/2:0)");
        assert_eq!(h.text, "划线文字");
        assert_eq!(h.chapter, "第一章");
        assert_eq!(h.color, "yellow");
        assert_eq!(h.block_id.as_deref(), Some("blk-1"));
        assert_eq!(h.created_at, 10);
        assert_eq!(h.updated_at, 20);
    }

    #[test]
    fn row_to_book_highlight_js_block_id_none() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "h2".to_string());
        // block_id 空串（sql.js 把 NULL 归一为 ""）→ None；数值解析失败→0
        m.insert("block_id".to_string(), "".to_string());
        m.insert("created_at".to_string(), "bad".to_string());
        let h = row_to_book_highlight_js(&m);
        assert_eq!(h.block_id, None);
        assert_eq!(h.created_at, 0);
        assert_eq!(h.updated_at, 0);
        assert_eq!(h.color, "");
    }

    #[test]
    fn row_to_book_progress_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("book_page_id".to_string(), "p1".to_string());
        m.insert("cfi".to_string(), "epubcfi(/6/8!/4/2/1:10)".to_string());
        m.insert("updated_at".to_string(), "30".to_string());
        let p = row_to_book_progress_js(&m);
        assert_eq!(p.book_page_id, "p1");
        assert_eq!(p.cfi, "epubcfi(/6/8!/4/2/1:10)");
        assert_eq!(p.updated_at, 30);
    }
}
