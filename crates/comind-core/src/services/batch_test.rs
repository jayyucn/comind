//! batch 模块单测（ADR-0048 / #116）：分派语义单源的验收网。
//!
//! 裁定钉子：
//! - unknown op 容错不失败（决策5）
//! - 整批回滚：任一 op 失败 → 事务内全部不落库（ADR-0046 约束3）
//! - entity 名 snake_case：`relationship_type` 正常分派（原 WASM `relationshipType`
//!   静默失败的潜伏 bug 回归钉）
//! - property set upsert 复活软删行（#108 验收#1/#5）
//! - template 增量契约：create 收 `{id,name,category,content}`、update 收
//!   `{id,name}`（原 Tauri 全量反序列化必失败 → 桌面端静默回滚的回归钉）
use crate::{
    services::{batch::apply_batch, BlockService, PageService, PropertyService, TemplateService},
    storage::sqlite::SQLiteAdapter,
    storage::TransactionalStorageAdapter,
};
use serde_json::json;
use std::error::Error;

fn block_create_op(id: &str, page_id: &str) -> serde_json::Value {
    json!({
        "entity": "block",
        "action": "create",
        "params": {
            "id": id,
            "page_id": page_id,
            "parent_id": null,
            "pos": 100,
            "content": "hello world",
            "format": "{}",
            "type": "bullet"
        }
    })
}

fn block_update_op(id: &str, page_id: &str, content: &str) -> serde_json::Value {
    json!({
        "entity": "block",
        "action": "update",
        "params": {
            "id": id,
            "page_id": page_id,
            "parent_id": null,
            "pos": 100,
            "content": content,
            "format": "{}",
            "type": "bullet"
        }
    })
}

#[test]
fn test_block_create_then_get_roundtrip() -> Result<(), Box<dyn Error>> {
    let mut adapter = SQLiteAdapter::open_in_memory()?;
    let page = PageService::create(&mut adapter, "", "Page", None, None, None, None, None)?;

    let effects = apply_batch(&mut adapter, &[block_create_op("blk1", &page.id)])?;
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0].value["id"], "blk1");
    // sync 效果：至少含 Block 行
    assert!(effects[0]
        .sync
        .iter()
        .any(|(t, id)| *t == crate::types::SyncTable::Block && id == "blk1"));
    // page_ids 携带页 id（Tauri 层 page touch 的依据）
    assert_eq!(effects[0].page_ids, vec![page.id.clone()]);

    let block = BlockService::get_by_id(&mut adapter, "blk1")?;
    assert_eq!(block.content, "hello world");
    Ok(())
}

#[test]
fn test_block_update_via_batch() -> Result<(), Box<dyn Error>> {
    let mut adapter = SQLiteAdapter::open_in_memory()?;
    let page = PageService::create(&mut adapter, "", "Page", None, None, None, None, None)?;
    BlockService::create(
        &mut adapter,
        &page.id,
        None,
        "old",
        "{}",
        "bullet",
        Some("blk1"),
    )?;

    apply_batch(
        &mut adapter,
        &[block_update_op("blk1", &page.id, "new content")],
    )?;
    let block = BlockService::get_by_id(&mut adapter, "blk1")?;
    assert_eq!(block.content, "new content");
    Ok(())
}

#[test]
fn test_block_delete_cascades_property() -> Result<(), Box<dyn Error>> {
    let mut adapter = SQLiteAdapter::open_in_memory()?;
    let page = PageService::create(&mut adapter, "", "Page", None, None, None, None, None)?;
    BlockService::create(
        &mut adapter,
        &page.id,
        None,
        "task",
        "{}",
        "bullet",
        Some("blk1"),
    )?;
    PropertyService::create(&mut adapter, "blk1", "status", "todo", "string", 0, 0, 1)?;

    apply_batch(
        &mut adapter,
        &[json!({"entity": "block", "action": "delete", "params": {"id": "blk1"}})],
    )?;

    assert!(BlockService::get_by_id(&mut adapter, "blk1").is_err());
    // S8 级联：属性一并清理（裁定钉：WASM 旧路径缺 dateRef/通知清理，统一走 BlockService::delete）
    let props = PropertyService::get_by_block_id(&mut adapter, "blk1")?;
    assert!(props.is_empty());
    Ok(())
}

#[test]
fn test_block_undelete_revive_then_noop() -> Result<(), Box<dyn Error>> {
    let mut adapter = SQLiteAdapter::open_in_memory()?;
    let page = PageService::create(&mut adapter, "", "Page", None, None, None, None, None)?;
    BlockService::create(
        &mut adapter,
        &page.id,
        None,
        "x",
        "{}",
        "bullet",
        Some("blk1"),
    )?;
    BlockService::delete(&mut adapter, "blk1")?;

    let op = json!({"entity": "block", "action": "undelete", "params": {"id": "blk1"}});
    let effects = apply_batch(&mut adapter, &[op.clone()])?;
    assert_eq!(effects[0].value["revived"], true);
    assert!(BlockService::get_by_id(&mut adapter, "blk1").is_ok());

    // 已 live → no-op（revived=false，不 bump version）
    let effects = apply_batch(&mut adapter, &[op])?;
    assert_eq!(effects[0].value["revived"], false);
    Ok(())
}

#[test]
fn test_property_set_upsert_revives_soft_deleted() -> Result<(), Box<dyn Error>> {
    let mut adapter = SQLiteAdapter::open_in_memory()?;
    let page = PageService::create(&mut adapter, "", "Page", None, None, None, None, None)?;
    BlockService::create(
        &mut adapter,
        &page.id,
        None,
        "x",
        "{}",
        "bullet",
        Some("blk1"),
    )?;
    let prop = PropertyService::create(&mut adapter, "blk1", "status", "todo", "string", 0, 0, 1)?;
    PropertyService::delete(&mut adapter, &prop.id)?; // 软删

    // 同 id 同 key upsert → 复活（UNIQUE(block_id,key) 冲突即 UPDATE，#108 验收#1/#5）
    apply_batch(
        &mut adapter,
        &[json!({
            "entity": "property",
            "action": "set",
            "params": {
                "id": prop.id,
                "block_id": "blk1",
                "key": "status",
                "value": "done",
                "type": "string"
            }
        })],
    )?;

    let revived = PropertyService::get_by_block_id_and_key(&mut adapter, "blk1", "status")?;
    assert!(revived.is_some());
    assert_eq!(revived.unwrap().value, "done");
    Ok(())
}

#[test]
fn test_relationship_type_snake_case_dispatch() -> Result<(), Box<dyn Error>> {
    // 回归钉：entity 名必须是 snake_case（原 WASM 路径 `relationshipType`
    // 匹配不上 → 落 unknown arm 静默失败）
    let mut adapter = SQLiteAdapter::open_in_memory()?;
    let rt_row = json!({
        "id": "rt1",
        "type": "blocks",
        "inverse": "blocked_by",
        "label": "blocks",
        "inverse_label": "blocked by",
        "color": "#3B82F6",
        "order": 0,
        "strength": "strong",
        "deleted": 0,
        "builtin": 0,
        "created_at": 1700000000000i64,
        "updated_at": 1700000000000i64
    });
    let effects = apply_batch(
        &mut adapter,
        &[json!({"entity": "relationship_type", "action": "create", "params": rt_row})],
    )?;
    assert_eq!(effects[0].value["id"], "rt1");

    let found = crate::services::RelationshipTypeService::get_by_type(&mut adapter, "blocks")?;
    assert!(found.is_some());
    Ok(())
}

#[test]
fn test_relationship_type_create_revives_soft_deleted() -> Result<(), Box<dyn Error>> {
    // 回归钉：load() 以种子 id 幂等同步；同 id 行被软删后 get_all 不可见 →
    // create 重放撞 id UNIQUE（App 启动崩溃）。create 必须按入参复活该行。
    let mut adapter = SQLiteAdapter::open_in_memory()?;
    let rt_row = json!({
        "id": "rt_seed_related",
        "type": "related",
        "inverse": null,
        "label": "相关",
        "inverse_label": "相关",
        "color": "#8c8c8c",
        "order": 0,
        "strength": "weak",
        "deleted": 0,
        "builtin": 1,
        "created_at": 1700000000000i64,
        "updated_at": 1700000000000i64
    });
    apply_batch(
        &mut adapter,
        &[json!({"entity": "relationship_type", "action": "create", "params": rt_row})],
    )?;
    // 软删（delete 是 UPDATE deleted=1，行仍占 id）
    apply_batch(
        &mut adapter,
        &[json!({"entity": "relationship_type", "action": "delete", "params": {"id": "rt_seed_related"}})],
    )?;
    // 重放同一 create：应复活而非撞 UNIQUE
    let rt_row2 = json!({
        "id": "rt_seed_related",
        "type": "related",
        "inverse": null,
        "label": "相关",
        "inverse_label": "相关",
        "color": "#8c8c8c",
        "order": 0,
        "strength": "weak",
        "deleted": 0,
        "builtin": 1,
        "created_at": 1700000000000i64,
        "updated_at": 1700000001000i64
    });
    apply_batch(
        &mut adapter,
        &[json!({"entity": "relationship_type", "action": "create", "params": rt_row2})],
    )?;

    let found = crate::services::RelationshipTypeService::get_by_type(&mut adapter, "related")?;
    assert!(found.is_some());
    assert_eq!(found.unwrap().deleted, 0);
    Ok(())
}

#[test]
fn test_template_incremental_contract() -> Result<(), Box<dyn Error>> {
    // 回归钉：create 只收 {id,name,category,content}（原 Tauri 全量 UserTemplate
    // 反序列化缺 created_at/updated_at 必失败 → 桌面端静默回滚）
    let mut adapter = SQLiteAdapter::open_in_memory()?;
    apply_batch(
        &mut adapter,
        &[json!({
            "entity": "template",
            "action": "create",
            "params": {"id": "tpl1", "name": "Weekly", "category": "custom", "content": "{}"}
        })],
    )?;

    // rename 增量：只发 {id, name}（Service::update 合并语义）
    apply_batch(
        &mut adapter,
        &[json!({
            "entity": "template",
            "action": "update",
            "params": {"id": "tpl1", "name": "Weekly Renamed"}
        })],
    )?;

    let all = TemplateService::get_all(&mut adapter)?;
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].name, "Weekly Renamed");
    assert_eq!(all[0].category, "custom"); // 未发的字段保持原值
    Ok(())
}

#[test]
fn test_unknown_op_tolerated() -> Result<(), Box<dyn Error>> {
    let mut adapter = SQLiteAdapter::open_in_memory()?;
    let effects = apply_batch(
        &mut adapter,
        &[json!({"entity": "ghost", "action": "haunt", "params": {}})],
    )?;
    assert!(effects[0].value["error"]
        .as_str()
        .unwrap()
        .contains("Unknown operation: ghost haunt"));
    Ok(())
}

#[test]
fn test_batch_rolls_back_on_op_failure() -> Result<(), Box<dyn Error>> {
    let mut adapter = SQLiteAdapter::open_in_memory()?;
    let page = PageService::create(&mut adapter, "", "Page", None, None, None, None, None)?;

    // 第 2 个 op 更新不存在的块 → 失败 → 整批（含第 1 个成功的 create）回滚
    let ops = vec![
        block_create_op("blk1", &page.id),
        block_update_op("ghost-block", &page.id, "boom"),
    ];
    let result = adapter.transaction(|storage| apply_batch(storage, &ops));
    assert!(result.is_err());

    let blocks = BlockService::get_by_page_id(&mut adapter, &page.id)?;
    assert!(blocks.is_empty(), "rollback must undo the earlier create");
    Ok(())
}
