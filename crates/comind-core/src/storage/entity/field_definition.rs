use crate::types::FieldDefinition;
#[cfg(any(target_arch = "wasm32", test))]
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// FieldDefinition 的规范列顺序与列名 —— 唯一来源（ADR-0049 D3 / D6 / D9）。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取。
///
/// - `closed_values`：选项型字段候选值，落库为 JSON TEXT；NULL = 非选项型（D9）。
/// - `is_system`：布尔，落库为 0/1 整型（SQLite 无原生布尔）。
pub const FIELD_DEFINITION_COLS: &[&str] = &[
    "id", "key", "title", "type", "closed_values", "is_system",
    "created_at", "updated_at", "version", "deleted_at",
];

pub fn field_definition_select_cols() -> String {
    FIELD_DEFINITION_COLS.join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_definition_insert_sql() -> String {
    let cols = field_definition_select_cols();
    let placeholders = vec!["?"; FIELD_DEFINITION_COLS.len()].join(", ");
    format!("INSERT INTO FieldDefinition ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_field_definition_native(row: &rusqlite::Row) -> Result<FieldDefinition, rusqlite::Error> {
    Ok(FieldDefinition {
        id: row.get(0)?,
        key: row.get(1)?,
        title: row.get(2)?,
        r#type: row.get(3)?,
        closed_values: row.get::<_, Option<String>>(4)?
            .and_then(|s| serde_json::from_str(&s).ok()),
        is_system: row.get::<_, i64>(5)? != 0,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        version: row.get(8)?,
        deleted_at: row.get(9)?,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `FIELD_DEFINITION_COLS`。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_field_definition_js(row: &HashMap<String, String>) -> FieldDefinition {
    FieldDefinition {
        id: row.get("id").cloned().unwrap_or_default(),
        key: row.get("key").cloned().unwrap_or_default(),
        title: row.get("title").cloned().unwrap_or_default(),
        r#type: row.get("type").cloned().unwrap_or_default(),
        closed_values: row
            .get("closed_values")
            .and_then(|s| {
                if s.is_empty() {
                    None
                } else {
                    serde_json::from_str(s).ok()
                }
            }),
        is_system: row
            .get("is_system")
            .cloned()
            .unwrap_or_else(|| "0".to_string())
            .parse::<i64>()
            .unwrap_or(0)
            != 0,
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

/// JSON 序列化辅助：closed_values → Option<String>（NULL 表示非选项型）。
#[cfg(not(target_arch = "wasm32"))]
fn closed_values_to_sql(v: &Option<Vec<String>>) -> Option<String> {
    v.as_ref().map(|vals| serde_json::to_string(vals).unwrap_or_else(|_| "[]".to_string()))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_definition_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<FieldDefinition, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM FieldDefinition WHERE id = ?1 AND deleted_at IS NULL",
        field_definition_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_field_definition_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "FieldDefinition not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_definition_get_by_key<E: Executor>(
    exec: &E,
    key: &str,
) -> Result<Option<FieldDefinition>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM FieldDefinition WHERE key = ?1 AND deleted_at IS NULL",
        field_definition_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&key];
    let rows = exec.query_map(&sql, &params, |row| row_to_field_definition_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_definition_get_all<E: Executor>(exec: &E) -> Result<Vec<FieldDefinition>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM FieldDefinition WHERE deleted_at IS NULL ORDER BY created_at",
        field_definition_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![];
    exec.query_map(&sql, &params, |row| row_to_field_definition_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_definition_create<E: Executor>(exec: &E, fd: &FieldDefinition) -> Result<(), Box<dyn Error>> {
    let closed_values_json = closed_values_to_sql(&fd.closed_values);
    let is_system_i64 = if fd.is_system { 1i64 } else { 0i64 };
    let params: Vec<&dyn ToSql> = vec![
        &fd.id,
        &fd.key,
        &fd.title,
        &fd.r#type,
        &closed_values_json,
        &is_system_i64,
        &fd.created_at,
        &fd.updated_at,
        &fd.version,
        &fd.deleted_at,
    ];
    exec.execute(&field_definition_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_definition_update<E: Executor>(exec: &E, fd: &FieldDefinition) -> Result<(), Box<dyn Error>> {
    let closed_values_json = closed_values_to_sql(&fd.closed_values);
    let is_system_i64 = if fd.is_system { 1i64 } else { 0i64 };
    let sql = "UPDATE FieldDefinition SET key = ?2, title = ?3, type = ?4, closed_values = ?5, is_system = ?6, updated_at = ?7, version = version + 1 \
               WHERE id = ?1";
    let params: Vec<&dyn ToSql> = vec![
        &fd.id,
        &fd.key,
        &fd.title,
        &fd.r#type,
        &closed_values_json,
        &is_system_i64,
        &fd.updated_at,
    ];
    exec.execute(sql, &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn field_definition_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&id, &now];
    exec.execute(
        "UPDATE FieldDefinition SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
        &params,
    )?;
    Ok(())
}

/// 显式删除戳版本（级联软删用）：与 `field_value_soft_delete_by_field_definition`
/// 共享同一个 `now`，使整批可逆（D9 + undo 裁定）。
#[cfg(not(target_arch = "wasm32"))]
pub fn field_definition_soft_delete_at<E: Executor>(
    exec: &E,
    id: &str,
    now: i64,
) -> Result<(), Box<dyn Error>> {
    let params: Vec<&dyn ToSql> = vec![&id, &now];
    exec.execute(
        "UPDATE FieldDefinition SET deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
        &params,
    )?;
    Ok(())
}

/// 含软删行读取（undo 用）：常规 `get_by_id` 过滤 `deleted_at IS NULL`，
/// 撤销时必须先读到已删行的删除戳才能精确复活关联的 FieldValue。
#[cfg(not(target_arch = "wasm32"))]
pub fn field_definition_get_by_id_including_deleted<E: Executor>(
    exec: &E,
    id: &str,
) -> Result<FieldDefinition, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM FieldDefinition WHERE id = ?1",
        field_definition_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_field_definition_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "FieldDefinition not found")) as Box<dyn Error>
    })
}

/// 复活软删的定义本身（清 deleted_at）；关联值的复活另由
/// `field_value_restore_by_field_definition` 按同一删除戳处理。
#[cfg(not(target_arch = "wasm32"))]
pub fn field_definition_undelete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&id, &now];
    exec.execute(
        "UPDATE FieldDefinition SET deleted_at = NULL, version = version + 1, updated_at = ?2 WHERE id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_field_definition_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "f1".to_string());
        m.insert("key".to_string(), "status".to_string());
        m.insert("title".to_string(), "Status".to_string());
        m.insert("type".to_string(), "select".to_string());
        m.insert("closed_values".to_string(), "[\"todo\",\"done\"]".to_string());
        m.insert("is_system".to_string(), "1".to_string());
        m.insert("created_at".to_string(), "1".to_string());
        m.insert("updated_at".to_string(), "2".to_string());
        m.insert("version".to_string(), "5".to_string());
        m.insert("deleted_at".to_string(), "".to_string());
        let fd = row_to_field_definition_js(&m);
        assert_eq!(fd.id, "f1");
        assert_eq!(fd.key, "status");
        assert_eq!(fd.r#type, "select");
        assert_eq!(fd.closed_values, Some(vec!["todo".to_string(), "done".to_string()]));
        assert!(fd.is_system);
        assert_eq!(fd.version, 5);
        assert_eq!(fd.deleted_at, None);
    }

    #[test]
    fn row_to_field_definition_js_defaults() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "f2".to_string());
        let fd = row_to_field_definition_js(&m);
        // 缺省：非选项型（closed_values = None）、非系统字段、数值缺省 0
        assert_eq!(fd.closed_values, None);
        assert!(!fd.is_system);
        assert_eq!(fd.version, 0);
        assert_eq!(fd.deleted_at, None);
    }
}
