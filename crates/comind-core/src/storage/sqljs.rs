#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;
#[cfg(target_arch = "wasm32")]
use js_sys::{Object, Array};
#[cfg(target_arch = "wasm32")]
use std::collections::HashMap;

use super::super::types::*;
use super::repository::*;
#[cfg(target_arch = "wasm32")]
use crate::storage::entity::date_ref::{date_ref_select_cols, row_to_date_ref_js};
#[cfg(target_arch = "wasm32")]
use crate::storage::entity::block::{block_select_cols, row_to_block_js};
#[cfg(target_arch = "wasm32")]
use crate::storage::entity::page::{page_select_cols, row_to_page_js};
#[cfg(target_arch = "wasm32")]
use crate::storage::entity::link::{link_select_cols, row_to_link_js};
use crate::storage::entity::property::{property_select_cols, row_to_property_js};
use crate::storage::entity::relationship_type::{relationship_type_select_cols, row_to_relationship_type_js};
use crate::storage::entity::template::{template_select_cols, row_to_template_js};
use crate::storage::entity::block_version::{block_version_select_cols, row_to_block_version_js};
use crate::storage::entity::notification::{notification_select_cols, row_to_notification_js};
use crate::storage::entity::saved_filter::{saved_filter_select_cols, row_to_saved_filter_js};
use crate::storage::entity::screen_view::{screen_view_select_cols, row_to_screen_view_js};

#[cfg(target_arch = "wasm32")]
pub struct SqlJsAdapter {
    db: Object,
}

#[cfg(target_arch = "wasm32")]
impl SqlJsAdapter {
    const STORAGE_KEY: &'static str = "comind:sqljs-database";

    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let sql = Self::get_sql_module()?;
        let db = Self::create_database(&sql)?;
        Self::init_schema(&db)?;
        Self::load_from_storage(&db)?;
        Ok(Self { db })
    }

    fn load_from_storage(db: &Object) -> Result<(), Box<dyn std::error::Error>> {
        let storage = js_sys::eval("typeof window !== 'undefined' ? window.localStorage : null")
            .map_err(|e| format!("Failed to get localStorage: {:?}", e))?;
        
        if storage.is_null() || storage.is_undefined() {
            return Ok(());
        }

        let get_item = js_sys::Reflect::get(&Object::from(storage.clone()), &JsValue::from_str("getItem"))
            .map_err(|e| format!("Failed to get getItem: {:?}", e))?;
        
        let result = js_sys::Function::from(get_item).call1(&Object::from(storage), &JsValue::from_str(Self::STORAGE_KEY))
            .map_err(|e| format!("Failed to call getItem: {:?}", e))?;
        
        if result.is_null() || result.is_undefined() {
            return Ok(());
        }

        let data_str = result.as_string().unwrap_or_default();
        if data_str.is_empty() {
            return Ok(());
        }

        let array = js_sys::eval(&format!("Uint8Array.from(atob('{}'), c => c.charCodeAt(0))", data_str))
            .map_err(|e| format!("Failed to decode data: {:?}", e))?;
        
        let array_buffer = js_sys::Reflect::get(&Object::from(array), &JsValue::from_str("buffer"))
            .map_err(|e| format!("Failed to get buffer: {:?}", e))?;
        
        let load_fn = js_sys::Reflect::get(db, &JsValue::from_str("load"))
            .map_err(|e| format!("Failed to get load: {:?}", e))?;
        js_sys::Function::from(load_fn).call1(db, &array_buffer)
            .map_err(|e| format!("Failed to load database: {:?}", e))?;

        Ok(())
    }

    pub fn save_to_storage(&self) -> Result<(), Box<dyn std::error::Error>> {
        let storage = js_sys::eval("typeof window !== 'undefined' ? window.localStorage : null")
            .map_err(|e| format!("Failed to get localStorage: {:?}", e))?;
        
        if storage.is_null() || storage.is_undefined() {
            return Ok(());
        }

        let export_fn = js_sys::Reflect::get(&self.db, &JsValue::from_str("export"))
            .map_err(|e| format!("Failed to get export: {:?}", e))?;
        let buffer = js_sys::Function::from(export_fn).call0(&self.db)
            .map_err(|e| format!("Failed to export database: {:?}", e))?;
        
        let uint8_array = js_sys::eval("new Uint8Array(arguments[0])")
            .map_err(|e| format!("Failed to create Uint8Array: {:?}", e))?;
        
        let result = js_sys::Function::from(uint8_array).call0(&buffer)
            .map_err(|e| format!("Failed to call Uint8Array: {:?}", e))?;
        
        let _string_from_char_code = js_sys::eval("String.fromCharCode")
            .map_err(|e| format!("Failed to get String.fromCharCode: {:?}", e))?;
        
        let array = Array::from(&result);
        let chars: Vec<String> = (0..array.length())
            .map(|i| {
                let code = array.get(i).as_f64().unwrap_or(0.0) as u32;
                char::from_u32(code).unwrap_or('\0').to_string()
            })
            .collect();
        
        let binary_str = chars.join("");
        
        let btoa = js_sys::eval("btoa")
            .map_err(|e| format!("Failed to get btoa: {:?}", e))?;
        let base64 = js_sys::Function::from(btoa).call1(&JsValue::NULL, &JsValue::from_str(&binary_str))
            .map_err(|e| format!("Failed to encode: {:?}", e))?;
        
        let set_item = js_sys::Reflect::get(&Object::from(storage.clone()), &JsValue::from_str("setItem"))
            .map_err(|e| format!("Failed to get setItem: {:?}", e))?;
        js_sys::Function::from(set_item).call2(&Object::from(storage), &JsValue::from_str(Self::STORAGE_KEY), &base64)
            .map_err(|e| format!("Failed to call setItem: {:?}", e))?;

        Ok(())
    }

    fn get_sql_module() -> Result<Object, Box<dyn std::error::Error>> {
        let sql = js_sys::eval("typeof window !== 'undefined' ? window.SQL : typeof global !== 'undefined' ? global.SQL : null")
            .map_err(|e| format!("Failed to get SQL module: {:?}", e))?;
        
        if sql.is_null() || sql.is_undefined() {
            return Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "SQL module not found. Make sure sql.js is loaded before initializing."
            )));
        }
        
        Ok(Object::from(sql))
    }

    fn create_database(sql: &Object) -> Result<Object, Box<dyn std::error::Error>> {
        let constructor = js_sys::Reflect::get(sql, &JsValue::from_str("Database"))
            .map_err(|e| format!("Failed to get Database constructor: {:?}", e))?;
        
        let function = js_sys::Function::from(constructor);
        let db = js_sys::Reflect::construct(&function, &Array::new())
            .map_err(|e| format!("Failed to create database: {:?}", e))?;
        
        Ok(Object::from(db))
    }

    fn init_schema(db: &Object) -> Result<(), Box<dyn std::error::Error>> {
        Self::exec(db, "CREATE TABLE IF NOT EXISTS Page (id TEXT PRIMARY KEY, block_id TEXT, title TEXT NOT NULL UNIQUE, type TEXT NOT NULL DEFAULT 'normal', icon TEXT, cover TEXT, aliases TEXT NOT NULL DEFAULT '[]', file_path TEXT, children_count INTEGER NOT NULL DEFAULT 0, word_count INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);")?;
        
        Self::migrate_add_page_title_unique(db)?;
        
        Self::exec(db, "CREATE TABLE IF NOT EXISTS Block (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, parent_id TEXT, pos INTEGER NOT NULL DEFAULT 1000, content TEXT NOT NULL DEFAULT '', format TEXT NOT NULL DEFAULT '{}', type TEXT NOT NULL DEFAULT 'bullet', version INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);")?;
        
        Self::exec(db, "CREATE TABLE IF NOT EXISTS Link (id TEXT PRIMARY KEY, source_block_id TEXT NOT NULL, target_page_id TEXT NOT NULL, display_text TEXT NOT NULL, relationship_type TEXT, updated_at INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, created_at INTEGER NOT NULL);")?;
        
        Self::exec(db, "CREATE TABLE IF NOT EXISTS DateRef (id TEXT PRIMARY KEY, block_id TEXT NOT NULL, kind TEXT NOT NULL, iso TEXT NOT NULL, date_day TEXT NOT NULL, recurrence TEXT NOT NULL DEFAULT 'none', lead_minutes INTEGER NOT NULL DEFAULT 0, event_ts INTEGER NOT NULL DEFAULT 0, updated_at INTEGER, version INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, created_at INTEGER NOT NULL);")?;
        
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_date_ref_kind_day ON DateRef(kind, date_day);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_date_ref_block ON DateRef(block_id);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_date_ref_event_ts ON DateRef(event_ts);")?;
        
        Self::exec(db, "CREATE TABLE IF NOT EXISTS Property (id TEXT PRIMARY KEY, block_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, type TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, is_hidden INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0, schema_version INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(block_id, key));")?;
        
        Self::exec(db, "CREATE TABLE IF NOT EXISTS RelationshipType (id TEXT PRIMARY KEY, type TEXT NOT NULL, inverse TEXT, label TEXT NOT NULL, inverse_label TEXT NOT NULL, color TEXT NOT NULL, `order` INTEGER NOT NULL DEFAULT 0, strength TEXT NOT NULL DEFAULT 'medium', deleted INTEGER NOT NULL DEFAULT 0, builtin INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);")?;
        
        Self::exec(db, "CREATE TABLE IF NOT EXISTS UserTemplate (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);")?;
        
        Self::exec(db, "CREATE TABLE IF NOT EXISTS BlockVersion (id TEXT PRIMARY KEY, block_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot TEXT NOT NULL, hash TEXT NOT NULL, message TEXT, source TEXT NOT NULL, restored_from_version_id TEXT, created_at INTEGER NOT NULL);")?;

        Self::exec(db, "CREATE TABLE IF NOT EXISTS Notification (id TEXT PRIMARY KEY, block_id TEXT NOT NULL, page_id TEXT NOT NULL, kind TEXT NOT NULL, event_iso TEXT NOT NULL, fired_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'unread', snooze_until INTEGER, payload TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_notifications_status ON Notification(status);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_notifications_fired_at ON Notification(fired_at);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_notifications_block_id ON Notification(block_id);")?;

        Self::exec(db, "CREATE UNIQUE INDEX IF NOT EXISTS idx_page_title ON Page(title);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_page_blockId ON Page(block_id);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_page_type ON Page(type);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_page_updatedAt ON Page(updated_at);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_block_pageId ON Block(page_id);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_block_parentId ON Block(parent_id);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_block_pos ON Block(pos);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_link_target ON Link(target_page_id);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_link_source ON Link(source_block_id);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_property_blockId ON Property(block_id);")?;
        Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_property_key ON Property(key);")?;

        Self::exec(db, "CREATE TABLE IF NOT EXISTS SavedFilter (id TEXT PRIMARY KEY, name TEXT NOT NULL, query_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);")?;

        Self::exec(db, "CREATE TABLE IF NOT EXISTS screen_view (id TEXT PRIMARY KEY, entity TEXT NOT NULL DEFAULT 'block', parent_id TEXT, name TEXT NOT NULL, query_json TEXT NOT NULL, view_type TEXT NOT NULL DEFAULT 'table', group_by TEXT NOT NULL DEFAULT '', is_default INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, config TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);")?;

        Self::migrate_date_ref_event_ts(db)?;
        Self::migrate_add_version_and_deleted_at(db)?;
        Self::migrate_rename_task_view_to_screen_view(db)?;
        Self::migrate_add_screen_view_config(db)?;
        Self::migrate_add_screen_view_entity(db)?;
        Self::migrate_add_screen_view_parent_id(db)?;

        Ok(())
    }

    fn migrate_add_version_and_deleted_at(db: &Object) -> Result<(), Box<dyn std::error::Error>> {
        let has_column = |table: &str, col: &str| -> bool {
            let rows = Self::query(db, &format!("PRAGMA table_info('{}');", table), &[]).unwrap_or_default();
            rows.iter().any(|r| r.values().any(|v| v == col))
        };

        if !has_column("Block", "version") {
            Self::exec(db, "ALTER TABLE Block ADD COLUMN version INTEGER NOT NULL DEFAULT 0;")?;
        }
        if !has_column("Block", "deleted_at") {
            Self::exec(db, "ALTER TABLE Block ADD COLUMN deleted_at INTEGER;")?;
        }
        if !has_column("Page", "version") {
            Self::exec(db, "ALTER TABLE Page ADD COLUMN version INTEGER NOT NULL DEFAULT 0;")?;
        }
        if !has_column("Page", "deleted_at") {
            Self::exec(db, "ALTER TABLE Page ADD COLUMN deleted_at INTEGER;")?;
            Self::exec(db, "UPDATE Page SET deleted_at = updated_at WHERE deleted = 1 AND deleted_at IS NULL;")?;
        }
        if !has_column("Link", "updated_at") {
            Self::exec(db, "ALTER TABLE Link ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;")?;
        }
        if !has_column("Link", "version") {
            Self::exec(db, "ALTER TABLE Link ADD COLUMN version INTEGER NOT NULL DEFAULT 0;")?;
        }
        if !has_column("Link", "deleted_at") {
            Self::exec(db, "ALTER TABLE Link ADD COLUMN deleted_at INTEGER;")?;
        }
        if !has_column("Property", "version") {
            Self::exec(db, "ALTER TABLE Property ADD COLUMN version INTEGER NOT NULL DEFAULT 0;")?;
        }
        if !has_column("Property", "deleted_at") {
            Self::exec(db, "ALTER TABLE Property ADD COLUMN deleted_at INTEGER;")?;
            Self::exec(db, "UPDATE Property SET deleted_at = updated_at WHERE is_deleted = 1 AND deleted_at IS NULL;")?;
        }
        if !has_column("RelationshipType", "version") {
            Self::exec(db, "ALTER TABLE RelationshipType ADD COLUMN version INTEGER NOT NULL DEFAULT 0;")?;
        }
        if !has_column("RelationshipType", "deleted_at") {
            Self::exec(db, "ALTER TABLE RelationshipType ADD COLUMN deleted_at INTEGER;")?;
        }
        if !has_column("DateRef", "updated_at") {
            Self::exec(db, "ALTER TABLE DateRef ADD COLUMN updated_at INTEGER;")?;
        }
        if !has_column("DateRef", "version") {
            Self::exec(db, "ALTER TABLE DateRef ADD COLUMN version INTEGER NOT NULL DEFAULT 0;")?;
        }
        if !has_column("DateRef", "deleted_at") {
            Self::exec(db, "ALTER TABLE DateRef ADD COLUMN deleted_at INTEGER;")?;
        }
        Ok(())
    }

    // 幂等迁移：老库 DateRef 表可能无 event_ts 列。
    // sql.js 是单线程串行调用，借 PRAGMA table_info 查表结构判断是否存在；存在则跳过。
    fn migrate_date_ref_event_ts(db: &Object) -> Result<(), Box<dyn std::error::Error>> {
        let rows = Self::query(db, "PRAGMA table_info(DateRef);", &[])?;
        let has_column = rows.iter().any(|r| r.values().any(|v| v == "event_ts"));
        if !has_column {
            Self::exec(db, "ALTER TABLE DateRef ADD COLUMN event_ts INTEGER NOT NULL DEFAULT 0;")?;
            Self::exec(db, "CREATE INDEX IF NOT EXISTS idx_date_ref_event_ts ON DateRef(event_ts);")?;
        }
        Ok(())
    }

    fn migrate_add_page_title_unique(db: &Object) -> Result<(), Box<dyn std::error::Error>> {
        let result = Self::exec(db, "CREATE UNIQUE INDEX IF NOT EXISTS idx_page_title ON Page(title);");
        if result.is_err() {
            let duplicate_result = Self::query(db, "SELECT title, COUNT(*) as cnt FROM Page WHERE deleted = 0 GROUP BY title HAVING cnt > 1;", &[]);
            if duplicate_result.is_ok() && !duplicate_result.as_ref().unwrap().is_empty() {
                Self::exec(db, "DELETE FROM Page WHERE id NOT IN (SELECT MIN(id) FROM Page WHERE deleted = 0 GROUP BY title);")?;
                Self::exec(db, "CREATE UNIQUE INDEX idx_page_title ON Page(title);")?;
            }
        }
        Ok(())
    }

    fn migrate_rename_task_view_to_screen_view(db: &Object) -> Result<(), Box<dyn std::error::Error>> {
        // 实体改名：旧表 TaskView → screen_view（去除 task 模块耦合，见 ADR-0005）。
        // 幂等：仅当旧表存在且新表不存在时 ALTER RENAME，保留现有测试视图行。
        let old_exists = !Self::query(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='TaskView'", &[])?.is_empty();
        let new_exists = !Self::query(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='screen_view'", &[])?.is_empty();
        if old_exists && !new_exists {
            Self::exec(db, "ALTER TABLE TaskView RENAME TO screen_view")?;
        }
        Ok(())
    }

    fn migrate_add_screen_view_config(db: &Object) -> Result<(), Box<dyn std::error::Error>> {
        // 加 config 列（JSON blob，可空）。幂等：列不存在才 ALTER ADD。
        let rows = Self::query(db, "PRAGMA table_info(screen_view);", &[])?;
        let has_column = rows.iter().any(|r| r.get("name").map(|s| s.as_str() == "config").unwrap_or(false));
        if !has_column {
            Self::exec(db, "ALTER TABLE screen_view ADD COLUMN config TEXT")?;
        }
        Ok(())
    }

    fn migrate_add_screen_view_entity(db: &Object) -> Result<(), Box<dyn std::error::Error>> {
        // 加 entity 列（所属实体键，用于按实体隔离命名视图）。幂等：列不存在才 ALTER ADD，默认 'block' 兼容存量视图。
        let rows = Self::query(db, "PRAGMA table_info(screen_view);", &[])?;
        let has_column = rows.iter().any(|r| r.get("name").map(|s| s.as_str() == "entity").unwrap_or(false));
        if !has_column {
            Self::exec(db, "ALTER TABLE screen_view ADD COLUMN entity TEXT NOT NULL DEFAULT 'block'")?;
        }
        Ok(())
    }

    fn migrate_add_screen_view_parent_id(db: &Object) -> Result<(), Box<dyn std::error::Error>> {
        // 加 parent_id 列（两级层级：空串 = Screen，非空 = Tab 所属 Screen id）。
        // 幂等：列不存在才 ALTER ADD；存量单级视图（parent_id 为 NULL）读取时回退空串，视作 Screen。
        let rows = Self::query(db, "PRAGMA table_info(screen_view);", &[])?;
        let has_column = rows.iter().any(|r| r.get("name").map(|s| s.as_str() == "parent_id").unwrap_or(false));
        if !has_column {
            Self::exec(db, "ALTER TABLE screen_view ADD COLUMN parent_id TEXT")?;
        }
        Ok(())
    }

    fn exec(db: &Object, sql: &str) -> Result<(), Box<dyn std::error::Error>> {
        let run_fn = js_sys::Reflect::get(db, &JsValue::from_str("run"))
            .map_err(|e| format!("Failed to get run: {:?}", e))?;
        js_sys::Function::from(run_fn).call1(db, &JsValue::from_str(sql))
            .map_err(|e| format!("SQL execution failed: {:?}", e))?;
        Ok(())
    }

    fn query(db: &Object, sql: &str, params: &[&str]) -> Result<Vec<HashMap<String, String>>, Box<dyn std::error::Error>> {
        // sql.js 的 Database.exec(sql, params) 要求 params 为数组；
        // 错误地 spread 为 db.exec(sql, p1, p2, ...) 会导致参数绑定失效、查询返回空。
        let param_array = Array::new();
        for param in params {
            param_array.push(&JsValue::from_str(param));
        }

        let args = Array::new();
        args.push(&JsValue::from_str(sql));
        args.push(&param_array);

        let exec_fn = js_sys::Reflect::get(db, &JsValue::from_str("exec"))
            .map_err(|e| format!("Failed to get exec: {:?}", e))?;
        let result = js_sys::Function::from(exec_fn).apply(db, &args)
            .map_err(|e| format!("SQL query failed: {:?}", e))?;

        let results = Array::from(&result);
        if results.length() == 0 {
            return Ok(Vec::new());
        }

        let first_result = Object::from(results.get(0));
        let columns = Array::from(&js_sys::Reflect::get(&first_result, &JsValue::from_str("columns"))
            .map_err(|e| format!("Failed to get columns: {:?}", e))?);
        let values = Array::from(&js_sys::Reflect::get(&first_result, &JsValue::from_str("values"))
            .map_err(|e| format!("Failed to get values: {:?}", e))?);

        let mut rows = Vec::new();
        for i in 0..values.length() {
            let row_values = Array::from(&values.get(i));
            let mut row = HashMap::new();
            
            for j in 0..columns.length() {
                let col_name = columns.get(j).as_string().unwrap_or_default();
                let val = row_values.get(j);
                let val_str = if val.is_string() {
                    val.as_string().unwrap_or_default()
                } else if val.as_f64().is_some() {
                    val.as_f64().unwrap_or(0.0).to_string()
                } else if val.is_null() || val.is_undefined() {
                    "".to_string()
                } else {
                    val.as_string().unwrap_or_default()
                };
                row.insert(col_name, val_str);
            }
            
            rows.push(row);
        }

        Ok(rows)
    }

    fn run_with_params(db: &Object, sql: &str, params: &[&str]) -> Result<(), Box<dyn std::error::Error>> {
        let param_array = Array::new();
        for param in params {
            param_array.push(&JsValue::from_str(param));
        }

        let args = Array::new();
        args.push(&JsValue::from_str(sql));
        args.push(&param_array);

        let run_fn = js_sys::Reflect::get(db, &JsValue::from_str("run"))
            .map_err(|e| format!("Failed to get run: {:?}", e))?;
        js_sys::Function::from(run_fn).apply(db, &args)
            .map_err(|e| format!("SQL run failed: {:?}", e))?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
#[cfg(target_arch = "wasm32")]
impl BlockRepository for SqlJsAdapter {
    fn get_all(&self) -> Result<Vec<Block>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Block WHERE deleted_at IS NULL", block_select_cols()), &[])?;
        Ok(result.into_iter().map(|r| row_to_block_js(&r)).collect())
    }

    fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Block WHERE id = ? AND deleted_at IS NULL", block_select_cols()), &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Block not found")));
        }
        Ok(row_to_block_js(&result[0]))
    }

    fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Block WHERE page_id = ? AND deleted_at IS NULL ORDER BY pos", block_select_cols()), &[page_id])?;
        Ok(result.into_iter().map(|r| row_to_block_js(&r)).collect())
    }

    fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Block WHERE parent_id = ? AND deleted_at IS NULL ORDER BY pos", block_select_cols()), &[parent_id])?;
        Ok(result.into_iter().map(|r| row_to_block_js(&r)).collect())
    }

    fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Block>, Box<dyn std::error::Error>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT {} FROM Block WHERE id IN ({}) AND deleted_at IS NULL",
            block_select_cols(),
            placeholders.join(", ")
        );
        let params: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
        let result = Self::query(&self.db, &sql, &params)?;
        Ok(result.into_iter().map(|r| row_to_block_js(&r)).collect())
    }

    fn create(&mut self, block: &Block) -> Result<Block, Box<dyn std::error::Error>> {
        let parent_id = block.parent_id.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "INSERT INTO Block (id, page_id, parent_id, pos, content, format, type, version, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)", &[
            &block.id, &block.page_id, parent_id,
            &block.pos.to_string(), &block.content, &block.format,
            &block.r#type, &block.version.to_string(),
            &block.created_at.to_string(), &block.updated_at.to_string()
        ])?;
        Ok(block.clone())
    }

    fn update(&mut self, block: &Block) -> Result<Block, Box<dyn std::error::Error>> {
        let parent_id = block.parent_id.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "UPDATE Block SET page_id = ?, parent_id = ?, pos = ?, content = ?, format = ?, type = ?, version = version + 1, updated_at = ? WHERE id = ?", &[
            &block.page_id, parent_id, &block.pos.to_string(),
            &block.content, &block.format, &block.r#type,
            &block.updated_at.to_string(), &block.id
        ])?;
        Ok(block.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Block SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?", &[&now.to_string(), &now.to_string(), id])?;
        Ok(())
    }

    fn delete_by_page_id(&mut self, page_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Block SET deleted_at = ?, version = version + 1, updated_at = ? WHERE page_id = ?", &[&now.to_string(), &now.to_string(), page_id])?;
        Ok(())
    }
}


#[cfg(target_arch = "wasm32")]
impl PageRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<Page, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Page WHERE id = ? AND deleted = 0 AND deleted_at IS NULL", page_select_cols()), &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Page not found")));
        }
        Ok(row_to_page_js(&result[0]))
    }

    fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Page WHERE title = ? AND deleted = 0 AND deleted_at IS NULL", page_select_cols()), &[title])?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_page_js(&result[0])))
        }
    }

    fn get_all(&self) -> Result<Vec<Page>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Page WHERE deleted = 0 AND deleted_at IS NULL ORDER BY updated_at DESC", page_select_cols()), &[])?;
        Ok(result.into_iter().map(|r| row_to_page_js(&r)).collect())
    }

    fn get_trash(&self) -> Result<Vec<Page>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Page WHERE deleted = 1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC", page_select_cols()), &[])?;
        Ok(result.into_iter().map(|r| row_to_page_js(&r)).collect())
    }

    fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Page>, Box<dyn std::error::Error>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT {} FROM Page WHERE id IN ({}) AND deleted = 0 AND deleted_at IS NULL",
            page_select_cols(),
            placeholders.join(", ")
        );
        let params: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
        let result = Self::query(&self.db, &sql, &params)?;
        Ok(result.into_iter().map(|r| row_to_page_js(&r)).collect())
    }

    fn get_ideas_by_month(&self, year: i32, month: u32) -> Result<Vec<Page>, Box<dyn std::error::Error>> {
        let start = format!("{}-{:02}-01", year, month);
        let end = if month == 12 {
            format!("{}-01-01", year + 1)
        } else {
            format!("{}-{:02}-01", year, month + 1)
        };
        let result = Self::query(&self.db, &format!("SELECT {} FROM Page WHERE type IN ('ideas', 'journal') AND deleted = 0 AND deleted_at IS NULL AND title >= ? AND title < ? ORDER BY title DESC", page_select_cols()), &[start.as_str(), end.as_str()])?;
        Ok(result.into_iter().map(|r| row_to_page_js(&r)).collect())
    }

    fn create(&mut self, page: &Page) -> Result<Page, Box<dyn std::error::Error>> {
        let block_id = page.block_id.as_deref().unwrap_or("");
        let icon = page.icon.as_deref().unwrap_or("");
        let cover = page.cover.as_deref().unwrap_or("");
        let file_path = page.file_path.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "INSERT INTO Page (id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, version, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)", &[
            &page.id, block_id, &page.title, &page.r#type, icon, cover,
            &page.aliases, file_path, &page.children_count.to_string(),
            &page.word_count.to_string(), &page.deleted.to_string(),
            &page.version.to_string(),
            &page.created_at.to_string(), &page.updated_at.to_string()
        ])?;
        Ok(page.clone())
    }

    fn update(&mut self, page: &Page) -> Result<Page, Box<dyn std::error::Error>> {
        let block_id = page.block_id.as_deref().unwrap_or("");
        let icon = page.icon.as_deref().unwrap_or("");
        let cover = page.cover.as_deref().unwrap_or("");
        let file_path = page.file_path.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "UPDATE Page SET block_id = ?, title = ?, type = ?, icon = ?, cover = ?, aliases = ?, file_path = ?, children_count = ?, word_count = ?, deleted = ?, version = version + 1, updated_at = ? WHERE id = ?", &[
            block_id, &page.title, &page.r#type, icon, cover,
            &page.aliases, file_path, &page.children_count.to_string(),
            &page.word_count.to_string(), &page.deleted.to_string(),
            &page.updated_at.to_string(), &page.id
        ])?;
        Ok(page.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Page SET deleted = 1, deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?", &[&now.to_string(), &now.to_string(), id])?;
        Ok(())
    }

    fn get_by_title_including_deleted(&self, title: &str) -> Result<Option<Page>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Page WHERE title = ?", page_select_cols()), &[title])?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_page_js(&result[0])))
        }
    }

    fn get_ideas_months(&self) -> Result<Vec<String>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT DISTINCT substr(title, 1, 7) AS month FROM Page WHERE type IN ('ideas', 'journal') AND deleted = 0 AND deleted_at IS NULL ORDER BY month DESC", &[])?;
        Ok(result.into_iter().map(|r| r.get("month").cloned().unwrap_or_default()).collect())
    }
}

#[cfg(target_arch = "wasm32")]
impl LinkRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Link WHERE id = ? AND deleted_at IS NULL", link_select_cols()), &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Link not found")));
        }
        Ok(row_to_link_js(&result[0]))
    }

    fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Link WHERE source_block_id = ? AND deleted_at IS NULL", link_select_cols()), &[source_block_id])?;
        Ok(result.into_iter().map(|r| row_to_link_js(&r)).collect())
    }

    fn get_by_source_block_ids(&self, source_block_ids: &[String]) -> Result<Vec<Link>, Box<dyn std::error::Error>> {
        if source_block_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = source_block_ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!(
            "SELECT {} FROM Link WHERE source_block_id IN ({}) AND deleted_at IS NULL",
            link_select_cols(),
            placeholders.join(", ")
        );
        let params: Vec<&str> = source_block_ids.iter().map(|s| s.as_str()).collect();
        let result = Self::query(&self.db, &sql, &params)?;
        Ok(result.into_iter().map(|r| row_to_link_js(&r)).collect())
    }

    fn get_by_target_page_id(&self, target_page_id: &str) -> Result<Vec<Link>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Link WHERE target_page_id = ? AND deleted_at IS NULL", link_select_cols()), &[target_page_id])?;
        Ok(result.into_iter().map(|r| row_to_link_js(&r)).collect())
    }

    fn create(&mut self, link: &Link) -> Result<Link, Box<dyn std::error::Error>> {
        let relationship_type = link.relationship_type.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "INSERT INTO Link (id, source_block_id, target_page_id, display_text, relationship_type, updated_at, version, deleted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?)", &[
            &link.id, &link.source_block_id, &link.target_page_id,
            &link.display_text, relationship_type, &link.updated_at.to_string(), &link.created_at.to_string()
        ])?;
        Ok(link.clone())
    }

    fn create_many(&mut self, links: &[Link]) -> Result<Vec<Link>, Box<dyn std::error::Error>> {
        for link in links {
            LinkRepository::create(self, link)?;
        }
        Ok(links.to_vec())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Link SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?", &[&now.to_string(), &now.to_string(), id])?;
        Ok(())
    }

    fn delete_by_source_block_id(&mut self, source_block_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Link SET deleted_at = ?, version = version + 1, updated_at = ? WHERE source_block_id = ?", &[&now.to_string(), &now.to_string(), source_block_id])?;
        Ok(())
    }

    fn delete_by_target_page_id(&mut self, target_page_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Link SET deleted_at = ?, version = version + 1, updated_at = ? WHERE target_page_id = ?", &[&now.to_string(), &now.to_string(), target_page_id])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
#[cfg(target_arch = "wasm32")]
impl NotificationRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<Notification, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Notification WHERE id = ?", notification_select_cols()), &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Notification not found")));
        }
        Ok(row_to_notification_js(&result[0]))
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Notification>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Notification WHERE block_id = ? ORDER BY fired_at DESC", notification_select_cols()), &[block_id])?;
        Ok(result.into_iter().map(|r| row_to_notification_js(&r)).collect())
    }

    fn get_by_block_ids(&self, block_ids: &[String]) -> Result<Vec<Notification>, Box<dyn std::error::Error>> {
        if block_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = block_ids.iter().enumerate().map(|(i, _)| format!("?{}", i + 1)).collect();
        let sql = format!("SELECT {} FROM Notification WHERE block_id IN ({}) ORDER BY fired_at DESC", notification_select_cols(), placeholders.join(", "));
        let params: Vec<&str> = block_ids.iter().map(|s| s.as_str()).collect();
        let result = Self::query(&self.db, &sql, &params)?;
        Ok(result.into_iter().map(|r| row_to_notification_js(&r)).collect())
    }

    fn find_by_event(&self, block_id: &str, kind: &str, event_iso: &str) -> Result<Option<Notification>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Notification WHERE block_id = ? AND kind = ? AND event_iso = ? LIMIT 1", notification_select_cols()), &[block_id, kind, event_iso])?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_notification_js(&result[0])))
        }
    }

    fn query_unread(&self) -> Result<Vec<Notification>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Notification WHERE status = 'unread' ORDER BY fired_at DESC", notification_select_cols()), &[])?;
        Ok(result.into_iter().map(|r| row_to_notification_js(&r)).collect())
    }

    fn query_pending_due(&self, now_ms: i64) -> Result<Vec<Notification>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Notification WHERE status = 'pending' AND snooze_until IS NOT NULL AND snooze_until <= ? ORDER BY snooze_until ASC", notification_select_cols()), &[&now_ms.to_string()])?;
        Ok(result.into_iter().map(|r| row_to_notification_js(&r)).collect())
    }

    fn query_recent(&self, limit: usize) -> Result<Vec<Notification>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Notification WHERE status IN ('unread', 'read') ORDER BY fired_at DESC LIMIT ?", notification_select_cols()), &[&limit.to_string()])?;
        Ok(result.into_iter().map(|r| row_to_notification_js(&r)).collect())
    }

    fn create(&mut self, notification: &Notification) -> Result<Notification, Box<dyn std::error::Error>> {
        let snooze_until = notification.snooze_until.map(|s| s.to_string()).unwrap_or_default();
        Self::run_with_params(&self.db, "INSERT INTO Notification (id, block_id, page_id, kind, event_iso, fired_at, status, snooze_until, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", &[
            &notification.id, &notification.block_id, &notification.page_id, &notification.kind,
            &notification.event_iso, &notification.fired_at.to_string(), &notification.status,
            &snooze_until, &notification.payload, &notification.created_at.to_string(), &notification.updated_at.to_string()
        ])?;
        Ok(notification.clone())
    }

    fn batch_create(&mut self, notifications: &[Notification]) -> Result<Vec<Notification>, Box<dyn std::error::Error>> {
        for n in notifications {
            NotificationRepository::create(self, n)?;
        }
        Ok(notifications.to_vec())
    }

    fn update_status(&mut self, id: &str, status: &str) -> Result<Notification, Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Notification SET status = ?, updated_at = ? WHERE id = ?", &[status, &now.to_string(), id])?;
        NotificationRepository::get_by_id(self, id)
    }

    fn update_payload(&mut self, id: &str, payload: &str) -> Result<Notification, Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Notification SET payload = ?, updated_at = ? WHERE id = ?", &[payload, &now.to_string(), id])?;
        NotificationRepository::get_by_id(self, id)
    }

    fn reschedule(&mut self, block_id: &str, kind: &str, new_event_iso: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Notification SET event_iso = ?, status = 'unread', snooze_until = NULL, updated_at = ? WHERE block_id = ? AND kind = ? AND status IN ('unread','read','dismissed')", &[new_event_iso, &now.to_string(), block_id, kind])?;
        Ok(())
    }

    fn set_snooze(&mut self, id: &str, snooze_until: i64, status: &str) -> Result<Notification, Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Notification SET snooze_until = ?, status = ?, updated_at = ? WHERE id = ?", &[&snooze_until.to_string(), status, &now.to_string(), id])?;
        NotificationRepository::get_by_id(self, id)
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM Notification WHERE id = ?", &[id])?;
        Ok(())
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM Notification WHERE block_id = ?", &[block_id])?;
        Ok(())
    }

    fn delete_by_block_and_kind(&mut self, block_id: &str, kind: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM Notification WHERE block_id = ? AND kind = ?", &[block_id, kind])?;
        Ok(())
    }

    fn delete_older_than(&mut self, timestamp: i64) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM Notification WHERE status = 'read' AND updated_at < ?", &[&timestamp.to_string()])?;
        Ok(())
    }

    fn mark_all_read(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Notification SET status = 'read', updated_at = ? WHERE status = 'unread'", &[&now.to_string()])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl DateRefRepository for SqlJsAdapter {
    fn get_all(&self) -> Result<Vec<DateRef>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM DateRef WHERE deleted_at IS NULL", date_ref_select_cols()), &[])?;
        Ok(result.into_iter().map(|r| row_to_date_ref_js(&r)).collect())
    }

    fn get_by_id(&self, id: &str) -> Result<DateRef, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM DateRef WHERE id = ? AND deleted_at IS NULL", date_ref_select_cols()), &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "DateRef not found")));
        }
        Ok(row_to_date_ref_js(&result[0]))
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<DateRef>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM DateRef WHERE block_id = ? AND deleted_at IS NULL", date_ref_select_cols()), &[block_id])?;
        Ok(result.into_iter().map(|r| row_to_date_ref_js(&r)).collect())
    }

    fn query_by_date_range(&self, kind: &str, from: &str, to: &str) -> Result<Vec<DateRef>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM DateRef WHERE (kind = ? OR ? = '*') AND date_day BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY date_day, block_id", date_ref_select_cols()), &[kind, kind, from, to])?;
        Ok(result.into_iter().map(|r| row_to_date_ref_js(&r)).collect())
    }

    fn query_overdue(&self, today: &str) -> Result<Vec<DateRef>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM DateRef WHERE kind = 'deadline' AND date_day < ? AND deleted_at IS NULL ORDER BY date_day", date_ref_select_cols()), &[today])?;
        Ok(result.into_iter().map(|r| row_to_date_ref_js(&r)).collect())
    }

    fn query_due_non_recurring(&self, now_ms: i64) -> Result<Vec<DateRef>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM DateRef WHERE recurrence = 'none' AND (event_ts - lead_minutes * 60000) <= ? AND deleted_at IS NULL", date_ref_select_cols()), &[&now_ms.to_string()])?;
        Ok(result.into_iter().map(|r| row_to_date_ref_js(&r)).collect())
    }

    fn query_all_recurring(&self) -> Result<Vec<DateRef>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM DateRef WHERE recurrence != 'none' AND deleted_at IS NULL", date_ref_select_cols()), &[])?;
        Ok(result.into_iter().map(|r| row_to_date_ref_js(&r)).collect())
    }

    fn create(&mut self, date_ref: &DateRef) -> Result<DateRef, Box<dyn std::error::Error>> {
        let cols = date_ref_select_cols();
        let sql = format!("INSERT INTO DateRef ({}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)", cols);
        Self::run_with_params(&self.db, &sql, &[
            date_ref.id.as_str(),
            date_ref.block_id.as_str(),
            date_ref.kind.as_str(),
            date_ref.iso.as_str(),
            date_ref.date_day.as_str(),
            date_ref.recurrence.as_str(),
            &date_ref.lead_minutes.to_string(),
            &date_ref.created_at.to_string(),
            &date_ref.event_ts.to_string(),
            &date_ref.updated_at.to_string(),
        ])?;
        Ok(date_ref.clone())
    }

    fn create_many(&mut self, date_refs: &[DateRef]) -> Result<Vec<DateRef>, Box<dyn std::error::Error>> {
        for date_ref in date_refs {
            DateRefRepository::create(self, date_ref)?;
        }
        Ok(date_refs.to_vec())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE DateRef SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?", &[&now.to_string(), &now.to_string(), id])?;
        Ok(())
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE DateRef SET deleted_at = ?, version = version + 1, updated_at = ? WHERE block_id = ?", &[&now.to_string(), &now.to_string(), block_id])?;
        Ok(())
    }
}

impl PropertyRepository for SqlJsAdapter {
    fn get_all(&self) -> Result<Vec<Property>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Property WHERE is_deleted = 0 AND deleted_at IS NULL", property_select_cols()), &[])?;
        Ok(result.into_iter().map(|r| row_to_property_js(&r)).collect())
    }

    fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Property WHERE id = ? AND deleted_at IS NULL", property_select_cols()), &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Property not found")));
        }
        Ok(row_to_property_js(&result[0]))
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Property WHERE block_id = ? AND is_deleted = 0 AND deleted_at IS NULL ORDER BY sort_order", property_select_cols()), &[block_id])?;
        Ok(result.into_iter().map(|r| row_to_property_js(&r)).collect())
    }

    fn get_by_block_ids(&self, block_ids: &[String]) -> Result<Vec<Property>, Box<dyn std::error::Error>> {
        if block_ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders: Vec<String> = (1..=block_ids.len()).map(|i| format!("?{}", i)).collect();
        let sql = format!(
            "SELECT {} FROM Property WHERE block_id IN ({}) AND is_deleted = 0 AND deleted_at IS NULL ORDER BY sort_order",
            property_select_cols(),
            placeholders.join(", ")
        );
        let params: Vec<&str> = block_ids.iter().map(|s| s.as_str()).collect();
        let result = Self::query(&self.db, &sql, &params)?;
        Ok(result.into_iter().map(|r| row_to_property_js(&r)).collect())
    }

    fn get_by_block_id_and_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM Property WHERE block_id = ? AND key = ? AND is_deleted = 0 AND deleted_at IS NULL", property_select_cols()), &[block_id, key])?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_property_js(&result[0])))
        }
    }

    fn query_block_ids_by_key_value(&self, key: &str, values: &[String]) -> Result<Vec<String>, Box<dyn std::error::Error>> {
        if values.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = values.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT DISTINCT block_id FROM Property WHERE key = ? AND value IN ({}) AND is_deleted = 0 AND deleted_at IS NULL",
            placeholders
        );
        let mut params: Vec<&str> = Vec::new();
        params.push(key);
        for v in values {
            params.push(v.as_str());
        }
        let rows = Self::query(&self.db, &sql, &params)?;
        let ids: Vec<String> = rows.into_iter().filter_map(|r| r.get("block_id").map(|v| v.as_str()).map(|s| s.to_string())).collect();
        Ok(ids)
    }

    fn create(&mut self, property: &Property) -> Result<Property, Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "INSERT INTO Property (id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, version, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)", &[
            &property.id, &property.block_id, &property.key, &property.value, &property.r#type,
            &property.sort_order.to_string(), &property.is_hidden.to_string(), &property.is_deleted.to_string(),
            &property.schema_version.to_string(), &property.version.to_string(),
            &property.created_at.to_string(), &property.updated_at.to_string()
        ])?;
        Ok(property.clone())
    }
    fn upsert(&mut self, property: &Property) -> Result<Property, Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "INSERT INTO Property (id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, version, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?) ON CONFLICT(block_id, key) DO UPDATE SET value = excluded.value, type = excluded.type, updated_at = excluded.updated_at, sort_order = excluded.sort_order, is_hidden = excluded.is_hidden, schema_version = excluded.schema_version, is_deleted = 0, deleted_at = NULL", &[
            &property.id, &property.block_id, &property.key, &property.value, &property.r#type,
            &property.sort_order.to_string(), &property.is_hidden.to_string(), &property.is_deleted.to_string(),
            &property.schema_version.to_string(), &property.version.to_string(),
            &property.created_at.to_string(), &property.updated_at.to_string()
        ])?;
        Ok(property.clone())
    }

    fn update(&mut self, property: &Property) -> Result<Property, Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "UPDATE Property SET value = ?, type = ?, sort_order = ?, is_hidden = ?, is_deleted = ?, version = version + 1, updated_at = ? WHERE id = ?", &[
            &property.value, &property.r#type, &property.sort_order.to_string(),
            &property.is_hidden.to_string(), &property.is_deleted.to_string(),
            &property.updated_at.to_string(), &property.id
        ])?;
        Ok(property.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Property SET deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?", &[&now.to_string(), &now.to_string(), id])?;
        Ok(())
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Property SET deleted_at = ?, version = version + 1, updated_at = ? WHERE block_id = ?", &[&now.to_string(), &now.to_string(), block_id])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl RelationshipTypeRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<RelationshipType, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM RelationshipType WHERE id = ?", relationship_type_select_cols()), &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "RelationshipType not found")));
        }
        Ok(row_to_relationship_type_js(&result[0]))
    }

    fn get_by_type(&self, r#type: &str) -> Result<Option<RelationshipType>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM RelationshipType WHERE type = ? AND deleted = 0", relationship_type_select_cols()), &[r#type])?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_relationship_type_js(&result[0])))
        }
    }

    fn get_all(&self) -> Result<Vec<RelationshipType>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM RelationshipType WHERE deleted = 0 ORDER BY `order`", relationship_type_select_cols()), &[])?;
        Ok(result.into_iter().map(|r| row_to_relationship_type_js(&r)).collect())
    }

    fn create(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn std::error::Error>> {
        let inverse = rt.inverse.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "INSERT INTO RelationshipType (id, type, inverse, label, inverse_label, color, `order`, strength, deleted, builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", &[
            &rt.id, &rt.r#type, inverse, &rt.label, &rt.inverse_label, &rt.color,
            &rt.order.to_string(), &rt.strength, &rt.deleted.to_string(), &rt.builtin.to_string(),
            &rt.created_at.to_string(), &rt.updated_at.to_string()
        ])?;
        Ok(rt.clone())
    }

    fn update(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn std::error::Error>> {
        let inverse = rt.inverse.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "UPDATE RelationshipType SET type = ?, inverse = ?, label = ?, inverse_label = ?, color = ?, `order` = ?, strength = ?, deleted = ?, updated_at = ?, version = version + 1 WHERE id = ?", &[
            &rt.r#type, inverse, &rt.label, &rt.inverse_label, &rt.color,
            &rt.order.to_string(), &rt.strength, &rt.deleted.to_string(),
            &rt.updated_at.to_string(), &rt.id
        ])?;
        Ok(rt.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE RelationshipType SET deleted = 1, deleted_at = ?, version = version + 1, updated_at = ? WHERE id = ?", &[&now.to_string(), &now.to_string(), id])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl TemplateRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<UserTemplate, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM UserTemplate WHERE id = ?", template_select_cols()), &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "UserTemplate not found")));
        }
        Ok(row_to_template_js(&result[0]))
    }

    fn get_by_name(&self, name: &str) -> Result<Option<UserTemplate>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM UserTemplate WHERE name = ?", template_select_cols()), &[name])?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_template_js(&result[0])))
        }
    }

    fn get_all(&self) -> Result<Vec<UserTemplate>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM UserTemplate ORDER BY name", template_select_cols()), &[])?;
        Ok(result.into_iter().map(|r| row_to_template_js(&r)).collect())
    }

    fn create(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "INSERT INTO UserTemplate (id, name, category, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", &[
            &template.id, &template.name, &template.category, &template.content,
            &template.created_at.to_string(), &template.updated_at.to_string()
        ])?;
        Ok(template.clone())
    }

    fn update(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "UPDATE UserTemplate SET name = ?, category = ?, content = ?, updated_at = ? WHERE id = ?", &[
            &template.name, &template.category, &template.content,
            &template.updated_at.to_string(), &template.id
        ])?;
        Ok(template.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM UserTemplate WHERE id = ?", &[id])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl SavedFilterRepository for SqlJsAdapter {
    fn get_all(&self) -> Result<Vec<SavedFilter>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM SavedFilter ORDER BY created_at DESC", saved_filter_select_cols()), &[])?;
        Ok(result.into_iter().map(|r| row_to_saved_filter_js(&r)).collect())
    }

    fn get_by_id(&self, id: &str) -> Result<SavedFilter, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM SavedFilter WHERE id = ?", saved_filter_select_cols()), &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "SavedFilter not found")));
        }
        Ok(row_to_saved_filter_js(&result[0]))
    }

    fn create(&mut self, filter: &SavedFilter) -> Result<SavedFilter, Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "INSERT INTO SavedFilter (id, name, query_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", &[
            &filter.id, &filter.name, &filter.query_json, &filter.created_at.to_string(), &filter.updated_at.to_string()
        ])?;
        Ok(filter.clone())
    }

    fn update(&mut self, filter: &SavedFilter) -> Result<SavedFilter, Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "UPDATE SavedFilter SET name = ?, query_json = ?, updated_at = ? WHERE id = ?", &[
            &filter.name, &filter.query_json, &filter.updated_at.to_string(), &filter.id
        ])?;
        Ok(filter.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM SavedFilter WHERE id = ?", &[id])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl ScreenViewRepository for SqlJsAdapter {
    fn get_all_by_entity(&self, entity: &str) -> Result<Vec<ScreenView>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM screen_view WHERE entity = ?1 ORDER BY sort_order ASC, created_at DESC", screen_view_select_cols()), &[entity])?;
        Ok(result.into_iter().map(|r| row_to_screen_view_js(&r)).collect())
    }

    fn get_by_id(&self, id: &str) -> Result<ScreenView, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM screen_view WHERE id = ?", screen_view_select_cols()), &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "ScreenView not found")));
        }
        Ok(row_to_screen_view_js(&result[0]))
    }

    fn create(&mut self, view: &ScreenView) -> Result<ScreenView, Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "INSERT INTO screen_view (id, entity, parent_id, name, query_json, view_type, group_by, is_default, sort_order, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", &[
            &view.id, &view.entity, &view.parent_id, &view.name, &view.query_json, &view.view_type, &view.group_by,
            &view.is_default.to_string(), &view.sort_order.to_string(), &view.config, &view.created_at.to_string(), &view.updated_at.to_string()
        ])?;
        Ok(view.clone())
    }

    fn update(&mut self, view: &ScreenView) -> Result<ScreenView, Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "UPDATE screen_view SET parent_id = ?, name = ?, query_json = ?, view_type = ?, group_by = ?, is_default = ?, sort_order = ?, config = ?, updated_at = ? WHERE id = ?", &[
            &view.parent_id, &view.name, &view.query_json, &view.view_type, &view.group_by, &view.is_default.to_string(), &view.sort_order.to_string(), &view.config, &view.updated_at.to_string(), &view.id
        ])?;
        Ok(view.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM screen_view WHERE id = ?", &[id])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl SearchRepository for SqlJsAdapter {
    fn search(&self, _query: &str, _limit: usize) -> Result<Vec<SearchResult>, Box<dyn std::error::Error>> {
        Ok(Vec::new())
    }

    fn update_index(&mut self, _block_id: &str, _content: &str, _title: &str) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    fn delete_from_index(&mut self, _block_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl BlockVersionRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<BlockVersion, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM BlockVersion WHERE id = ?", block_version_select_cols()), &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "BlockVersion not found")));
        }
        Ok(row_to_block_version_js(&result[0]))
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<BlockVersion>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM BlockVersion WHERE block_id = ? ORDER BY version DESC", block_version_select_cols()), &[block_id])?;
        Ok(result.into_iter().map(|r| row_to_block_version_js(&r)).collect())
    }

    fn get_latest_version(&self, block_id: &str) -> Result<Option<BlockVersion>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, &format!("SELECT {} FROM BlockVersion WHERE block_id = ? ORDER BY version DESC LIMIT 1", block_version_select_cols()), &[block_id])?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_block_version_js(&result[0])))
        }
    }

    fn create(&mut self, version: &BlockVersion) -> Result<BlockVersion, Box<dyn std::error::Error>> {
        let message = version.message.as_deref().unwrap_or("");
        let restored_from_version_id = version.restored_from_version_id.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "INSERT INTO BlockVersion (id, block_id, version, snapshot, hash, message, source, restored_from_version_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", &[
            &version.id, &version.block_id, &version.version.to_string(),
            &version.snapshot, &version.hash, message,
            &version.source, restored_from_version_id, &version.created_at.to_string()
        ])?;
        Ok(version.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM BlockVersion WHERE id = ?", &[id])?;
        Ok(())
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM BlockVersion WHERE block_id = ?", &[block_id])?;
        Ok(())
    }

    fn delete_older_than(&mut self, block_id: &str, timestamp: i64) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM BlockVersion WHERE block_id = ? AND created_at < ?", &[block_id, &timestamp.to_string()])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl StorageAdapter for SqlJsAdapter {
    fn blocks(&mut self) -> &mut dyn BlockRepository {
        self
    }

    fn pages(&mut self) -> &mut dyn PageRepository {
        self
    }

    fn links(&mut self) -> &mut dyn LinkRepository {
        self
    }

    fn properties(&mut self) -> &mut dyn PropertyRepository {
        self
    }

    fn relationship_types(&mut self) -> &mut dyn RelationshipTypeRepository {
        self
    }

    fn templates(&mut self) -> &mut dyn TemplateRepository {
        self
    }

    fn search(&mut self) -> &mut dyn SearchRepository {
        self
    }
    
    fn block_versions(&mut self) -> &mut dyn BlockVersionRepository {
        self
    }

    fn date_refs(&mut self) -> &mut dyn DateRefRepository {
        self
    }

    fn notifications(&mut self) -> &mut dyn NotificationRepository {
        self
    }

    fn saved_filters(&mut self) -> &mut dyn SavedFilterRepository {
        self
    }

    fn screen_views(&mut self) -> &mut dyn ScreenViewRepository {
        self
    }

    fn notification_config(&mut self) -> &mut dyn NotificationConfigRepository {
        self
    }
}

impl NotificationConfigRepository for SqlJsAdapter {
    fn get(&self) -> Result<NotificationConfig, Box<dyn std::error::Error>> {
        // WASM: NotificationConfig stored in localStorage by TS layer.
        // Return default; TS layer handles actual persistence.
        Ok(NotificationConfig::default())
    }

    fn save(&mut self, _config: &NotificationConfig) -> Result<(), Box<dyn std::error::Error>> {
        // WASM: persisted by TS via localStorage.
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl TransactionalStorageAdapter for SqlJsAdapter {
    fn transaction<R, F>(&mut self, f: F) -> Result<R, Box<dyn std::error::Error>>
    where
        F: FnOnce(&mut dyn StorageAdapter) -> Result<R, Box<dyn std::error::Error>>,
    {
        f(self)
    }
}
