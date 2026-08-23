use crate::services::{
    build_segments_for_block, BlockService, BlockVersionService, LinkService, NotificationService,
    PageService, PropertyService,
};
use crate::storage::{StorageAdapter, TransactionalStorageAdapter};
use crate::types::{Block, BlockSaveResult, SyncTable};
use std::collections::HashMap;
use std::error::Error;

/// Outcome of `save_blocks`: per-block results for the frontend, plus the
/// (table, ids) sets the sync layer must be notified about after commit.
#[derive(Debug)]
pub struct SaveOutcome {
    pub results: Vec<BlockSaveResult>,
    pub sync_changes: HashMap<SyncTable, Vec<String>>,
}

/// Write-path orchestration (ADR-0019): the single source of truth for the
/// block save / delete cascades shared by the Tauri and wasm IPC entry points.
///
/// Every function owns its transaction (`adapter.transaction(…)`): any step
/// failure rolls the whole cascade back. Sync notifications are *returned*,
/// never spawned here — core stays synchronous; the caller decides when to
/// fire `record_and_notify` after commit.
pub struct BlockWriteService;

impl BlockWriteService {
    /// Upsert a batch of blocks and build the frontend save results (snapshot +
    /// render segments) plus the sync-changes set, all inside one transaction.
    ///
    /// Behavior preserved from the previous IPC-layer orchestration:
    /// - upsert by existence check (existing → update, missing → create);
    /// - snapshot and render segments are best-effort (`unwrap_or_default`);
    /// - page touch + word_count recount (`PageService::recount_word_count`) is
    ///   best-effort and in-transaction;
    /// - per-block id is reported under `SyncTable::Block`.
    pub fn save_blocks<S: TransactionalStorageAdapter>(
        adapter: &mut S,
        blocks: Vec<Block>,
    ) -> Result<SaveOutcome, Box<dyn Error>> {
        adapter.transaction(|storage| {
            let mut results = Vec::new();
            let mut page_ids = std::collections::HashSet::new();
            let mut sync_changes: HashMap<SyncTable, Vec<String>> = HashMap::new();

            for block in blocks {
                page_ids.insert(block.page_id.clone());
                sync_changes
                    .entry(SyncTable::Block)
                    .or_insert_with(Vec::new)
                    .push(block.id.clone());

                let existing = BlockService::get_by_id(storage, &block.id);
                let saved_block = match existing {
                    Ok(_) => BlockService::update(
                        storage,
                        &block.id,
                        Some(&block.content),
                        Some(&block.format),
                        Some(&block.r#type),
                        block.parent_id.as_deref(),
                        Some(block.pos),
                    )?,
                    Err(_) => BlockService::create(
                        storage,
                        &block.page_id,
                        block.parent_id.as_deref(),
                        &block.content,
                        &block.format,
                        &block.r#type,
                        Some(&block.id),
                    )?,
                };

                // Build snapshot inside the transaction (block/properties/links
                // are just-written; zero extra round-trips beyond the reads here).
                let snapshot =
                    BlockVersionService::build_snapshot(storage, &saved_block.id).unwrap_or_default();

                // Render segments built during save so the frontend can restore
                // link/dateRef rendering immediately after edit→render transition.
                let render_segments =
                    build_segments_for_block(storage, &saved_block).unwrap_or_default();

                results.push(BlockSaveResult {
                    block: saved_block,
                    snapshot,
                    render_segments,
                });
            }

            // Collect link, property & notification changes for sync notification.
            for res in &results {
                let links =
                    LinkService::get_by_source_block_id(storage, &res.block.id).unwrap_or_default();
                sync_changes
                    .entry(SyncTable::Link)
                    .or_insert_with(Vec::new)
                    .extend(links.iter().map(|l| l.id.clone()));
                let props =
                    PropertyService::get_by_block_id(storage, &res.block.id).unwrap_or_default();
                sync_changes
                    .entry(SyncTable::Property)
                    .or_insert_with(Vec::new)
                    .extend(props.iter().map(|p| p.id.clone()));
                let notifs =
                    NotificationService::get_by_block_id(storage, &res.block.id).unwrap_or_default();
                sync_changes
                    .entry(SyncTable::Notification)
                    .or_insert_with(Vec::new)
                    .extend(notifs.iter().map(|n| n.id.clone()));
            }

            for page_id in page_ids {
                // Page touch + word_count 重算（该页所有 block 内容字数之和，best-effort）
                let _ = PageService::recount_word_count(storage, &page_id);
            }

            Ok(SaveOutcome {
                results,
                sync_changes,
            })
        })
    }

    /// Delete a single block and its cascade (versions → links → properties →
    /// block), reporting the deleted ids for sync, then page touch.
    pub fn delete_block_cascade<S: TransactionalStorageAdapter>(
        adapter: &mut S,
        block_id: &str,
    ) -> Result<HashMap<SyncTable, Vec<String>>, Box<dyn Error>> {
        adapter.transaction(|storage| {
            let mut sync_changes: HashMap<SyncTable, Vec<String>> = HashMap::new();
            let page_id = Self::delete_block_cascade_inner(storage, block_id, &mut sync_changes)?;
            // Page touch + word_count 重算（block 删除后字数减少，best-effort）
            let _ = PageService::recount_word_count(storage, &page_id);
            Ok(sync_changes)
        })
    }

    /// Delete a page and its whole block tree: per-block cascade (shared
    /// skeleton), target-side links pointing at the page, then the page itself.
    pub fn delete_page_cascade<S: TransactionalStorageAdapter>(
        adapter: &mut S,
        page_id: &str,
    ) -> Result<HashMap<SyncTable, Vec<String>>, Box<dyn Error>> {
        adapter.transaction(|storage| {
            let mut sync_changes: HashMap<SyncTable, Vec<String>> = HashMap::new();

            let blocks = BlockService::get_by_page_id(storage, page_id)?;
            for block in &blocks {
                Self::delete_block_cascade_inner(storage, &block.id, &mut sync_changes)?;
            }

            // Collect and delete target-side links (pages linking to this page).
            let target_links = LinkService::get_by_target_page_id(storage, page_id)?;
            sync_changes
                .entry(SyncTable::Link)
                .or_insert_with(Vec::new)
                .extend(target_links.into_iter().map(|l| l.id));
            LinkService::delete_by_target_page_id(storage, page_id)?;

            PageService::delete(storage, page_id)?;
            sync_changes
                .entry(SyncTable::Page)
                .or_insert_with(Vec::new)
                .push(page_id.to_string());

            Ok(sync_changes)
        })
    }

    /// Single-block delete skeleton (ADR-0019 Q8/Q14), shared by
    /// `delete_block_cascade` and `delete_page_cascade`. Runs on a
    /// `&mut dyn StorageAdapter` so callers wrap it in their own transaction.
    /// Returns the deleted block's page id (used by `delete_block_cascade`
    /// for the page touch; unused by the page-cascade which never touches).
    fn delete_block_cascade_inner(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        sync_changes: &mut HashMap<SyncTable, Vec<String>>,
    ) -> Result<String, Box<dyn Error>> {
        let block = BlockService::get_by_id(storage, block_id)?;
        let page_id = block.page_id.clone();

        // Collect cascade-deleted ids before deleting.
        let links = LinkService::get_by_source_block_id(storage, block_id)?;
        sync_changes
            .entry(SyncTable::Link)
            .or_insert_with(Vec::new)
            .extend(links.iter().map(|l| l.id.clone()));
        let props = PropertyService::get_by_block_id(storage, block_id)?;
        sync_changes
            .entry(SyncTable::Property)
            .or_insert_with(Vec::new)
            .extend(props.iter().map(|p| p.id.clone()));

        // BlockVersion has FK (block_id) RESTRICT — must delete before Block.
        BlockVersionService::delete_by_block_id(storage, block_id)?;
        LinkService::delete_by_source_block_id(storage, block_id)?;
        PropertyService::delete_by_block_id(storage, block_id)?;
        // BlockService::delete handles dateRef + notification cleanup.
        BlockService::delete(storage, block_id)?;

        sync_changes
            .entry(SyncTable::Block)
            .or_insert_with(Vec::new)
            .push(block_id.to_string());

        Ok(page_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::{repository, StorageAdapter, SQLiteAdapter};

    fn block(id: &str, page_id: &str, parent_id: Option<&str>, pos: i64) -> Block {
        Block {
            id: id.to_string(),
            page_id: page_id.to_string(),
            parent_id: parent_id.map(|s| s.to_string()),
            pos,
            content: "test content".to_string(),
            format: "{}".to_string(),
            r#type: "bullet".to_string(),
            created_at: 1,
            updated_at: 1,
            version: 0,
            deleted_at: None,
        }
    }

    fn block_with_content(
        id: &str,
        page_id: &str,
        parent_id: Option<&str>,
        pos: i64,
        content: &str,
    ) -> Block {
        let mut b = block(id, page_id, parent_id, pos);
        b.content = content.to_string();
        b
    }

    /// Create a page by title and return its real (generated) id — blocks must
    /// reference the actual `Page.id` because FK enforcement is on.
    fn seed_page(storage: &mut dyn StorageAdapter, title: &str) -> String {
        PageService::create(storage, "", title, Some("page"), None, None, Some("[]"), None)
            .unwrap()
            .id
    }

    #[test]
    fn save_blocks_writes_and_builds_outcome() {
        let mut adapter = SQLiteAdapter::open_in_memory().unwrap();
        let p1 = seed_page(&mut adapter, "p1");

        let outcome = BlockWriteService::save_blocks(
            &mut adapter,
            vec![block("b1", &p1, None, 1000), block("b2", &p1, Some("b1"), 1000)],
        )
        .unwrap();

        assert_eq!(outcome.results.len(), 2);
        assert_eq!(outcome.results[0].block.id, "b1");
        // Snapshot is a real serialized BlockSnapshot, not an empty string.
        assert!(!outcome.results[0].snapshot.is_empty());
        assert!(outcome.results[0].snapshot.contains("\"block\""));

        // Both blocks reported under SyncTable::Block.
        let blocks_sync = outcome.sync_changes.get(&SyncTable::Block).unwrap();
        assert_eq!(blocks_sync, &vec!["b1".to_string(), "b2".to_string()]);

        // Persisted: readable back through the service layer.
        let read = BlockService::get_by_id(&mut adapter, "b1").unwrap();
        assert_eq!(read.content, "test content");
        let children = BlockService::get_children(&mut adapter, "b1").unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].id, "b2");
    }

    #[test]
    fn save_blocks_rolls_back_on_conflict() {
        let mut adapter = SQLiteAdapter::open_in_memory().unwrap();
        let p1 = seed_page(&mut adapter, "p1");

        // Pre-existing block that is soft-deleted: get_by_id fails (deleted_at
        // set), so save_blocks takes the create branch → PRIMARY KEY conflict.
        let dup = block("dup", &p1, None, 500);
        repository::BlockRepository::create(adapter.blocks(), &dup).unwrap();
        adapter.blocks().delete("dup").unwrap();

        // First block is valid; the dup block forces a mid-transaction failure.
        let err = BlockWriteService::save_blocks(
            &mut adapter,
            vec![block("b1", &p1, None, 1000), block("dup", &p1, None, 600)],
        )
        .unwrap_err();
        assert!(err.to_string().contains("constraint") || err.to_string().contains("UNIQUE"));

        // Rolled back: b1 was written inside the transaction but must not survive.
        assert!(BlockService::get_by_id(&mut adapter, "b1").is_err());
        // The pre-existing dup row is untouched (still soft-deleted).
        let dup_read = repository::BlockRepository::get_by_id(adapter.blocks(), "dup");
        assert!(dup_read.is_err());
    }

    #[test]
    fn delete_block_cascade_removes_block_and_reports() {
        let mut adapter = SQLiteAdapter::open_in_memory().unwrap();
        let p1 = seed_page(&mut adapter, "p1");
        BlockWriteService::save_blocks(
            &mut adapter,
            vec![block("b1", &p1, None, 1000)],
        )
        .unwrap();

        let sync = BlockWriteService::delete_block_cascade(&mut adapter, "b1").unwrap();

        assert!(BlockService::get_by_id(&mut adapter, "b1").is_err());
        assert_eq!(
            sync.get(&SyncTable::Block).unwrap(),
            &vec!["b1".to_string()]
        );
        // Keys present even when the collected sets are empty (empty tables).
        assert!(sync.contains_key(&SyncTable::Link));
        assert!(sync.contains_key(&SyncTable::Property));
    }

    #[test]
    fn delete_block_cascade_missing_id_errors_without_side_effects() {
        let mut adapter = SQLiteAdapter::open_in_memory().unwrap();
        let p1 = seed_page(&mut adapter, "p1");
        BlockWriteService::save_blocks(
            &mut adapter,
            vec![block("b1", &p1, None, 1000)],
        )
        .unwrap();

        let err = BlockWriteService::delete_block_cascade(&mut adapter, "nope").unwrap_err();
        assert!(!err.to_string().is_empty());

        // The unrelated block is untouched — no partial deletion happened.
        assert!(BlockService::get_by_id(&mut adapter, "b1").is_ok());
    }

    #[test]
    fn delete_page_cascade_removes_whole_tree() {
        let mut adapter = SQLiteAdapter::open_in_memory().unwrap();
        let p1 = seed_page(&mut adapter, "p1");
        BlockWriteService::save_blocks(
            &mut adapter,
            vec![block("b1", &p1, None, 1000), block("b2", &p1, Some("b1"), 1000)],
        )
        .unwrap();

        let sync = BlockWriteService::delete_page_cascade(&mut adapter, &p1).unwrap();

        assert!(BlockService::get_by_id(&mut adapter, "b1").is_err());
        assert!(BlockService::get_by_id(&mut adapter, "b2").is_err());
        assert!(PageService::get_by_id(&mut adapter, "p1").is_err());
        assert_eq!(
            sync.get(&SyncTable::Page).unwrap(),
            &vec![p1.clone()]
        );
        let blocks_sync = sync.get(&SyncTable::Block).unwrap();
        assert_eq!(blocks_sync.len(), 2);
        assert!(blocks_sync.contains(&"b1".to_string()));
        assert!(blocks_sync.contains(&"b2".to_string()));
    }

    #[test]
    fn save_blocks_recounts_page_word_count() {
        let mut adapter = SQLiteAdapter::open_in_memory().unwrap();
        let p1 = seed_page(&mut adapter, "p1");

        BlockWriteService::save_blocks(
            &mut adapter,
            vec![
                block_with_content("b1", &p1, None, 1000, "你好 hello"),
                block_with_content("b2", &p1, Some("b1"), 1000, "世界"),
            ],
        )
        .unwrap();

        // 你好(2) + hello(1) + 世界(2) = 5
        let page = PageService::get_by_id(&mut adapter, &p1).unwrap();
        assert_eq!(page.word_count, 5);
    }

    #[test]
    fn delete_block_cascade_recounts_page_word_count() {
        let mut adapter = SQLiteAdapter::open_in_memory().unwrap();
        let p1 = seed_page(&mut adapter, "p1");
        BlockWriteService::save_blocks(
            &mut adapter,
            vec![
                block_with_content("b1", &p1, None, 1000, "你好 hello"),
                block_with_content("b2", &p1, Some("b1"), 1000, "世界"),
            ],
        )
        .unwrap();

        BlockWriteService::delete_block_cascade(&mut adapter, "b2").unwrap();
        // 只剩 b1：你好(2) + hello(1) = 3
        let page = PageService::get_by_id(&mut adapter, &p1).unwrap();
        assert_eq!(page.word_count, 3);
    }
}
