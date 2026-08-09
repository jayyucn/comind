use serde::{Serialize, Deserialize};

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

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SyncTable {
    Block,
    Page,
    Link,
    Property,
    DateRef,
    RelationshipType,
    Template,
    Notification,
    NotificationConfig,
}

impl SyncTable {
    pub fn as_str(&self) -> &'static str {
        match self {
            SyncTable::Block => "Block",
            SyncTable::Page => "Page",
            SyncTable::Link => "Link",
            SyncTable::Property => "Property",
            SyncTable::DateRef => "DateRef",
            SyncTable::RelationshipType => "RelationshipType",
            SyncTable::Template => "UserTemplate",
            SyncTable::Notification => "Notification",
            SyncTable::NotificationConfig => "NotificationConfig",
        }
    }

    pub fn all() -> &'static [SyncTable] {
        &[
            SyncTable::RelationshipType,
            SyncTable::Template,
            SyncTable::Page,
            SyncTable::Block,
            SyncTable::Link,
            SyncTable::Property,
            SyncTable::DateRef,
            SyncTable::Notification,
            SyncTable::NotificationConfig,
        ]
    }
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
