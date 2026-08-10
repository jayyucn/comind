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

    #[test]
    fn test_property_block_type_produces_segments() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;
        let page = PageService::create(&mut adapter, "", "Test", None, None, None, None, None)?;
        let target = PageService::create(&mut adapter, "", "Target", None, None, None, None, None)?;

        RelationshipTypeService::create(
            &mut adapter, None, "relates", None,
            "相关", "被相关", "#3B82F6", 0, "medium", 0,
        )?;

        let block = BlockService::create(
            &mut adapter, &page.id, None,
            "((relates))[[Target]] @2026-08-15",
            "{}", "property", None,
        )?;

        LinkService::create(
            &mut adapter, &block.id, &target.id, "Target",
            Some("relates"),
        )?;

        let segments = build_segments_for_block(&mut adapter, &block)?;
        assert!(!segments.is_empty(), "property block should produce segments");

        let has_typed = segments.iter().any(|s| matches!(s, RenderSegment::TypedLink { .. }));
        let has_date = segments.iter().any(|s| matches!(s, RenderSegment::DateRef { .. }));
        assert!(has_typed, "property block should have TypedLink segment");
        assert!(has_date, "property block should have DateRef segment");

        Ok(())
    }

    #[test]
    fn test_date_ref_with_recurrence_and_lead_minutes() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;
        let page = PageService::create(&mut adapter, "", "Test", None, None, None, None, None)?;

        let block = BlockService::create(
            &mut adapter, &page.id, None,
            "任务 @2026-08-15T14:00 ⏰|weekly|15",
            "{}", "bullet", None,
        )?;

        let segments = build_segments_for_block(&mut adapter, &block)?;

        let date_ref = segments.iter().find_map(|s| match s {
            RenderSegment::DateRef { iso, recurrence, lead_minutes, kind, .. } => {
                Some((iso, recurrence, lead_minutes, kind))
            }
            _ => None,
        }).expect("should have DateRef segment");

        assert_eq!(date_ref.0, "2026-08-15T14:00");
        assert_eq!(date_ref.1, "weekly");
        assert_eq!(*date_ref.2, 15);
        assert_eq!(date_ref.3, "deadline");

        Ok(())
    }

    /// Regression: dateRef 后紧跟空格 + 文本时，空格是语法分隔符，
    /// 不应包含在后续 Text 段中。
    /// 内容 "@2026-08-09 ⏰ 2026"（18 chars）:
    ///   @(0)2(1)0(2)2(3)6(4)-(5)0(6)8(7)-(8)0(9)9(10) (11)⏰(12) (13)2(14)0(15)2(16)6(17)
    ///   预期: DateRef=[0,13)，Text=[14,18)（跳过 emoji 后空格 char[13]）
    #[test]
    fn test_date_ref_trailing_space_is_skipped_from_text() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;
        let page = PageService::create(&mut adapter, "", "Test", None, None, None, None, None)?;

        let block = BlockService::create(
            &mut adapter, &page.id, None,
            "@2026-08-09 ⏰ 2026",
            "{}", "bullet", None,
        )?;

        let segments = build_segments_for_block(&mut adapter, &block)?;

        assert_eq!(segments.len(), 2, "should have DateRef + Text segments");

        // 第一部分：DateRef 覆盖 "@2026-08-09 ⏰"（不含 emoji 后空格）
        if let RenderSegment::DateRef { start, end, kind, .. } = &segments[0] {
            assert_eq!(*start, 0, "DateRef should start at char 0");
            assert_eq!(*end, 13, "DateRef should end at char 13 (after ⏰, before space)");
            assert_eq!(kind, "deadline");
        } else {
            panic!("first segment should be DateRef");
        }

        // 第二部分：Text 从 char 14 开始（跳过 emoji 后空格 char[13]），到末尾 char 18
        if let RenderSegment::Text { start, end } = &segments[1] {
            assert_eq!(*start, 14, "Text should start at char 14 (after trailing space)");
            assert_eq!(*end, 18, "Text should end at char 18 (content length)");
        } else {
            panic!("second segment should be Text");
        }

        // 验证切片内容
        let chars: Vec<char> = block.content.chars().collect();
        let date_ref_slice: String = chars[0..13].iter().collect();
        let text_slice: String = chars[14..18].iter().collect();
        assert_eq!(date_ref_slice, "@2026-08-09 ⏰");
        assert_eq!(text_slice, "2026");

        Ok(())
    }

    #[test]
    fn test_date_ref_overdue_future_not_overdue() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;
        let page = PageService::create(&mut adapter, "", "Test", None, None, None, None, None)?;

        // Future date (year 2099) — should NOT be overdue
        let block = BlockService::create(
            &mut adapter, &page.id, None,
            "截止日期 @2099-12-31 ⏰",
            "{}", "bullet", None,
        )?;

        let segments = build_segments_for_block(&mut adapter, &block)?;
        let date_ref = segments.iter().find_map(|s| match s {
            RenderSegment::DateRef { is_overdue, .. } => Some(is_overdue),
            _ => None,
        }).expect("should have DateRef segment");

        assert!(!date_ref, "future deadline should not be overdue");

        Ok(())
    }

    #[test]
    fn test_date_ref_overdue_past_deadline_is_overdue() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;
        let page = PageService::create(&mut adapter, "", "Test", None, None, None, None, None)?;

        // Past date (year 2000) — should be overdue
        let block = BlockService::create(
            &mut adapter, &page.id, None,
            "过期任务 @2000-01-01 ⏰",
            "{}", "bullet", None,
        )?;

        let segments = build_segments_for_block(&mut adapter, &block)?;
        let date_ref = segments.iter().find_map(|s| match s {
            RenderSegment::DateRef { is_overdue, .. } => Some(is_overdue),
            _ => None,
        }).expect("should have DateRef segment");

        assert!(date_ref, "past deadline should be overdue");

        Ok(())
    }

    #[test]
    fn test_date_ref_schedule_never_overdue() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;
        let page = PageService::create(&mut adapter, "", "Test", None, None, None, None, None)?;

        // Schedule with past date — should still NOT be overdue
        let block = BlockService::create(
            &mut adapter, &page.id, None,
            "过去的日程 @2000-01-01 📅",
            "{}", "bullet", None,
        )?;

        let segments = build_segments_for_block(&mut adapter, &block)?;
        let date_ref = segments.iter().find_map(|s| match s {
            RenderSegment::DateRef { is_overdue, kind, .. } => Some((is_overdue, kind.clone())),
            _ => None,
        }).expect("should have DateRef segment");

        assert_eq!(date_ref.1, "schedule");
        assert!(!date_ref.0, "schedule type should never be overdue, even in the past");

        Ok(())
    }

    #[test]
    fn test_link_to_nonexistent_page_skipped() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;
        let page = PageService::create(&mut adapter, "", "Test", None, None, None, None, None)?;

        let block = BlockService::create(
            &mut adapter, &page.id, None,
            "这里有个 [[不存在的页面]] 链接",
            "{}", "bullet", None,
        )?;

        // Create a link to a non-existent page ID
        LinkService::create(
            &mut adapter, &block.id, "nonexistent-page-id", "不存在的页面", None,
        )?;

        let segments = build_segments_for_block(&mut adapter, &block)?;

        // Should only have text segment, no Link segment (target page not found)
        let has_link = segments.iter().any(|s| matches!(s, RenderSegment::Link { .. }));
        assert!(!has_link, "link to non-existent page should be skipped");

        assert_eq!(segments.len(), 1);
        assert!(matches!(segments[0], RenderSegment::Text { .. }));

        Ok(())
    }

    #[test]
    fn test_empty_content_block_produces_empty_segments() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;
        let page = PageService::create(&mut adapter, "", "Test", None, None, None, None, None)?;

        let block = BlockService::create(
            &mut adapter, &page.id, None,
            "",
            "{}", "bullet", None,
        )?;

        let segments = build_segments_for_block(&mut adapter, &block)?;
        assert!(segments.is_empty(), "empty content should produce empty segments");

        Ok(())
    }

    #[test]
    fn test_segments_cover_full_content_range() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;
        let page = PageService::create(&mut adapter, "", "Test", None, None, None, None, None)?;
        let target = PageService::create(&mut adapter, "", "T", None, None, None, None, None)?;

        let content = "A [[T]] B @2026-01-01 C";
        let block = BlockService::create(
            &mut adapter, &page.id, None,
            content,
            "{}", "bullet", None,
        )?;

        LinkService::create(
            &mut adapter, &block.id, &target.id, "T", None,
        )?;

        let segments = build_segments_for_block(&mut adapter, &block)?;

        let char_len = content.chars().count();
        let mut covered_end = 0usize;
        for seg in &segments {
            let (s, e) = match seg {
                RenderSegment::Text { start, end } => (*start, *end),
                RenderSegment::Link { start, end, .. } => (*start, *end),
                RenderSegment::TypedLink { start, end, .. } => (*start, *end),
                RenderSegment::DateRef { start, end, .. } => (*start, *end),
                _ => continue,
            };
            assert_eq!(s, covered_end, "segments should be contiguous: gap at {}", s);
            covered_end = e;
        }
        assert_eq!(covered_end, char_len, "segments must cover all {} chars, got {}", char_len, covered_end);

        Ok(())
    }

    /// Edge: dateRef 后跟多个空格时，所有空格都应被跳过，Text 从首个非空白开始。
    /// "@2026-08-09 ⏰   2026" → DateRef=[0,13)，Text=[16,20)（跳过 3 个空格）
    #[test]
    fn test_date_ref_multiple_trailing_spaces_skipped() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;
        let page = PageService::create(&mut adapter, "", "Test", None, None, None, None, None)?;

        let block = BlockService::create(
            &mut adapter, &page.id, None,
            "@2026-08-09 ⏰   2026",
            "{}", "bullet", None,
        )?;

        let segments = build_segments_for_block(&mut adapter, &block)?;

        assert_eq!(segments.len(), 2, "should have DateRef + Text segments");
        if let RenderSegment::DateRef { start, end, .. } = &segments[0] {
            assert_eq!(*start, 0);
            assert_eq!(*end, 13, "DateRef ends after ⏰ (char 13)");
        } else {
            panic!("first segment should be DateRef");
        }
        if let RenderSegment::Text { start, end } = &segments[1] {
            assert_eq!(*start, 16, "Text starts after all 3 spaces (chars 13-15)");
            assert_eq!(*end, 20, "Text ends at content end");
        } else {
            panic!("second segment should be Text");
        }

        Ok(())
    }

    /// Edge: dateRef 后跟链接时，跳过空格后 Link 段紧随其后，无空洞。
    /// "@2026-08-09 ⏰ [[T]]" → DateRef=[0,13)，Link=[15,20)
    #[test]
    fn test_date_ref_then_link_no_gap() -> Result<(), Box<dyn Error>> {
        let mut adapter = SQLiteAdapter::open_in_memory()?;
        let page = PageService::create(&mut adapter, "", "Test", None, None, None, None, None)?;
        let target = PageService::create(&mut adapter, "", "T", None, None, None, None, None)?;

        let block = BlockService::create(
            &mut adapter, &page.id, None,
            "@2026-08-09 ⏰ [[T]]",
            "{}", "bullet", None,
        )?;

        LinkService::create(
            &mut adapter, &block.id, &target.id, "T", None,
        )?;

        let segments = build_segments_for_block(&mut adapter, &block)?;

        assert_eq!(segments.len(), 2, "should have DateRef + Link segments");
        if let RenderSegment::DateRef { start, end, .. } = &segments[0] {
            assert_eq!(*start, 0);
            assert_eq!(*end, 13);
        } else {
            panic!("first segment should be DateRef");
        }
        if let RenderSegment::Link { start, end, .. } = &segments[1] {
            assert_eq!(*start, 14, "Link starts at [[ (char 14), after skipped space (char 13)");
            assert_eq!(*end, 19, "Link ends at content end (char 19)");
        } else {
            panic!("second segment should be Link");
        }

        Ok(())
    }
}
