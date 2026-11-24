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

        let block = BlockService::create(&mut adapter, &page_id, None, "Test content", "{}", "text", None, true)?;

        assert!(!block.id.is_empty());
        assert_eq!(block.page_id, page_id);
        assert_eq!(block.parent_id, None);
        assert_eq!(block.content, "Test content");
        assert_eq!(block.r#type, "text");

        Ok(())
    }

    #[test]
    fn test_get_block_by_id() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let page_id = create_test_page(&mut adapter, "Test Page 2")?;

        let created = BlockService::create(&mut adapter, &page_id, None, "Content", "{}", "text", None, true)?;
        let retrieved = BlockService::get_by_id(&mut adapter, &created.id)?;

        assert_eq!(retrieved.id, created.id);
        assert_eq!(retrieved.content, "Content");

        Ok(())
    }

    #[test]
    fn test_update_block() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let page_id = create_test_page(&mut adapter, "Test Page 3")?;

        let mut block = BlockService::create(&mut adapter, &page_id, None, "Old content", "{}", "text", None, true)?;
        block = BlockService::update(&mut adapter, &block.id, Some("New content"), None, None, None, None, true)?;

        assert_eq!(block.content, "New content");

        Ok(())
    }

    #[test]
    fn test_delete_block() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let page_id = create_test_page(&mut adapter, "Test Page 4")?;

        let block = BlockService::create(&mut adapter, &page_id, None, "Content to delete", "{}", "text", None, true)?;
        BlockService::delete(&mut adapter, &block.id)?;

        let result = BlockService::get_by_id(&mut adapter, &block.id);
        assert!(result.is_err());

        Ok(())
    }

    #[test]
    fn test_build_tree() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let page_id = create_test_page(&mut adapter, "Tree Test")?;

        let root1 = BlockService::create(&mut adapter, &page_id, None, "Root 1", "{}", "text", None, true)?;

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

        let first = BlockService::create(&mut adapter, &page_id, None, "First", "{}", "text", None, true)?;
        assert_eq!(first.pos, 1000);

        let second = BlockService::create(&mut adapter, &page_id, None, "Second", "{}", "text", None, true)?;
        assert_eq!(second.pos, 500);

        let third = BlockService::create(&mut adapter, &page_id, None, "Third", "{}", "text", None, true)?;
        assert_eq!(third.pos, 250);

        Ok(())
    }

    /// 行内代码（`format.inlineMarks` 的 `code` 区间）是字面文本：里面的 `#tag` /
    /// `[[页面]]` / `@日期` / `key:: value` 不派生任何东西。这里走完整 create 链路，
    /// 确认 format 真的传到了各解析器。
    #[test]
    fn inline_code_does_not_derive_tags_links_and_pages() -> Result<(), Box<dyn Error>> {
        use crate::services::link_service::LinkService;
        use crate::storage::repository::{PageRepository, StorageAdapter, TagRepository};

        let mut adapter = create_test_adapter()?;
        let page_id = create_test_page(&mut adapter, "宿主页")?;

        let content = "看 `#不是标签 [[不是页面]]` 和 #真标签";
        let start = content.find('`').unwrap();
        let end = content.rfind('`').unwrap() + 1;
        let utf16 = |byte_idx: usize| -> usize {
            content[..byte_idx].chars().map(|c| c.len_utf16()).sum()
        };
        let format = format!(
            r#"{{"inlineMarks":[{{"start":{},"end":{},"code":true}}]}}"#,
            utf16(start),
            utf16(end),
        );

        let block = BlockService::create(
            &mut adapter,
            &page_id,
            None,
            content,
            &format,
            "text",
            None,
            true,
        )?;

        // 只有代码外的 `#真标签` 上榜
        assert_eq!(block.tags.len(), 1);
        let tag = TagRepository::get_by_id(adapter.tags(), &block.tags[0])?;
        assert_eq!(tag.title, "真标签");
        assert!(TagRepository::get_by_title(adapter.tags(), "不是标签")?.is_none());

        // 代码里的 `[[不是页面]]` 不建链接，也不建页
        assert!(LinkService::get_by_source_block_id(&mut adapter, &block.id)?.is_empty());
        assert!(PageRepository::get_by_title(adapter.pages(), "不是页面")?.is_none());

        Ok(())
    }

    /// 更新路径同样屏蔽：把已有正文改成带行内代码的形式后，代码内的 `#xxx` 不得上榜。
    #[test]
    fn update_ignores_hashtags_inside_inline_code() -> Result<(), Box<dyn Error>> {
        use crate::storage::repository::{StorageAdapter, TagRepository};

        let mut adapter = create_test_adapter()?;
        let page_id = create_test_page(&mut adapter, "更新页")?;

        let block = BlockService::create(&mut adapter, &page_id, None, "旧正文", "{}", "text", None, true)?;

        let content = "`#不是标签` #真标签";
        let utf16 = |byte_idx: usize| -> usize {
            content[..byte_idx].chars().map(|c| c.len_utf16()).sum()
        };
        // 代码区间 = 两个反引号之间（含反引号）
        let code_end_byte = content[1..].find('`').unwrap() + 2;
        let format = format!(
            r#"{{"inlineMarks":[{{"start":0,"end":{},"code":true}}]}}"#,
            utf16(code_end_byte),
        );

        let updated = BlockService::update(
            &mut adapter,
            &block.id,
            Some(content),
            Some(&format),
            None,
            None,
            None,
            true,
        )?;

        assert_eq!(updated.tags.len(), 1);
        let tag = TagRepository::get_by_id(adapter.tags(), &updated.tags[0])?;
        assert_eq!(tag.title, "真标签");
        assert!(TagRepository::get_by_title(adapter.tags(), "不是标签")?.is_none());

        Ok(())
    }
}
