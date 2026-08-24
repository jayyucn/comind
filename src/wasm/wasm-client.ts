import type {
  Block, Page, Property, Link, RelationshipType,
  SearchResult, BatchResult, DateRefRecord, BlockVersion, Notification
} from './types'

export interface WasmClient {
  get_block(blockId: string): Promise<Block>
  get_blocks_by_page(pageId: string): Promise<Block[]>
  save_block_tree(blocks: string): Promise<Block[]>

  get_page(pageId: string): Promise<Page>
  get_all_pages(): Promise<Page[]>
  get_trash_pages(): Promise<Page[]>
  get_ideas_pages_by_month(year: number, month: number): Promise<Page[]>
  save_page(page: string): Promise<Page>
  delete_page_cascade(pageId: string): Promise<void>

  get_backlinks(pageId: string): Promise<Link[]>

  get_outlinks(pageId: string): Promise<Link[]>

  get_properties(blockId: string): Promise<Property[]>
  set_property(blockId: string, key: string, value: string, type: string): Promise<Property>
  delete_property(blockId: string, key: string): Promise<void>

  get_relationship_types(): Promise<RelationshipType[]>

  search(query: string): Promise<SearchResult[]>

  execute_batch(operations: string): Promise<BatchResult[]>
  query_date_refs(kind: string, from: string, to: string): Promise<DateRefRecord[]>
  query_overdue_date_refs(today: string): Promise<DateRefRecord[]>
  get_date_refs_by_block(block_id: string): Promise<DateRefRecord[]>
  query_due_non_recurring_date_refs(now_ms: number): Promise<DateRefRecord[]>
  query_all_recurring_date_refs(): Promise<DateRefRecord[]>
  rebuild_date_refs(): Promise<{ rebuilt: number }>

  ensure_today_ideas_page(): Promise<Page>

  create_block_version(blockId: string, snapshot: string, hash: string, reason: string, checkpointName?: string): Promise<BlockVersion>
  get_block_versions(blockId: string): Promise<BlockVersion[]>
  get_block_version_by_id(id: string): Promise<BlockVersion>
  restore_block_version(versionId: string): Promise<BlockVersion>
  cleanup_block_versions(retentionDays: number): Promise<void>
  delete_block_version(versionId: string): Promise<void>

  get_notification(id: string): Promise<Notification>
  get_notifications_by_block(blockId: string): Promise<Notification[]>
  query_unread_notifications(): Promise<Notification[]>
  query_recent_notifications(limit: number): Promise<Notification[]>
  create_notification(notification: string): Promise<Notification>
  batch_create_notifications(notifications: string): Promise<Notification[]>
  update_notification_status(id: string, status: string): Promise<Notification>
  update_notification_payload(id: string, payload: string): Promise<Notification>
  set_notification_snooze(id: string, snoozeUntil: number, status: string): Promise<Notification>
  delete_notification(id: string): Promise<void>
  cleanup_notifications(timestamp: number): Promise<void>
  mark_all_notifications_read(): Promise<void>
}

let wasmClient: WasmClient | null = null

async function ensureSqlJsLoaded(): Promise<void> {
  if ((window as any).SQL && typeof (window as any).SQL.Database === 'function') {
    return
  }
  try {
    const sqlModule = await import('sql.js')
    const initSqlJs = sqlModule.default || sqlModule
    if (typeof initSqlJs === 'function') {
      let sqlPath = ''
      try {
        const path = await import('path')
        sqlPath = path.resolve(__dirname, '../../node_modules/sql.js/dist')
      } catch {
        sqlPath = '/node_modules/sql.js/dist'
      }
      ;(window as any).SQL = await initSqlJs({
        locateFile: (file: string) => {
          return `${sqlPath}/${file}`
        }
      })
      return
    }
  } catch (err) {
    console.error('[sql.js] Failed to load from npm:', err)
  }
  throw new Error('sql.js not loaded')
}

function parseJsonResult<T>(result: any): T {
  if (typeof result === 'string') {
    return JSON.parse(result) as T
  }
  return result as T
}

export async function initWasmClient(): Promise<WasmClient> {
  if (wasmClient) return wasmClient

  await ensureSqlJsLoaded()
  const wasmModule = await import('@wasm/comind_wasm')
  
  try {
    await wasmModule.default()
  } catch {
    try {
      const fs = await import('fs')
      const path = await import('path')
      const wasmPath = path.resolve(__dirname, '../../crates/pkg/comind_wasm_bg.wasm')
      const wasmBytes = fs.readFileSync(wasmPath)
      wasmModule.initSync(wasmBytes)
    } catch (err) {
      console.error('[WASM] Failed to load WASM module:', err)
      throw err
    }
  }
  
  await wasmModule.init()

  const client: WasmClient = {
    async get_block(blockId: string): Promise<Block> {
      const result = await wasmModule.get_block(blockId)
      return parseJsonResult<Block>(result)
    },

    async get_blocks_by_page(pageId: string): Promise<Block[]> {
      const result = await wasmModule.get_blocks_by_page(pageId)
      return parseJsonResult<Block[]>(result)
    },

    async save_block_tree(blocks: string): Promise<Block[]> {
      const result = await wasmModule.save_block_tree(blocks)
      return parseJsonResult<Block[]>(result)
    },

    async get_page(pageId: string): Promise<Page> {
      const result = await wasmModule.get_page(pageId)
      return parseJsonResult<Page>(result)
    },

    async get_all_pages(): Promise<Page[]> {
      const result = await wasmModule.get_all_pages()
      return parseJsonResult<Page[]>(result)
    },

    async get_trash_pages(): Promise<Page[]> {
      const result = await wasmModule.get_trash_pages()
      return parseJsonResult<Page[]>(result)
    },

    async get_ideas_pages_by_month(year: number, month: number): Promise<Page[]> {
      const result = await wasmModule.get_ideas_pages_by_month(year, month)
      return parseJsonResult<Page[]>(result)
    },

    async save_page(page: string): Promise<Page> {
      const result = await wasmModule.save_page(page)
      return parseJsonResult<Page>(result)
    },

    async delete_page_cascade(pageId: string): Promise<void> {
      await wasmModule.delete_page_cascade(pageId)
    },

    async get_backlinks(pageId: string): Promise<Link[]> {
      const result = await wasmModule.get_backlinks(pageId)
      return parseJsonResult<Link[]>(result)
    },

    async get_outlinks(pageId: string): Promise<Link[]> {
      const result = await wasmModule.get_outlinks(pageId)
      return parseJsonResult<Link[]>(result)
    },

    async get_properties(blockId: string): Promise<Property[]> {
      const result = await wasmModule.get_properties(blockId)
      return parseJsonResult<Property[]>(result)
    },

    async set_property(blockId: string, key: string, value: string, type: string): Promise<Property> {
      const result = await wasmModule.set_property(blockId, key, value, type)
      return parseJsonResult<Property>(result)
    },

    async delete_property(blockId: string, key: string): Promise<void> {
      await wasmModule.delete_property(blockId, key)
    },

    async get_relationship_types(): Promise<RelationshipType[]> {
      const result = await wasmModule.get_relationship_types()
      return parseJsonResult<RelationshipType[]>(result)
    },

    async search(query: string): Promise<SearchResult[]> {
      const result = await wasmModule.search(query)
      return parseJsonResult<SearchResult[]>(result)
    },

    async execute_batch(operations: string): Promise<BatchResult[]> {
      const result = await wasmModule.execute_batch(operations)
      return parseJsonResult<BatchResult[]>(result)
    },

    async query_date_refs(kind: string, from: string, to: string): Promise<DateRefRecord[]> {
      const result = await wasmModule.query_date_refs(kind, from, to)
      return parseJsonResult<DateRefRecord[]>(result)
    },

    async query_overdue_date_refs(today: string): Promise<DateRefRecord[]> {
      const result = await wasmModule.query_overdue_date_refs(today)
      return parseJsonResult<DateRefRecord[]>(result)
    },

    async get_date_refs_by_block(block_id: string): Promise<DateRefRecord[]> {
      const result = await wasmModule.get_date_refs_by_block(block_id)
      return parseJsonResult<DateRefRecord[]>(result)
    },

    async query_due_non_recurring_date_refs(now_ms: number): Promise<DateRefRecord[]> {
      const result = await wasmModule.query_due_non_recurring_date_refs(BigInt(now_ms))
      return parseJsonResult<DateRefRecord[]>(result)
    },

    async query_all_recurring_date_refs(): Promise<DateRefRecord[]> {
      const result = await wasmModule.query_all_recurring_date_refs()
      return parseJsonResult<DateRefRecord[]>(result)
    },

    async rebuild_date_refs(): Promise<{ rebuilt: number }> {
      const result = await wasmModule.rebuild_date_refs()
      return parseJsonResult<{ rebuilt: number }>(result)
    },

    async ensure_today_ideas_page(): Promise<Page> {
      const result = await wasmModule.ensure_today_ideas_page()
      return parseJsonResult<Page>(result)
    },

    async create_block_version(blockId: string, snapshot: string, hash: string, reason: string, checkpointName?: string): Promise<BlockVersion> {
      const result = await wasmModule.create_block_version(blockId, snapshot, hash, reason, checkpointName ?? undefined)
      return parseJsonResult<BlockVersion>(result)
    },

    async get_block_versions(blockId: string): Promise<BlockVersion[]> {
      const result = await wasmModule.get_block_versions(blockId)
      return parseJsonResult<BlockVersion[]>(result)
    },

    async get_block_version_by_id(id: string): Promise<BlockVersion> {
      const result = await wasmModule.get_block_version_by_id(id)
      return parseJsonResult<BlockVersion>(result)
    },

    async restore_block_version(versionId: string): Promise<BlockVersion> {
      const result = await wasmModule.restore_block_version(versionId)
      return parseJsonResult<BlockVersion>(result)
    },

    async cleanup_block_versions(retentionDays: number): Promise<void> {
      await wasmModule.cleanup_block_versions(BigInt(retentionDays))
    },

    async delete_block_version(versionId: string): Promise<void> {
      await wasmModule.delete_block_version(versionId)
    },

    async get_notification(id: string): Promise<Notification> {
      const result = await wasmModule.get_notification(id)
      return parseJsonResult<Notification>(result)
    },

    async get_notifications_by_block(blockId: string): Promise<Notification[]> {
      const result = await wasmModule.get_notifications_by_block(blockId)
      return parseJsonResult<Notification[]>(result)
    },

    async query_unread_notifications(): Promise<Notification[]> {
      const result = await wasmModule.query_unread_notifications()
      return parseJsonResult<Notification[]>(result)
    },

    async query_recent_notifications(limit: number): Promise<Notification[]> {
      const result = await wasmModule.query_recent_notifications(BigInt(limit))
      return parseJsonResult<Notification[]>(result)
    },

    async create_notification(notification: string): Promise<Notification> {
      const result = await wasmModule.create_notification(notification)
      return parseJsonResult<Notification>(result)
    },

    async batch_create_notifications(notifications: string): Promise<Notification[]> {
      const result = await wasmModule.batch_create_notifications(notifications)
      return parseJsonResult<Notification[]>(result)
    },

    async update_notification_status(id: string, status: string): Promise<Notification> {
      const result = await wasmModule.update_notification_status(id, status)
      return parseJsonResult<Notification>(result)
    },

    async update_notification_payload(id: string, payload: string): Promise<Notification> {
      const result = await wasmModule.update_notification_payload(id, payload)
      return parseJsonResult<Notification>(result)
    },

    async set_notification_snooze(id: string, snoozeUntil: number, status: string): Promise<Notification> {
      const result = await wasmModule.set_notification_snooze(id, BigInt(snoozeUntil), status)
      return parseJsonResult<Notification>(result)
    },

    async delete_notification(id: string): Promise<void> {
      await wasmModule.delete_notification(id)
    },

    async cleanup_notifications(timestamp: number): Promise<void> {
      await wasmModule.cleanup_notifications(BigInt(timestamp))
    },

    async mark_all_notifications_read(): Promise<void> {
      await wasmModule.mark_all_notifications_read()
    }
  }

  wasmClient = client
  return client
}

export function getWasmClient(): WasmClient | null {
  return wasmClient
}
