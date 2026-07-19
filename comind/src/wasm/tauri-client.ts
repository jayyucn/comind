import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import type {
  Block, Page, Property, Link, RelationshipType,
  UserTemplate, SearchResult, BlockUpdate, PageUpdate,
  BatchOperation, BatchResult, ExportResult, ImportResult, SyncConfig, BlockVersion,
  Notification, DateRefRecord
} from './types'

export function isTauriEnvironment(): boolean {
  return isTauri()
}

export async function tauriGetBlock(blockId: string): Promise<Block> {
  return invoke('get_block', { blockId })
}

export async function tauriGetBlocksByPage(pageId: string): Promise<Block[]> {
  return invoke('get_blocks_by_page', { pageId })
}

export async function tauriSaveBlockTree(blocks: BlockUpdate[]): Promise<Block[]> {
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

export async function tauriSetDbPath(path: string): Promise<string> {
  return invoke('set_db_path', { path })
}

export async function tauriResetDbPath(): Promise<string> {
  return invoke('reset_db_path')
}

export async function tauriPickDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择数据库目录',
  })
  if (typeof selected === 'string') {
    return selected
  }
  return null
}

export async function tauriExportToMarkdown(directory: string): Promise<ExportResult> {
  return invoke('export_to_markdown', { directory })
}

export async function tauriImportFromMarkdown(directory: string, strategy: string): Promise<ImportResult> {
  return invoke('import_from_markdown', { directory, strategy })
}

export async function tauriGetSyncConfig(): Promise<SyncConfig> {
  return invoke('get_sync_config')
}

export async function tauriSetSyncConfig(
  enabled: boolean,
  directory?: string,
  intervalSecs?: number
): Promise<void> {
  return invoke('set_sync_config', { enabled, directory, intervalSecs })
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

export async function tauriRebuildDateRefs(): Promise<{ rebuilt: number }> {
  return invoke('rebuild_date_refs')
}