use crate::storage::{repository, StorageAdapter};
use crate::types::{BookHighlight, BookProgress};
use chrono::Utc;
use std::error::Error;
use uuid::Uuid;

/// 书房阅读器的高亮/进度服务（ADR-0040 D5/D6/D7）。
/// 两表仅桌面本地：写入不产生 sync 变更，也绝不注册进 SyncTable。
pub struct BookService;

impl BookService {
    /// 高亮 upsert：id 为空则生成新 id（新建）；已存在则更新阅读器态字段，
    /// created_at 由 SQL ON CONFLICT 保留首插值（D7）。
    /// 时间戳归一：created_at<=0 → now，updated_at 恒为 now。
    pub fn upsert_highlight(
        storage: &mut dyn StorageAdapter,
        highlight: &BookHighlight,
    ) -> Result<BookHighlight, Box<dyn Error>> {
        let now = Utc::now().timestamp_millis();
        let mut h = highlight.clone();
        if h.id.is_empty() {
            h.id = Uuid::new_v4().to_string();
        }
        if h.created_at <= 0 {
            h.created_at = now;
        }
        if h.color.is_empty() {
            h.color = "yellow".to_string();
        }
        h.updated_at = now;
        repository::BookHighlightRepository::upsert(storage.book_highlights(), &h)
    }

    pub fn get_highlights(
        storage: &mut dyn StorageAdapter,
        book_page_id: &str,
    ) -> Result<Vec<BookHighlight>, Box<dyn Error>> {
        repository::BookHighlightRepository::get_by_book_page_id(storage.book_highlights(), book_page_id)
    }

    pub fn delete_highlight(storage: &mut dyn StorageAdapter, id: &str) -> Result<(), Box<dyn Error>> {
        repository::BookHighlightRepository::delete(storage.book_highlights(), id)
    }

    /// 进度 upsert：每书一行（book_page_id 主键），CFI 为上次位置的文字级锚点（D6）。
    pub fn upsert_progress(
        storage: &mut dyn StorageAdapter,
        book_page_id: &str,
        cfi: &str,
    ) -> Result<BookProgress, Box<dyn Error>> {
        let progress = BookProgress {
            book_page_id: book_page_id.to_string(),
            cfi: cfi.to_string(),
            updated_at: Utc::now().timestamp_millis(),
        };
        repository::BookProgressRepository::upsert(storage.book_progress(), &progress)
    }

    pub fn get_progress(
        storage: &mut dyn StorageAdapter,
        book_page_id: &str,
    ) -> Result<Option<BookProgress>, Box<dyn Error>> {
        repository::BookProgressRepository::get(storage.book_progress(), book_page_id)
    }
}
