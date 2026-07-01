import type {
  Block, Page, Property, Link, RelationshipType,
  SearchResult, BlockUpdate, PageUpdate,
  BatchOperation, BatchResult
} from './types'

export interface WasmClient {
  get_block(blockId: string): Promise<Block>
  get_blocks_by_page(pageId: string): Promise<Block[]>
  save_block_tree(blocks: BlockUpdate[]): Promise<Block[]>

  get_page(pageId: string): Promise<Page>
  get_all_pages(): Promise<Page[]>
  save_page(page: PageUpdate): Promise<Page>
  delete_page_cascade(pageId: string): Promise<void>

  get_backlinks(pageId: string): Promise<Link[]>

  get_outlinks(pageId: string): Promise<Link[]>

  get_properties(blockId: string): Promise<Property[]>
  set_property(blockId: string, key: string, value: string, type: string): Promise<Property>
  delete_property(blockId: string, key: string): Promise<void>

  get_relationship_types(): Promise<RelationshipType[]>

  search(query: string): Promise<SearchResult[]>

  execute_batch(operations: BatchOperation[]): Promise<BatchResult[]>
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
      ;(window as any).SQL = await initSqlJs({
        locateFile: (file: string) => {
          return `/node_modules/sql.js/dist/${file}`
        }
      })
      return
    }
  } catch (err) {
    console.error('[sql.js] Failed to load from npm:', err)
  }
  throw new Error('sql.js not loaded')
}

export async function initWasmClient(): Promise<WasmClient> {
  if (wasmClient) return wasmClient as WasmClient

  await ensureSqlJsLoaded()
  const wasm = await import('@wasm/comind_wasm')
  await wasm.default()
  await wasm.init()
  wasmClient = wasm as unknown as WasmClient
  return wasmClient as WasmClient
}

export function getWasmClient(): WasmClient | null {
  return wasmClient
}