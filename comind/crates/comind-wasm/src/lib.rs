use wasm_bindgen::prelude::*;
use comind_core::types::*;
use comind_core::services::*;
use comind_core::storage::{SqlJsAdapter, StorageAdapter};
use lazy_static::lazy_static;
use std::sync::Mutex;
use serde_json::json;

lazy_static! {
    static ref ADAPTER: Mutex<Option<SqlJsAdapter>> = Mutex::new(None);
}

fn with_adapter<F, R>(f: F) -> Result<R, JsValue>
where
    F: FnOnce(&mut SqlJsAdapter) -> Result<R, Box<dyn std::error::Error>>,
{
    let mut adapter = ADAPTER.lock().map_err(|e| JsValue::from_str(&format!("Failed to lock adapter: {}", e)))?;
    let adapter = adapter.as_mut().ok_or(JsValue::from_str("Adapter not initialized"))?;
    f(adapter).map_err(|e| JsValue::from_str(&format!("Error: {}", e)))
}

fn to_js_value<T: serde::Serialize>(value: T) -> JsValue {
    let json_str = serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string());
    JsValue::from_str(&json_str)
}

#[wasm_bindgen]
pub fn init() -> Result<(), JsValue> {
    let mut adapter = ADAPTER.lock().map_err(|e| JsValue::from_str(&format!("Failed to lock adapter: {}", e)))?;
    let new_adapter = SqlJsAdapter::new().map_err(|e| JsValue::from_str(&format!("Failed to create adapter: {}", e)))?;
    *adapter = Some(new_adapter);
    Ok(())
}

#[wasm_bindgen]
pub fn get_block(block_id: &str) -> Result<JsValue, JsValue> {
    with_adapter(|adapter| {
        let block = BlockService::get_by_id(adapter, block_id)?;
        Ok(to_js_value(block))
    })
}

#[wasm_bindgen]
pub fn get_blocks_by_page(page_id: &str) -> Result<JsValue, JsValue> {
    with_adapter(|adapter| {
        let blocks = BlockService::get_by_page_id(adapter, page_id)?;
        Ok(to_js_value(blocks))
    })
}

#[wasm_bindgen]
pub fn get_page(page_id: &str) -> Result<JsValue, JsValue> {
    with_adapter(|adapter| {
        let page = PageService::get_by_id(adapter, page_id)?;
        Ok(to_js_value(page))
    })
}

#[wasm_bindgen]
pub fn get_all_pages() -> Result<JsValue, JsValue> {
    with_adapter(|adapter| {
        let pages = PageService::get_all(adapter)?;
        Ok(to_js_value(pages))
    })
}

#[wasm_bindgen]
pub fn save_block_tree(blocks: JsValue) -> Result<JsValue, JsValue> {
    let blocks: Vec<Block> = serde_json::from_str(&blocks.as_string().unwrap_or_else(|| "[]".to_string()))
        .map_err(|e| JsValue::from_str(&format!("Failed to parse blocks: {}", e)))?;
    
    with_adapter(|adapter| {
        for block in &blocks {
            let existing = BlockService::get_by_id(adapter, &block.id);
            match existing {
                Ok(_) => {
                    BlockService::update(
                        adapter,
                        &block.id,
                        Some(&block.content),
                        Some(&block.format),
                        Some(&block.r#type),
                        block.parent_id.as_deref(),
                        Some(block.pos),
                    )?;
                }
                Err(_) => {
                    let _ = BlockService::create(
                        adapter,
                        &block.page_id,
                        block.parent_id.as_deref(),
                        &block.content,
                        &block.format,
                        &block.r#type,
                    )?;
                }
            }
        }
        Ok(to_js_value(json!({"success": true})))
    })
}

#[wasm_bindgen]
pub fn save_page(page: JsValue) -> Result<JsValue, JsValue> {
    let page: Page = serde_json::from_str(&page.as_string().unwrap_or_else(|| "{}".to_string()))
        .map_err(|e| JsValue::from_str(&format!("Failed to parse page: {}", e)))?;
    
    with_adapter(|adapter| {
        let existing = PageService::get_by_id(adapter, &page.id);
        match existing {
            Ok(_) => {
                let updated = PageService::update(
                    adapter,
                    &page.id,
                    Some(&page.title),
                    Some(&page.r#type),
                    page.icon.as_deref(),
                    page.cover.as_deref(),
                    Some(&page.aliases),
                    page.file_path.as_deref(),
                    Some(page.children_count),
                    Some(page.word_count),
                )?;
                Ok(to_js_value(updated))
            }
            Err(_) => {
                let block_id = page.block_id.as_deref().unwrap_or("");
                let created = PageService::create(
                    adapter,
                    block_id,
                    &page.title,
                    Some(&page.r#type),
                    page.icon.as_deref(),
                    page.cover.as_deref(),
                    Some(&page.aliases),
                    page.file_path.as_deref(),
                )?;
                Ok(to_js_value(created))
            }
        }
    })
}

#[wasm_bindgen]
pub fn delete_page_cascade(page_id: &str) -> Result<JsValue, JsValue> {
    with_adapter(|adapter| {
        BlockService::delete_by_page_id(adapter, page_id)?;
        PageService::delete(adapter, page_id)?;
        Ok(to_js_value(json!({"success": true})))
    })
}

#[wasm_bindgen]
pub fn search(query: &str) -> Result<JsValue, JsValue> {
    with_adapter(|adapter| {
        let results = adapter.search().search(query, 20)?;
        Ok(to_js_value(results))
    })
}

#[wasm_bindgen]
pub fn get_backlinks(page_id: &str) -> Result<JsValue, JsValue> {
    with_adapter(|adapter| {
        let links = LinkService::get_by_target_page_id(adapter, page_id)?;
        Ok(to_js_value(links))
    })
}

#[wasm_bindgen]
pub fn get_properties(block_id: &str) -> Result<JsValue, JsValue> {
    with_adapter(|adapter| {
        let props = PropertyService::get_by_block_id(adapter, block_id)?;
        Ok(to_js_value(props))
    })
}

#[wasm_bindgen]
pub fn set_property(block_id: &str, key: &str, value: &str, type_: &str) -> Result<JsValue, JsValue> {
    with_adapter(|adapter| {
        let existing = PropertyService::get_by_block_id_and_key(adapter, block_id, key)?;
        match existing {
            Some(mut prop) => {
                prop.value = value.to_string();
                prop.r#type = type_.to_string();
                prop.updated_at = chrono::Utc::now().timestamp_millis();
                PropertyService::update(
                    adapter,
                    &prop.id,
                    Some(value),
                    Some(type_),
                    None,
                    None,
                )?;
                Ok(to_js_value(prop))
            }
            None => {
                let created = PropertyService::create(
                    adapter,
                    block_id,
                    key,
                    value,
                    type_,
                    0,
                    0,
                    1,
                )?;
                Ok(to_js_value(created))
            }
        }
    })
}

#[wasm_bindgen]
pub fn delete_property(block_id: &str, key: &str) -> Result<JsValue, JsValue> {
    with_adapter(|adapter| {
        let existing = PropertyService::get_by_block_id_and_key(adapter, block_id, key)?;
        if let Some(prop) = existing {
            PropertyService::delete(adapter, &prop.id)?;
        }
        Ok(to_js_value(json!({"success": true})))
    })
}

#[wasm_bindgen]
pub fn get_relationship_types() -> Result<JsValue, JsValue> {
    with_adapter(|adapter| {
        let rts = RelationshipTypeService::get_all(adapter)?;
        Ok(to_js_value(rts))
    })
}

#[wasm_bindgen]
pub fn execute_batch(operations: JsValue) -> Result<JsValue, JsValue> {
    let ops: Vec<serde_json::Value> = serde_json::from_str(&operations.as_string().unwrap_or_else(|| "[]".to_string()))
        .map_err(|e| JsValue::from_str(&format!("Failed to parse operations: {}", e)))?;
    
    with_adapter(|adapter| {
        let mut results = Vec::new();
        for op in ops {
            let entity = op.get("entity").and_then(|v| v.as_str()).unwrap_or("");
            let action = op.get("action").and_then(|v| v.as_str()).unwrap_or("");
            let params = op.get("params").unwrap_or(&serde_json::Value::Null);
            
            let result = match (entity, action) {
                ("block", "get") => {
                    let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let block = BlockService::get_by_id(adapter, id)?;
                    serde_json::to_value(block)
                }
                ("block", "create") => {
                    let block: Block = serde_json::from_value(params.clone())?;
                    let created = BlockService::create(
                        adapter,
                        &block.page_id,
                        block.parent_id.as_deref(),
                        &block.content,
                        &block.format,
                        &block.r#type,
                    )?;
                    serde_json::to_value(created)
                }
                ("block", "update") => {
                    let block: Block = serde_json::from_value(params.clone())?;
                    let updated = BlockService::update(
                        adapter,
                        &block.id,
                        Some(&block.content),
                        Some(&block.format),
                        Some(&block.r#type),
                        block.parent_id.as_deref(),
                        Some(block.pos),
                    )?;
                    serde_json::to_value(updated)
                }
                ("block", "delete") => {
                    let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    BlockService::delete(adapter, id)?;
                    serde_json::to_value(json!({"success": true}))
                }
                ("page", "get") => {
                    let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let page = PageService::get_by_id(adapter, id)?;
                    serde_json::to_value(page)
                }
                ("page", "create") => {
                    let page: Page = serde_json::from_value(params.clone())?;
                    let block_id = page.block_id.as_deref().unwrap_or("");
                    let created = PageService::create(
                        adapter,
                        block_id,
                        &page.title,
                        Some(&page.r#type),
                        page.icon.as_deref(),
                        page.cover.as_deref(),
                        Some(&page.aliases),
                        page.file_path.as_deref(),
                    )?;
                    serde_json::to_value(created)
                }
                ("page", "update") => {
                    let page: Page = serde_json::from_value(params.clone())?;
                    let updated = PageService::update(
                        adapter,
                        &page.id,
                        Some(&page.title),
                        Some(&page.r#type),
                        page.icon.as_deref(),
                        page.cover.as_deref(),
                        Some(&page.aliases),
                        page.file_path.as_deref(),
                        Some(page.children_count),
                        Some(page.word_count),
                    )?;
                    serde_json::to_value(updated)
                }
                ("page", "delete") => {
                    let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    PageService::delete(adapter, id)?;
                    serde_json::to_value(json!({"success": true}))
                }
                ("property", "set") => {
                    let block_id = params.get("block_id").and_then(|v| v.as_str()).unwrap_or("");
                    let key = params.get("key").and_then(|v| v.as_str()).unwrap_or("");
                    let value = params.get("value").and_then(|v| v.as_str()).unwrap_or("");
                    let r#type = params.get("type").and_then(|v| v.as_str()).unwrap_or("text");
                    let created = PropertyService::create(adapter, block_id, key, value, r#type, 0, 0, 1)?;
                    serde_json::to_value(created)
                }
                ("property", "delete") => {
                    let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    PropertyService::delete(adapter, id)?;
                    serde_json::to_value(json!({"success": true}))
                }
                ("link", "create") => {
                    let link: Link = serde_json::from_value(params.clone())?;
                    let created = LinkService::create(
                        adapter,
                        &link.source_block_id,
                        &link.target_page_id,
                        &link.display_text,
                        link.relationship_type.as_deref(),
                    )?;
                    serde_json::to_value(created)
                }
                ("link", "delete") => {
                    let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    LinkService::delete(adapter, id)?;
                    serde_json::to_value(json!({"success": true}))
                }
                ("relationshipType", "create") => {
                    let rt: RelationshipType = serde_json::from_value(params.clone())?;
                    let created = RelationshipTypeService::create(
                        adapter,
                        &rt.r#type,
                        rt.inverse.as_deref(),
                        &rt.label,
                        &rt.inverse_label,
                        &rt.color,
                        rt.order,
                        &rt.strength,
                        rt.builtin,
                    )?;
                    serde_json::to_value(created)
                }
                ("relationshipType", "update") => {
                    let rt: RelationshipType = serde_json::from_value(params.clone())?;
                    let updated = RelationshipTypeService::update(
                        adapter,
                        &rt.id,
                        Some(&rt.label),
                        Some(&rt.inverse_label),
                        Some(&rt.color),
                        Some(rt.order),
                        Some(&rt.strength),
                    )?;
                    serde_json::to_value(updated)
                }
                ("relationshipType", "delete") => {
                    let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    RelationshipTypeService::delete(adapter, id)?;
                    serde_json::to_value(json!({"success": true}))
                }
                _ => serde_json::to_value(json!({"error": format!("Unknown operation: {} {}", entity, action)}))
            };
            
            results.push(result.unwrap_or_else(|_| serde_json::Value::Null));
        }
        Ok(to_js_value(results))
    })
}
