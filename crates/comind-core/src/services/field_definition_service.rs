use std::error::Error;

use crate::{
    storage::{repository, StorageAdapter},
    types::{FieldDefinition, FieldDefinitionCreateOptions},
};

/// 级联软删回执（ADR D9：「删除前告知受影响条目数」）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CascadeDeleteReport {
    pub definition_id: String,
    /// 被同批级联软删的 FieldValue 行数。
    pub affected_values: usize,
    /// 级联时间戳 —— `undelete` 凭它精确复活「同一次操作」的整批值。
    pub deleted_at: i64,
}

pub struct FieldDefinitionService;

impl FieldDefinitionService {
    pub fn get_by_id(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<FieldDefinition, Box<dyn Error>> {
        repository::FieldDefinitionRepository::get_by_id(storage.field_definitions(), id)
    }

    pub fn get_by_key(
        storage: &mut dyn StorageAdapter,
        key: &str,
    ) -> Result<Option<FieldDefinition>, Box<dyn Error>> {
        repository::FieldDefinitionRepository::get_by_key(storage.field_definitions(), key)
    }

    pub fn get_all(
        storage: &mut dyn StorageAdapter,
    ) -> Result<Vec<FieldDefinition>, Box<dyn Error>> {
        repository::FieldDefinitionRepository::get_all(storage.field_definitions())
    }

    pub fn create(
        storage: &mut dyn StorageAdapter,
        options: FieldDefinitionCreateOptions,
    ) -> Result<FieldDefinition, Box<dyn Error>> {
        let fd = FieldDefinition::new(options);
        repository::FieldDefinitionRepository::create(storage.field_definitions(), &fd)
    }

    /// **级联软删**（ADR-0049 D9 + undo 裁定）：定义本体软删 + 引用它的 FieldValue 同批软删。
    ///
    /// - **系统 seed 字段拒绝删除**（ADR D3「seed 行不可删」）—— 返回 `InvalidInput`。
    /// - 定义与整批值共享同一 `deleted_at`，使 `undelete` 能精确还原，而非盲目复活旧数据。
    /// - 返回受影响条目数，供 UI 在删除前告知用户。
    pub fn delete_with_cascade(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<CascadeDeleteReport, Box<dyn Error>> {
        let fd = repository::FieldDefinitionRepository::get_by_id(storage.field_definitions(), id)?;
        if fd.is_system {
            return Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("system field definitions are not deletable: {}", fd.key),
            )));
        }

        let now = chrono::Utc::now().timestamp_millis();
        let affected = repository::FieldValueRepository::soft_delete_by_field_definition(
            storage.field_values(),
            id,
            now,
        )?;
        repository::FieldDefinitionRepository::soft_delete_at(storage.field_definitions(), id, now)?;

        Ok(CascadeDeleteReport {
            definition_id: id.to_string(),
            affected_values: affected,
            deleted_at: now,
        })
    }

    /// 撤销级联软删：先按删除戳复活整批值，再复活定义本体。
    /// 值是**按戳精确匹配**的，因此不会误复活更早之前单独软删的行。
    pub fn undelete(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<(), Box<dyn Error>> {
        let fd =
            repository::FieldDefinitionRepository::get_by_id_including_deleted(storage.field_definitions(), id)?;
        if let Some(stamp) = fd.deleted_at {
            repository::FieldValueRepository::restore_by_field_definition(
                storage.field_values(),
                id,
                stamp,
            )?;
        }
        repository::FieldDefinitionRepository::undelete(storage.field_definitions(), id)
    }

    /// 被软删的预设字段定义列表（「恢复内置预设」按钮可见性判断用）。
    pub fn get_deleted_presets(
        storage: &mut dyn StorageAdapter,
    ) -> Result<Vec<FieldDefinition>, Box<dyn Error>> {
        repository::FieldDefinitionRepository::get_deleted_presets(storage.field_definitions())
    }

    /// 批量复活被软删的预设字段定义（ADR-0049 三态模型：预设删后可恢复）。
    /// 返回被复活的 id 列表，供上层登记 sync。
    pub fn restore_presets(
        storage: &mut dyn StorageAdapter,
    ) -> Result<Vec<String>, Box<dyn Error>> {
        repository::FieldDefinitionRepository::restore_presets(storage.field_definitions())
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use crate::storage::sqlite::SQLiteAdapter;
    use crate::types::{Block, BlockCreateOptions, FieldValue, FieldValueCreateOptions, Page};

    /// FieldValue 有 `block_id → Block(id) → Page(id)` 外键约束（且 PRAGMA foreign_keys=ON），
    /// 故测试必须先搭起这条宿主链。
    fn fixture() -> (SQLiteAdapter, Block) {
        let mut adapter = SQLiteAdapter::open_in_memory().unwrap();
        let page = Page::new("cascade-test");
        repository::PageRepository::create(adapter.pages(), &page).unwrap();
        let block = Block::new(BlockCreateOptions {
            page_id: page.id.clone(),
            parent_id: None,
            content: "hello".to_string(),
            r#type: None,
        });
        repository::BlockRepository::create(adapter.blocks(), &block).unwrap();
        (adapter, block)
    }

    fn make_value(adapter: &mut SQLiteAdapter, block_id: &str, fd_id: &str, seq: i64) -> FieldValue {
        let fv = FieldValue::new(FieldValueCreateOptions {
            block_id: block_id.to_string(),
            field_definition_id: fd_id.to_string(),
            value_json: format!("\"v{}\"", seq),
            value_type: "text".to_string(),
            seq,
        });
        repository::FieldValueRepository::create(adapter.field_values(), &fv).unwrap()
    }

    fn live_values(adapter: &mut SQLiteAdapter, block_id: &str) -> usize {
        repository::FieldValueRepository::get_by_block_id(adapter.field_values(), block_id)
            .unwrap()
            .len()
    }

    #[test]
    fn cascade_delete_soft_deletes_values_and_undelete_restores_them() {
        let (mut adapter, block) = fixture();

        let fd = FieldDefinitionService::create(
            &mut adapter,
            FieldDefinitionCreateOptions {
                key: "my-field".to_string(),
                title: "My Field".to_string(),
                r#type: "text".to_string(),
                closed_values: None,
                default_value: None,
                is_system: false,
            },
        )
        .unwrap();

        make_value(&mut adapter, &block.id, &fd.id, 0);
        make_value(&mut adapter, &block.id, &fd.id, 1);
        assert_eq!(live_values(&mut adapter, &block.id), 2);

        // 级联软删：回执带受影响条目数（D9「删除前告知」）
        let report = FieldDefinitionService::delete_with_cascade(&mut adapter, &fd.id).unwrap();
        assert_eq!(report.definition_id, fd.id);
        assert_eq!(report.affected_values, 2);
        assert_eq!(live_values(&mut adapter, &block.id), 0);
        // 定义本身也软删 → 常规 get_by_id（过滤 deleted_at）读不到
        assert!(FieldDefinitionService::get_by_id(&mut adapter, &fd.id).is_err());

        // undo：按同一删除戳复活整批值 + 定义本体
        FieldDefinitionService::undelete(&mut adapter, &fd.id).unwrap();
        assert_eq!(
            live_values(&mut adapter, &block.id),
            2,
            "级联软删的值应被完整复活"
        );
        assert_eq!(
            FieldDefinitionService::get_by_id(&mut adapter, &fd.id).unwrap().key,
            "my-field"
        );
    }

    #[test]
    fn seeded_system_field_definitions_are_present_and_not_deletable() {
        let mut adapter = SQLiteAdapter::open_in_memory().unwrap();

        // seed 已注入系统 10 字段（project/area 已主动取消）
        let status = FieldDefinitionService::get_by_key(&mut adapter, "status")
            .unwrap()
            .expect("seeded status field");
        assert!(status.is_system);

        let err = FieldDefinitionService::delete_with_cascade(&mut adapter, &status.id).unwrap_err();
        assert!(
            err.to_string().contains("system field definitions are not deletable"),
            "系统 seed 行不可删（ADR D3），实际错误: {}",
            err
        );
        // 未被删除
        assert!(FieldDefinitionService::get_by_id(&mut adapter, &status.id).is_ok());
    }

    #[test]
    fn restore_presets_revives_only_soft_deleted_presets() {
        let mut adapter = SQLiteAdapter::open_in_memory().unwrap();

        // 软删一个预设（book 是 seed 的 is_preset=1 字段）
        let preset = FieldDefinitionService::get_by_key(&mut adapter, "book")
            .unwrap()
            .expect("seeded preset book");
        repository::FieldDefinitionRepository::soft_delete_at(
            adapter.field_definitions(),
            &preset.id,
            chrono::Utc::now().timestamp_millis(),
        )
        .unwrap();
        assert!(
            FieldDefinitionService::get_by_id(&mut adapter, &preset.id).is_err(),
            "预设已软删，常规读不到"
        );

        // 软删一个用户自建字段（is_preset=0）—— 恢复操作不应触碰它
        let user_fd = FieldDefinitionService::create(
            &mut adapter,
            FieldDefinitionCreateOptions {
                key: "my-field".to_string(),
                title: "My Field".to_string(),
                r#type: "text".to_string(),
                closed_values: None,
                default_value: None,
                is_system: false,
            },
        )
        .unwrap();
        FieldDefinitionService::delete_with_cascade(&mut adapter, &user_fd.id).unwrap();

        // 批量恢复：只复活预设（book），用户字段保持软删
        let restored = FieldDefinitionService::restore_presets(&mut adapter).unwrap();
        assert_eq!(restored, vec![preset.id.clone()]);
        assert!(
            FieldDefinitionService::get_by_id(&mut adapter, &preset.id).is_ok(),
            "预设应被复活"
        );
        assert!(
            FieldDefinitionService::get_by_id(&mut adapter, &user_fd.id).is_err(),
            "用户自建字段不应被恢复"
        );

        // 系统字段（status）始终不受影响
        let status_id = FieldDefinitionService::get_by_key(&mut adapter, "status")
            .unwrap()
            .expect("seeded status")
            .id;
        assert!(FieldDefinitionService::get_by_id(&mut adapter, &status_id).is_ok());
    }
}
