use serde::{Deserialize, Serialize};

/// The persisted tables that the sync layer tracks. Pure data (no tokio/tauri
/// deps) so the write-path orchestration can report sync changes from wasm
/// builds too — the `sync` module itself is native-only.
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
