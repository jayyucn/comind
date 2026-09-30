use serde::{Deserialize, Serialize};
use crate::{Block, RenderSegment};

/// Return type for `save_block_tree`: block + render segments.
/// Eliminates TS-side render-segment rebuild (editing→rendering gap).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockSaveResult {
    pub block: Block,
    /// Structured render instructions for `block.content`.
    /// Built during save so TS can restore link/dateRef rendering
    /// immediately instead of waiting for the next loadPageBlocks.
    #[serde(default)]
    pub render_segments: Vec<RenderSegment>,
}
