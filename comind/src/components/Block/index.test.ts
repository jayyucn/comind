import { describe, it, expect, vi, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

import Block from './index.vue'
import { useBlockStore } from '../../stores/blocks'
import { usePageStore } from '../../stores/pages'
import { useRelationshipMenu } from '../../composables/useRelationshipMenu'
import { useRelationshipTypes } from '../../composables/useRelationshipTypes'
import { db } from '../../storage/db'
import type { TreeNode } from '../../types/block'

vi.mock('../../storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn().mockResolvedValue(undefined),
    updateBlock: vi.fn().mockResolvedValue(undefined),
    updatePage: vi.fn().mockResolvedValue(undefined),
    deleteBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlockCascade: vi.fn().mockResolvedValue(undefined),
    getBlockTree: vi.fn().mockResolvedValue([]),
    getProperties: vi.fn().mockResolvedValue([]),
    createPageWithRootBlock: vi.fn().mockImplementation((title: string, type: 'normal' | 'journal') => ({
      id: `page-${Date.now()}-${Math.random()}`,
      title,
      type,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }))
  }
}))

vi.mock('../../composables/useNavigateToPage', () => ({
  useNavigateToPage: () => ({
    navigateToPage: vi.fn()
  })
}))

const STUB_RENDER_CONTENT = (content: string, blockId: string): string => {
  const typed = '((depends-on))[[X]]'
  const typedStart = content.indexOf(typed)
  const typedEnd = typedStart + typed.length
  const relType = 'depends-on'
  return (
    `<span class="rel-type-label" data-rel-type="${relType}" ` +
    `data-block-id="${blockId}" ` +
    `data-typed-from="${typedStart}" data-typed-to="${typedEnd}" ` +
    `data-label-from="${typedStart + 2}" data-label-to="${typedStart + 2 + relType.length}">—依赖→</span>` +
    `<span class="block-link" data-page="X">X</span>`
  )
}

const StubBulletRender = defineComponent({
  name: 'StubBulletRender',
  props: {
    content: { type: String, required: true },
    blockId: { type: String, required: true },
    showPlaceholder: { type: Boolean, default: false },
    readonly: { type: Boolean, default: false },
    properties: { type: Object, default: () => ({}) },
    language: { type: String, default: '' }
  },
  emits: ['content-click', 'language-change', 'clear'],
  setup(props, { emit }) {
    return () =>
      h('div', {
        class: 'block-text',
        onClick: (e: MouseEvent) => emit('content-click', e),
        innerHTML: STUB_RENDER_CONTENT(props.content, props.blockId)
      })
  }
})

describe('Block - rel-type-label click handling', () => {
  let blockStore: ReturnType<typeof useBlockStore>
  let pageStore: ReturnType<typeof usePageStore>
  let menu: ReturnType<typeof useRelationshipMenu>

  const BLOCK_ID = 'block-1'
  const PAGE_ID = 'page-1'
  const ORIGINAL_CONTENT = 'prefix ((depends-on))[[X]] suffix'

  function makeNode(): TreeNode {
    return {
      id: BLOCK_ID,
      block: {
        id: BLOCK_ID,
        pageId: PAGE_ID,
        parentId: null,
        pos: 1000,
        content: ORIGINAL_CONTENT,
        format: {},
        type: 'bullet',
        properties: {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      children: []
    }
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    await db.relationshipTypes.clear()
    const { _resetForTest, load } = useRelationshipTypes()
    _resetForTest()
    await load()

    blockStore = useBlockStore()
    pageStore = usePageStore()
    await pageStore.createPage('Test Page', 'normal')
    const created = pageStore.pages[pageStore.pages.length - 1]
    Object.defineProperty(pageStore, 'currentPageId', { value: created?.id ?? PAGE_ID, configurable: true })

    blockStore.blocks.push({
      id: BLOCK_ID,
      pageId: created?.id ?? PAGE_ID,
      parentId: null,
      pos: 1000,
      content: ORIGINAL_CONTENT,
      format: {},
      type: 'bullet',
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    })

    menu = useRelationshipMenu()
    menu.close()
  })

  it('点击 .rel-type-label 打开菜单并预选当前类型', async () => {
    const updateContentSpy = vi.spyOn(blockStore, 'updateBlockContent')

    const wrapper = mount(Block, {
      props: { node: makeNode(), pageId: PAGE_ID, depth: 0 },
      global: {
        stubs: {
          BulletRender: StubBulletRender
        }
      }
    })
    await flushPromises()

    const relLabel = wrapper.find('.rel-type-label')
    expect(relLabel.exists()).toBe(true)

    await relLabel.trigger('click')

    expect(menu.state.value.visible).toBe(true)
    expect(menu.state.value.currentType).toBe('depends-on')
    expect(menu.state.value.position).not.toBeNull()
    expect(updateContentSpy).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('选择新关系类型后通过 blockStore.updateBlockContent 更新内容', async () => {
    const wrapper = mount(Block, {
      props: { node: makeNode(), pageId: PAGE_ID, depth: 0 },
      global: {
        stubs: {
          BulletRender: StubBulletRender
        }
      }
    })
    await flushPromises()

    await wrapper.find('.rel-type-label').trigger('click')
    expect(menu.state.value.visible).toBe(true)
    menu.setSelectedGroupIndex(5)
    const updateContentSpy = vi.spyOn(blockStore, 'updateBlockContent')
    menu.select()
    await flushPromises()

    expect(updateContentSpy).toHaveBeenCalledTimes(1)
    const [calledBlockId, calledContent] = updateContentSpy.mock.calls[0]
    expect(calledBlockId).toBe(BLOCK_ID)
    expect(calledContent).toBe('prefix ((supports))[[X]] suffix')
    expect(calledContent).not.toContain('depends-on')
    expect(calledContent).toContain('supports')

    wrapper.unmount()
  })

  it('点击非 rel-type-label、非 block-link 元素不打开菜单', async () => {
    const wrapper = mount(Block, {
      props: { node: makeNode(), pageId: PAGE_ID, depth: 0 },
      global: {
        stubs: {
          BulletRender: StubBulletRender
        }
      }
    })
    await flushPromises()

    const container = wrapper.find('.block-text')
    expect(container.exists()).toBe(true)
    await container.trigger('click')

    expect(menu.state.value.visible).toBe(false)

    wrapper.unmount()
  })
})

describe('Block - handleDelete 关系清理集成', () => {
  let blockStore: ReturnType<typeof useBlockStore>
  let pageStore: ReturnType<typeof usePageStore>
  const PAGE_TITLE = 'P'
  const TARGET_TITLE = 'X'

  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    blockStore = useBlockStore()
    pageStore = usePageStore()
    await pageStore.createPage(PAGE_TITLE, 'normal')
    const ourPage = pageStore.pages[pageStore.pages.length - 1]
    await pageStore.createPage(TARGET_TITLE, 'normal')
    const targetPage = pageStore.pages[pageStore.pages.length - 1]
    Object.defineProperty(pageStore, 'currentPageId', { value: ourPage.id, configurable: true })

    blockStore.blocks.push({
      id: 'block-prev',
      pageId: ourPage.id,
      parentId: null,
      pos: 500,
      content: 'prev block',
      format: {},
      type: 'bullet',
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    blockStore.blocks.push({
      id: 'block-del',
      pageId: ourPage.id,
      parentId: null,
      pos: 1000,
      content: 'see ((depends-on<->required-by))[[X]]',
      format: {},
      type: 'bullet',
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    blockStore.blocks.push({
      id: 'block-target',
      pageId: targetPage.id,
      parentId: null,
      pos: 1000,
      content: 'reverse ((required-by))[[P]]',
      format: {},
      type: 'bullet',
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
  })

  it('删除带 typed-link 的 block 后应触发跨页反向降级', async () => {
    const blockDel = blockStore.blocks.find(b => b.id === 'block-del')!
    const wrapper = mount(Block, {
      props: {
        node: {
          id: 'block-del',
          block: blockDel,
          children: []
        },
        pageId: blockDel.pageId,
        depth: 0
      },
      global: {
        stubs: { BulletRender: StubBulletRender }
      }
    })
    await flushPromises()

    await (wrapper.vm as any).handleDelete()

    expect(blockStore.blocks.find(b => b.id === 'block-del')).toBeUndefined()
    const after = blockStore.blocks.find(b => b.id === 'block-target')
    expect(after?.content).toBe('reverse [[P]]')

    wrapper.unmount()
  })
})
