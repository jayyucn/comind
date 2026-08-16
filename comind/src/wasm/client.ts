import { isTauriEnvironment } from './tauri-client'
export { isTauriEnvironment } from './tauri-client'
import { initWasmClient, type WasmClient } from './wasm-client'
import * as tauri from './tauri-client'
import {
  createWebBlockVersion,
  getWebBlockVersions,
  getWebBlockVersionById,
  restoreWebBlockVersion,
  deleteWebBlockVersion,
  cleanupWebBlockVersions
} from './web-version-storage'
import {
  getWebNotification,
  getWebNotificationsByBlock,
  queryWebUnreadNotifications,
  queryWebRecentNotifications,
  createWebNotification,
  batchCreateWebNotifications,
  updateWebNotificationStatus,
  updateWebNotificationPayload,
  setWebNotificationSnooze,
  deleteWebNotification,
  cleanupWebNotifications,
  markAllWebNotificationsRead
} from './web-notification-storage'

function parseJsonResult<T>(result: any): T {
  if (typeof result === 'string') {
    return JSON.parse(result) as T
  }
  return result as T
}
import type {
  Block, Page, Property, Link, RelationshipType,
  UserTemplate, SearchResult, BlockUpdate, BlockSaveResult, PageUpdate,
  BatchOperation, BatchResult, ExportResult, ImportResult, SyncConfig, BlockVersion,
  Notification, DateRefRecord, IncompleteTask, BlockCard, SavedFilterRust, TaskViewRust,
  NotificationSettings, PageWithBlocks
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
  batchCheckAndFireData(nowMs: number): Promise<tauri.TauriBatchCheckAndFireData>
  rebuildDateRefs(): Promise<{ rebuilt: number }>
  buildGraphSnapshot(): Promise<tauri.TauriGraphEdgeRecord[]>

  getBlockCards(): Promise<BlockCard[]>

  // Saved Filters
  getSavedFilters(): Promise<SavedFilterRust[]>
  saveSavedFilter(name: string, queryJson: string): Promise<SavedFilterRust>
  updateSavedFilter(id: string, name: string, queryJson: string): Promise<SavedFilterRust>
  deleteSavedFilter(id: string): Promise<void>

  // Task Views
  getTaskViews(): Promise<TaskViewRust[]>
  saveTaskView(name: string, queryJson: string, viewType: string, groupBy: string): Promise<TaskViewRust>
  updateTaskView(id: string, name: string, queryJson: string, viewType: string, groupBy: string, isDefault: boolean, sortOrder: number): Promise<TaskViewRust>
  deleteTaskView(id: string): Promise<void>
  setDefaultTaskView(id: string): Promise<TaskViewRust>
}

class TauriClient implements CoreClient {
  async getBlock(blockId: string): Promise<Block> {
    return tauri.tauriGetBlock(blockId)
  }

  async getBlocksByPage(pageId: string): Promise<Block[]> {
    return tauri.tauriGetBlocksByPage(pageId)
  }

  async getBlockCards(): Promise<BlockCard[]> {
    return tauri.tauriGetBlockCards()
  }

  // ---- Saved Filters ----
  async getSavedFilters(): Promise<SavedFilterRust[]> {
    return tauri.tauriGetSavedFilters()
  }

  async saveSavedFilter(name: string, queryJson: string): Promise<SavedFilterRust> {
    return tauri.tauriSaveSavedFilter(name, queryJson)
  }

  async updateSavedFilter(id: string, name: string, queryJson: string): Promise<SavedFilterRust> {
    return tauri.tauriUpdateSavedFilter(id, name, queryJson)
  }

  async deleteSavedFilter(id: string): Promise<void> {
    return tauri.tauriDeleteSavedFilter(id)
  }

  // ---- Task Views ----
  async getTaskViews(): Promise<TaskViewRust[]> {
    return tauri.tauriGetTaskViews()
  }

  async saveTaskView(name: string, queryJson: string, viewType: string, groupBy: string): Promise<TaskViewRust> {
    return tauri.tauriSaveTaskView(name, queryJson, viewType, groupBy)
  }

  async updateTaskView(id: string, name: string, queryJson: string, viewType: string, groupBy: string, isDefault: boolean, sortOrder: number): Promise<TaskViewRust> {
    return tauri.tauriUpdateTaskView(id, name, queryJson, viewType, groupBy, isDefault, sortOrder)
  }

  async deleteTaskView(id: string): Promise<void> {
    return tauri.tauriDeleteTaskView(id)
  }

  async setDefaultTaskView(id: string): Promise<TaskViewRust> {
    return tauri.tauriSetDefaultTaskView(id)
  }

  async saveBlockTree(blocks: BlockUpdate[]): Promise<BlockSaveResult[]> {
    return tauri.tauriSaveBlockTree(blocks)
  }

  async deleteBlock(blockId: string): Promise<void> {
    return tauri.tauriDeleteBlock(blockId)
  }

  async getPage(pageId: string): Promise<Page> {
    return tauri.tauriGetPage(pageId)
  }

  async getAllPages(): Promise<Page[]> {
    return tauri.tauriGetAllPages()
  }

  async getTrashPages(): Promise<Page[]> {
    return tauri.tauriGetTrashPages()
  }

  async getIdeasPagesByMonth(year: number, month: number): Promise<Page[]> {
    return tauri.tauriGetIdeasPagesByMonth(year, month)
  }

  async getIdeasMonths(): Promise<string[]> {
    return tauri.tauriGetIdeasMonths()
  }

  async ensureTodayIdeasPage(): Promise<Page> {
    return tauri.tauriEnsureTodayIdeasPage()
  }

  async savePage(page: PageUpdate): Promise<Page> {
    return tauri.tauriSavePage(page)
  }

  async deletePageCascade(pageId: string): Promise<void> {
    return tauri.tauriDeletePageCascade(pageId)
  }

  async getBacklinks(pageId: string): Promise<Link[]> {
    return tauri.tauriGetBacklinks(pageId)
  }

  async getOutlinks(pageId: string): Promise<Link[]> {
    return tauri.tauriGetOutlinks(pageId)
  }

  async getProperties(blockId: string): Promise<Property[]> {
    return tauri.tauriGetProperties(blockId)
  }

  async setProperty(blockId: string, key: string, value: string, type: string): Promise<Property> {
    return tauri.tauriSetProperty(blockId, key, value, type)
  }

  async deleteProperty(blockId: string, key: string): Promise<void> {
    return tauri.tauriDeleteProperty(blockId, key)
  }

  async getRelationshipTypes(): Promise<RelationshipType[]> {
    return tauri.tauriGetRelationshipTypes()
  }

  async getTemplates(): Promise<UserTemplate[]> {
    return tauri.tauriGetTemplates()
  }

  async search(query: string): Promise<SearchResult[]> {
    return tauri.tauriSearch(query)
  }

  async executeBatch(operations: BatchOperation[]): Promise<BatchResult[]> {
    return tauri.tauriExecuteBatch(operations)
  }

  async createBlockVersion(blockId: string, snapshot: string, hash: string, reason: string, checkpointName?: string): Promise<BlockVersion> {
    return tauri.tauriCreateBlockVersion(blockId, snapshot, hash, reason, checkpointName)
  }

  async getBlockVersions(blockId: string): Promise<BlockVersion[]> {
    return tauri.tauriGetBlockVersions(blockId)
  }

  async getBlockVersionById(id: string): Promise<BlockVersion> {
    return tauri.tauriGetBlockVersionById(id)
  }

  async restoreBlockVersion(versionId: string): Promise<BlockVersion> {
    return tauri.tauriRestoreBlockVersion(versionId)
  }

  async deleteBlockVersion(versionId: string): Promise<void> {
      return tauri.tauriDeleteBlockVersion(versionId)
    }

    async cleanupBlockVersions(retentionDays: number): Promise<void> {
      return tauri.tauriCleanupBlockVersions(retentionDays)
    }

    async getNotification(id: string): Promise<Notification> {
      return tauri.tauriGetNotification(id)
    }

    async getNotificationsByBlock(blockId: string): Promise<Notification[]> {
      return tauri.tauriGetNotificationsByBlock(blockId)
    }

    async queryUnreadNotifications(): Promise<Notification[]> {
      return tauri.tauriQueryUnreadNotifications()
    }

    async queryRecentNotifications(limit: number): Promise<Notification[]> {
      return tauri.tauriQueryRecentNotifications(limit)
    }

    async createNotification(notification: Notification): Promise<Notification> {
      return tauri.tauriCreateNotification(notification)
    }

    async batchCreateNotifications(notifications: Notification[]): Promise<Notification[]> {
      return tauri.tauriBatchCreateNotifications(notifications)
    }

    async updateNotificationStatus(id: string, status: string): Promise<Notification> {
      return tauri.tauriUpdateNotificationStatus(id, status)
    }

    async updateNotificationPayload(id: string, payload: string): Promise<Notification> {
      return tauri.tauriUpdateNotificationPayload(id, payload)
    }

    async setNotificationSnooze(id: string, snoozeUntil: number, status: string): Promise<Notification> {
      return tauri.tauriSetNotificationSnooze(id, snoozeUntil, status)
    }

    async deleteNotification(id: string): Promise<void> {
      return tauri.tauriDeleteNotification(id)
    }

    async cleanupNotifications(timestamp: number): Promise<void> {
      return tauri.tauriCleanupNotifications(timestamp)
    }

    async markAllNotificationsRead(): Promise<void> {
      return tauri.tauriMarkAllNotificationsRead()
    }

    async getNotificationSettings(): Promise<NotificationSettings> {
      return tauri.tauriGetNotificationSettings()
    }

    async saveNotificationSettings(config: NotificationSettings): Promise<void> {
      return tauri.tauriSaveNotificationSettings(config)
    }

    async checkAndFire(): Promise<Notification[]> {
      return tauri.tauriCheckAndFire()
    }

    async syncPayloadForBlock(blockId: string): Promise<void> {
      return tauri.tauriSyncPayloadForBlock(blockId)
    }

    async queryDateRefs(kind: string, from: string, to: string): Promise<DateRefRecord[]> {
      return parseJsonResult(await tauri.tauriQueryDateRefs(kind, from, to))
    }

    async queryOverdueDateRefs(today: string): Promise<DateRefRecord[]> {
      return parseJsonResult(await tauri.tauriQueryOverdueDateRefs(today))
    }

    async getDateRefsByBlock(blockId: string): Promise<DateRefRecord[]> {
      return parseJsonResult(await tauri.tauriGetDateRefsByBlock(blockId))
    }

    async getDateRefsByPage(pageId: string): Promise<[string, DateRefRecord[]][]> {
      return parseJsonResult(await tauri.tauriGetDateRefsByPage(pageId))
    }

    async getPageWithBlocks(pageId: string): Promise<PageWithBlocks> {
      return parseJsonResult(await tauri.tauriGetPageWithBlocks(pageId))
    }

    async getPagesWithBlocks(pageIds: string[]): Promise<PageWithBlocks[]> {
      return parseJsonResult(await tauri.tauriGetPagesWithBlocks(pageIds))
    }

    async queryDueNonRecurringDateRefs(nowMs: number): Promise<DateRefRecord[]> {
      return parseJsonResult(await tauri.tauriQueryDueNonRecurringDateRefs(nowMs))
    }

    async queryAllRecurringDateRefs(): Promise<DateRefRecord[]> {
      return parseJsonResult(await tauri.tauriQueryAllRecurringDateRefs())
    }

    async queryIncompleteTasks(): Promise<IncompleteTask[]> {
      return parseJsonResult(await tauri.tauriQueryIncompleteTasks())
    }

    async batchCheckAndFireData(nowMs: number): Promise<tauri.TauriBatchCheckAndFireData> {
      return parseJsonResult(await tauri.tauriBatchCheckAndFireData(nowMs))
    }

    async rebuildDateRefs(): Promise<{ rebuilt: number }> {
      return parseJsonResult(await tauri.tauriRebuildDateRefs())
    }

    async buildGraphSnapshot(): Promise<tauri.TauriGraphEdgeRecord[]> {
      return tauri.tauriBuildGraphSnapshot()
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

  // ---- Task Views ----
  async getTaskViews(): Promise<TaskViewRust[]> {
    return []
  }

  async saveTaskView(_name: string, _queryJson: string, _viewType: string, _groupBy: string): Promise<TaskViewRust> {
    throw new Error('WASM: task views not supported')
  }

  async updateTaskView(_id: string, _name: string, _queryJson: string, _viewType: string, _groupBy: string, _isDefault: boolean, _sortOrder: number): Promise<TaskViewRust> {
    throw new Error('WASM: task views not supported')
  }

  async deleteTaskView(_id: string): Promise<void> {
    throw new Error('WASM: task views not supported')
  }

  async setDefaultTaskView(_id: string): Promise<TaskViewRust> {
    throw new Error('WASM: task views not supported')
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
    // WASM fallback: TS 端逻辑实现幂等获取或创建
    // (Rust WASM 端 chrono::Local 有时区 bug，见 ADR 0001；此处用浏览器本地时区)
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const allPages = await this.wasm.get_all_pages()
    const existing = allPages.find(
      p => p.title === today && (p.type === 'ideas')
    )
    if (existing) return existing
    // 不存在则创建
    const pageJson = JSON.stringify({ title: today, type: 'ideas' })
    const result = await this.wasm.save_page(pageJson)
    return parseJsonResult<Page>(result)
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
    const wasm = this.wasm as any
    if (typeof wasm.get_outlinks === 'function') {
      return wasm.get_outlinks(pageId)
    }
    return []
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
    return createWebBlockVersion(blockId, snapshot, hash, reason, checkpointName)
  }

  async getBlockVersions(blockId: string): Promise<BlockVersion[]> {
    return getWebBlockVersions(blockId)
  }

  async getBlockVersionById(id: string): Promise<BlockVersion> {
    const version = await getWebBlockVersionById(id)
    if (!version) {
      throw new Error(`Block version not found: ${id}`)
    }
    return version
  }

  async restoreBlockVersion(versionId: string): Promise<BlockVersion> {
    const version = await restoreWebBlockVersion(versionId)
    if (!version) {
      throw new Error(`Block version not found: ${versionId}`)
    }
    return version
  }

  async deleteBlockVersion(versionId: string): Promise<void> {
    await deleteWebBlockVersion(versionId)
  }

  async cleanupBlockVersions(retentionDays: number): Promise<void> {
    return cleanupWebBlockVersions(retentionDays)
  }

  async getNotification(id: string): Promise<Notification> {
    return getWebNotification(id)
  }

  async getNotificationsByBlock(blockId: string): Promise<Notification[]> {
    return getWebNotificationsByBlock(blockId)
  }

  async queryUnreadNotifications(): Promise<Notification[]> {
    return queryWebUnreadNotifications()
  }

  async queryRecentNotifications(limit: number): Promise<Notification[]> {
    return queryWebRecentNotifications(limit)
  }

  async createNotification(notification: Notification): Promise<Notification> {
    return createWebNotification(notification)
  }

  async batchCreateNotifications(notifications: Notification[]): Promise<Notification[]> {
    return batchCreateWebNotifications(notifications)
  }

  async updateNotificationStatus(id: string, status: string): Promise<Notification> {
    return updateWebNotificationStatus(id, status)
  }

  async updateNotificationPayload(id: string, payload: string): Promise<Notification> {
    return updateWebNotificationPayload(id, payload)
  }

  async setNotificationSnooze(id: string, snoozeUntil: number, status: string): Promise<Notification> {
    return setWebNotificationSnooze(id, snoozeUntil, status)
  }

  async deleteNotification(id: string): Promise<void> {
    return deleteWebNotification(id)
  }

  async cleanupNotifications(timestamp: number): Promise<void> {
    return cleanupWebNotifications(timestamp)
  }

  async markAllNotificationsRead(): Promise<void> {
    return markAllWebNotificationsRead()
  }

  async getNotificationSettings(): Promise<NotificationSettings> {
    throw new Error('NotificationSettings not available on web')
  }

  async saveNotificationSettings(config: NotificationSettings): Promise<void> {
    throw new Error('NotificationSettings not available on web')
  }

  async checkAndFire(): Promise<Notification[]> {
    // Web: notification engine requires Rust backend, return empty
    return []
  }

  async syncPayloadForBlock(blockId: string): Promise<void> {
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
  async batchCheckAndFireData(_nowMs: number): Promise<tauri.TauriBatchCheckAndFireData> {
    // WASM client doesn't support batch check-and-fire; return empty
    return {
      recurring_refs: [],
      due_non_recurring: [],
      blocks: [],
      pages: [],
      notifications: [],
    }
  }

  async buildGraphSnapshot(): Promise<tauri.TauriGraphEdgeRecord[]> {
    // WASM client doesn't support graph snapshot; return empty
    return []
  }

  async rebuildDateRefs(): Promise<{ rebuilt: number }> {
    return this.wasm.rebuild_date_refs()
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

export async function getDbPath(): Promise<string> {
  if (isTauriEnvironment()) {
    return tauri.tauriGetDbPath()
  }
  return Promise.resolve('Web: IndexedDB')
}

export async function getWorkspacePath(): Promise<string> {
  if (isTauriEnvironment()) {
    return tauri.tauriGetWorkspacePath()
  }
  return Promise.resolve('Web: IndexedDB')
}

export async function setWorkspacePath(path: string): Promise<string> {
  if (isTauriEnvironment()) {
    return tauri.tauriSetWorkspacePath(path)
  }
  throw new Error('Workspace path setting is only available in desktop app')
}

export async function resetWorkspacePath(): Promise<string> {
  if (isTauriEnvironment()) {
    return tauri.tauriResetWorkspacePath()
  }
  throw new Error('Workspace path setting is only available in desktop app')
}

export async function openWorkspacePath(): Promise<void> {
  if (isTauriEnvironment()) {
    return tauri.tauriOpenWorkspacePath()
  }
  throw new Error('Opening workspace path is only available in desktop app')
}

export async function exportToMarkdown(): Promise<ExportResult> {
  if (isTauriEnvironment()) {
    return tauri.tauriExportToMarkdown()
  }
  throw new Error('Markdown export is only available in desktop app')
}

export async function importFromMarkdown(strategy: string): Promise<ImportResult> {
  if (isTauriEnvironment()) {
    return tauri.tauriImportFromMarkdown(strategy)
  }
  throw new Error('Markdown import is only available in desktop app')
}

export async function getSyncConfig(): Promise<SyncConfig> {
  if (isTauriEnvironment()) {
    return tauri.tauriGetSyncConfig()
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
    return tauri.tauriSetSyncConfig(enabled, intervalSecs)
  }
  throw new Error('Sync config is only available in desktop app')
}

export async function syncNow(): Promise<ExportResult> {
  if (isTauriEnvironment()) {
    return tauri.tauriSyncNow()
  }
  throw new Error('Sync is only available in desktop app')
}

export async function triggerSync(): Promise<ExportResult> {
  if (isTauriEnvironment()) {
    return tauri.tauriTriggerSync()
  }
  throw new Error('Sync is only available in desktop app')
}

export async function getSyncQr(): Promise<string> {
  if (isTauriEnvironment()) {
    return tauri.tauriGetSyncQr()
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
    return tauri.tauriGetPairedDevices()
  }
  return Promise.resolve([])
}

export async function unpairDevice(clientId: string): Promise<void> {
  if (isTauriEnvironment()) {
    return tauri.tauriUnpairDevice(clientId)
  }
  throw new Error('Device sync is only available in desktop app')
}

export async function triggerFullSync(): Promise<void> {
  if (isTauriEnvironment()) {
    return tauri.tauriTriggerFullSync()
  }
  throw new Error('Device sync is only available in desktop app')
}