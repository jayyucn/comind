use crate::{
    types::Page,
    services::BlockService,
    storage::{repository, StorageAdapter},
};
use rand::Rng;
use std::error::Error;

pub struct PageService;

impl PageService {
    pub fn get_by_id(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<Page, Box<dyn Error>> {
        repository::PageRepository::get_by_id(storage.pages(), id)
    }

    pub fn get_by_title(
        storage: &mut dyn StorageAdapter,
        title: &str,
    ) -> Result<Option<Page>, Box<dyn Error>> {
        repository::PageRepository::get_by_title(storage.pages(), title)
    }

    pub fn get_all(
        storage: &mut dyn StorageAdapter,
    ) -> Result<Vec<Page>, Box<dyn Error>> {
        repository::PageRepository::get_all(storage.pages())
    }

    pub fn get_trash(
        storage: &mut dyn StorageAdapter,
    ) -> Result<Vec<Page>, Box<dyn Error>> {
        repository::PageRepository::get_trash(storage.pages())
    }

    pub fn get_ideas_by_month(
        storage: &mut dyn StorageAdapter,
        year: i32,
        month: u32,
    ) -> Result<Vec<Page>, Box<dyn Error>> {
        repository::PageRepository::get_ideas_by_month(storage.pages(), year, month)
    }

    pub fn get_ideas_months(
        storage: &mut dyn StorageAdapter,
    ) -> Result<Vec<String>, Box<dyn Error>> {
        repository::PageRepository::get_ideas_months(storage.pages())
    }

    /// 幂等地获取或创建今日 Ideas 页面
    ///
    /// - title 为本地时区的 `yyyy-MM-dd`
    /// - type 为 `ideas`
    /// - 若已存在同名页面则直接返回（幂等），否则创建新页面
    ///
    /// 这是前端 `IdeasTodayPanel` 显示问题的单一事实来源：
    /// 创建逻辑集中在 Rust 端，避免 TS 端缓存 stale 导致的状态不一致。
    pub fn ensure_today_ideas_page(
        storage: &mut dyn StorageAdapter,
    ) -> Result<Page, Box<dyn Error>> {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        // 幂等检查：若今日页面已存在则直接返回
        if let Some(existing) =
            repository::PageRepository::get_by_title(storage.pages(), &today)?
        {
            return Ok(existing);
        }

        // 不存在则创建：直接构造 Page 并调用仓库层 create，跳过 create 内部的重复 exists_by_title 检查
        let now = chrono::Utc::now().timestamp_millis();
        let page = Page {
            id: Self::generate_id(),
            block_id: None,
            title: today,
            r#type: "ideas".to_string(),
            icon: None,
            cover: None,
            aliases: "[]".to_string(),
            file_path: None,
            children_count: 0,
            word_count: 0,
            deleted: 0,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
        };

        repository::PageRepository::create(storage.pages(), &page)
    }

    pub fn create(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        title: &str,
        r#type: Option<&str>,
        icon: Option<&str>,
        cover: Option<&str>,
        aliases: Option<&str>,
        file_path: Option<&str>,
    ) -> Result<Page, Box<dyn Error>> {
        // 幂等：标题若已存在（含软删除页），复用 / 复活，避免触发全局 UNIQUE(title) 约束
        if let Some(existing) =
            repository::PageRepository::get_by_title_including_deleted(storage.pages(), title)?
        {
            if existing.deleted == 1 {
                let mut reactivated = existing.clone();
                reactivated.deleted = 0;
                reactivated.deleted_at = None;
                reactivated.updated_at = chrono::Utc::now().timestamp_millis();
                return repository::PageRepository::update(storage.pages(), &reactivated);
            }
            return Ok(existing);
        }

        let now = chrono::Utc::now().timestamp_millis();

        let page = Page {
            id: Self::generate_id(),
            block_id: if block_id.is_empty() { None } else { Some(block_id.to_string()) },
            title: title.to_string(),
            r#type: r#type.unwrap_or("normal").to_string(),
            icon: icon.map(|s| s.to_string()),
            cover: cover.map(|s| s.to_string()),
            aliases: aliases.unwrap_or("[]").to_string(),
            file_path: file_path.map(|s| s.to_string()),
            children_count: 0,
            word_count: 0,
            deleted: 0,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
        };

        repository::PageRepository::create(storage.pages(), &page)
    }

    pub fn update(
        storage: &mut dyn StorageAdapter,
        id: &str,
        title: Option<&str>,
        r#type: Option<&str>,
        icon: Option<&str>,
        cover: Option<&str>,
        aliases: Option<&str>,
        file_path: Option<&str>,
        children_count: Option<i64>,
        word_count: Option<i64>,
    ) -> Result<Page, Box<dyn Error>> {
        let mut page = repository::PageRepository::get_by_id(storage.pages(), id)?;

        if let Some(t) = title {
            if t != page.title && Self::exists_by_title(storage, t)? {
                return Err(format!("Page with title '{}' already exists", t).into());
            }
            page.title = t.to_string();
        }
        if let Some(typ) = r#type {
            page.r#type = typ.to_string();
        }
        if let Some(i) = icon {
            page.icon = Some(i.to_string());
        }
        if let Some(c) = cover {
            page.cover = Some(c.to_string());
        }
        if let Some(a) = aliases {
            page.aliases = a.to_string();
        }
        if let Some(fp) = file_path {
            page.file_path = Some(fp.to_string());
        }
        if let Some(cc) = children_count {
            page.children_count = cc;
        }
        if let Some(wc) = word_count {
            page.word_count = wc;
        }
        page.updated_at = chrono::Utc::now().timestamp_millis();

        repository::PageRepository::update(storage.pages(), &page)
    }

    pub fn delete(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<(), Box<dyn Error>> {
        repository::PageRepository::delete(storage.pages(), id)
    }

    pub fn exists_by_title(
        storage: &mut dyn StorageAdapter,
        title: &str,
    ) -> Result<bool, Box<dyn Error>> {
        let page = repository::PageRepository::get_by_title(storage.pages(), title)?;
        Ok(page.is_some())
    }

    /// 统计文本「字数」（用户口径：汉字按字 + 英文按词）：
    /// - CJK 表意字符每个计 1；
    /// - 连续英文/数字段（`is_alphanumeric`）每个计 1；
    /// - 空白与标点不计（标点会断开英文词）。
    pub fn count_words(content: &str) -> i64 {
        fn is_cjk(c: char) -> bool {
            matches!(c,
                '\u{4E00}'..='\u{9FFF}'    // CJK 统一表意文字（基本区）
                | '\u{3400}'..='\u{4DBF}'  // 扩展 A
                | '\u{20000}'..='\u{2A6DF}' // 扩展 B
                | '\u{F900}'..='\u{FAFF}'  // 兼容表意
            )
        }
        let mut count = 0i64;
        let mut in_word = false;
        for ch in content.chars() {
            if is_cjk(ch) {
                count += 1;
                in_word = false;
            } else if ch.is_whitespace() {
                in_word = false;
            } else if ch.is_alphanumeric() {
                if !in_word {
                    count += 1;
                    in_word = true;
                }
            } else {
                in_word = false; // 标点/符号：不计数，但断开英文词
            }
        }
        count
    }

    /// 重算某页 `word_count` = 该页所有未删除 block 的 content 字数之和，并回写。
    /// best-effort：保存/删除 block 后由写路径调用，失败不影响主流程（沿用 page touch 的 `let _ =` 模式）。
    pub fn recount_word_count(
        storage: &mut dyn StorageAdapter,
        page_id: &str,
    ) -> Result<(), Box<dyn Error>> {
        let blocks = BlockService::get_by_page_id(storage, page_id)?;
        let wc: i64 = blocks.iter().map(|b| Self::count_words(&b.content)).sum();
        Self::update(storage, page_id, None, None, None, None, None, None, None, Some(wc))?;
        Ok(())
    }

    fn generate_id() -> String {
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
        hex::encode(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn count_words_counts_cjk_chars_and_latin_words() {
        // 纯中文：按字计
        assert_eq!(PageService::count_words("你好世界"), 4);
        // 纯英文：按空白分词
        assert_eq!(PageService::count_words("hello world"), 2);
        // 混合：汉字按字 + 英文按词
        assert_eq!(PageService::count_words("你好 hello world"), 4);
        assert_eq!(PageService::count_words("hello 世界"), 3);
        // 标点不计，且断开英文词
        assert_eq!(PageService::count_words("你好，世界！"), 4);
        assert_eq!(PageService::count_words("hello, world"), 2);
        // 数字段按 1 词
        assert_eq!(PageService::count_words("abc 123"), 2);
        // 空白与空串
        assert_eq!(PageService::count_words("   "), 0);
        assert_eq!(PageService::count_words(""), 0);
        // 连写中英混排：hello(1) + 你好(2) + world(1) = 4
        assert_eq!(PageService::count_words("hello你好world"), 4);
    }
}