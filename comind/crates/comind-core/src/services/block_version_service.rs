use crate::{
    types::{Block, BlockVersion, BlockVersionCreateOptions, Property, Link},
    storage::{repository, TransactionalStorageAdapter},
};
use sha2::{Sha256, Digest};
use std::error::Error;
use rand::Rng;

pub struct BlockVersionService;

impl BlockVersionService {
    pub fn create(
        storage: &mut dyn repository::StorageAdapter,
        block_id: &str,
        snapshot: &str,
        hash: &str,
        source: &str,
        message: Option<&str>,
        restored_from_version_id: Option<&str>,
    ) -> Result<BlockVersion, Box<dyn Error>> {
        let latest = repository::BlockVersionRepository::get_latest_version(storage.block_versions(), block_id)?;
        
        let version_number = if let Some(ref latest_version) = latest {
            if latest_version.hash == hash {
                return Ok(latest_version.clone());
            }
            latest_version.version + 1
        } else {
            1
        };
        
        let options = BlockVersionCreateOptions {
            block_id: block_id.to_string(),
            snapshot: snapshot.to_string(),
            hash: hash.to_string(),
            message: message.map(|s| s.to_string()),
            source: source.to_string(),
            restored_from_version_id: restored_from_version_id.map(|s| s.to_string()),
        };
        
        let version = BlockVersion::new(options, version_number);
        repository::BlockVersionRepository::create(storage.block_versions(), &version)
    }
    
    pub fn list(
        storage: &mut dyn repository::StorageAdapter,
        block_id: &str,
    ) -> Result<Vec<BlockVersion>, Box<dyn Error>> {
        repository::BlockVersionRepository::get_by_block_id(storage.block_versions(), block_id)
    }
    
    pub fn get_by_id(
        storage: &mut dyn repository::StorageAdapter,
        id: &str,
    ) -> Result<BlockVersion, Box<dyn Error>> {
        repository::BlockVersionRepository::get_by_id(storage.block_versions(), id)
    }
    
    pub fn restore<S>(
        storage: &mut S,
        version_id: &str,
    ) -> Result<BlockVersion, Box<dyn Error>>
    where
        S: TransactionalStorageAdapter,
    {
        let version = repository::BlockVersionRepository::get_by_id(storage.block_versions(), version_id)?;

        let mut snapshot: serde_json::Value = serde_json::from_str(&version.snapshot)?;

        // 兼容旧格式：
        // 1. block 字段可能是 camelCase（pageId/parentId/createdAt/updatedAt），需转换为 snake_case
        // 2. format 字段可能是 map（对象），需转换为 JSON 字符串以匹配 Block.format: String
        if let Some(block_data) = snapshot.get_mut("block") {
            if let Some(obj) = block_data.as_object_mut() {
                // camelCase → snake_case 字段名映射
                for (camel, snake) in [
                    ("pageId", "page_id"),
                    ("parentId", "parent_id"),
                    ("createdAt", "created_at"),
                    ("updatedAt", "updated_at"),
                ] {
                    if let Some(val) = obj.remove(camel) {
                        obj.insert(snake.to_string(), val);
                    }
                }

                // format 字段：map → JSON 字符串
                if let Some(format_val) = obj.get_mut("format") {
                    if !format_val.is_string() {
                        let format_str = serde_json::to_string(format_val)?;
                        *format_val = serde_json::Value::String(format_str);
                    }
                }
            }
        }

        let block_data = snapshot.get("block").ok_or("Snapshot missing block data")?;
        let block: Block = serde_json::from_value(block_data.clone())?;

        let properties_data = snapshot.get("properties").ok_or("Snapshot missing properties")?;
        let properties: Vec<Property> = serde_json::from_value(properties_data.clone())?;

        let relationships_data = snapshot.get("relationships").ok_or("Snapshot missing relationships")?;
        let relationships: Vec<Link> = serde_json::from_value(relationships_data.clone())?;
        
        let now = chrono::Utc::now().timestamp_millis();
        
        let updated_block = Block {
            id: block.id.clone(),
            page_id: block.page_id.clone(),
            parent_id: block.parent_id.clone(),
            pos: block.pos,
            content: block.content.clone(),
            format: block.format.clone(),
            r#type: block.r#type.clone(),
            created_at: block.created_at,
            updated_at: now,
        };
        
        storage.transaction(|tx| {
            repository::BlockRepository::update(tx.blocks(), &updated_block)?;
            
            repository::PropertyRepository::delete_by_block_id(tx.properties(), &block.id)?;
            for prop in &properties {
                let mut restored_prop = prop.clone();
                restored_prop.id = Self::generate_id();
                restored_prop.block_id = block.id.clone();
                restored_prop.created_at = now;
                restored_prop.updated_at = now;
                repository::PropertyRepository::create(tx.properties(), &restored_prop)?;
            }
            
            repository::LinkRepository::delete_by_source_block_id(tx.links(), &block.id)?;
            for rel in &relationships {
                let target_page_result = repository::PageRepository::get_by_id(tx.pages(), &rel.target_page_id);
                if target_page_result.is_ok() {
                    let mut restored_link = rel.clone();
                    restored_link.id = Self::generate_id();
                    restored_link.source_block_id = block.id.clone();
                    restored_link.created_at = now;
                    repository::LinkRepository::create(tx.links(), &restored_link)?;
                }
            }
            
            Ok(())
        })?;
        
        let new_snapshot = Self::build_snapshot(storage, &block.id)?;
        let new_hash = Self::calculate_hash(&new_snapshot);
        
        Self::create(
            storage,
            &block.id,
            &new_snapshot,
            &new_hash,
            "restore",
            None,
            Some(version_id),
        )
    }
    
    pub fn cleanup(
        storage: &mut dyn repository::StorageAdapter,
        retention_days: i64,
    ) -> Result<(), Box<dyn Error>> {
        let now = chrono::Utc::now().timestamp_millis();
        let retention_ms = retention_days * 24 * 60 * 60 * 1000;
        let cutoff_timestamp = now - retention_ms;
        
        repository::BlockVersionRepository::delete_older_than(storage.block_versions(), "", cutoff_timestamp)?;
        
        Ok(())
    }
    
    pub fn build_snapshot(
        storage: &mut dyn repository::StorageAdapter,
        block_id: &str,
    ) -> Result<String, Box<dyn Error>> {
        let block = repository::BlockRepository::get_by_id(storage.blocks(), block_id)?;
        let properties = repository::PropertyRepository::get_by_block_id(storage.properties(), block_id)?;
        let relationships = repository::LinkRepository::get_by_source_block_id(storage.links(), block_id)?;
        
        let snapshot = serde_json::json!({
            "block": block,
            "properties": properties,
            "relationships": relationships,
        });
        
        Ok(snapshot.to_string())
    }
    
    pub fn calculate_hash(snapshot: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(snapshot.as_bytes());
        let result = hasher.finalize();
        hex::encode(result)
    }
    
    fn generate_id() -> String {
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
        hex::encode(bytes)
    }
}