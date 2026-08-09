#[cfg(test)]
mod tests {
    use crate::{
        services::{
            render_segment_service::build_segments_for_block,
            BlockService, LinkService, PageService, RelationshipTypeService,
        },
        storage::sqlite::SQLiteAdapter,
        types::{RenderSegment},
    };
    use std::error::Error;

    #[test]
    fn test_build_segments_for_block() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;

        // ── Setup: source page + block ──
        let src_page = PageService::create(&mut adapter, "", "Source Page", None, None, None, None, None)?;
        let block = BlockService::create(
            &mut adapter, &src_page.id, None,
            // content with embedded link pattern [[Target]]
            "hello [[Target Page|alias]] world ((relates))[[Target Page]] tail @2026-08-15",
            "{}", "bullet", None,
        )?;

        // ── Setup: target page ──
        let target_page = PageService::create(&mut adapter, "", "Target Page", None, None, None, None, None)?;

        // ── Setup: relationship types ──
        RelationshipTypeService::create(
            &mut adapter, None, "relates", None,
            "相关", "被相关", "#3B82F6", 0, "medium", 0,
        )?;

        // ── Setup: create links from block → target page ──
        // Link 1: plain [[Target Page|alias]]
        LinkService::create(
            &mut adapter, &block.id, &target_page.id, "alias", None,
        )?;
        // Link 2: typed ((relates))[[Target Page]]
        LinkService::create(
            &mut adapter, &block.id, &target_page.id, "Target Page",
            Some("relates"),
        )?;

        // ── Act ──
        let segments = build_segments_for_block(&mut adapter, &block)?;

        // ── Assert: segments should be non-empty ──
        assert!(!segments.is_empty(), "bullet block should produce segments");

        // ── Assert: segment coverage (should cover the full content range) ──
        let content_len = block.content.len();
        let mut covered_end = 0usize;
        for seg in &segments {
            let (s, e) = match seg {
                RenderSegment::Text { start, end } => (*start, *end),
                RenderSegment::Link { start, end, .. } => (*start, *end),
                RenderSegment::TypedLink { start, end, .. } => (*start, *end),
                RenderSegment::DateRef { start, end, .. } => (*start, *end),
                _ => continue,
            };
            assert_eq!(s, covered_end, "segments should be contiguous: gap before offset {}", s);
            covered_end = e;
        }
        assert_eq!(covered_end, content_len, "final segment should cover end of content");

        // ── Assert: segment types present ──
        let has_text = segments.iter().any(|s| matches!(s, RenderSegment::Text { .. }));
        let has_link = segments.iter().any(|s| matches!(s, RenderSegment::Link { .. }));
        let has_typed = segments.iter().any(|s| matches!(s, RenderSegment::TypedLink { .. }));
        let has_date = segments.iter().any(|s| matches!(s, RenderSegment::DateRef { .. }));

        assert!(has_text, "should have Text segments");
        assert!(has_link, "should have Link segment for [[Target Page|alias]]");
        assert!(has_typed, "should have TypedLink segment for ((relates))[[Target Page]]");
        assert!(has_date, "should have DateRef segment for @2026-08-15");

        // ── Assert: TypedLink segment details ──
        let typed = segments.iter().find_map(|s| match s {
            RenderSegment::TypedLink { rel_label, rel_color, relationship_type, .. } => {
                Some((rel_label, rel_color, relationship_type))
            }
            _ => None,
        }).expect("should have a TypedLink");
        assert_eq!(typed.0, "相关", "rel_label should be 相关");
        assert_eq!(typed.1, "#3B82F6", "rel_color should be #3B82F6");
        assert_eq!(typed.2, "relates", "relationship_type should be relates");

        // ── Assert: Link segment details ──
        let link = segments.iter().find_map(|s| match s {
            RenderSegment::Link { target_page_title, display_text, .. } => {
                Some((target_page_title, display_text))
            }
            _ => None,
        }).expect("should have a Link");
        assert_eq!(link.0, "Target Page");
        assert_eq!(link.1, "alias");

        // ── Edge case: non-bullet block returns empty ──
        let code_block = BlockService::create(
            &mut adapter, &src_page.id, None,
            "print('hello')", "{}", "code", None,
        )?;
        let empty = build_segments_for_block(&mut adapter, &code_block)?;
        assert!(empty.is_empty(), "code block should return empty segments");

        // ── Edge case: bullet block with no links → text-only segment ──
        let plain_block = BlockService::create(
            &mut adapter, &src_page.id, None,
            "just some plain text", "{}", "bullet", None,
        )?;
        let plain_segs = build_segments_for_block(&mut adapter, &plain_block)?;
        assert_eq!(plain_segs.len(), 1);
        assert!(matches!(plain_segs[0], RenderSegment::Text { .. }));
        if let RenderSegment::Text { start, end } = &plain_segs[0] {
            assert_eq!(*start, 0);
            assert_eq!(*end, plain_block.content.len());
        }

        Ok(())
    }

    /// Test that Chinese content produces correct char-based offsets (not byte offsets).
    /// This ensures JS String.slice(start, end) works correctly.
    #[test]
    fn test_chinese_content_char_offsets() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;

        // Setup page and block with Chinese content + date ref
        let page = PageService::create(&mut adapter, "", "Test", None, None, None, None, None)?;
        // "这是测试内容 " = 7 chars (Chinese char = 1 char in JS, 3 bytes in UTF-8)
        // "@2026-08-09" = 11 chars
        // " 📅" = 2 chars (space + emoji)
        let block = BlockService::create(
            &mut adapter, &page.id, None,
            "这是测试内容 @2026-08-09 📅",
            "{}", "bullet", None,
        )?;

        let segments = build_segments_for_block(&mut adapter, &block)?;

        // Should have: Text(0-8) + DateRef(8-21)
        // "这是测试内容 " = 7 chars, but wait - let me count:
        // 这(0)是(1)测(2)试(3)内(4)容(5) (6)@(7)... 
        // Actually: "这是测试内容 " = 7 chars, "@2026-08-09 📅" starts at char 7
        assert_eq!(segments.len(), 2, "should have text + date_ref segments");

        // First segment should be text ending before @
        if let RenderSegment::Text { start, end } = &segments[0] {
            assert_eq!(*start, 0);
            assert_eq!(*end, 7, "text should end before @ (char index 7)");
        } else {
            panic!("first segment should be Text");
        }

        // Second segment should be date_ref covering @2026-08-09 📅
        if let RenderSegment::DateRef { start, end, iso, .. } = &segments[1] {
            assert_eq!(*start, 7, "date_ref should start at @ (char index 7)");
            assert_eq!(*end, 20, "date_ref should end after emoji (char index 20)");
            assert_eq!(iso, "2026-08-09");
        } else {
            panic!("second segment should be DateRef");
        }

        // Verify char offsets work correctly for JS slice
        // In JS: "这是测试内容 @2026-08-09 📅".slice(0, 7) === "这是测试内容 "
        //         "这是测试内容 @2026-08-09 📅".slice(7, 20) === "@2026-08-09 📅"
        let content = "这是测试内容 @2026-08-09 📅";
        let chars: Vec<char> = content.chars().collect();
        let slice_0_7: String = chars[0..7].iter().collect();
        let slice_7_20: String = chars[7..20].iter().collect();
        assert_eq!(slice_0_7, "这是测试内容 ");
        assert_eq!(slice_7_20, "@2026-08-09 📅");

        Ok(())
    }
}
