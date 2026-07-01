#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;
#[cfg(target_arch = "wasm32")]
use js_sys::{Object, Array};
#[cfg(target_arch = "wasm32")]
use std::collections::HashMap;

use super::super::types::*;
use super::repository::*;

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
        
        let string_from_char_code = js_sys::eval("String.fromCharCode")
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
        Self::exec(db, "CREATE TABLE IF NOT EXISTS Page (id TEXT PRIMARY KEY, block_id TEXT, title TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'normal', icon TEXT, cover TEXT, aliases TEXT NOT NULL DEFAULT '[]', file_path TEXT, children_count INTEGER NOT NULL DEFAULT 0, word_count INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);")?;
        
        Self::exec(db, "CREATE TABLE IF NOT EXISTS Block (id TEXT PRIMARY KEY, page_id TEXT NOT NULL, parent_id TEXT, pos INTEGER NOT NULL DEFAULT 1000, content TEXT NOT NULL DEFAULT '', format TEXT NOT NULL DEFAULT '{}', type TEXT NOT NULL DEFAULT 'bullet', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);")?;
        
        Self::exec(db, "CREATE TABLE IF NOT EXISTS Link (id TEXT PRIMARY KEY, source_block_id TEXT NOT NULL, target_page_id TEXT NOT NULL, display_text TEXT NOT NULL, relationship_type TEXT, created_at INTEGER NOT NULL);")?;
        
        Self::exec(db, "CREATE TABLE IF NOT EXISTS Property (id TEXT PRIMARY KEY, block_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, type TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, is_hidden INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0, schema_version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(block_id, key));")?;
        
        Self::exec(db, "CREATE TABLE IF NOT EXISTS RelationshipType (id TEXT PRIMARY KEY, type TEXT NOT NULL, inverse TEXT, label TEXT NOT NULL, inverse_label TEXT NOT NULL, color TEXT NOT NULL, `order` INTEGER NOT NULL DEFAULT 0, strength TEXT NOT NULL DEFAULT 'medium', deleted INTEGER NOT NULL DEFAULT 0, builtin INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);")?;
        
        Self::exec(db, "CREATE TABLE IF NOT EXISTS UserTemplate (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);")?;

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
        let array = Array::new();
        array.push(&JsValue::from_str(sql));
        
        for param in params {
            array.push(&JsValue::from_str(param));
        }

        let exec_fn = js_sys::Reflect::get(db, &JsValue::from_str("exec"))
            .map_err(|e| format!("Failed to get exec: {:?}", e))?;
        let result = js_sys::Function::from(exec_fn).apply(db, &array)
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
fn row_to_block(row: &HashMap<String, String>) -> Block {
    Block {
        id: row.get("id").cloned().unwrap_or_default(),
        page_id: row.get("page_id").cloned().unwrap_or_default(),
        parent_id: {
            let p = row.get("parent_id").cloned().unwrap_or_default();
            if p.is_empty() { None } else { Some(p) }
        },
        pos: row.get("pos").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        content: row.get("content").cloned().unwrap_or_default(),
        format: row.get("format").cloned().unwrap_or_else(|| "{}".to_string()),
        r#type: row.get("type").cloned().unwrap_or_else(|| "bullet".to_string()),
        created_at: row.get("created_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        updated_at: row.get("updated_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

#[cfg(target_arch = "wasm32")]
fn row_to_page(row: &HashMap<String, String>) -> Page {
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
        created_at: row.get("created_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        updated_at: row.get("updated_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

#[cfg(target_arch = "wasm32")]
fn row_to_link(row: &HashMap<String, String>) -> Link {
    Link {
        id: row.get("id").cloned().unwrap_or_default(),
        source_block_id: row.get("source_block_id").cloned().unwrap_or_default(),
        target_page_id: row.get("target_page_id").cloned().unwrap_or_default(),
        display_text: row.get("display_text").cloned().unwrap_or_default(),
        relationship_type: {
            let p = row.get("relationship_type").cloned().unwrap_or_default();
            if p.is_empty() { None } else { Some(p) }
        },
        created_at: row.get("created_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

#[cfg(target_arch = "wasm32")]
fn row_to_property(row: &HashMap<String, String>) -> Property {
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
        created_at: row.get("created_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        updated_at: row.get("updated_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

#[cfg(target_arch = "wasm32")]
fn row_to_relationship_type(row: &HashMap<String, String>) -> RelationshipType {
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

#[cfg(target_arch = "wasm32")]
fn row_to_template(row: &HashMap<String, String>) -> UserTemplate {
    UserTemplate {
        id: row.get("id").cloned().unwrap_or_default(),
        name: row.get("name").cloned().unwrap_or_default(),
        category: row.get("category").cloned().unwrap_or_default(),
        content: row.get("content").cloned().unwrap_or_default(),
        created_at: row.get("created_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
        updated_at: row.get("updated_at").cloned().unwrap_or_else(|| "0".to_string()).parse::<i64>().unwrap_or(0),
    }
}

#[cfg(target_arch = "wasm32")]
impl BlockRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at FROM Block WHERE id = ?", &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Block not found")));
        }
        Ok(row_to_block(&result[0]))
    }

    fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at FROM Block WHERE page_id = ? ORDER BY pos", &[page_id])?;
        Ok(result.into_iter().map(|r| row_to_block(&r)).collect())
    }

    fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, page_id, parent_id, pos, content, format, type, created_at, updated_at FROM Block WHERE parent_id = ? ORDER BY pos", &[parent_id])?;
        Ok(result.into_iter().map(|r| row_to_block(&r)).collect())
    }

    fn create(&mut self, block: &Block) -> Result<Block, Box<dyn std::error::Error>> {
        let parent_id = block.parent_id.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "INSERT INTO Block (id, page_id, parent_id, pos, content, format, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", &[
            &block.id, &block.page_id, parent_id,
            &block.pos.to_string(), &block.content, &block.format,
            &block.r#type, &block.created_at.to_string(), &block.updated_at.to_string()
        ])?;
        Ok(block.clone())
    }

    fn update(&mut self, block: &Block) -> Result<Block, Box<dyn std::error::Error>> {
        let parent_id = block.parent_id.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "UPDATE Block SET page_id = ?, parent_id = ?, pos = ?, content = ?, format = ?, type = ?, updated_at = ? WHERE id = ?", &[
            &block.page_id, parent_id, &block.pos.to_string(),
            &block.content, &block.format, &block.r#type,
            &block.updated_at.to_string(), &block.id
        ])?;
        Ok(block.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM Block WHERE id = ?", &[id])?;
        Ok(())
    }

    fn delete_by_page_id(&mut self, page_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM Block WHERE page_id = ?", &[page_id])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl PageRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<Page, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at FROM Page WHERE id = ?", &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Page not found")));
        }
        Ok(row_to_page(&result[0]))
    }

    fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at FROM Page WHERE title = ? AND deleted = 0", &[title])?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_page(&result[0])))
        }
    }

    fn get_all(&self) -> Result<Vec<Page>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at FROM Page WHERE deleted = 0 ORDER BY updated_at DESC", &[])?;
        Ok(result.into_iter().map(|r| row_to_page(&r)).collect())
    }

    fn create(&mut self, page: &Page) -> Result<Page, Box<dyn std::error::Error>> {
        let block_id = page.block_id.as_deref().unwrap_or("");
        let icon = page.icon.as_deref().unwrap_or("");
        let cover = page.cover.as_deref().unwrap_or("");
        let file_path = page.file_path.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "INSERT INTO Page (id, block_id, title, type, icon, cover, aliases, file_path, children_count, word_count, deleted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", &[
            &page.id, block_id, &page.title, &page.r#type, icon, cover,
            &page.aliases, file_path, &page.children_count.to_string(),
            &page.word_count.to_string(), &page.deleted.to_string(),
            &page.created_at.to_string(), &page.updated_at.to_string()
        ])?;
        Ok(page.clone())
    }

    fn update(&mut self, page: &Page) -> Result<Page, Box<dyn std::error::Error>> {
        let block_id = page.block_id.as_deref().unwrap_or("");
        let icon = page.icon.as_deref().unwrap_or("");
        let cover = page.cover.as_deref().unwrap_or("");
        let file_path = page.file_path.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "UPDATE Page SET block_id = ?, title = ?, type = ?, icon = ?, cover = ?, aliases = ?, file_path = ?, children_count = ?, word_count = ?, deleted = ?, updated_at = ? WHERE id = ?", &[
            block_id, &page.title, &page.r#type, icon, cover,
            &page.aliases, file_path, &page.children_count.to_string(),
            &page.word_count.to_string(), &page.deleted.to_string(),
            &page.updated_at.to_string(), &page.id
        ])?;
        Ok(page.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE Page SET deleted = 1, updated_at = ? WHERE id = ?", &[&now.to_string(), id])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl LinkRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at FROM Link WHERE id = ?", &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Link not found")));
        }
        Ok(row_to_link(&result[0]))
    }

    fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at FROM Link WHERE source_block_id = ?", &[source_block_id])?;
        Ok(result.into_iter().map(|r| row_to_link(&r)).collect())
    }

    fn get_by_target_page_id(&self, target_page_id: &str) -> Result<Vec<Link>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, source_block_id, target_page_id, display_text, relationship_type, created_at FROM Link WHERE target_page_id = ?", &[target_page_id])?;
        Ok(result.into_iter().map(|r| row_to_link(&r)).collect())
    }

    fn create(&mut self, link: &Link) -> Result<Link, Box<dyn std::error::Error>> {
        let relationship_type = link.relationship_type.as_deref().unwrap_or("");
        Self::run_with_params(&self.db, "INSERT INTO Link (id, source_block_id, target_page_id, display_text, relationship_type, created_at) VALUES (?, ?, ?, ?, ?, ?)", &[
            &link.id, &link.source_block_id, &link.target_page_id,
            &link.display_text, relationship_type, &link.created_at.to_string()
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
        Self::run_with_params(&self.db, "DELETE FROM Link WHERE id = ?", &[id])?;
        Ok(())
    }

    fn delete_by_source_block_id(&mut self, source_block_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM Link WHERE source_block_id = ?", &[source_block_id])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl PropertyRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at FROM Property WHERE id = ?", &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Property not found")));
        }
        Ok(row_to_property(&result[0]))
    }

    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at FROM Property WHERE block_id = ? AND is_deleted = 0 ORDER BY sort_order", &[block_id])?;
        Ok(result.into_iter().map(|r| row_to_property(&r)).collect())
    }

    fn get_by_block_id_and_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at FROM Property WHERE block_id = ? AND key = ? AND is_deleted = 0", &[block_id, key])?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_property(&result[0])))
        }
    }

    fn create(&mut self, property: &Property) -> Result<Property, Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "INSERT INTO Property (id, block_id, key, value, type, sort_order, is_hidden, is_deleted, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", &[
            &property.id, &property.block_id, &property.key, &property.value, &property.r#type,
            &property.sort_order.to_string(), &property.is_hidden.to_string(), &property.is_deleted.to_string(),
            &property.schema_version.to_string(), &property.created_at.to_string(), &property.updated_at.to_string()
        ])?;
        Ok(property.clone())
    }

    fn update(&mut self, property: &Property) -> Result<Property, Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "UPDATE Property SET value = ?, type = ?, sort_order = ?, is_hidden = ?, is_deleted = ?, updated_at = ? WHERE id = ?", &[
            &property.value, &property.r#type, &property.sort_order.to_string(),
            &property.is_hidden.to_string(), &property.is_deleted.to_string(),
            &property.updated_at.to_string(), &property.id
        ])?;
        Ok(property.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM Property WHERE id = ?", &[id])?;
        Ok(())
    }

    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn std::error::Error>> {
        Self::run_with_params(&self.db, "DELETE FROM Property WHERE block_id = ?", &[block_id])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl RelationshipTypeRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<RelationshipType, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, type, inverse, label, inverse_label, color, `order`, strength, deleted, builtin, created_at, updated_at FROM RelationshipType WHERE id = ?", &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "RelationshipType not found")));
        }
        Ok(row_to_relationship_type(&result[0]))
    }

    fn get_by_type(&self, r#type: &str) -> Result<Option<RelationshipType>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, type, inverse, label, inverse_label, color, `order`, strength, deleted, builtin, created_at, updated_at FROM RelationshipType WHERE type = ? AND deleted = 0", &[r#type])?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_relationship_type(&result[0])))
        }
    }

    fn get_all(&self) -> Result<Vec<RelationshipType>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, type, inverse, label, inverse_label, color, `order`, strength, deleted, builtin, created_at, updated_at FROM RelationshipType WHERE deleted = 0 ORDER BY `order`", &[])?;
        Ok(result.into_iter().map(|r| row_to_relationship_type(&r)).collect())
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
        Self::run_with_params(&self.db, "UPDATE RelationshipType SET type = ?, inverse = ?, label = ?, inverse_label = ?, color = ?, `order` = ?, strength = ?, deleted = ?, updated_at = ? WHERE id = ?", &[
            &rt.r#type, inverse, &rt.label, &rt.inverse_label, &rt.color,
            &rt.order.to_string(), &rt.strength, &rt.deleted.to_string(),
            &rt.updated_at.to_string(), &rt.id
        ])?;
        Ok(rt.clone())
    }

    fn delete(&mut self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        Self::run_with_params(&self.db, "UPDATE RelationshipType SET deleted = 1, updated_at = ? WHERE id = ?", &[&now.to_string(), id])?;
        Ok(())
    }
}

#[cfg(target_arch = "wasm32")]
impl TemplateRepository for SqlJsAdapter {
    fn get_by_id(&self, id: &str) -> Result<UserTemplate, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, name, category, content, created_at, updated_at FROM UserTemplate WHERE id = ?", &[id])?;
        if result.is_empty() {
            return Err(Box::new(std::io::Error::new(std::io::ErrorKind::NotFound, "Template not found")));
        }
        Ok(row_to_template(&result[0]))
    }

    fn get_by_name(&self, name: &str) -> Result<Option<UserTemplate>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, name, category, content, created_at, updated_at FROM UserTemplate WHERE name = ?", &[name])?;
        if result.is_empty() {
            Ok(None)
        } else {
            Ok(Some(row_to_template(&result[0])))
        }
    }

    fn get_all(&self) -> Result<Vec<UserTemplate>, Box<dyn std::error::Error>> {
        let result = Self::query(&self.db, "SELECT id, name, category, content, created_at, updated_at FROM UserTemplate ORDER BY name", &[])?;
        Ok(result.into_iter().map(|r| row_to_template(&r)).collect())
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
impl SearchRepository for SqlJsAdapter {
    fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, Box<dyn std::error::Error>> {
        Ok(Vec::new())
    }

    fn update_index(&mut self, block_id: &str, content: &str, title: &str) -> Result<(), Box<dyn std::error::Error>> {
        Ok(())
    }

    fn delete_from_index(&mut self, block_id: &str) -> Result<(), Box<dyn std::error::Error>> {
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
