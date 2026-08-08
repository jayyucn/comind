use regex::Regex;
use std::collections::HashSet;
use std::error::Error;

use crate::storage::StorageAdapter;
use crate::services::LinkService;
use crate::services::PropertyService;

/// 从 content 解析出的链接草稿（尚未查 Page 表获取 target_page_id）
#[derive(Debug, Clone, PartialEq)]
pub struct LinkDraft {
    pub target_title: String,
    pub display_text: String,
    pub position: usize,
    pub is_external: bool,
    pub relationship_type: Option<String>,
    pub inverse_relationship_type: Option<String>,
}

/// 从 content 解析出的属性草稿
#[derive(Debug, Clone, PartialEq)]
pub struct PropertyDraft {
    pub key: String,
    pub value: String,
    pub r#type: String, // "boolean" | "date" | "page_ref" | "number" | "list" | "string"
}

/// 解析关系类型部分：`depends-on` / `depends-on<->required-by` / `depends-on!`
fn parse_relationship_part(part: &str) -> (Option<String>, Option<String>) {
    let trimmed = part.trim();

    // 格式 1: "type<->inverse"
    if let Some(caps) = Regex::new(r"^(.+)<->(.+)$").unwrap().captures(trimmed) {
        return (
            Some(caps[1].trim().to_string()),
            Some(caps[2].trim().to_string()),
        );
    }

    // 格式 2: "type!" (auto-inverse)
    if let Some(caps) = Regex::new(r"^(.+)!$").unwrap().captures(trimmed) {
        return (Some(caps[1].trim().to_string()), None);
        // Note: resolving actual inverse requires RelationshipType lookup.
        // Caller (useRelationshipSync TS) handles this; we just return None for auto.
    }

    // 格式 3: "type" (single direction)
    (Some(trimmed.to_string()), None)
}

/// 提取 content 中的所有链接（外部 + 内部 + 带类型）。
/// 返回值已按 position 升序排列、已去重。
pub fn extract_links_from_content(content: &str) -> Vec<LinkDraft> {
    let mut results: Vec<LinkDraft> = Vec::new();
    let mut covered_positions: HashSet<usize> = HashSet::new();

    // 1) External links: [[http(s)://...]], [[ftp://...]], [[mailto:...]]
    let external_re = Regex::new(r"\[\[(https?://|ftp://|mailto:)([^\]]*)\]\]").unwrap();
    for caps in external_re.captures_iter(content) {
        let m = caps.get(0).unwrap();
        let protocol = caps.get(1).unwrap().as_str();
        let rest = caps.get(2).map_or("", |r| r.as_str());
        let target = format!("{}{}", protocol, rest).trim().to_string();
        results.push(LinkDraft {
            target_title: target.clone(),
            display_text: target,
            position: m.start(),
            is_external: true,
            relationship_type: None,
            inverse_relationship_type: None,
        });
        for pos in m.start()..m.end() {
            covered_positions.insert(pos);
        }
    }

    // 2) Typed internal links: ((type))[[target|alias]] or ((type))[[target]]
    let typed_re =
        Regex::new(r"\(\(([^)]+)\)\)\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]").unwrap();
    for caps in typed_re.captures_iter(content) {
        let m = caps.get(0).unwrap();
        let target = caps.get(2).unwrap().as_str().trim();
        // Skip external-looking targets inside typed links
        if target.starts_with("http") || target.starts_with("ftp") || target.starts_with("mailto") {
            continue;
        }
        let rel_part = caps.get(1).unwrap().as_str();
        let alias = caps.get(3).map(|a| a.as_str().trim()).unwrap_or(target);
        let (rel_type, inverse) = parse_relationship_part(rel_part);
        results.push(LinkDraft {
            target_title: target.to_string(),
            display_text: alias.to_string(),
            position: m.start(),
            is_external: false,
            relationship_type: rel_type,
            inverse_relationship_type: inverse,
        });
        for pos in m.start()..m.end() {
            covered_positions.insert(pos);
        }
    }

    // 3) Plain internal links: [[target|alias]] or [[target]]
    let internal_re = Regex::new(r"\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]").unwrap();
    for caps in internal_re.captures_iter(content) {
        let m = caps.get(0).unwrap();
        let target = caps.get(1).unwrap().as_str().trim();
        // Skip external targets
        if target.starts_with("http") || target.starts_with("ftp") || target.starts_with("mailto")
        {
            continue;
        }
        // Skip if this match's positions are already covered by a typed link
        if covered_positions.contains(&m.start()) {
            continue;
        }
        let alias = caps.get(2).map(|a| a.as_str().trim()).unwrap_or(target);
        results.push(LinkDraft {
            target_title: target.to_string(),
            display_text: alias.to_string(),
            position: m.start(),
            is_external: false,
            relationship_type: None,
            inverse_relationship_type: None,
        });
    }

    // Sort by position
    results.sort_by_key(|l| l.position);
    // Deduplicate by position
    let mut seen = HashSet::new();
    results.retain(|l| seen.insert(l.position));
    results
}

/// 提取 content 中的属性（`key:: value` 格式，key 以 Unicode 字母或 _ 开头）
pub fn extract_properties_from_content(content: &str) -> Vec<PropertyDraft> {
    let prop_re = Regex::new(r"(?m)^([\p{L}_][\p{L}\p{N}_]*)::\s*(.+)$").unwrap();
    let mut results = Vec::new();
    for caps in prop_re.captures_iter(content) {
        let key = caps.get(1).unwrap().as_str().to_string();
        let raw_value = caps.get(2).unwrap().as_str().trim().to_string();
        let (inferred_type, value) = infer_property_value(&raw_value);
        results.push(PropertyDraft {
            key,
            value,
            r#type: inferred_type.to_string(),
        });
    }
    results
}

/// 属性值类型推断（含值提取，如 date 保留原始字符串但 type 标记为 "date"）
fn infer_property_value(raw: &str) -> (&'static str, String) {
    let trimmed = raw.trim();

    if trimmed == "true" || trimmed == "false" {
        return ("boolean", trimmed.to_string());
    }

    if Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap().is_match(trimmed) {
        return ("date", trimmed.to_string());
    }

    // page reference: [[page]]
    if let Some(caps) = Regex::new(r"^\[\[([^\]]+)\]\]$")
        .unwrap()
        .captures(trimmed)
    {
        return ("page_ref", caps[1].to_string());
    }

    if Regex::new(r"^\d+\.?\d*$").unwrap().is_match(trimmed) {
        return ("number", trimmed.to_string());
    }

    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return ("list", trimmed[1..trimmed.len() - 1].to_string());
    }

    ("string", trimmed.to_string())
}

/// 对 Block 内容中所有指向 target_title 的链接应用新的关系类型。
///
/// - 若 new_relationship_type 为 None：移除 ((type)) 前缀
/// - 若 new_relationship_type 为 Some：链接已有 type 则替换，否则追加
pub fn apply_relationship_type_to_block_content(
    content: &str,
    target_title: &str,
    new_relationship_type: Option<&str>,
) -> String {
    let escaped = regex::escape(target_title);
    // Single regex that optionally captures ((type)) prefix
    let pattern = format!(
        r"(?:\(\(([^)]+)\)\))?\[\[({})(?:\|[^\]]+?)?\]\]",
        escaped
    );
    let re = Regex::new(&pattern).unwrap();

    let mut result = String::new();
    let mut last_end = 0;

    for caps in re.captures_iter(content) {
        let m = caps.get(0).unwrap();
        let target = caps.get(2).unwrap().as_str(); // the title inside [[...]]

        // Copy text before this match
        result.push_str(&content[last_end..m.start()]);

        let has_type_prefix = caps.get(1).is_some(); // ((type)) group present

        if let Some(new_type) = new_relationship_type {
            result.push_str(&format!("(({}))[[{}]]", new_type, target));
        } else if has_type_prefix {
            // Remove type prefix
            result.push_str(&format!("[[{}]]", target));
        } else {
            // No type, no new type → keep as-is
            result.push_str(m.as_str());
        }

        last_end = m.end();
    }

    result.push_str(&content[last_end..]);
    result
}

// ---- ContentParseService: business-logic entry point ----

pub struct ContentParseService;

impl ContentParseService {
    /// 同步一个 block 的 links 到存储层。
    /// 解析 content 中的内部链接 → 查 Page 表获取 target_page_id →
    /// 构造 Link 对象 → 调用 LinkService::sync_links_for_block。
    /// 跳过外部链接（http/ftp/mailto）。
    pub fn sync_links_for_block(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        content: &str,
    ) -> Result<Vec<crate::types::Link>, Box<dyn Error>> {
        let drafts = extract_links_from_content(content);
        let internal_drafts: Vec<&LinkDraft> =
            drafts.iter().filter(|d| !d.is_external).collect();

        if internal_drafts.is_empty() {
            // No internal links → delete all existing links for this block
            LinkService::delete_by_source_block_id(storage, block_id)?;
            return Ok(vec![]);
        }

        let mut new_links = Vec::new();
        let now = chrono::Utc::now().timestamp_millis();

        for draft in &internal_drafts {
            // Look up target page
            if let Ok(Some(target_page)) =
                crate::storage::repository::PageRepository::get_by_title(
                    storage.pages(),
                    &draft.target_title,
                )
            {
                let link = crate::types::Link {
                    id: ContentParseService::generate_id(),
                    source_block_id: block_id.to_string(),
                    target_page_id: target_page.id,
                    display_text: draft.display_text.clone(),
                    relationship_type: draft.relationship_type.clone(),
                    created_at: now,
                    updated_at: now,
                    version: 0,
                    deleted_at: None,
                };
                new_links.push(link);
            }
            // If page doesn't exist yet, skip — same as TS behaviour
            // (page check in store.blocks.ts:_syncBlockLinks)
        }

        LinkService::sync_links_for_block(storage, block_id, &new_links)
    }

    /// 同步一个 block 的 properties 到存储层。
    /// 解析 content 中的 `key:: value` 行 → upsert Property 行。
    /// 已有的 property 按 key 更新；不再出现在 content 中的删除。
    pub fn sync_properties_for_block(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        content: &str,
    ) -> Result<Vec<crate::types::Property>, Box<dyn Error>> {
        let drafts = extract_properties_from_content(content);

        // Collect keys that should exist
        let draft_keys: HashSet<&str> = drafts.iter().map(|d| d.key.as_str()).collect();

        // Get existing properties
        let existing = PropertyService::get_by_block_id(storage, block_id)?;

        // Delete properties whose keys are no longer in content
        for prop in &existing {
            if !draft_keys.contains(prop.key.as_str()) {
                PropertyService::delete(storage, &prop.id)?;
            }
        }

        let mut results = Vec::new();
        for draft in &drafts {
            let existing_prop = existing.iter().find(|p| p.key == draft.key);
            if let Some(prop) = existing_prop {
                // Update existing property if value or type changed
                if prop.value != draft.value || prop.r#type != draft.r#type {
                    let updated = PropertyService::update(
                        storage,
                        &prop.id,
                        Some(&draft.value),
                        Some(&draft.r#type),
                        None,
                        None,
                    )?;
                    results.push(updated);
                } else {
                    results.push(prop.clone());
                }
            } else {
                let created = PropertyService::create(
                    storage,
                    block_id,
                    &draft.key,
                    &draft.value,
                    &draft.r#type,
                    drafts.len() as i64, // sort_order
                    0,                   // is_hidden
                    1,                   // schema_version
                )?;
                results.push(created);
            }
        }

        Ok(results)
    }

    fn generate_id() -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
        hex::encode(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- extract_links_from_content ----

    #[test]
    fn test_extract_plain_internal_link() {
        let links = extract_links_from_content("这是 [[项目A]] 的链接");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_title, "项目A");
        assert_eq!(links[0].display_text, "项目A");
        assert!(!links[0].is_external);
        assert_eq!(links[0].relationship_type, None);
    }

    #[test]
    fn test_extract_link_with_alias() {
        let links = extract_links_from_content("这是 [[项目A|别名]] 的链接");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_title, "项目A");
        assert_eq!(links[0].display_text, "别名");
    }

    #[test]
    fn test_extract_typed_link() {
        let links = extract_links_from_content("((depends-on))[[项目A]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_title, "项目A");
        assert_eq!(links[0].relationship_type.as_deref(), Some("depends-on"));
    }

    #[test]
    fn test_extract_typed_link_with_alias() {
        let links = extract_links_from_content("((depends-on))[[项目A|别名]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_title, "项目A");
        assert_eq!(links[0].display_text, "别名");
        assert_eq!(links[0].relationship_type.as_deref(), Some("depends-on"));
    }

    #[test]
    fn test_extract_bidirectional_typed_link() {
        let links = extract_links_from_content("((depends-on<->required-by))[[项目A]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].relationship_type.as_deref(), Some("depends-on"));
        assert_eq!(
            links[0].inverse_relationship_type.as_deref(),
            Some("required-by")
        );
    }

    #[test]
    fn test_extract_auto_inverse_typed_link() {
        let links = extract_links_from_content("((depends-on!))[[项目A]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].relationship_type.as_deref(), Some("depends-on"));
        assert_eq!(links[0].inverse_relationship_type, None); // auto-inverse resolved elsewhere
    }

    #[test]
    fn test_extract_external_link() {
        let links = extract_links_from_content("访问 [[https://example.com]] 获取更多信息");
        assert_eq!(links.len(), 1);
        assert!(links[0].is_external);
        assert_eq!(links[0].target_title, "https://example.com");
    }

    #[test]
    fn test_extract_ftp_link() {
        let links = extract_links_from_content("文件在 [[ftp://server/file.zip]]");
        assert_eq!(links.len(), 1);
        assert!(links[0].is_external);
        assert_eq!(links[0].target_title, "ftp://server/file.zip");
    }

    #[test]
    fn test_extract_multiple_links_no_duplicate() {
        let links =
            extract_links_from_content("((depends-on))[[A]] 和 [[B]] 和 [[C]]");
        // ((depends-on))[[A]] is a typed link; [[A]] should NOT appear separately
        assert_eq!(links.len(), 3);
        let titles: Vec<&str> = links.iter().map(|l| l.target_title.as_str()).collect();
        assert!(titles.contains(&"A"));
        assert!(titles.contains(&"B"));
        assert!(titles.contains(&"C"));
        // Only one entry for A (the typed one)
        assert_eq!(links.iter().filter(|l| l.target_title == "A").count(), 1);
    }

    // ---- extract_properties_from_content ----

    #[test]
    fn test_extract_properties_basic() {
        let props = extract_properties_from_content("状态:: 进行中\n这是正文");
        assert_eq!(props.len(), 1);
        assert_eq!(props[0].key, "状态");
        assert_eq!(props[0].value, "进行中");
        assert_eq!(props[0].r#type, "string");
    }

    #[test]
    fn test_extract_properties_with_underscore_key() {
        let props = extract_properties_from_content("_internal:: yes");
        assert_eq!(props.len(), 1);
        assert_eq!(props[0].key, "_internal");
        assert_eq!(props[0].value, "yes");
    }

    #[test]
    fn test_extract_properties_multiple() {
        let props = extract_properties_from_content(
            "优先级:: P0\n截止:: 2026-04-20\n完成:: true\n数量:: 42\n标签:: [a, b]\n参考:: [[张三]]",
        );
        assert_eq!(props.len(), 6);
        assert_eq!(props[0].key, "优先级");
        assert_eq!(props[1].r#type, "date");
        assert_eq!(props[2].r#type, "boolean");
        assert_eq!(props[3].r#type, "number");
        assert_eq!(props[4].r#type, "list");
        assert_eq!(props[5].r#type, "page_ref");
    }

    #[test]
    fn test_extract_properties_numeric_key_start_fails() {
        // Key must start with Unicode letter or _, not digit
        let props = extract_properties_from_content("123:: bad");
        assert_eq!(props.len(), 0);
    }

    // ---- apply_relationship_type_to_block_content ----

    #[test]
    fn test_apply_relationship_add_to_plain_link() {
        let result =
            apply_relationship_type_to_block_content("前置 [[项目A]] 后置", "项目A", Some("depends-on"));
        assert_eq!(result, "前置 ((depends-on))[[项目A]] 后置");
    }

    #[test]
    fn test_apply_relationship_replace_existing() {
        let result = apply_relationship_type_to_block_content(
            "((is-a))[[项目A]]",
            "项目A",
            Some("depends-on"),
        );
        assert_eq!(result, "((depends-on))[[项目A]]");
    }

    #[test]
    fn test_apply_relationship_remove_type() {
        let result = apply_relationship_type_to_block_content(
            "((is-a))[[项目A]]",
            "项目A",
            None,
        );
        assert_eq!(result, "[[项目A]]");
    }

    #[test]
    fn test_apply_relationship_no_change_when_same() {
        let result = apply_relationship_type_to_block_content(
            "((depends-on))[[项目A]]",
            "项目A",
            Some("depends-on"),
        );
        assert_eq!(result, "((depends-on))[[项目A]]");
    }

    #[test]
    fn test_apply_relationship_only_matches_specific_target() {
        let result = apply_relationship_type_to_block_content(
            "[[项目A]] 和 [[项目B]]",
            "项目A",
            Some("depends-on"),
        );
        assert_eq!(result, "((depends-on))[[项目A]] 和 [[项目B]]");
    }
}
