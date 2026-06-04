import { describe, it, expect, vi, beforeEach } from 'vitest'
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
  // 模拟 BulletRender 的 v-html 输出：[[X]]^(depends-on)
  // typedStart=0, typedEnd=`[[X]]^(depends-on)`.length=21
  // relType=`depends-on`, labelFrom=21-10-1=10, labelTo=21
  const typed = '[[X]]^(depends-on)'
  const typedStart = content.indexOf(typed)
  const typedEnd = typedStart + typed.length
  const relType = 'depends-on'
  return (
    `<span class="block-link" data-page="X">X</span>` +
    `<span class="rel-type-label" data-rel-type="${relType}" ` +
    `data-block-id="${blockId}" ` +
    `data-typed-from="${typedStart}" data-typed-to="${typedEnd}" ` +
    `data-label-from="${typedEnd - relType.length - 1}" data-label-to="${typedEnd}">^依赖</span>`
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
  const ORIGINAL_CONTENT = 'prefix [[X]]^(depends-on) suffix'

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

    blockStore = useBlockStore()
    pageStore = usePageStore()
    await pageStore.createPage('Test Page', 'normal')
    // 重置 createPage 后的 currentPageId 副作用
    const created = pageStore.pages[pageStore.pages.length - 1]
    Object.defineProperty(pageStore, 'currentPageId', { value: created?.id ?? PAGE_ID, configurable: true })

    // 直接在 blockStore.blocks 注入测试 block
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
    // 默认选中索引指向 'parent'，改为 'references'（索引 4）
    menu.setSelectedIndex(4)
    const updateContentSpy = vi.spyOn(blockStore, 'updateBlockContent')
    menu.select()
    await flushPromises()

    expect(updateContentSpy).toHaveBeenCalledTimes(1)
    const [calledBlockId, calledContent] = updateContentSpy.mock.calls[0]
    expect(calledBlockId).toBe(BLOCK_ID)
    // ORIGINAL_CONTENT = 'prefix [[X]]^(depends-on) suffix' (32 chars)
    // typedStart=7, typedEnd=25, relType='depends-on' (10 chars)
    // labelFrom = 25 - 10 - 1 = 14，labelTo = 25
    // slice(0, 14) = 'prefix [[X]]^('，slice(25) = ' suffix'
    expect(calledContent).toBe('prefix [[X]]^(references suffix')
    expect(calledContent).not.toContain('depends-on')
    expect(calledContent).toContain('references')

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

    // 触发 .block-text 容器上、但 target 是 div 本身的点击（closest('.rel-type-label') 为 null, closest('.block-link') 为 null）
    const container = wrapper.find('.block-text')
    expect(container.exists()).toBe(true)
    await container.trigger('click')

    expect(menu.state.value.visible).toBe(false)

    wrapper.unmount()
  })
})
