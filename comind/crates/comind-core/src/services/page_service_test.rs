#[cfg(test)]
mod tests {
    use crate::{
        services::PageService,
        storage::sqlite::SQLiteAdapter,
    };
    use std::error::Error;

    fn create_test_adapter() -> Result<SQLiteAdapter, Box<dyn Error>> {
        SQLiteAdapter::open_in_memory()
    }

    #[test]
    fn test_create_page() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let page = PageService::create(
            &mut adapter,
            "",
            "Test Page Title",
            None,
            None,
            None,
            None,
            None,
        )?;

        assert!(!page.id.is_empty());
        assert_eq!(page.title, "Test Page Title");
        assert_eq!(page.r#type, "normal");

        Ok(())
    }

    #[test]
    fn test_get_page_by_id() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let created = PageService::create(
            &mut adapter,
            "",
            "Find Me",
            None,
            None,
            None,
            None,
            None,
        )?;

        let retrieved = PageService::get_by_id(&mut adapter, &created.id)?;

        assert_eq!(retrieved.id, created.id);
        assert_eq!(retrieved.title, "Find Me");

        Ok(())
    }

    #[test]
    fn test_get_page_by_title() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        PageService::create(
            &mut adapter,
            "",
            "Unique Title",
            None,
            None,
            None,
            None,
            None,
        )?;

        let found = PageService::get_by_title(&mut adapter, "Unique Title")?;
        assert!(found.is_some());
        assert_eq!(found.unwrap().title, "Unique Title");

        let not_found = PageService::get_by_title(&mut adapter, "Non-existent")?;
        assert!(not_found.is_none());

        Ok(())
    }

    #[test]
    fn test_update_page() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let mut page = PageService::create(
            &mut adapter,
            "",
            "Old Title",
            None,
            None,
            None,
            None,
            None,
        )?;

        page = PageService::update(
            &mut adapter,
            &page.id,
            Some("New Title"),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )?;

        assert_eq!(page.title, "New Title");

        Ok(())
    }

    #[test]
    fn test_page_exists_by_title() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        PageService::create(
            &mut adapter,
            "",
            "Exists",
            None,
            None,
            None,
            None,
            None,
        )?;

        assert!(PageService::exists_by_title(&mut adapter, "Exists")?);
        assert!(!PageService::exists_by_title(&mut adapter, "Does Not Exist")?);

        Ok(())
    }

    #[test]
    fn test_get_all_pages() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        PageService::create(&mut adapter, "", "Page 1", None, None, None, None, None)?;
        PageService::create(&mut adapter, "", "Page 2", None, None, None, None, None)?;
        PageService::create(&mut adapter, "", "Page 3", None, None, None, None, None)?;

        let pages = PageService::get_all(&mut adapter)?;

        assert_eq!(pages.len(), 3);

        Ok(())
    }
}