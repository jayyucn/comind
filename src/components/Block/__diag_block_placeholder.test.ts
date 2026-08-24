import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    })),
  })
})

import Block from './index.vue'
import { useBlockStore } from '../../stores/blocks'
import { usePageStore } from '../../stores/pages'
import { useEditorStore } from '../../stores/editor'
import type { TreeNode } from '../../types/block'

vi.mock('../../composables/useNavigateToPage', () => ({
  useNavigateToPage: () => ({ navigateToPage: vi.fn() })
}))

const BLOCK_ID = 'blk-empty-1'

function mkBlock(pageId: string, id = BLOCK_ID, content = '') {
  return {
    id, pageId, parentId: null, pos: 1000, content,
    format: {}, type: 'bullet' as const, properties: {},
    createdAt: Date.now(), updatedAt: Date.now()
  }
}

describe('DIAG Block -> Editor placeholder', () => {
  let blockStore: ReturnType<typeof useBlockStore>
  let pageStore: ReturnType<typeof usePageStore>
  let editorStore: ReturnType<typeof useEditorStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    blockStore = useBlockStore()
    pageStore = usePageStore()
    editorStore = useEditorStore()
  })

  it('single empty block, active -> editor placeholder should show', async () => {
    const PAGE = 'page-1'
    pageStore.pages.push({
      id: PAGE, blockId: null, title: 'P', type: 'normal', icon: null, cover: null,
      aliases: [], filePath: null, childrenCount: 0, wordCount: 0,
      createdAt: 0, updatedAt: 0, deleted: false, deletedAt: null
    } as any)
    pageStore.currentPageId = PAGE

    const b = mkBlock(PAGE)
    blockStore.blocks.push(b as any)
    editorStore.activateBlock(BLOCK_ID)

    const node: TreeNode = { id: BLOCK_ID, block: b as any, children: [] }
    const w = mount(Block, { props: { node, pageId: PAGE, depth: 0 } })
    await flushPromises(); await nextTick()

    console.log('[1] blocksByPage.len =', blockStore.getBlocksByPage(PAGE).length)
    console.log('[1] editor rendered =', w.find('.editor-wrapper').exists())
    console.log('[1] placeholder =', w.find('.editor-placeholder').exists())
    console.log('[1] html =', w.html().slice(0, 900))
    w.unmount()
  })

  it('page ALSO has a root block (page.blockId) -> count becomes 2', async () => {
    const PAGE = 'page-2'
    const ROOT = 'root-blk-2'
    pageStore.pages.push({
      id: PAGE, blockId: ROOT, title: 'P2', type: 'normal', icon: null, cover: null,
      aliases: [], filePath: null, childrenCount: 0, wordCount: 0,
      createdAt: 0, updatedAt: 0, deleted: false, deletedAt: null
    } as any)
    pageStore.currentPageId = PAGE

    blockStore.blocks.push(mkBlock(PAGE, ROOT, '') as any)
    const b = mkBlock(PAGE, BLOCK_ID, '')
    b.parentId = ROOT as any
    blockStore.blocks.push(b as any)
    editorStore.activateBlock(BLOCK_ID)

    const node: TreeNode = { id: BLOCK_ID, block: b as any, children: [] }
    const w = mount(Block, { props: { node, pageId: PAGE, depth: 0 } })
    await flushPromises(); await nextTick()

    console.log('[2] blocksByPage.len =', blockStore.getBlocksByPage(PAGE).length)
    console.log('[2] placeholder =', w.find('.editor-placeholder').exists())
    w.unmount()
  })

  it('currentPageId != props.pageId (embed / ideas / multi-page load)', async () => {
    const PAGE = 'page-3'
    const OTHER = 'page-other'
    pageStore.pages.push({
      id: PAGE, blockId: null, title: 'P3', type: 'normal', icon: null, cover: null,
      aliases: [], filePath: null, childrenCount: 0, wordCount: 0,
      createdAt: 0, updatedAt: 0, deleted: false, deletedAt: null
    } as any)
    pageStore.currentPageId = OTHER   // <-- mismatch

    const b = mkBlock(PAGE)
    blockStore.blocks.push(b as any)
    editorStore.activateBlock(BLOCK_ID)

    const node: TreeNode = { id: BLOCK_ID, block: b as any, children: [] }
    const w = mount(Block, { props: { node, pageId: PAGE, depth: 0 } })
    await flushPromises(); await nextTick()

    console.log('[3] blocksByPage(current).len =', blockStore.getBlocksByPage(pageStore.currentPageId).length)
    console.log('[3] placeholder =', w.find('.editor-placeholder').exists())
    w.unmount()
  })

  it('store content emptied externally after Editor mounted (hasContent staleness)', async () => {
    const PAGE = 'page-4'
    pageStore.pages.push({
      id: PAGE, blockId: null, title: 'P4', type: 'normal', icon: null, cover: null,
      aliases: [], filePath: null, childrenCount: 0, wordCount: 0,
      createdAt: 0, updatedAt: 0, deleted: false, deletedAt: null
    } as any)
    pageStore.currentPageId = PAGE

    const b = mkBlock(PAGE, BLOCK_ID, 'hello')
    blockStore.blocks.push(b as any)
    editorStore.activateBlock(BLOCK_ID)

    const node: TreeNode = { id: BLOCK_ID, block: b as any, children: [] }
    const w = mount(Block, { props: { node, pageId: PAGE, depth: 0 } })
    await flushPromises(); await nextTick()
    console.log('[4] before clear, placeholder =', w.find('.editor-placeholder').exists())

    // 外部（非 tiptap 输入）清空内容，例如撤销/同步/历史恢复
    ;(node.block as any).content = ''
    blockStore.blocks[0].content = ''
    await flushPromises(); await nextTick(); await nextTick()
    console.log('[4] after clear, blocksByPage.len =', blockStore.getBlocksByPage(PAGE).length,
      'content =', JSON.stringify(blockStore.blocks[0].content))
    console.log('[4] after clear, placeholder =', w.find('.editor-placeholder').exists())
    w.unmount()
  })
})
