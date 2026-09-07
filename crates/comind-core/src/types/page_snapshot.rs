use serde::{Deserialize, Serialize};

/// Ideas 页存储级不可变快照（ADR-0042，父 issue #65）。
///
/// 每个标题日期早于今天的 Ideas 页，在启动时惰性物化为一份快照落库；
/// 一页至多一份（`page_id` 为幂等键），**永不重物化、永不改写**。
/// 历史 Ideas 页的一切页面渲染走快照；活数据仍可经 TaskHub/BlockModal 编辑，互不触碰。
///
/// `content_json` 与库内存储同构：flat blocks 数组 + properties map，
/// 渲染端可直接复用既有 `buildTree`，不引入新序列化格式。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageSnapshot {
    /// 被物化的 Ideas 页 id（幂等键：一页至多一份快照）
    pub page_id: String,
    /// 页面标题日期 `yyyy-MM-dd`（该页代表哪一天）
    pub date: String,
    /// `content_json` 的结构版本，当前为 1 —— 未来格式升级凭此辨识，绝不静默改格式
    pub version: i64,
    /// flat blocks + properties map 的 JSON 文本（与库内存储同构）
    pub content_json: String,
    /// 物化时刻（毫秒时间戳）
    pub created_at: i64,
}

/// `content_json` 的当前结构版本。升格式时必须递增并保留旧版本读取路径。
pub const PAGE_SNAPSHOT_CONTENT_VERSION: i64 = 1;
