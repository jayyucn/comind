use serde::{Deserialize, Serialize};
use crate::{Block, RenderSegment};

/// Return type for `save_block_tree`: block + pre-built version snapshot + render segments.
/// Eliminates TS-side `_createBlockVersion` 4×IPC (getBlock/getPage/getProperties/getOutlinks),
/// and TS-side render-segment rebuild (editing→rendering gap).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockSaveResult {
    pub block: Block,
    /// JSON-serialized `BlockSnapshot` (block + properties + relationships),
    /// ready for `BlockVersionStore.scheduleVersion()` consumption.
    pub snapshot: String,
    /// Structured render instructions for `block.content`.
    /// Built during save so TS can restore link/dateRef rendering
    /// immediately instead of waiting for the next loadPageBlocks.
    #[serde(default)]
    pub render_segments: Vec<RenderSegment>,
}
