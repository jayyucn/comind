import { isTauriEnvironment } from './tauri-client'
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
  UserTemplate, SearchResult, BlockUpdate, PageUpdate,
  BatchOperation, BatchResult, ExportResult, ImportResult, SyncConfig, BlockVersion,
  Notification
} from './types'

export interface CoreClient {
  getBlock(blockId: string): Promise<Block>
  getBlocksByPage(pageId: string): Promise<Block[]>
  saveBlockTree(blocks: BlockUpdate[]): Promise<Block[]>
  deleteBlock(blockId: string): Promise<void>

  getPage(pageId: string): Promise<Page>
  getAllPages(): Promise<Page[]>
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
  setNotificationSnooze(id: string, snoozeUntil: number, status: string): Promise<Notification>
  deleteNotification(id: string): Promise<void>
  cleanupNotifications(timestamp: number): Promise<void>
  markAllNotificationsRead(): Promise<void>
}

class TauriClient implements CoreClient {
  async getBlock(blockId: string): Promise<Block> {
    return tauri.tauriGetBlock(blockId)
  }

  async getBlocksByPage(pageId: string): Promise<Block[]> {
    return tauri.tauriGetBlocksByPage(pageId)
  }

  async saveBlockTree(blocks: BlockUpdate[]): Promise<Block[]> {
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

  async saveBlockTree(blocks: BlockUpdate[]): Promise<Block[]> {
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
    return results as unknown as UserTemplate[]
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

export async function setDbPath(path: string): Promise<string> {
  if (isTauriEnvironment()) {
    return tauri.tauriSetDbPath(path)
  }
  throw new Error('Database path setting is only available in desktop app')
}

export async function resetDbPath(): Promise<string> {
  if (isTauriEnvironment()) {
    return tauri.tauriResetDbPath()
  }
  throw new Error('Database path setting is only available in desktop app')
}

export async function exportToMarkdown(directory: string): Promise<ExportResult> {
  if (isTauriEnvironment()) {
    return tauri.tauriExportToMarkdown(directory)
  }
  throw new Error('Markdown export is only available in desktop app')
}

export async function importFromMarkdown(directory: string, strategy: string): Promise<ImportResult> {
  if (isTauriEnvironment()) {
    return tauri.tauriImportFromMarkdown(directory, strategy)
  }
  throw new Error('Markdown import is only available in desktop app')
}

export async function getSyncConfig(): Promise<SyncConfig> {
  if (isTauriEnvironment()) {
    return tauri.tauriGetSyncConfig()
  }
  return Promise.resolve({
    sync_enabled: false,
    sync_directory: null,
    sync_interval_secs: 300,
  })
}

export async function setSyncConfig(
  enabled: boolean,
  directory?: string,
  intervalSecs?: number
): Promise<void> {
  if (isTauriEnvironment()) {
    return tauri.tauriSetSyncConfig(enabled, directory, intervalSecs)
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