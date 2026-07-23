use crate::{
    types::{Block, BlockTree},
    storage::{repository, StorageAdapter},
    services::DateRefService,
};
use rand::Rng;
use std::collections::HashMap;
use std::error::Error;

pub struct BlockService;
impl BlockService {
    pub fn get_by_id(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<Block, Box<dyn Error>> {
        repository::BlockRepository::get_by_id(storage.blocks(), id)
    }

    pub fn get_by_page_id(
        storage: &mut dyn StorageAdapter,
        page_id: &str,
    ) -> Result<Vec<Block>, Box<dyn Error>> {
        repository::BlockRepository::get_by_page_id(storage.blocks(), page_id)
    }

    pub fn get_children(
        storage: &mut dyn StorageAdapter,
        parent_id: &str,
    ) -> Result<Vec<Block>, Box<dyn Error>> {
        repository::BlockRepository::get_children(storage.blocks(), parent_id)
    }

    pub fn create(
        storage: &mut dyn StorageAdapter,
        page_id: &str,
        parent_id: Option<&str>,
        content: &str,
        format: &str,
        r#type: &str,
        id: Option<&str>,
    ) -> Result<Block, Box<dyn Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        let pos = if let Some(pid) = parent_id {
            Self::calculate_gap_sort_pos(storage, pid)?
        } else {
            Self::calculate_gap_sort_pos_for_root(storage, page_id)?
        };

        let block = Block {
            id: id.map(|s| s.to_string()).unwrap_or_else(Self::generate_id),
            page_id: page_id.to_string(),
            parent_id: parent_id.map(|s| s.to_string()),
            pos,
            content: content.to_string(),
            format: format.to_string(),
            r#type: r#type.to_string(),
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
        };

        let block = repository::BlockRepository::create(storage.blocks(), &block)?;
        DateRefService::sync_date_refs_for_block(storage, &block.id, &block.content)?;
        Ok(block)
    }

    pub fn update(
        storage: &mut dyn StorageAdapter,
        id: &str,
        content: Option<&str>,
        format: Option<&str>,
        r#type: Option<&str>,
        parent_id: Option<&str>,
        pos: Option<i64>,
    ) -> Result<Block, Box<dyn Error>> {
        let mut block = repository::BlockRepository::get_by_id(storage.blocks(), id)?;
        let old_content = block.content.clone();

        if let Some(c) = content {
            block.content = c.to_string();
        }
        if let Some(f) = format {
            block.format = f.to_string();
        }
        if let Some(t) = r#type {
            block.r#type = t.to_string();
        }
        if let Some(p) = parent_id {
            block.parent_id = Some(p.to_string());
        }
        if let Some(pos_val) = pos {
            block.pos = pos_val;
        }
        block.updated_at = chrono::Utc::now().timestamp_millis();

        let block = repository::BlockRepository::update(storage.blocks(), &block)?;
        DateRefService::sync_date_refs_for_block(storage, &block.id, &block.content)?;
        // 方案 A：非 recurring 通知随 block 改时间原地改期（仅当 iso 真的变化）
        if content.is_some() {
            DateRefService::reschedule_notifications_on_change(
                storage,
                &block.id,
                &old_content,
                &block.content,
            )?;
        }
        Ok(block)
    }

    pub fn delete(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<(), Box<dyn Error>> {
        DateRefService::sync_date_refs_for_block(storage, id, "")?;
        // 整块删除：连同该 block 的所有通知一起硬删除，避免 block 没了但通知残留（孤儿通知、点击跳转 404）。
        storage.notifications().delete_by_block_id(id)?;
        repository::BlockRepository::delete(storage.blocks(), id)
    }

    pub fn delete_by_page_id(
        storage: &mut dyn StorageAdapter,
        page_id: &str,
    ) -> Result<(), Box<dyn Error>> {
        // 删页前逐个清理 block 的派生数据（DateRef + 通知），否则会留下孤儿通知。
        let blocks = repository::BlockRepository::get_by_page_id(storage.blocks(), page_id)?;
        for b in &blocks {
            DateRefService::sync_date_refs_for_block(storage, &b.id, "")?;
            storage.notifications().delete_by_block_id(&b.id)?;
        }
        repository::BlockRepository::delete_by_page_id(storage.blocks(), page_id)
    }

    pub fn reorder(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        parent_id: &str,
        target_pos: i64,
    ) -> Result<Block, Box<dyn Error>> {
        let mut block = repository::BlockRepository::get_by_id(storage.blocks(), block_id)?;
        block.parent_id = Some(parent_id.to_string());
        block.pos = target_pos;
        block.updated_at = chrono::Utc::now().timestamp_millis();
        repository::BlockRepository::update(storage.blocks(), &block)
    }

    pub fn build_tree(
        storage: &mut dyn StorageAdapter,
        page_id: &str,
    ) -> Result<BlockTree, Box<dyn Error>> {
        let blocks = repository::BlockRepository::get_by_page_id(storage.blocks(), page_id)?;

        let block_map: HashMap<String, Block> = blocks
            .into_iter()
            .map(|b| (b.id.clone(), b))
            .collect();

        let mut root_blocks: Vec<String> = Vec::new();
        let mut children_map: HashMap<String, Vec<String>> = HashMap::new();

        for (id, block) in &block_map {
            if block.parent_id.is_none() {
                root_blocks.push(id.clone() as String);
            } else {
                let parent_id = block.parent_id.as_ref().unwrap();
                children_map
                    .entry(parent_id.clone())
                    .or_insert_with(Vec::new)
                    .push(id.clone());
            }
        }

        root_blocks.sort_by(|a, b| {
            block_map[a]
                .pos
                .cmp(&block_map[b].pos)
        });

        for (_, children) in children_map.iter_mut() {
            children.sort_by(|a, b| {
                block_map[a]
                    .pos
                    .cmp(&block_map[b].pos)
            });
        }

        Ok(BlockTree {
            block_map,
            root_blocks,
            children_map,
        })
    }

    pub fn get_next_pos(
        storage: &mut dyn StorageAdapter,
        parent_id: &str,
    ) -> Result<i64, Box<dyn Error>> {
        Self::calculate_gap_sort_pos(storage, parent_id)
    }

    fn calculate_gap_sort_pos(
        storage: &mut dyn StorageAdapter,
        parent_id: &str,
    ) -> Result<i64, Box<dyn Error>> {
        let children = repository::BlockRepository::get_children(storage.blocks(), parent_id)?;

        if children.is_empty() {
            return Ok(1000);
        }

        let mut positions: Vec<i64> = children.iter().map(|c| c.pos).collect();
        positions.sort();

        let first_gap = positions[0] - 0;
        if first_gap > 1 {
            return Ok(positions[0] / 2);
        }

        for i in 1..positions.len() {
            let gap = positions[i] - positions[i - 1];
            if gap > 1 {
                return Ok((positions[i - 1] + positions[i]) / 2);
            }
        }

        Ok(positions.last().unwrap() + 1000)
    }

    fn calculate_gap_sort_pos_for_root(
        storage: &mut dyn StorageAdapter,
        page_id: &str,
    ) -> Result<i64, Box<dyn Error>> {
        let blocks = repository::BlockRepository::get_by_page_id(storage.blocks(), page_id)?;
        let root_blocks: Vec<i64> = blocks
            .into_iter()
            .filter(|b| b.parent_id.is_none())
            .map(|b| b.pos)
            .collect();

        if root_blocks.is_empty() {
            return Ok(1000);
        }

        let mut positions = root_blocks;
        positions.sort();

        let first_gap = positions[0] - 0;
        if first_gap > 1 {
            return Ok(positions[0] / 2);
        }

        for i in 1..positions.len() {
            let gap = positions[i] - positions[i - 1];
            if gap > 1 {
                return Ok((positions[i - 1] + positions[i]) / 2);
            }
        }

        Ok(positions.last().unwrap() + 1000)
    }

    fn generate_id() -> String {
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
        hex::encode(bytes)
    }
}