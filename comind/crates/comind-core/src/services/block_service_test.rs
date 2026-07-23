#[cfg(test)]
mod tests {
    use crate::{
        services::{BlockService, PageService},
        storage::sqlite::SQLiteAdapter,
    };
    use std::error::Error;

    fn create_test_adapter() -> Result<SQLiteAdapter, Box<dyn Error>> {
        SQLiteAdapter::open_in_memory()
    }

    fn create_test_page(adapter: &mut SQLiteAdapter, title: &str) -> Result<String, Box<dyn Error>> {
        let page = PageService::create(adapter, "", title, None, None, None, None, None)?;
        Ok(page.id)
    }

    #[test]
    fn test_create_block() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let page_id = create_test_page(&mut adapter, "Test Page")?;

        let block = BlockService::create(&mut adapter, &page_id, None, "Test content", "{}", "bullet", None)?;

        assert!(!block.id.is_empty());
        assert_eq!(block.page_id, page_id);
        assert_eq!(block.parent_id, None);
        assert_eq!(block.content, "Test content");
        assert_eq!(block.r#type, "bullet");

        Ok(())
    }

    #[test]
    fn test_get_block_by_id() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let page_id = create_test_page(&mut adapter, "Test Page 2")?;

        let created = BlockService::create(&mut adapter, &page_id, None, "Content", "{}", "bullet", None)?;
        let retrieved = BlockService::get_by_id(&mut adapter, &created.id)?;

        assert_eq!(retrieved.id, created.id);
        assert_eq!(retrieved.content, "Content");

        Ok(())
    }

    #[test]
    fn test_update_block() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let page_id = create_test_page(&mut adapter, "Test Page 3")?;

        let mut block = BlockService::create(&mut adapter, &page_id, None, "Old content", "{}", "bullet", None)?;
        block = BlockService::update(&mut adapter, &block.id, Some("New content"), None, None, None, None)?;

        assert_eq!(block.content, "New content");

        Ok(())
    }

    #[test]
    fn test_delete_block() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let page_id = create_test_page(&mut adapter, "Test Page 4")?;

        let block = BlockService::create(&mut adapter, &page_id, None, "Content to delete", "{}", "bullet", None)?;
        BlockService::delete(&mut adapter, &block.id)?;

        let result = BlockService::get_by_id(&mut adapter, &block.id);
        assert!(result.is_err());

        Ok(())
    }

    #[test]
    fn test_build_tree() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let page_id = create_test_page(&mut adapter, "Tree Test")?;

        let root1 = BlockService::create(&mut adapter, &page_id, None, "Root 1", "{}", "bullet", None)?;
        let root2 = BlockService::create(&mut adapter, &page_id, None, "Root 2", "{}", "bullet", None)?;
        let child1 = BlockService::create(&mut adapter, &page_id, Some(&root1.id), "Child 1", "{}", "bullet", None)?;

        let tree = BlockService::build_tree(&mut adapter, &page_id)?;

        assert_eq!(tree.root_blocks.len(), 2);
        assert_eq!(tree.block_map.len(), 3);
        assert!(tree.children_map.get(&root1.id).is_some());
        assert_eq!(tree.children_map.get(&root1.id).unwrap().len(), 1);

        Ok(())
    }

    #[test]
    fn test_gap_sort_pos() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let page_id = create_test_page(&mut adapter, "Gap Sort Test")?;

        let first = BlockService::create(&mut adapter, &page_id, None, "First", "{}", "bullet", None)?;
        assert_eq!(first.pos, 1000);

        let second = BlockService::create(&mut adapter, &page_id, None, "Second", "{}", "bullet", None)?;
        assert_eq!(second.pos, 500);

        let third = BlockService::create(&mut adapter, &page_id, None, "Third", "{}", "bullet", None)?;
        assert_eq!(third.pos, 250);

        Ok(())
    }
}
