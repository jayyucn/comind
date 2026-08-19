#[cfg(not(target_arch = "wasm32"))]
use crate::types::SearchResult;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// SearchIndex 的规范列（FTS5 虚表）—— 原生与事务路径共用的唯一来源。
/// `search` 不产生简单行实体（score 由 bm25 计算），故此处只收敛 SearchIndex 的
/// 写入/删除/查询三操作，wasm 路径为 no-op 桩（无 FTS），列序 drift 不适用（Q4b）。
pub const SEARCH_INDEX_COLS: &[&str] = &["block_id", "content", "title"];

#[cfg(not(target_arch = "wasm32"))]
pub fn search_index_insert_sql() -> String {
    let cols = SEARCH_INDEX_COLS.join(", ");
    let placeholders = vec!["?"; SEARCH_INDEX_COLS.len()].join(", ");
    format!("INSERT INTO SearchIndex ({}) VALUES ({})", cols, placeholders)
}

// ── 原生 / 事务共享：自由函数（收 &E where E: Executor） ────────────────

#[cfg(not(target_arch = "wasm32"))]
fn bx(e: rusqlite::Error) -> Box<dyn Error> {
    Box::new(e)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn search_index_search<E: Executor>(
    exec: &E,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>, Box<dyn Error>> {
    let sql = "SELECT block_id, content, title, bm25(SearchIndex) as score
             FROM SearchIndex
             WHERE SearchIndex MATCH ?1
             ORDER BY bm25(SearchIndex)
             LIMIT ?2";
    let fts_query = query.replace(" ", "* ");
    let fts_query = format!("{}*", fts_query);
    let limit_i64: i64 = limit as i64;
    let params: Vec<&dyn ToSql> = vec![&fts_query, &limit_i64];
    exec.query_map(&sql, &params, |row| {
        let block_id: String = row.get(0)?;
        let content: String = row.get(1)?;
        let title: String = row.get(2)?;
        let score: f64 = row.get(3)?;
        Ok(SearchResult::new(&block_id, "", &title, &content, score))
    })
    .map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn search_index_upsert<E: Executor>(
    exec: &E,
    block_id: &str,
    content: &str,
    title: &str,
) -> Result<(), Box<dyn Error>> {
    exec.execute(
        "DELETE FROM SearchIndex WHERE block_id = ?1",
        &[&block_id as &dyn ToSql],
    )?;
    let params: Vec<&dyn ToSql> = vec![&block_id, &content, &title];
    exec.execute(&search_index_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn search_index_delete<E: Executor>(exec: &E, block_id: &str) -> Result<(), Box<dyn Error>> {
    exec.execute(
        "DELETE FROM SearchIndex WHERE block_id = ?1",
        &[&block_id as &dyn ToSql],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn search_index_roundtrip() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE VIRTUAL TABLE SearchIndex USING fts5(block_id UNINDEXED, content, title);",
        )
        .unwrap();

        search_index_upsert(&conn, "b1", "buy milk tomorrow", "Groceries").unwrap();
        search_index_upsert(&conn, "b2", "meeting at noon", "Work").unwrap();

        let mut results = search_index_search(&conn, "milk", 10).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].block_id, "b1");
        assert_eq!(results[0].page_title, "Groceries");

        search_index_delete(&conn, "b1").unwrap();
        results = search_index_search(&conn, "milk", 10).unwrap();
        assert_eq!(results.len(), 0);

        // upsert overwrites prior content (DELETE + INSERT)
        search_index_upsert(&conn, "b2", "meeting rescheduled", "Work").unwrap();
        let r = search_index_search(&conn, "rescheduled", 10).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].block_id, "b2");
    }
}
