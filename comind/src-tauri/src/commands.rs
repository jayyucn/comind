use comind_core::{
    services::{
        BlockService, BlockVersionService, DateRefService, LinkService, PageService,
        PropertyService, RelationshipTypeService,
    },
    storage::StorageAdapter,
    types::*,
    sync::message::SyncTable,
};
use serde::{Deserialize, Serialize};
use std::error::Error;
use tauri::{AppHandle, State};

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

async fn execute_with_adapter<F, R>(
    db: State<'_, super::state::DatabaseConnection>,
    f: F,
) -> Result<R, String>
where
    F: FnOnce(&mut dyn StorageAdapter) -> Result<R, Box<dyn Error>>,
{
    let adapter_arc = db.adapter_arc();
    let mut adapter = adapter_arc.lock().await;
    f(&mut *adapter).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_block(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: &str,
) -> Result<Block, String> {
    execute_with_adapter(db, |storage| BlockService::get_by_id(storage, block_id)).await
}

#[tauri::command]
pub async fn get_blocks_by_page(
    db: State<'_, super::state::DatabaseConnection>,
    page_id: &str,
) -> Result<Vec<Block>, String> {
    execute_with_adapter(db, |storage| BlockService::get_by_page_id(storage, page_id)).await
}

#[tauri::command]
pub async fn get_page(
    db: State<'_, super::state::DatabaseConnection>,
    page_id: &str,
) -> Result<Page, String> {
    execute_with_adapter(db, |storage| PageService::get_by_id(storage, page_id)).await
}

#[tauri::command]
pub async fn get_all_pages(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<Vec<Page>, String> {
    execute_with_adapter(db, |storage| PageService::get_all(storage)).await
}

#[tauri::command]
pub async fn get_ideas_pages_by_month(
    db: State<'_, super::state::DatabaseConnection>,
    year: i32,
    month: u32,
) -> Result<Vec<Page>, String> {
    execute_with_adapter(db, |storage| {
        PageService::get_ideas_by_month(storage, year, month)
    }).await
}

#[tauri::command]
pub async fn get_ideas_months(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<Vec<String>, String> {
    execute_with_adapter(db, |storage| {
        PageService::get_ideas_months(storage)
    }).await
}

/// 幂等地获取或创建今日 Ideas 页面（单一事实来源：Rust 端）
///
/// - 多次调用效果一致：已存在则返回现有页面，不存在则创建
/// - 创建后会异步通知 SyncServer（sync 本身幂等，已存在时通知也无副作用）
#[tauri::command]
pub async fn ensure_today_ideas_page(
    db: State<'_, super::state::DatabaseConnection>,
    sync_server: State<'_, super::state::SyncServerHandle>,
) -> Result<Page, String> {
    let result = execute_with_adapter(db, |storage| {
        PageService::ensure_today_ideas_page(storage)
    })
    .await;

    if let Ok(ref page) = result {
        let sync_server_clone = sync_server.inner().clone();
        let page_id = page.id.clone();
        tokio::spawn(async move {
            sync_server_clone
                .record_and_notify(SyncTable::Page, vec![page_id])
                .await;
        });
    }

    result
}

#[tauri::command]
pub async fn get_backlinks(
    db: State<'_, super::state::DatabaseConnection>,
    page_id: &str,
) -> Result<Vec<Link>, String> {
    execute_with_adapter(db, |storage| {
        LinkService::get_by_target_page_id(storage, page_id)
    }).await
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
    }).await
}

#[tauri::command]
pub async fn search(
    db: State<'_, super::state::DatabaseConnection>,
    query: &str,
) -> Result<Vec<SearchResult>, String> {
    execute_with_adapter(db, |storage| storage.search().search(query, 20)).await
}

#[tauri::command]
pub async fn get_properties(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: &str,
) -> Result<Vec<Property>, String> {
    execute_with_adapter(db, |storage| {
        PropertyService::get_by_block_id(storage, block_id)
    }).await
}

#[tauri::command]
pub async fn get_relationship_types(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<Vec<RelationshipType>, String> {
    execute_with_adapter(db, |storage| RelationshipTypeService::get_all(storage)).await
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
    }).await
}

#[tauri::command]
pub async fn query_overdue_date_refs(
    db: State<'_, super::state::DatabaseConnection>,
    today: String,
) -> Result<Vec<DateRef>, String> {
    execute_with_adapter(db, |storage| {
        let refs = DateRefService::query_overdue(storage, &today)?;
        Ok(refs)
    }).await
}

#[tauri::command]
pub async fn get_date_refs_by_block(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: String,
) -> Result<Vec<DateRef>, String> {
    execute_with_adapter(db, |storage| {
        let refs = DateRefService::get_by_block(storage, &block_id)?;
        Ok(refs)
    }).await
}

#[tauri::command]
pub async fn query_due_non_recurring_date_refs(
    db: State<'_, super::state::DatabaseConnection>,
    now_ms: i64,
) -> Result<Vec<DateRef>, String> {
    execute_with_adapter(db, |storage| {
        let refs = DateRefService::query_due_non_recurring(storage, now_ms)?;
        Ok(refs)
    }).await
}

#[tauri::command]
pub async fn query_all_recurring_date_refs(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<Vec<DateRef>, String> {
    execute_with_adapter(db, |storage| {
        let refs = DateRefService::query_all_recurring(storage)?;
        Ok(refs)
    }).await
}

#[tauri::command]
pub async fn query_incomplete_tasks(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<Vec<IncompleteTask>, String> {
    execute_with_adapter(db, |storage| {
        // 1. 查 status=Todo/Doing 的 block_ids
        let statuses = vec!["Todo".to_string(), "Doing".to_string()];
        let block_ids = PropertyService::query_block_ids_by_key_value(storage, "status", &statuses)?;
        if block_ids.is_empty() {
            return Ok(Vec::new());
        }
        // 2. 批量获取 blocks
        let blocks = comind_core::storage::repository::BlockRepository::get_by_ids(storage.blocks(), &block_ids)?;
        // 3. 对每个 block 查 page，过滤 type=ideas
        let mut tasks: Vec<IncompleteTask> = Vec::new();
        for block in blocks {
            let page = match PageService::get_by_id(storage, &block.page_id) {
                Ok(p) => p,
                Err(_) => continue,
            };
            if page.r#type != "ideas" {
                continue;
            }
            tasks.push(IncompleteTask {
                id: block.id,
                page_id: block.page_id,
                parent_id: block.parent_id,
                pos: block.pos,
                content: block.content,
                r#format: block.r#format,
                r#type: block.r#type,
                created_at: block.created_at,
                updated_at: block.updated_at,
                version: block.version,
                deleted_at: block.deleted_at,
                page_title: page.title,
                page_type: page.r#type,
            });
        }
        Ok(tasks)
    }).await
}

/// Batch data for checkAndFire: returns all recurring dateRefs + their blocks + pages + existing notifications
/// in a single IPC call, replacing N×4 sequential IPC calls.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchCheckAndFireData {
    pub recurring_refs: Vec<DateRef>,
    pub due_non_recurring: Vec<DateRef>,
    pub blocks: Vec<Block>,
    pub pages: Vec<Page>,
    pub notifications: Vec<Notification>,
}

#[tauri::command]
pub async fn batch_check_and_fire_data(
    db: State<'_, super::state::DatabaseConnection>,
    now_ms: i64,
) -> Result<BatchCheckAndFireData, String> {
    execute_with_adapter(db, |storage| {
        let recurring_refs = DateRefService::query_all_recurring(storage)?;
        let due_non_recurring = DateRefService::query_due_non_recurring(storage, now_ms)?;

        // Collect all unique block_ids from dateRefs
        let mut block_ids: Vec<String> = Vec::new();
        for r in recurring_refs.iter().chain(due_non_recurring.iter()) {
            if !block_ids.contains(&r.block_id) {
                block_ids.push(r.block_id.clone());
            }
        }

        // Batch fetch blocks and notifications by block_ids
        let blocks = storage.blocks().get_by_ids(&block_ids)?;
        let notifications = storage.notifications().get_by_block_ids(&block_ids)?;

        // Extract page_ids from blocks, then batch fetch pages
        let mut page_ids: Vec<String> = Vec::new();
        for b in &blocks {
            if !page_ids.contains(&b.page_id) {
                page_ids.push(b.page_id.clone());
            }
        }
        let pages = storage.pages().get_by_ids(&page_ids)?;

        Ok(BatchCheckAndFireData {
            recurring_refs,
            due_non_recurring,
            blocks,
            pages,
            notifications,
        })
    }).await
}

/// 图谱快照：一次 SQL JOIN 返回所有页面间边关系
/// 前端无需 N×3 次 IPC，1 次调用即可构建完整图谱
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdgeRecord {
    pub link_id: String,
    pub source_page_id: String,
    pub source_page_title: String,
    pub target_page_id: String,
    pub target_page_title: String,
    pub relationship_type: Option<String>,
}

#[tauri::command]
pub async fn build_graph_snapshot(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<Vec<GraphEdgeRecord>, String> {
    let adapter_arc = db.adapter_arc();
    let adapter = adapter_arc.lock().await;
    let mut stmt = adapter.conn.prepare(
        "SELECT l.id, b.page_id, p.title, l.target_page_id, p2.title, l.relationship_type
         FROM Link l
         JOIN Block b ON l.source_block_id = b.id
         JOIN Page p ON b.page_id = p.id
         JOIN Page p2 ON l.target_page_id = p2.id
         WHERE l.deleted_at IS NULL
           AND p.deleted = 0 AND p.deleted_at IS NULL
           AND p2.deleted = 0 AND p2.deleted_at IS NULL"
    ).map_err(|e| e.to_string())?;
    let edges = stmt.query_map([], |row| {
        Ok(GraphEdgeRecord {
            link_id: row.get(0)?,
            source_page_id: row.get(1)?,
            source_page_title: row.get(2)?,
            target_page_id: row.get(3)?,
            target_page_title: row.get(4)?,
            relationship_type: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    Ok(edges)
}

#[tauri::command]
pub async fn rebuild_date_refs(
    db: State<'_, super::state::DatabaseConnection>,
    sync_server: State<'_, super::state::SyncServerHandle>,
) -> Result<String, String> {
    let mut date_ref_ids: Vec<String> = Vec::new();
    let result = execute_with_adapter(db, |storage| {
        let count = DateRefService::rebuild_all(storage)?;
        let refs = storage.date_refs().get_all()?;
        date_ref_ids = refs.into_iter().map(|r| r.id).collect();
        Ok(format!("{{\"rebuilt\":{}}}", count))
    }).await;
    
    if result.is_ok() {
        let sync_server_clone = sync_server.inner().clone();
        tokio::spawn(async move {
            sync_server_clone.record_and_notify(SyncTable::DateRef, date_ref_ids).await;
        });
    }
    
    result
}

#[tauri::command]
pub async fn save_block_tree(
    db: State<'_, super::state::DatabaseConnection>,
    sync_server: State<'_, super::state::SyncServerHandle>,
    blocks: Vec<serde_json::Value>,
) -> Result<Vec<Block>, String> {
    let block_ids: Vec<String> = blocks.iter()
        .filter_map(|b| b.get("id").and_then(|v| v.as_str()))
        .map(|s| s.to_string())
        .collect();
    
    let result = execute_with_adapter(db, |storage| {
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
                storage, &page_id, None, None, None, None, None, None, None, None,
            );
        }

        Ok(results)
    }).await;
    
    if result.is_ok() {
        let sync_server_clone = sync_server.inner().clone();
        tokio::spawn(async move {
            sync_server_clone.record_and_notify(SyncTable::Block, block_ids).await;
        });
    }
    
    result
}

#[tauri::command]
pub async fn delete_block(
    db: State<'_, super::state::DatabaseConnection>,
    sync_server: State<'_, super::state::SyncServerHandle>,
    block_id: &str,
) -> Result<(), String> {
    let block_id_clone = block_id.to_string();
    
    // Collect cascade-deleted IDs for sync notification
    let mut cascade_link_ids: Vec<String> = Vec::new();
    let mut cascade_prop_ids: Vec<String> = Vec::new();
    
    let result = execute_with_adapter(db, |storage| {
        if let Ok(block) = storage.blocks().get_by_id(block_id) {
            // Collect cascade-deleted link IDs before deleting
            let links = storage.links().get_by_source_block_id(block_id)?;
            cascade_link_ids = links.into_iter().map(|l| l.id).collect();
            storage.links().delete_by_source_block_id(block_id)?;
            
            // Collect cascade-deleted property IDs before deleting
            let props = storage.properties().get_by_block_id(block_id)?;
            cascade_prop_ids = props.into_iter().map(|p| p.id).collect();
            storage.properties().delete_by_block_id(block_id)?;
            
            // BlockVersion has FK (block_id) RESTRICT — must delete before Block
            storage.block_versions().delete_by_block_id(block_id)?;
            storage.blocks().delete(block_id)?;
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
    }).await;
    
    if result.is_ok() {
        let sync_server_clone = sync_server.inner().clone();
        tokio::spawn(async move {
            sync_server_clone.record_and_notify(SyncTable::Block, vec![block_id_clone]).await;
            if !cascade_link_ids.is_empty() {
                sync_server_clone.record_and_notify(SyncTable::Link, cascade_link_ids).await;
            }
            if !cascade_prop_ids.is_empty() {
                sync_server_clone.record_and_notify(SyncTable::Property, cascade_prop_ids).await;
            }
        });
    }
    
    result
}

#[tauri::command]
pub async fn save_page(
    db: State<'_, super::state::DatabaseConnection>,
    sync_server: State<'_, super::state::SyncServerHandle>,
    page: serde_json::Value,
) -> Result<Page, String> {
    let page_id: Option<String> = page.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
    
    let result = execute_with_adapter(db, |storage| {
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
    }).await;
    
    if result.is_ok() && page_id.is_some() {
        let sync_server_clone = sync_server.inner().clone();
        let page_id_value = page_id.unwrap();
        tokio::spawn(async move {
            sync_server_clone.record_and_notify(SyncTable::Page, vec![page_id_value]).await;
        });
    }
    
    result
}

#[tauri::command]
pub async fn delete_page_cascade(
    db: State<'_, super::state::DatabaseConnection>,
    sync_server: State<'_, super::state::SyncServerHandle>,
    page_id: &str,
) -> Result<(), String> {
    let page_id_clone = page_id.to_string();
    
    // Collect cascade-deleted IDs for sync notification
    let mut cascade_block_ids: Vec<String> = Vec::new();
    let mut cascade_link_ids: Vec<String> = Vec::new();
    let mut cascade_prop_ids: Vec<String> = Vec::new();
    let mut cascade_target_link_ids: Vec<String> = Vec::new();
    
    let result = execute_with_adapter(db, |storage| {
        let blocks = BlockService::get_by_page_id(storage, page_id)?;
        for block in &blocks {
            // Collect block ID
            cascade_block_ids.push(block.id.clone());
            
            // Collect cascade-deleted link IDs
            let links = storage.links().get_by_source_block_id(&block.id)?;
            cascade_link_ids.extend(links.into_iter().map(|l| l.id));
            
            // Collect cascade-deleted property IDs
            let props = storage.properties().get_by_block_id(&block.id)?;
            cascade_prop_ids.extend(props.into_iter().map(|p| p.id));
            
            storage.properties().delete_by_block_id(&block.id)?;
            storage.links().delete_by_source_block_id(&block.id)?;
            // BlockVersion has FK (block_id) RESTRICT — must delete before Block
            storage.block_versions().delete_by_block_id(&block.id)?;
        }
        
        // Collect target links deleted
        let target_links = storage.links().get_by_target_page_id(page_id)?;
        cascade_target_link_ids = target_links.into_iter().map(|l| l.id).collect();
        
        LinkService::delete_by_target_page_id(storage, page_id)?;
        BlockService::delete_by_page_id(storage, page_id)?;
        PageService::delete(storage, page_id)?;
        Ok(())
    }).await;
    
    if result.is_ok() {
        let sync_server_clone = sync_server.inner().clone();
        tokio::spawn(async move {
            sync_server_clone.record_and_notify(SyncTable::Page, vec![page_id_clone]).await;
            if !cascade_block_ids.is_empty() {
                sync_server_clone.record_and_notify(SyncTable::Block, cascade_block_ids).await;
            }
            // Merge source + target link IDs
            let mut all_link_ids = cascade_link_ids;
            all_link_ids.extend(cascade_target_link_ids);
            if !all_link_ids.is_empty() {
                sync_server_clone.record_and_notify(SyncTable::Link, all_link_ids).await;
            }
            if !cascade_prop_ids.is_empty() {
                sync_server_clone.record_and_notify(SyncTable::Property, cascade_prop_ids).await;
            }
        });
    }
    
    result
}

#[tauri::command]
pub async fn set_property(
    db: State<'_, super::state::DatabaseConnection>,
    sync_server: State<'_, super::state::SyncServerHandle>,
    block_id: &str,
    key: &str,
    value: &str,
    type_: &str,
) -> Result<Property, String> {
    let block_id_clone = block_id.to_string();
    
    let result = execute_with_adapter(db, |storage| {
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
    }).await;
    
    if result.is_ok() {
        let sync_server_clone = sync_server.inner().clone();
        tokio::spawn(async move {
            sync_server_clone.record_and_notify(SyncTable::Property, vec![block_id_clone]).await;
        });
    }
    
    result
}

#[tauri::command]
pub async fn delete_property(
    db: State<'_, super::state::DatabaseConnection>,
    sync_server: State<'_, super::state::SyncServerHandle>,
    block_id: &str,
    key: &str,
) -> Result<(), String> {
    let block_id_clone = block_id.to_string();
    
    let result = execute_with_adapter(db, |storage| {
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
    }).await;
    
    if result.is_ok() {
        let sync_server_clone = sync_server.inner().clone();
        tokio::spawn(async move {
            sync_server_clone.record_and_notify(SyncTable::Property, vec![block_id_clone]).await;
        });
    }
    
    result
}

#[tauri::command]
pub async fn get_db_path(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<String, String> {
    // 保留前端兼容：返回当前数据库文件路径（workspace/sqlite/comind.db）
    Ok(db.get_db_path())
}

#[tauri::command]
pub async fn get_workspace_path(
    config_manager: State<'_, super::state::ConfigManager>,
    app_handle: AppHandle,
) -> Result<String, String> {
    let config = config_manager.get_config()?.clone();
    let workspace = super::config::get_workspace_path(&app_handle, &config);
    Ok(workspace.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn set_workspace_path(
    config_manager: State<'_, super::state::ConfigManager>,
    config_dir: State<'_, std::path::PathBuf>,
    path: &str,
) -> Result<String, String> {
    let workspace = std::path::PathBuf::from(path);
    // 创建 sqlite/ 和 markdown/ 子目录
    std::fs::create_dir_all(workspace.join("sqlite"))
        .map_err(|e| format!("Failed to create sqlite directory: {}", e))?;
    std::fs::create_dir_all(workspace.join("markdown"))
        .map_err(|e| format!("Failed to create markdown directory: {}", e))?;
    let mut config = super::config::AppConfig::load(&config_dir).unwrap_or_default();
    config.workspace_path = Some(path.to_string());
    config
        .save(&config_dir)
        .map_err(|e| format!("Failed to save config: {}", e))?;

    config_manager.update_config(config)?;
    Ok(path.to_string())
}

#[tauri::command]
pub async fn reset_workspace_path(
    config_manager: State<'_, super::state::ConfigManager>,
    config_dir: State<'_, std::path::PathBuf>,
) -> Result<String, String> {
    let mut config = super::config::AppConfig::load(&config_dir).unwrap_or_default();
    config.workspace_path = None;
    config
        .save(&config_dir)
        .map_err(|e| format!("Failed to save config: {}", e))?;

    config_manager.update_config(config)?;
    Ok("default".to_string())
}

#[tauri::command]
pub async fn execute_batch(
    db: State<'_, super::state::DatabaseConnection>,
    sync_server: State<'_, super::state::SyncServerHandle>,
    operations: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    let mut sync_changes: std::collections::HashMap<SyncTable, Vec<String>> = std::collections::HashMap::new();
    
    let result = execute_with_adapter(db, |storage| {
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
                    sync_changes.entry(SyncTable::Block).or_insert_with(Vec::new).push(block.id.clone());
                    let result = storage.blocks().create(&block)?;
                    serde_json::to_value(result)?
                }
                ("block", "update") => {
                    let block: Block = serde_json::from_value(params)?;
                    page_ids.insert(block.page_id.clone());
                    sync_changes.entry(SyncTable::Block).or_insert_with(Vec::new).push(block.id.clone());
                    let result = storage.blocks().update(&block)?;
                    serde_json::to_value(result)?
                }
                ("block", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    sync_changes.entry(SyncTable::Block).or_insert_with(Vec::new).push(id.clone());
                    if let Ok(block) = storage.blocks().get_by_id(&id) {
                        page_ids.insert(block.page_id);
                    }
                    // Collect cascade-deleted link/property IDs for sync
                    let links = storage.links().get_by_source_block_id(&id)?;
                    sync_changes.entry(SyncTable::Link).or_insert_with(Vec::new).extend(links.iter().map(|l| l.id.clone()));
                    let props = storage.properties().get_by_block_id(&id)?;
                    sync_changes.entry(SyncTable::Property).or_insert_with(Vec::new).extend(props.iter().map(|p| p.id.clone()));
                    storage.links().delete_by_source_block_id(&id)?;
                    storage.properties().delete_by_block_id(&id)?;
                    // BlockVersion has FK (block_id) RESTRICT — must delete before Block
                    storage.block_versions().delete_by_block_id(&id)?;
                    storage.blocks().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("page", "create") => {
                    let page: Page = serde_json::from_value(params)?;
                    sync_changes.entry(SyncTable::Page).or_insert_with(Vec::new).push(page.id.clone());
                    let result = storage.pages().create(&page)?;
                    serde_json::to_value(result)?
                }
                ("page", "update") => {
                    let page: Page = serde_json::from_value(params)?;
                    sync_changes.entry(SyncTable::Page).or_insert_with(Vec::new).push(page.id.clone());
                    let result = storage.pages().update(&page)?;
                    serde_json::to_value(result)?
                }
                ("page", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    sync_changes.entry(SyncTable::Page).or_insert_with(Vec::new).push(id.clone());
                    storage.pages().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("link", "create") => {
                    let link: Link = serde_json::from_value(params)?;
                    sync_changes.entry(SyncTable::Link).or_insert_with(Vec::new).push(link.id.clone());
                    let result = storage.links().create(&link)?;
                    serde_json::to_value(result)?
                }
                ("link", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    sync_changes.entry(SyncTable::Link).or_insert_with(Vec::new).push(id.clone());
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
                            storage,
                            source_block_id,
                            target_page_id,
                            display_text,
                            relationship_type,
                        )?;
                        sync_changes.entry(SyncTable::Link).or_insert_with(Vec::new).push(new_link.id.clone());
                        created.push(new_link);
                    }
                    serde_json::to_value(created)?
                }
                ("property", "create") => {
                    let prop: Property = serde_json::from_value(params)?;
                    sync_changes.entry(SyncTable::Property).or_insert_with(Vec::new).push(prop.id.clone());
                    let result = storage.properties().create(&prop)?;
                    serde_json::to_value(result)?
                }
                ("property", "update") => {
                    let prop: Property = serde_json::from_value(params)?;
                    sync_changes.entry(SyncTable::Property).or_insert_with(Vec::new).push(prop.id.clone());
                    let result = storage.properties().update(&prop)?;
                    serde_json::to_value(result)?
                }
                ("property", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    sync_changes.entry(SyncTable::Property).or_insert_with(Vec::new).push(id.clone());
                    storage.properties().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("relationship_type", "create") => {
                    let rt: RelationshipType = serde_json::from_value(params)?;
                    sync_changes.entry(SyncTable::RelationshipType).or_insert_with(Vec::new).push(rt.id.clone());
                    let result = storage.relationship_types().create(&rt)?;
                    serde_json::to_value(result)?
                }
                ("relationship_type", "update") => {
                    let rt: RelationshipType = serde_json::from_value(params)?;
                    sync_changes.entry(SyncTable::RelationshipType).or_insert_with(Vec::new).push(rt.id.clone());
                    let result = storage.relationship_types().update(&rt)?;
                    serde_json::to_value(result)?
                }
                ("relationship_type", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    sync_changes.entry(SyncTable::RelationshipType).or_insert_with(Vec::new).push(id.clone());
                    storage.relationship_types().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                ("template", "create") => {
                    let template: UserTemplate = serde_json::from_value(params)?;
                    sync_changes.entry(SyncTable::Template).or_insert_with(Vec::new).push(template.id.clone());
                    let result = storage.templates().create(&template)?;
                    serde_json::to_value(result)?
                }
                ("template", "update") => {
                    let template: UserTemplate = serde_json::from_value(params)?;
                    sync_changes.entry(SyncTable::Template).or_insert_with(Vec::new).push(template.id.clone());
                    let result = storage.templates().update(&template)?;
                    serde_json::to_value(result)?
                }
                ("template", "delete") => {
                    let id: String = params
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .to_string();
                    sync_changes.entry(SyncTable::Template).or_insert_with(Vec::new).push(id.clone());
                    storage.templates().delete(&id)?;
                    serde_json::to_value("OK")?
                }
                _ => serde_json::to_value(format!("Unknown operation: {} {}", entity, action))?,
            };
            results.push(result);
        }

        for page_id in page_ids {
            let _ = PageService::update(
                storage, &page_id, None, None, None, None, None, None, None, None,
            );
        }

        Ok(results)
    }).await;
    
    if result.is_ok() {
        let sync_server_clone = sync_server.inner().clone();
        tokio::spawn(async move {
            for (table, ids) in sync_changes {
                sync_server_clone.record_and_notify(table, ids).await;
            }
        });
    }
    
    result
}

#[tauri::command]
pub async fn export_to_markdown(
    db: State<'_, super::state::DatabaseConnection>,
    config_manager: State<'_, super::state::ConfigManager>,
    app_handle: AppHandle,
) -> Result<super::markdown::ExportResult, String> {
    let config = config_manager.get_config()?.clone();
    let workspace = super::config::get_workspace_path(&app_handle, &config);
    let dir = super::config::get_markdown_path(&workspace);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create markdown directory: {}", e))?;
    execute_with_adapter(db, |storage| super::markdown::export_all(storage, &dir)).await
}

#[tauri::command]
pub async fn import_from_markdown(
    db: State<'_, super::state::DatabaseConnection>,
    config_manager: State<'_, super::state::ConfigManager>,
    app_handle: AppHandle,
    strategy: &str,
) -> Result<super::markdown::ImportResult, String> {
    let config = config_manager.get_config()?.clone();
    let workspace = super::config::get_workspace_path(&app_handle, &config);
    let dir = super::config::get_markdown_path(&workspace);
    execute_with_adapter(db, |storage| {
        super::markdown::import_all(storage, &dir, strategy)
    }).await
}

#[tauri::command]
pub async fn get_sync_config(
    config_manager: State<'_, super::state::ConfigManager>,
) -> Result<serde_json::Value, String> {
    let config = config_manager.get_config()?.clone();
    serde_json::to_value(&config).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_sync_config(
    config_manager: State<'_, super::state::ConfigManager>,
    config_dir: State<'_, std::path::PathBuf>,
    enabled: bool,
    interval_secs: Option<u64>,
) -> Result<(), String> {
    let mut config = super::config::AppConfig::load(&config_dir).unwrap_or_default();
    config.sync_enabled = enabled;
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
    app_handle: AppHandle,
) -> Result<super::markdown::ExportResult, String> {
    let config = config_manager.get_config()?.clone();
    let workspace = super::config::get_workspace_path(&app_handle, &config);
    let dir = super::config::get_markdown_path(&workspace);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create markdown directory: {}", e))?;
    execute_with_adapter(db, |storage| super::markdown::export_all(storage, &dir)).await
}

#[tauri::command]
pub async fn trigger_sync(
    db: State<'_, super::state::DatabaseConnection>,
    config_manager: State<'_, super::state::ConfigManager>,
    app_handle: AppHandle,
) -> Result<super::markdown::ExportResult, String> {
    let config = config_manager.get_config()?.clone();
    let workspace = super::config::get_workspace_path(&app_handle, &config);
    let dir = super::config::get_markdown_path(&workspace);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create markdown directory: {}", e))?;
    execute_with_adapter(db, |storage| super::markdown::export_changed(storage, &dir)).await
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
        BlockVersionService::create(
            storage,
            block_id,
            snapshot,
            hash,
            reason,
            checkpoint_name.as_deref(),
            None,
        )
    }).await
}

#[tauri::command]
pub async fn get_block_versions(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: &str,
) -> Result<Vec<BlockVersion>, String> {
    execute_with_adapter(db, |storage| BlockVersionService::list(storage, block_id)).await
}

#[tauri::command]
pub async fn get_block_version_by_id(
    db: State<'_, super::state::DatabaseConnection>,
    id: &str,
) -> Result<BlockVersion, String> {
    execute_with_adapter(db, |storage| BlockVersionService::get_by_id(storage, id)).await
}

#[tauri::command]
pub async fn restore_block_version(
    db: State<'_, super::state::DatabaseConnection>,
    version_id: &str,
) -> Result<BlockVersion, String> {
    let adapter_arc = db.adapter_arc();
    let mut adapter = adapter_arc.lock().await;
    BlockVersionService::restore(&mut *adapter, version_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cleanup_block_versions(
    db: State<'_, super::state::DatabaseConnection>,
    retention_days: i64,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| {
        BlockVersionService::cleanup(storage, retention_days)
    }).await
}

#[tauri::command]
pub async fn delete_block_version(
    db: State<'_, super::state::DatabaseConnection>,
    version_id: &str,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| {
        BlockVersionService::delete(storage, version_id)
    }).await
}

#[tauri::command]
pub async fn get_notification(
    db: State<'_, super::state::DatabaseConnection>,
    id: &str,
) -> Result<Notification, String> {
    execute_with_adapter(db, |storage| storage.notifications().get_by_id(id)).await
}

#[tauri::command]
pub async fn get_notifications_by_block(
    db: State<'_, super::state::DatabaseConnection>,
    block_id: &str,
) -> Result<Vec<Notification>, String> {
    execute_with_adapter(db, |storage| {
        storage.notifications().get_by_block_id(block_id)
    }).await
}

#[tauri::command]
pub async fn query_unread_notifications(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<Vec<Notification>, String> {
    execute_with_adapter(db, |storage| storage.notifications().query_unread()).await
}

#[tauri::command]
pub async fn query_recent_notifications(
    db: State<'_, super::state::DatabaseConnection>,
    limit: usize,
) -> Result<Vec<Notification>, String> {
    execute_with_adapter(db, |storage| storage.notifications().query_recent(limit)).await
}

#[tauri::command]
pub async fn create_notification(
    db: State<'_, super::state::DatabaseConnection>,
    notification: Notification,
) -> Result<Notification, String> {
    execute_with_adapter(db, |storage| storage.notifications().create(&notification)).await
}

#[tauri::command]
pub async fn batch_create_notifications(
    db: State<'_, super::state::DatabaseConnection>,
    notifications: Vec<Notification>,
) -> Result<Vec<Notification>, String> {
    execute_with_adapter(db, |storage| {
        storage.notifications().batch_create(&notifications)
    }).await
}

#[tauri::command]
pub async fn update_notification_status(
    db: State<'_, super::state::DatabaseConnection>,
    id: &str,
    status: &str,
) -> Result<Notification, String> {
    execute_with_adapter(db, |storage| {
        storage.notifications().update_status(id, status)
    }).await
}

#[tauri::command]
pub async fn update_notification_payload(
    db: State<'_, super::state::DatabaseConnection>,
    id: &str,
    payload: &str,
) -> Result<Notification, String> {
    execute_with_adapter(db, |storage| {
        storage.notifications().update_payload(id, payload)
    }).await
}

#[tauri::command]
pub async fn set_notification_snooze(
    db: State<'_, super::state::DatabaseConnection>,
    id: &str,
    snooze_until: i64,
    status: &str,
) -> Result<Notification, String> {
    execute_with_adapter(db, |storage| {
        storage.notifications().set_snooze(id, snooze_until, status)
    }).await
}

#[tauri::command]
pub async fn delete_notification(
    db: State<'_, super::state::DatabaseConnection>,
    id: &str,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| storage.notifications().delete(id)).await
}

#[tauri::command]
pub async fn cleanup_notifications(
    db: State<'_, super::state::DatabaseConnection>,
    timestamp: i64,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| {
        storage.notifications().delete_older_than(timestamp)
    }).await
}

#[tauri::command]
pub async fn mark_all_notifications_read(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<(), String> {
    execute_with_adapter(db, |storage| storage.notifications().mark_all_read()).await
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn get_sync_qr(
    sync_server: State<'_, super::state::SyncServerHandle>,
) -> Result<String, String> {
    // Wait up to 5 seconds for SyncServer to be ready (it starts async)
    for i in 0..50 {
        if let Some(server) = sync_server.get_server().await {
            let token = server.generate_pairing_token().await;
            log::warn!("QR URL: {}", server.build_qr_url(&token));
            return server.generate_qr_image(&token).map_err(|e| e.to_string());
        }
        if i == 0 {
            log::warn!("get_sync_qr: waiting for SyncServer to be ready...");
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }
    Err("SyncServer not started after 5s — check if port 8080 is available or see console logs".to_string())
}

#[tauri::command]
pub async fn get_paired_devices(
    db: State<'_, super::state::DatabaseConnection>,
) -> Result<Vec<serde_json::Value>, String> {
    let adapter_arc = db.adapter_arc();
    let adapter = adapter_arc.lock().await;
    let states = comind_core::sync::state::SyncStateRepository::get_all(&adapter.conn)
        .map_err(|e| e.to_string())?;
    let mut result = Vec::new();
    for state in states {
        result.push(serde_json::json!({
            "client_id": state.client_id,
            "peer_device_name": state.peer_device_name,
            "last_sync_at": state.last_sync_at,
            "paired_at": state.paired_at,
        }));
    }
    Ok(result)
}

#[tauri::command]
pub async fn unpair_device(
    db: State<'_, super::state::DatabaseConnection>,
    sync_server: State<'_, super::state::SyncServerHandle>,
    client_id: &str,
) -> Result<(), String> {
    // PC 端：同时关闭该设备活跃连接并清内存配对记录
    #[cfg(not(target_os = "android"))]
    {
        if let Some(server) = sync_server.get_server().await {
            server.revoke_device(client_id).await;
        }
    }
    let adapter_arc = db.adapter_arc();
    let adapter = adapter_arc.lock().await;
    comind_core::sync::state::SyncStateRepository::delete(&adapter.conn, client_id)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn get_sync_status(
    sync_server: State<'_, super::state::SyncServerHandle>,
) -> Result<serde_json::Value, String> {
    let server = sync_server.get_server().await.ok_or("SyncServer not started")?;
    let status = server.get_status().await;
    Ok(serde_json::json!({
        "connected": status.connected,
        "paired": status.paired,
        "peers": status.peers.iter().map(|p| serde_json::json!({
            "client_id": p.client_id,
            "name": p.name,
            "ip": p.ip,
        })).collect::<Vec<_>>(),
    }))
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn trigger_full_sync(
    sync_server: State<'_, super::state::SyncServerHandle>,
) -> Result<(), String> {
    let server = sync_server.get_server().await.ok_or("SyncServer not started")?;
    server.trigger_full_sync().await.map_err(|e| e.to_string())
}

// ===== Android 端同步命令 =====

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn connect_to_server(
    db: State<'_, super::state::DatabaseConnection>,
    config_manager: State<'_, super::state::ConfigManager>,
    sync_handle: State<'_, super::state::SyncServerHandle>,
    qr_payload: &str,
) -> Result<(), String> {
    log::warn!("connect_to_server: CALLED with qr_payload={}", qr_payload);

    let device_name = {
        let config = config_manager.get_config()?.clone();
        config.device_name.clone()
    };

    let db_path = db.get_db_path();
    let db_path = std::path::Path::new(&db_path);
    log::info!("connect_to_server: db_path={:?}", db_path);

    let client = crate::sync_client::SyncClient::from_qr(qr_payload, db_path, device_name)
        .map_err(|e| {
            log::error!("connect_to_server: from_qr failed: {}", e);
            e
        })?;

    client.connect_and_pair().await.map_err(|e| {
        log::error!("connect_to_server: connect_and_pair failed: {}", e);
        e
    })?;

    // 立即触发一次双向全量同步
    client.trigger_bidirectional_full_sync().await;

    // 启动心跳和定时全量校验
    client.start_heartbeat();
    client.start_periodic_full_sync();

    sync_handle.set_client(client).await;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn auto_reconnect(
    sync_handle: State<'_, super::state::SyncServerHandle>,
    db: State<'_, super::state::DatabaseConnection>,
    config_manager: State<'_, super::state::ConfigManager>,
) -> Result<bool, String> {
    /// 尝试从 DB 恢复已配对设备的连接（App 启动时调用）
    /// 返回 true 表示已找到配对记录并正在连接，false 表示无配对记录
    if sync_handle.get_client().await.is_some() {
        log::info!("auto_reconnect: SyncClient already running, skipping");
        return Ok(true);
    }

    let device_name = {
        let config = config_manager.get_config()?.clone();
        config.device_name.clone()
    };

    let db_path = db.get_db_path();
    let db_path = std::path::Path::new(&db_path);

    let client = crate::sync_client::SyncClient::from_db(db_path, device_name)
        .map_err(|e| {
            log::info!("auto_reconnect: no paired device found: {}", e);
            e
        })?;

    log::info!("auto_reconnect: found paired device, attempting to connect...");

    // 尝试连接，失败也启动后台重连循环
    match client.connect_and_pair().await {
        Ok(()) => {
            client.start_heartbeat();
            client.start_periodic_full_sync();
            sync_handle.set_client(client).await;
            log::info!("auto_reconnect: connected successfully!");
            Ok(true)
        }
        Err(e) => {
            log::warn!("auto_reconnect: initial connect failed ({}), starting background reconnect...", e);
            // 启动心跳（心跳超时会触发重连）
            client.start_heartbeat();
            // 直接触发后台重连循环
            client.start_background_reconnect().await;
            sync_handle.set_client(client).await;
            Ok(true) // 返回 true 表示有配对记录，正在重连中
        }
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn disconnect_sync(
    sync_handle: State<'_, super::state::SyncServerHandle>,
) -> Result<(), String> {
    if let Some(client) = sync_handle.get_client().await {
        client.disconnect().await;
    }
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn get_sync_status(
    sync_handle: State<'_, super::state::SyncServerHandle>,
) -> Result<serde_json::Value, String> {
    if let Some(client) = sync_handle.get_client().await {
        let connected = client.is_connected().await;
        let paired = client.is_paired().await;
        let server_name = client.get_server_name().to_string();
        Ok(serde_json::json!({
            "connected": connected,
            "paired": paired,
            "server_name": server_name,
            "peers": [],
        }))
    } else {
        Ok(serde_json::json!({
            "connected": false,
            "paired": false,
            "server_name": null,
            "peers": [],
        }))
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
pub async fn trigger_full_sync_mobile(
    sync_handle: State<'_, super::state::SyncServerHandle>,
) -> Result<(), String> {
    let client = sync_handle.get_client().await.ok_or("SyncClient not started")?;
    client.trigger_full_sync().await
}
