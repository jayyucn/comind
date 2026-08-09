import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import type {
  Block, BlockSaveResult, Page, Property, Link, RelationshipType,
  UserTemplate, SearchResult, BlockUpdate, PageUpdate,
  BatchOperation, BatchResult, ExportResult, ImportResult, SyncConfig, BlockVersion,
  Notification, DateRefRecord, IncompleteTask, BlockCard, SavedFilterRust, TaskViewRust,
  NotificationSettings,
  LinkDraft
} from './types'

export function isTauriEnvironment(): boolean {
  return isTauri()
}

/** 是否运行在 Android 端（同步初步检测，基于 UA） */
export function isAndroidPlatformSync(): boolean {
  if (!isTauri()) return false
  if (typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)) return true
  return false
}

/** 是否运行在 Android 端（基于 Tauri os 插件，可靠检测） */
export async function isAndroidPlatform(): Promise<boolean> {
  if (!isTauri()) return false
  try {
    return await platform() === 'android'
  } catch {
    return false
  }
}

export async function tauriGetBlock(blockId: string): Promise<Block> {
  return invoke('get_block', { blockId })
}

export async function tauriGetBlocksByPage(pageId: string): Promise<Block[]> {
  return invoke('get_blocks_by_page', { pageId })
}

export async function tauriGetBlockCards(): Promise<BlockCard[]> {
  return invoke('get_block_cards')
}

// ---- Saved Filters ----

export async function tauriGetSavedFilters(): Promise<SavedFilterRust[]> {
  return invoke('get_saved_filters')
}

export async function tauriSaveSavedFilter(name: string, queryJson: string): Promise<SavedFilterRust> {
  return invoke('save_saved_filter', { name, queryJson })
}

export async function tauriUpdateSavedFilter(id: string, name: string, queryJson: string): Promise<SavedFilterRust> {
  return invoke('update_saved_filter', { id, name, queryJson })
}

export async function tauriDeleteSavedFilter(id: string): Promise<void> {
  return invoke('delete_saved_filter', { id })
}

// ---- Task Views ----

export async function tauriGetTaskViews(): Promise<TaskViewRust[]> {
  return invoke('get_task_views')
}

export async function tauriSaveTaskView(name: string, queryJson: string, viewType: string, groupBy: string): Promise<TaskViewRust> {
  return invoke('save_task_view', { name, queryJson, viewType, groupBy })
}

export async function tauriUpdateTaskView(id: string, name: string, queryJson: string, viewType: string, groupBy: string, isDefault: boolean, sortOrder: number): Promise<TaskViewRust> {
  return invoke('update_task_view', { id, name, queryJson, viewType, groupBy, isDefault, sortOrder })
}

export async function tauriDeleteTaskView(id: string): Promise<void> {
  return invoke('delete_task_view', { id })
}

export async function tauriSetDefaultTaskView(id: string): Promise<TaskViewRust> {
  return invoke('set_default_task_view', { id })
}

export async function tauriSaveBlockTree(blocks: BlockUpdate[]): Promise<BlockSaveResult[]> {
  return invoke('save_block_tree', { blocks })
}

export async function tauriDeleteBlock(blockId: string): Promise<void> {
  return invoke('delete_block', { blockId })
}

export async function tauriGetPage(pageId: string): Promise<Page> {
  return invoke('get_page', { pageId })
}

export async function tauriGetAllPages(): Promise<Page[]> {
  return invoke('get_all_pages')
}

export async function tauriGetIdeasPagesByMonth(year: number, month: number): Promise<Page[]> {
  return invoke('get_ideas_pages_by_month', { year, month })
}

/** 获取所有有 ideas 页面的月份列表（yyyy-MM 格式，倒序） */
export async function tauriGetIdeasMonths(): Promise<string[]> {
  return invoke('get_ideas_months')
}

/** 幂等地获取或创建今日 Ideas 页面（Rust 端为单一事实来源） */
export async function tauriEnsureTodayIdeasPage(): Promise<Page> {
  return invoke('ensure_today_ideas_page')
}

export async function tauriSavePage(page: PageUpdate): Promise<Page> {
  return invoke('save_page', { page })
}

export async function tauriDeletePageCascade(pageId: string): Promise<void> {
  return invoke('delete_page_cascade', { pageId })
}

export async function tauriGetBacklinks(pageId: string): Promise<Link[]> {
  return invoke('get_backlinks', { pageId })
}

export async function tauriGetOutlinks(pageId: string): Promise<Link[]> {
  return invoke('get_outlinks', { pageId })
}

export async function tauriGetProperties(blockId: string): Promise<Property[]> {
  return invoke('get_properties', { blockId })
}

export async function tauriSetProperty(
  blockId: string,
  key: string,
  value: string,
  type: string
): Promise<Property> {
  return invoke('set_property', { blockId, key, value, type })
}

export async function tauriDeleteProperty(blockId: string, key: string): Promise<void> {
  return invoke('delete_property', { blockId, key })
}

export async function tauriGetRelationshipTypes(): Promise<RelationshipType[]> {
  return invoke('get_relationship_types')
}

export async function tauriGetTemplates(): Promise<UserTemplate[]> {
  return invoke('get_templates')
}

export async function tauriSearch(query: string): Promise<SearchResult[]> {
  return invoke('search', { query })
}

export async function tauriExecuteBatch(
  operations: BatchOperation[]
): Promise<BatchResult[]> {
  return invoke('execute_batch', { operations })
}

export async function tauriMinimizeWindow(): Promise<void> {
  const window = getCurrentWindow()
  await window.minimize()
}

export async function tauriToggleMaximizeWindow(): Promise<void> {
  const window = getCurrentWindow()
  const isMaximized = await window.isMaximized()
  if (isMaximized) {
    await window.unmaximize()
  } else {
    await window.maximize()
  }
}

export async function tauriCloseWindow(): Promise<void> {
  const window = getCurrentWindow()
  await window.close()
}

export async function tauriIsMaximized(): Promise<boolean> {
  const window = getCurrentWindow()
  return window.isMaximized()
}

export async function tauriGetDbPath(): Promise<string> {
  return invoke('get_db_path')
}

export async function tauriGetWorkspacePath(): Promise<string> {
  return invoke('get_workspace_path')
}

export async function tauriSetWorkspacePath(path: string): Promise<string> {
  return invoke('set_workspace_path', { path })
}

export async function tauriResetWorkspacePath(): Promise<string> {
  return invoke('reset_workspace_path')
}

export async function tauriPickDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择工作空间目录',
  })
  if (typeof selected === 'string') {
    return selected
  }
  return null
}

export async function tauriExportToMarkdown(): Promise<ExportResult> {
  return invoke('export_to_markdown')
}

export async function tauriImportFromMarkdown(strategy: string): Promise<ImportResult> {
  return invoke('import_from_markdown', { strategy })
}

export async function tauriGetSyncConfig(): Promise<SyncConfig> {
  return invoke('get_sync_config')
}

export async function tauriSetSyncConfig(
  enabled: boolean,
  intervalSecs?: number
): Promise<void> {
  return invoke('set_sync_config', { enabled, intervalSecs })
}

export async function tauriSyncNow(): Promise<ExportResult> {
  return invoke('sync_now')
}

export async function tauriTriggerSync(): Promise<ExportResult> {
  return invoke('trigger_sync')
}

export async function tauriCreateBlockVersion(
  blockId: string,
  snapshot: string,
  hash: string,
  reason: string,
  checkpointName?: string
): Promise<BlockVersion> {
  return invoke('create_block_version', { blockId, snapshot, hash, reason, checkpointName })
}

export async function tauriGetBlockVersions(blockId: string): Promise<BlockVersion[]> {
  return invoke('get_block_versions', { blockId })
}

export async function tauriGetBlockVersionById(id: string): Promise<BlockVersion> {
  return invoke('get_block_version_by_id', { id })
}

export async function tauriRestoreBlockVersion(versionId: string): Promise<BlockVersion> {
  return invoke('restore_block_version', { versionId })
}

export async function tauriCleanupBlockVersions(retentionDays: number): Promise<void> {
  return invoke('cleanup_block_versions', { retentionDays })
}

export async function tauriDeleteBlockVersion(versionId: string): Promise<void> {
  return invoke('delete_block_version', { versionId })
}

export async function tauriGetNotification(id: string): Promise<Notification> {
  return invoke('get_notification', { id })
}

export async function tauriGetNotificationsByBlock(blockId: string): Promise<Notification[]> {
  return invoke('get_notifications_by_block', { blockId })
}

export async function tauriQueryUnreadNotifications(): Promise<Notification[]> {
  return invoke('query_unread_notifications')
}

export async function tauriQueryRecentNotifications(limit: number): Promise<Notification[]> {
  return invoke('query_recent_notifications', { limit })
}

export async function tauriCreateNotification(notification: Notification): Promise<Notification> {
  return invoke('create_notification', { notification })
}

export async function tauriBatchCreateNotifications(notifications: Notification[]): Promise<Notification[]> {
  return invoke('batch_create_notifications', { notifications })
}

export async function tauriUpdateNotificationStatus(id: string, status: string): Promise<Notification> {
  return invoke('update_notification_status', { id, status })
}

export async function tauriUpdateNotificationPayload(id: string, payload: string): Promise<Notification> {
  return invoke('update_notification_payload', { id, payload })
}

export async function tauriSetNotificationSnooze(id: string, snoozeUntil: number, status: string): Promise<Notification> {
  return invoke('set_notification_snooze', { id, snoozeUntil, status })
}

export async function tauriDeleteNotification(id: string): Promise<void> {
  return invoke('delete_notification', { id })
}

export async function tauriCleanupNotifications(timestamp: number): Promise<void> {
  return invoke('cleanup_notifications', { timestamp })
}

export async function tauriMarkAllNotificationsRead(): Promise<void> {
  return invoke('mark_all_notifications_read')
}

export async function tauriQueryDateRefs(kind: string, from: string, to: string): Promise<DateRefRecord[]> {
  return invoke('query_date_refs', { kind, from, to })
}

export async function tauriQueryOverdueDateRefs(today: string): Promise<DateRefRecord[]> {
  return invoke('query_overdue_date_refs', { today })
}

export async function tauriGetDateRefsByBlock(blockId: string): Promise<DateRefRecord[]> {
  return invoke('get_date_refs_by_block', { blockId })
}

export async function tauriGetDateRefsByPage(pageId: string): Promise<[string, DateRefRecord[]][]> {
  return invoke('get_date_refs_by_page', { pageId })
}

export async function tauriQueryDueNonRecurringDateRefs(nowMs: number): Promise<DateRefRecord[]> {
  return invoke('query_due_non_recurring_date_refs', { nowMs })
}

export async function tauriQueryAllRecurringDateRefs(): Promise<DateRefRecord[]> {
  return invoke('query_all_recurring_date_refs')
}

export async function tauriQueryIncompleteTasks(): Promise<IncompleteTask[]> {
  return invoke('query_incomplete_tasks')
}

export interface TauriBatchCheckAndFireData {
  recurring_refs: DateRefRecord[]
  due_non_recurring: DateRefRecord[]
  blocks: Block[]
  pages: Page[]
  notifications: Notification[]
}

export async function tauriBatchCheckAndFireData(nowMs: number): Promise<TauriBatchCheckAndFireData> {
  return invoke('batch_check_and_fire_data', { nowMs })
}

export interface TauriGraphEdgeRecord {
  link_id: string
  source_page_id: string
  source_page_title: string
  target_page_id: string
  target_page_title: string
  relationship_type: string | null
}

export async function tauriBuildGraphSnapshot(): Promise<TauriGraphEdgeRecord[]> {
  return invoke('build_graph_snapshot')
}

export async function tauriRebuildDateRefs(): Promise<{ rebuilt: number }> {
  return invoke('rebuild_date_refs')
}

export async function tauriGetSyncQr(): Promise<string> {
  return invoke('get_sync_qr')
}

export async function tauriGetPairedDevices(): Promise<{
  client_id: string
  peer_device_name: string
  last_sync_at: number
  paired_at: number | null
}[]> {
  return invoke('get_paired_devices')
}

export async function tauriUnpairDevice(clientId: string): Promise<void> {
  return invoke('unpair_device', { clientId })
}

export async function tauriTriggerFullSync(): Promise<void> {
  return invoke('trigger_full_sync')
}

// ===== Android 端同步命令 =====

export interface SyncPeer {
  client_id: string
  name: string
  ip: string
}

export interface SyncStatus {
  connected: boolean
  paired: boolean
  /** PC 端：已连接对端列表；Android 端：对端信息（可能为空） */
  peers: SyncPeer[]
  /** Android 端：已连接的 PC 名称；PC 端为 null */
  server_name: string | null
}

/** Android 扫码后连接 PC 并配对 */
export async function tauriConnectToServer(qrPayload: string): Promise<void> {
  return invoke('connect_to_server', { qrPayload })
}

/** Android: 从 DB 恢复已配对设备连接（App 启动时调用） */
export async function tauriAutoReconnect(): Promise<boolean> {
  return invoke('auto_reconnect')
}

/** Android 断开同步连接 */
export async function tauriDisconnectSync(): Promise<void> {
  return invoke('disconnect_sync')
}

/** 获取当前同步状态（Android 端） */
export async function tauriGetSyncStatus(): Promise<SyncStatus> {
  return invoke('get_sync_status')
}

/** PC 端：获取同步状态（服务端内存态，含已连接对端） */
export async function tauriGetSyncStatusPC(): Promise<SyncStatus> {
  return invoke('get_sync_status')
}

/** Android 手动触发全量同步 */
export async function tauriTriggerFullSyncMobile(): Promise<void> {
  return invoke('trigger_full_sync_mobile')
}

// ---- Notification Settings (migrated to Rust) ----

export async function tauriGetNotificationSettings(): Promise<NotificationSettings> {
  return invoke('get_notification_settings')
}

export async function tauriSaveNotificationSettings(config: NotificationSettings): Promise<void> {
  return invoke('save_notification_settings', { config })
}

export async function tauriCheckAndFire(): Promise<Notification[]> {
  return invoke('check_and_fire')
}

export async function tauriSyncPayloadForBlock(blockId: string): Promise<void> {
  return invoke('sync_payload_for_block', { blockId })
}

// ---- Content parse helpers (S3: migrated from TS parser to Rust) ----

export async function tauriExtractLinksFromContent(
  content: string
): Promise<LinkDraft[]> {
  return invoke('extract_links_from_content', { content })
}

export async function tauriApplyRelationshipTypeToBlockContent(
  content: string,
  targetTitle: string,
  newRelationshipType: string | null
): Promise<string> {
  return invoke('apply_relationship_type_to_block_content', { content, targetTitle, newRelationshipType })
}

export async function tauriCheckHasTypedLinkToTarget(
  content: string,
  targetTitle: string
): Promise<{ has_typed_link: boolean }> {
  return invoke('check_has_typed_link_to_target', { content, targetTitle })
}

// ---- S6: date-parser / recurrence / journal-detect ----
export async function tauriParseDateInput(input: string): Promise<string | null> {
  return invoke('parse_date_input', { input })
}

export async function tauriParseDateTimeInput(input: string): Promise<{ date: string; time?: string } | null> {
  return invoke('parse_date_time_input', { input })
}

export async function tauriCalculateNextRecurrence(iso: string, rule: string): Promise<string> {
  return invoke('calculate_next_recurrence', { iso, rule })
}

export async function tauriIsJournalTitle(title: string): Promise<boolean> {
  return invoke('is_journal_title', { title })
}

export async function tauriNormalizeJournalTitle(title: string): Promise<string | null> {
  return invoke('normalize_journal_title', { title })
}

export async function tauriIsTodayTitle(normalizedTitle: string): Promise<boolean> {
  return invoke('is_today_title', { normalizedTitle })
}

// ---- S10: Render segments (get_page_with_blocks) ----
export async function tauriGetPageWithBlocks(pageId: string): Promise<any> {
  return invoke('get_page_with_blocks', { pageId })
}
