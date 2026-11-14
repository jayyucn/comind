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

    /// 批量原子重排某 `(entity, parent_id)` 下的 Tabs 顺序（ADR-0044，拖拽持久化）。
    /// `ordered_ids` 为拖拽后的完整有序 id 数组；事务内按数组下标重写 `sort_order` 并校验归属。
    /// `parent_id` 传 `''` 即表示对 Screens 重排（预留复用）。
    pub fn reorder_screen_views(
        storage: &mut dyn StorageAdapter,
        entity: &str,
        parent_id: &str,
        ordered_ids: &[String],
    ) -> Result<(), Box<dyn Error>> {
        repository::ScreenViewRepository::reorder(storage.screen_views(), entity, parent_id, ordered_ids)
    }

    /// 把某查询块命名空间（`live_prefix + block_id`）下的全部视图行改挂到孤儿前缀。
    ///
    /// 由块删除的写路径调用：块是软删且可撤销的，所以这里**只标记不删**——撤销把块复活后，
    /// 配置必须原样回来（回滚窗口内数据不动，超出窗口由 `cleanup_orphan_views` 核销）。
    /// `live_prefix` / `orphan_prefix` 由调用方给出，Rust 侧不持有命名空间字面量（单一来源在 TS）。
    pub fn mark_orphan_screen_views(
        storage: &mut dyn StorageAdapter,
        live_prefix: &str,
        orphan_prefix: &str,
        block_id: &str,
    ) -> Result<usize, Box<dyn Error>> {
        let live_entity = format!("{live_prefix}{block_id}");
        let orphan_entity = format!("{orphan_prefix}{block_id}");
        let rows = repository::ScreenViewRepository::get_all_by_entity(storage.screen_views(), &live_entity)?;
        let now = chrono::Utc::now().timestamp_millis();
        for row in &rows {
            repository::ScreenViewRepository::set_entity(storage.screen_views(), &row.id, &orphan_entity, now)?;
        }
        Ok(rows.len())
    }

    /// 核销孤儿视图（启动时一次性）：扫孤儿前缀逐条核对所属块 ——
    /// - 块仍存在（撤销已复活）→ 改回活前缀，配置保留；这是「标记而非删除」的必然配套。
    /// - 块不存在 / 已软删 → 删掉整个 Screen（`delete_screen` 级联其下 Tabs）。
    ///
    /// 判据只看块本身是否存在，不看 `deleted_at` 之外的任何状态：软删块在重启后永远不会被
    /// 撤销栈复活（栈是会话内内存），故与「不存在」等价。
    pub fn cleanup_orphan_screen_views(
        storage: &mut dyn StorageAdapter,
        orphan_prefix: &str,
        live_prefix: &str,
    ) -> Result<OrphanCleanupReport, Box<dyn Error>> {
        let rows = repository::ScreenViewRepository::get_all(storage.screen_views())?;
        let now = chrono::Utc::now().timestamp_millis();

        // 先按 blockId 归组再决策：同一命名空间下的 Screen 与其 Tabs 必须**一起**处理。
        // 逐行判断会踩到「删 Screen 级联掉 Tabs，但快照里 Tab 还在、于是又判一次」的双重处置。
        let mut groups: std::collections::BTreeMap<String, Vec<(String, bool)>> = Default::default();
        for row in &rows {
            let Some(block_id) = row.entity.strip_prefix(orphan_prefix) else {
                continue;
            };
            if block_id.is_empty() {
                continue;
            }
            groups
                .entry(block_id.to_string())
                .or_default()
                .push((row.id.clone(), row.parent_id.is_empty()));
        }

        let mut report = OrphanCleanupReport::default();
        for (block_id, items) in groups {
            let alive = repository::BlockRepository::get_by_id(storage.blocks(), &block_id).is_ok();
            if alive {
                // 块被撤销复活了：整组改回活命名空间，配置一个字不动
                let live_entity = format!("{live_prefix}{block_id}");
                for (id, _) in &items {
                    repository::ScreenViewRepository::set_entity(storage.screen_views(), id, &live_entity, now)?;
                }
                report.restored += items.len();
                continue;
            }
            // 先删 Screen（级联其下 Tabs），再清残留 Tab 行（上一轮中途失败留下的半截）
            for (id, is_screen) in &items {
                if *is_screen {
                    Self::delete_screen(storage, id)?;
                    report.deleted_screens += 1;
                }
            }
            for (id, is_screen) in &items {
                if !*is_screen {
                    repository::ScreenViewRepository::delete(storage.screen_views(), id)?;
                    report.deleted_tabs += 1;
                }
            }
        }
        Ok(report)
    }
}

/// 孤儿视图核销结果。三个计数分开报，失败半截时能看出停在哪一步。
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct OrphanCleanupReport {
    pub deleted_screens: usize,
    pub deleted_tabs: usize,
    pub restored: usize,
}
