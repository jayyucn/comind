use crate::{
    types::{Block, BlockRenderData, PageWithBlocks, RenderSegment},
    storage::repository,
    services::{DateRefService, PropertyService},
};
use std::collections::HashMap;
use std::error::Error;

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
            // Extend to include emoji + |params
            let mut end = start + pattern.len();
            let rest = content[end..].chars();
            for ch in rest {
                if ch == '\u{1F4C5}' || ch == '\u{23F0}' {
                    end += ch.len_utf8();
                } else if ch == '|' {
                    break;
                } else {
                    break;
                }
            }
            if end < content.len() && content.as_bytes()[end] == b'|' {
                end += 1;
                let rest_bytes = &content[end..];
                if let Some(space) = rest_bytes.find(|ch: char| ch.is_whitespace() || ch == '}' || ch == '\u{1F4C5}' || ch == '\u{23F0}') {
                    end += space;
                } else {
                    end = content.len();
                }
            }

            let kind = &dr.kind;
            let recurrence = if dr.recurrence.is_empty() { "none" } else { &dr.recurrence };
            let is_overdue = kind == "deadline" && is_date_past(&dr.iso);

            anchors.push((start, RenderSegment::DateRef {
                start, end,
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
            if let Some(rt) = &link.relationship_type {
                let (label, color) = rel_cache.get(rt.as_str())
                    .cloned()
                    .unwrap_or_else(|| (rt.clone(), "#9CA3AF".to_string()));
                anchors.push((s, RenderSegment::TypedLink {
                    start: s, end: e,
                    target_page_title: target_title.clone(),
                    display_text: display.clone(),
                    relationship_type: rt.clone(),
                    rel_label: label,
                    rel_color: color,
                }));
            } else {
                anchors.push((s, RenderSegment::Link {
                    start: s, end: e,
                    target_page_title: target_title.clone(),
                    display_text: display.clone(),
                }));
            }
        }
    }

    // Sort, fill gaps
    anchors.sort_by_key(|(s, _)| *s);
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
            RenderSegment::DateRef { end, .. } => *end,
        };
        segments.push(seg);
    }
    if cursor < content.len() {
        segments.push(RenderSegment::Text { start: cursor, end: content.len() });
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
