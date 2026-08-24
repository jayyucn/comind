use crate::types::Property;
#[cfg(any(target_arch = "wasm32", test))]
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// Property 的规范列顺序与列名 —— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能（Q4b）。
///
/// 注意：列序与 `row_to_property_native` 的位置索引必须一一对应，
/// 也与 `types/property.rs` 中 `Property` 的结构体字段顺序一致。
pub const PROPERTY_COLS: &[&str] = &[
    "id", "block_id", "key", "value", "type", "sort_order", "is_hidden",
    "is_deleted", "schema_version", "created_at", "updated_at", "version", "deleted_at",
];

pub fn property_select_cols() -> String {
    PROPERTY_COLS.join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn property_insert_sql() -> String {
    let cols = property_select_cols();
    let placeholders = vec!["?"; PROPERTY_COLS.len()].join(", ");
    format!("INSERT INTO Property ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_property_native(row: &rusqlite::Row) -> Result<Property, rusqlite::Error> {
    Ok(Property {
        id: row.get(0)?,
        block_id: row.get(1)?,
        key: row.get(2)?,
        value: row.get(3)?,
        r#type: row.get(4)?,
        sort_order: row.get(5)?,
        is_hidden: row.get(6)?,
        is_deleted: row.get(7)?,
        schema_version: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        version: row.get(11)?,
        deleted_at: row.get(12)?,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `PROPERTY_COLS`。
/// 保留原 sqljs 的语义：schema_version 缺省 1，其余数值缺省 0，deleted_at 解析失败→None。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_property_js(row: &HashMap<String, String>) -> Property {
    Property {
        id: row.get("id").cloned().unwrap_or_default(),
        block_id: row.get("block_id").cloned().unwrap_or_default(),
        key: row.get("key").cloned().unwrap_or_default(),
        value: row.get("value").cloned().unwrap_or_default(),
        r#type: row.get("type").cloned().unwrap_or_default(),
        sort_order: row.get("sort_order").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        is_hidden: row.get("is_hidden").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        is_deleted: row.get("is_deleted").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        schema_version: row.get("schema_version").cloned().unwrap_or_else(|| "1".to_string()).parse::<i64>().unwrap_or(1),
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
pub fn property_params(p: &Property) -> Vec<&dyn ToSql> {
    vec![
        &p.id,
        &p.block_id,
        &p.key,
        &p.value,
        &p.r#type,
        &p.sort_order,
        &p.is_hidden,
        &p.is_deleted,
        &p.schema_version,
        &p.created_at,
        &p.updated_at,
        &p.version,
        &p.deleted_at,
    ]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn property_get_all<E: Executor>(exec: &E) -> Result<Vec<Property>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Property WHERE is_deleted = 0 AND deleted_at IS NULL",
        property_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![];
    exec.query_map(&sql, &params, |row| row_to_property_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn property_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<Property, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Property WHERE id = ?1 AND deleted_at IS NULL",
        property_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_property_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Property not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn property_get_by_block_id<E: Executor>(
    exec: &E,
    block_id: &str,
) -> Result<Vec<Property>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Property WHERE block_id = ?1 AND is_deleted = 0 AND deleted_at IS NULL ORDER BY sort_order",
        property_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&block_id];
    exec.query_map(&sql, &params, |row| row_to_property_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn property_get_by_block_ids<E: Executor>(
    exec: &E,
    block_ids: &[String],
) -> Result<Vec<Property>, Box<dyn Error>> {
    if block_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<String> = (1..=block_ids.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "SELECT {} FROM Property WHERE block_id IN ({}) AND is_deleted = 0 AND deleted_at IS NULL ORDER BY sort_order",
        property_select_cols(),
        placeholders.join(", ")
    );
    let params: Vec<&dyn ToSql> = block_ids.iter().map(|id| id as &dyn ToSql).collect();
    exec.query_map(&sql, &params, |row| row_to_property_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn property_get_by_block_id_and_key<E: Executor>(
    exec: &E,
    block_id: &str,
    key: &str,
) -> Result<Option<Property>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM Property WHERE block_id = ?1 AND key = ?2 AND is_deleted = 0 AND deleted_at IS NULL",
        property_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&block_id, &key];
    let rows = exec.query_map(&sql, &params, |row| row_to_property_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn property_query_block_ids_by_key_value<E: Executor>(
    exec: &E,
    key: &str,
    values: &[String],
) -> Result<Vec<String>, Box<dyn Error>> {
    if values.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = values.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT DISTINCT block_id FROM Property WHERE key = ? AND value IN ({}) AND is_deleted = 0 AND deleted_at IS NULL",
        placeholders
    );
    let mut params_vec: Vec<Box<dyn ToSql>> = Vec::new();
    params_vec.push(Box::new(key.to_string()));
    for v in values {
        params_vec.push(Box::new(v.clone()));
    }
    let param_refs: Vec<&dyn ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
    let rows = exec.query_map(&sql, &param_refs, |row| row.get::<_, String>(0)).map_err(bx)?;
    Ok(rows)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn property_create<E: Executor>(exec: &E, p: &Property) -> Result<(), Box<dyn Error>> {
    let params = property_params(p);
    exec.execute(&property_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn property_upsert<E: Executor>(exec: &E, p: &Property) -> Result<(), Box<dyn Error>> {
    let sql = "INSERT INTO Property (id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at, version, deleted_at) \
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) \
               ON CONFLICT(block_id, key) DO UPDATE SET \
                  value = excluded.value, \
                  type = excluded.type, \
                  updated_at = excluded.updated_at, \
                  sort_order = excluded.sort_order, \
                  is_hidden = excluded.is_hidden, \
                  schema_version = excluded.schema_version, \
                  is_deleted = 0, \
                  deleted_at = NULL";
    let params = property_params(p);
    exec.execute(sql, &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn property_update<E: Executor>(exec: &E, p: &Property) -> Result<(), Box<dyn Error>> {
    let sql = "UPDATE Property SET value = ?2, type = ?3, sort_order = ?4, is_hidden = ?5, is_deleted = ?6, updated_at = ?7, version = version + 1 \
               WHERE id = ?1";
    let params: Vec<&dyn ToSql> = vec![
        &p.id,
        &p.value,
        &p.r#type,
        &p.sort_order,
        &p.is_hidden,
        &p.is_deleted,
        &p.updated_at,
    ];
    exec.execute(sql, &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn property_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&id, &now];
    exec.execute(
        "UPDATE Property SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn property_delete_by_block_id<E: Executor>(
    exec: &E,
    block_id: &str,
) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&block_id, &now];
    exec.execute(
        "UPDATE Property SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE block_id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_property_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "p1".to_string());
        m.insert("block_id".to_string(), "b1".to_string());
        m.insert("key".to_string(), "done".to_string());
        m.insert("value".to_string(), "true".to_string());
        m.insert("type".to_string(), "checkbox".to_string());
        m.insert("sort_order".to_string(), "3".to_string());
        m.insert("is_hidden".to_string(), "0".to_string());
        m.insert("is_deleted".to_string(), "0".to_string());
        m.insert("schema_version".to_string(), "1".to_string());
        m.insert("created_at".to_string(), "1".to_string());
        m.insert("updated_at".to_string(), "2".to_string());
        m.insert("version".to_string(), "5".to_string());
        m.insert("deleted_at".to_string(), "100".to_string());
        let p = row_to_property_js(&m);
        assert_eq!(p.id, "p1");
        assert_eq!(p.block_id, "b1");
        assert_eq!(p.key, "done");
        assert_eq!(p.value, "true");
        assert_eq!(p.r#type, "checkbox");
        assert_eq!(p.sort_order, 3);
        assert_eq!(p.is_hidden, 0);
        assert_eq!(p.is_deleted, 0);
        assert_eq!(p.schema_version, 1);
        assert_eq!(p.version, 5);
        assert_eq!(p.deleted_at, Some(100));
    }

    #[test]
    fn row_to_property_js_defaults() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "p2".to_string());
        m.insert("deleted_at".to_string(), "".to_string());
        let p = row_to_property_js(&m);
        // 缺省列依旧给出合理默认值；schema_version 缺省 1，其余数值缺省 0
        assert_eq!(p.schema_version, 1);
        assert_eq!(p.sort_order, 0);
        assert_eq!(p.is_hidden, 0);
        assert_eq!(p.is_deleted, 0);
        assert_eq!(p.version, 0);
        assert_eq!(p.deleted_at, None);
    }
}
