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