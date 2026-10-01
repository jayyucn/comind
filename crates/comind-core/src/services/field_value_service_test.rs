#[cfg(test)]
mod tests {
    use crate::{
        services::{FieldValueService, PageService, BlockService},
        storage::sqlite::SQLiteAdapter,
    };
    use std::error::Error;

    fn create_test_adapter() -> Result<SQLiteAdapter, Box<dyn Error>> {
        SQLiteAdapter::open_in_memory()
    }

    fn create_test_block(adapter: &mut SQLiteAdapter) -> Result<String, Box<dyn Error>> {
        let page = PageService::create(adapter, "", "Page", None, None, None, None, None)?;
        let block = BlockService::create(adapter, &page.id, None, "Content", "{}", "bullet", None, true)?;
        Ok(block.id)
    }

    #[test]
    fn test_create_field_value() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        let field_value = FieldValueService::create(&mut adapter, &block_id, "status", "Done", "string", 0)?;

        assert!(!field_value.id.is_empty());
        assert_eq!(field_value.block_id, block_id);
        assert_eq!(field_value.key, "status");
        assert_eq!(field_value.value_json, "Done");
        assert_eq!(field_value.value_type, "string");

        Ok(())
    }

    #[test]
    fn test_get_field_value_by_block_id() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        FieldValueService::create(&mut adapter, &block_id, "key1", "value1", "string", 0)?;
        FieldValueService::create(&mut adapter, &block_id, "key2", "value2", "number", 1)?;

        let field_values = FieldValueService::get_by_block_id(&mut adapter, &block_id)?;

        assert_eq!(field_values.len(), 2);

        Ok(())
    }

    #[test]
    fn test_get_field_value_by_block_id_and_key() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        FieldValueService::create(&mut adapter, &block_id, "status", "Done", "string", 0)?;

        let found = FieldValueService::get_by_block_id_and_key(&mut adapter, &block_id, "status")?;
        assert!(found.is_some());
        assert_eq!(found.unwrap().value_json, "Done");

        let not_found = FieldValueService::get_by_block_id_and_key(&mut adapter, &block_id, "nonexistent")?;
        assert!(not_found.is_none());

        Ok(())
    }

    #[test]
    fn test_update_field_value() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        let mut field_value = FieldValueService::create(&mut adapter, &block_id, "status", "Todo", "string", 0)?;
        field_value = FieldValueService::update(&mut adapter, &field_value.id, Some("Done"), None, None)?;

        assert_eq!(field_value.value_json, "Done");

        Ok(())
    }

    #[test]
    fn test_delete_field_value() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        let field_value = FieldValueService::create(&mut adapter, &block_id, "status", "Done", "string", 0)?;
        FieldValueService::delete(&mut adapter, &field_value.id)?;

        let result = FieldValueService::get_by_block_id_and_key(&mut adapter, &block_id, "status")?;
        assert!(result.is_none());

        Ok(())
    }

    #[test]
    fn test_delete_field_values_by_block_id() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        FieldValueService::create(&mut adapter, &block_id, "key1", "value1", "string", 1)?;
        FieldValueService::create(&mut adapter, &block_id, "key2", "value2", "string", 1)?;
        FieldValueService::delete_by_block_id(&mut adapter, &block_id)?;

        let field_values = FieldValueService::get_by_block_id(&mut adapter, &block_id)?;
        assert!(field_values.is_empty());

        Ok(())
    }

    // ── ADR-0049 D6：FieldValue 库内形状语义 ─────────────────────

    #[test]
    fn test_save_revives_deleted_by_id() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        let prop = FieldValueService::create(&mut adapter, &block_id, "status", "Todo", "string", 0)?;
        let original_created_at = prop.created_at;
        FieldValueService::delete(&mut adapter, &prop.id)?;
        assert!(FieldValueService::get_by_block_id_and_key(&mut adapter, &block_id, "status")?.is_none());

        // 撤销重放：同一 id 的快照 save 回来 → 复活软删行（id/created_at 保全）
        let (revived, _fd_id) = FieldValueService::save(&mut adapter, &prop)?;
        assert_eq!(revived.id, prop.id);
        assert_eq!(revived.created_at, original_created_at);
        assert_eq!(revived.value_json, "Todo");

        let roundtrip = FieldValueService::get_by_block_id_and_key(&mut adapter, &block_id, "status")?;
        assert!(roundtrip.is_some());
        assert_eq!(roundtrip.unwrap().id, prop.id);

        Ok(())
    }

    #[test]
    fn test_save_overwrites_same_key_row_keeping_id() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        let existing = FieldValueService::create(&mut adapter, &block_id, "status", "Todo", "string", 0)?;

        // 不同 id 但同 (block, field_def) 的行 → 覆盖存活行、保原 id，不插第二行
        let mut incoming = existing.clone();
        incoming.id = "regenerated-id".to_string();
        incoming.value_json = "Done".to_string();
        let (saved, _fd_id) = FieldValueService::save(&mut adapter, &incoming)?;
        assert_eq!(saved.id, existing.id);
        assert_eq!(saved.value_json, "Done");

        let all = FieldValueService::get_by_block_id(&mut adapter, &block_id)?;
        assert_eq!(all.len(), 1);

        Ok(())
    }

    #[test]
    fn test_unknown_key_auto_creates_field_definition() -> Result<(), Box<dyn Error>> {
        use crate::storage::repository::{FieldDefinitionRepository, StorageAdapter};

        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        assert!(FieldDefinitionRepository::get_by_key(adapter.field_definitions(), "custom_kpi")?.is_none());

        FieldValueService::create(&mut adapter, &block_id, "custom_kpi", "42", "number", 0)?;

        let fd = FieldDefinitionRepository::get_by_key(adapter.field_definitions(), "custom_kpi")?;
        assert!(fd.is_some());
        let fd = fd.unwrap();
        assert_eq!(fd.key, "custom_kpi");
        assert_eq!(fd.title, "custom_kpi");
        assert_eq!(fd.r#type, "number");
        assert!(!fd.is_system);

        Ok(())
    }

    #[test]
    fn test_query_block_ids_by_key_value() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_a = create_test_block(&mut adapter)?;
        let block_b = create_test_block(&mut adapter)?;

        FieldValueService::create(&mut adapter, &block_a, "status", "Todo", "string", 0)?;
        FieldValueService::create(&mut adapter, &block_b, "status", "Done", "string", 0)?;

        let todos = FieldValueService::query_block_ids_by_key_value(
            &mut adapter,
            "status",
            &["Todo".to_string()],
        )?;
        assert_eq!(todos, vec![block_a.clone()]);

        let both = FieldValueService::query_block_ids_by_key_value(
            &mut adapter,
            "status",
            &["Todo".to_string(), "Done".to_string()],
        )?;
        assert_eq!(both.len(), 2);

        let none = FieldValueService::query_block_ids_by_key_value(
            &mut adapter,
            "status",
            &["Doing".to_string()],
        )?;
        assert!(none.is_empty());

        Ok(())
    }
}
