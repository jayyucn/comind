use comind_core::{
    services::{BlockService, DateRefService, LinkService, PageService, PropertyService, RelationshipTypeService, BlockVersionService},
    storage::StorageAdapter,
    types::*,
};
use serde::{Deserialize, Serialize};
use std::error::Error;
use tauri::State;

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

fn execute_with_adapter<F, R>(
    db: State<'_, super::state::DatabaseConnection>,
    f: F,
) -> Result<R, String>
where
    F: FnOnce(&mut dyn StorageAdapter) -> Result<R, Box<dyn Error>>,
{
    let mut adapter = db.get_adapter()?;
    f(&mut *adapter).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_block(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: &str,
) -> Result<Block, String> {
    execute_with_adapter(db, |storage| BlockService::get_by_id(storage, block_id))
}

#[tauri::command]
pub async fn get_blocks_by_page(
    db: State<'_, super::state::DatabaseConnection>,
    page_id: &str,
) -> Result<Vec<Block>, String> {
    execute_with_adapter(db, |storage| BlockService::get_by_page_id(storage, page_id))
}

#[tauri::command]
pub async fn get_page(
    db: State<'_, super::state::DatabaseConnection>,
    page_id: &str,
) -> Result<Page, String> {
    execute_with_adapter(db, |storage| PageService::get_by_id(storage, page_id))
}

#[tauri::command]
pub async fn get_all_pages(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<Vec<Page>, String> {
    execute_with_adapter(db, |storage| PageService::get_all(storage))
}

#[tauri::command]
pub async fn get_backlinks(
    db: State<'_, super::state::DatabaseConnection>,
    page_id: &str,
) -> Result<Vec<Link>, String> {
    execute_with_adapter(db, |storage| {
        LinkService::get_by_target_page_id(storage, page_id)
    })
}

#[tauri::command]
pub async fn get_outlinks(
    db: State<'_, super::state::DatabaseConnection>,
    page_id: &str,
) -> Result<Vec<Link>, String> {
    execute_with_adapter(db, |storage| {
        let blocks = BlockService::get_by_page_id(storage, page_id)?;
        let mut outlinks = Vec::new();
        for block in blocks {
            let links = LinkService::get_by_source_block_id(storage, &block.id)?;
            outlinks.extend(links);
        }
        Ok(outlinks)
    })
}

#[tauri::command]
pub async fn search(
    db: State<'_, super::state::DatabaseConnection>,
    query: &str,
) -> Result<Vec<SearchResult>, String> {
    execute_with_adapter(db, |storage| storage.search().search(query, 20))
}

#[tauri::command]
pub async fn get_properties(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: &str,
) -> Result<Vec<Property>, String> {
    execute_with_adapter(db, |storage| {
        PropertyService::get_by_block_id(storage, block_id)
    })
}

#[tauri::command]
pub async fn get_relationship_types(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<Vec<RelationshipType>, String> {
    execute_with_adapter(db, |storage| RelationshipTypeService::get_all(storage))
}

#[tauri::command]
pub async fn query_date_refs(
    db: State<'_, super::state::DatabaseConnection>,
    kind: String,
    from: String,
    to: String,
) -> Result<Vec<DateRef>, String> {
    execute_with_adapter(db, |storage| {
        let refs = DateRefService::query_by_date_range(storage, &kind, &from, &to)?;
        Ok(refs)
    })
}

#[tauri::command]
pub async fn query_overdue_date_refs(
    db: State<'_, super::state::DatabaseConnection>,
    today: String,
) -> Result<Vec<DateRef>, String> {
    execute_with_adapter(db, |storage| {
        let refs = DateRefService::query_overdue(storage, &today)?;
        Ok(refs)
    })
}

#[tauri::command]
pub async fn get_date_refs_by_block(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: String,
) -> Result<Vec<DateRef>, String> {
    execute_with_adapter(db, |storage| {
        let refs = DateRefService::get_by_block(storage, &block_id)?;
        Ok(refs)
    })
}

#[tauri::command]
pub async fn rebuild_date_refs(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<String, String> {
    execute_with_adapter(db, |storage| {
        let count = DateRefService::rebuild_all(storage)?;
        Ok(format!("{{\"rebuilt\":{}}}", count))
    })
}

#[tauri::command]
pub async fn save_block_tree(
    db: State<'_, super::state::DatabaseConnection>,
    blocks: Vec<serde_json::Value>,
) -> Result<Vec<Block>, String> {
    execute_with_adapter(db, |storage| {
        let mut results = Vec::new();
        let mut page_ids = std::collections::HashSet::new();
        
        for block_json in blocks {
            let block: Block = serde_json::from_value(block_json)
                .map_err(|e| format!("Failed to parse block: {}", e))?;
            page_ids.insert(block.page_id.clone());
            let existing = BlockService::get_by_id(storage, &block.id);
            let result = match existing {
                Ok(_) => BlockService::update(
                    storage,
                    &block.id,
                    Some(&block.content),
                    Some(&block.format),
                    Some(&block.r#type),
                    block.parent_id.as_deref(),
                    Some(block.pos),
                ),
                Err(_) => BlockService::create(
                    storage,
                    &block.page_id,
                    block.parent_id.as_deref(),
                    &block.content,
                    &block.format,
                    &block.r#type,
                    Some(&block.id),
                ),
            };
            results.push(result?);
        }
        
        for page_id in page_ids {
            let _ = PageService::update(
                storage,
                &page_id,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            );
        }
        
        Ok(results)
    })
}

#[tauri::command]
pub async fn delete_block(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: &str,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| {
        if let Ok(block) = storage.blocks().get_by_id(block_id) {
            storage.links().delete_by_source_block_id(block_id)?;
            storage.properties().delete_by_block_id(block_id)?;
            // BlockVersion has FK (block_id) RESTRICT — must delete before Block
            storage.block_versions().delete_by_block_id(block_id)?;
            storage.blocks().delete(block_id)?;
            let _ = PageService::update(
                storage,
                &block.page_id,
                None, None, None, None, None, None, None, None,
            );
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn save_page(
    db: State<'_, super::state::DatabaseConnection>,
    page: serde_json::Value,
) -> Result<Page, String> {
    execute_with_adapter(db, |storage| {
        let update: PageUpdate =
            serde_json::from_value(page).map_err(|e| format!("Failed to parse page: {}", e))?;
        match update.id {
            Some(id) => {
                let existing = storage.pages().get_by_id(&id);
                match existing {
                    Ok(_) => PageService::update(
                        storage,
                        &id,
                        Some(&update.title),
                        Some(&update.r#type),
                        update.icon.as_deref(),
                        update.cover.as_deref(),
                        Some(&update.aliases),
                        update.file_path.as_deref(),
                        update.children_count.or(Some(0)),
                        update.word_count.or(Some(0)),
                    ),
                    Err(_) => PageService::create(
                        storage,
                        update.block_id.as_deref().unwrap_or(""),
                        &update.title,
                        Some(&update.r#type),
                        update.icon.as_deref(),
                        update.cover.as_deref(),
                        Some(&update.aliases),
                        update.file_path.as_deref(),
                    ),
                }
            }
            None => PageService::create(
                storage,
                update.block_id.as_deref().unwrap_or(""),
                &update.title,
                Some(&update.r#type),
                update.icon.as_deref(),
                update.cover.as_deref(),
                Some(&update.aliases),
                update.file_path.as_deref(),
            ),
        }
    })
}

#[tauri::command]
pub async fn delete_page_cascade(
    db: State<'_, super::state::DatabaseConnection>,
    page_id: &str,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| {
        let blocks = BlockService::get_by_page_id(storage, page_id)?;
        for block in &blocks {
            storage.properties().delete_by_block_id(&block.id)?;
            storage.links().delete_by_source_block_id(&block.id)?;
            // BlockVersion has FK (block_id) RESTRICT — must delete before Block
            storage.block_versions().delete_by_block_id(&block.id)?;
        }
        LinkService::delete_by_target_page_id(storage, page_id)?;
        BlockService::delete_by_page_id(storage, page_id)?;
        PageService::delete(storage, page_id)?;
        Ok(())
    })
}

#[tauri::command]
pub async fn set_property(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: &str,
    key: &str,
    value: &str,
    type_: &str,
) -> Result<Property, String> {
    execute_with_adapter(db, |storage| {
        let existing = PropertyService::get_by_block_id_and_key(storage, block_id, key)?;
        let result = match existing {
            Some(mut prop) => {
                prop.value = value.to_string();
                prop.r#type = type_.to_string();
                prop.updated_at = chrono::Utc::now().timestamp_millis();
                storage.properties().update(&prop)
            }
            None => PropertyService::create(storage, block_id, key, value, type_, 0, 0, 1),
        };
        
        if let Ok(block) = storage.blocks().get_by_id(block_id) {
            let _ = PageService::update(
                storage,
                &block.page_id,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            );
        }
        
        result
    })
}

#[tauri::command]
pub async fn delete_property(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: &str,
    key: &str,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| {
        if let Some(prop) = PropertyService::get_by_block_id_and_key(storage, block_id, key)? {
            storage.properties().delete(&prop.id)?;
        }
        
        if let Ok(block) = storage.blocks().get_by_id(block_id) {
            let _ = PageService::update(
                storage,
                &block.page_id,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            );
        }
        
        Ok(())
    })
}

#[tauri::command]
pub async fn get_db_path(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<String, String> {
    Ok(db.get_db_path())
}

#[tauri::command]
pub async fn set_db_path(
    config_manager: State<'_, super::state::ConfigManager>,
    config_dir: State<'_, std::path::PathBuf>,
    path: &str,
) -> Result<String, String> {
    let new_path = std::path::PathBuf::from(path);
    if !new_path.exists() {
        std::fs::create_dir_all(&new_path)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    let mut config = super::config::AppConfig::load(&config_dir).unwrap_or_default();
    config.database_path = Some(path.to_string());
    config
        .save(&config_dir)
        .map_err(|e| format!("Failed to save config: {}", e))?;
    
    config_manager.update_config(config)?;
    Ok(path.to_string())
}

#[tauri::command]
pub async fn reset_db_path(
    config_manager: State<'_, super::state::ConfigManager>,
    config_dir: State<'_, std::path::PathBuf>,
) -> Result<String, String> {
    let mut config = super::config::AppConfig::load(&config_dir).unwrap_or_default();
    config.database_path = None;
    config
        .save(&config_dir)
        .map_err(|e| format!("Failed to save config: {}", e))?;
    
    config_manager.update_config(config)?;
    Ok("default".to_string())
}

#[tauri::command]
pub async fn execute_batch(
    db: State<'_, super::state::DatabaseConnection>,
    operations: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    execute_with_adapter(db, |storage| {
        let mut results = Vec::new();
        let mut page_ids = std::collections::HashSet::new();
        
        for op in operations {
            let entity: String = op
                .get("entity")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let action: String = op
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let params = op.get("params").cloned().unwrap_or_default();

            let result = match (entity.as_str(), action.as_str()) {
                ("block", "create") => {
                    let block: Block = serde_json::from_value(params)?;
                    page_ids.insert(block.page_id.clone());
                    let result = storage.blocks().create(&block)?;
                    serde_json::to_value(result)?
                }
                ("block", "update") => {
                    let block: Block = serde_json::from_value(params)?;
                    page_ids.insert(block.page_id.clone());
                    let result = storage.blocks().update(&block)?;
                    serde_json::to_value(result)?
                }
                ("block", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    if let Ok(block) = storage.blocks().get_by_id(&id) {
                        page_ids.insert(block.page_id);
                    }
                    storage.links().delete_by_source_block_id(&id)?;
                    storage.properties().delete_by_block_id(&id)?;
                    // BlockVersion has FK (block_id) RESTRICT — must delete before Block
                    storage.block_versions().delete_by_block_id(&id)?;
                    storage.blocks().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("page", "create") => {
                    let page: Page = serde_json::from_value(params)?;
                    let result = storage.pages().create(&page)?;
                    serde_json::to_value(result)?
                }
                ("page", "update") => {
                    let page: Page = serde_json::from_value(params)?;
                    let result = storage.pages().update(&page)?;
                    serde_json::to_value(result)?
                }
                ("page", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    storage.pages().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("link", "create") => {
                    let link: Link = serde_json::from_value(params)?;
                    let result = storage.links().create(&link)?;
                    serde_json::to_value(result)?
                }
                ("link", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    storage.links().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("link", "sync_by_block") => {
                    let block_id: String = params
                        .get("block_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    let links_data = params
                        .get("links")
                        .and_then(|v| v.as_array())
                        .cloned()
                        .unwrap_or_default();
                    LinkService::delete_by_source_block_id(storage, &block_id)?;
                    let mut created = Vec::new();
                    for link_data in links_data {
                        let source_block_id = link_data.get("source_block_id").and_then(|v| v.as_str()).unwrap_or("");
                        let target_page_id = link_data.get("target_page_id").and_then(|v| v.as_str()).unwrap_or("");
                        let display_text = link_data.get("display_text").and_then(|v| v.as_str()).unwrap_or("");
                        let relationship_type = link_data.get("relationship_type").and_then(|v| v.as_str());
                        let new_link = LinkService::create(
                            storage,
                            source_block_id,
                            target_page_id,
                            display_text,
                            relationship_type,
                        )?;
                        created.push(new_link);
                    }
                    serde_json::to_value(created)?
                }
                ("property", "create") => {
                    let prop: Property = serde_json::from_value(params)?;
                    let result = storage.properties().create(&prop)?;
                    serde_json::to_value(result)?
                }
                ("property", "update") => {
                    let prop: Property = serde_json::from_value(params)?;
                    let result = storage.properties().update(&prop)?;
                    serde_json::to_value(result)?
                }
                ("property", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    storage.properties().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("relationship_type", "create") => {
                    let rt: RelationshipType = serde_json::from_value(params)?;
                    let result = storage.relationship_types().create(&rt)?;
                    serde_json::to_value(result)?
                }
                ("relationship_type", "update") => {
                    let rt: RelationshipType = serde_json::from_value(params)?;
                    let result = storage.relationship_types().update(&rt)?;
                    serde_json::to_value(result)?
                }
                ("relationship_type", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    storage.relationship_types().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("template", "create") => {
                    let template: UserTemplate = serde_json::from_value(params)?;
                    let result = storage.templates().create(&template)?;
                    serde_json::to_value(result)?
                }
                ("template", "update") => {
                    let template: UserTemplate = serde_json::from_value(params)?;
                    let result = storage.templates().update(&template)?;
                    serde_json::to_value(result)?
                }
                ("template", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    storage.templates().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                _ => serde_json::to_value(format!("Unknown operation: {} {}", entity, action))?,
            };
            results.push(result);
        }
        
        for page_id in page_ids {
            let _ = PageService::update(
                storage,
                &page_id,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            );
        }
        
        Ok(results)
    })
}

#[tauri::command]
pub async fn export_to_markdown(
    db: State<'_, super::state::DatabaseConnection>,
    directory: &str,
) -> Result<super::markdown::ExportResult, String> {
    let dir = std::path::Path::new(directory);
    execute_with_adapter(db, |storage| super::markdown::export_all(storage, dir))
}

#[tauri::command]
pub async fn import_from_markdown(
    db: State<'_, super::state::DatabaseConnection>,
    directory: &str,
    strategy: &str,
) -> Result<super::markdown::ImportResult, String> {
    let dir = std::path::Path::new(directory);
    execute_with_adapter(db, |storage| super::markdown::import_all(storage, dir, strategy))
}

#[tauri::command]
pub async fn get_sync_config(
    config_manager: State<'_, super::state::ConfigManager>,
) -> Result<serde_json::Value, String> {
    let config = config_manager.get_config()?;
    serde_json::to_value(&*config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_sync_config(
    config_manager: State<'_, super::state::ConfigManager>,
    config_dir: State<'_, std::path::PathBuf>,
    enabled: bool,
    directory: Option<String>,
    interval_secs: Option<u64>,
) -> Result<(), String> {
    let mut config = super::config::AppConfig::load(&config_dir).unwrap_or_default();
    config.sync_enabled = enabled;
    config.sync_directory = directory;
    if let Some(interval) = interval_secs {
        config.sync_interval_secs = interval;
    }
    config.save(&config_dir).map_err(|e| e.to_string())?;
    
    config_manager.update_config(config)?;
    Ok(())
}

#[tauri::command]
pub async fn sync_now(
    db: State<'_, super::state::DatabaseConnection>,
    config_manager: State<'_, super::state::ConfigManager>,
) -> Result<super::markdown::ExportResult, String> {
    let config = config_manager.get_config()?;
    let sync_dir = match &config.sync_directory {
        Some(d) => d.clone(),
        None => return Err("Sync directory not configured".to_string()),
    };
    let dir = std::path::Path::new(&sync_dir);
    execute_with_adapter(db, |storage| super::markdown::export_all(storage, dir))
}

#[tauri::command]
pub async fn trigger_sync(
    db: State<'_, super::state::DatabaseConnection>,
    config_manager: State<'_, super::state::ConfigManager>,
) -> Result<super::markdown::ExportResult, String> {
    let config = config_manager.get_config()?;
    let sync_dir = match &config.sync_directory {
        Some(d) => d.clone(),
        None => return Err("Sync directory not configured".to_string()),
    };
    let dir = std::path::Path::new(&sync_dir);
    execute_with_adapter(db, |storage| super::markdown::export_changed(storage, dir))
}

#[tauri::command]
pub async fn create_block_version(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: &str,
    snapshot: &str,
    hash: &str,
    reason: &str,
    checkpoint_name: Option<String>,
) -> Result<BlockVersion, String> {
    execute_with_adapter(db, |storage| {
        BlockVersionService::create(storage, block_id, snapshot, hash, reason, checkpoint_name.as_deref(), None)
    })
}

#[tauri::command]
pub async fn get_block_versions(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: &str,
) -> Result<Vec<BlockVersion>, String> {
    execute_with_adapter(db, |storage| {
        BlockVersionService::list(storage, block_id)
    })
}

#[tauri::command]
pub async fn get_block_version_by_id(
    db: State<'_, super::state::DatabaseConnection>,
    id: &str,
) -> Result<BlockVersion, String> {
    execute_with_adapter(db, |storage| BlockVersionService::get_by_id(storage, id))
}

#[tauri::command]
pub async fn restore_block_version(
    db: State<'_, super::state::DatabaseConnection>,
    version_id: &str,
) -> Result<BlockVersion, String> {
    let mut adapter = db.get_adapter()?;
    BlockVersionService::restore(&mut *adapter, version_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cleanup_block_versions(
    db: State<'_, super::state::DatabaseConnection>,
    retention_days: i64,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| BlockVersionService::cleanup(storage, retention_days))
}

#[tauri::command]
pub async fn delete_block_version(
    db: State<'_, super::state::DatabaseConnection>,
    version_id: &str,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| BlockVersionService::delete(storage, version_id))
}

#[tauri::command]
pub async fn get_notification(
    db: State<'_, super::state::DatabaseConnection>,
    id: &str,
) -> Result<Notification, String> {
    execute_with_adapter(db, |storage| storage.notifications().get_by_id(id))
}

#[tauri::command]
pub async fn get_notifications_by_block(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: &str,
) -> Result<Vec<Notification>, String> {
    execute_with_adapter(db, |storage| storage.notifications().get_by_block_id(block_id))
}

#[tauri::command]
pub async fn query_unread_notifications(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<Vec<Notification>, String> {
    execute_with_adapter(db, |storage| storage.notifications().query_unread())
}

#[tauri::command]
pub async fn query_recent_notifications(
    db: State<'_, super::state::DatabaseConnection>,
    limit: usize,
) -> Result<Vec<Notification>, String> {
    execute_with_adapter(db, |storage| storage.notifications().query_recent(limit))
}

#[tauri::command]
pub async fn create_notification(
    db: State<'_, super::state::DatabaseConnection>,
    notification: Notification,
) -> Result<Notification, String> {
    execute_with_adapter(db, |storage| storage.notifications().create(&notification))
}

#[tauri::command]
pub async fn batch_create_notifications(
    db: State<'_, super::state::DatabaseConnection>,
    notifications: Vec<Notification>,
) -> Result<Vec<Notification>, String> {
    execute_with_adapter(db, |storage| storage.notifications().batch_create(&notifications))
}

#[tauri::command]
pub async fn update_notification_status(
    db: State<'_, super::state::DatabaseConnection>,
    id: &str,
    status: &str,
) -> Result<Notification, String> {
    execute_with_adapter(db, |storage| storage.notifications().update_status(id, status))
}

#[tauri::command]
pub async fn update_notification_payload(
    db: State<'_, super::state::DatabaseConnection>,
    id: &str,
    payload: &str,
) -> Result<Notification, String> {
    execute_with_adapter(db, |storage| storage.notifications().update_payload(id, payload))
}

#[tauri::command]
pub async fn set_notification_snooze(
    db: State<'_, super::state::DatabaseConnection>,
    id: &str,
    snooze_until: i64,
    status: &str,
) -> Result<Notification, String> {
    execute_with_adapter(db, |storage| storage.notifications().set_snooze(id, snooze_until, status))
}

#[tauri::command]
pub async fn delete_notification(
    db: State<'_, super::state::DatabaseConnection>,
    id: &str,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| storage.notifications().delete(id))
}

#[tauri::command]
pub async fn cleanup_notifications(
    db: State<'_, super::state::DatabaseConnection>,
    timestamp: i64,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| storage.notifications().delete_older_than(timestamp))
}

#[tauri::command]
pub async fn mark_all_notifications_read(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| storage.notifications().mark_all_read())
}
