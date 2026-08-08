use crate::{
    types::{BlockCard, DateRefLite, Property},
    storage::{repository, StorageAdapter},
};
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::error::Error;

/// Build a lightweight projection (`BlockCard[]`) of all non-deleted blocks,
/// with their properties and date_refs aggregated via HashMap lookup.
///
/// Strategy: three separate queries + Rust-side assembly (no single JOIN).
///  1. Query all non-deleted blocks
///  2. Query all non-deleted properties
///  3. Query all non-deleted date_refs
///  4. Assembly: HashMap by block_id
pub fn get_blocks_projection(
    storage: &mut dyn StorageAdapter,
) -> Result<Vec<BlockCard>, Box<dyn Error>> {
    // 1. All non-deleted blocks
    let blocks = repository::BlockRepository::get_all(storage.blocks())?;

    // 2. All non-deleted properties — indexed by block_id
    let properties = repository::PropertyRepository::get_all(storage.properties())?;
    let mut props_map: HashMap<String, Vec<Property>> = HashMap::new();
    for p in properties {
        props_map.entry(p.block_id.clone()).or_default().push(p);
    }

    // 3. All non-deleted date_refs — indexed by block_id
    let date_refs = repository::DateRefRepository::get_all(storage.date_refs())?;
    let mut dates_map: HashMap<String, Vec<DateRefLite>> = HashMap::new();
    for dr in date_refs {
        dates_map.entry(dr.block_id.clone()).or_default().push(DateRefLite {
            kind: dr.kind,
            iso: dr.iso,
            date_day: dr.date_day,
            recurrence: dr.recurrence,
            event_ts: dr.event_ts,
        });
    }

    // 4. Assemble
    let cards: Vec<BlockCard> = blocks
        .into_iter()
        .map(|b| {
            let props: HashMap<String, Value> = props_map
                .remove(&b.id)
                .unwrap_or_default()
                .into_iter()
                .map(|p| (p.key, parse_property_value(&p.value)))
                .collect();

            let dates: Vec<DateRefLite> = dates_map.remove(&b.id).unwrap_or_default();

            let preview = make_content_preview(&b.content);

            BlockCard {
                block_id: b.id,
                page_id: b.page_id,
                parent_id: b.parent_id.unwrap_or_default(),
                content_preview: preview,
                properties: props,
                date_refs: dates,
                updated_at: b.updated_at,
            }
        })
        .collect();

    Ok(cards)
}

/// Strip `{{schedule:...}}` and `{{deadline:...}}` patterns, truncate to 200 chars.
fn make_content_preview(content: &str) -> String {
    // Remove {{schedule:...}} and {{deadline:...}} patterns (lazy match to avoid over-grabbing)
    let re = Regex::new(r"\{\{(?:schedule|deadline):.+?\}\}").unwrap();
    let cleaned = re.replace_all(content, "").into_owned();

    // Collapse multiple whitespace to single space
    let re_ws = Regex::new(r"\s+").unwrap();
    let normalized = re_ws.replace_all(cleaned.trim(), " ").into_owned();

    // Truncate to 200 chars (grapheme-aware would be ideal, but char-boundary truncation is fine)
    if normalized.chars().count() > 200 {
        let truncated: String = normalized.chars().take(197).collect();
        format!("{}...", truncated)
    } else {
        normalized.to_string()
    }
}

/// Parse a JSON string property value into `serde_json::Value`.
/// Falls back to the raw string as a `Value::String` on parse error.
fn parse_property_value(json_str: &str) -> Value {
    serde_json::from_str(json_str).unwrap_or_else(|_| Value::String(json_str.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_make_content_preview_strips_schedule_deadline() {
        let input = "Review proposal {{schedule:2026-08-10}} and submit {{deadline:2026-08-15}} by Friday";
        let preview = make_content_preview(input);
        assert!(!preview.contains("{{schedule:"));
        assert!(!preview.contains("{{deadline:"));
        assert!(preview.contains("Review proposal"));
        assert!(preview.contains("and submit"));
        assert!(preview.contains("by Friday"));
    }

    #[test]
    fn test_make_content_preview_truncates() {
        let long = "a".repeat(300) + &" {{deadline:2026-08-15}}";
        let preview = make_content_preview(&long);
        assert!(preview.len() <= 203); // 200 + "..."
        assert!(!preview.contains("{{deadline:"));
    }

    #[test]
    fn test_parse_property_value_valid_json() {
        let v = parse_property_value("\"todo\"");
        assert_eq!(v, Value::String("todo".to_string()));
    }

    #[test]
    fn test_parse_property_value_fallback() {
        let v = parse_property_value("not-json");
        assert_eq!(v, Value::String("not-json".to_string()));
    }
}
