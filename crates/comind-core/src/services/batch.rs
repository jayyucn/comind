//! batch —— execute_batch 的 op 分派单源（ADR-0048 / #116）。
//!
//! 此前 Tauri（commands.rs execute_batch）与 WASM（lib.rs execute_batch）各持
//! 一份 `(entity, action)` match 分派表，同构但各自漂移，且漂移已产生真 bug：
//!
//! 1. entity 命名：WASM 用 `relationshipType`，前端实发 `relationship_type`
//!    → WASM 路径 relationship ops 落 unknown arm 静默失败；
//! 2. block delete：WASM 手动预删 link/property，绕开了 BlockService::delete
//!    的 dateRef 清理 + notification 硬删（S8 单源被绕开）；
//! 3. template create/update：Tauri 按全量 `UserTemplate` 反序列化，而前端只发
//!    `{id, name, category, content}`（rename 甚至只发 `{id, name}`）→ 缺
//!    created_at/updated_at 反序列化失败 → 整批回滚 → 前端 try/catch 静默吞掉
//!    （桌面端 template 创建/重命名实际不可用）。
//!
//! 本模块收编两份的**并集** op 面，逐 arm 按「调用方真实契约」择优（裁定见各
//! arm 注释）。adapter 只剩薄调用：事务仍由调用方包裹；Tauri 层消费 `OpEffect`
//! 做 sync 通知与 page touch，WASM 忽略这两个字段。

use crate::{
    services::{
        BlockService, FieldDefinitionService, FieldValueService, LinkService, PageService,
        RelationshipTypeService, TagService, TemplateService,
    },
    storage::{repository, StorageAdapter},
    types::{
        Block, FieldValue, FieldValueCreateOptions, Link, Page, RelationshipType, SyncTable,
        TagCreateOptions, TagTreeEntry, TagUpdateOptions, UserTemplate,
    },
};
use serde_json::{json, Value};
use std::error::Error;

/// 单个 op 的执行效果。
pub struct OpEffect {
    /// 给前端的返回值（两路径统一 JSON 形状；前端不读取内容，仅透传）。
    pub value: Value,
    /// 本 op 触及的 (表, 行 id)：Tauri 层聚合后 record_and_notify；WASM 忽略。
    pub sync: Vec<(SyncTable, String)>,
    /// 需要 touch 的页 id：Tauri 层在事务内 PageService::update；WASM 忽略。
    pub page_ids: Vec<String>,
}

impl OpEffect {
    fn plain(value: Value) -> Self {
        Self {
            value,
            sync: Vec::new(),
            page_ids: Vec::new(),
        }
    }
}

/// 整批应用（循环 + unknown op 容错在 core，ADR-0048 决策5）。
///
/// 事务由调用方包裹（Tauri `execute_with_transaction_adapter` /
/// WASM `adapter.transaction`）：任一 op 失败 → 返回 Err → 整批回滚。
/// unknown op **不失败**：返回带 `error` 字段的 Ok 效果（两份旧实现的共同
/// 容错语义，形状统一为对象）。
pub fn apply_batch(
    storage: &mut dyn StorageAdapter,
    operations: &[Value],
) -> Result<Vec<OpEffect>, Box<dyn Error>> {
    let mut effects = Vec::with_capacity(operations.len());
    for op in operations {
        effects.push(apply_one(storage, op)?);
    }
    Ok(effects)
}

fn apply_one(storage: &mut dyn StorageAdapter, op: &Value) -> Result<OpEffect, Box<dyn Error>> {
    let entity = op.get("entity").and_then(|v| v.as_str()).unwrap_or("");
    let action = op.get("action").and_then(|v| v.as_str()).unwrap_or("");
    let params = op.get("params").cloned().unwrap_or(Value::Null);

    match (entity, action) {
        // ---- block ----
        ("block", "get") => {
            let id = str_param(&params, "id");
            let block = BlockService::get_by_id(storage, id)?;
            Ok(OpEffect::plain(serde_json::to_value(block)?))
        }
        ("block", "create") => {
            let block: Block = serde_json::from_value(params)?;
            let created = BlockService::create(
                storage,
                &block.page_id,
                block.parent_id.as_deref(),
                &block.content,
                &block.format,
                &block.r#type,
                Some(&block.id),
                true,
            )?;
            // S8：BlockService::create 内部已同步 dateRef/link/property，
            // 此处只收集派生行 id 供 sync（与 Tauri 旧实现一致）。
            let mut sync = vec![(SyncTable::Block, created.id.clone())];
            for l in LinkService::get_by_source_block_id(storage, &created.id).unwrap_or_default() {
                sync.push((SyncTable::Link, l.id));
            }
            for p in FieldValueService::get_by_block_id(storage, &created.id).unwrap_or_default() {
                // ADR-0049：属性已切 FieldValue，id 是 FieldValue 行 id，登记不得再指 Property 表
                sync.push((SyncTable::FieldValue, p.id));
            }
            for n in storage
                .notifications()
                .get_by_block_id(&created.id)
                .unwrap_or_default()
            {
                sync.push((SyncTable::Notification, n.id));
            }
            Ok(OpEffect {
                value: serde_json::to_value(&created)?,
                sync,
                page_ids: vec![block.page_id],
            })
        }
        ("block", "update") => {
            // 显式 op 更新 = 提交动作，允许按 content 自动建/复活标签
            // （编辑器打字路径走 save_block_tree，携带 create_missing_tags=false）。
            let block: Block = serde_json::from_value(params)?;
            let updated = BlockService::update(
                storage,
                &block.id,
                Some(&block.content),
                Some(&block.format),
                Some(&block.r#type),
                block.parent_id.as_deref(),
                Some(block.pos),
                true,
            )?;
            let mut sync = vec![(SyncTable::Block, updated.id.clone())];
            for l in LinkService::get_by_source_block_id(storage, &updated.id).unwrap_or_default() {
                sync.push((SyncTable::Link, l.id));
            }
            for p in FieldValueService::get_by_block_id(storage, &updated.id).unwrap_or_default() {
                // ADR-0049：属性已切 FieldValue，id 是 FieldValue 行 id，登记不得再指 Property 表
                sync.push((SyncTable::FieldValue, p.id));
            }
            for n in storage
                .notifications()
                .get_by_block_id(&updated.id)
                .unwrap_or_default()
            {
                sync.push((SyncTable::Notification, n.id));
            }
            Ok(OpEffect {
                value: serde_json::to_value(&updated)?,
                sync,
                page_ids: vec![block.page_id],
            })
        }
        ("block", "delete") => {
            let id = str_param(&params, "id").to_string();
            let mut sync = vec![(SyncTable::Block, id.clone())];
            let mut page_ids = Vec::new();
            if let Ok(block) = storage.blocks().get_by_id(&id) {
                page_ids.push(block.page_id);
            }
            // 级联清理前收集派生行 id（删完就查不到了）
            for l in storage
                .links()
                .get_by_source_block_id(&id)
                .unwrap_or_default()
            {
                sync.push((SyncTable::Link, l.id));
            }
            // ADR-0049：属性软删的是 FieldValue 行（Property 表冻结），
            // 必须在 BlockService::delete 之前经适配层收集存活行 id
            for p in FieldValueService::get_by_block_id(storage, &id).unwrap_or_default() {
                sync.push((SyncTable::FieldValue, p.id));
            }
            for n in storage
                .notifications()
                .get_by_block_id(&id)
                .unwrap_or_default()
            {
                sync.push((SyncTable::Notification, n.id));
            }
            // S8 单源：dateRef 清理 + notification 硬删 + link/property 级联都在
            // BlockService::delete（裁定：WASM 旧路径手动预删 link/property 是
            // 冗余且缺 dateRef/通知清理，废除）。
            BlockService::delete(storage, &id)?;
            Ok(OpEffect {
                value: json!({ "success": true }),
                sync,
                page_ids,
            })
        }
        ("block", "undelete") => {
            // 撤销恢复：精确复活单块（ADR-0046 T3 / #108 审查 (a)2）。
            // 不级联：撤销目标是快照里明确列出的块，逐个 id 复活即可；级联反而
            // 会把「软删但不在快照」的子块一并复活（stray）。
            let id = str_param(&params, "id").to_string();
            let (page_id, revived) = match BlockService::get_by_id(storage, &id) {
                Ok(existing) => (existing.page_id, false), // 已 live → no-op，不 bump version
                Err(_) => {
                    let revived = BlockService::undelete(storage, &id)?;
                    (revived.page_id, true)
                }
            };
            Ok(OpEffect {
                value: json!({ "success": true, "revived": revived }),
                sync: vec![(SyncTable::Block, id)],
                page_ids: vec![page_id],
            })
        }
        ("block", "set_tags") => {
            // ADR-0049 D6：打标/摘标唯一写入口 —— 只改 Block.tags，不触碰内容派生。
            let id = str_param(&params, "id").to_string();
            let tags = str_array_param(&params, "tags");
            // 新获得 tag 差集（旧 tags − 新 tags 的补集）；用于「打标自动填默认」（ADR-0050 D13）。
            let old_tags = repository::BlockRepository::get_by_id(storage.blocks(), &id)
                .map(|b| b.tags)
                .unwrap_or_default();
            let new_tag_ids: Vec<String> = tags
                .iter()
                .filter(|t| !old_tags.contains(t))
                .cloned()
                .collect();
            let updated = BlockService::update_tags(storage, &id, tags)?;
            // 打标自动填默认：仅对新获得 tag，不冲掉手写值（ADR-0050 D13）。
            let created = TagService::apply_field_defaults_for_new_tags(
                storage,
                &updated.id,
                &new_tag_ids,
            )
            .unwrap_or_else(|e| {
                eprintln!(
                    "[batch set_tags] apply_field_defaults failed for block {}: {}",
                    updated.id, e
                );
                Vec::new()
            });
            let mut sync = vec![(SyncTable::Block, updated.id.clone())];
            sync.extend(created.into_iter().map(|fid| (SyncTable::FieldValue, fid)));
            Ok(OpEffect {
                value: serde_json::to_value(&updated)?,
                sync,
                page_ids: vec![updated.page_id],
            })
        }

        // ---- page ----
        ("page", "get") => {
            let id = str_param(&params, "id");
            let page = PageService::get_by_id(storage, id)?;
            Ok(OpEffect::plain(serde_json::to_value(page)?))
        }
        ("page", "create") => {
            let page: Page = serde_json::from_value(params)?;
            let created = PageService::create(
                storage,
                page.block_id.as_deref().unwrap_or(""),
                &page.title,
                Some(&page.r#type),
                page.icon.as_deref(),
                page.cover.as_deref(),
                Some(&page.aliases),
                page.file_path.as_deref(),
            )?;
            Ok(OpEffect {
                value: serde_json::to_value(&created)?,
                sync: vec![(SyncTable::Page, created.id)],
                page_ids: Vec::new(),
            })
        }
        ("page", "update") => {
            let page: Page = serde_json::from_value(params)?;
            let updated = PageService::update(
                storage,
                &page.id,
                Some(&page.title),
                Some(&page.r#type),
                page.icon.as_deref(),
                page.cover.as_deref(),
                Some(&page.aliases),
                page.file_path.as_deref(),
                Some(page.children_count),
                Some(page.word_count),
            )?;
            Ok(OpEffect {
                value: serde_json::to_value(&updated)?,
                sync: vec![(SyncTable::Page, updated.id)],
                page_ids: Vec::new(),
            })
        }
        ("page", "delete") => {
            let id = str_param(&params, "id").to_string();
            PageService::delete(storage, &id)?;
            Ok(OpEffect {
                value: json!({ "success": true }),
                sync: vec![(SyncTable::Page, id)],
                page_ids: Vec::new(),
            })
        }

        // ---- link ----
        ("link", "create") => {
            let link: Link = serde_json::from_value(params)?;
            let created = LinkService::create(
                storage,
                &link.source_block_id,
                &link.target_page_id,
                &link.display_text,
                link.relationship_type.as_deref(),
            )?;
            Ok(OpEffect {
                value: serde_json::to_value(&created)?,
                sync: vec![(SyncTable::Link, created.id)],
                page_ids: Vec::new(),
            })
        }
        ("link", "delete") => {
            let id = str_param(&params, "id").to_string();
            LinkService::delete(storage, &id)?;
            Ok(OpEffect {
                value: json!({ "success": true }),
                sync: vec![(SyncTable::Link, id)],
                page_ids: Vec::new(),
            })
        }
        ("link", "sync_by_block") => {
            let block_id = str_param(&params, "block_id");
            let links_data = params
                .get("links")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            LinkService::delete_by_source_block_id(storage, block_id)?;
            let mut created = Vec::new();
            let mut sync = Vec::new();
            for link_data in links_data {
                let source_block_id = link_data
                    .get("source_block_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let target_page_id = link_data
                    .get("target_page_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let display_text = link_data
                    .get("display_text")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let relationship_type = link_data.get("relationship_type").and_then(|v| v.as_str());
                let new_link = LinkService::create(
                    storage,
                    source_block_id,
                    target_page_id,
                    display_text,
                    relationship_type,
                )?;
                sync.push((SyncTable::Link, new_link.id.clone()));
                created.push(new_link);
            }
            Ok(OpEffect {
                value: serde_json::to_value(&created)?,
                sync,
                page_ids: Vec::new(),
            })
        }

        // ---- property ----
        // 字段值读写单源：FieldValueService 直接读写库内 `FieldValue` 行（无 Property
        // 中间形状），`key` 由服务层 join 定义表填充。同步登记 SyncTable::FieldValue
        // （+ 自动建 FieldDefinition 时登记 FieldDefinition）。
        // create / set / update 参数同构（key 定位定义），语义均为保存整行。
        ("property", "create") | ("property", "set") | ("property", "update") => {
            // Upsert 语义（#108 验收#1/#5）：字段值删除是软删，且块删除级联软删值后
            // undelete_blocks 不复活值 —— 撤销恢复必须走 upsert。id / seq 由快照忠实
            // 带回（不可重生成 id，否则复活匹配失败）。
            let id = str_param(&params, "id");
            let now = chrono::Utc::now().timestamp_millis();
            let r#type = {
                let t = str_param(&params, "type");
                if t.is_empty() {
                    "text"
                } else {
                    t
                }
            };
            let fv = FieldValue {
                id: if id.is_empty() {
                    uuid::Uuid::new_v4().to_string()
                } else {
                    id.to_string()
                },
                block_id: str_param(&params, "block_id").to_string(),
                field_definition_id: String::new(), // save 按 key 解析定义后回填
                value_json: str_param(&params, "value").to_string(),
                value_type: r#type.to_string(),
                seq: params
                    .get("sort_order")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0),
                created_at: now,
                updated_at: now,
                version: 0,
                deleted_at: None,
                key: str_param(&params, "key").to_string(),
            };
            let (saved, fd_id) = FieldValueService::save(storage, &fv)?;
            Ok(OpEffect {
                value: serde_json::to_value(&saved)?,
                sync: vec![(SyncTable::FieldValue, saved.id), (SyncTable::FieldDefinition, fd_id)],
                page_ids: Vec::new(),
            })
        }
        ("property", "delete") => {
            let id = str_param(&params, "id").to_string();
            FieldValueService::delete(storage, &id)?;
            Ok(OpEffect {
                value: json!({ "success": true }),
                sync: vec![(SyncTable::FieldValue, id)],
                page_ids: Vec::new(),
            })
        }

        // ---- relationship_type ----
        // entity 名统一 snake_case（裁定：前端实发 snake_case，WASM 旧路径的
        // `relationshipType` 匹配不上 → unknown arm 静默失败，废除）。
        ("relationship_type", "create") => {
            // 裁定：全量反序列化 + repo create —— 前端种子同步发完整行
            // （含 created_at/updated_at/deleted/builtin），契约是整行写入。
            // 复活语义（软删 UNIQUE 兼容）：repo get_all / get_by_type 均过滤
            // deleted=0，但 id 上有 UNIQUE 约束。前端 load() 以种子 id 幂等同步
            // （rt_seed_*），当该 id 已被软删时 get_all 不可见 → 走 create →
            // INSERT 撞 UNIQUE（App 启动 load() 直接崩；测试 cleanup 同因失效）。
            // get_by_id 不过滤 deleted：命中即改走全行 update（按入参复活/覆盖）。
            let rt: RelationshipType = serde_json::from_value(params)?;
            let exists = repository::RelationshipTypeRepository::get_by_id(
                storage.relationship_types(),
                &rt.id,
            )
            .is_ok();
            let created = if exists {
                repository::RelationshipTypeRepository::update(storage.relationship_types(), &rt)?
            } else {
                repository::RelationshipTypeRepository::create(storage.relationship_types(), &rt)?
            };
            Ok(OpEffect {
                value: serde_json::to_value(&created)?,
                sync: vec![(SyncTable::RelationshipType, created.id)],
                page_ids: Vec::new(),
            })
        }
        ("relationship_type", "update") => {
            // 裁定：全量 repo update（同 create：前端发完整行；改用
            // Service::update 合并语义会静默丢掉 type/inverse/deleted 变更）。
            let rt: RelationshipType = serde_json::from_value(params)?;
            let updated =
                repository::RelationshipTypeRepository::update(storage.relationship_types(), &rt)?;
            Ok(OpEffect {
                value: serde_json::to_value(&updated)?,
                sync: vec![(SyncTable::RelationshipType, updated.id)],
                page_ids: Vec::new(),
            })
        }
        ("relationship_type", "delete") => {
            let id = str_param(&params, "id").to_string();
            RelationshipTypeService::delete(storage, &id)?;
            Ok(OpEffect {
                value: json!({ "success": true }),
                sync: vec![(SyncTable::RelationshipType, id)],
                page_ids: Vec::new(),
            })
        }

        // ---- template ----
        ("template", "get") => {
            let templates = TemplateService::get_all(storage)?;
            Ok(OpEffect::plain(serde_json::to_value(templates)?))
        }
        ("template", "create") => {
            // 裁定：字段解析（WASM 语义）而非全量反序列化 —— 前端只发
            // {id, name, category, content}；Tauri 旧的全量 UserTemplate 反序列化
            // 因缺 created_at/updated_at 必失败 → 桌面端 template 创建一直静默回滚。
            let id = str_param(&params, "id");
            let category = {
                let c = str_param(&params, "category");
                if c.is_empty() {
                    "custom"
                } else {
                    c
                }
            };
            let now = chrono::Utc::now().timestamp_millis();
            let template = UserTemplate {
                id: if id.is_empty() {
                    TemplateService::generate_id()
                } else {
                    id.to_string()
                },
                name: str_param(&params, "name").to_string(),
                category: category.to_string(),
                content: str_param(&params, "content").to_string(),
                created_at: now,
                updated_at: now,
            };
            let created = repository::TemplateRepository::create(storage.templates(), &template)?;
            Ok(OpEffect {
                value: serde_json::to_value(&created)?,
                sync: vec![(SyncTable::Template, created.id)],
                page_ids: Vec::new(),
            })
        }
        ("template", "update") => {
            // 裁定：Service::update 合并语义 —— 前端发增量（rename 只发
            // {id, name}），全量反序列化会缺字段失败。
            let id = str_param(&params, "id");
            let name = params.get("name").and_then(|v| v.as_str());
            let category = params.get("category").and_then(|v| v.as_str());
            let content = params.get("content").and_then(|v| v.as_str());
            let updated = TemplateService::update(storage, id, name, category, content)?;
            Ok(OpEffect {
                value: serde_json::to_value(&updated)?,
                sync: vec![(SyncTable::Template, updated.id)],
                page_ids: Vec::new(),
            })
        }
        ("template", "delete") => {
            let id = str_param(&params, "id").to_string();
            TemplateService::delete(storage, &id)?;
            Ok(OpEffect {
                value: json!({ "success": true }),
                sync: vec![(SyncTable::Template, id)],
                page_ids: Vec::new(),
            })
        }

        // ---- tag ---- （ADR-0049 D6；ADR-0050 D10 单父 + 读取侧继承解析）
        // 裁定：走 TagService 而非裸 repo —— 有效字段解析与环守卫都在 service 层，
        // 若此处直连 repo 写入，会绕开守卫而静默漂移（与 ADR-0048「两份分派表漂移」同构）。
        ("tag", "get") => {
            let tags = TagService::get_all(storage)?;
            Ok(OpEffect::plain(serde_json::to_value(tags)?))
        }
        ("tag", "tree") => {
            // 标签树读接口（ADR-0050 D10）：原始行 + 解析后有效字段 + 后代闭包。
            // 解析单源在 Rust，TS 侧不得重实现（避免双源漂移）。
            let tags = TagService::get_all(storage)?;
            let mut entries: Vec<TagTreeEntry> = Vec::new();
            for tag in tags {
                let effective_field_ids = TagService::effective_field_ids(storage, &tag.id)?;
                let descendant_ids = TagService::descendant_tag_ids(storage, &tag.id)?;
                entries.push(TagTreeEntry {
                    tag,
                    effective_field_ids,
                    descendant_ids,
                });
            }
            Ok(OpEffect::plain(serde_json::to_value(entries)?))
        }
        ("tag", "create") => {
            let created = TagService::create(
                storage,
                TagCreateOptions {
                    title: str_param(&params, "title").to_string(),
                    field_ids: str_array_param(&params, "field_ids"),
                    // 可选父：缺失 / null → 顶级（ADR-0050 D10）
                    parent_id: optional_str_param(&params, "parent_id"),
                },
            )?;
            Ok(OpEffect {
                value: serde_json::to_value(&created)?,
                sync: vec![(SyncTable::Tag, created.id)],
                page_ids: Vec::new(),
            })
        }
        ("tag", "update") => {
            let id = str_param(&params, "id").to_string();
            // 仅当入参显式给出时才覆盖对应字段（None = 保持不变）。
            let field_ids = optional_str_array_param(&params, "field_ids");
            // 身份字段（ADR-0050 D11）：缺失 / null = 保持不变；空串 = 清空（未填写 / 无色）。
            let description = clearable_str_param(&params, "description");
            let color = clearable_str_param(&params, "color");
            let updated = TagService::update(
                storage,
                &id,
                TagUpdateOptions {
                    title: params.get("title").and_then(|v| v.as_str()),
                    field_ids,
                    description: description.as_deref(),
                    color: color.as_deref(),
                },
            )?;
            Ok(OpEffect {
                value: serde_json::to_value(&updated)?,
                sync: vec![(SyncTable::Tag, updated.id)],
                page_ids: Vec::new(),
            })
        }
        ("tag", "set_parent") => {
            // 单父槽位（ADR-0050 D10）：缺失 / null → 清空回顶级；成环由服务层拒绝。
            let id = str_param(&params, "id").to_string();
            let parent = optional_str_param(&params, "parent_id");
            let updated = TagService::set_parent(storage, &id, parent.as_deref())?;
            Ok(OpEffect {
                value: serde_json::to_value(&updated)?,
                sync: vec![(SyncTable::Tag, updated.id)],
                page_ids: Vec::new(),
            })
        }
        ("tag", "delete") => {
            let id = str_param(&params, "id").to_string();
            TagService::delete(storage, &id)?;
            // block.tags 里的悬空引用保留不动（软删不销毁数据，undo 可完整还原）。
            Ok(OpEffect {
                value: json!({ "success": true }),
                sync: vec![(SyncTable::Tag, id)],
                page_ids: Vec::new(),
            })
        }

        // ---- field_definition ---- （ADR-0049 D3/D9）
        ("field_definition", "get") => {
            let defs = FieldDefinitionService::get_all(storage)?;
            Ok(OpEffect::plain(serde_json::to_value(defs)?))
        }
        ("field_definition", "create") => {
            let created = FieldDefinitionService::create(
                storage,
                crate::types::FieldDefinitionCreateOptions {
                    key: str_param(&params, "key").to_string(),
                    title: str_param(&params, "title").to_string(),
                    r#type: str_param(&params, "type").to_string(),
                    closed_values: optional_str_array_param(&params, "closed_values"),
                    default_value: optional_str_param(&params, "default_value"),
                    is_system: params
                        .get("is_system")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                },
            )?;
            Ok(OpEffect {
                value: serde_json::to_value(&created)?,
                sync: vec![(SyncTable::FieldDefinition, created.id)],
                page_ids: Vec::new(),
            })
        }
        ("field_definition", "update") => {
            // update 无级联/物化不变量，故 repo 层就地改写即可；
            // 有语义的是 delete（走 service 做级联软删，见下）。
            let id = str_param(&params, "id").to_string();
            let mut fd =
                repository::FieldDefinitionRepository::get_by_id(storage.field_definitions(), &id)?;
            if let Some(t) = params.get("title").and_then(|v| v.as_str()) {
                fd.title = t.to_string();
            }
            if let Some(ty) = params.get("type").and_then(|v| v.as_str()) {
                fd.r#type = ty.to_string();
            }
            // 键存在才改动：显式 null → 清空候选值（非选项型）；缺失 → 原样保留。
            if params.get("closed_values").is_some() {
                fd.closed_values = optional_str_array_param(&params, "closed_values");
            }
            // 键存在才改动：显式 null / 空串 → 清空默认（无默认）；缺失 → 原样保留。
            if params.get("default_value").is_some() {
                fd.default_value = optional_str_param(&params, "default_value");
            }
            // 隐藏规则（ADR-0050 D18）：键存在才改动；白名单外的值归一为 never，不静默放行。
            if let Some(h) = params.get("hide_when").and_then(|v| v.as_str()) {
                fd.hide_when = crate::types::field_definition::normalize_hide_when(h);
            }
            // 展示形态覆盖（ADR-0050 D21 决策 5）：键存在才改动；白名单外的值归一为 auto。
            if let Some(f) = params.get("display_form_override").and_then(|v| v.as_str()) {
                fd.display_form_override =
                    crate::types::field_definition::normalize_display_form_override(f);
            }
            let updated =
                repository::FieldDefinitionRepository::update(storage.field_definitions(), &fd)?;
            Ok(OpEffect {
                value: serde_json::to_value(&updated)?,
                sync: vec![(SyncTable::FieldDefinition, updated.id)],
                page_ids: Vec::new(),
            })
        }
        ("field_definition", "delete") => {
            let id = str_param(&params, "id").to_string();
            // 级联软删引用它的 FieldValue；系统 seed 行会被 service 拒绝（ADR D3）。
            let report = FieldDefinitionService::delete_with_cascade(storage, &id)?;
            Ok(OpEffect {
                value: json!({ "success": true, "affected_values": report.affected_values }),
                sync: vec![(SyncTable::FieldDefinition, id)],
                page_ids: Vec::new(),
            })
        }
        ("field_definition", "get_deleted_presets") => {
            // 恢复按钮可见性：被软删的预设字段定义列表（is_preset=1 且 deleted_at 非空）。
            let defs = FieldDefinitionService::get_deleted_presets(storage)?;
            Ok(OpEffect::plain(serde_json::to_value(defs)?))
        }
        ("field_definition", "restore_presets") => {
            // 批量复活被软删的预设（ADR-0049 三态模型：预设删后可恢复）。
            // 只复活 is_preset=1 且已软删的行，绝不覆盖活跃编辑；返回复活条数。
            let restored = FieldDefinitionService::restore_presets(storage)?;
            let sync = restored
                .iter()
                .map(|id| (SyncTable::FieldDefinition, id.clone()))
                .collect();
            Ok(OpEffect {
                value: json!({ "restored": restored.len() }),
                sync,
                page_ids: Vec::new(),
            })
        }

        // ---- field_value ---- （ADR-0049 D9）
        ("field_value", "get") => {
            let block_id = str_param(&params, "block_id").to_string();
            let values = repository::FieldValueRepository::get_by_block_id(
                storage.field_values(),
                &block_id,
            )?;
            Ok(OpEffect::plain(serde_json::to_value(values)?))
        }
        ("field_value", "create") => {
            let created = repository::FieldValueRepository::create(
                storage.field_values(),
                &FieldValue::new(FieldValueCreateOptions {
                    block_id: str_param(&params, "block_id").to_string(),
                    field_definition_id: str_param(&params, "field_definition_id").to_string(),
                    value_json: str_param(&params, "value_json").to_string(),
                    value_type: str_param(&params, "value_type").to_string(),
                    seq: params.get("seq").and_then(|v| v.as_i64()).unwrap_or(0),
                }),
            )?;
            Ok(OpEffect {
                value: serde_json::to_value(&created)?,
                sync: vec![(SyncTable::FieldValue, created.id)],
                page_ids: Vec::new(),
            })
        }
        ("field_value", "update") => {
            let id = str_param(&params, "id").to_string();
            let mut fv = repository::FieldValueRepository::get_by_id(storage.field_values(), &id)?;
            if let Some(v) = params.get("value_json").and_then(|v| v.as_str()) {
                fv.value_json = v.to_string();
            }
            if let Some(v) = params.get("value_type").and_then(|v| v.as_str()) {
                fv.value_type = v.to_string();
            }
            if let Some(s) = params.get("seq").and_then(|v| v.as_i64()) {
                fv.seq = s;
            }
            let updated = repository::FieldValueRepository::update(storage.field_values(), &fv)?;
            Ok(OpEffect {
                value: serde_json::to_value(&updated)?,
                sync: vec![(SyncTable::FieldValue, updated.id)],
                page_ids: Vec::new(),
            })
        }
        ("field_value", "delete") => {
            let id = str_param(&params, "id").to_string();
            repository::FieldValueRepository::delete(storage.field_values(), &id)?;
            Ok(OpEffect {
                value: json!({ "success": true }),
                sync: vec![(SyncTable::FieldValue, id)],
                page_ids: Vec::new(),
            })
        }

        _ => Ok(OpEffect::plain(json!({
            "error": format!("Unknown operation: {} {}", entity, action)
        }))),
    }
}

fn str_param<'a>(params: &'a Value, key: &str) -> &'a str {
    params.get(key).and_then(|v| v.as_str()).unwrap_or_default()
}

/// 可选字符串参数：**缺失 / null / 空串 → None**（单父槽位等「无」语义参用）。
fn optional_str_param(params: &Value, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// 可清空字符串参数：**缺失 / null → None（保持不变）**；**空串 → Some("")（清空）**。
///
/// 与 `optional_str_param` 的区别：后者把空串折成 `None`（「无」语义参，如单父槽位），
/// 而本函数里空串是**有意义的值** —— `description` 未填写 / `color` 无色（ADR-0050 D11）。
fn clearable_str_param(params: &Value, key: &str) -> Option<String> {
    params.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

/// 字符串数组参数：**缺失或 null → 空数组**（用于 create 的缺省值）。
fn str_array_param(params: &Value, key: &str) -> Vec<String> {
    optional_str_array_param(params, key).unwrap_or_default()
}

/// 字符串数组参数：**缺失或 null → None**，语义由调用方解释 ——
/// update 里 None = 保持原值；create 里 None = 非选项型字段。
fn optional_str_array_param(params: &Value, key: &str) -> Option<Vec<String>> {
    params.get(key).and_then(|v| v.as_array()).map(|arr| {
        arr.iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string()))
            .collect()
    })
}
