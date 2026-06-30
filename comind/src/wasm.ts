import type { Block, Page, Link, Property, RelationshipType, SearchResult } from './types'

let wasmLoaded = false

export async function loadWasm(): Promise<void> {
  if (wasmLoaded) return

  try {
    const { init, get_block, get_blocks_by_page, get_page, get_all_pages,
            save_block_tree, save_page, delete_page_cascade, search,
            get_backlinks, get_properties, set_property, delete_property,
            get_relationship_types, execute_batch } = await import('@wasm/comind_wasm')
    
    init()
    
    (globalThis as any)._wasm_get_block = get_block
    (globalThis as any)._wasm_get_blocks_by_page = get_blocks_by_page
    (globalThis as any)._wasm_get_page = get_page
    (globalThis as any)._wasm_get_all_pages = get_all_pages
    (globalThis as any)._wasm_save_block_tree = save_block_tree
    (globalThis as any)._wasm_save_page = save_page
    (globalThis as any)._wasm_delete_page_cascade = delete_page_cascade
    (globalThis as any)._wasm_search = search
    (globalThis as any)._wasm_get_backlinks = get_backlinks
    (globalThis as any)._wasm_get_properties = get_properties
    (globalThis as any)._wasm_set_property = set_property
    (globalThis as any)._wasm_delete_property = delete_property
    (globalThis as any)._wasm_get_relationship_types = get_relationship_types
    (globalThis as any)._wasm_execute_batch = execute_batch
    
    wasmLoaded = true
  } catch (e) {
    console.warn('WASM module not available, falling back to IndexedDB', e)
  }
}

function getWasmFn<T>(name: string): T {
  return (globalThis as any)[`_wasm_${name}`] || (() => {
    throw new Error('WASM not loaded')
  })
}

export async function get_block(block_id: string): Promise<Block> {
  const fn = getWasmFn<(id: string) => Promise<Block>>('get_block')
  return fn(block_id)
}

export async function get_blocks_by_page(page_id: string): Promise<Block[]> {
  const fn = getWasmFn<(id: string) => Promise<Block[]>>('get_blocks_by_page')
  return fn(page_id)
}

export async function get_page(page_id: string): Promise<Page> {
  const fn = getWasmFn<(id: string) => Promise<Page>>('get_page')
  return fn(page_id)
}

export async function get_all_pages(): Promise<Page[]> {
  const fn = getWasmFn<() => Promise<Page[]>>('get_all_pages')
  return fn()
}

export async function save_block_tree(blocks: Block[]): Promise<any> {
  const fn = getWasmFn<(blocks: any) => Promise<any>>('save_block_tree')
  return fn(JSON.stringify(blocks))
}

export async function save_page(page: Page): Promise<Page> {
  const fn = getWasmFn<(page: any) => Promise<Page>>('save_page')
  return fn(JSON.stringify(page))
}

export async function delete_page_cascade(page_id: string): Promise<any> {
  const fn = getWasmFn<(id: string) => Promise<any>>('delete_page_cascade')
  return fn(page_id)
}

export async function search(query: string): Promise<SearchResult[]> {
  const fn = getWasmFn<(q: string) => Promise<SearchResult[]>>('search')
  return fn(query)
}

export async function get_backlinks(page_id: string): Promise<Link[]> {
  const fn = getWasmFn<(id: string) => Promise<Link[]>>('get_backlinks')
  return fn(page_id)
}

export async function get_properties(block_id: string): Promise<Property[]> {
  const fn = getWasmFn<(id: string) => Promise<Property[]>>('get_properties')
  return fn(block_id)
}

export async function set_property(block_id: string, key: string, value: string, type: string): Promise<Property> {
  const fn = getWasmFn<(id: string, k: string, v: string, t: string) => Promise<Property>>('set_property')
  return fn(block_id, key, value, type)
}

export async function delete_property(block_id: string, key: string): Promise<any> {
  const fn = getWasmFn<(id: string, k: string) => Promise<any>>('delete_property')
  return fn(block_id, key)
}

export async function get_relationship_types(): Promise<RelationshipType[]> {
  const fn = getWasmFn<() => Promise<RelationshipType[]>>('get_relationship_types')
  return fn()
}

export async function execute_batch(operations: any[]): Promise<any[]> {
  const fn = getWasmFn<(ops: any) => Promise<any[]>>('execute_batch')
  return fn(JSON.stringify(operations))
}
