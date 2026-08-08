use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// 轻量日期引用（复用 date_ref 表字段，去重后投影）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DateRefLite {
    pub kind: String,     // "deadline" | "schedule" | ...
    pub iso: String,
    pub date_day: String, // YYYY-MM-DD，用于范围/逾期/分组
    pub recurrence: String,
    pub event_ts: i64,    // 预计算事件时间戳（毫秒）
}

/// 单个 block 的轻量投影（不搬子树/格式）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockCard {
    pub block_id: String,
    pub page_id: String,
    pub parent_id: String,
    pub content_preview: String,              // 去掉 {{schedule:…}}/{{deadline:…}} 标记后的摘要
    pub properties: HashMap<String, Value>,   // 完整属性映射
    pub date_refs: Vec<DateRefLite>,
    pub updated_at: i64,
}
