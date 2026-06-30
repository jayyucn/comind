use std::error::Error;
use super::super::types::*;

pub trait BlockRepository {
    fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn Error>>;
    fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn Error>>;
    fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn Error>>;
    fn create(&mut self, block: &Block) -> Result<Block, Box<dyn Error>>;
    fn update(&mut self, block: &Block) -> Result<Block, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_by_page_id(&mut self, page_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait PageRepository {
    fn get_by_id(&self, id: &str) -> Result<Page, Box<dyn Error>>;
    fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>>;
    fn get_all(&self) -> Result<Vec<Page>, Box<dyn Error>>;
    fn create(&mut self, page: &Page) -> Result<Page, Box<dyn Error>>;
    fn update(&mut self, page: &Page) -> Result<Page, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait LinkRepository {
    fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn Error>>;
    fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn Error>>;
    fn get_by_target_page_id(&self, target_page_id: &str) -> Result<Vec<Link>, Box<dyn Error>>;
    fn create(&mut self, link: &Link) -> Result<Link, Box<dyn Error>>;
    fn create_many(&mut self, links: &[Link]) -> Result<Vec<Link>, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_by_source_block_id(&mut self, source_block_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait PropertyRepository {
    fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn Error>>;
    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn Error>>;
    fn get_by_block_id_and_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn Error>>;
    fn create(&mut self, property: &Property) -> Result<Property, Box<dyn Error>>;
    fn update(&mut self, property: &Property) -> Result<Property, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait RelationshipTypeRepository {
    fn get_by_id(&self, id: &str) -> Result<RelationshipType, Box<dyn Error>>;
    fn get_by_type(&self, r#type: &str) -> Result<Option<RelationshipType>, Box<dyn Error>>;
    fn get_all(&self) -> Result<Vec<RelationshipType>, Box<dyn Error>>;
    fn create(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>>;
    fn update(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait TemplateRepository {
    fn get_by_id(&self, id: &str) -> Result<UserTemplate, Box<dyn Error>>;
    fn get_by_name(&self, name: &str) -> Result<Option<UserTemplate>, Box<dyn Error>>;
    fn get_all(&self) -> Result<Vec<UserTemplate>, Box<dyn Error>>;
    fn create(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>>;
    fn update(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait SearchRepository {
    fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, Box<dyn Error>>;
    fn update_index(&mut self, block_id: &str, content: &str, title: &str) -> Result<(), Box<dyn Error>>;
    fn delete_from_index(&mut self, block_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait StorageAdapter {
    fn blocks(&mut self) -> &mut dyn BlockRepository;
    fn pages(&mut self) -> &mut dyn PageRepository;
    fn links(&mut self) -> &mut dyn LinkRepository;
    fn properties(&mut self) -> &mut dyn PropertyRepository;
    fn relationship_types(&mut self) -> &mut dyn RelationshipTypeRepository;
    fn templates(&mut self) -> &mut dyn TemplateRepository;
    fn search(&mut self) -> &mut dyn SearchRepository;
}

pub trait TransactionalStorageAdapter: StorageAdapter {
    fn transaction<R, F>(&mut self, f: F) -> Result<R, Box<dyn Error>>
    where
        F: FnOnce(&mut dyn StorageAdapter) -> Result<R, Box<dyn Error>>;
}