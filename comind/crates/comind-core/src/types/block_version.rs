use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use uuid::Uuid;
use crate::{Block, Property, Link};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockSnapshot {
    pub block: Block,
    pub properties: Vec<Property>,
    pub relationships: Vec<Link>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockVersion {
    pub id: String,
    pub block_id: String,
    pub version: i64,
    pub snapshot: String,
    pub hash: String,
    pub message: Option<String>,
    pub source: String,
    pub restored_from_version_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockVersionCreateOptions {
    pub block_id: String,
    pub snapshot: String,
    pub hash: String,
    pub message: Option<String>,
    pub source: String,
    pub restored_from_version_id: Option<String>,
}

impl BlockVersion {
    pub fn new(options: BlockVersionCreateOptions, version: i64) -> Self {
        let now = chrono::Utc::now().timestamp_millis();
        BlockVersion {
            id: Uuid::new_v4().to_string(),
            block_id: options.block_id,
            version,
            snapshot: options.snapshot,
            hash: options.hash,
            message: options.message,
            source: options.source,
            restored_from_version_id: options.restored_from_version_id,
            created_at: now,
        }
    }

    pub fn calculate_hash(snapshot: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(snapshot.as_bytes());
        let result = hasher.finalize();
        hex::encode(result)
    }
}