import type { Block, Page, Link, Property, RelationshipType, SearchResult } from './types'

export async function get_block(_block_id: string): Promise<Block> {
  throw new Error('WASM not loaded')
}

export async function get_blocks_by_page(_page_id: string): Promise<Block[]> {
  throw new Error('WASM not loaded')
}

export async function get_page(_page_id: string): Promise<Page> {
  throw new Error('WASM not loaded')
}

export async function get_all_pages(): Promise<Page[]> {
  throw new Error('WASM not loaded')
}

export async function save_block_tree(_blocks: Block[]): Promise<Block[]> {
  throw new Error('WASM not loaded')
}

export async function save_page(_page: Page): Promise<Page> {
  throw new Error('WASM not loaded')
}

export async function delete_page_cascade(_page_id: string): Promise<void> {
  throw new Error('WASM not loaded')
}

export async function search(_query: string): Promise<SearchResult[]> {
  throw new Error('WASM not loaded')
}

export async function get_backlinks(_page_id: string): Promise<Link[]> {
  throw new Error('WASM not loaded')
}

export async function get_properties(_block_id: string): Promise<Property[]> {
  throw new Error('WASM not loaded')
}

export async function set_property(_block_id: string, _key: string, _value: string, _type: string): Promise<Property> {
  throw new Error('WASM not loaded')
}

export async function delete_property(_block_id: string, _key: string): Promise<void> {
  throw new Error('WASM not loaded')
}

export async function get_relationship_types(): Promise<RelationshipType[]> {
  throw new Error('WASM not loaded')
}

export async function execute_batch(_operations: any[]): Promise<any[]> {
  throw new Error('WASM not loaded')
}