import type {
  Block, Page, Property, Link, RelationshipType,
  SearchResult, BatchResult
} from './types'

export interface WasmClient {
  get_block(blockId: string): Promise<Block>
  get_blocks_by_page(pageId: string): Promise<Block[]>
  save_block_tree(blocks: string): Promise<Block[]>

  get_page(pageId: string): Promise<Page>
  get_all_pages(): Promise<Page[]>
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
    }
  }

  wasmClient = client
  return client
}

export function getWasmClient(): WasmClient | null {
  return wasmClient
}
