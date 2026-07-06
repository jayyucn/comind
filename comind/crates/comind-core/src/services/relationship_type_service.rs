use crate::{
    types::RelationshipType,
    storage::{repository, StorageAdapter},
};
use rand::Rng;
use std::error::Error;

pub struct RelationshipTypeService;

impl RelationshipTypeService {
    pub fn get_by_id(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<RelationshipType, Box<dyn Error>> {
        repository::RelationshipTypeRepository::get_by_id(storage.relationship_types(), id)
    }

    pub fn get_all(
        storage: &mut dyn StorageAdapter,
    ) -> Result<Vec<RelationshipType>, Box<dyn Error>> {
        repository::RelationshipTypeRepository::get_all(storage.relationship_types())
    }

    pub fn get_by_type(
        storage: &mut dyn StorageAdapter,
        r#type: &str,
    ) -> Result<Option<RelationshipType>, Box<dyn Error>> {
        repository::RelationshipTypeRepository::get_by_type(storage.relationship_types(), r#type)
    }

    pub fn create(
        storage: &mut dyn StorageAdapter,
        id: Option<&str>,
        r#type: &str,
        inverse: Option<&str>,
        label: &str,
        inverse_label: &str,
        color: &str,
        order: i64,
        strength: &str,
        builtin: i64,
    ) -> Result<RelationshipType, Box<dyn Error>> {
        let now = chrono::Utc::now().timestamp_millis();

        let rt = RelationshipType {
            id: id.map(|s| s.to_string()).unwrap_or_else(|| Self::generate_id()),
            r#type: r#type.to_string(),
            inverse: inverse.map(|s| s.to_string()),
            label: label.to_string(),
            inverse_label: inverse_label.to_string(),
            color: color.to_string(),
            order,
            strength: strength.to_string(),
            deleted: 0,
            builtin,
            created_at: now,
            updated_at: now,
        };

        repository::RelationshipTypeRepository::create(storage.relationship_types(), &rt)
    }

    pub fn update(
        storage: &mut dyn StorageAdapter,
        id: &str,
        label: Option<&str>,
        inverse_label: Option<&str>,
        color: Option<&str>,
        order: Option<i64>,
        strength: Option<&str>,
    ) -> Result<RelationshipType, Box<dyn Error>> {
        let mut rt = repository::RelationshipTypeRepository::get_by_id(storage.relationship_types(), id)?;

        if let Some(l) = label {
            rt.label = l.to_string();
        }
        if let Some(il) = inverse_label {
            rt.inverse_label = il.to_string();
        }
        if let Some(c) = color {
            rt.color = c.to_string();
        }
        if let Some(o) = order {
            rt.order = o;
        }
        if let Some(s) = strength {
            rt.strength = s.to_string();
        }
        rt.updated_at = chrono::Utc::now().timestamp_millis();

        repository::RelationshipTypeRepository::update(storage.relationship_types(), &rt)
    }

    pub fn delete(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<(), Box<dyn Error>> {
        repository::RelationshipTypeRepository::delete(storage.relationship_types(), id)
    }

    fn generate_id() -> String {
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
        hex::encode(bytes)
    }
}