#[cfg(test)]
mod tests {
    use crate::{
        services::{PropertyService, PageService, BlockService},
        storage::sqlite::SQLiteAdapter,
    };
    use std::error::Error;

    fn create_test_adapter() -> Result<SQLiteAdapter, Box<dyn Error>> {
        SQLiteAdapter::open_in_memory()
    }

    fn create_test_block(adapter: &mut SQLiteAdapter) -> Result<String, Box<dyn Error>> {
        let page = PageService::create(adapter, "", "Page", None, None, None, None, None)?;
        let block = BlockService::create(adapter, &page.id, None, "Content", "{}", "bullet")?;
        Ok(block.id)
    }

    #[test]
    fn test_create_property() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        let property = PropertyService::create(&mut adapter, &block_id, "status", "Done", "string", 0, 0, 1)?;

        assert!(!property.id.is_empty());
        assert_eq!(property.block_id, block_id);
        assert_eq!(property.key, "status");
        assert_eq!(property.value, "Done");
        assert_eq!(property.r#type, "string");

        Ok(())
    }

    #[test]
    fn test_get_property_by_block_id() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        PropertyService::create(&mut adapter, &block_id, "key1", "value1", "string", 0, 0, 1)?;
        PropertyService::create(&mut adapter, &block_id, "key2", "value2", "number", 1, 0, 1)?;

        let properties = PropertyService::get_by_block_id(&mut adapter, &block_id)?;

        assert_eq!(properties.len(), 2);

        Ok(())
    }

    #[test]
    fn test_get_property_by_block_id_and_key() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        PropertyService::create(&mut adapter, &block_id, "status", "Done", "string", 0, 0, 1)?;

        let found = PropertyService::get_by_block_id_and_key(&mut adapter, &block_id, "status")?;
        assert!(found.is_some());
        assert_eq!(found.unwrap().value, "Done");

        let not_found = PropertyService::get_by_block_id_and_key(&mut adapter, &block_id, "nonexistent")?;
        assert!(not_found.is_none());

        Ok(())
    }

    #[test]
    fn test_update_property() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        let mut property = PropertyService::create(&mut adapter, &block_id, "status", "Todo", "string", 0, 0, 1)?;
        property = PropertyService::update(&mut adapter, &property.id, Some("Done"), None, None, None)?;

        assert_eq!(property.value, "Done");

        Ok(())
    }

    #[test]
    fn test_delete_property() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        let property = PropertyService::create(&mut adapter, &block_id, "status", "Done", "string", 0, 0, 1)?;
        PropertyService::delete(&mut adapter, &property.id)?;

        let result = PropertyService::get_by_block_id_and_key(&mut adapter, &block_id, "status")?;
        assert!(result.is_none());

        Ok(())
    }

    #[test]
    fn test_delete_properties_by_block_id() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let block_id = create_test_block(&mut adapter)?;

        PropertyService::create(&mut adapter, &block_id, "key1", "value1", "string", 0, 0, 1)?;
        PropertyService::create(&mut adapter, &block_id, "key2", "value2", "string", 1, 0, 1)?;
        PropertyService::delete_by_block_id(&mut adapter, &block_id)?;

        let properties = PropertyService::get_by_block_id(&mut adapter, &block_id)?;
        assert!(properties.is_empty());

        Ok(())
    }
}