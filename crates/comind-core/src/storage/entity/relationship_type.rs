use crate::types::RelationshipType;
use std::collections::HashMap;

#[cfg(not(target_arch = "wasm32"))]
use rusqlite::ToSql;
#[cfg(not(target_arch = "wasm32"))]
use std::error::Error;
#[cfg(not(target_arch = "wasm32"))]
use crate::storage::executor::Executor;

/// RelationshipType 的规范列顺序与列名 —— 唯一来源。
/// 原生 rusqlite 按位置（`row.get(i)`）读取、sql.js 按名（`row.get(COLS[i])`）读取，
/// 二者都源自此处，列序 drift 在结构上不可能（Q4b）。
///
/// 注意：列序与 `row_to_relationship_type_native` 的位置索引必须一一对应，
/// 也与 `types/relationship_type.rs` 中 `RelationshipType` 的结构体字段顺序一致。
/// `order` 是 SQL 保留字，SELECT/INSERT 列名需反引号包裹（见 `*_select_cols` / `*_insert_sql`）。
pub const RELATIONSHIP_TYPE_COLS: &[&str] = &[
    "id", "type", "inverse", "label", "inverse_label", "color", "order",
    "strength", "deleted", "builtin", "created_at", "updated_at",
];

/// `order` 是保留字，SELECT 列名需反引号。其余列名原样。
pub fn relationship_type_select_cols() -> String {
    RELATIONSHIP_TYPE_COLS
        .iter()
        .map(|c| if *c == "order" { "`order`".to_string() } else { (*c).to_string() })
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn relationship_type_insert_sql() -> String {
    let cols = relationship_type_select_cols();
    let placeholders = vec!["?"; RELATIONSHIP_TYPE_COLS.len()].join(", ");
    format!("INSERT INTO RelationshipType ({}) VALUES ({})", cols, placeholders)
}

// ── row mapping ────────────────────────────────────────────────

#[cfg(not(target_arch = "wasm32"))]
pub fn row_to_relationship_type_native(row: &rusqlite::Row) -> Result<RelationshipType, rusqlite::Error> {
    Ok(RelationshipType {
        id: row.get(0)?,
        r#type: row.get(1)?,
        inverse: row.get(2)?,
        label: row.get(3)?,
        inverse_label: row.get(4)?,
        color: row.get(5)?,
        order: row.get(6)?,
        strength: row.get(7)?,
        deleted: row.get(8)?,
        builtin: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

/// sql.js 路径：按 COLS 列名查表（顺序无关，列名唯一权威），与原生同源于 `RELATIONSHIP_TYPE_COLS`。
/// 保留原 sqljs 的语义：inverse 空串→None，strength 缺省 "medium"，builtin 缺省 1，其余数值缺省 0。
#[cfg(any(target_arch = "wasm32", test))]
pub fn row_to_relationship_type_js(row: &HashMap<String, String>) -> RelationshipType {
    RelationshipType {
        id: row.get("id").cloned().unwrap_or_default(),
        r#type: row.get("type").cloned().unwrap_or_default(),
        inverse: {
            let p = row.get("inverse").cloned().unwrap_or_default();
            if p.is_empty() { None } else { Some(p) }
        },
        label: row.get("label").cloned().unwrap_or_default(),
        inverse_label: row.get("inverse_label").cloned().unwrap_or_default(),
        color: row.get("color").cloned().unwrap_or_default(),
        order: row.get("order").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        strength: row.get("strength").cloned().unwrap_or_else(|| "medium".to_string()),
        deleted: row.get("deleted").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        builtin: row.get("builtin").cloned().unwrap_or_else(|| "1".to_string()).parse::<i64>().unwrap_or(1),
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
pub fn relationship_type_params(rt: &RelationshipType) -> Vec<&dyn ToSql> {
    vec![
        &rt.id, &rt.r#type, &rt.inverse, &rt.label, &rt.inverse_label, &rt.color,
        &rt.order, &rt.strength, &rt.deleted, &rt.builtin, &rt.created_at, &rt.updated_at,
    ]
}

#[cfg(not(target_arch = "wasm32"))]
pub fn relationship_type_get_by_id<E: Executor>(exec: &E, id: &str) -> Result<RelationshipType, Box<dyn Error>> {
    let sql = format!("SELECT {} FROM RelationshipType WHERE id = ?1", relationship_type_select_cols());
    let params: Vec<&dyn ToSql> = vec![&id];
    let rows = exec.query_map(&sql, &params, |row| row_to_relationship_type_native(row)).map_err(bx)?;
    rows.into_iter().next().ok_or_else(|| {
        Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "RelationshipType not found")) as Box<dyn Error>
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn relationship_type_get_by_type<E: Executor>(
    exec: &E,
    r#type: &str,
) -> Result<Option<RelationshipType>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM RelationshipType WHERE type = ?1 AND deleted = 0",
        relationship_type_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![&r#type];
    let rows = exec.query_map(&sql, &params, |row| row_to_relationship_type_native(row)).map_err(bx)?;
    Ok(rows.into_iter().next())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn relationship_type_get_all<E: Executor>(exec: &E) -> Result<Vec<RelationshipType>, Box<dyn Error>> {
    let sql = format!(
        "SELECT {} FROM RelationshipType WHERE deleted = 0 ORDER BY `order`",
        relationship_type_select_cols()
    );
    let params: Vec<&dyn ToSql> = vec![];
    exec.query_map(&sql, &params, |row| row_to_relationship_type_native(row)).map_err(bx)
}

#[cfg(not(target_arch = "wasm32"))]
pub fn relationship_type_create<E: Executor>(exec: &E, rt: &RelationshipType) -> Result<(), Box<dyn Error>> {
    let params = relationship_type_params(rt);
    exec.execute(&relationship_type_insert_sql(), &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn relationship_type_update<E: Executor>(exec: &E, rt: &RelationshipType) -> Result<(), Box<dyn Error>> {
    let sql = "UPDATE RelationshipType SET type = ?2, inverse = ?3, label = ?4, inverse_label = ?5, color = ?6, `order` = ?7, strength = ?8, deleted = ?9, updated_at = ?10, version = version + 1 \
               WHERE id = ?1";
    let params: Vec<&dyn ToSql> = vec![
        &rt.id, &rt.r#type, &rt.inverse, &rt.label, &rt.inverse_label, &rt.color,
        &rt.order, &rt.strength, &rt.deleted, &rt.updated_at,
    ];
    exec.execute(sql, &params)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn relationship_type_delete<E: Executor>(exec: &E, id: &str) -> Result<(), Box<dyn Error>> {
    let now = chrono::Utc::now().timestamp_millis();
    let params: Vec<&dyn ToSql> = vec![&id, &now];
    exec.execute(
        "UPDATE RelationshipType SET deleted = 1, deleted_at = ?2, version = version + 1, updated_at = ?2 WHERE id = ?1",
        &params,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn row_to_relationship_type_js_roundtrip() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "r1".to_string());
        m.insert("type".to_string(), "ref".to_string());
        m.insert("inverse".to_string(), "refby".to_string());
        m.insert("label".to_string(), "References".to_string());
        m.insert("inverse_label".to_string(), "Referenced by".to_string());
        m.insert("color".to_string(), "#fff".to_string());
        m.insert("order".to_string(), "2".to_string());
        m.insert("strength".to_string(), "strong".to_string());
        m.insert("deleted".to_string(), "0".to_string());
        m.insert("builtin".to_string(), "1".to_string());
        m.insert("created_at".to_string(), "1".to_string());
        m.insert("updated_at".to_string(), "2".to_string());
        let rt = row_to_relationship_type_js(&m);
        assert_eq!(rt.id, "r1");
        assert_eq!(rt.r#type, "ref");
        assert_eq!(rt.inverse, Some("refby".to_string()));
        assert_eq!(rt.order, 2);
        assert_eq!(rt.strength, "strong");
        assert_eq!(rt.builtin, 1);
    }

    #[test]
    fn row_to_relationship_type_js_inverse_none() {
        let mut m = HashMap::new();
        m.insert("id".to_string(), "r2".to_string());
        m.insert("inverse".to_string(), "".to_string());
        let rt = row_to_relationship_type_js(&m);
        assert_eq!(rt.inverse, None);
        // 缺省列依旧给出合理默认值
        assert_eq!(rt.strength, "medium");
        assert_eq!(rt.builtin, 1);
        assert_eq!(rt.order, 0);
    }
}
