#[cfg(test)]
mod tests {
    use crate::{
        search::SearchService,
        services::{PageService, BlockService},
        storage::sqlite::SQLiteAdapter,
    };
    use std::error::Error;

    fn create_test_adapter() -> Result<SQLiteAdapter, Box<dyn Error>> {
        SQLiteAdapter::open_in_memory()
    }

    #[test]
    fn test_search() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let page = PageService::create(&mut adapter, "", "Search Test Page", None, None, None, None, None)?;
        let block = BlockService::create(&mut adapter, &page.id, None, "This is a test content about Rust programming", "{}", "bullet", None)?

        SearchService::update_index(&mut adapter, &block.id, &block.content, &page.title)?;

        let results = SearchService::search(&mut adapter, "Rust", Some(10))?;

        assert!(!results.is_empty());
        assert_eq!(results[0].block_id, block.id);

        Ok(())
    }

    #[test]
    fn test_search_empty_query() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let results = SearchService::search(&mut adapter, "", Some(10))?;
        assert!(results.is_empty());

        let results = SearchService::search(&mut adapter, "   ", Some(10))?;
        assert!(results.is_empty());

        Ok(())
    }

    #[test]
    fn test_search_not_found() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let page = PageService::create(&mut adapter, "", "Page", None, None, None, None, None)?;
        let block = BlockService::create(&mut adapter, &page.id, None, "Test content", "{}", "bullet", None)?;

        SearchService::update_index(&mut adapter, &block.id, &block.content, &page.title)?;

        let results = SearchService::search(&mut adapter, "nonexistent term", Some(10))?;
        assert!(results.is_empty());

        Ok(())
    }

    #[test]
    fn test_delete_from_index() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let page = PageService::create(&mut adapter, "", "Page", None, None, None, None, None)?;
        let block = BlockService::create(&mut adapter, &page.id, None, "Test content", "{}", "bullet", None)?;

        SearchService::update_index(&mut adapter, &block.id, &block.content, &page.title)?;

        let results_before = SearchService::search(&mut adapter, "Test", Some(10))?;
        assert!(!results_before.is_empty());

        SearchService::delete_from_index(&mut adapter, &block.id)?;

        let results_after = SearchService::search(&mut adapter, "Test", Some(10))?;
        assert!(results_after.is_empty());

        Ok(())
    }

    #[test]
    fn test_rebuild_index() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let page1 = PageService::create(&mut adapter, "", "Page One", None, None, None, None, None)?;
        let _block1 = BlockService::create(&mut adapter, &page1.id, None, "Content for page one", "{}", "bullet", None)?

        let page2 = PageService::create(&mut adapter, "", "Page Two", None, None, None, None, None)?;
        let _block2 = BlockService::create(&mut adapter, &page2.id, None, "Content for page two", "{}", "bullet", None)?

        SearchService::rebuild_index(&mut adapter)?;

        let results = SearchService::search(&mut adapter, "page", Some(10))?;

        assert!(results.len() >= 2);

        Ok(())
    }
}