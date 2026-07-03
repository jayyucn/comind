use crate::{
    types::Link,
    storage::{repository, StorageAdapter},
};
use rand::Rng;
use std::error::Error;

pub struct LinkService;

impl LinkService {
    pub fn get_by_id(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<Link, Box<dyn Error>> {
        repository::LinkRepository::get_by_id(storage.links(), id)
    }

    pub fn get_by_source_block_id(
        storage: &mut dyn StorageAdapter,
        source_block_id: &str,
    ) -> Result<Vec<Link>, Box<dyn Error>> {
        repository::LinkRepository::get_by_source_block_id(storage.links(), source_block_id)
    }

    pub fn get_by_target_page_id(
        storage: &mut dyn StorageAdapter,
        target_page_id: &str,
    ) -> Result<Vec<Link>, Box<dyn Error>> {
        repository::LinkRepository::get_by_target_page_id(storage.links(), target_page_id)
    }

    pub fn create(
        storage: &mut dyn StorageAdapter,
        source_block_id: &str,
        target_page_id: &str,
        display_text: &str,
        relationship_type: Option<&str>,
    ) -> Result<Link, Box<dyn Error>> {
        let now = chrono::Utc::now().timestamp_millis();

        let link = Link {
            id: Self::generate_id(),
            source_block_id: source_block_id.to_string(),
            target_page_id: target_page_id.to_string(),
            display_text: display_text.to_string(),
            relationship_type: relationship_type.map(|s| s.to_string()),
            created_at: now,
        };

        repository::LinkRepository::create(storage.links(), &link)
    }

    pub fn create_many(
        storage: &mut dyn StorageAdapter,
        links: &[Link],
    ) -> Result<Vec<Link>, Box<dyn Error>> {
        repository::LinkRepository::create_many(storage.links(), links)
    }

    pub fn delete(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<(), Box<dyn Error>> {
        repository::LinkRepository::delete(storage.links(), id)
    }

    pub fn delete_by_source_block_id(
        storage: &mut dyn StorageAdapter,
        source_block_id: &str,
    ) -> Result<(), Box<dyn Error>> {
        repository::LinkRepository::delete_by_source_block_id(storage.links(), source_block_id)
    }

    pub fn delete_by_target_page_id(
        storage: &mut dyn StorageAdapter,
        target_page_id: &str,
    ) -> Result<(), Box<dyn Error>> {
        repository::LinkRepository::delete_by_target_page_id(storage.links(), target_page_id)
    }

    pub fn sync_links_for_block<S>(
        storage: &mut S,
        block_id: &str,
        new_links: &[Link],
    ) -> Result<Vec<Link>, Box<dyn Error>>
    where
        S: repository::TransactionalStorageAdapter,
    {
        storage.transaction(|tx| {
            repository::LinkRepository::delete_by_source_block_id(tx.links(), block_id)?;

            let created_links = repository::LinkRepository::create_many(tx.links(), new_links)?;

            Ok(created_links)
        })
    }

    fn generate_id() -> String {
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
        hex::encode(bytes)
    }
}