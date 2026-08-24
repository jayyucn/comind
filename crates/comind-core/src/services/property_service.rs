use crate::{
    types::Property,
    storage::{repository, StorageAdapter},
};
use rand::Rng;
use std::error::Error;

pub struct PropertyService;

impl PropertyService {
    pub fn get_by_id(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<Property, Box<dyn Error>> {
        repository::PropertyRepository::get_by_id(storage.properties(), id)
    }

    pub fn get_by_block_id(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
    ) -> Result<Vec<Property>, Box<dyn Error>> {
        repository::PropertyRepository::get_by_block_id(storage.properties(), block_id)
    }

    pub fn get_by_block_id_and_key(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        key: &str,
    ) -> Result<Option<Property>, Box<dyn Error>> {
        repository::PropertyRepository::get_by_block_id_and_key(storage.properties(), block_id, key)
    }

    pub fn create(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        key: &str,
        value: &str,
        r#type: &str,
        sort_order: i64,
        is_hidden: i64,
        schema_version: i64,
    ) -> Result<Property, Box<dyn Error>> {
        let now = chrono::Utc::now().timestamp_millis();

        let property = Property {
            id: Self::generate_id(),
            block_id: block_id.to_string(),
            key: key.to_string(),
            value: value.to_string(),
            r#type: r#type.to_string(),
            sort_order,
            is_hidden,
            is_deleted: 0,
            schema_version,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
        };

        repository::PropertyRepository::create(storage.properties(), &property)
    }

    pub fn upsert(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
        key: &str,
        value: &str,
        r#type: &str,
        sort_order: i64,
        is_hidden: i64,
        schema_version: i64,
    ) -> Result<Property, Box<dyn Error>> {
        let now = chrono::Utc::now().timestamp_millis();

        let property = Property {
            id: Self::generate_id(),
            block_id: block_id.to_string(),
            key: key.to_string(),
            value: value.to_string(),
            r#type: r#type.to_string(),
            sort_order,
            is_hidden,
            is_deleted: 0,
            schema_version,
            created_at: now,
            updated_at: now,
            version: 0,
            deleted_at: None,
        };

        repository::PropertyRepository::upsert(storage.properties(), &property)
    }

    pub fn update(
        storage: &mut dyn StorageAdapter,
        id: &str,
        value: Option<&str>,
        r#type: Option<&str>,
        sort_order: Option<i64>,
        is_hidden: Option<i64>,
    ) -> Result<Property, Box<dyn Error>> {
        let mut property = repository::PropertyRepository::get_by_id(storage.properties(), id)?;

        if let Some(v) = value {
            property.value = v.to_string();
        }
        if let Some(t) = r#type {
            property.r#type = t.to_string();
        }
        if let Some(so) = sort_order {
            property.sort_order = so;
        }
        if let Some(ih) = is_hidden {
            property.is_hidden = ih;
        }
        property.updated_at = chrono::Utc::now().timestamp_millis();

        repository::PropertyRepository::update(storage.properties(), &property)
    }

    pub fn delete(
        storage: &mut dyn StorageAdapter,
        id: &str,
    ) -> Result<(), Box<dyn Error>> {
        repository::PropertyRepository::delete(storage.properties(), id)
    }

    pub fn delete_by_block_id(
        storage: &mut dyn StorageAdapter,
        block_id: &str,
    ) -> Result<(), Box<dyn Error>> {
        repository::PropertyRepository::delete_by_block_id(storage.properties(), block_id)
    }

    /// 按 key + values 反查匹配的 block_id 列表（如 status=Todo/Doing 的 block）
    pub fn query_block_ids_by_key_value(
        storage: &mut dyn StorageAdapter,
        key: &str,
        values: &[String],
    ) -> Result<Vec<String>, Box<dyn Error>> {
        repository::PropertyRepository::query_block_ids_by_key_value(storage.properties(), key, values)
    }

    fn generate_id() -> String {
        let mut rng = rand::thread_rng();
        let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
        hex::encode(bytes)
    }
}