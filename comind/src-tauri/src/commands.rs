use comind_core::{
    services::{BlockService, LinkService, PageService, PropertyService, RelationshipTypeService},
    storage::StorageAdapter,
    types::*,
};
use std::error::Error;
use tauri::State;

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
pub async fn save_block_tree(
    db: State<'_, super::state::DatabaseConnection>,
    blocks: Vec<serde_json::Value>,
) -> Result<Vec<Block>, String> {
    execute_with_adapter(db, |storage| {
        let mut results = Vec::new();
        for block_json in blocks {
            let block: Block = serde_json::from_value(block_json)
                .map_err(|e| format!("Failed to parse block: {}", e))?;
            let existing = storage.blocks().get_by_id(&block.id);
            let result = match existing {
                Ok(_) => storage.blocks().update(&block),
                Err(_) => storage.blocks().create(&block),
            };
            results.push(result?);
        }
        Ok(results)
    })
}

#[tauri::command]
pub async fn save_page(
    db: State<'_, super::state::DatabaseConnection>,
    page: serde_json::Value,
) -> Result<Page, String> {
    execute_with_adapter(db, |storage| {
        let page: Page =
            serde_json::from_value(page).map_err(|e| format!("Failed to parse page: {}", e))?;
        let existing = storage.pages().get_by_id(&page.id);
        match existing {
            Ok(_) => PageService::update(
                storage,
                &page.id,
                Some(&page.title),
                Some(&page.r#type),
                page.icon.as_deref(),
                page.cover.as_deref(),
                Some(&page.aliases),
                page.file_path.as_deref(),
                Some(page.children_count),
                Some(page.word_count),
            ),
            Err(_) => PageService::create(
                storage,
                page.block_id.as_deref().unwrap_or(""),
                &page.title,
                Some(&page.r#type),
                page.icon.as_deref(),
                page.cover.as_deref(),
                Some(&page.aliases),
                page.file_path.as_deref(),
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
        storage.properties().delete_by_block_id(page_id)?;
        storage.links().delete_by_source_block_id(page_id)?;
        storage.blocks().delete_by_page_id(page_id)?;
        storage.pages().delete(page_id)?;
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
        match existing {
            Some(mut prop) => {
                prop.value = value.to_string();
                prop.r#type = type_.to_string();
                prop.updated_at = chrono::Utc::now().timestamp_millis();
                storage.properties().update(&prop)
            }
            None => PropertyService::create(storage, block_id, key, value, type_, 0, 0, 1),
        }
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
    _app_config: State<'_, super::config::AppConfig>,
    config_dir: State<'_, std::path::PathBuf>,
    path: &str,
) -> Result<String, String> {
    let new_path = std::path::PathBuf::from(path);
    if !new_path.exists() {
        std::fs::create_dir_all(&new_path)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    let config = super::config::AppConfig {
        database_path: Some(path.to_string()),
    };
    config
        .save(&config_dir)
        .map_err(|e| format!("Failed to save config: {}", e))?;
    Ok(path.to_string())
}

#[tauri::command]
pub async fn reset_db_path(
    _app_config: State<'_, super::config::AppConfig>,
    config_dir: State<'_, std::path::PathBuf>,
) -> Result<String, String> {
    let config = super::config::AppConfig {
        database_path: None,
    };
    config
        .save(&config_dir)
        .map_err(|e| format!("Failed to save config: {}", e))?;
    Ok("default".to_string())
}

#[tauri::command]
pub async fn execute_batch(
    db: State<'_, super::state::DatabaseConnection>,
    operations: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    execute_with_adapter(db, |storage| {
        let mut results = Vec::new();
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
                    let result = storage.blocks().create(&block)?;
                    serde_json::to_value(result)?
                }
                ("block", "update") => {
                    let block: Block = serde_json::from_value(params)?;
                    let result = storage.blocks().update(&block)?;
                    serde_json::to_value(result)?
                }
                ("block", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
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
        Ok(results)
    })
}
