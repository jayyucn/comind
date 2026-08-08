use crate::{
    types::{SavedFilter, TaskView},
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

    pub fn get_task_views(storage: &mut dyn StorageAdapter) -> Result<Vec<TaskView>, Box<dyn Error>> {
        repository::TaskViewRepository::get_all(storage.task_views())
    }

    pub fn get_task_view(storage: &mut dyn StorageAdapter, id: &str) -> Result<TaskView, Box<dyn Error>> {
        repository::TaskViewRepository::get_by_id(storage.task_views(), id)
    }

    pub fn save_task_view(storage: &mut dyn StorageAdapter, name: &str, query_json: &str, view_type: &str, group_by: &str, is_default: bool, sort_order: i64) -> Result<TaskView, Box<dyn Error>> {
        let view = TaskView::new(name, query_json, view_type, group_by, is_default, sort_order);
        repository::TaskViewRepository::create(storage.task_views(), &view)
    }

    pub fn update_task_view(storage: &mut dyn StorageAdapter, id: &str, name: &str, query_json: &str, view_type: &str, group_by: &str, is_default: bool, sort_order: i64) -> Result<TaskView, Box<dyn Error>> {
        let mut view = repository::TaskViewRepository::get_by_id(storage.task_views(), id)?;
        view.name = name.to_string();
        view.query_json = query_json.to_string();
        view.view_type = view_type.to_string();
        view.group_by = group_by.to_string();
        view.is_default = if is_default { 1 } else { 0 };
        view.sort_order = sort_order;
        view.updated_at = chrono::Utc::now().timestamp_millis();
        repository::TaskViewRepository::update(storage.task_views(), &view)
    }

    pub fn delete_task_view(storage: &mut dyn StorageAdapter, id: &str) -> Result<(), Box<dyn Error>> {
        repository::TaskViewRepository::delete(storage.task_views(), id)
    }

    pub fn set_default_task_view(storage: &mut dyn StorageAdapter, id: &str) -> Result<TaskView, Box<dyn Error>> {
        let mut view = repository::TaskViewRepository::get_by_id(storage.task_views(), id)?;
        view.is_default = 1;
        view.updated_at = chrono::Utc::now().timestamp_millis();
        repository::TaskViewRepository::update(storage.task_views(), &view)
    }
}
