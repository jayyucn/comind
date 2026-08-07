use std::error::Error;
use super::super::types::*;

pub trait BlockRepository {
    fn get_by_id(&self, id: &str) -> Result<Block, Box<dyn Error>>;
    fn get_by_page_id(&self, page_id: &str) -> Result<Vec<Block>, Box<dyn Error>>;
    fn get_children(&self, parent_id: &str) -> Result<Vec<Block>, Box<dyn Error>>;
    /// 批量按 ID 查询 block（用于 checkAndFire 批量化，避免 N+1 IPC）
    fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Block>, Box<dyn Error>>;
    fn create(&mut self, block: &Block) -> Result<Block, Box<dyn Error>>;
    fn update(&mut self, block: &Block) -> Result<Block, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_by_page_id(&mut self, page_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait PageRepository {
    fn get_by_id(&self, id: &str) -> Result<Page, Box<dyn Error>>;
    fn get_by_title(&self, title: &str) -> Result<Option<Page>, Box<dyn Error>>;
    fn get_all(&self) -> Result<Vec<Page>, Box<dyn Error>>;
    /// 批量按 ID 查询 page（用于 checkAndFire 批量化）
    fn get_by_ids(&self, ids: &[String]) -> Result<Vec<Page>, Box<dyn Error>>;
    /// 按月份查询 ideas 类型的页面（title 格式为 yyyy-MM-dd）
    fn get_ideas_by_month(&self, year: i32, month: u32) -> Result<Vec<Page>, Box<dyn Error>>;
    /// 获取所有有 ideas 页面的月份列表（yyyy-MM 格式，倒序）
    fn get_ideas_months(&self) -> Result<Vec<String>, Box<dyn Error>>;
    fn create(&mut self, page: &Page) -> Result<Page, Box<dyn Error>>;
    fn update(&mut self, page: &Page) -> Result<Page, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait LinkRepository {
    fn get_by_id(&self, id: &str) -> Result<Link, Box<dyn Error>>;
    fn get_by_source_block_id(&self, source_block_id: &str) -> Result<Vec<Link>, Box<dyn Error>>;
    fn get_by_target_page_id(&self, target_page_id: &str) -> Result<Vec<Link>, Box<dyn Error>>;
    fn create(&mut self, link: &Link) -> Result<Link, Box<dyn Error>>;
    fn create_many(&mut self, links: &[Link]) -> Result<Vec<Link>, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_by_source_block_id(&mut self, source_block_id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_by_target_page_id(&mut self, target_page_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait PropertyRepository {
    fn get_by_id(&self, id: &str) -> Result<Property, Box<dyn Error>>;
    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Property>, Box<dyn Error>>;
    fn get_by_block_id_and_key(&self, block_id: &str, key: &str) -> Result<Option<Property>, Box<dyn Error>>;
    /// 反查：按 key + values 查询匹配的 block_id 列表（用于查询未完成任务）
    fn query_block_ids_by_key_value(&self, key: &str, values: &[String]) -> Result<Vec<String>, Box<dyn Error>>;
    fn create(&mut self, property: &Property) -> Result<Property, Box<dyn Error>>;
    fn update(&mut self, property: &Property) -> Result<Property, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait RelationshipTypeRepository {
    fn get_by_id(&self, id: &str) -> Result<RelationshipType, Box<dyn Error>>;
    fn get_by_type(&self, r#type: &str) -> Result<Option<RelationshipType>, Box<dyn Error>>;
    fn get_all(&self) -> Result<Vec<RelationshipType>, Box<dyn Error>>;
    fn create(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>>;
    fn update(&mut self, rt: &RelationshipType) -> Result<RelationshipType, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait TemplateRepository {
    fn get_by_id(&self, id: &str) -> Result<UserTemplate, Box<dyn Error>>;
    fn get_by_name(&self, name: &str) -> Result<Option<UserTemplate>, Box<dyn Error>>;
    fn get_all(&self) -> Result<Vec<UserTemplate>, Box<dyn Error>>;
    fn create(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>>;
    fn update(&mut self, template: &UserTemplate) -> Result<UserTemplate, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait SearchRepository {
    fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, Box<dyn Error>>;
    fn update_index(&mut self, block_id: &str, content: &str, title: &str) -> Result<(), Box<dyn Error>>;
    fn delete_from_index(&mut self, block_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait BlockVersionRepository {
    fn get_by_id(&self, id: &str) -> Result<BlockVersion, Box<dyn Error>>;
    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<BlockVersion>, Box<dyn Error>>;
    fn get_latest_version(&self, block_id: &str) -> Result<Option<BlockVersion>, Box<dyn Error>>;
    fn create(&mut self, version: &BlockVersion) -> Result<BlockVersion, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_older_than(&mut self, block_id: &str, timestamp: i64) -> Result<(), Box<dyn Error>>;
}

pub trait NotificationRepository {
    fn get_by_id(&self, id: &str) -> Result<Notification, Box<dyn Error>>;
    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<Notification>, Box<dyn Error>>;
    /// 批量按 block_id 查询通知（用于 checkAndFire 批量化，避免 N+1 IPC）
    fn get_by_block_ids(&self, block_ids: &[String]) -> Result<Vec<Notification>, Box<dyn Error>>;
    fn find_by_event(&self, block_id: &str, kind: &str, event_iso: &str) -> Result<Option<Notification>, Box<dyn Error>>;
    fn query_unread(&self) -> Result<Vec<Notification>, Box<dyn Error>>;
    fn query_pending_due(&self, now_ms: i64) -> Result<Vec<Notification>, Box<dyn Error>>;
    fn query_recent(&self, limit: usize) -> Result<Vec<Notification>, Box<dyn Error>>;
    fn create(&mut self, notification: &Notification) -> Result<Notification, Box<dyn Error>>;
    fn batch_create(&mut self, notifications: &[Notification]) -> Result<Vec<Notification>, Box<dyn Error>>;
    fn update_status(&mut self, id: &str, status: &str) -> Result<Notification, Box<dyn Error>>;
    fn update_payload(&mut self, id: &str, payload: &str) -> Result<Notification, Box<dyn Error>>;
    /// 非 recurring 通知原地改期：把匹配 (block_id, kind) 的通知 event_iso 改为新值，
    /// 状态重置为 unread、清 snooze。用于 block 内容改时间后，通知随 dateRef 一起挪动，
    /// 而不是留下旧 event_iso 的孤儿 + 新时间到点又新建。仅匹配非 recurrence 的 dateRef 产生的通知。
    fn reschedule(&mut self, block_id: &str, kind: &str, new_event_iso: &str) -> Result<(), Box<dyn Error>>;
    fn set_snooze(&mut self, id: &str, snooze_until: i64, status: &str) -> Result<Notification, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
    /// 删除某 block 的全部通知（整块删除 / 页面删除时清理，避免孤儿通知）。
    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>>;
    /// 删除某 block 指定 kind 的通知（block 内容删掉某个 {{schedule/deadline}} 时清理，保留另一 kind）。
    fn delete_by_block_and_kind(&mut self, block_id: &str, kind: &str) -> Result<(), Box<dyn Error>>;
    fn delete_older_than(&mut self, timestamp: i64) -> Result<(), Box<dyn Error>>;
    fn mark_all_read(&mut self) -> Result<(), Box<dyn Error>>;
}

pub trait DateRefRepository {
    fn get_all(&self) -> Result<Vec<DateRef>, Box<dyn Error>>;
    fn get_by_id(&self, id: &str) -> Result<DateRef, Box<dyn Error>>;
    fn get_by_block_id(&self, block_id: &str) -> Result<Vec<DateRef>, Box<dyn Error>>;
    fn query_by_date_range(
        &self,
        kind: &str,
        from: &str,
        to: &str,
    ) -> Result<Vec<DateRef>, Box<dyn Error>>;
    fn query_overdue(&self, today: &str) -> Result<Vec<DateRef>, Box<dyn Error>>;
    /// 非 recurring 且到期的 dateRef：`event_ts - lead_minutes * 60000 <= ?now`。
    /// 用于 checkAndFire 替代全量遍历 block —— 直接命中到期记录，O(log n)。
    fn query_due_non_recurring(&self, now_ms: i64) -> Result<Vec<DateRef>, Box<dyn Error>>;
    /// 所有 recurring dateRef（数量小，全量扫），由 checkAndFire 在 TS 侧算下一周期。
    fn query_all_recurring(&self) -> Result<Vec<DateRef>, Box<dyn Error>>;
    fn create(&mut self, date_ref: &DateRef) -> Result<DateRef, Box<dyn Error>>;
    fn create_many(&mut self, date_refs: &[DateRef]) -> Result<Vec<DateRef>, Box<dyn Error>>;
    fn delete(&mut self, id: &str) -> Result<(), Box<dyn Error>>;
    fn delete_by_block_id(&mut self, block_id: &str) -> Result<(), Box<dyn Error>>;
}

pub trait StorageAdapter {
    fn blocks(&mut self) -> &mut dyn BlockRepository;
    fn pages(&mut self) -> &mut dyn PageRepository;
    fn links(&mut self) -> &mut dyn LinkRepository;
    fn properties(&mut self) -> &mut dyn PropertyRepository;
    fn relationship_types(&mut self) -> &mut dyn RelationshipTypeRepository;
    fn templates(&mut self) -> &mut dyn TemplateRepository;
    fn search(&mut self) -> &mut dyn SearchRepository;
    fn block_versions(&mut self) -> &mut dyn BlockVersionRepository;
    fn notifications(&mut self) -> &mut dyn NotificationRepository;
    fn date_refs(&mut self) -> &mut dyn DateRefRepository;
}

pub trait TransactionalStorageAdapter: StorageAdapter {
    fn transaction<R, F>(&mut self, f: F) -> Result<R, Box<dyn Error>>
    where
        F: FnOnce(&mut dyn StorageAdapter) -> Result<R, Box<dyn Error>>;
}