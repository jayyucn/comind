#[cfg(test)]
mod tests {
    use crate::services::BookService;
    use crate::storage::SQLiteAdapter;
    use crate::types::{BookHighlight, SyncTable};

    fn highlight(id: &str, book_page_id: &str, text: &str) -> BookHighlight {
        BookHighlight {
            id: id.to_string(),
            book_page_id: book_page_id.to_string(),
            cfi: "epubcfi(/6/4!/4/10/2:0)".to_string(),
            text: text.to_string(),
            chapter: "第一章".to_string(),
            color: String::new(),
            block_id: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn highlight_crud_roundtrip() {
        let mut storage = SQLiteAdapter::open_in_memory().unwrap();
        // create：空 id 自动生成，created_at/0 归一为 now，空 color 归一为 yellow
        let saved = BookService::upsert_highlight(&mut storage, &highlight("", "p1", "划线一")).unwrap();
        assert!(!saved.id.is_empty());
        assert!(saved.created_at > 0);
        assert_eq!(saved.color, "yellow");
        assert_eq!(saved.block_id, None);

        // 同 id 再 upsert：更新阅读器态字段，created_at 保留首插值
        let mut updated = saved.clone();
        updated.text = "划线一（改）".to_string();
        updated.color = "green".to_string();
        updated.block_id = Some("blk-1".to_string());
        let saved2 = BookService::upsert_highlight(&mut storage, &updated).unwrap();
        assert_eq!(saved2.created_at, saved.created_at);
        assert!(saved2.updated_at >= saved.created_at);

        let list = BookService::get_highlights(&mut storage, "p1").unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].text, "划线一（改）");
        assert_eq!(list[0].color, "green");
        assert_eq!(list[0].block_id.as_deref(), Some("blk-1"));

        // 其他书的高亮互不串
        let other = BookService::upsert_highlight(&mut storage, &highlight("h2", "p2", "另一本书")).unwrap();
        assert_eq!(BookService::get_highlights(&mut storage, "p1").unwrap().len(), 1);
        assert_eq!(BookService::get_highlights(&mut storage, "p2").unwrap().len(), 1);

        // delete
        BookService::delete_highlight(&mut storage, &saved.id).unwrap();
        assert_eq!(BookService::get_highlights(&mut storage, "p1").unwrap().len(), 0);
        BookService::delete_highlight(&mut storage, &other.id).unwrap();
        assert_eq!(BookService::get_highlights(&mut storage, "p2").unwrap().len(), 0);
    }

    #[test]
    fn progress_upsert_overwrites_single_row() {
        let mut storage = SQLiteAdapter::open_in_memory().unwrap();
        // 无进度 → None
        assert!(BookService::get_progress(&mut storage, "p1").unwrap().is_none());

        // 首次写入
        let p = BookService::upsert_progress(&mut storage, "p1", "epubcfi(/6/4!/4/10/2:0)").unwrap();
        assert_eq!(p.book_page_id, "p1");
        assert_eq!(p.cfi, "epubcfi(/6/4!/4/10/2:0)");

        // 再次写入：覆盖同一行（book_page_id 主键），每书仅一行
        let p2 = BookService::upsert_progress(&mut storage, "p1", "epubcfi(/6/8!/4/2/1:10)").unwrap();
        assert_eq!(p2.cfi, "epubcfi(/6/8!/4/2/1:10)");
        let got = BookService::get_progress(&mut storage, "p1").unwrap().unwrap();
        assert_eq!(got.cfi, "epubcfi(/6/8!/4/2/1:10)");
        assert!(got.updated_at >= p.updated_at);

        // 每书独立
        assert!(BookService::get_progress(&mut storage, "p2").unwrap().is_none());
    }

    /// D5 铁律守护：高亮/进度绝不注册进 SyncTable（仅桌面本地）。
    /// 若有人未来把 BookHighlight/BookProgress 加进 SyncTable，此测试立刻红。
    #[test]
    fn book_tables_never_registered_in_sync_table() {
        let names: Vec<&str> = SyncTable::all().iter().map(|t| t.as_str()).collect();
        assert!(!names.contains(&"BookHighlight"), "BookHighlight must never be a SyncTable");
        assert!(!names.contains(&"BookProgress"), "BookProgress must never be a SyncTable");
    }
}
