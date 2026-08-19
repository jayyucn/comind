use serde::{Deserialize, Serialize};

// SyncTable lives in `types` (ungated) so the wasm build can report sync
// changes; re-exported here to keep the historical path stable.
pub use crate::types::SyncTable;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type")]
pub enum SyncMessage {
    RowChange {
        table: SyncTable,
        rows: Vec<RowPayload>,
        client_id: String,
    },
    FullSyncRequest {
        client_id: String,
        last_sync_at: Option<i64>,
    },
    FullSyncResponse {
        table: SyncTable,
        rows: Vec<RowPayload>,
        batch_index: usize,
        total_batches: usize,
        client_id: String,
    },
    PingPong {
        client_id: String,
        timestamp: i64,
    },
    Pairing {
        token: String,
        client_id: String,
        device_name: String,
    },
    PairingAck {
        server_client_id: String,
        paired: bool,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RowPayload {
    pub id: String,
    pub data: serde_json::Value,
    pub version: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(thiserror::Error, Debug)]
pub enum SyncError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid data: {0}")]
    InvalidData(String),
    #[error("serialization error: {0}")]
    Serialization(String),
    #[error("sync error: {0}")]
    Other(String),
}

pub type SyncResult<T> = Result<T, SyncError>;
