use serde::{Deserialize, Serialize};
use crate::Block;

/// Return type for `save_block_tree`: block + pre-built version snapshot.
/// Eliminates TS-side `_createBlockVersion` 4×IPC (getBlock/getPage/getProperties/getOutlinks).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockSaveResult {
    pub block: Block,
    /// JSON-serialized `BlockSnapshot` (block + properties + relationships),
    /// ready for `BlockVersionStore.scheduleVersion()` consumption.
    pub snapshot: String,
}
