use std::error::Error;
use super::super::types::*;

pub trait BlockRepository {
    fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn Error>>;
    fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn Error>>;
    fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn Error>>;
    fn create(&self, block: &Block) -> Result<Block, Box<dyn Error>>;
    fn update(&self, block: &Block) -> Result<Block, Box<dyn Error>>;
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_by_page_id(&self, page_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait PageRepository {
    fn get_by_id(&self, id: &str) -> Result<Page, Box<dyn Error>>;
    fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>>;
    fn get_all(&self) -> Result<Vec<Page>, Box<dyn Error>>;
    fn create(&self, page: &Page) -> Result<Page, Box<dyn Error>>;
    fn update(&self, page: &Page) -> Result<Page, Box<dyn Error>>;
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait LinkRepository {
    fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn Error>>;
    fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn Error>>;
    fn get_by_target_page_id(&self, target_page_id: &str) -> Result<Vec<Link>, Box<dyn Error>>;
    fn create(&self, link: &Link) -> Result<Link, Box<dyn Error>>;
    fn create_many(&self, links: &[Link]) -> Result<Vec<Link>, Box<dyn Error>>;
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_by_source_block_id(&self, source_block_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait PropertyRepository {
    fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn Error>>;
    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn Error>>;
    fn get_by_block_id_and_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn Error>>;
    fn create(&self, property: &Property) -> Result<Property, Box<dyn Error>>;
    fn update(&self, property: &Property) -> Result<Property, Box<dyn Error>>;
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_by_block_id(&self, block_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait RelationshipTypeRepository {
    fn get_by_id(&self, id: &str) -> Result<RelationshipType, Box<dyn Error>>;
    fn get_by_type(&self, r#type: &str) -> Result<Option<RelationshipType>, Box<dyn Error>>;
    fn get_all(&self) -> Result<Vec<RelationshipType>, Box<dyn Error>>;
    fn create(&self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>>;
    fn update(&self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>>;
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait TemplateRepository {
    fn get_by_id(&self, id: &str) -> Result<UserTemplate, Box<dyn Error>>;
    fn get_by_name(&self, name: &str) -> Result<Option<UserTemplate>, Box<dyn Error>>;
    fn get_all(&self) -> Result<Vec<UserTemplate>, Box<dyn Error>>;
    fn create(&self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>>;
    fn update(&self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>>;
    fn delete(&self, id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait SearchRepository {
    fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, Box<dyn Error>>;
    fn update_index(&self, block_id: &str, content: &str, title: &str) -> Result<(), Box<dyn Error>>;
    fn delete_from_index(&self, block_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait StorageAdapter {
    fn blocks(&self) -> &dyn BlockRepository;
    fn pages(&self) -> &dyn PageRepository;
    fn links(&self) -> &dyn LinkRepository;
    fn properties(&self) -> &dyn PropertyRepository;
    fn relationship_types(&self) -> &dyn RelationshipTypeRepository;
    fn templates(&self) -> &dyn TemplateRepository;
    fn search(&self) -> &dyn SearchRepository;
    
    fn transaction<R, F>(&self, f: F) -> Result<R, Box<dyn Error>>
    where
        F: FnOnce(&dyn StorageAdapter) -> Result<R, Box<dyn Error>>;
}