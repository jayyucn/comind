use crate::{
    types::UserTemplate,
    storage::{repository, StorageAdapter},
};
use rand::Rng;
use std::error::Error;

pub struct TemplateService;

impl TemplateService {
    pub fn get_by_id(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<UserTemplate, Box<dyn Error>> {
        repository::TemplateRepository::get_by_id(storage.templates(), id)
    }

    pub fn get_all(
        storage: &mut dyn StorageAdapter,
    ) -> Result<Vec<UserTemplate>, Box<dyn Error>> {
        repository::TemplateRepository::get_all(storage.templates())
    }

    pub fn get_by_category(
        storage: &mut dyn StorageAdapter,
        category: &str,
    ) -> Result<Vec<UserTemplate>, Box<dyn Error>> {
        let all = repository::TemplateRepository::get_all(storage.templates())?;
        let filtered: Vec<UserTemplate> = all
            .into_iter()
            .filter(|t| t.category == category)
            .collect();
        Ok(filtered)
    }

    pub fn create(
        storage: &mut dyn StorageAdapter,
        name: &str,
        category: &str,
        content: &str,
    ) -> Result<UserTemplate, Box<dyn Error>> {
        let now = chrono::Utc::now().timestamp_millis();

        let template = UserTemplate {
            id: Self::generate_id(),
            name: name.to_string(),
            category: category.to_string(),
            content: content.to_string(),
            created_at: now,
            updated_at: now,
        };

        repository::TemplateRepository::create(storage.templates(), &template)
    }

    pub fn update(
        storage: &mut dyn StorageAdapter,
        id: &str,
        name: Option<&str>,
        category: Option<&str>,
        content: Option<&str>,
    ) -> Result<UserTemplate, Box<dyn Error>> {
        let mut template = repository::TemplateRepository::get_by_id(storage.templates(), id)?;

        if let Some(n) = name {
            template.name = n.to_string();
        }
        if let Some(c) = category {
            template.category = c.to_string();
        }
        if let Some(ct) = content {
            template.content = ct.to_string();
        }
        template.updated_at = chrono::Utc::now().timestamp_millis();

        repository::TemplateRepository::update(storage.templates(), &template)
    }

    pub fn delete(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<(), Box<dyn Error>> {
        repository::TemplateRepository::delete(storage.templates(), id)
    }

    pub fn generate_id() -> String {
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
        hex::encode(bytes)
    }
}