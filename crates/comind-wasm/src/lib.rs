#[cfg(all(test, target_arch = "wasm32"))]
mod lib_test;

#[cfg(target_arch = "wasm32")]
mod wasm_impl {
    use comind_core::services::*;
    use comind_core::storage::{StorageAdapter, TransactionalStorageAdapter};
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
                tags: Vec::new(),
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
                                // word_count 由 block 保存路径（save_blocks 重算）维护，
                                // 页元数据更新不得清零——传 None 保持原值
                                None,
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
            // 事务对齐（ADR-0046 约束3 / #108 验收#2）：整批一个事务，任一 op
            // 失败 → 整批回滚并向上抛错。分派单源在 core（ADR-0048 / #116）：
            // op 语义变更只改 comind-core services/batch.rs 一处；OpEffect 的
            // sync/page_ids 效果仅 Tauri 路径消费，WASM 忽略。
            adapter.transaction(|storage| {
                let effects = comind_core::services::batch::apply_batch(storage, &ops)?;
                let results: Vec<serde_json::Value> =
                    effects.into_iter().map(|e| e.value).collect();
                serde_json::to_string(&results)
                    .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)
            })
        })
    }


    // ---- ensure_today_ideas_page（共享幂等逻辑；chrono `wasmbind` → 浏览器本地时区） ----
    #[wasm_bindgen]
    pub fn ensure_today_ideas_page() -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let page = PageService::ensure_today_ideas_page(adapter)?;
            Ok(to_js_value(page))
        })
    }

    // ---- snapshot_stale_ideas_pages（物化服务薄转发；today 取浏览器本地时区，与 ensure 同源） ----
    #[wasm_bindgen]
    pub fn snapshot_stale_ideas_pages() -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let today = chrono::Local::now().format("%Y-%m-%d").to_string();
            let count = SnapshotService::snapshot_stale_ideas_pages(adapter, &today)?;
            Ok(to_js_value(json!({ "materialized": count })))
        })
    }

    // ---- get_ideas_snapshot（快照读取守卫：历史 ideas 页渲染取回 content_json + 标题日期 date；无快照返回 null） ----
    #[wasm_bindgen]
    pub fn get_ideas_snapshot(page_id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let snapshot = SnapshotService::get_ideas_snapshot(adapter, page_id)?;
            Ok(match snapshot {
                Some((content, date)) => to_js_value(json!({ "content": content, "date": date })),
                None => to_js_value(json!({ "content": null, "date": null })),
            })
        })
    }

    // ---- list_ideas_snapshot_months（历史面板月份列表：轻量，只返回 yyyy-MM 倒序） ----
    #[wasm_bindgen]
    pub fn list_ideas_snapshot_months() -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let months = SnapshotService::list_ideas_snapshot_months(adapter)?;
            Ok(to_js_value(months))
        })
    }

    // ---- list_ideas_snapshots_by_month（历史列表按月异步：指定月份快照，含 content_json） ----
    #[wasm_bindgen]
    pub fn list_ideas_snapshots_by_month(year: i32, month: i32) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let snapshots = SnapshotService::list_ideas_snapshots_by_month(adapter, year, month)?;
            Ok(to_js_value(snapshots))
        })
    }

    // ---- Block versions（共享 BlockVersionService，与 Tauri commands.rs 同构薄转发） ----
    #[wasm_bindgen]
    pub fn create_block_version(
        block_id: &str,
        snapshot: &str,
        hash: &str,
        reason: &str,
        checkpoint_name: Option<String>,
    ) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let version = BlockVersionService::create(
                adapter,
                block_id,
                snapshot,
                hash,
                reason,
                checkpoint_name.as_deref(),
                None,
            )?;
            Ok(to_js_value(version))
        })
    }

    #[wasm_bindgen]
    pub fn get_block_versions(block_id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let versions = BlockVersionService::list(adapter, block_id)?;
            Ok(to_js_value(versions))
        })
    }

    #[wasm_bindgen]
    pub fn get_block_version_by_id(id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let version = BlockVersionService::get_by_id(adapter, id)?;
            Ok(to_js_value(version))
        })
    }

    #[wasm_bindgen]
    pub fn restore_block_version(version_id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let version = BlockVersionService::restore(adapter, version_id)?;
            Ok(to_js_value(version))
        })
    }

    /// 撤销软删除（ADR-0046 D10）：复活每个请求 id 及其下整棵软删子树，
    /// 返回 `HashMap<SyncTable, Vec<String>>` 的 JSON 串（与 delete_block_cascade 对称）。
    #[wasm_bindgen]
    pub fn undelete_blocks(ids_json: &str) -> Result<String, JsValue> {
        let ids: Vec<String> = serde_json::from_str(ids_json)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse ids: {}", e)))?;
        with_adapter(|adapter| {
            let sync_changes = BlockWriteService::undelete_blocks(adapter, &ids)?;
            serde_json::to_string(&sync_changes)
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)
        })
    }

    #[wasm_bindgen]
    pub fn cleanup_block_versions(retention_days: i64) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            BlockVersionService::cleanup(adapter, retention_days)?;
            Ok(to_js_value(json!({"success": true})))
        })
    }

    #[wasm_bindgen]
    pub fn delete_block_version(version_id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            BlockVersionService::delete(adapter, version_id)?;
            Ok(to_js_value(json!({"success": true})))
        })
    }

    // ---- Notifications（storage.notifications() 直调，与 Tauri commands.rs 同构） ----
    #[wasm_bindgen]
    pub fn get_notification(id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let notification = adapter.notifications().get_by_id(id)?;
            Ok(to_js_value(notification))
        })
    }

    #[wasm_bindgen]
    pub fn get_notifications_by_block(block_id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let notifications = adapter.notifications().get_by_block_id(block_id)?;
            Ok(to_js_value(notifications))
        })
    }

    #[wasm_bindgen]
    pub fn query_unread_notifications() -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let notifications = adapter.notifications().query_unread()?;
            Ok(to_js_value(notifications))
        })
    }

    #[wasm_bindgen]
    pub fn query_recent_notifications(limit: i64) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let notifications = adapter.notifications().query_recent(limit as usize)?;
            Ok(to_js_value(notifications))
        })
    }

    #[wasm_bindgen]
    pub fn create_notification(notification: &str) -> Result<JsValue, JsValue> {
        let notification: Notification = serde_json::from_str(notification)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse notification: {}", e)))?;
        with_adapter(|adapter| {
            let created = adapter.notifications().create(&notification)?;
            Ok(to_js_value(created))
        })
    }

    #[wasm_bindgen]
    pub fn batch_create_notifications(notifications: &str) -> Result<JsValue, JsValue> {
        let notifications: Vec<Notification> = serde_json::from_str(notifications)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse notifications: {}", e)))?;
        with_adapter(|adapter| {
            let created = adapter.notifications().batch_create(&notifications)?;
            Ok(to_js_value(created))
        })
    }

    #[wasm_bindgen]
    pub fn update_notification_status(id: &str, status: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let notification = adapter.notifications().update_status(id, status)?;
            Ok(to_js_value(notification))
        })
    }

    #[wasm_bindgen]
    pub fn update_notification_payload(id: &str, payload: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let notification = adapter.notifications().update_payload(id, payload)?;
            Ok(to_js_value(notification))
        })
    }

    #[wasm_bindgen]
    pub fn set_notification_snooze(id: &str, snooze_until: i64, status: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let notification = adapter.notifications().set_snooze(id, snooze_until, status)?;
            Ok(to_js_value(notification))
        })
    }

    #[wasm_bindgen]
    pub fn delete_notification(id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            adapter.notifications().delete(id)?;
            Ok(to_js_value(json!({"success": true})))
        })
    }

    #[wasm_bindgen]
    pub fn cleanup_notifications(timestamp: i64) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            adapter.notifications().delete_older_than(timestamp)?;
            Ok(to_js_value(json!({"success": true})))
        })
    }

    #[wasm_bindgen]
    pub fn mark_all_notifications_read() -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            adapter.notifications().mark_all_read()?;
            Ok(to_js_value(json!({"success": true})))
        })
    }

    // ---- Book highlights & progress（ADR-0040 D5/D6/D7：仅本地，不入 SyncTable） ----

    #[wasm_bindgen]
    pub fn upsert_book_highlight(highlight: &str) -> Result<JsValue, JsValue> {
        let highlight: BookHighlight = serde_json::from_str(highlight)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse highlight: {}", e)))?;
        with_adapter(|adapter| {
            let saved = BookService::upsert_highlight(adapter, &highlight)?;
            Ok(to_js_value(saved))
        })
    }

    #[wasm_bindgen]
    pub fn delete_book_highlight(id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            BookService::delete_highlight(adapter, id)?;
            Ok(to_js_value(json!({"success": true})))
        })
    }

    #[wasm_bindgen]
    pub fn get_book_highlights(book_page_id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let highlights = BookService::get_highlights(adapter, book_page_id)?;
            Ok(to_js_value(highlights))
        })
    }

    #[wasm_bindgen]
    pub fn get_book_progress(book_page_id: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let progress = BookService::get_progress(adapter, book_page_id)?;
            Ok(to_js_value(progress))
        })
    }

    #[wasm_bindgen]
    pub fn upsert_book_progress(book_page_id: &str, cfi: &str) -> Result<JsValue, JsValue> {
        with_adapter(|adapter| {
            let progress = BookService::upsert_progress(adapter, book_page_id, cfi)?;
            Ok(to_js_value(progress))
        })
    }
}
