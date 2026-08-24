use crate::{
    types::{SearchResult, SearchOptions},
    storage::StorageAdapter,
};
use std::error::Error;

#[cfg(test)]
mod search_test;

pub struct SearchService;

impl SearchService {
    pub fn search(
        storage: &mut dyn StorageAdapter,
        query: &str,
        limit: Option<usize>,
    ) -> Result<Vec<SearchResult>, Box<dyn Error>> {
        let limit = limit.unwrap_or(20);
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }

        let results = storage.search().search(query, limit)?;

        Ok(results)
    }

    pub fn search_with_options(
        storage: &mut dyn StorageAdapter,
        options: &SearchOptions,
    ) -> Result<Vec<SearchResult>, Box<dyn Error>> {
        Self::search(storage, &options.query, options.limit)
    }

    pub fn update_index(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        content: &str,
        title: &str,
    ) -> Result<(), Box<dyn Error>> {
        storage.search().update_index(block_id, content, title)
    }

    pub fn delete_from_index(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
    ) -> Result<(), Box<dyn Error>> {
        storage.search().delete_from_index(block_id)
    }

    pub fn rebuild_index(
        storage: &mut dyn StorageAdapter,
    ) -> Result<(), Box<dyn Error>> {
        let pages = storage.pages().get_all()?;

        for page in pages {
            let blocks = storage.blocks().get_by_page_id(&page.id)?;
            for block in blocks {
                storage.search().update_index(&block.id, &block.content, &page.title)?;
            }
        }

        Ok(())
    }
}