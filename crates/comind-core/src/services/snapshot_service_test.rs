#[cfg(test)]
mod tests {
    use crate::{
        services::{BlockService, PageService, PropertyService, SnapshotService},
        storage::{repository::StorageAdapter, sqlite::SQLiteAdapter},
    };
    use std::error::Error;

    // 固定「今天」，测试完全确定（物化函数接收 today 参数，不依赖运行时时钟）
    const TODAY: &str = "2026-09-07";
    const YESTERDAY: &str = "2026-09-06";

    fn create_test_adapter() -> Result<SQLiteAdapter, Box<dyn Error>> {
        SQLiteAdapter::open_in_memory()
    }

    /// 建「昨日」ideas 页：一个普通块 + 一个带 status=Todo 属性的任务块。
    /// 返回 (page, plain_block_id, task_block_id)。
    fn seed_yesterday_ideas_page(
        adapter: &mut SQLiteAdapter,
    ) -> Result<(crate::types::Page, String, String), Box<dyn Error>> {
        let page = PageService::create(
            adapter,
            "",
            YESTERDAY,
            Some("ideas"),
            None,
            None,
            None,
            None,
        )?;
        let plain = BlockService::create(adapter, &page.id, None, "昨日笔记", "{}", "bullet", None)?;
        let task = BlockService::create(adapter, &page.id, None, "写周报", "{}", "bullet", None)?;
        PropertyService::create(adapter, &task.id, "status", "Todo", "string", 0, 0, 1)?;
        Ok((page, plain.id, task.id))
    }

    /// 从快照 content_json 中取出 task block 的 status 属性值。
    fn snapshot_task_status(snapshot_json: &str, task_id: &str) -> Option<String> {
        let v: serde_json::Value = serde_json::from_str(snapshot_json).ok()?;
        let props = v["properties"].get(task_id)?.as_array()?;
        props
            .iter()
            .find(|p| p["key"] == "status")
            .map(|p| p["value"].as_str().unwrap_or_default().to_string())
    }

    #[test]
    fn materializes_yesterday_ideas_page_and_keeps_live_data_intact() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let (page, _plain_id, task_id) = seed_yesterday_ideas_page(&mut adapter)?;

        // 物化前：尚无快照
        assert!(adapter.page_snapshots().get_by_page_id(&page.id)?.is_none());

        let count = SnapshotService::snapshot_stale_ideas_pages(&mut adapter, TODAY)?;
        assert_eq!(count, 1, "昨日 ideas 页应被物化");

        // ① 快照行存在、内容定格（含当日属性值）
        let snap = adapter
            .page_snapshots()
            .get_by_page_id(&page.id)?
            .expect("snapshot row must exist");
        assert_eq!(snap.date, YESTERDAY);
        assert_eq!(snap.version, 1);

        let v: serde_json::Value = serde_json::from_str(&snap.content_json)?;
        let blocks = v["blocks"].as_array().expect("content_json.blocks array");
        assert_eq!(blocks.len(), 2, "整页块树应序列化（普通块 + 任务块）");
        let props = v["properties"].as_object().expect("content_json.properties map");
        let task_props = props.get(&task_id).expect("任务块属性应在 properties map 中");
        assert!(
            task_props
                .as_array()
                .expect("properties entry is array")
                .iter()
                .any(|p| p["key"] == "status" && p["value"] == "Todo"),
            "快照须含任务块当日 status=Todo"
        );

        // ② 活块数据未被改动：仍可经属性通路查询 & 修改
        let live = PropertyService::get_by_block_id_and_key(&mut adapter, &task_id, "status")?;
        assert_eq!(live.unwrap().value, "Todo", "活属性应保持 Todo");
        let live_block = BlockService::get_by_page_id(&mut adapter, &page.id)?;
        assert_eq!(live_block.len(), 2, "活块列表应原样保留");

        // 改 status 走属性通路 → 成功（活数据仍可演化）
        let prop = PropertyService::get_by_block_id_and_key(&mut adapter, &task_id, "status")?;
        PropertyService::update(&mut adapter, &prop.unwrap().id, Some("Doing"), None, None, None)?;
        assert_eq!(
            PropertyService::get_by_block_id_and_key(&mut adapter, &task_id, "status")?
                .unwrap()
                .value,
            "Doing"
        );

        // 快照不受活改影响——仍定格 Todo
        let snap_again = adapter
            .page_snapshots()
            .get_by_page_id(&page.id)?
            .expect("snapshot row must exist");
        assert_eq!(
            snapshot_task_status(&snap_again.content_json, &task_id).as_deref(),
            Some("Todo"),
            "活块改 Doing 后快照仍应定格当日 Todo"
        );

        Ok(())
    }

    #[test]
    fn snapshot_stale_ideas_pages_is_idempotent() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let (page, _plain_id, _task_id) = seed_yesterday_ideas_page(&mut adapter)?;

        let first = SnapshotService::snapshot_stale_ideas_pages(&mut adapter, TODAY)?;
        assert_eq!(first, 1);
        let snap1 = adapter
            .page_snapshots()
            .get_by_page_id(&page.id)?
            .expect("snapshot row must exist");

        // 二次调用：不重载、不产生新行 → 返回 0，行内容（含 created_at）原样保留
        let second = SnapshotService::snapshot_stale_ideas_pages(&mut adapter, TODAY)?;
        assert_eq!(second, 0, "重复物化不应产生新行");

        let snap2 = adapter
            .page_snapshots()
            .get_by_page_id(&page.id)?
            .expect("snapshot row must exist");
        assert_eq!(snap1.created_at, snap2.created_at, "created_at 不变证明未重写");
        assert_eq!(snap1.content_json, snap2.content_json, "content_json 不变证明未重载");
        assert_eq!(snap1.date, snap2.date);
        assert_eq!(snap1.version, snap2.version);

        Ok(())
    }

    #[test]
    fn skips_today_non_ideas_and_unparseable_titles() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;

        // 今日 ideas 页：不应物化
        PageService::create(&mut adapter, "", TODAY, Some("ideas"), None, None, None, None)?;
        // 非 ideas 类型但标题是过去日期：不应物化
        PageService::create(&mut adapter, "", YESTERDAY, Some("normal"), None, None, None, None)?;
        // ideas 页但标题不是日期：无法判定日期，跳过
        PageService::create(&mut adapter, "", "任务收集", Some("ideas"), None, None, None, None)?;

        let count = SnapshotService::snapshot_stale_ideas_pages(&mut adapter, TODAY)?;
        assert_eq!(count, 0, "今日页 / 非 ideas 页 / 非日期标题都不应物化");

        Ok(())
    }

    #[test]
    fn reads_back_materialized_snapshot_and_none_for_unsnapshotted() -> Result<(), Box<dyn Error>> {
        let mut adapter = create_test_adapter()?;
        let (page, _plain_id, task_id) = seed_yesterday_ideas_page(&mut adapter)?;
        // 今日 ideas 页（无快照）
        let today_page = PageService::create(&mut adapter, "", TODAY, Some("ideas"), None, None, None, None)?;

        // 未物化前：读取为 None
        assert!(SnapshotService::get_ideas_snapshot(&mut adapter, &page.id)?.is_none());

        SnapshotService::snapshot_stale_ideas_pages(&mut adapter, TODAY)?;

        // 物化后可读回完整 content_json（与行内存储一致，含当日 status）
        let (content, _date) = SnapshotService::get_ideas_snapshot(&mut adapter, &page.id)?
            .expect("已物化页应能读回快照内容");
        assert_eq!(
            snapshot_task_status(&content, &task_id).as_deref(),
            Some("Todo"),
            "读回内容应定格当日属性"
        );
        let v: serde_json::Value = serde_json::from_str(&content)?;
        assert!(v["blocks"].is_array() && v["properties"].is_object());

        // 无快照页（今日 ideas / 不存在页）：None
        assert!(SnapshotService::get_ideas_snapshot(&mut adapter, &today_page.id)?.is_none());
        assert!(SnapshotService::get_ideas_snapshot(&mut adapter, "no-such-page")?.is_none());

        Ok(())
    }
}
