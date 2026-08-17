use crate::{
    types::{SavedFilter, ScreenView},
    storage::repository,
    storage::StorageAdapter,
};
use std::error::Error;

pub struct FilterService;

impl FilterService {
    pub fn get_saved_filters(storage: &mut dyn StorageAdapter) -> Result<Vec<SavedFilter>, Box<dyn Error>> {
        repository::SavedFilterRepository::get_all(storage.saved_filters())
    }

    pub fn get_saved_filter(storage: &mut dyn StorageAdapter, id: &str) -> Result<SavedFilter, Box<dyn Error>> {
        repository::SavedFilterRepository::get_by_id(storage.saved_filters(), id)
    }

    pub fn save_saved_filter(storage: &mut dyn StorageAdapter, name: &str, query_json: &str) -> Result<SavedFilter, Box<dyn Error>> {
        let filter = SavedFilter::new(name, query_json);
        repository::SavedFilterRepository::create(storage.saved_filters(), &filter)
    }

    pub fn update_saved_filter(storage: &mut dyn StorageAdapter, id: &str, name: &str, query_json: &str) -> Result<SavedFilter, Box<dyn Error>> {
        let mut filter = repository::SavedFilterRepository::get_by_id(storage.saved_filters(), id)?;
        filter.name = name.to_string();
        filter.query_json = query_json.to_string();
        filter.updated_at = chrono::Utc::now().timestamp_millis();
        repository::SavedFilterRepository::update(storage.saved_filters(), &filter)
    }

    pub fn delete_saved_filter(storage: &mut dyn StorageAdapter, id: &str) -> Result<(), Box<dyn Error>> {
        repository::SavedFilterRepository::delete(storage.saved_filters(), id)
    }

    pub fn get_screen_views(storage: &mut dyn StorageAdapter) -> Result<Vec<ScreenView>, Box<dyn Error>> {
        repository::ScreenViewRepository::get_all(storage.screen_views())
    }

    pub fn get_screen_view(storage: &mut dyn StorageAdapter, id: &str) -> Result<ScreenView, Box<dyn Error>> {
        repository::ScreenViewRepository::get_by_id(storage.screen_views(), id)
    }

    pub fn save_screen_view(storage: &mut dyn StorageAdapter, name: &str, query_json: &str, view_type: &str, group_by: &str, is_default: bool, sort_order: i64, config: &str) -> Result<ScreenView, Box<dyn Error>> {
        let view = ScreenView::new(name, query_json, view_type, group_by, is_default, sort_order, config);
        repository::ScreenViewRepository::create(storage.screen_views(), &view)
    }

    pub fn update_screen_view(storage: &mut dyn StorageAdapter, id: &str, name: &str, query_json: &str, view_type: &str, group_by: &str, is_default: bool, sort_order: i64, config: &str) -> Result<ScreenView, Box<dyn Error>> {
        let mut view = repository::ScreenViewRepository::get_by_id(storage.screen_views(), id)?;
        view.name = name.to_string();
        view.query_json = query_json.to_string();
        view.view_type = view_type.to_string();
        view.group_by = group_by.to_string();
        view.is_default = if is_default { 1 } else { 0 };
        view.sort_order = sort_order;
        view.config = config.to_string();
        view.updated_at = chrono::Utc::now().timestamp_millis();
        repository::ScreenViewRepository::update(storage.screen_views(), &view)
    }

    pub fn delete_screen_view(storage: &mut dyn StorageAdapter, id: &str) -> Result<(), Box<dyn Error>> {
        repository::ScreenViewRepository::delete(storage.screen_views(), id)
    }

    pub fn set_default_screen_view(storage: &mut dyn StorageAdapter, id: &str) -> Result<ScreenView, Box<dyn Error>> {
        let mut view = repository::ScreenViewRepository::get_by_id(storage.screen_views(), id)?;
        view.is_default = 1;
        view.updated_at = chrono::Utc::now().timestamp_millis();
        repository::ScreenViewRepository::update(storage.screen_views(), &view)
    }
}
