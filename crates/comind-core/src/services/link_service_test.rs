#[cfg(test)]
mod tests {
    use crate::{
        services::{LinkService, PageService, BlockService},
        storage::sqlite::SQLiteAdapter,
    };
    use std::error::Error;

    fn create_test_adapter() -> Result<SQLiteAdapter, Box<dyn Error>> {
        SQLiteAdapter::open_in_memory()
    }

    #[test]
    fn test_create_link() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let page = PageService::create(&mut adapter, "", "Source Page", None, None, None, None, None)?;
        let block = BlockService::create(&mut adapter, &page.id, None, "Content", "{}", "bullet", None)?;
        let target_page = PageService::create(&mut adapter, "", "Target Page", None, None, None, None, None)?;

        let link = LinkService::create(
            &mut adapter,
            &block.id,
            &target_page.id,
            "Target Page",
            None,
        )?;

        assert!(!link.id.is_empty());
        assert_eq!(link.source_block_id, block.id);
        assert_eq!(link.target_page_id, target_page.id);
        assert_eq!(link.display_text, "Target Page");

        Ok(())
    }

    #[test]
    fn test_get_links_by_source_block() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let page = PageService::create(&mut adapter, "", "Page", None, None, None, None, None)?;
        let block = BlockService::create(&mut adapter, &page.id, None, "Content with links", "{}", "bullet", None)?;
        let target1 = PageService::create(&mut adapter, "", "Target 1", None, None, None, None, None)?;
        let target2 = PageService::create(&mut adapter, "", "Target 2", None, None, None, None, None)?;

        LinkService::create(&mut adapter, &block.id, &target1.id, "Target 1", None)?;
        LinkService::create(&mut adapter, &block.id, &target2.id, "Target 2", None)?;

        let links = LinkService::get_by_source_block_id(&mut adapter, &block.id)?;

        assert_eq!(links.len(), 2);

        Ok(())
    }

    #[test]
    fn test_get_links_by_target_page() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let page1 = PageService::create(&mut adapter, "", "Page 1", None, None, None, None, None)?;
        let page2 = PageService::create(&mut adapter, "", "Page 2", None, None, None, None, None)?;
        let target = PageService::create(&mut adapter, "", "Target", None, None, None, None, None)?;

        let block1 = BlockService::create(&mut adapter, &page1.id, None, "Links to target", "{}", "bullet", None)?;
        let block2 = BlockService::create(&mut adapter, &page2.id, None, "Also links to target", "{}", "bullet", None)?;

        LinkService::create(&mut adapter, &block1.id, &target.id, "Target", None)?;
        LinkService::create(&mut adapter, &block2.id, &target.id, "Target", None)?;

        let links = LinkService::get_by_target_page_id(&mut adapter, &target.id)?;

        assert_eq!(links.len(), 2);

        Ok(())
    }

    #[test]
    fn test_delete_link() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let page = PageService::create(&mut adapter, "", "Page", None, None, None, None, None)?;
        let block = BlockService::create(&mut adapter, &page.id, None, "Content", "{}", "bullet", None)?;
        let target = PageService::create(&mut adapter, "", "Target", None, None, None, None, None)?;

        let link = LinkService::create(&mut adapter, &block.id, &target.id, "Target", None)?;
        LinkService::delete(&mut adapter, &link.id)?;

        let result = LinkService::get_by_id(&mut adapter, &link.id);
        assert!(result.is_err());

        Ok(())
    }

    #[test]
    fn test_delete_links_by_source_block() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let page = PageService::create(&mut adapter, "", "Page", None, None, None, None, None)?;
        let block = BlockService::create(&mut adapter, &page.id, None, "Content", "{}", "bullet", None)?;
        let target = PageService::create(&mut adapter, "", "Target", None, None, None, None, None)?;

        LinkService::create(&mut adapter, &block.id, &target.id, "Target", None)?;
        LinkService::delete_by_source_block_id(&mut adapter, &block.id)?;

        let links = LinkService::get_by_source_block_id(&mut adapter, &block.id)?;
        assert!(links.is_empty());

        Ok(())
    }

    /// 内容重同步保留系统保留关系类型（tag/extend），只重建内容派生链接
    /// （#130/#132 修复：否则任何一次 block 保存都会抹掉已贴的标签/继承链接）。
    #[test]
    fn test_sync_links_preserves_reserved_relationship_types() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        let page = PageService::create(&mut adapter, "", "Page", None, None, None, None, None)?;
        let block = BlockService::create(&mut adapter, &page.id, None, "Content", "{}", "bullet", None)?;
        let tag_page = PageService::create(&mut adapter, "", "Book", None, None, None, None, None)?;
        let parent_tag = PageService::create(&mut adapter, "", "Media", None, None, None, None, None)?;
        let content_target = PageService::create(&mut adapter, "", "Note", None, None, None, None, None)?;

        LinkService::create(&mut adapter, &block.id, &tag_page.id, "Book", Some("tag"))?;
        LinkService::create(&mut adapter, &block.id, &parent_tag.id, "Media", Some("extend"))?;
        LinkService::create(&mut adapter, &block.id, &content_target.id, "Note", None)?;

        // 内容重同步为空集：只应清掉非保留链接（content_target），保留 tag / extend
        LinkService::sync_links_for_block(&mut adapter, &block.id, &[])?;

        let links = LinkService::get_by_source_block_id(&mut adapter, &block.id)?;
        assert_eq!(links.len(), 2, "应保留 tag/extend 两条，实际 {}", links.len());
        assert!(links.iter().any(|l| l.relationship_type.as_deref() == Some("tag")));
        assert!(links.iter().any(|l| l.relationship_type.as_deref() == Some("extend")));
        assert!(!links.iter().any(|l| l.target_page_id == content_target.id));

        Ok(())
    }
}