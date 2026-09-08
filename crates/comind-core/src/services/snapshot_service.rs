use crate::{
    types::{Block, Page, PageSnapshot, Property},
    storage::{repository, StorageAdapter},
};
use serde::Serialize;
use std::collections::HashMap;
use std::error::Error;

/// `page_snapshots.content_json` 的顶层信封：flat blocks + properties map。
/// 与库内存储同构（字段名直通 Block/Property），渲染端复用既有 `buildTree` + properties 通路。
#[derive(Serialize)]
struct SnapshotContent {
    blocks: Vec<Block>,
    /// block_id → 该块未删除属性（当日属性值，如 status/priority）
    properties: HashMap<String, Vec<Property>>,
}

/// Ideas 页惰性物化（ADR-0042）：把「标题日期早于今天且尚无快照」的 Ideas 页整页块树
/// 连同当日属性值序列化进 `page_snapshots`。活块数据零修改；幂等（每页至多一份快照）。
pub struct SnapshotService;

impl SnapshotService {
    /// `content_json` 结构版本（对应 schema `version` 列），当前 1。
    pub const CONTENT_VERSION: i64 = 1;

    /// 遍历 `type='ideas'` 且标题日期 < today 且尚无快照的页，逐页物化。
    ///
    /// - `today`：本地时区 `yyyy-MM-dd`，由调用方（启动触发）注入，保证测试可固定边界。
    /// - 标题无法解析为 `yyyy-MM-dd` 的 ideas 页跳过（无法判定属于哪一天）。
    /// - 幂等：物化前查 `page_snapshots`，已有快照则跳过；仓库层 `INSERT OR IGNORE` 兜底。
    ///
    /// 返回本次新物化的页数。
    pub fn snapshot_stale_ideas_pages(
        storage: &mut dyn StorageAdapter,
        today: &str,
    ) -> Result<usize, Box<dyn Error>> {
        let today_date = chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d")
            .map_err(|e| format!("invalid today date '{today}': {e}"))?;

        let pages = repository::PageRepository::get_all(storage.pages())?;
        let mut materialized = 0usize;

        for page in pages.iter().filter(|p| p.r#type == "ideas") {
            // 标题日期 < today 才算过期；解析失败（非日期标题）跳过
            let page_date = match chrono::NaiveDate::parse_from_str(&page.title, "%Y-%m-%d") {
                Ok(d) => d,
                Err(_) => continue,
            };
            if page_date >= today_date {
                continue;
            }
            // 幂等：已有快照不再物化
            if storage.page_snapshots().get_by_page_id(&page.id)?.is_some() {
                continue;
            }

            let snapshot = Self::materialize_page(storage, page)?;
            storage.page_snapshots().create(&snapshot)?;
            materialized += 1;
        }

        Ok(materialized)
    }

    /// 单页物化：读该页全部未删除块（按 pos 序）与各块未删除属性，序列化为 content_json。
    /// 只读活数据，不改任何块/属性行。
    fn materialize_page(
        storage: &mut dyn StorageAdapter,
        page: &Page,
    ) -> Result<PageSnapshot, Box<dyn Error>> {
        let blocks = repository::BlockRepository::get_by_page_id(storage.blocks(), &page.id)?;
        let block_ids: Vec<String> = blocks.iter().map(|b| b.id.clone()).collect();
        let props = if block_ids.is_empty() {
            Vec::new()
        } else {
            repository::PropertyRepository::get_by_block_ids(storage.properties(), &block_ids)?
        };

        let mut properties: HashMap<String, Vec<Property>> = HashMap::new();
        for p in props {
            properties.entry(p.block_id.clone()).or_default().push(p);
        }

        let content_json = serde_json::to_string(&SnapshotContent { blocks, properties })
            .map_err(|e| format!("serialize snapshot for page {}: {e}", page.id))?;

        Ok(PageSnapshot {
            page_id: page.id.clone(),
            date: page.title.clone(),
            version: Self::CONTENT_VERSION,
            content_json,
            created_at: chrono::Utc::now().timestamp_millis(),
        })
    }

    /// 读取指定 ideas 页的快照 `content_json`（原始 JSON 文本）。
    ///
    /// 供前端历史页渲染（ADR-0042 T5 快照读取守卫）取用：渲染端拿到
    /// flat blocks + properties map 后经 buildTree 复用只读渲染。
    /// 无快照（今日页 / 未过期页 / 非 ideas 页）返回 `None`。
    pub fn get_ideas_snapshot(
        storage: &mut dyn StorageAdapter,
        page_id: &str,
    ) -> Result<Option<String>, Box<dyn Error>> {
        Ok(storage
            .page_snapshots()
            .get_by_page_id(page_id)?
            .map(|s| s.content_json))
    }
}
