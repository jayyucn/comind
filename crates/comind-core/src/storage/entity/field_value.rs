use crate::types::FieldValue;
#[cfg(any(target_arch = "wasm32", test))]
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// FieldValue 的规范列顺序与列名 —— 唯一来源（ADR-0049 D6 / D9）。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能。
///
/// 注意：列序与 `row_to_field_value_native` 的位置索引必须一一对应，
/// 也与 `types/field_value.rs` 中 `FieldValue` 的结构体字段顺序一致。
pub const FIELD_VALUE_COLS: &[&str] = &[
    "id", "block_id", "field_definition_id", "value_json", "value_type", "seq",
    "created_at", "updated_at", "version", "deleted_at",
];

pub fn field_value_select_cols() -> String {
    FIELD_VALUE_COLS.join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_insert_sql() -> String {
    let cols = field_value_select_cols();
    let placeholders = vec!["?"; FIELD_VALUE_COLS.len()].join(", ");
    format!("INSERT INTO FieldValue ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_field_value_native(row: &rusqlite::Row) -> Result<FieldValue, rusqlite::Error> {
    Ok(FieldValue {
        id: row.get(0)?,
        block_id: row.get(1)?,
        field_definition_id: row.get(2)?,
        value_json: row.get(3)?,
        value_type: row.get(4)?,
        seq: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        version: row.get(8)?,
        deleted_at: row.get(9)?,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `FIELD_VALUE_COLS`。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_field_value_js(row: &HashMap<String, String>) -> FieldValue {
    FieldValue {
        id: row.get("id").cloned().unwrap_or_default(),
        block_id: row.get("block_id").cloned().unwrap_or_default(),
        field_definition_id: row.get("field_definition_id").cloned().unwrap_or_default(),
        value_json: row.get("value_json").cloned().unwrap_or_default(),
        value_type: row.get("value_type").cloned().unwrap_or_default(),
        seq: row.get("seq").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
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
pub fn field_value_params(fv: &FieldValue) -> Vec<&dyn ToSql> {
    vec![
        &fv.id,
        &fv.block_id,
        &fv.field_definition_id,
        &fv.value_json,
        &fv.value_type,
        &fv.seq,
        &fv.created_at,
        &fv.updated_at,
        &fv.version,
        &fv.deleted_at,
    ]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<FieldValue, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM FieldValue WHERE id = ?1 AND deleted_at IS NULL",
        field_value_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_field_value_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "FieldValue not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_get_by_block_id<E: Executor>(
    exec: &E,
    block_id: &str,
) -> Result<Vec<FieldValue>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM FieldValue WHERE block_id = ?1 AND deleted_at IS NULL ORDER BY seq",
        field_value_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&block_id];
    exec.query_map(&sql, &params, |row| row_to_field_value_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_get_by_block_ids<E: Executor>(
    exec: &E,
    block_ids: &[String],
) -> Result<Vec<FieldValue>, Box<dyn Error>> {
    if block_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = (1..=block_ids.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "SELECT {} FROM FieldValue WHERE block_id IN ({}) AND deleted_at IS NULL ORDER BY seq",
        field_value_select_cols(),
        placeholders.join(", ")
    );
    let params: Vec<&dyn ToSql> = block_ids.iter().map(|id| id as &dyn ToSql).collect();
    exec.query_map(&sql, &params, |row| row_to_field_value_native(row)).map_err(bx)
}

/// 全部存活值（projection / 快照用）。
#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_get_all<E: Executor>(exec: &E) -> Result<Vec<FieldValue>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM FieldValue WHERE deleted_at IS NULL ORDER BY seq",
        field_value_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![];
    exec.query_map(&sql, &params, |row| row_to_field_value_native(row)).map_err(bx)
}

/// 按字段定义反查全部存活值（query_block_ids_by_key_value 的数据源）。
#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_get_by_field_definition_id<E: Executor>(
    exec: &E,
    field_definition_id: &str,
) -> Result<Vec<FieldValue>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM FieldValue WHERE field_definition_id = ?1 AND deleted_at IS NULL ORDER BY seq",
        field_value_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&field_definition_id];
    exec.query_map(&sql, &params, |row| row_to_field_value_native(row)).map_err(bx)
}

/// 含软删行（撤销恢复按 id 复活用）。
#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_get_by_id_including_deleted<E: Executor>(
    exec: &E,
    id: &str,
) -> Result<Option<FieldValue>, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM FieldValue WHERE id = ?1", field_value_select_cols());
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_field_value_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

/// 撤销软删（与 delete 的盖戳方式对称，只清 deleted_at）。
#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_undelete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&id, &now];
    exec.execute(
        "UPDATE FieldValue SET deleted_at = NULL, version = version + 1, updated_at = ?2 WHERE id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_create<E: Executor>(exec: &E, fv: &FieldValue) -> Result<(), Box<dyn Error>> {
    let params = field_value_params(fv);
    exec.execute(&field_value_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_update<E: Executor>(exec: &E, fv: &FieldValue) -> Result<(), Box<dyn Error>> {
    let sql = "UPDATE FieldValue SET value_json = ?2, value_type = ?3, seq = ?4, updated_at = ?5, version = version + 1 \
               WHERE id = ?1";
    let params: Vec<&dyn ToSql> = vec![
        &fv.id,
        &fv.value_json,
        &fv.value_type,
        &fv.seq,
        &fv.updated_at,
    ];
    exec.execute(sql, &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&id, &now];
    exec.execute(
        "UPDATE FieldValue SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_delete_by_block_id<E: Executor>(
    exec: &E,
    block_id: &str,
) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&block_id, &now];
    exec.execute(
        "UPDATE FieldValue SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE block_id = ?1",
        &params,
    )?;
    Ok(())
}

/// ADR-0049 D9 级联软删：删 FieldDefinition 时同批软删引用它的所有 FieldValue。
/// `now` 由调用方显式传入 —— 让「定义 + 它的一批值」共享同一删除戳，
/// undo 时才能按该戳精确复活（见 `field_value_restore_by_field_definition`）。
#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_soft_delete_by_field_definition<E: Executor>(
    exec: &E,
    field_definition_id: &str,
    now: i64,
) -> Result<usize, Box<dyn Error>> {
    let params: Vec<&dyn ToSql> = vec![&field_definition_id, &now];
    let affected = exec.execute(
        "UPDATE FieldValue SET deleted_at = ?2, version = version + 1, updated_at = ?2 \
         WHERE field_definition_id = ?1 AND deleted_at IS NULL",
        &params,
    )?;
    Ok(affected)
}

/// 复活级联软删的一批值：只恢复删除戳 == `deleted_at` 的行，
/// 避免把更早 mismatch 的软删值一并复活（undo 必须精确到「那一次操作」）。
#[cfg(not(target_arch = "wasm32"))]
pub fn field_value_restore_by_field_definition<E: Executor>(
    exec: &E,
    field_definition_id: &str,
    deleted_at: i64,
) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&field_definition_id, &deleted_at, &now];
    exec.execute(
        "UPDATE FieldValue SET deleted_at = NULL, version = version + 1, updated_at = ?3 \
         WHERE field_definition_id = ?1 AND deleted_at = ?2",
        &params,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_field_value_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "v1".to_string());
        m.insert("block_id".to_string(), "b1".to_string());
        m.insert("field_definition_id".to_string(), "f1".to_string());
        m.insert("value_json".to_string(), "\"hello\"".to_string());
        m.insert("value_type".to_string(), "text".to_string());
        m.insert("seq".to_string(), "2".to_string());
        m.insert("created_at".to_string(), "1".to_string());
        m.insert("updated_at".to_string(), "2".to_string());
        m.insert("version".to_string(), "5".to_string());
        m.insert("deleted_at".to_string(), "100".to_string());
        let fv = row_to_field_value_js(&m);
        assert_eq!(fv.id, "v1");
        assert_eq!(fv.block_id, "b1");
        assert_eq!(fv.field_definition_id, "f1");
        assert_eq!(fv.value_json, "\"hello\"");
        assert_eq!(fv.value_type, "text");
        assert_eq!(fv.seq, 2);
        assert_eq!(fv.version, 5);
        assert_eq!(fv.deleted_at, Some(100));
    }

    #[test]
    fn row_to_field_value_js_defaults() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "v2".to_string());
        m.insert("deleted_at".to_string(), "".to_string());
        let fv = row_to_field_value_js(&m);
        assert_eq!(fv.seq, 0);
        assert_eq!(fv.version, 0);
        assert_eq!(fv.deleted_at, None);
    }
}
