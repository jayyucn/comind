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

    pub fn get_screen_views(storage: &mut dyn StorageAdapter, entity: &str) -> Result<Vec<ScreenView>, Box<dyn Error>> {
        repository::ScreenViewRepository::get_all_by_entity(storage.screen_views(), entity)
    }

    pub fn get_screen_view(storage: &mut dyn StorageAdapter, id: &str) -> Result<ScreenView, Box<dyn Error>> {
        repository::ScreenViewRepository::get_by_id(storage.screen_views(), id)
    }

    /// 新建 Screen（命名容器）：parent_id 为空串；Screen 本身不持有查询，固定附带一个默认 Tab 由调用方创建。
    pub fn create_screen(storage: &mut dyn StorageAdapter, entity: &str, name: &str, view_type: &str, sort_order: i64, config: &str) -> Result<ScreenView, Box<dyn Error>> {
        // 实体首个 Screen 自动成为默认（保证「每实体恰好一个默认 Screen」不变量；后续可经 set_default_screen 变更）。
        let existing = repository::ScreenViewRepository::get_all_by_entity(storage.screen_views(), entity)?;
        let has_screen = existing.iter().any(|v| v.parent_id.is_empty());
        let view = ScreenView::new(entity, "", name, "{}", view_type, "", !has_screen, sort_order, config);
        repository::ScreenViewRepository::create(storage.screen_views(), &view)
    }

    /// 新建 Tab（Screen 内的类型化视图）：parent_id = 所属 Screen 的 id。
    pub fn create_tab(storage: &mut dyn StorageAdapter, entity: &str, parent_id: &str, name: &str, view_type: &str, query_json: &str, sort_order: i64, config: &str) -> Result<ScreenView, Box<dyn Error>> {
        let view = ScreenView::new(entity, parent_id, name, query_json, view_type, "", false, sort_order, config);
        repository::ScreenViewRepository::create(storage.screen_views(), &view)
    }

    /// 更新 Screen 元数据（名称/类型/配置），不改其查询与归属。
    pub fn update_screen(storage: &mut dyn StorageAdapter, id: &str, name: &str, view_type: &str, config: &str) -> Result<ScreenView, Box<dyn Error>> {
        let mut view = repository::ScreenViewRepository::get_by_id(storage.screen_views(), id)?;
        view.name = name.to_string();
        view.view_type = view_type.to_string();
        view.config = config.to_string();
        view.updated_at = chrono::Utc::now().timestamp_millis();
        repository::ScreenViewRepository::update(storage.screen_views(), &view)
    }

    /// 更新 Tab（名称/类型/查询/配置）。
    pub fn update_tab(storage: &mut dyn StorageAdapter, id: &str, name: &str, view_type: &str, query_json: &str, config: &str) -> Result<ScreenView, Box<dyn Error>> {
        let mut view = repository::ScreenViewRepository::get_by_id(storage.screen_views(), id)?;
        view.name = name.to_string();
        view.view_type = view_type.to_string();
        view.query_json = query_json.to_string();
        view.config = config.to_string();
        view.updated_at = chrono::Utc::now().timestamp_millis();
        repository::ScreenViewRepository::update(storage.screen_views(), &view)
    }

    /// 删除 Screen 及其下全部 Tab（级联）。
    pub fn delete_screen(storage: &mut dyn StorageAdapter, id: &str) -> Result<(), Box<dyn Error>> {
        let entity = repository::ScreenViewRepository::get_by_id(storage.screen_views(), id)?.entity;
        let tabs: Vec<ScreenView> = repository::ScreenViewRepository::get_all_by_entity(storage.screen_views(), &entity)?
            .into_iter()
            .filter(|v| v.parent_id == id)
            .collect();
        for t in &tabs {
            repository::ScreenViewRepository::delete(storage.screen_views(), &t.id)?;
        }
        repository::ScreenViewRepository::delete(storage.screen_views(), id)
    }

    /// 通用按 id 删除（删单个 Tab 或 Screen 均可）。
    pub fn delete_screen_view(storage: &mut dyn StorageAdapter, id: &str) -> Result<(), Box<dyn Error>> {
        repository::ScreenViewRepository::delete(storage.screen_views(), id)
    }

    /// 设置某 Screen 为默认：自身 is_default=1，同实体其余 Screen 置 0。
    pub fn set_default_screen(storage: &mut dyn StorageAdapter, id: &str) -> Result<ScreenView, Box<dyn Error>> {
        let entity = repository::ScreenViewRepository::get_by_id(storage.screen_views(), id)?.entity;
        let siblings = repository::ScreenViewRepository::get_all_by_entity(storage.screen_views(), &entity)?;
        for s in siblings {
            if s.parent_id.is_empty() && s.id != id && s.is_default != 0 {
                let mut s = s;
                s.is_default = 0;
                s.updated_at = chrono::Utc::now().timestamp_millis();
                repository::ScreenViewRepository::update(storage.screen_views(), &s)?;
            }
        }
        let mut view = repository::ScreenViewRepository::get_by_id(storage.screen_views(), id)?;
        view.is_default = 1;
        view.updated_at = chrono::Utc::now().timestamp_millis();
        repository::ScreenViewRepository::update(storage.screen_views(), &view)
    }
}
