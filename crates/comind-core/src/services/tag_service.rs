use regex::Regex;
use std::collections::HashSet;
use std::error::Error;
use std::sync::OnceLock;

use crate::{
    storage::{repository, StorageAdapter},
    types::{Tag, TagCreateOptions},
};

pub struct TagService;

impl TagService {
    /// 提取 content 中的 `#foo` tag 名（联动数据源，grill 决策 #1）。
    ///
    /// tag 字符集 = **非** 空白 / `#` / 硬标点（ASCII + 全角）。`\S+` 的贪婪匹配会把
    /// `#工作。(#重点)` 吸成一个 token，硬标点必须直接排除出字符集；`.` `-` `_` `/`
    /// 属软字符（子路径风格 `#a.b` 保留），仅尾部 `.` 剥离（`#rust.` → `rust`）。
    pub fn extract_tags(content: &str) -> Vec<String> {
        Self::extract_tag_spans(content)
            .into_iter()
            .map(|(_, _, title)| title)
            .collect()
    }

    /// 位置感知版 `extract_tags`：返回 `(字节起始, 字节结束, title)`（span 含 `#` 本身），
    /// 供 render_segment_service 定位 `#foo` 渲染 chip。
    pub fn extract_tag_spans(content: &str) -> Vec<(usize, usize, String)> {
        static RE: OnceLock<Regex> = OnceLock::new();
        let re = RE.get_or_init(|| {
            Regex::new(r#"#([^\s#。，！？；：、（）【】《》「」『』(){}\[\]<>,;:!?"']+)"#)
                .unwrap()
        });
        re.captures_iter(content)
            .filter_map(|c| {
                let title = c[1].trim_end_matches('.');
                if title.is_empty() {
                    return None;
                }
                // span 截到剥离尾部 `.` 之后的真实 tag 末尾
                let group = c.get(1).unwrap();
                let title_end = group.start() + title.len();
                Some((group.start() - 1, title_end, title.to_string()))
            })
            .collect()
    }

    // ── CRUD（Repository 注入，ADR-0049 D6） ────────────────────

    pub fn get_by_id(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<Tag, Box<dyn Error>> {
        repository::TagRepository::get_by_id(storage.tags(), id)
    }

    pub fn get_by_title(
        storage: &mut dyn StorageAdapter,
        title: &str,
    ) -> Result<Option<Tag>, Box<dyn Error>> {
        repository::TagRepository::get_by_title(storage.tags(), title)
    }

    pub fn get_all(
        storage: &mut dyn StorageAdapter,
    ) -> Result<Vec<Tag>, Box<dyn Error>> {
        repository::TagRepository::get_all(storage.tags())
    }

    /// 创建 Tag：`extends` 在此处物化展开进 `field_ids`（D8）。
    pub fn create(
        storage: &mut dyn StorageAdapter,
        options: TagCreateOptions,
    ) -> Result<Tag, Box<dyn Error>> {
        let mut tag = Tag::new(options);
        tag.field_ids = Self::materialize_extends(storage, &tag.id, &tag.extends, tag.field_ids.clone())?;
        repository::TagRepository::create(storage.tags(), &tag)
    }

    /// 更新 Tag：改了 `extends` 或 `field_ids` 都重新物化（避免继承链漂移）。
    pub fn update(
        storage: &mut dyn StorageAdapter,
        id: &str,
        title: Option<&str>,
        field_ids: Option<Vec<String>>,
        extends: Option<Vec<String>>,
    ) -> Result<Tag, Box<dyn Error>> {
        let mut tag = repository::TagRepository::get_by_id(storage.tags(), id)?;
        Self::reject_system_tag(&tag, "update")?;

        if let Some(t) = title {
            tag.title = t.to_string();
        }
        if let Some(f) = field_ids {
            tag.field_ids = f;
        }
        if let Some(e) = extends {
            tag.extends = e;
        }

        tag.field_ids = Self::materialize_extends(storage, id, &tag.extends, tag.field_ids.clone())?;
        tag.updated_at = chrono::Utc::now().timestamp_millis();

        repository::TagRepository::update(storage.tags(), &tag)
    }

    /// 软删 Tag（级联软删语义，见 D6 用户裁定）。系统 seed 行拒删（grill 决策 #9）。
    pub fn delete(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<(), Box<dyn Error>> {
        let tag = repository::TagRepository::get_by_id(storage.tags(), id)?;
        Self::reject_system_tag(&tag, "delete")?;
        repository::TagRepository::delete(storage.tags(), id)
    }

    fn reject_system_tag(tag: &Tag, op: &str) -> Result<(), Box<dyn Error>> {
        if tag.is_system {
            return Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                format!("cannot {} system tag {} ({})", op, tag.id, tag.title),
            )));
        }
        Ok(())
    }

    // ── content 联动（grill 决策 #1：content 唯一打标入口） ─────────

    /// 把 content 里的 `#foo` 解析成 tag id 列表（含自动建/复活），供
    /// `BlockService::update` 派生写入 `Block.tags`。
    ///
    /// - 命中已有行（含系统 tag）→ 直接用其 id；
    /// - 命中**软删行** → 复活（title UNIQUE 被软删行占用，重建必撞约束；
    ///   与「悬空引用保留、复挂复活」同一精神）；
    /// - 未命中 → 自动建用户 tag（grill 决策 #2，title 精确匹配 #3）。
    pub fn resolve_tag_ids_for_content(
        storage: &mut dyn StorageAdapter,
        content: &str,
    ) -> Result<Vec<String>, Box<dyn Error>> {
        let mut ids: Vec<String> = Vec::new();
        let mut seen_titles: HashSet<String> = HashSet::new();
        for title in Self::extract_tags(content) {
            // 同一 content 内重复 #tag → 只记一次（Block.tags 不存重复 id）
            if !seen_titles.insert(title.clone()) {
                continue;
            }
            if let Some(existing) =
                repository::TagRepository::get_by_title(storage.tags(), &title)?
            {
                ids.push(existing.id);
                continue;
            }
            // 软删行占位 → 复活而非重建
            if let Some(deleted) =
                repository::TagRepository::get_by_title_including_deleted(storage.tags(), &title)?
            {
                repository::TagRepository::undelete(storage.tags(), &deleted.id)?;
                ids.push(deleted.id);
                continue;
            }
            let created = Self::create(storage, TagCreateOptions {
                title,
                field_ids: Vec::new(),
                extends: Vec::new(),
            })?;
            ids.push(created.id);
        }
        Ok(ids)
    }

    // ── 继承物化（D8） ────────────────────────────────────────

    /// 把父 Tag 的 `field_ids` 展开合并进自身的 `field_ids`。
    ///
    /// - **多父冲突**：后父覆盖前父、子覆盖所有父 → 去重保留**最后一次**出现。
    /// - **DFS 环检测**：祖先链中任何节点回指到自己（含直接自引用）则拒绝；
    ///   `visited` 同时保证多父菱形（非环）不会无限展开。
    fn materialize_extends(
        storage: &mut dyn StorageAdapter,
        self_id: &str,
        extends: &[String],
        own_field_ids: Vec<String>,
    ) -> Result<Vec<String>, Box<dyn Error>> {
        if extends.is_empty() {
            return Ok(dedup_keep_last(own_field_ids));
        }

        // 环检测：先把祖先链走一遍，命中自己即拒绝。
        let mut stack: Vec<String> = extends.to_vec();
        let mut visited: HashSet<String> = HashSet::new();
        while let Some(parent_id) = stack.pop() {
            if parent_id == self_id {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("tag extends cycle detected: {} -> {}", self_id, self_id),
                )));
            }
            if !visited.insert(parent_id.clone()) {
                continue;
            }
            if let Ok(parent) = repository::TagRepository::get_by_id(storage.tags(), &parent_id) {
                stack.extend(parent.extends.iter().cloned());
            }
        }

        // 物化：父按 `extends` 顺序在前，自身在后 —— 后者覆盖前者。
        let mut merged: Vec<String> = Vec::new();
        for parent_id in extends {
            if let Ok(parent) = repository::TagRepository::get_by_id(storage.tags(), parent_id) {
                merged.extend(parent.field_ids.iter().cloned());
            }
        }
        merged.extend(own_field_ids);

        Ok(dedup_keep_last(merged))
    }
}

/// 去重保留**最后一次**出现（D8「后父覆盖前父、子覆盖所有父」的落地。
fn dedup_keep_last(ids: Vec<String>) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<String> = Vec::new();
    for id in ids.into_iter().rev() {
        if seen.insert(id.clone()) {
            out.push(id);
        }
    }
    out.reverse();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_tags_parses_hashtags() {
        let tags = TagService::extract_tags("hello #rust and #world");
        assert_eq!(tags, vec!["rust".to_string(), "world".to_string()]);
    }

    #[test]
    fn dedup_keep_last_prefers_last_occurrence() {
        let out = dedup_keep_last(vec![
            "a".to_string(),
            "b".to_string(),
            "a".to_string(),
            "c".to_string(),
        ]);
        // "a" 的最后一次出现胜出 → 顺序为 b, a, c
        assert_eq!(out, vec!["b".to_string(), "a".to_string(), "c".to_string()]);
    }

    #[test]
    fn dedup_keep_last_empty() {
        assert!(dedup_keep_last(vec![]).is_empty());
    }

    #[test]
    fn extract_tags_strips_trailing_punctuation() {
        // grill 实现注意项：正则贪婪会吸尾部标点，必须剥离
        let tags = TagService::extract_tags("#rust, #工作。(#重点) and #ok!");
        assert_eq!(
            tags,
            vec!["rust".to_string(), "工作".to_string(), "重点".to_string(), "ok".to_string()]
        );
    }

    #[test]
    fn extract_tags_mid_punctuation_is_part_of_tag() {
        // 尾部剥离只作用末尾：#a.b 中间的点保留（子路径风格不破坏）
        let tags = TagService::extract_tags("#a.b,");
        assert_eq!(tags, vec!["a.b".to_string()]);
    }

    #[test]
    fn resolve_creates_reuses_and_matches_system_tags() {
        use crate::storage::repository::TagRepository;

        let mut storage = crate::storage::sqlite::SQLiteAdapter::open_in_memory().unwrap();

        // ① 未命中 → 自动建
        let ids1 = TagService::resolve_tag_ids_for_content(&mut storage, "hello #rust").unwrap();
        assert_eq!(ids1.len(), 1);
        let created = TagRepository::get_by_id(storage.tags(), &ids1[0]).unwrap();
        assert_eq!(created.title, "rust");
        assert!(!created.is_system);

        // ② 再跑同一 content → 复用同一 id（不重建）
        let ids2 = TagService::resolve_tag_ids_for_content(&mut storage, "hello #rust").unwrap();
        assert_eq!(ids1, ids2);

        // ③ 系统标题精确命中系统 seed 行（不新建）
        let ids3 = TagService::resolve_tag_ids_for_content(&mut storage, "#系统任务").unwrap();
        assert_eq!(ids3.len(), 1);
        let sys = TagRepository::get_by_id(storage.tags(), &ids3[0]).unwrap();
        assert_eq!(sys.id, "sys-tag-system-task");
        assert!(sys.is_system);
        assert_eq!(sys.field_ids.len(), 4);

        // ④ 未知系统样名 #不存在系统tag 不会误命中（精确匹配）
        let ids4 = TagService::resolve_tag_ids_for_content(&mut storage, "#系统任").unwrap();
        assert_eq!(ids4.len(), 1);
        assert_ne!(ids4[0], "sys-tag-system-task");
    }

    #[test]
    fn resolve_revives_soft_deleted_tag() {
        let mut storage = crate::storage::sqlite::SQLiteAdapter::open_in_memory().unwrap();

        let ids1 = TagService::resolve_tag_ids_for_content(&mut storage, "#读书").unwrap();
        TagService::delete(&mut storage, &ids1[0]).unwrap();
        assert!(
            crate::storage::repository::TagRepository::get_by_title(storage.tags(), "读书")
                .unwrap()
                .is_none()
        );

        // 复挂 → 复活同一行（title UNIQUE 占位，重建必撞约束）
        let ids2 = TagService::resolve_tag_ids_for_content(&mut storage, "#读书").unwrap();
        assert_eq!(ids1, ids2);
        let revived =
            crate::storage::repository::TagRepository::get_by_id(storage.tags(), &ids2[0]).unwrap();
        assert!(revived.deleted_at.is_none());
    }

    #[test]
    fn system_tag_rejects_delete_and_update() {
        let mut storage = crate::storage::sqlite::SQLiteAdapter::open_in_memory().unwrap();

        let err = TagService::delete(&mut storage, "sys-tag-system-task").unwrap_err();
        assert!(err.to_string().contains("cannot delete system tag"));

        let err = TagService::update(&mut storage, "sys-tag-system-task", Some("新名"), None, None)
            .unwrap_err();
        assert!(err.to_string().contains("cannot update system tag"));
    }
}
