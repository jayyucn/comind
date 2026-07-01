import { isTauriEnvironment } from './tauri-client'
import { initWasmClient, type WasmClient } from './wasm-client'
import * as tauri from './tauri-client'
import type {
  Block, Page, Property, Link, RelationshipType,
  UserTemplate, SearchResult, BlockUpdate, PageUpdate,
  BatchOperation, BatchResult
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
    return this.wasm.save_block_tree(blocks)
  }

  async deleteBlock(blockId: string): Promise<void> {
    await this.wasm.execute_batch([{
      entity: 'block',
      action: 'delete',
      params: { id: blockId }
    }])
  }

  async getPage(pageId: string): Promise<Page> {
    return this.wasm.get_page(pageId)
  }

  async getAllPages(): Promise<Page[]> {
    return this.wasm.get_all_pages()
  }

  async savePage(page: PageUpdate): Promise<Page> {
    return this.wasm.save_page(page)
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
    const results = await this.wasm.execute_batch([{
      entity: 'template',
      action: 'get',
      params: {}
    }])
    return results as unknown as UserTemplate[]
  }

  async search(query: string): Promise<SearchResult[]> {
    return this.wasm.search(query)
  }

  async executeBatch(operations: BatchOperation[]): Promise<BatchResult[]> {
    return this.wasm.execute_batch(operations)
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