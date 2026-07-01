# Sprint 4 实施方案：TS 重构 + 属性系统统一 + WASM 集成

> **面向智能体执行者：必须使用子技能**：通过 subagent‑driven‑development（推荐）或 executing‑plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
> **目标**：重构 Pinia stores 调用 Tauri Command，移除 `block.properties` 字段，统一使用 `properties` 表，集成 WASM 模块
> **架构**：Phase 3 Sprint 4 将 TS Core 层替换为 Rust Core，通过 Tauri Command（桌面）和 WASM（Web）与前端交互
> **技术栈**：Tauri Command、Rust Core、wasm-bindgen、Pinia

***

## 任务 1：创建 WASM 客户端模块

**涉及文件：**

- 新建：`comind/src/wasm/index.ts`（WASM 模块入口）
- 新建：`comind/src/wasm/client.ts`（统一客户端接口）
- 新建：`comind/src/wasm/tauri-client.ts`（Tauri Command 调用封装）
- 新建：`comind/src/wasm/wasm-client.ts`（WASM 调用封装）
- 新建：`comind/src/wasm/types.ts`（类型定义）

***

- [ ] **步骤 1：创建 WASM 类型定义**

```typescript
// comind/src/wasm/types.ts

export interface Block {
  id: string
  page_id: string
  parent_id: string | null
  pos: number
  content: string
  format: string  // JSON
  type: string
  created_at: number
  updated_at: number
}

export interface Page {
  id: string
  block_id: string | null
  title: string
  type: 'normal' | 'journal'
  icon: string | null
  cover: string | null
  aliases: string  // JSON array
  file_path: string | null
  children_count: number
  word_count: number
  deleted: number
  created_at: number
  updated_at: number
}

export interface Property {
  id: string
  block_id: string
  key: string
  value: string  // JSON serialized
  type: string
  sort_order: number
  is_hidden: number
  is_deleted: number
  schema_version: number
  created_at: number
  updated_at: number
}

export interface Link {
  id: string
  source_block_id: string
  target_page_id: string
  display_text: string
  relationship_type: string | null
  created_at: number
}

export interface RelationshipType {
  id: string
  type: string
  inverse: string | null
  label: string
  inverse_label: string
  color: string
  order: number
  strength: 'strong' | 'medium' | 'weak'
  deleted: number
  builtin: number
  created_at: number
  updated_at: number
}

export interface UserTemplate {
  id: string
  name: string
  category: string
  content: string
  created_at: number
  updated_at: number
}

export interface SearchResult {
  block_id: string
  page_id: string
  title: string
  content: string
  score: number
}

export interface BlockUpdate {
  id: string
  page_id: string
  parent_id: string | null
  pos: number
  content: string
  format: Record<string, any>
  type: string
}

export interface PageUpdate {
  id?: string
  title: string
  type: 'normal' | 'journal'
  icon?: string | null
  cover?: string | null
  aliases?: string[]
}

export interface BatchOperation {
  entity: 'block' | 'page' | 'link' | 'property' | 'relationship_type' | 'template'
  action: 'create' | 'update' | 'delete'
  params: Record<string, any>
}

export interface BatchResult {
  success: boolean
  entity: string
  action: string
  id?: string
  error?: string
}
```

***

- [ ] **步骤 2：创建 Tauri Command 客户端封装**

```typescript
// comind/src/wasm/tauri-client.ts

import { invoke } from '@tauri-apps/api/core'
import type {
  Block, Page, Property, Link, RelationshipType,
  UserTemplate, SearchResult, BlockUpdate, PageUpdate,
  BatchOperation, BatchResult
} from './types'

/**
 * 检查是否在 Tauri 环境运行
 */
export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window
}

// Block operations
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

// Page operations
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

// Link operations
export async function tauriGetBacklinks(pageId: string): Promise<Link[]> {
  return invoke('get_backlinks', { pageId })
}

// Property operations
export async function tauriGetProperties(blockId: string): Promise<Property[]> {
  return invoke('get_properties', { blockId })
}

export async function tauriSetProperty(
  blockId: string,
  key: string,
  value: string,
  type: string
): Promise<Property> {
  return invoke('set_property', { blockId, key, value, type: type })
}

export async function tauriDeleteProperty(blockId: string, key: string): Promise<void> {
  return invoke('delete_property', { blockId, key })
}

// RelationshipType operations
export async function tauriGetRelationshipTypes(): Promise<RelationshipType[]> {
  return invoke('get_relationship_types')
}

// Template operations
export async function tauriGetTemplates(): Promise<UserTemplate[]> {
  return invoke('get_templates')
}

// Search
export async function tauriSearch(query: string): Promise<SearchResult[]> {
  return invoke('search', { query })
}

// Batch operations
export async function tauriExecuteBatch(
  operations: BatchOperation[]
): Promise<BatchResult[]> {
  return invoke('execute_batch', { operations })
}
```

***

- [ ] **步骤 3：创建 WASM 客户端封装（Web 环境）**

```typescript
// comind/src/wasm/wasm-client.ts

// WASM 客户端接口 - 需要等待 WASM 模块实现后填充
// 此文件为占位符，实际实现将在 Sprint 3 完成后由 comind-wasm crate 生成

import type {
  Block, Page, Property, Link, RelationshipType,
  UserTemplate, SearchResult, BlockUpdate, PageUpdate,
  BatchOperation, BatchResult
} from './types'

export interface WasmClient {
  // Block operations
  get_block(blockId: string): Promise<Block>
  get_blocks_by_page(pageId: string): Promise<Block[]>
  save_block_tree(blocks: BlockUpdate[]): Promise<Block[]>
  delete_block(blockId: string): Promise<void>

  // Page operations
  get_page(pageId: string): Promise<Page>
  get_all_pages(): Promise<Page[]>
  save_page(page: PageUpdate): Promise<Page>
  delete_page_cascade(pageId: string): Promise<void>

  // Link operations
  get_backlinks(pageId: string): Promise<Link[]>

  // Property operations
  get_properties(blockId: string): Promise<Property[]>
  set_property(blockId: string, key: string, value: string, type: string): Promise<Property>
  delete_property(blockId: string, key: string): Promise<void>

  // RelationshipType operations
  get_relationship_types(): Promise<RelationshipType[]>

  // Template operations
  get_templates(): Promise<UserTemplate[]>

  // Search
  search(query: string): Promise<SearchResult[]>

  // Batch operations
  execute_batch(operations: BatchOperation[]): Promise<BatchResult[]>
}

let wasmClient: WasmClient | null = null

export async function initWasmClient(): Promise<WasmClient> {
  if (wasmClient) return wasmClient

  // 动态导入 WASM 模块（由 wasm-pack 构建生成）
  const wasm = await import('@wasm/comind_wasm')
  await wasm.default()  // 初始化 WASM
  wasmClient = wasm
  return wasmClient
}

export function getWasmClient(): WasmClient | null {
  return wasmClient
}
```

***

- [ ] **步骤 4：创建统一客户端接口**

```typescript
// comind/src/wasm/client.ts

import { isTauriEnvironment } from './tauri-client'
import { initWasmClient, getWasmClient, type WasmClient } from './wasm-client'
import * as tauri from './tauri-client'
import type {
  Block, Page, Property, Link, RelationshipType,
  UserTemplate, SearchResult, BlockUpdate, PageUpdate,
  BatchOperation, BatchResult
} from './types'

export interface CoreClient {
  // Block operations
  getBlock(blockId: string): Promise<Block>
  getBlocksByPage(pageId: string): Promise<Block[]>
  saveBlockTree(blocks: BlockUpdate[]): Promise<Block[]>
  deleteBlock(blockId: string): Promise<void>

  // Page operations
  getPage(pageId: string): Promise<Page>
  getAllPages(): Promise<Page[]>
  savePage(page: PageUpdate): Promise<Page>
  deletePageCascade(pageId: string): Promise<void>

  // Link operations
  getBacklinks(pageId: string): Promise<Link[]>

  // Property operations
  getProperties(blockId: string): Promise<Property[]>
  setProperty(blockId: string, key: string, value: string, type: string): Promise<Property>
  deleteProperty(blockId: string, key: string): Promise<void>

  // RelationshipType operations
  getRelationshipTypes(): Promise<RelationshipType[]>

  // Template operations
  getTemplates(): Promise<UserTemplate[]>

  // Search
  search(query: string): Promise<SearchResult[]>

  // Batch operations
  executeBatch(operations: BatchOperation[]): Promise<BatchResult[]>
}

/**
 * Tauri 环境客户端实现
 */
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

/**
 * WASM 环境客户端实现
 */
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
    return this.wasm.delete_block(blockId)
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
    return this.wasm.get_templates()
  }

  async search(query: string): Promise<SearchResult[]> {
    return this.wasm.search(query)
  }

  async executeBatch(operations: BatchOperation[]): Promise<BatchResult[]> {
    return this.wasm.execute_batch(operations)
  }
}

let coreClient: CoreClient | null = null

/**
 * 初始化 Core Client（自动选择 Tauri 或 WASM）
 */
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

/**
 * 获取 Core Client
 */
export function getCoreClient(): CoreClient | null {
  return coreClient
}
```

***

- [ ] **步骤 5：创建 WASM 模块入口**

```typescript
// comind/src/wasm/index.ts

export * from './types'
export * from './client'
export * from './tauri-client'
```

***

## 任务 2：重构 blocks.ts 调用 Tauri Command

**涉及文件：**

- 修改：`comind/src/stores/blocks.ts`

***

- [ ] **步骤 1：更新 blocks.ts 的导入和初始化**

修改 `comind/src/stores/blocks.ts:1-10`：

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Block } from '../types/block'
import { getCoreClient, initCoreClient } from '../wasm/client'  // 改为 WASM 客户端
import { generateUUID } from '../utils/id'
import { debounce } from '../utils/debounce'
import { usePageStore } from './pages'
import {
  pmPosToTextOffset,
  getSortedChildren,
  getSortedSiblings,
  sortByPos,
  getPrevSibling,
  getNextSibling,
  calcInsertPos,
  renumberBlocks,
  isGapExhaustedError,
  SAVE_DEBOUNCE_MS,
  findBlockIndex,
  isDescendantOf
} from '../utils/block-helpers'
```

在 `blocks.ts` 中添加客户端初始化：

```typescript
// 在 store 定义之前添加
let coreClientPromise: Promise<ReturnType<typeof initCoreClient>> | null = null

async function getClient() {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  return coreClientPromise
}
```

***

- [ ] **步骤 2：更新 loadPageBlocks 方法**

修改 `comind/src/stores/blocks.ts:134-139`：

```typescript
// 原代码：
async function loadPageBlocks(pageId: string) {
  const core = getCore()
  blocks.value = await core.blockService.getByPageId(pageId)
  structureVersion.value++
  return blocks
}

// 修改为：
async function loadPageBlocks(pageId: string) {
  const client = await getClient()
  const rustBlocks = await client.getBlocksByPage(pageId)
  
  // 转换为 TS Block 格式
  blocks.value = rustBlocks.map(rustBlock => ({
    id: rustBlock.id,
    pageId: rustBlock.page_id,
    parentId: rustBlock.parent_id,
    pos: rustBlock.pos,
    content: rustBlock.content,
    format: JSON.parse(rustBlock.format || '{}'),
    type: rustBlock.type as Block['type'],
    properties: {},  // 已废弃，统一使用 properties 表
    createdAt: rustBlock.created_at,
    updatedAt: rustBlock.updated_at
  }))
  structureVersion.value++
  return blocks
}
```

***

- [ ] **步骤 3：更新 \_doSave 方法**

修改 `comind/src/stores/blocks.ts:174-191`：

```typescript
// 原代码：
async function _doSave(block: Block): Promise<void> {
  const currentBlock = blocks.value.find(b => b.id === block.id)
  if (!currentBlock) {
    pendingSaves.delete(block.id)
    return
  }
  const core = getCore()
  const result = await core.blockService.update(block.id, block)
  pendingSaves.delete(block.id)

  // 如果存储返回了被跳过的回收站页面警告
  if (result && 'skippedTrashedPages' in result) {
    const skippedPages = (result as any).skippedTrashedPages
    if (skippedPages && skippedPages.length > 0) {
      trashedPageWarnings.value = skippedPages
    }
  }
}

// 修改为：
async function _doSave(block: Block): Promise<void> {
  const currentBlock = blocks.value.find(b => b.id === block.id)
  if (!currentBlock) {
    pendingSaves.delete(block.id)
    return
  }
  
  const client = await getClient()
  const blockUpdate = {
    id: currentBlock.id,
    page_id: currentBlock.pageId,
    parent_id: currentBlock.parentId,
    pos: currentBlock.pos,
    content: currentBlock.content,
    format: currentBlock.format || {},
    type: currentBlock.type
  }
  
  await client.saveBlockTree([blockUpdate])
  pendingSaves.delete(block.id)
}
```

***

- [ ] **步骤 4：更新 deleteBlock 方法**

修改 `comind/src/stores/blocks.ts:681-716`：

```typescript
// 原代码：
async function deleteBlock(blockId: string) {
  // ... 删除逻辑
  try {
    const core = getCore()
    for (const id of toDelete) {
      await core.blockService.delete(id)
      core.searchService.removeBlock(id)
    }
  } catch (error) {
    console.error('[deleteBlock] Failed to delete blocks:', error)
  }
  // ...
}

// 修改为：
async function deleteBlock(blockId: string) {
  const toDelete = new Set<string>([blockId])
  const queue = [blockId]

  while (queue.length > 0) {
    const currentId = queue.pop()!
    const children = blocks.value.filter(b => b.parentId === currentId)
    for (const child of children) {
      if (!toDelete.has(child.id)) {
        toDelete.add(child.id)
        queue.push(child.id)
      }
    }
  }

  for (const id of toDelete) {
    pendingSaves.get(id)?.cancel()
    pendingSaves.delete(id)
  }

  blocks.value = blocks.value.filter(b => !toDelete.has(b.id))

  // 使用 Rust Core 删除
  try {
    const client = await getClient()
    for (const id of toDelete) {
      await client.deleteBlock(id)
    }
  } catch (error) {
    console.error('[deleteBlock] Failed to delete blocks:', error)
  }

  structureVersion.value++
}
```

***

- [ ] **步骤 5：更新 updateBlockContent 方法中的搜索索引调用**

修改 `comind/src/stores/blocks.ts:719-737`：

```typescript
// 原代码：
async function updateBlockContent(blockId: string, content: string) {
  const block = blocks.value.find(b => b.id === blockId)
  if (!block) return

  block.content = content
  block.updatedAt = Date.now()
  _scheduleSave(block)

  // 更新页面统计
  const pageStore = usePageStore()
  const page = pageStore.getPage(block.pageId)
  if (page) {
    page.updatedAt = Date.now()
    const core = getCore()
    await core.pageService.updatePage(page)
    // 更新搜索索引
    core.searchService.updateBlock(block)
  }
}

// 修改为：
async function updateBlockContent(blockId: string, content: string) {
  const block = blocks.value.find(b => b.id === blockId)
  if (!block) return

  block.content = content
  block.updatedAt = Date.now()
  _scheduleSave(block)

  // 更新页面统计（通过 Rust Core）
  const pageStore = usePageStore()
  const page = pageStore.getPage(block.pageId)
  if (page) {
    const client = await getClient()
    await client.savePage({
      id: page.id,
      title: page.title,
      type: page.type
    })
  }
}
```

***

## 任务 3：重构 pages.ts 调用 Tauri Command

**涉及文件：**

- 修改：`comind/src/stores/pages.ts`

***

- [ ] **步骤 1：更新 pages.ts 的导入**

修改 `comind/src/stores/pages.ts:1-7`：

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Page } from '../types/page'
import { getCoreClient, initCoreClient } from '../wasm/client'  // 改为 WASM 客户端
import { useBlockStore } from './blocks'
import { useFavorites } from '../composables/useFavorites'

// 添加客户端获取函数
let coreClientPromise: Promise<ReturnType<typeof initCoreClient>> | null = null

async function getClient() {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  return coreClientPromise
}
```

***

- [ ] **步骤 2：更新 loadAllPages 方法**

修改 `comind/src/stores/pages.ts:20-28`：

```typescript
// 原代码：
async function loadAllPages() {
  loading.value = true
  try {
    const core = getCore()
    pages.value = await core.pageService.getAll()
  } finally {
    loading.value = false
  }
}

// 修改为：
async function loadAllPages() {
  loading.value = true
  try {
    const client = await getClient()
    const rustPages = await client.getAllPages()
    
    // 转换为 TS Page 格式
    pages.value = rustPages.map(rustPage => ({
      id: rustPage.id,
      blockId: rustPage.block_id,
      title: rustPage.title,
      type: rustPage.type as Page['type'],
      icon: rustPage.icon,
      cover: rustPage.cover,
      aliases: JSON.parse(rustPage.aliases || '[]'),
      filePath: rustPage.file_path,
      childrenCount: rustPage.children_count,
      wordCount: rustPage.word_count,
      deleted: rustPage.deleted === 1,
      createdAt: rustPage.created_at,
      updatedAt: rustPage.updated_at
    }))
  } finally {
    loading.value = false
  }
}
```

***

- [ ] **步骤 3：更新 createPage 方法**

修改 `comind/src/stores/pages.ts:36-43`：

```typescript
// 原代码：
async function createPage(title: string, type: 'normal' | 'journal' = 'normal'): Promise<Page> {
  const core = getCore()
  const page = await core.pageService.create({ title, type })
  pages.value.push(page)
  core.searchService.updatePage(page)
  return page
}

// 修改为：
async function createPage(title: string, type: 'normal' | 'journal' = 'normal'): Promise<Page> {
  const client = await getClient()
  const page = await client.savePage({ title, type })
  
  const tsPage: Page = {
    id: page.id,
    blockId: page.block_id,
    title: page.title,
    type: page.type as Page['type'],
    icon: page.icon,
    cover: page.cover,
    aliases: JSON.parse(page.aliases || '[]'),
    filePath: page.file_path,
    childrenCount: page.children_count,
    wordCount: page.word_count,
    deleted: page.deleted === 1,
    createdAt: page.created_at,
    updatedAt: page.updated_at
  }
  
  pages.value.push(tsPage)
  return tsPage
}
```

***

- [ ] **步骤 4：更新 renamePage 方法**

修改 `comind/src/stores/pages.ts:55-74`：

```typescript
// 原代码：
async function renamePage(pageId: string, newTitle: string): Promise<{ duplicated?: Page }> {
  if (!newTitle.trim()) return {}
  const page = getPage(pageId)
  if (!page) return {}
  if (page.type === 'journal') return {}
  const trimmedTitle = newTitle.trim()
  if (page.title === trimmedTitle) return {}

  const duplicate = getPageByTitle(trimmedTitle)
  if (duplicate && duplicate.id !== pageId) {
    return { duplicated: duplicate }
  }

  const core = getCore()
  await core.pageService.rename(pageId, trimmedTitle)
  page.title = trimmedTitle
  core.searchService.updatePage(page)
  return {}
}

// 修改为：
async function renamePage(pageId: string, newTitle: string): Promise<{ duplicated?: Page }> {
  if (!newTitle.trim()) return {}
  const page = getPage(pageId)
  if (!page) return {}
  if (page.type === 'journal') return {}
  const trimmedTitle = newTitle.trim()
  if (page.title === trimmedTitle) return {}

  const duplicate = getPageByTitle(trimmedTitle)
  if (duplicate && duplicate.id !== pageId) {
    return { duplicated: duplicate }
  }

  const client = await getClient()
  await client.savePage({ id: pageId, title: trimmedTitle, type: page.type })
  page.title = trimmedTitle
  return {}
}
```

***

- [ ] **步骤 5：更新 deletePage 方法**

修改 `comind/src/stores/pages.ts:87-99`：

```typescript
// 原代码：
async function deletePage(pageId: string): Promise<void> {
  const core = getCore()
  await core.pageService.deletePage(pageId)
  pages.value = pages.value.filter(p => p.id !== pageId)
  if (currentPageId.value === pageId) {
    currentPageId.value = pages.value.length > 0 ? pages.value[0].id : ''
  }
  if (removePageFromHistoryFn) {
    removePageFromHistoryFn(pageId)
  }
  core.searchService.removePage(pageId)
}

// 修改为：
async function deletePage(pageId: string): Promise<void> {
  const client = await getClient()
  await client.deletePageCascade(pageId)
  pages.value = pages.value.filter(p => p.id !== pageId)
  if (currentPageId.value === pageId) {
    currentPageId.value = pages.value.length > 0 ? pages.value[0].id : ''
  }
  if (removePageFromHistoryFn) {
    removePageFromHistoryFn(pageId)
  }
}
```

***

## 任务 4：更新 property.ts 使用新客户端

**涉及文件：**

- 修改：`comind/src/stores/property.ts`

***

- [ ] **步骤 1：更新 property.ts 的导入和初始化**

修改 `comind/src/stores/property.ts:1-10`：

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getCoreClient, initCoreClient } from '../wasm/client'  // 改为 WASM 客户端
import type { Property, PropertyDefinition, PropertyValue, PropertyType } from '../types/property'
import { getAllPropertyDefinitions, getPropertyDefinition } from '../types/property'

// 添加客户端获取函数
let coreClientPromise: Promise<ReturnType<typeof initCoreClient>> | null = null

async function getClient() {
  if (!coreClientPromise) {
    coreClientPromise = initCoreClient()
  }
  return coreClientPromise
}
```

***

- [ ] **步骤 2：更新 loadBlockProperties 方法**

修改 `comind/src/stores/property.ts:28-38`：

```typescript
// 原代码：
async function loadBlockProperties(blockId: string): Promise<Property[]> {
  loading.value = true
  try {
    const core = getCore()
    const props = await core.propertyService.getByBlockId(blockId)
    propertiesByBlock.value.set(blockId, props)
    return props
  } finally {
    loading.value = false
  }
}

// 修改为：
async function loadBlockProperties(blockId: string): Promise<Property[]> {
  loading.value = true
  try {
    const client = await getClient()
    const rustProps = await client.getProperties(blockId)
    
    // 转换为 TS Property 格式
    const props: Property[] = rustProps.map(rustProp => ({
      id: rustProp.id,
      blockId: rustProp.block_id,
      key: rustProp.key,
      value: JSON.parse(rustProp.value),
      type: rustProp.type as PropertyType,
      sortOrder: rustProp.sort_order,
      isHidden: rustProp.is_hidden === 1,
      isDeleted: rustProp.is_deleted === 1,
      schemaVersion: rustProp.schema_version,
      createdAt: rustProp.created_at,
      updatedAt: rustProp.updated_at
    }))
    
    propertiesByBlock.value.set(blockId, props)
    return props
  } finally {
    loading.value = false
  }
}
```

***

- [ ] **步骤 3：更新 setProperty 方法**

修改 `comind/src/stores/property.ts:53-64`：

```typescript
// 原代码：
async function setProperty(
  blockId: string,
  key: string,
  value: PropertyValue,
  type?: PropertyType
): Promise<Property> {
  const core = getCore()
  const prop = await core.propertyService.setProperty(blockId, key, value, type)
  await loadBlockProperties(blockId)
  return prop
}

// 修改为：
async function setProperty(
  blockId: string,
  key: string,
  value: PropertyValue,
  type?: PropertyType
): Promise<Property> {
  const client = await getClient()
  const valueStr = typeof value === 'string' ? value : JSON.stringify(value)
  const propType = type || inferType(value)
  
  const rustProp = await client.setProperty(blockId, key, valueStr, propType)
  
  // 转换为 TS Property 格式
  const prop: Property = {
    id: rustProp.id,
    blockId: rustProp.block_id,
    key: rustProp.key,
    value: JSON.parse(rustProp.value),
    type: rustProp.type as PropertyType,
    sortOrder: rustProp.sort_order,
    isHidden: rustProp.is_hidden === 1,
    isDeleted: rustProp.is_deleted === 1,
    schemaVersion: rustProp.schema_version,
    createdAt: rustProp.created_at,
    updatedAt: rustProp.updated_at
  }
  
  await loadBlockProperties(blockId)
  return prop
}

// 添加类型推断辅助函数
function inferType(value: PropertyValue): PropertyType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (value instanceof Date) return 'date'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'page'
  return 'string'
}
```

***

## 任务 5：更新 main.ts 支持环境检测

**涉及文件：**

- 修改：`comind/src/main.ts`

***

- [ ] **步骤 1：更新 main.ts 添加客户端初始化**

修改 `comind/src/main.ts:1-21`：

```typescript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import './styles/main.scss'
import App from './App.vue'
import { initCoreClient } from './wasm/client'

// 先初始化 Core Client，再启动 Vue App
async function bootstrap() {
  try {
    // 根据环境自动选择 Tauri Command 或 WASM 客户端
    await initCoreClient()
  } catch (err) {
    console.error('[main] Failed to initialize Core client:', err)
  }

  const app = createApp(App)
  app.use(createPinia())
  app.use(router)
  app.mount('#app')
}

bootstrap()
```

***

## 任务 6：创建性能基准测试

**涉及文件：**

- 新建：`comind/tests/performance-benchmark.spec.ts`

***

- [ ] **步骤 1：创建性能基准测试文件**

```typescript
// comind/tests/performance-benchmark.spec.ts

import { test, expect } from '@playwright/test'

/**
 * Phase 3 Sprint 4 性能基准测试
 * 
 * 测试目标：对比 TS Core 与 Rust Core（WASM/Tauri）的性能
 * 验收标准：Rust Core 性能应不差于 TS Core（允许 10% 误差）
 */

test.describe('Phase 3 Performance Benchmark', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // 等待应用初始化完成
    await page.waitForSelector('[data-testid="page-container"]', { timeout: 10000 })
  })

  test('Block 创建性能：1000 个 Block', async ({ page }) => {
    const startTime = Date.now()
    
    // 创建 1000 个 Block
    for (let i = 0; i < 1000; i++) {
      await page.keyboard.type(`Block ${i}`)
      await page.keyboard.press('Enter')
    }
    
    const endTime = Date.now()
    const duration = endTime - startTime
    
    console.log(`Created 1000 blocks in ${duration}ms`)
    
    // 验收标准：1000 个 Block 创建应在 10 秒内完成
    expect(duration).toBeLessThan(10000)
  })

  test('Block 查询性能：1000 个 Block 按 pageId 查询', async ({ page }) => {
    // 先创建测试数据
    const testPageId = 'benchmark-page'
    
    // 测量查询时间
    const startTime = Date.now()
    
    // 执行查询操作（通过 Pinia store）
    const result = await page.evaluate(async () => {
      const { useBlockStore } = await import('../src/stores/blocks')
      const store = useBlockStore()
      const blocks = store.getBlocksByPage(testPageId)
      return blocks.length
    })
    
    const endTime = Date.now()
    const duration = endTime - startTime
    
    console.log(`Query 1000 blocks in ${duration}ms`)
    
    // 验收标准：1000 个 Block 查询应在 100ms 内完成
    expect(duration).toBeLessThan(100)
  })

  test('搜索性能：1000 个 Block 全文搜索', async ({ page }) => {
    const startTime = Date.now()
    
    // 执行搜索操作
    await page.keyboard.press('Control+k')
    await page.waitForSelector('[data-testid="search-panel"]', { timeout: 5000 })
    await page.keyboard.type('Block 500')
    
    // 等待搜索结果
    await page.waitForTimeout(500)
    
    const endTime = Date.now()
    const duration = endTime - startTime
    
    console.log(`Search 1000 blocks in ${duration}ms`)
    
    // 验收标准：搜索应在 200ms 内返回结果
    expect(duration).toBeLessThan(200)
  })

  test('页面切换性能：加载 100 个 Block 的页面', async ({ page }) => {
    // 创建包含 100 个 Block 的测试页面
    const testPageId = 'benchmark-page-100'
    
    const startTime = Date.now()
    
    // 切换页面
    await page.evaluate(async (pageId) => {
      const { usePageStore } = await import('../src/stores/pages')
      const { useBlockStore } = await import('../src/stores/blocks')
      const pageStore = usePageStore()
      const blockStore = useBlockStore()
      await pageStore.openPage(pageId)
      await blockStore.loadPageBlocks(pageId)
    }, testPageId)
    
    const endTime = Date.now()
    const duration = endTime - startTime
    
    console.log(`Load page with 100 blocks in ${duration}ms`)
    
    // 验收标准：100 个 Block 的页面加载应在 500ms 内完成
    expect(duration).toBeLessThan(500)
  })
})
```

***

## 任务 7：验证和提交

***

- [ ] **步骤 1：运行 TypeScript 类型检查**

```bash
cd comind
npm run build
```

预期结果：构建成功，无类型错误

***

- [ ] **步骤 2：运行单元测试**

```bash
cd comind
npm run test
```

预期结果：所有测试通过

***

- [ ] **步骤 3：提交代码**

```bash
cd comind
git add src/stores/blocks.ts src/stores/pages.ts src/stores/property.ts src/main.ts src/wasm/
git add tests/performance-benchmark.spec.ts
git commit -m "feat(phase3-sprint4): refactor stores to use Rust Core via Tauri/WASM

- Add WASM client module with Tauri and WASM adapter
- Refactor blocks.ts to call Tauri Command instead of TS Core
- Refactor pages.ts to call Tauri Command instead of TS Core
- Refactor property.ts to use unified properties table
- Add performance benchmark tests for Phase 3 validation
- Update main.ts for environment-aware client initialization"
```

***

## 依赖关系

| 任务   | 依赖          | 说明                      |
| ---- | ----------- | ----------------------- |
| 任务 1 | Sprint 3 完成 | WASM 客户端需要 WASM 模块先实现   |
| 任务 2 | 任务 1        | blocks.ts 依赖 WASM 客户端   |
| 任务 3 | 任务 1        | pages.ts 依赖 WASM 客户端    |
| 任务 4 | 任务 1        | property.ts 依赖 WASM 客户端 |
| 任务 5 | 任务 1        | main.ts 依赖 WASM 客户端     |
| 任务 6 | 任务 2-5      | 性能测试需要所有 store 重构完成     |
| 任务 7 | 任务 1-6      | 验证需要所有代码完成              |

***

## 验收标准

| 任务   | 验收标准                                 |
| ---- | ------------------------------------ |
| 任务 1 | WASM 客户端模块编译通过，类型定义完整                |
| 任务 2 | blocks.ts 调用新客户端，创建/编辑/删除 Block 功能正常 |
| 任务 3 | pages.ts 调用新客户端，创建/编辑/删除 Page 功能正常   |
| 任务 4 | property.ts 调用新客户端，属性读写正常            |
| 任务 5 | main.ts 正确初始化客户端，无运行时错误              |
| 任务 6 | 性能基准测试通过，Rust Core 性能不差于 TS Core     |
| 任务 7 | 所有测试通过，代码已提交                         |

