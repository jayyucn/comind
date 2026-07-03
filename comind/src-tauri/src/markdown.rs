use comind_core::{
    services::{BlockService, PageService, PropertyService, RelationshipTypeService, TemplateService},
    storage::StorageAdapter,
    types::{Block, BlockTree, Page, Property, RelationshipType, UserTemplate},
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct ExportResult {
    pub pages_exported: usize,
    pub blocks_exported: usize,
    pub properties_exported: usize,
    pub relationship_types_exported: usize,
    pub templates_exported: usize,
    pub directory: String,
}

#[derive(Debug, Serialize)]
pub struct ImportResult {
    pub pages_imported: usize,
    pub blocks_imported: usize,
    pub properties_imported: usize,
    pub links_created: usize,
    pub relationship_types_imported: usize,
    pub templates_imported: usize,
    pub strategy: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ComindConfig {
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub relationship_types: Vec<RelationshipType>,
    #[serde(default)]
    pub templates: Vec<UserTemplate>,
    #[serde(default)]
    pub last_sync_time: i64,
}

fn default_version() -> String {
    "1.0".to_string()
}

impl Default for ComindConfig {
    fn default() -> Self {
        Self {
            version: "1.0".to_string(),
            relationship_types: Vec::new(),
            templates: Vec::new(),
            last_sync_time: 0,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct PageMetadata {
    pub id: String,
    pub r#type: String,
    pub icon: Option<String>,
    pub aliases: String,
    pub block_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub properties: Vec<Property>,
}

fn sanitize_filename(title: &str) -> String {
    let invalid_chars: HashSet<char> = ['/', '\\', ':', '*', '?', '"', '<', '>', '|'].into();
    title.chars().map(|c| if invalid_chars.contains(&c) { '_' } else { c }).collect()
}

fn parse_block_content(line: &str) -> (String, String, String) {
    let heading_re = Regex::new(r"^(#{1,3})\s+(.+)").unwrap();
    let bullet_re = Regex::new(r"^-\s+(.+)").unwrap();

    if let Some(captures) = heading_re.captures(line) {
        let level = captures[1].len() as i64;
        let content = captures[2].to_string();
        let format = format!("{{\"type\":\"heading\",\"level\":{}}}", level);
        (content, format, "heading".to_string())
    } else if let Some(captures) = bullet_re.captures(line) {
        let content = captures[1].to_string();
        let format = "{}".to_string();
        let r#type = if content.contains("::") { "property" } else { "bullet" };
        (content, format, r#type.to_string())
    } else {
        (line.to_string(), "{}".to_string(), "bullet".to_string())
    }
}

fn parse_link(content: &str) -> Vec<(String, Option<String>)> {
    let typed_link_re = Regex::new(r"\(\(([^)]+)\)\)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap();
    let plain_link_re = Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap();
    let mut links = Vec::new();

    for cap in typed_link_re.find_iter(content) {
        let captures = typed_link_re.captures(cap.as_str()).unwrap();
        let rel_type = captures[1].to_string();
        let target = captures[2].to_string();
        links.push((target, Some(rel_type)));
    }

    for cap in plain_link_re.find_iter(content) {
        let captures = plain_link_re.captures(cap.as_str()).unwrap();
        let target = captures[1].to_string();
        links.push((target, None));
    }

    links
}

fn serialize_block_tree(
    tree: &BlockTree,
    properties: &[Property],
) -> String {
    let mut lines = Vec::new();

    fn dfs(
        tree: &BlockTree,
        properties: &[Property],
        block_ids: &[String],
        depth: usize,
        lines: &mut Vec<String>,
    ) {
        for block_id in block_ids {
            let block = tree.block_map.get(block_id).unwrap();
            let indent = "  ".repeat(depth);

            if block.r#type == "heading" {
                let format: serde_json::Value = serde_json::from_str(&block.format).unwrap_or_default();
                let level = format.get("level").and_then(|v| v.as_i64()).unwrap_or(1);
                let hashes = "#".repeat(level as usize);
                lines.push(format!("{}{} {}", indent, hashes, block.content));
            } else {
                lines.push(format!("{}- {}", indent, block.content));
            }

            let children = tree.children_map.get(block_id);
            let children = if let Some(c) = children { c } else { &vec![] };
            dfs(tree, properties, children, depth + 1, lines);
        }
    }

    dfs(tree, properties, &tree.root_blocks, 0, &mut lines);
    lines.join("\n")
}

fn serialize_page_metadata(page: &Page, properties: &[Property]) -> String {
    let metadata = PageMetadata {
        id: page.id.clone(),
        r#type: page.r#type.clone(),
        icon: page.icon.clone(),
        aliases: page.aliases.clone(),
        block_id: page.block_id.clone(),
        created_at: page.created_at,
        updated_at: page.updated_at,
        properties: properties.to_vec(),
    };
    let json = serde_json::to_string(&metadata).unwrap_or_default();
    format!("<!-- comind: {} -->", json)
}

fn parse_page_metadata(content: &str) -> Option<PageMetadata> {
    let re = Regex::new(r"<!-- comind:\s*(.+?)\s*-->").unwrap();
    if let Some(captures) = re.captures(content) {
        let json_str = captures[1].to_string();
        serde_json::from_str(&json_str).ok()
    } else {
        None
    }
}

pub fn export_all(
    storage: &mut dyn StorageAdapter,
    dir: &Path,
) -> Result<ExportResult, Box<dyn Error>> {
    fs::create_dir_all(dir)?;

    let pages = PageService::get_all(storage)?;
    let pages: Vec<Page> = pages.into_iter().filter(|p| p.deleted == 0).collect();

    let relationship_types = RelationshipTypeService::get_all(storage)?;
    let relationship_types: Vec<RelationshipType> = relationship_types
        .into_iter()
        .filter(|rt| rt.deleted == 0 && rt.builtin == 0)
        .collect();

    let templates = TemplateService::get_all(storage)?;

    let mut pages_exported = 0;
    let mut blocks_exported = 0;
    let mut properties_exported = 0;

    for page in &pages {
        let tree = BlockService::build_tree(storage, &page.id)?;
        let all_block_ids: Vec<String> = tree.block_map.keys().cloned().collect();

        let mut properties = Vec::new();
        for block_id in &all_block_ids {
            let props = PropertyService::get_by_block_id(storage, block_id)?;
            properties.extend(props);
        }

        let metadata_line = serialize_page_metadata(page, &properties);
        let content_lines = serialize_block_tree(&tree, &properties);

        let filename = format!("{}.md", sanitize_filename(&page.title));
        let file_path = dir.join(filename);
        let mut file = File::create(&file_path)?;
        writeln!(file, "{}", metadata_line)?;
        writeln!(file)?;
        writeln!(file, "{}", content_lines)?;

        pages_exported += 1;
        blocks_exported += tree.block_map.len();
        properties_exported += properties.len();
    }

    let config = ComindConfig {
        version: "1.0".to_string(),
        relationship_types,
        templates,
        last_sync_time: chrono::Utc::now().timestamp_millis(),
    };
    let config_path = dir.join(".comind.json");
    fs::write(&config_path, serde_json::to_string_pretty(&config)?)?;

    Ok(ExportResult {
        pages_exported,
        blocks_exported,
        properties_exported,
        relationship_types_exported: config.relationship_types.len(),
        templates_exported: config.templates.len(),
        directory: dir.to_string_lossy().to_string(),
    })
}

pub fn export_changed(
    storage: &mut dyn StorageAdapter,
    dir: &Path,
) -> Result<ExportResult, Box<dyn Error>> {
    fs::create_dir_all(dir)?;

    let config_path = dir.join(".comind.json");
    let mut config = if config_path.exists() {
        let content = fs::read_to_string(&config_path)?;
        serde_json::from_str(&content)?
    } else {
        ComindConfig::default()
    };

    let last_sync_time = config.last_sync_time;
    let now = chrono::Utc::now().timestamp_millis();

    let pages = PageService::get_all(storage)?;
    let changed_pages: Vec<Page> = pages
        .into_iter()
        .filter(|p| p.deleted == 0 && p.updated_at > last_sync_time)
        .collect();

    let relationship_types = RelationshipTypeService::get_all(storage)?;
    let changed_relationship_types: Vec<RelationshipType> = relationship_types
        .into_iter()
        .filter(|rt| rt.deleted == 0 && rt.builtin == 0 && rt.updated_at > last_sync_time)
        .collect();

    let templates = TemplateService::get_all(storage)?;
    let changed_templates: Vec<UserTemplate> = templates
        .into_iter()
        .filter(|t| t.updated_at > last_sync_time)
        .collect();

    let mut pages_exported = 0;
    let mut blocks_exported = 0;
    let mut properties_exported = 0;

    for page in &changed_pages {
        let tree = BlockService::build_tree(storage, &page.id)?;
        let all_block_ids: Vec<String> = tree.block_map.keys().cloned().collect();

        let mut properties = Vec::new();
        for block_id in &all_block_ids {
            let props = PropertyService::get_by_block_id(storage, block_id)?;
            properties.extend(props);
        }

        let metadata_line = serialize_page_metadata(page, &properties);
        let content_lines = serialize_block_tree(&tree, &properties);

        let filename = format!("{}.md", sanitize_filename(&page.title));
        let file_path = dir.join(filename);
        let mut file = File::create(&file_path)?;
        writeln!(file, "{}", metadata_line)?;
        writeln!(file)?;
        writeln!(file, "{}", content_lines)?;

        pages_exported += 1;
        blocks_exported += tree.block_map.len();
        properties_exported += properties.len();
    }

    if !changed_relationship_types.is_empty() {
        for rt in &changed_relationship_types {
            if let Some(index) = config.relationship_types.iter().position(|r| r.id == rt.id) {
                config.relationship_types[index] = rt.clone();
            } else {
                config.relationship_types.push(rt.clone());
            }
        }
    }

    if !changed_templates.is_empty() {
        for t in &changed_templates {
            if let Some(index) = config.templates.iter().position(|temp| temp.id == t.id) {
                config.templates[index] = t.clone();
            } else {
                config.templates.push(t.clone());
            }
        }
    }

    config.last_sync_time = now;
    fs::write(&config_path, serde_json::to_string_pretty(&config)?)?;

    Ok(ExportResult {
        pages_exported,
        blocks_exported,
        properties_exported,
        relationship_types_exported: changed_relationship_types.len(),
        templates_exported: changed_templates.len(),
        directory: dir.to_string_lossy().to_string(),
    })
}

pub fn import_all(
    storage: &mut dyn StorageAdapter,
    dir: &Path,
    strategy: &str,
) -> Result<ImportResult, Box<dyn Error>> {
    let md_files = fs::read_dir(dir)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| {
            let path = entry.path();
            path.is_file() && path.extension().map_or(false, |ext| ext == "md")
        })
        .collect::<Vec<_>>();

    let config_path = dir.join(".comind.json");
    let config = if config_path.exists() {
        let content = fs::read_to_string(&config_path)?;
        serde_json::from_str(&content)?
    } else {
        ComindConfig::default()
    };

    let mut pages_imported = 0;
    let mut blocks_imported = 0;
    let mut properties_imported = 0;
    let mut links_created = 0;
    let mut relationship_types_imported = 0;
    let mut templates_imported = 0;

    if strategy == "replace" {
        let pages = PageService::get_all(storage)?;
        for page in &pages {
            if page.deleted == 0 {
                let blocks = BlockService::get_by_page_id(storage, &page.id)?;
                for block in &blocks {
                    PropertyService::delete_by_block_id(storage, &block.id)?;
                    comind_core::services::LinkService::delete_by_source_block_id(storage, &block.id)?;
                }
                comind_core::services::LinkService::delete_by_target_page_id(storage, &page.id)?;
                BlockService::delete_by_page_id(storage, &page.id)?;
                PageService::delete(storage, &page.id)?;
            }
        }

        let rts = RelationshipTypeService::get_all(storage)?;
        for rt in &rts {
            if rt.builtin == 0 {
                RelationshipTypeService::delete(storage, &rt.id)?;
            }
        }

        let templates = TemplateService::get_all(storage)?;
        for t in &templates {
            TemplateService::delete(storage, &t.id)?;
        }
    }

    for rt in &config.relationship_types {
        let existing = RelationshipTypeService::get_by_type(storage, &rt.r#type).ok().flatten();
        if let Some(mut existing) = existing {
            existing.label = rt.label.clone();
            existing.inverse_label = rt.inverse_label.clone();
            existing.color = rt.color.clone();
            existing.order = rt.order;
            existing.strength = rt.strength.clone();
            RelationshipTypeService::update(
                storage,
                &existing.id,
                Some(&existing.label),
                Some(&existing.inverse_label),
                Some(&existing.color),
                Some(existing.order),
                Some(&existing.strength),
            )?;
        } else {
            RelationshipTypeService::create(
                storage,
                &rt.r#type,
                rt.inverse.as_deref(),
                &rt.label,
                &rt.inverse_label,
                &rt.color,
                rt.order,
                &rt.strength,
                0,
            )?;
        }
        relationship_types_imported += 1;
    }

    for t in &config.templates {
        let existing = TemplateService::get_all(storage).ok()
            .and_then(|all| all.into_iter().find(|temp| temp.name == t.name));
        if let Some(mut existing) = existing {
            existing.category = t.category.clone();
            existing.content = t.content.clone();
            TemplateService::update(storage, &existing.id, None, Some(&existing.category), Some(&existing.content))?;
        } else {
            TemplateService::create(storage, &t.name, &t.category, &t.content)?;
        }
        templates_imported += 1;
    }

    let mut title_to_page_id: HashMap<String, String> = HashMap::new();

    for entry in &md_files {
        let content = fs::read_to_string(entry.path())?;
        let metadata = match parse_page_metadata(&content) {
            Some(m) => m,
            None => continue,
        };

        let existing_page = PageService::get_by_title(storage, &metadata.id).ok().flatten()
            .or_else(|| PageService::get_by_title(storage, &entry.path().file_stem().unwrap_or_default().to_string_lossy()).ok().flatten());

        let page = if let Some(mut existing) = existing_page {
            if strategy == "merge" {
                let blocks = BlockService::get_by_page_id(storage, &existing.id)?;
                for block in &blocks {
                    PropertyService::delete_by_block_id(storage, &block.id)?;
                    comind_core::services::LinkService::delete_by_source_block_id(storage, &block.id)?;
                }
                comind_core::services::LinkService::delete_by_target_page_id(storage, &existing.id)?;
                BlockService::delete_by_page_id(storage, &existing.id)?;
            }

            PageService::update(
                storage,
                &existing.id,
                Some(&entry.path().file_stem().unwrap_or_default().to_string_lossy()),
                Some(&metadata.r#type),
                metadata.icon.as_deref(),
                None,
                Some(&metadata.aliases),
                None,
                Some(0),
                Some(0),
            )?
        } else {
            PageService::create(
                storage,
                &metadata.block_id.clone().unwrap_or_default(),
                &entry.path().file_stem().unwrap_or_default().to_string_lossy(),
                Some(&metadata.r#type),
                metadata.icon.as_deref(),
                None,
                Some(&metadata.aliases),
                None,
            )?
        };

        title_to_page_id.insert(entry.path().file_stem().unwrap_or_default().to_string_lossy().to_string(), page.id.clone());
        pages_imported += 1;

        let lines: Vec<&str> = content.lines().skip(2).collect();
        let mut blocks: Vec<Block> = Vec::new();
        let mut parent_stack: Vec<String> = Vec::new();

        for line in lines {
            if line.trim().is_empty() {
                continue;
            }

            let depth = line.chars().take_while(|c| c == &' ').count() / 2;
            let trimmed = line.trim();

            while parent_stack.len() > depth {
                parent_stack.pop();
            }

            let (content, format, r#type) = parse_block_content(trimmed);
            let parent_id = parent_stack.last().cloned();

            let block = BlockService::create(
                storage,
                &page.id,
                parent_id.as_deref(),
                &content,
                &format,
                &r#type,
            )?;

            parent_stack.push(block.id.clone());
            blocks.push(block);
            blocks_imported += 1;
        }

        for prop in &metadata.properties {
            PropertyService::create(
                storage,
                &prop.block_id,
                &prop.key,
                &prop.value,
                &prop.r#type,
                prop.sort_order,
                prop.is_hidden,
                prop.schema_version,
            )?;
            properties_imported += 1;
        }

        for block in &blocks {
            let links = parse_link(&block.content);
            for (target_title, rel_type) in links {
                if let Some(target_page_id) = title_to_page_id.get(&target_title) {
                    comind_core::services::LinkService::create(
                        storage,
                        &block.id,
                        target_page_id,
                        &target_title,
                        rel_type.as_deref(),
                    )?;
                    links_created += 1;
                }
            }
        }
    }

    Ok(ImportResult {
        pages_imported,
        blocks_imported,
        properties_imported,
        links_created,
        relationship_types_imported,
        templates_imported,
        strategy: strategy.to_string(),
    })
}