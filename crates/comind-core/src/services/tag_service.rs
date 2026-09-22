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

    /// 创建 Tag：`field_ids` 只记自身字段（继承不物化，ADR-0050 D10）。
    pub fn create(
        storage: &mut dyn StorageAdapter,
        options: TagCreateOptions,
    ) -> Result<Tag, Box<dyn Error>> {
        let tag = Tag::new(options);
        repository::TagRepository::create(storage.tags(), &tag)
    }

    /// 更新 Tag 的标题 / 自身字段集合（父关系走 `set_parent`）。
    pub fn update(
        storage: &mut dyn StorageAdapter,
        id: &str,
        title: Option<&str>,
        field_ids: Option<Vec<String>>,
    ) -> Result<Tag, Box<dyn Error>> {
        let mut tag = repository::TagRepository::get_by_id(storage.tags(), id)?;
        Self::reject_system_tag(&tag, "update")?;

        if let Some(t) = title {
            tag.title = t.to_string();
        }
        if let Some(f) = field_ids {
            tag.field_ids = f;
        }
        tag.updated_at = chrono::Utc::now().timestamp_millis();

        repository::TagRepository::update(storage.tags(), &tag)
    }

    /// 设置单父（`None` = 清空 / 回到顶级）。ADR-0050 D10。
    ///
    /// **环守卫**：沿待设父的祖先链上溯，命中自身即拒绝（含直接自引用）——继承链必须可解析。
    /// 父不存在 / 已软删不拒（悬空引用保留语义同 `Block.tags`；解析侧跳过不存在的节点）。
    /// 系统 tag 拒改（延续 `reject_system_tag`：seed 行拒删拒改名拒改父）。
    pub fn set_parent(
        storage: &mut dyn StorageAdapter,
        id: &str,
        parent_id: Option<&str>,
    ) -> Result<Tag, Box<dyn Error>> {
        let mut tag = repository::TagRepository::get_by_id(storage.tags(), id)?;
        Self::reject_system_tag(&tag, "set parent of")?;

        let mut cursor = parent_id.map(|s| s.to_string());
        let mut visited: HashSet<String> = HashSet::new();
        while let Some(pid) = cursor {
            if pid == id {
                return Err(Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidInput,
                    format!("tag parent cycle detected: {} -> {}", id, id),
                )));
            }
            if !visited.insert(pid.clone()) {
                // 库里已有脏数据成环：停止上溯，不再继续走（不 panic）
                break;
            }
            cursor = match repository::TagRepository::get_by_id(storage.tags(), &pid) {
                Ok(p) => p.parent_id.clone(),
                Err(_) => break,
            };
        }

        tag.parent_id = parent_id.map(|s| s.to_string());
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
                parent_id: None,
            })?;
            ids.push(created.id);
        }
        Ok(ids)
    }

    // ── 继承：读取侧解析（ADR-0050 D10，取代 ADR-0049 D8 写时物化） ──────

    /// 有效字段模板 = **自身字段优先**，其次直接父，再次更近祖先；**同名近者胜**（同 id 亦近者胜）。
    ///
    /// 「同名」指 FieldDefinition.title 相同——一个祖先链上只能有一个「工时」，更近的声明遮蔽
    /// 更远的（ADR-0050 D10）。两份同名字段若各持不同 id（各标签各自「+ 添加字段」所致），
    /// 只保留更近的那份定义 id。定义行读不到（悬空引用 / 已软删）时按 id 语义收录，不做异常处理。
    ///
    /// 每次读取都重新上溯，因此「父标签加字段」自动传导到全部子标签，无需级联写。
    /// 父链断裂（父不存在 / 已软删）或库里成环（脏数据）时停止上溯，不做异常处理。
    pub fn effective_field_ids(
        storage: &mut dyn StorageAdapter,
        tag_id: &str,
    ) -> Result<Vec<String>, Box<dyn Error>> {
        let mut out: Vec<String> = Vec::new();
        let mut seen_ids: HashSet<String> = HashSet::new();
        let mut seen_titles: HashSet<String> = HashSet::new();
        let mut visited: HashSet<String> = HashSet::new();
        let mut cursor = Some(tag_id.to_string());
        while let Some(id) = cursor {
            if !visited.insert(id.clone()) {
                break;
            }
            let tag = match repository::TagRepository::get_by_id(storage.tags(), &id) {
                Ok(t) => t,
                Err(_) => break,
            };
            for field_id in &tag.field_ids {
                if !seen_ids.insert(field_id.clone()) {
                    continue;
                }
                let title = repository::FieldDefinitionRepository::get_by_id(
                    storage.field_definitions(),
                    field_id,
                )
                .ok()
                .map(|d| d.title);
                if let Some(title) = title {
                    if !seen_titles.insert(title) {
                        continue;
                    }
                }
                out.push(field_id.clone());
            }
            cursor = tag.parent_id.clone();
        }
        Ok(out)
    }

    /// 后代标签 id 闭包（**不含自身**）—— 成员的向上聚合用（ADR-0050 D10）。
    ///
    /// 只含存活行（软删 tag 不算后代，同读侧过滤悬空引用的口径）。
    pub fn descendant_tag_ids(
        storage: &mut dyn StorageAdapter,
        tag_id: &str,
    ) -> Result<Vec<String>, Box<dyn Error>> {
        let all = repository::TagRepository::get_all(storage.tags())?;
        let mut out: Vec<String> = Vec::new();
        for tag in &all {
            if tag.id == tag_id {
                continue;
            }
            let mut visited: HashSet<String> = HashSet::new();
            let mut cursor = tag.parent_id.clone();
            while let Some(pid) = cursor {
                if pid == tag_id {
                    out.push(tag.id.clone());
                    break;
                }
                if !visited.insert(pid.clone()) {
                    break;
                }
                cursor = match repository::TagRepository::get_by_id(storage.tags(), &pid) {
                    Ok(p) => p.parent_id.clone(),
                    Err(_) => break,
                };
            }
        }
        Ok(out)
    }
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

        let err = TagService::update(&mut storage, "sys-tag-system-task", Some("新名"), None)
            .unwrap_err();
        assert!(err.to_string().contains("cannot update system tag"));

        // 系统 tag 也拒改父（seed 行拒删拒改名，语义一致）
        let err = TagService::set_parent(&mut storage, "sys-tag-system-task", Some("whatever"))
            .unwrap_err();
        assert!(err.to_string().contains("cannot set parent of system tag"));
    }

    // ── ADR-0050 D10：单父 + 环守卫 + 读取侧有效字段解析 + 后代闭包 ──────

    /// 建用户 tag（可选父）并返回 id。
    fn make_tag(
        storage: &mut crate::storage::sqlite::SQLiteAdapter,
        title: &str,
        field_ids: &[&str],
        parent_id: Option<&str>,
    ) -> String {
        TagService::create(
            storage,
            TagCreateOptions {
                title: title.to_string(),
                field_ids: field_ids.iter().map(|s| s.to_string()).collect(),
                parent_id: parent_id.map(|s| s.to_string()),
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn effective_fields_prefers_self_then_nearer_ancestor() {
        let mut storage = crate::storage::sqlite::SQLiteAdapter::open_in_memory().unwrap();

        let g = make_tag(&mut storage, "g", &["f0"], None);
        let p = make_tag(&mut storage, "p", &["f1", "f2"], Some(&g));
        let c = make_tag(&mut storage, "c", &["f2", "f3"], Some(&p));

        // 自身优先：c 的 f2 在前，父的 f1 不被 c 的 f2 挤掉，祖的 f0 最后
        assert_eq!(
            TagService::effective_field_ids(&mut storage, &c).unwrap(),
            vec!["f2", "f3", "f1", "f0"]
        );
        assert_eq!(
            TagService::effective_field_ids(&mut storage, &p).unwrap(),
            vec!["f1", "f2", "f0"]
        );
        // 顶级标签：只有自身
        assert_eq!(
            TagService::effective_field_ids(&mut storage, &g).unwrap(),
            vec!["f0"]
        );
    }

    #[test]
    fn effective_fields_same_title_nearer_wins() {
        use crate::services::field_definition_service::FieldDefinitionService;
        use crate::types::field_definition::FieldDefinitionCreateOptions;

        let mut storage = crate::storage::sqlite::SQLiteAdapter::open_in_memory().unwrap();

        // 父与子各持一份「工时」定义（各标签各自「+ 添加字段」→ id 不同）
        let mk = |storage: &mut crate::storage::sqlite::SQLiteAdapter, key: &str| {
            FieldDefinitionService::create(
                storage,
                FieldDefinitionCreateOptions {
                    key: key.to_string(),
                    title: "工时".to_string(),
                    r#type: "number".to_string(),
                    closed_values: None,
                    is_system: false,
                },
            )
            .unwrap()
            .id
        };
        let parent_hours = mk(&mut storage, "parent-hours");
        let child_hours = mk(&mut storage, "child-hours");

        let p = make_tag(&mut storage, "p", &[&parent_hours, "f-note"], None);
        let c = make_tag(&mut storage, "c", &[&child_hours], Some(&p));

        // 同名近者胜：子的「工时」保留，父的同名定义被遮蔽；父的异名字段照常继承
        assert_eq!(
            TagService::effective_field_ids(&mut storage, &c).unwrap(),
            vec![child_hours.clone(), "f-note".to_string()]
        );
        // 父自身无同名遮蔽：两份都在
        assert_eq!(
            TagService::effective_field_ids(&mut storage, &p).unwrap(),
            vec![parent_hours, "f-note".to_string()]
        );
    }

    #[test]
    fn effective_fields_follow_parent_edits_without_cascade_write() {
        let mut storage = crate::storage::sqlite::SQLiteAdapter::open_in_memory().unwrap();

        let p = make_tag(&mut storage, "p", &["f1"], None);
        let c = make_tag(&mut storage, "c", &["f9"], Some(&p));

        // 父加字段 → 子读出的有效字段自动跟随（无需给子标签写任何东西）
        TagService::update(
            &mut storage,
            &p,
            None,
            Some(vec!["f1".to_string(), "f2".to_string()]),
        )
        .unwrap();
        assert_eq!(
            TagService::effective_field_ids(&mut storage, &c).unwrap(),
            vec!["f9", "f1", "f2"]
        );
        // 子标签行本身未被改动：field_ids 仍只含自身字段
        let child = repository::TagRepository::get_by_id(storage.tags(), &c).unwrap();
        assert_eq!(child.field_ids, vec!["f9".to_string()]);
    }

    #[test]
    fn set_parent_rejects_cycle() {
        let mut storage = crate::storage::sqlite::SQLiteAdapter::open_in_memory().unwrap();

        let a = make_tag(&mut storage, "a", &[], None);
        let b = make_tag(&mut storage, "b", &[], Some(&a));
        let c = make_tag(&mut storage, "c", &[], Some(&b));

        // 直接自引用
        let err = TagService::set_parent(&mut storage, &a, Some(&a)).unwrap_err();
        assert!(err.to_string().contains("cycle"));
        // 祖先链回指（c 是 a 的后代，把 a 挂到 c 下 → 成环）
        let err = TagService::set_parent(&mut storage, &a, Some(&c)).unwrap_err();
        assert!(err.to_string().contains("cycle"));
        // 拒绝后不留半改状态
        assert_eq!(
            repository::TagRepository::get_by_id(storage.tags(), &a)
                .unwrap()
                .parent_id,
            None
        );
    }

    #[test]
    fn set_parent_and_clear_and_dangling() {
        let mut storage = crate::storage::sqlite::SQLiteAdapter::open_in_memory().unwrap();

        let p = make_tag(&mut storage, "p", &["f1"], None);
        let c = make_tag(&mut storage, "c", &["f2"], Some(&p));

        // 清空 → 回顶级
        TagService::set_parent(&mut storage, &c, None).unwrap();
        assert_eq!(
            TagService::effective_field_ids(&mut storage, &c).unwrap(),
            vec!["f2"]
        );

        // 悬空父：允许（同悬空引用保留语义），解析侧跳过不存在的节点
        TagService::set_parent(&mut storage, &c, Some("no-such-tag")).unwrap();
        assert_eq!(
            TagService::effective_field_ids(&mut storage, &c).unwrap(),
            vec!["f2"]
        );
    }

    #[test]
    fn user_tag_may_inherit_system_tag() {
        let mut storage = crate::storage::sqlite::SQLiteAdapter::open_in_memory().unwrap();

        // 子标签可挂系统 tag 为父（Tana 语义：extends #task 的自定义 tag 也进任务列表）
        let dev = make_tag(&mut storage, "dev", &["f9"], Some("sys-tag-system-task"));
        let fields = TagService::effective_field_ids(&mut storage, &dev).unwrap();
        assert_eq!(fields[0], "f9");
        assert_eq!(fields.len(), 5); // 自身 1 + 系统任务 4
    }

    #[test]
    fn descendant_closure_is_transitive_and_excludes_self() {
        let mut storage = crate::storage::sqlite::SQLiteAdapter::open_in_memory().unwrap();

        let g = make_tag(&mut storage, "g", &[], None);
        let p = make_tag(&mut storage, "p", &[], Some(&g));
        let c = make_tag(&mut storage, "c", &[], Some(&p));
        let other = make_tag(&mut storage, "other", &[], None);

        let mut desc_g = TagService::descendant_tag_ids(&mut storage, &g).unwrap();
        desc_g.sort();
        let mut expected = vec![c.clone(), p.clone()];
        expected.sort();
        assert_eq!(desc_g, expected);

        assert!(TagService::descendant_tag_ids(&mut storage, &c)
            .unwrap()
            .is_empty());
        assert!(TagService::descendant_tag_ids(&mut storage, &other)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn descendant_closure_skips_soft_deleted_child() {
        let mut storage = crate::storage::sqlite::SQLiteAdapter::open_in_memory().unwrap();

        let p = make_tag(&mut storage, "p", &[], None);
        let c = make_tag(&mut storage, "c", &[], Some(&p));

        TagService::delete(&mut storage, &c).unwrap();
        assert!(TagService::descendant_tag_ids(&mut storage, &p)
            .unwrap()
            .is_empty());
        // 软删行原地保留（悬空引用保留语义），未硬删
        assert!(repository::TagRepository::get_by_title(storage.tags(), "c")
            .unwrap()
            .is_none());
    }
}
