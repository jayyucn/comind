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
import { useRelationshipTypes } from '../../composables/useRelationshipTypes'
import { cleanupRelationshipTypes, cleanupPages } from '../../../tests/core-client'
import type { TreeNode } from '../../types/block'
import { useEditorStore } from '../../stores/editor'
import { usePropertyStore } from '../../stores/property'

vi.mock('../../storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn().mockResolvedValue(undefined),
    updateBlock: vi.fn().mockResolvedValue(undefined),
    updatePage: vi.fn().mockResolvedValue(undefined),
    deleteBlock: vi.fn().mockResolvedValue(undefined),
    deleteBlockCascade: vi.fn().mockResolvedValue(undefined),
    getBlockTree: vi.fn().mockResolvedValue([]),
    getProperties: vi.fn().mockResolvedValue([]),
    createPageWithRootBlock: vi.fn().mockImplementation((title: string, type: 'normal' | 'ideas') => ({
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
  const ORIGINAL_CONTENT = 'prefix ((depends-on))[[X]] suffix'

  function makeNode(pageId: string): TreeNode {
    return {
      id: BLOCK_ID,
      block: {
        id: BLOCK_ID,
        pageId,
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

    await cleanupRelationshipTypes()
    await cleanupPages()
    const { _resetForTest, load } = useRelationshipTypes()
    _resetForTest()
    await load()

    blockStore = useBlockStore()
    pageStore = usePageStore()
    await pageStore.createPage('Test Page', 'normal')
    const created = pageStore.pages[pageStore.pages.length - 1]
    Object.defineProperty(pageStore, 'currentPageId', { value: created?.id, configurable: true })

    blockStore.blocks.push({
      id: BLOCK_ID,
      pageId: created?.id,
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

  afterEach(async () => {
    await cleanupPages()
  })

  it('点击 .rel-type-label 打开菜单并预选当前类型', async () => {
    const updateContentSpy = vi.spyOn(blockStore, 'updateBlockContent')
    const currentPageId = pageStore.currentPageId

    const wrapper = mount(Block, {
      props: { node: makeNode(currentPageId), pageId: currentPageId, depth: 0 },
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
    const currentPageId = pageStore.currentPageId
    const wrapper = mount(Block, {
      props: { node: makeNode(currentPageId), pageId: currentPageId, depth: 0 },
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
    const currentPageId = pageStore.currentPageId
    const wrapper = mount(Block, {
      props: { node: makeNode(currentPageId), pageId: currentPageId, depth: 0 },
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

    await cleanupRelationshipTypes()
    await cleanupPages()
    const { _resetForTest, load } = useRelationshipTypes()
    _resetForTest()
    await load()

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

// ── Stub components for characterization tests ──

const StubEditor = defineComponent({
  name: 'Editor',
  props: {
    blockId: { type: String, default: '' },
    content: { type: String, default: '' },
    showFullPlaceholder: { type: Boolean, default: false },
    properties: { type: Object, default: () => ({}) },
    language: { type: String, default: '' }
  },
  emits: ['save', 'split', 'merge', 'delete', 'indent', 'outdent', 'move-up', 'move-down', 'exit-edit', 'cursor-change', 'language-change'],
  setup(_, { expose }) {
    expose({
      getEditor: () => ({}),
      focus: () => {},
      focusAtCoords: () => {},
      markSaved: () => {},
      getText: () => '',
      syncContent: () => {},
      cancelDebouncedSave: () => {}
    })
    return () => h('div', { class: 'stub-editor' })
  }
})

const StubVueDraggable = defineComponent({
  name: 'VueDraggable',
  inheritAttrs: false,
  setup() {
    return () => h('div', { class: 'block-children' })
  }
})

// ── Characterization tests (lock existing behavior before refactor) ──

describe('characterization: render', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('renders block with data-block-id attribute', async () => {
    const blockStore = useBlockStore()
    blockStore.blocks = [{
      id: 'block-1', pageId: 'page-1', parentId: null, pos: 0,
      content: 'hello', format: {}, type: 'bullet',
      createdAt: 0, updatedAt: 0
    }]
    const node: TreeNode = {
      id: 'block-1',
      block: blockStore.blocks[0],
      children: []
    }
    const wrapper = mount(Block, {
      props: { node, pageId: 'page-1', depth: 0 },
      global: { stubs: { BulletRender: StubBulletRender } }
    })
    await flushPromises()
    expect(wrapper.find('.block').attributes('data-block-id')).toBe('block-1')
    wrapper.unmount()
  })

  it('applies priority class based on priority property', async () => {
    const blockStore = useBlockStore()
    const propertyStore = usePropertyStore()
    blockStore.blocks = [{
      id: 'block-1', pageId: 'page-1', parentId: null, pos: 0,
      content: '', format: {}, type: 'bullet',
      createdAt: 0, updatedAt: 0
    }]
    const node: TreeNode = {
      id: 'block-1',
      block: blockStore.blocks[0],
      children: []
    }
    const wrapper = mount(Block, {
      props: { node, pageId: 'page-1', depth: 0 },
      global: { stubs: { BulletRender: StubBulletRender } }
    })
    await flushPromises()
    propertyStore.propertiesByBlock.set('block-1', [{
      id: 'p1', blockId: 'block-1', key: 'priority', value: 'High',
      type: 'string' as const, sortOrder: 0, isHidden: false, isDeleted: false,
      schemaVersion: 1, createdAt: 0, updatedAt: 0
    }])
    await flushPromises()
    expect(wrapper.find('.block').classes()).toContain('priority-high')
    wrapper.unmount()
  })

  it('applies active class when block is activated', async () => {
    const blockStore = useBlockStore()
    const editorStore = useEditorStore()
    blockStore.blocks = [{
      id: 'block-1', pageId: 'page-1', parentId: null, pos: 0,
      content: '', format: {}, type: 'bullet',
      createdAt: 0, updatedAt: 0
    }]
    const node: TreeNode = {
      id: 'block-1',
      block: blockStore.blocks[0],
      children: []
    }
    const wrapper = mount(Block, {
      props: { node, pageId: 'page-1', depth: 0 },
      global: { stubs: { BulletRender: StubBulletRender, Editor: StubEditor } }
    })
    await flushPromises()
    editorStore.activateBlock('block-1')
    await flushPromises()
    expect(wrapper.find('.block').classes()).toContain('active')
    wrapper.unmount()
  })
})

describe('characterization: editor lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('calls setActiveEditor on activate', async () => {
    const blockStore = useBlockStore()
    const editorStore = useEditorStore()
    blockStore.blocks = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 0,
      content: '', format: {}, type: 'bullet',
      createdAt: 0, updatedAt: 0
    }]
    const setActiveEditorSpy = vi.spyOn(editorStore, 'setActiveEditor')
    const node: TreeNode = { id: 'b1', block: blockStore.blocks[0], children: [] }
    const wrapper = mount(Block, {
      props: { node, pageId: 'p1', depth: 0 },
      global: { stubs: { BulletRender: StubBulletRender, Editor: StubEditor } }
    })
    await flushPromises()
    editorStore.activateBlock('b1', 0)
    await flushPromises()
    await new Promise(r => requestAnimationFrame(r))
    await flushPromises()
    expect(setActiveEditorSpy).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('calls setActiveEditor(null) on deactivate', async () => {
    const blockStore = useBlockStore()
    const editorStore = useEditorStore()
    blockStore.blocks = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 0,
      content: '', format: {}, type: 'bullet',
      createdAt: 0, updatedAt: 0
    }]
    const setActiveEditorSpy = vi.spyOn(editorStore, 'setActiveEditor')
    const node: TreeNode = { id: 'b1', block: blockStore.blocks[0], children: [] }
    const wrapper = mount(Block, {
      props: { node, pageId: 'p1', depth: 0 },
      global: { stubs: { BulletRender: StubBulletRender, Editor: StubEditor } }
    })
    await flushPromises()
    editorStore.activateBlock('b1')
    await flushPromises()
    await new Promise(r => requestAnimationFrame(r))
    await flushPromises()
    setActiveEditorSpy.mockClear()
    editorStore.deactivateBlock()
    await flushPromises()
    expect(setActiveEditorSpy).toHaveBeenCalledWith(null)
    wrapper.unmount()
  })
})

describe('characterization: save', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('saving editor content calls updateBlockContent', async () => {
    const blockStore = useBlockStore()
    const editorStore = useEditorStore()
    const updateSpy = vi.spyOn(blockStore, 'updateBlockContent').mockResolvedValue(undefined)
    blockStore.blocks = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 0,
      content: 'old', format: {}, type: 'bullet',
      createdAt: 0, updatedAt: 0
    }]
    const node: TreeNode = { id: 'b1', block: blockStore.blocks[0], children: [] }
    const wrapper = mount(Block, {
      props: { node, pageId: 'p1', depth: 0 },
      global: { stubs: { BulletRender: StubBulletRender, Editor: StubEditor } }
    })
    await flushPromises()
    editorStore.activateBlock('b1', 0)
    await flushPromises()
    await new Promise(r => requestAnimationFrame(r))
    const editor = wrapper.findComponent({ name: 'Editor' })
    expect(editor.exists()).toBe(true)
    editor.vm.$emit('save', 'new content')
    await flushPromises()
    expect(updateSpy).toHaveBeenCalledWith('b1', 'new content')
    wrapper.unmount()
  })
})

describe('characterization: delete', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('deleting block with no previous block clears content', async () => {
    const blockStore = useBlockStore()
    const editorStore = useEditorStore()
    const updateSpy = vi.spyOn(blockStore, 'updateBlockContent').mockResolvedValue(undefined)
    blockStore.blocks = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 0,
      content: 'text', format: {}, type: 'bullet',
      createdAt: 0, updatedAt: 0
    }]
    vi.spyOn(blockStore, 'findPreviousBlockInTreeOrder').mockReturnValue(undefined)
    const node: TreeNode = { id: 'b1', block: blockStore.blocks[0], children: [] }
    const wrapper = mount(Block, {
      props: { node, pageId: 'p1', depth: 0 },
      global: { stubs: { BulletRender: StubBulletRender, Editor: StubEditor } }
    })
    await flushPromises()
    editorStore.activateBlock('b1')
    await flushPromises()
    await new Promise(r => requestAnimationFrame(r))
    const editor = wrapper.findComponent({ name: 'Editor' })
    expect(editor.exists()).toBe(true)
    editor.vm.$emit('delete')
    await flushPromises()
    expect(updateSpy).toHaveBeenCalledWith('b1', '')
    wrapper.unmount()
  })

  it('deleting block with previous block activates previous and cleans up relationships', async () => {
    const blockStore = useBlockStore()
    const editorStore = useEditorStore()
    const deleteSpy = vi.spyOn(blockStore, 'deleteBlocks').mockResolvedValue(undefined)
    blockStore.blocks = [
      { id: 'prev', pageId: 'p1', parentId: null, pos: 0, content: 'prev', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0 },
      { id: 'b1', pageId: 'p1', parentId: null, pos: 1, content: 'text', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0 }
    ]
    vi.spyOn(blockStore, 'findPreviousBlockInTreeOrder').mockReturnValue(blockStore.blocks[0])
    const node: TreeNode = { id: 'b1', block: blockStore.blocks[1], children: [] }
    const wrapper = mount(Block, {
      props: { node, pageId: 'p1', depth: 0 },
      global: { stubs: { BulletRender: StubBulletRender, Editor: StubEditor } }
    })
    await flushPromises()
    const activateSpy = vi.spyOn(editorStore, 'activateBlock')
    editorStore.activateBlock('b1')
    await flushPromises()
    await new Promise(r => requestAnimationFrame(r))
    const editor = wrapper.findComponent({ name: 'Editor' })
    expect(editor.exists()).toBe(true)
    editor.vm.$emit('delete')
    await flushPromises()
    expect(deleteSpy).toHaveBeenCalledWith(['b1'])
    expect(activateSpy).toHaveBeenCalledWith('prev')
    wrapper.unmount()
  })
})

describe('characterization: collapse', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('clicking bullet toggles collapsed and persists format', async () => {
    const blockStore = useBlockStore()
    const updateFormatSpy = vi.spyOn(blockStore, 'updateBlockFormat').mockResolvedValue(undefined)
    const childBlock = {
      id: 'b2', pageId: 'p1', parentId: 'b1', pos: 0,
      content: '', format: {}, type: 'bullet' as const,
      createdAt: 0, updatedAt: 0
    }
    blockStore.blocks = [
      { id: 'b1', pageId: 'p1', parentId: null, pos: 0, content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0 },
      childBlock
    ]
    const node: TreeNode = {
      id: 'b1',
      block: blockStore.blocks[0],
      children: [{ id: 'b2', block: childBlock, children: [] }]
    }
    const wrapper = mount(Block, {
      props: { node, pageId: 'p1', depth: 0 },
      global: {
        stubs: {
          BulletRender: StubBulletRender,
          VueDraggable: StubVueDraggable
        }
      }
    })
    await flushPromises()
    const bullet = wrapper.find('.block-bullet')
    await bullet.trigger('click')
    await flushPromises()
    expect(updateFormatSpy).toHaveBeenCalledWith('b1', { collapsed: true })
    wrapper.unmount()
  })
})

// NOTE: Drag-drop behavior (handleDragMove circular detection, handleBlockDragEnd
// calling moveBlock) is covered by Playwright e2e tests in Task 4
// (tests/block-drag-drop.spec.ts). Unit-testing vue-draggable-plus event flow
// in jsdom is unreliable and would couple to internal function names that will
// move to useBlockDragDrop composable in commit 4.
