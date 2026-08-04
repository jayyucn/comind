use crate::{
    types::Page,
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
        if Self::exists_by_title(storage, title)? {
            return Err(format!("Page with title '{}' already exists", title).into());
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

    fn generate_id() -> String {
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
        hex::encode(bytes)
    }
}