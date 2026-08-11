use crate::{
    types::{Block, BlockRenderData, PageWithBlocks, RenderSegment},
    storage::repository,
    services::{DateRefService, PropertyService},
};
use std::collections::HashMap;
use std::error::Error;

/// Build RenderSegment[] for a single block (for save-block-tree hot path).
/// Queries links + pages + relationship_types — all already in cache after BlockService::update/create.
pub fn build_segments_for_block(
    storage: &mut dyn repository::StorageAdapter,
    block: &Block,
) -> Result<Vec<RenderSegment>, Box<dyn Error>> {
    if block.r#type != "bullet" && block.r#type != "property" {
        return Ok(Vec::new());
    }

    let links = repository::LinkRepository::get_by_source_block_id(storage.links(), &block.id)?;
    let mut id_to_title: HashMap<String, String> = HashMap::new();
    for l in &links {
        if let Ok(p) = repository::PageRepository::get_by_id(storage.pages(), &l.target_page_id) {
            id_to_title.insert(l.target_page_id.clone(), p.title);
        }
    }

    let all_rel = repository::RelationshipTypeRepository::get_all(storage.relationship_types())?;
    let mut rel_cache: HashMap<String, (String, String)> = HashMap::new();
    for rt in &all_rel {
        rel_cache.insert(rt.r#type.clone(), (rt.label.clone(), rt.color.clone()));
    }

    build_segments(storage, block, &id_to_title, &rel_cache)
}

/// Builds a `PageWithBlocks` response for `get_page_with_blocks`.
pub fn build_page_with_blocks(
    storage: &mut dyn repository::StorageAdapter,
    page_id: &str,
) -> Result<PageWithBlocks, Box<dyn Error>> {
    let page = repository::PageRepository::get_by_id(storage.pages(), page_id)?;
    let blocks = repository::BlockRepository::get_by_page_id(storage.blocks(), page_id)?;

    // Build children map in document order
    let block_pos: HashMap<&str, i64> = blocks.iter().map(|b| (b.id.as_str(), b.pos)).collect();
    let mut children_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut root_ids: Vec<String> = Vec::new();
    for b in &blocks {
        if let Some(ref pid) = b.parent_id {
            children_map.entry(pid.clone()).or_default().push(b.id.clone());
        } else {
            root_ids.push(b.id.clone());
        }
    }
    for kids in children_map.values_mut() {
        kids.sort_by_key(|id| block_pos.get(id.as_str()).copied().unwrap_or(0));
    }
    root_ids.sort_by_key(|id| block_pos.get(id.as_str()).copied().unwrap_or(0));

    // --- Collect target_page_ids for batch title resolution ---
    let mut target_page_ids: Vec<String> = Vec::new();
    for b in &blocks {
        if b.r#type != "bullet" && b.r#type != "property" {
            continue;
        }
        let links = repository::LinkRepository::get_by_source_block_id(storage.links(), &b.id)?;
        for l in &links {
            target_page_ids.push(l.target_page_id.clone());
        }
    }

    // Batch resolve titles & relationship types
    let mut id_to_title: HashMap<String, String> = HashMap::new();
    for id in &target_page_ids {
        if let Ok(p) = repository::PageRepository::get_by_id(storage.pages(), id) {
            id_to_title.insert(id.clone(), p.title);
        }
    }

    let all_rel = repository::RelationshipTypeRepository::get_all(storage.relationship_types())?;
    // Cache: type → (label, color)
    let mut rel_cache: HashMap<String, (String, String)> = HashMap::new();
    for rt in &all_rel {
        rel_cache.insert(rt.r#type.clone(), (rt.label.clone(), rt.color.clone()));
    }

    // --- Build render data for each block ---
    let mut result: Vec<BlockRenderData> = Vec::new();
    for block in &blocks {
        let children = children_map.get(&block.id).cloned().unwrap_or_default();

        let segments = if block.r#type == "bullet" || block.r#type == "property" {
            build_segments(storage, block, &id_to_title, &rel_cache)?
        } else {
            Vec::new()
        };

        // Resolve block properties from Property table (zero extra queries — already in cache)
        let properties = PropertyService::get_by_block_id(storage, &block.id).unwrap_or_default();

        result.push(BlockRenderData {
            block: block.clone(),
            children,
            render_segments: segments,
            properties,
        });
    }

    Ok(PageWithBlocks { page, blocks: result })
}

/// Convert byte offset to Unicode scalar value (char) index.
/// Convert byte offset to UTF-16 code unit index (for JS compatibility).
/// JS strings use UTF-16 encoding; BMP chars (U+0000..U+FFFF) = 1 unit,
/// supplementary chars (e.g. emoji U+1F4C5) = 2 units (surrogate pair).
/// Rust's `chars().count()` counts Unicode scalar values (1 per emoji),
/// which mismatches JS `String.prototype.slice()` indexing.
fn byte_to_utf16_idx(content: &str, byte_idx: usize) -> usize {
    let mut utf16_len = 0;
    for (byte_pos, ch) in content.char_indices() {
        if byte_pos >= byte_idx {
            break;
        }
        utf16_len += ch.len_utf16();
    }
    utf16_len
}

/// Convert UTF-16 code unit index back to byte offset.
fn utf16_idx_to_byte_idx(content: &str, utf16_idx: usize) -> usize {
    let mut utf16_count = 0;
    for (byte_pos, ch) in content.char_indices() {
        if utf16_count >= utf16_idx {
            return byte_pos;
        }
        utf16_count += ch.len_utf16();
    }
    content.len()
}

/// Total UTF-16 code unit length of the string (matches JS `.length`).
fn utf16_len(content: &str) -> usize {
    content.chars().map(|c| c.len_utf16()).sum()
}

fn build_segments(
    storage: &mut dyn repository::StorageAdapter,
    block: &Block,
    id_to_title: &HashMap<String, String>,
    rel_cache: &HashMap<String, (String, String)>,
) -> Result<Vec<RenderSegment>, Box<dyn Error>> {
    let content = &block.content;
    let links = repository::LinkRepository::get_by_source_block_id(storage.links(), &block.id)?;
    let mut anchors: Vec<(usize, RenderSegment)> = Vec::new();

    // --- 1. Date refs ---
    let date_refs = DateRefService::extract_date_refs(content);
    for dr in &date_refs {
        let pattern = format!("@{}", dr.iso);
        if let Some(start) = content.find(&pattern) {
            // Extend to cover optional whitespace + emoji (📅/⏰) + |params
            let bytes = content.as_bytes();
            let mut end = start + pattern.len();

            // Step 1: optional whitespace + emoji
            if end < bytes.len() {
                let rest = &content[end..];
                let first_char = rest.chars().next().unwrap();
                if first_char == ' ' || first_char == '\u{00A0}' {
                    end += first_char.len_utf8();
                    if end < bytes.len() {
                        let next = content[end..].chars().next().unwrap();
                        if next == '📅' || next == '⏰' {
                            end += next.len_utf8();
                        }
                    }
                } else if first_char == '📅' || first_char == '⏰' {
                    end += first_char.len_utf8();
                }
            }

            // Step 2: |recurrence|leadMinutes (consumed until whitespace, }, or another emoji)
            if end < bytes.len() && bytes[end] == b'|' {
                end += 1;
                let rest = &content[end..];
                if let Some(term) = rest.find(|ch: char| ch.is_whitespace() || ch == '}' || ch == '📅' || ch == '⏰') {
                    end += term;
                } else {
                    end = content.len();
                }
            }

            let kind = &dr.kind;
            let recurrence = if dr.recurrence.is_empty() { "none" } else { &dr.recurrence };
            let is_overdue = kind == "deadline" && is_date_past(&dr.iso);

            // Convert byte offsets to UTF-16 indices for JS compatibility
            let char_start = byte_to_utf16_idx(content, start);
            let char_end = byte_to_utf16_idx(content, end);

            anchors.push((char_start, RenderSegment::DateRef {
                start: char_start, end: char_end,
                kind: kind.clone(),
                iso: dr.iso.clone(),
                recurrence: recurrence.to_string(),
                lead_minutes: dr.lead_minutes,
                is_overdue,
            }));
        }
    }

    // --- 2. Links (search by resolved title, not UUID) ---
    for link in &links {
        let target_title = id_to_title.get(&link.target_page_id)
            .cloned()
            .unwrap_or_default();
        if target_title.is_empty() { continue; }

        let display = if link.display_text.is_empty() { &target_title } else { &link.display_text };

        // Search for the link pattern in content
        let (start, end) = if let Some(rt) = &link.relationship_type {
            search_content(content, rt, &target_title, display)
        } else {
            search_plain_link(content, &target_title, display)
        };

        if let (Some(s), Some(e)) = (start, end) {
            // Convert byte offsets to UTF-16 indices for JS compatibility
            let char_start = byte_to_utf16_idx(content, s);
            let char_end = byte_to_utf16_idx(content, e);

            if let Some(rt) = &link.relationship_type {
                let (label, color) = rel_cache.get(rt.as_str())
                    .cloned()
                    .unwrap_or_else(|| (rt.clone(), "#9CA3AF".to_string()));
                anchors.push((char_start, RenderSegment::TypedLink {
                    start: char_start, end: char_end,
                    target_page_title: target_title.clone(),
                    display_text: display.clone(),
                    relationship_type: rt.clone(),
                    rel_label: label,
                    rel_color: color,
                }));
            } else {
                anchors.push((char_start, RenderSegment::Link {
                    start: char_start, end: char_end,
                    target_page_title: target_title.clone(),
                    display_text: display.clone(),
                }));
            }
        }
    }

    // Sort, fill gaps
    anchors.sort_by_key(|(s, _)| *s);
    let char_len = utf16_len(content);
    let mut segments = Vec::new();
    let mut cursor: usize = 0;
    for (pos, seg) in anchors {
        if pos < cursor { continue; }
        if pos > cursor {
            segments.push(RenderSegment::Text { start: cursor, end: pos });
        }
        cursor = match &seg {
            RenderSegment::Text { end, .. } => *end,
            RenderSegment::Link { end, .. } => *end,
            RenderSegment::TypedLink { end, .. } => *end,
            RenderSegment::ExternalLink { end, .. } => *end,
            RenderSegment::DateRef { end, .. } => {
                // dateRef 语法（`@ISO [emoji] [|params]`）之后的空白是分隔符，
                // 不属于任何文本段：跳过它们，避免后续 Text 段带前导空格。
                // 例："@2026-08-09 ⏰ 2026" → DateRef=[0,13)，Text=[14,18) 而非 [13,18)。
                let mut byte = utf16_idx_to_byte_idx(content, *end);
                let bytes = content.as_bytes();
                while byte < bytes.len() {
                    let ch = content[byte..].chars().next().unwrap();
                    if !ch.is_whitespace() {
                        break;
                    }
                    byte += ch.len_utf8();
                }
                byte_to_utf16_idx(content, byte)
            }
        };
        segments.push(seg);
    }
    // content.len() is byte length; convert to char count for consistency
    if cursor < char_len {
        segments.push(RenderSegment::Text { start: cursor, end: char_len });
    }
    Ok(segments)
}

/// Search for `((type))[[target|display]]` in content, return (start, end) offsets.
fn search_content(content: &str, rel_type: &str, target: &str, display: &str) -> (Option<usize>, Option<usize>) {
    // Try: ((type))[[target|display]]
    let p1 = format!("(({}))[[{}|{}]]", rel_type, target, display);
    if let Some(s) = content.find(&p1) {
        return (Some(s), Some(s + p1.len()));
    }
    // Try: ((type))[[target]]
    let p2 = format!("(({}))[[{}]]", rel_type, target);
    if let Some(s) = content.find(&p2) {
        return (Some(s), Some(s + p2.len()));
    }
    // Try: ((type))[[display]] (alias only)
    let p3 = format!("(({}))[[{}]]", rel_type, display);
    if let Some(s) = content.find(&p3) {
        return (Some(s), Some(s + p3.len()));
    }
    (None, None)
}

fn search_plain_link(content: &str, target: &str, display: &str) -> (Option<usize>, Option<usize>) {
    let p1 = format!("[[{}|{}]]", target, display);
    if let Some(s) = content.find(&p1) {
        return (Some(s), Some(s + p1.len()));
    }
    let p2 = format!("[[{}]]", target);
    if let Some(s) = content.find(&p2) {
        return (Some(s), Some(s + p2.len()));
    }
    let p3 = format!("[[{}]]", display);
    if let Some(s) = content.find(&p3) {
        return (Some(s), Some(s + p3.len()));
    }
    (None, None)
}

fn is_date_past(iso: &str) -> bool {
    let ds = &iso[..10.min(iso.len())];
    chrono::NaiveDate::parse_from_str(ds, "%Y-%m-%d")
        .map(|d| d < chrono::Local::now().naive_local().date())
        .unwrap_or(false)
}
