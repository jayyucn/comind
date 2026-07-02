import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import type {
  Block, Page, Property, Link, RelationshipType,
  UserTemplate, SearchResult, BlockUpdate, PageUpdate,
  BatchOperation, BatchResult
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