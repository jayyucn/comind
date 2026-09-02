import { invoke } from '@tauri-apps/api/core'
import { isTauriEnvironment, type TauriBatchCheckAndFireData, type TauriGraphEdgeRecord } from './tauri-platform'
export { isTauriEnvironment } from './tauri-platform'
import { initWasmClient, type WasmClient } from './wasm-client'

function parseJsonResult<T>(result: any): T {
  if (typeof result === 'string') {
    return JSON.parse(result) as T
  }
  return result as T
}
import type {
  Block, Page, Property, Link, RelationshipType, LinkDraft,
  UserTemplate, SearchResult, BlockUpdate, BlockSaveResult, PageUpdate,
  BatchOperation, BatchResult, ExportResult, ImportResult, SyncConfig, BlockVersion,
  Notification, DateRefRecord, IncompleteTask, BlockCard, SavedFilterRust, ScreenViewRust,
  NotificationSettings, PageWithBlocks, BookHighlightRust, BookProgressRust
} from './types'

export interface CoreClient {
  getBlock(blockId: string): Promise<Block>
  getBlocksByPage(pageId: string): Promise<Block[]>
  saveBlockTree(blocks: BlockUpdate[]): Promise<BlockSaveResult[]>
  deleteBlock(blockId: string): Promise<void>

  getPage(pageId: string): Promise<Page>
  getAllPages(): Promise<Page[]>
  getTrashPages(): Promise<Page[]>
  getIdeasPagesByMonth(year: number, month: number): Promise<Page[]>
  /** 获取所有有 ideas 页面的月份列表（yyyy-MM 格式，倒序） */
  getIdeasMonths(): Promise<string[]>
  /** 幂等地获取或创建今日 Ideas 页面（Rust 端为单一事实来源） */
  ensureTodayIdeasPage(): Promise<Page>
  savePage(page: PageUpdate): Promise<Page>
  deletePageCascade(pageId: string): Promise<void>

  getBacklinks(pageId: string): Promise<Link[]>
  getOutlinks(pageId: string): Promise<Link[]>

  getProperties(blockId: string): Promise<Property[]>
  setProperty(blockId: string, key: string, value: string, type: string): Promise<Property>
  deleteProperty(blockId: string, key: string): Promise<void>

  getRelationshipTypes(): Promise<RelationshipType[]>

  getTemplates(): Promise<UserTemplate[]>

  search(query: string): Promise<SearchResult[]>

  executeBatch(operations: BatchOperation[]): Promise<BatchResult[]>

  createBlockVersion(blockId: string, snapshot: string, hash: string, reason: string, checkpointName?: string): Promise<BlockVersion>
  getBlockVersions(blockId: string): Promise<BlockVersion[]>
  getBlockVersionById(id: string): Promise<BlockVersion>
  restoreBlockVersion(versionId: string): Promise<BlockVersion>
  deleteBlockVersion(versionId: string): Promise<void>
  cleanupBlockVersions(retentionDays: number): Promise<void>

  getNotification(id: string): Promise<Notification>
  getNotificationsByBlock(blockId: string): Promise<Notification[]>
  queryUnreadNotifications(): Promise<Notification[]>
  queryRecentNotifications(limit: number): Promise<Notification[]>
  createNotification(notification: Notification): Promise<Notification>
  batchCreateNotifications(notifications: Notification[]): Promise<Notification[]>
  updateNotificationStatus(id: string, status: string): Promise<Notification>
  updateNotificationPayload(id: string, payload: string): Promise<Notification>
  setNotificationSnooze(id: string, snoozeUntil: number, status: string): Promise<Notification>
  deleteNotification(id: string): Promise<void>
  cleanupNotifications(timestamp: number): Promise<void>
  markAllNotificationsRead(): Promise<void>

  // S10: Render segments
  getPageWithBlocks(pageId: string): Promise<PageWithBlocks>
  /** Batch variant of getPageWithBlocks — single IPC for multiple pages. */
  getPagesWithBlocks(pageIds: string[]): Promise<PageWithBlocks[]>

  // Notification Settings (migrated to Rust)
  getNotificationSettings(): Promise<NotificationSettings>
  saveNotificationSettings(config: NotificationSettings): Promise<void>
  checkAndFire(): Promise<Notification[]>
  syncPayloadForBlock(blockId: string): Promise<void>

  queryDateRefs(kind: string, from: string, to: string): Promise<DateRefRecord[]>
  queryOverdueDateRefs(today: string): Promise<DateRefRecord[]>
  getDateRefsByBlock(blockId: string): Promise<DateRefRecord[]>
  getDateRefsByPage(pageId: string): Promise<[string, DateRefRecord[]][]>
  queryDueNonRecurringDateRefs(nowMs: number): Promise<DateRefRecord[]>
  queryAllRecurringDateRefs(): Promise<DateRefRecord[]>
  queryIncompleteTasks(): Promise<IncompleteTask[]>
  batchCheckAndFireData(nowMs: number): Promise<TauriBatchCheckAndFireData>
  rebuildDateRefs(): Promise<{ rebuilt: number }>
  buildGraphSnapshot(): Promise<TauriGraphEdgeRecord[]>

  getBlockCards(): Promise<BlockCard[]>

  // Saved Filters
  getSavedFilters(): Promise<SavedFilterRust[]>
  saveSavedFilter(name: string, queryJson: string): Promise<SavedFilterRust>
  updateSavedFilter(id: string, name: string, queryJson: string): Promise<SavedFilterRust>
  deleteSavedFilter(id: string): Promise<void>

  // Screens & Tabs (两级层级)
  getScreenViews(entity: string): Promise<ScreenViewRust[]>
  createScreen(entity: string, name: string, viewType: string, sortOrder: number, config: string): Promise<ScreenViewRust>
  createTab(entity: string, parentId: string, name: string, viewType: string, queryJson: string, sortOrder: number, config: string): Promise<ScreenViewRust>
  updateScreen(id: string, name: string, viewType: string, config: string): Promise<ScreenViewRust>
  updateTab(id: string, name: string, viewType: string, queryJson: string, config: string): Promise<ScreenViewRust>
  deleteScreen(id: string): Promise<void>
  deleteScreenView(id: string): Promise<void>
  setDefaultScreen(id: string): Promise<ScreenViewRust>

  // Book highlights & progress（ADR-0040：仅桌面本地，不入 SyncTable）
  upsertBookHighlight(highlight: BookHighlightRust): Promise<BookHighlightRust>
  deleteBookHighlight(id: string): Promise<void>
  getBookHighlights(bookPageId: string): Promise<BookHighlightRust[]>
  getBookProgress(bookPageId: string): Promise<BookProgressRust | null>
  upsertBookProgress(bookPageId: string, cfi: string): Promise<BookProgressRust>

  // S3/S6 Rust content-parser commands（web 无实现，Tauri 直通）
  parseDateInput(input: string): Promise<string | null>
  normalizeJournalTitle(title: string): Promise<string | null>
  isTodayTitle(normalizedTitle: string): Promise<boolean>
  extractLinksFromContent(content: string): Promise<LinkDraft[]>
  applyRelationshipTypeToBlockContent(content: string, targetTitle: string, newRelationshipType: string | null): Promise<string>
  calculateNextRecurrence(iso: string, rule: string): Promise<string>
  checkHasTypedLinkToTarget(content: string, targetTitle: string): Promise<{ has_typed_link: boolean }>
}

class TauriClient implements CoreClient {
  async getBlock(blockId: string): Promise<Block> {
    return invoke('get_block', { blockId })
  }

  async getBlocksByPage(pageId: string): Promise<Block[]> {
    return invoke('get_blocks_by_page', { pageId })
  }

  async getBlockCards(): Promise<BlockCard[]> {
    return invoke('get_block_cards')
  }

  // ---- Saved Filters ----
  async getSavedFilters(): Promise<SavedFilterRust[]> {
    return invoke('get_saved_filters')
  }

  async saveSavedFilter(name: string, queryJson: string): Promise<SavedFilterRust> {
    return invoke('save_saved_filter', { name, queryJson })
  }

  async updateSavedFilter(id: string, name: string, queryJson: string): Promise<SavedFilterRust> {
    return invoke('update_saved_filter', { id, name, queryJson })
  }

  async deleteSavedFilter(id: string): Promise<void> {
    return invoke('delete_saved_filter', { id })
  }

  // ---- Book highlights & progress（ADR-0040：仅桌面本地，不入 SyncTable） ----
  async upsertBookHighlight(highlight: BookHighlightRust): Promise<BookHighlightRust> {
    return invoke('upsert_book_highlight', { highlight })
  }

  async deleteBookHighlight(id: string): Promise<void> {
    return invoke('delete_book_highlight', { id })
  }

  async getBookHighlights(bookPageId: string): Promise<BookHighlightRust[]> {
    return invoke('get_book_highlights', { bookPageId })
  }

  async getBookProgress(bookPageId: string): Promise<BookProgressRust | null> {
    return invoke('get_book_progress', { bookPageId })
  }

  async upsertBookProgress(bookPageId: string, cfi: string): Promise<BookProgressRust> {
    return invoke('upsert_book_progress', { bookPageId, cfi })
  }

  // ---- Screens & Tabs（两级层级） ----
  async getScreenViews(entity: string): Promise<ScreenViewRust[]> {
    return invoke('get_screen_views', { entity })
  }

  async createScreen(entity: string, name: string, viewType: string, sortOrder: number, config: string): Promise<ScreenViewRust> {
    return invoke('create_screen', { entity, name, viewType, sortOrder, config })
  }

  async createTab(entity: string, parentId: string, name: string, viewType: string, queryJson: string, sortOrder: number, config: string): Promise<ScreenViewRust> {
    return invoke('create_tab', { entity, parentId, name, viewType, queryJson, sortOrder, config })
  }

  async updateScreen(id: string, name: string, viewType: string, config: string): Promise<ScreenViewRust> {
    return invoke('update_screen', { id, name, viewType, config })
  }

  async updateTab(id: string, name: string, viewType: string, queryJson: string, config: string): Promise<ScreenViewRust> {
    return invoke('update_tab', { id, name, viewType, queryJson, config })
  }

  async deleteScreen(id: string): Promise<void> {
    return invoke('delete_screen', { id })
  }

  async deleteScreenView(id: string): Promise<void> {
    return invoke('delete_screen_view', { id })
  }

  async setDefaultScreen(id: string): Promise<ScreenViewRust> {
    return invoke('set_default_screen', { id })
  }

  async saveBlockTree(blocks: BlockUpdate[]): Promise<BlockSaveResult[]> {
    return invoke('save_block_tree', { blocks })
  }

  async deleteBlock(blockId: string): Promise<void> {
    return invoke('delete_block', { blockId })
  }

  async getPage(pageId: string): Promise<Page> {
    return invoke('get_page', { pageId })
  }

  async getAllPages(): Promise<Page[]> {
    return invoke('get_all_pages')
  }

  async getTrashPages(): Promise<Page[]> {
    return invoke('get_trash_pages')
  }

  async getIdeasPagesByMonth(year: number, month: number): Promise<Page[]> {
    return invoke('get_ideas_pages_by_month', { year, month })
  }

  async getIdeasMonths(): Promise<string[]> {
    return invoke('get_ideas_months')
  }

  async ensureTodayIdeasPage(): Promise<Page> {
    return invoke('ensure_today_ideas_page')
  }

  async savePage(page: PageUpdate): Promise<Page> {
    return invoke('save_page', { page })
  }

  async deletePageCascade(pageId: string): Promise<void> {
    return invoke('delete_page_cascade', { pageId })
  }

  async getBacklinks(pageId: string): Promise<Link[]> {
    return invoke('get_backlinks', { pageId })
  }

  async getOutlinks(pageId: string): Promise<Link[]> {
    return invoke('get_outlinks', { pageId })
  }

  async getProperties(blockId: string): Promise<Property[]> {
    return invoke('get_properties', { blockId })
  }

  async setProperty(blockId: string, key: string, value: string, type: string): Promise<Property> {
    return invoke('set_property', { blockId, key, value, type })
  }

  async deleteProperty(blockId: string, key: string): Promise<void> {
    return invoke('delete_property', { blockId, key })
  }

  async getRelationshipTypes(): Promise<RelationshipType[]> {
    return invoke('get_relationship_types')
  }

  async getTemplates(): Promise<UserTemplate[]> {
    return invoke('get_templates')
  }

  async search(query: string): Promise<SearchResult[]> {
    return invoke('search', { query })
  }

  async executeBatch(operations: BatchOperation[]): Promise<BatchResult[]> {
    return invoke('execute_batch', { operations })
  }

  async createBlockVersion(blockId: string, snapshot: string, hash: string, reason: string, checkpointName?: string): Promise<BlockVersion> {
    return invoke('create_block_version', { blockId, snapshot, hash, reason, checkpointName })
  }

  async getBlockVersions(blockId: string): Promise<BlockVersion[]> {
    return invoke('get_block_versions', { blockId })
  }

  async getBlockVersionById(id: string): Promise<BlockVersion> {
    return invoke('get_block_version_by_id', { id })
  }

  async restoreBlockVersion(versionId: string): Promise<BlockVersion> {
    return invoke('restore_block_version', { versionId })
  }

  async deleteBlockVersion(versionId: string): Promise<void> {
      return invoke('delete_block_version', { versionId })
    }

    async cleanupBlockVersions(retentionDays: number): Promise<void> {
      return invoke('cleanup_block_versions', { retentionDays })
    }

    async getNotification(id: string): Promise<Notification> {
      return invoke('get_notification', { id })
    }

    async getNotificationsByBlock(blockId: string): Promise<Notification[]> {
      return invoke('get_notifications_by_block', { blockId })
    }

    async queryUnreadNotifications(): Promise<Notification[]> {
      return invoke('query_unread_notifications')
    }

    async queryRecentNotifications(limit: number): Promise<Notification[]> {
      return invoke('query_recent_notifications', { limit })
    }

    async createNotification(notification: Notification): Promise<Notification> {
      return invoke('create_notification', { notification })
    }

    async batchCreateNotifications(notifications: Notification[]): Promise<Notification[]> {
      return invoke('batch_create_notifications', { notifications })
    }

    async updateNotificationStatus(id: string, status: string): Promise<Notification> {
      return invoke('update_notification_status', { id, status })
    }

    async updateNotificationPayload(id: string, payload: string): Promise<Notification> {
      return invoke('update_notification_payload', { id, payload })
    }

    async setNotificationSnooze(id: string, snoozeUntil: number, status: string): Promise<Notification> {
      return invoke('set_notification_snooze', { id, snoozeUntil, status })
    }

    async deleteNotification(id: string): Promise<void> {
      return invoke('delete_notification', { id })
    }

    async cleanupNotifications(timestamp: number): Promise<void> {
      return invoke('cleanup_notifications', { timestamp })
    }

    async markAllNotificationsRead(): Promise<void> {
      return invoke('mark_all_notifications_read')
    }

    async getNotificationSettings(): Promise<NotificationSettings> {
      return invoke('get_notification_settings')
    }

    async saveNotificationSettings(config: NotificationSettings): Promise<void> {
      return invoke('save_notification_settings', { config })
    }

    async checkAndFire(): Promise<Notification[]> {
      return invoke('check_and_fire')
    }

    async syncPayloadForBlock(blockId: string): Promise<void> {
      return invoke('sync_payload_for_block', { blockId })
    }

    async queryDateRefs(kind: string, from: string, to: string): Promise<DateRefRecord[]> {
      return parseJsonResult(await invoke('query_date_refs', { kind, from, to }))
    }

    async queryOverdueDateRefs(today: string): Promise<DateRefRecord[]> {
      return parseJsonResult(await invoke('query_overdue_date_refs', { today }))
    }

    async getDateRefsByBlock(blockId: string): Promise<DateRefRecord[]> {
      return parseJsonResult(await invoke('get_date_refs_by_block', { blockId }))
    }

    async getDateRefsByPage(pageId: string): Promise<[string, DateRefRecord[]][]> {
      return parseJsonResult(await invoke('get_date_refs_by_page', { pageId }))
    }

    async getPageWithBlocks(pageId: string): Promise<PageWithBlocks> {
      return parseJsonResult(await invoke('get_page_with_blocks', { pageId }))
    }

    async getPagesWithBlocks(pageIds: string[]): Promise<PageWithBlocks[]> {
      return parseJsonResult(await invoke('get_pages_with_blocks', { pageIds }))
    }

    async queryDueNonRecurringDateRefs(nowMs: number): Promise<DateRefRecord[]> {
      return parseJsonResult(await invoke('query_due_non_recurring_date_refs', { nowMs }))
    }

    async queryAllRecurringDateRefs(): Promise<DateRefRecord[]> {
      return parseJsonResult(await invoke('query_all_recurring_date_refs'))
    }

    async queryIncompleteTasks(): Promise<IncompleteTask[]> {
      return parseJsonResult(await invoke('query_incomplete_tasks'))
    }

    async batchCheckAndFireData(nowMs: number): Promise<TauriBatchCheckAndFireData> {
      return parseJsonResult(await invoke('batch_check_and_fire_data', { nowMs }))
    }

    async rebuildDateRefs(): Promise<{ rebuilt: number }> {
      return parseJsonResult(await invoke('rebuild_date_refs'))
    }

    async buildGraphSnapshot(): Promise<TauriGraphEdgeRecord[]> {
      return invoke('build_graph_snapshot')
    }

    // ---- S3/S6 Rust content-parser commands（直通） ----
    async parseDateInput(input: string): Promise<string | null> {
      return invoke('parse_date_input', { input })
    }

    async normalizeJournalTitle(title: string): Promise<string | null> {
      return invoke('normalize_journal_title', { title })
    }

    async isTodayTitle(normalizedTitle: string): Promise<boolean> {
      return invoke('is_today_title', { normalizedTitle })
    }

    async extractLinksFromContent(content: string): Promise<LinkDraft[]> {
      return invoke('extract_links_from_content', { content })
    }

    async applyRelationshipTypeToBlockContent(content: string, targetTitle: string, newRelationshipType: string | null): Promise<string> {
      return invoke('apply_relationship_type_to_block_content', { content, targetTitle, newRelationshipType })
    }

    async calculateNextRecurrence(iso: string, rule: string): Promise<string> {
      return invoke('calculate_next_recurrence', { iso, rule })
    }

    async checkHasTypedLinkToTarget(content: string, targetTitle: string): Promise<{ has_typed_link: boolean }> {
      return invoke('check_has_typed_link_to_target', { content, targetTitle })
    }
  }

class WasmClientAdapter implements CoreClient {
  private wasm: WasmClient

  constructor(wasm: WasmClient) {
    this.wasm = wasm
  }

  async getBlock(blockId: string): Promise<Block> {
    return this.wasm.get_block(blockId)
  }

  async getBlocksByPage(pageId: string): Promise<Block[]> {
    return this.wasm.get_blocks_by_page(pageId)
  }

  async getBlockCards(): Promise<BlockCard[]> {
    // WASM 端暂不支持全量投影，返回空数组
    return []
  }

  // ---- Saved Filters ----
  async getSavedFilters(): Promise<SavedFilterRust[]> {
    return []
  }

  async saveSavedFilter(_name: string, _queryJson: string): Promise<SavedFilterRust> {
    throw new Error('WASM: saved filters not supported')
  }

  async updateSavedFilter(_id: string, _name: string, _queryJson: string): Promise<SavedFilterRust> {
    throw new Error('WASM: saved filters not supported')
  }

  async deleteSavedFilter(_id: string): Promise<void> {
    throw new Error('WASM: saved filters not supported')
  }

  // ---- Book highlights & progress（ADR-0040：仅桌面本地，不入 SyncTable） ----
  async upsertBookHighlight(highlight: BookHighlightRust): Promise<BookHighlightRust> {
    return this.wasm.upsert_book_highlight(JSON.stringify(highlight))
  }

  async deleteBookHighlight(id: string): Promise<void> {
    await this.wasm.delete_book_highlight(id)
  }

  async getBookHighlights(bookPageId: string): Promise<BookHighlightRust[]> {
    return this.wasm.get_book_highlights(bookPageId)
  }

  async getBookProgress(bookPageId: string): Promise<BookProgressRust | null> {
    return this.wasm.get_book_progress(bookPageId)
  }

  async upsertBookProgress(bookPageId: string, cfi: string): Promise<BookProgressRust> {
    return this.wasm.upsert_book_progress(bookPageId, cfi)
  }

  // ---- Screens & Tabs（两级层级，WASM 暂不支持） ----
  async getScreenViews(_entity: string): Promise<ScreenViewRust[]> {
    return []
  }

  async createScreen(_entity: string, _name: string, _viewType: string, _sortOrder: number, _config: string): Promise<ScreenViewRust> {
    throw new Error('WASM: screens not supported')
  }

  async createTab(_entity: string, _parentId: string, _name: string, _viewType: string, _queryJson: string, _sortOrder: number, _config: string): Promise<ScreenViewRust> {
    throw new Error('WASM: tabs not supported')
  }

  async updateScreen(_id: string, _name: string, _viewType: string, _config: string): Promise<ScreenViewRust> {
    throw new Error('WASM: screens not supported')
  }

  async updateTab(_id: string, _name: string, _viewType: string, _queryJson: string, _config: string): Promise<ScreenViewRust> {
    throw new Error('WASM: tabs not supported')
  }

  async deleteScreen(_id: string): Promise<void> {
    throw new Error('WASM: screens not supported')
  }

  async deleteScreenView(_id: string): Promise<void> {
    throw new Error('WASM: screens not supported')
  }

  async setDefaultScreen(_id: string): Promise<ScreenViewRust> {
    throw new Error('WASM: screens not supported')
  }

  async saveBlockTree(blocks: BlockUpdate[]): Promise<BlockSaveResult[]> {
    const blocksJson = JSON.stringify(blocks)
    const result = await this.wasm.save_block_tree(blocksJson)
    return parseJsonResult(result)
  }

  async deleteBlock(blockId: string): Promise<void> {
    const opsJson = JSON.stringify([{
      entity: 'block',
      action: 'delete',
      params: { id: blockId }
    }])
    await this.wasm.execute_batch(opsJson)
  }

  async getPage(pageId: string): Promise<Page> {
    return this.wasm.get_page(pageId)
  }

  async getAllPages(): Promise<Page[]> {
    return this.wasm.get_all_pages()
  }

  async getTrashPages(): Promise<Page[]> {
    return this.wasm.get_trash_pages()
  }

  async getIdeasPagesByMonth(year: number, month: number): Promise<Page[]> {
    return this.wasm.get_ideas_pages_by_month(year, month)
  }

  async getIdeasMonths(): Promise<string[]> {
    // WASM fallback: 从 get_all_pages 结果中提取月份
    const allPages = await this.wasm.get_all_pages()
    const months = Array.from(new Set(
      allPages
        .filter(p => (p.type === 'ideas') && p.deleted === 0)
        .map(p => p.title.slice(0, 7))
    ))
    months.sort((a, b) => b.localeCompare(a))
    return months
  }

  async ensureTodayIdeasPage(): Promise<Page> {
    // 共享幂等逻辑在 Rust（PageService::ensure_today_ideas_page）；
    // chrono `wasmbind` feature 下 Local 使用浏览器本地时区（ADR-0021）。
    return this.wasm.ensure_today_ideas_page()
  }

  async savePage(page: PageUpdate): Promise<Page> {
    const pageJson = JSON.stringify(page)
    const result = await this.wasm.save_page(pageJson)
    return parseJsonResult(result)
  }

  async deletePageCascade(pageId: string): Promise<void> {
    return this.wasm.delete_page_cascade(pageId)
  }

  async getBacklinks(pageId: string): Promise<Link[]> {
    return this.wasm.get_backlinks(pageId)
  }

  async getOutlinks(pageId: string): Promise<Link[]> {
    return this.wasm.get_outlinks(pageId)
  }

  async getProperties(blockId: string): Promise<Property[]> {
    return this.wasm.get_properties(blockId)
  }

  async setProperty(blockId: string, key: string, value: string, type: string): Promise<Property> {
    return this.wasm.set_property(blockId, key, value, type)
  }

  async deleteProperty(blockId: string, key: string): Promise<void> {
    return this.wasm.delete_property(blockId, key)
  }

  async getRelationshipTypes(): Promise<RelationshipType[]> {
    return this.wasm.get_relationship_types()
  }

  async getTemplates(): Promise<UserTemplate[]> {
    const opsJson = JSON.stringify([{
      entity: 'template',
      action: 'get',
      params: {}
    }])
    const results = await this.wasm.execute_batch(opsJson)
    // execute_batch 返回每个 op 的结果作为数组元素；template get 返回 UserTemplate[]，
    // 因此外层 results 是 [[template1, template2, ...]]，需要取首元素。
    const first = Array.isArray(results) ? results[0] : results
    return (first as unknown as UserTemplate[]) || []
  }

  async search(query: string): Promise<SearchResult[]> {
    return this.wasm.search(query)
  }

  async executeBatch(operations: BatchOperation[]): Promise<BatchResult[]> {
    const opsJson = JSON.stringify(operations)
    const result = await this.wasm.execute_batch(opsJson)
    return parseJsonResult(result)
  }

  async createBlockVersion(blockId: string, snapshot: string, hash: string, reason: string, checkpointName?: string): Promise<BlockVersion> {
    return this.wasm.create_block_version(blockId, snapshot, hash, reason, checkpointName)
  }

  async getBlockVersions(blockId: string): Promise<BlockVersion[]> {
    return this.wasm.get_block_versions(blockId)
  }

  async getBlockVersionById(id: string): Promise<BlockVersion> {
    return this.wasm.get_block_version_by_id(id)
  }

  async restoreBlockVersion(versionId: string): Promise<BlockVersion> {
    return this.wasm.restore_block_version(versionId)
  }

  async deleteBlockVersion(versionId: string): Promise<void> {
    await this.wasm.delete_block_version(versionId)
  }

  async cleanupBlockVersions(retentionDays: number): Promise<void> {
    await this.wasm.cleanup_block_versions(retentionDays)
  }

  async getNotification(id: string): Promise<Notification> {
    return this.wasm.get_notification(id)
  }

  async getNotificationsByBlock(blockId: string): Promise<Notification[]> {
    return this.wasm.get_notifications_by_block(blockId)
  }

  async queryUnreadNotifications(): Promise<Notification[]> {
    return this.wasm.query_unread_notifications()
  }

  async queryRecentNotifications(limit: number): Promise<Notification[]> {
    return this.wasm.query_recent_notifications(limit)
  }

  async createNotification(notification: Notification): Promise<Notification> {
    return this.wasm.create_notification(JSON.stringify(notification))
  }

  async batchCreateNotifications(notifications: Notification[]): Promise<Notification[]> {
    return this.wasm.batch_create_notifications(JSON.stringify(notifications))
  }

  async updateNotificationStatus(id: string, status: string): Promise<Notification> {
    return this.wasm.update_notification_status(id, status)
  }

  async updateNotificationPayload(id: string, payload: string): Promise<Notification> {
    return this.wasm.update_notification_payload(id, payload)
  }

  async setNotificationSnooze(id: string, snoozeUntil: number, status: string): Promise<Notification> {
    return this.wasm.set_notification_snooze(id, snoozeUntil, status)
  }

  async deleteNotification(id: string): Promise<void> {
    await this.wasm.delete_notification(id)
  }

  async cleanupNotifications(timestamp: number): Promise<void> {
    await this.wasm.cleanup_notifications(timestamp)
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.wasm.mark_all_notifications_read()
  }

  async getNotificationSettings(): Promise<NotificationSettings> {
    throw new Error('NotificationSettings not available on web')
  }

  async saveNotificationSettings(_config: NotificationSettings): Promise<void> {
    throw new Error('NotificationSettings not available on web')
  }

  async checkAndFire(): Promise<Notification[]> {
    // Web: notification engine requires Rust backend, return empty
    return []
  }

  async syncPayloadForBlock(_blockId: string): Promise<void> {
    // Web: notification engine requires Rust backend, no-op
  }

  async getPageWithBlocks(_pageId: string): Promise<PageWithBlocks> {
    // WASM 端暂不支持
    return { page: {} as Page, blocks: [] }
  }

  async getPagesWithBlocks(_pageIds: string[]): Promise<PageWithBlocks[]> {
    // Web 模式历史面板依赖 Rust 后端，返回空数组（无数据则历史列表为空状态）
    return []
  }

  async queryDateRefs(kind: string, from: string, to: string): Promise<DateRefRecord[]> {
    return this.wasm.query_date_refs(kind, from, to)
  }

  async queryOverdueDateRefs(today: string): Promise<DateRefRecord[]> {
    return this.wasm.query_overdue_date_refs(today)
  }

  async getDateRefsByBlock(blockId: string): Promise<DateRefRecord[]> {
    return this.wasm.get_date_refs_by_block(blockId)
  }

  async getDateRefsByPage(_pageId: string): Promise<[string, DateRefRecord[]][]> {
    // WASM 端暂不支持，返回空数组
    return []
  }

  async queryDueNonRecurringDateRefs(nowMs: number): Promise<DateRefRecord[]> {
    return this.wasm.query_due_non_recurring_date_refs(nowMs)
  }

  async queryAllRecurringDateRefs(): Promise<DateRefRecord[]> {
    return this.wasm.query_all_recurring_date_refs()
  }
  async queryIncompleteTasks(): Promise<IncompleteTask[]> {
    // WASM 端暂不支持，返回空数组
    return []
  }
  async batchCheckAndFireData(_nowMs: number): Promise<TauriBatchCheckAndFireData> {
    // WASM client doesn't support batch check-and-fire; return empty
    return {
      recurring_refs: [],
      due_non_recurring: [],
      blocks: [],
      pages: [],
      notifications: [],
    }
  }

  async buildGraphSnapshot(): Promise<TauriGraphEdgeRecord[]> {
    // WASM client doesn't support graph snapshot; return empty
    return []
  }

  async rebuildDateRefs(): Promise<{ rebuilt: number }> {
    return this.wasm.rebuild_date_refs()
  }

  // ---- S3/S6 Rust content-parser commands（WASM 无对应命令，web 不可用） ----
  async parseDateInput(_input: string): Promise<string | null> {
    throw new Error('WASM: parse_date_input not supported')
  }

  async normalizeJournalTitle(_title: string): Promise<string | null> {
    throw new Error('WASM: normalize_journal_title not supported')
  }

  async isTodayTitle(_normalizedTitle: string): Promise<boolean> {
    throw new Error('WASM: is_today_title not supported')
  }

  async extractLinksFromContent(_content: string): Promise<LinkDraft[]> {
    throw new Error('WASM: extract_links_from_content not supported')
  }

  async applyRelationshipTypeToBlockContent(_content: string, _targetTitle: string, _newRelationshipType: string | null): Promise<string> {
    throw new Error('WASM: apply_relationship_type_to_block_content not supported')
  }

  async calculateNextRecurrence(_iso: string, _rule: string): Promise<string> {
    throw new Error('WASM: calculate_next_recurrence not supported')
  }

  async checkHasTypedLinkToTarget(_content: string, _targetTitle: string): Promise<{ has_typed_link: boolean }> {
    throw new Error('WASM: check_has_typed_link_to_target not supported')
  }
}

let coreClient: CoreClient | null = null

export async function initCoreClient(): Promise<CoreClient> {
  if (coreClient) return coreClient

  if (isTauriEnvironment()) {
    coreClient = new TauriClient()
    console.info('[CoreClient] Using Tauri Command client')
  } else {
    const wasm = await initWasmClient()
    coreClient = new WasmClientAdapter(wasm)
    console.info('[CoreClient] Using WASM client')
  }

  return coreClient
}

export function getCoreClient(): CoreClient | null {
  return coreClient
}

export async function getWorkspacePath(): Promise<string> {
  if (isTauriEnvironment()) {
    return invoke('get_workspace_path')
  }
  return Promise.resolve('Web: IndexedDB')
}

export async function setWorkspacePath(path: string): Promise<string> {
  if (isTauriEnvironment()) {
    return invoke('set_workspace_path', { path })
  }
  throw new Error('Workspace path setting is only available in desktop app')
}

export async function resetWorkspacePath(): Promise<string> {
  if (isTauriEnvironment()) {
    return invoke('reset_workspace_path')
  }
  throw new Error('Workspace path setting is only available in desktop app')
}

export async function openWorkspacePath(): Promise<void> {
  if (isTauriEnvironment()) {
    return invoke('open_workspace_path')
  }
  throw new Error('Opening workspace path is only available in desktop app')
}

export async function exportToMarkdown(): Promise<ExportResult> {
  if (isTauriEnvironment()) {
    return invoke('export_to_markdown')
  }
  throw new Error('Markdown export is only available in desktop app')
}

export async function importFromMarkdown(strategy: string): Promise<ImportResult> {
  if (isTauriEnvironment()) {
    return invoke('import_from_markdown', { strategy })
  }
  throw new Error('Markdown import is only available in desktop app')
}

export async function getSyncConfig(): Promise<SyncConfig> {
  if (isTauriEnvironment()) {
    return invoke('get_sync_config')
  }
  return Promise.resolve({
    sync_enabled: false,
    sync_interval_secs: 300,
  })
}

export async function setSyncConfig(
  enabled: boolean,
  intervalSecs?: number
): Promise<void> {
  if (isTauriEnvironment()) {
    return invoke('set_sync_config', { enabled, intervalSecs })
  }
  throw new Error('Sync config is only available in desktop app')
}

export async function syncNow(): Promise<ExportResult> {
  if (isTauriEnvironment()) {
    return invoke('sync_now')
  }
  throw new Error('Sync is only available in desktop app')
}

export async function triggerSync(): Promise<ExportResult> {
  if (isTauriEnvironment()) {
    return invoke('trigger_sync')
  }
  throw new Error('Sync is only available in desktop app')
}

export async function getSyncQr(): Promise<string> {
  if (isTauriEnvironment()) {
    return invoke('get_sync_qr')
  }
  throw new Error('Device sync is only available in desktop app')
}

export interface PairedDevice {
  client_id: string
  peer_device_name: string
  last_sync_at: number
  paired_at: number | null
}

export async function getPairedDevices(): Promise<PairedDevice[]> {
  if (isTauriEnvironment()) {
    return invoke('get_paired_devices')
  }
  return Promise.resolve([])
}

export async function unpairDevice(clientId: string): Promise<void> {
  if (isTauriEnvironment()) {
    return invoke('unpair_device', { clientId })
  }
  throw new Error('Device sync is only available in desktop app')
}

export async function triggerFullSync(): Promise<void> {
  if (isTauriEnvironment()) {
    return invoke('trigger_full_sync')
  }
  throw new Error('Device sync is only available in desktop app')
}