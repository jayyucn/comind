#[cfg(test)]
mod tests {
    use crate::{
        services::{BlockService, FilterService, PageService},
        storage::{repository::ScreenViewRepository, repository::StorageAdapter, sqlite::SQLiteAdapter},
        types::ScreenView,
    };
    use std::error::Error;

    const LIVE: &str = "query-block:";
    const ORPHAN: &str = "query-orphan:";

    fn create_test_adapter() -> Result<SQLiteAdapter, Box<dyn Error>> {
        SQLiteAdapter::open_in_memory()
    }

    /// 一个 Screen + 其下一个 Tab，模拟查询块的默认命名视图。
    fn seed_view(adapter: &mut SQLiteAdapter, entity: &str) -> Result<(), Box<dyn Error>> {
        let screen = ScreenView::new(entity, "", "查询", "", "table", "", true, 0, "{\"k\":1}");
        repository_create(adapter, &screen)?;
        let tab = ScreenView::new(entity, &screen.id, "全部", "", "table", "", false, 1, "{\"k\":1}");
        repository_create(adapter, &tab)?;
        Ok(())
    }

    fn repository_create(adapter: &mut SQLiteAdapter, view: &ScreenView) -> Result<(), Box<dyn Error>> {
        ScreenViewRepository::create(adapter.screen_views(), view)?;
        Ok(())
    }

    fn entities(adapter: &mut SQLiteAdapter) -> Result<Vec<String>, Box<dyn Error>> {
        let mut list: Vec<String> = ScreenViewRepository::get_all(adapter.screen_views())?
            .into_iter()
            .map(|v| v.entity)
            .collect();
        list.sort();
        Ok(list)
    }

    /// 标记：同命名空间下 Screen 与 Tab **都**改挂孤儿前缀 —— 只改 Screen 会让 Tab 留在活命名空间，
    /// 下次打开同名块时 `get_all_by_entity` 会把别人的旧 Tab 捞进来。
    #[test]
    fn test_mark_orphan_renames_screen_and_tabs() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        seed_view(&mut adapter, "query-block:b1")?;
        seed_view(&mut adapter, "query-block:b2")?;

        let renamed = FilterService::mark_orphan_screen_views(&mut adapter, LIVE, ORPHAN, "b1")?;

        assert_eq!(renamed, 2, "Screen + 1 Tab 都应被改挂");
        assert_eq!(
            entities(&mut adapter)?,
            vec!["query-block:b2", "query-block:b2", "query-orphan:b1", "query-orphan:b1"],
            "只应改挂 b1（Screen + Tab 两行），b2 两行不受影响"
        );
        Ok(())
    }

    /// 核销：块已不存在（或已软删）⇒ 删掉整个 Screen 及其 Tab。
    #[test]
    fn test_cleanup_deletes_orphans_without_block() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        seed_view(&mut adapter, "query-orphan:gone")?;

        let report = FilterService::cleanup_orphan_screen_views(&mut adapter, ORPHAN, LIVE)?;

        assert_eq!(report.deleted_screens, 1);
        assert_eq!(report.deleted_tabs, 1, "Tab 行同样计入（Screen 级联 + 残留行自清）");
        assert_eq!(report.restored, 0);
        assert!(entities(&mut adapter)?.is_empty(), "Screen 与其 Tab 应一并消失");
        Ok(())
    }

    /// 核销：块仍在（撤销已复活）⇒ 改回活前缀，配置原样保留 —— 「标记不删」的必然配套。
    #[test]
    fn test_cleanup_restores_orphans_with_live_block() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let page = PageService::create(&mut adapter, "", "P", None, None, None, None, None)?;
        let block = BlockService::create(&mut adapter, &page.id, None, "", "{}", "query", None, true)?;
        seed_view(&mut adapter, &format!("{ORPHAN}{}", block.id))?;

        let report = FilterService::cleanup_orphan_screen_views(&mut adapter, ORPHAN, LIVE)?;

        assert_eq!(report.restored, 2, "Screen 与 Tab 都改回活命名空间");
        assert_eq!(report.deleted_screens, 0);
        let rows = ScreenViewRepository::get_all(adapter.screen_views())?;
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|v| v.entity == format!("{LIVE}{}", block.id)));
        assert!(rows.iter().all(|v| v.config == "{\"k\":1}"), "配置不得被核销动过");
        Ok(())
    }

    /// 核销：块活着但**活命名空间已有行** ⇒ 丢弃孤儿（防同一命名空间两套屏）。
    ///
    /// 场景：撤销把块捞回来时配置还在孤儿前缀，块重新挂载读到空命名空间会 seed 一套默认屏，
    /// 用户接着改了列宽/筛选。此时把孤儿挂回去，同一个 `query-block:<id>` 下就会并出两组 Screen。
    #[test]
    fn test_cleanup_drops_orphans_when_live_namespace_taken() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let page = PageService::create(&mut adapter, "", "P", None, None, None, None, None)?;
        let block = BlockService::create(&mut adapter, &page.id, None, "", "{}", "query", None, true)?;
        seed_view(&mut adapter, &format!("{LIVE}{}", block.id))?;
        seed_view(&mut adapter, &format!("{ORPHAN}{}", block.id))?;

        let report = FilterService::cleanup_orphan_screen_views(&mut adapter, ORPHAN, LIVE)?;

        assert_eq!(report.restored, 0, "活命名空间被占用时不再挂回");
        assert_eq!(report.deleted_screens, 1);
        assert_eq!(report.deleted_tabs, 1);
        let rows = ScreenViewRepository::get_all(adapter.screen_views())?;
        assert_eq!(rows.len(), 2, "只剩活命名空间那一组");
        assert!(rows.iter().all(|v| v.entity == format!("{LIVE}{}", block.id)));
        Ok(())
    }

    /// 非孤儿命名空间（任务中心 `block` / 页面库 `page` / 普通页面配置）一行都不能碰。
    #[test]
    fn test_cleanup_ignores_other_namespaces() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        seed_view(&mut adapter, "block")?;
        seed_view(&mut adapter, "page")?;
        seed_view(&mut adapter, "tag:abc")?;

        let report = FilterService::cleanup_orphan_screen_views(&mut adapter, ORPHAN, LIVE)?;

        assert_eq!(report.deleted_screens, 0);
        assert_eq!(report.deleted_tabs, 0);
        assert_eq!(report.restored, 0);
        assert_eq!(entities(&mut adapter)?.len(), 6);
        Ok(())
    }
}
