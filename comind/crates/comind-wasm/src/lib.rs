#[cfg(all(test, target_arch = "wasm32"))]
mod lib_test;

#[cfg(target_arch = "wasm32")]
mod wasm_impl {
    use comind_core::services::*;
    use comind_core::storage::StorageAdapter;
    use comind_core::types::*;
    use lazy_static::lazy_static;
    use serde::{Deserialize, Serialize};
    use serde_json::json;
    use std::sync::Mutex;
    use wasm_bindgen::prelude::*;

    lazy_static! {
        static ref ADAPTER: Mutex<Option<comind_core::storage::SqlJsAdapter>> = Mutex::new(None);
    }

    fn with_adapter<F, R>(f: F) -> Result<R, JsValue>
    where
        F: FnOnce(&mut comind_core::storage::SqlJsAdapter) -> Result<R, Box<dyn std::error::Error>>,
    {
        let mut adapter = ADAPTER
            .lock()
            .map_err(|e| JsValue::from_str(&format!("Failed to lock adapter: {}", e)))?;
        let adapter = adapter
            .as_mut()
            .ok_or(JsValue::from_str("Adapter not initialized"))?;
        f(adapter).map_err(|e| JsValue::from_str(&format!("Error: {}", e)))
    }

    fn to_js_value<T: serde::Serialize>(value: T) -> JsValue {
        let json_str = serde_json::to_string(&value).unwrap_or_else(|_| "null".to_string());
        JsValue::from_str(&json_str)
    }

    #[wasm_bindgen]
    pub fn init() -> Result<(), JsValue> {
        let mut adapter = ADAPTER
            .lock()
            .map_err(|e| JsValue::from_str(&format!("Failed to lock adapter: {}", e)))?;
        let new_adapter = comind_core::storage::SqlJsAdapter::new()
            .map_err(|e| JsValue::from_str(&format!("Failed to create adapter: {}", e)))?;
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
    pub fn get_trash_pages() -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let pages = PageService::get_trash(adapter)?;
            Ok(to_js_value(pages))
        })
    }

    #[wasm_bindgen]
    pub fn get_ideas_pages_by_month(year: i32, month: u32) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let pages = PageService::get_ideas_by_month(adapter, year, month)?;
            Ok(to_js_value(pages))
        })
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct BlockUpdate {
        id: String,
        page_id: String,
        parent_id: Option<String>,
        pos: i64,
        content: String,
        format: String,
        r#type: String,
        #[serde(default = "default_timestamp")]
        created_at: i64,
        #[serde(default = "default_timestamp")]
        updated_at: i64,
    }

    fn default_timestamp() -> i64 {
        chrono::Utc::now().timestamp_millis()
    }

    #[wasm_bindgen]
    pub fn save_block_tree(blocks: &str) -> Result<String, JsValue> {
        let updates: Vec<BlockUpdate> = serde_json::from_str(blocks)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse blocks: {}", e)))?;

        if updates.is_empty() {
            return Err(JsValue::from_str("No blocks provided"));
        }

        let first_block = &updates[0];
        if first_block.page_id.is_empty() {
            return Err(JsValue::from_str(&format!(
                "page_id is empty for block: {}",
                first_block.id
            )));
        }

        let blocks: Vec<Block> = updates
            .into_iter()
            .map(|u| Block {
                id: u.id,
                page_id: u.page_id,
                parent_id: u.parent_id,
                pos: u.pos,
                content: u.content,
                format: u.format,
                r#type: u.r#type,
                created_at: u.created_at,
                updated_at: u.updated_at,
                version: 0,
                deleted_at: None,
            })
            .collect();

        with_adapter(|adapter| {
            // Shared orchestration (ADR-0019 Q3): real snapshot + render segments
            // + page touch, aligned with the Tauri path. Transaction is the
            // pass-through no-op (Q7). Sync has no peer on web — sync_changes
            // are dropped here.
            let outcome = BlockWriteService::save_blocks(adapter, blocks)?;
            Ok(serde_json::to_string(&outcome.results).unwrap_or_else(|_| "[]".to_string()))
        })
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct PageUpdate {
        id: Option<String>,
        block_id: Option<String>,
        title: String,
        r#type: String,
        icon: Option<String>,
        cover: Option<String>,
        #[serde(default = "default_aliases")]
        aliases: String,
        file_path: Option<String>,
        children_count: Option<i64>,
        word_count: Option<i64>,
    }

    fn default_aliases() -> String {
        "[]".to_string()
    }

    #[wasm_bindgen]
    pub fn save_page(page: &str) -> Result<String, JsValue> {
        let update: PageUpdate = serde_json::from_str(page)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse page: {}", e)))?;

        with_adapter(|adapter| {
            let result = match update.id {
                Some(id) => {
                    let existing = PageService::get_by_id(adapter, &id);
                    match existing {
                        Ok(_) => {
                            let updated = PageService::update(
                                adapter,
                                &id,
                                Some(&update.title),
                                Some(&update.r#type),
                                update.icon.as_deref(),
                                update.cover.as_deref(),
                                Some(&update.aliases),
                                update.file_path.as_deref(),
                                update.children_count.or(Some(0)),
                                update.word_count.or(Some(0)),
                            )?;
                            serde_json::to_string(&updated).unwrap_or_else(|_| "{}".to_string())
                        }
                        Err(_) => {
                            let block_id = update.block_id.as_deref().unwrap_or("");
                            let created = PageService::create(
                                adapter,
                                block_id,
                                &update.title,
                                Some(&update.r#type),
                                update.icon.as_deref(),
                                update.cover.as_deref(),
                                Some(&update.aliases),
                                update.file_path.as_deref(),
                            )?;
                            serde_json::to_string(&created).unwrap_or_else(|_| "{}".to_string())
                        }
                    }
                }
                None => {
                    let block_id = update.block_id.as_deref().unwrap_or("");
                    let created = PageService::create(
                        adapter,
                        block_id,
                        &update.title,
                        Some(&update.r#type),
                        update.icon.as_deref(),
                        update.cover.as_deref(),
                        Some(&update.aliases),
                        update.file_path.as_deref(),
                    )?;
                    serde_json::to_string(&created).unwrap_or_else(|_| "{}".to_string())
                }
            };
            Ok(result)
        })
    }

    #[wasm_bindgen]
    pub fn delete_page_cascade(page_id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            // Shared orchestration (ADR-0019 Q8/Q14): per-block cascade + target
            // links + page delete, aligned with the Tauri path. Sync has no peer
            // on web — the returned sync_changes are dropped.
            let _sync_changes = BlockWriteService::delete_page_cascade(adapter, page_id)?;
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
    pub fn query_date_refs(kind: &str, from: &str, to: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let refs = DateRefService::query_by_date_range(adapter, kind, from, to)?;
            Ok(to_js_value(refs))
        })
    }

    #[wasm_bindgen]
    pub fn query_overdue_date_refs(today: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let refs = DateRefService::query_overdue(adapter, today)?;
            Ok(to_js_value(refs))
        })
    }

    #[wasm_bindgen]
    pub fn get_date_refs_by_block(block_id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let refs = DateRefService::get_by_block(adapter, block_id)?;
            Ok(to_js_value(refs))
        })
    }

    #[wasm_bindgen]
    pub fn query_due_non_recurring_date_refs(now_ms: i64) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let refs = DateRefService::query_due_non_recurring(adapter, now_ms)?;
            Ok(to_js_value(refs))
        })
    }

    #[wasm_bindgen]
    pub fn query_all_recurring_date_refs() -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let refs = DateRefService::query_all_recurring(adapter)?;
            Ok(to_js_value(refs))
        })
    }

    #[wasm_bindgen]
    pub fn rebuild_date_refs() -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let count = DateRefService::rebuild_all(adapter)?;
            Ok(to_js_value(json!({"rebuilt": count})))
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
    pub fn get_outlinks(page_id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let blocks = BlockService::get_by_page_id(adapter, page_id)?;
            let mut outlinks = Vec::new();
            for block in blocks {
                let links = LinkService::get_by_source_block_id(adapter, &block.id)?;
                outlinks.extend(links);
            }
            Ok(to_js_value(outlinks))
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
    pub fn set_property(
        block_id: &str,
        key: &str,
        value: &str,
        type_: &str,
    ) -> Result<JsValue, JsValue> {
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
                    let created =
                        PropertyService::create(adapter, block_id, key, value, type_, 0, 0, 1)?;
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
    pub fn execute_batch(operations: &str) -> Result<String, JsValue> {
        let ops: Vec<serde_json::Value> = serde_json::from_str(operations)
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
                            Some(&block.id),
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
                        comind_core::storage::repository::LinkRepository::delete_by_source_block_id(adapter.links(), id)?;
                        comind_core::storage::repository::PropertyRepository::delete_by_block_id(
                            adapter.properties(),
                            id,
                        )?;
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
                        let block_id = params
                            .get("block_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let key = params.get("key").and_then(|v| v.as_str()).unwrap_or("");
                        let value = params.get("value").and_then(|v| v.as_str()).unwrap_or("");
                        let r#type = params
                            .get("type")
                            .and_then(|v| v.as_str())
                            .unwrap_or("text");
                        let created = PropertyService::create(
                            adapter, block_id, key, value, r#type, 0, 0, 1,
                        )?;
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
                    ("link", "sync_by_block") => {
                        let block_id = params
                            .get("block_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        let links_data = params
                            .get("links")
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default();
                        LinkService::delete_by_source_block_id(adapter, block_id)?;
                        let mut created = Vec::new();
                        for link_data in links_data {
                            let source_block_id = link_data
                                .get("source_block_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let target_page_id = link_data
                                .get("target_page_id")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let display_text = link_data
                                .get("display_text")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let relationship_type =
                                link_data.get("relationship_type").and_then(|v| v.as_str());
                            let new_link = LinkService::create(
                                adapter,
                                source_block_id,
                                target_page_id,
                                display_text,
                                relationship_type,
                            )?;
                            created.push(new_link);
                        }
                        serde_json::to_value(created)
                    }
                    ("relationshipType", "create") => {
                        let rt: RelationshipType = serde_json::from_value(params.clone())?;
                        let created = RelationshipTypeService::create(
                            adapter,
                            Some(&rt.id),
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
                    ("template", "get") => {
                        let templates = TemplateService::get_all(adapter)?;
                        serde_json::to_value(templates)
                    }
                    ("template", "create") => {
                        let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let category = params
                            .get("category")
                            .and_then(|v| v.as_str())
                            .unwrap_or("custom");
                        let content = params.get("content").and_then(|v| v.as_str()).unwrap_or("");
                        let now = chrono::Utc::now().timestamp_millis();
                        let template = UserTemplate {
                            id: if id.is_empty() {
                                TemplateService::generate_id()
                            } else {
                                id.to_string()
                            },
                            name: name.to_string(),
                            category: category.to_string(),
                            content: content.to_string(),
                            created_at: now,
                            updated_at: now,
                        };
                        let created = comind_core::storage::repository::TemplateRepository::create(
                            adapter.templates(),
                            &template,
                        )?;
                        serde_json::to_value(created)
                    }
                    ("template", "update") => {
                        let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let name = params.get("name").and_then(|v| v.as_str());
                        let category = params.get("category").and_then(|v| v.as_str());
                        let content = params.get("content").and_then(|v| v.as_str());
                        let updated =
                            TemplateService::update(adapter, id, name, category, content)?;
                        serde_json::to_value(updated)
                    }
                    ("template", "delete") => {
                        let id = params.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        TemplateService::delete(adapter, id)?;
                        serde_json::to_value(json!({"success": true}))
                    }
                    _ => serde_json::to_value(
                        json!({"error": format!("Unknown operation: {} {}", entity, action)}),
                    ),
                };

                results.push(result.unwrap_or_else(|_| serde_json::Value::Null));
            }
            Ok(serde_json::to_string(&results).unwrap_or_else(|_| "[]".to_string()))
        })
    }
}
