use serde::{Deserialize, Serialize};
use crate::{Block, Page};

/// Data returned by `get_page_with_blocks` — page metadata + sorted blocks with render instructions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageWithBlocks {
    pub page: Page,
    pub blocks: Vec<BlockRenderData>,
}

/// Single block's render data: raw block + pre-sorted child IDs + render instructions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockRenderData {
    pub block: Block,
    /// Child block IDs in document order (by pos).
    pub children: Vec<String>,
    /// Structured render instructions for `block.content`, covering the full character range
    /// without gaps. Use `block.content[start..end]` to extract the raw text for each segment.
    /// Empty for non-text block types (code, image, embed, query).
    pub render_segments: Vec<RenderSegment>,
}

/// A contiguous region of `block.content` mapped to a semantic category.
/// The TS renderer iterates segments in order, HTML-escapes text segments,
/// and wraps typed segments in appropriate `<span>` elements.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RenderSegment {
    /// Plain text between links/dateRefs.
    #[serde(rename = "text")]
    Text { start: usize, end: usize },

    /// Internal wiki link `[[target]]` or `[[target|alias]]`.
    #[serde(rename = "link")]
    Link {
        start: usize,
        end: usize,
        target_page_title: String,
        display_text: String,
    },

    /// Typed relationship link `((type))[[target|alias]]`.
    #[serde(rename = "typed_link")]
    TypedLink {
        start: usize,
        end: usize,
        target_page_title: String,
        display_text: String,
        relationship_type: String,
        rel_label: String,
        rel_color: String,
    },

    /// External link `[[https://...]]`.
    #[serde(rename = "external_link")]
    ExternalLink {
        start: usize,
        end: usize,
        url: String,
    },

    /// Date reference `@2026-08-03 ⏰|daily|30`.
    #[serde(rename = "date_ref")]
    DateRef {
        start: usize,
        end: usize,
        kind: String,
        iso: String,
        recurrence: String,
        lead_minutes: i64,
        is_overdue: bool,
    },
}
