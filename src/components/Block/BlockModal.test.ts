import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// jsdom 无 matchMedia；CodeMirrorEditor→useTheme 在模块级求值会调用它。
// 双态改造后 BlockModal 顶层 import IdeasSnapshotNode → BulletRender → code handler 链
// 被拉入本测试（此前 mock 掉 Block 不会触达），故与 Block/index.test.ts / TaskHub.test.ts 同款 stub。
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

// 在 BlockModal import 之前替换依赖：
// - Block 真实编辑器依赖 stores/router/CodeMirror，本测试只验"点击弹窗内 block 激活编辑器"、
//   头部展示所在 Page 标题、以及关闭时按激活态守卫调用 deactivateBlock
// - editor/blocks/pages 用最小 stub
const mocks = vi.hoisted(() => ({
  activateSpy: vi.fn(),
  deactivateSpy: vi.fn(),
  openBlockModalSpy: vi.fn(),
  // 关闭弹窗时应刷脏块卡投影，使任务视图（四象限/看板/表格）立即反映编辑结果
  refreshIfDirtySpy: vi.fn().mockResolvedValue(undefined),
  // 模拟 editorStore.activeBlockId 当前值（由测试在挂载前/关闭前改写）
  activeId: null as string | null,
  // 双态（ADR-0042 T6）：非空 = BlockModal 处于快照上下文（只读模式）
  snapshotOf: null as string | null,
  // 快照上下文内容源 fixture（page-hist 当日快照：单根块 b1）
  snapshotFixture: {
    blocks: [
      { id: 'b1', pageId: 'page-hist', parentId: null, pos: 0, content: '快照根内容', format: {}, type: 'bullet' },
    ],
    properties: {},
  },
  // 捕获 router.afterEach 注册的回调，供测试模拟「路由跳转」
  afterEachCb: null as null | ((to: unknown, from: unknown) => void),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    afterEach: (cb: (to: unknown, from: unknown) => void) => {
      mocks.afterEachCb = cb
      return () => {
        mocks.afterEachCb = null
      }
    },
  }),
}))

vi.mock('../../stores/editor', () => ({
  useEditorStore: () => ({
    activateBlock: mocks.activateSpy,
    get activeBlockId() {
      return mocks.activeId
    },
    deactivateBlock: mocks.deactivateSpy,
    get blockModalSnapshotOf() {
      return mocks.snapshotOf
    },
    openBlockModal: mocks.openBlockModalSpy,
  }),
}))

vi.mock('../../stores/blocks', () => ({
  useBlockStore: () => ({
    getBlock: (id: string) => (id ? { id, pageId: 'p1', parentId: null, pos: 0, content: 'x', format: {}, type: 'bullet' } : null),
    blocks: [{ id: 'b1', pageId: 'p1', parentId: null, pos: 0, content: 'x', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0 }],
    loadBlock: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock('../../stores/pages', () => ({
  usePageStore: () => ({
    getPage: (id: string) => (id ? { id, title: '我的项目' } : undefined),
    // 快照上下文内容源：历史 ideas 页当日 page_snapshots（只读，非活 store）
    getIdeasSnapshot: async (id: string) => (id ? mocks.snapshotFixture : null),
  }),
}))

// 弹窗关闭应刷脏块卡投影（blockCardStore.refreshIfDirty）；用最小 stub 避免真实 wasm 客户端调用
vi.mock('../../stores/blockCard', () => ({
  useBlockCardStore: () => ({
    refreshIfDirty: mocks.refreshIfDirtySpy,
  }),
}))

// Block stub 渲染带 data-block-id 的元素，供 onBodyClick 的 closest 命中
vi.mock('./index.vue', () => ({
  default: {
    name: 'BlockStub',
    props: ['node'],
    template: '<div class="block-stub" :data-block-id="node.id">stub content</div>',
  },
}))

import BlockModal from './BlockModal.vue'

beforeEach(() => {
  mocks.activateSpy.mockClear()
  mocks.deactivateSpy.mockClear()
  mocks.openBlockModalSpy.mockClear()
  mocks.refreshIfDirtySpy.mockClear()
  mocks.activeId = null
  mocks.snapshotOf = null
})

afterEach(() => {
  mocks.afterEachCb = null
  document.body.querySelectorAll('.block-modal-overlay').forEach((n) => n.remove())
})

describe('BlockModal edit activation', () => {
  it('renders the Block for the given blockId', () => {
    mount(BlockModal, { props: { blockId: 'b1' } })
    const stub = document.body.querySelector('.block-stub')
    expect(stub).toBeTruthy()
    expect(stub?.getAttribute('data-block-id')).toBe('b1')
  })

  // 回归：弹窗内 Block 没有 BlockList 包裹，原本点击不会激活编辑器，
  // 导致内容始终停留在只读渲染态、无法编辑。修复后点击应触发 activateBlock。
  it('activates the block editor when its content is clicked inside the modal body', async () => {
    const wrapper = mount(BlockModal, { props: { blockId: 'b1' } })
    const stub = document.body.querySelector('.block-stub') as HTMLElement
    expect(stub).toBeTruthy()

    stub.click()
    await wrapper.vm.$nextTick()

    expect(mocks.activateSpy).toHaveBeenCalledWith('b1')
  })

  // 弹窗头部必须展示所在 Page 的标题
  it('shows the containing page title in the modal header', () => {
    mount(BlockModal, { props: { blockId: 'b1' } })
    const title = document.body.querySelector('.modal-title-page')
    expect(title).toBeTruthy()
    expect(title?.textContent).toBe('我的项目')
  })

  // 关闭时若当前激活的正是该 block，应清掉激活态（deactivateBlock）
  it('deactivates the block on close when it is the active one', async () => {
    mocks.activeId = 'b1'
    const wrapper = mount(BlockModal, { props: { blockId: 'b1' } })
    const closeBtn = document.body.querySelector('[data-testid="block-modal-close"]') as HTMLElement
    expect(closeBtn).toBeTruthy()

    closeBtn.click()
    await wrapper.vm.$nextTick()

    expect(mocks.deactivateSpy).toHaveBeenCalled()
  })

  // 守卫：若激活的是别的 block，关闭本弹窗不应误清别人的激活态
  it('does not deactivate on close when a different block is active', async () => {
    mocks.activeId = 'other'
    const wrapper = mount(BlockModal, { props: { blockId: 'b1' } })
    const closeBtn = document.body.querySelector('[data-testid="block-modal-close"]') as HTMLElement
    expect(closeBtn).toBeTruthy()

    closeBtn.click()
    await wrapper.vm.$nextTick()

    expect(mocks.deactivateSpy).not.toHaveBeenCalled()
  })

  // 回归：弹窗内点击 [[page]] 链接会触发路由跳转，弹窗作为临时预览层应在导航后关闭，
  // 避免跳转后弹窗仍悬浮在新页面之上（Issue 1）。
  it('closes the modal when the route changes (e.g. a [[page]] link clicked inside)', async () => {
    const wrapper = mount(BlockModal, { props: { blockId: 'b1' } })
    expect(mocks.afterEachCb).toBeTruthy()

    // 模拟路由跳转（wiki 链接 / 侧边栏导航等都会触发 afterEach）
    mocks.afterEachCb?.({}, {})
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  // 回归（本 bug）：弹窗内编辑内容/属性后关闭，必须刷脏块卡投影，
  // 否则四象限/看板/表格等视图仍显示陈旧的任务内容。
  it('refreshes the block card projection on close so task views reflect edits', async () => {
    const wrapper = mount(BlockModal, { props: { blockId: 'b1' } })
    const closeBtn = document.body.querySelector('[data-testid="block-modal-close"]') as HTMLElement
    expect(closeBtn).toBeTruthy()

    closeBtn.click()
    await flushPromises()

    expect(mocks.refreshIfDirtySpy).toHaveBeenCalled()
  })
})

// ── 双态（ADR-0042 T6）：快照上下文 = 从 page_snapshots 只读渲染，无任何写通路 ──
describe('BlockModal snapshot context', () => {
  it('renders the read-only IdeasSnapshotNode subtree from snapshot data', async () => {
    mocks.snapshotOf = 'page-hist'
    mount(BlockModal, { props: { blockId: 'b1' } })
    await flushPromises()

    // 内容源 = 快照 fixture（快照根内容），非活 store；头部出现只读标记
    expect(document.body.textContent).toContain('快照根内容')
    expect(document.body.textContent).toContain('快照只读')
    // 快照模式不渲染活 Block 编辑器（.block-stub 为活 Block 的 stub）
    expect(document.body.querySelector('.block-stub')).toBeNull()
  })

  it('does not activate any block when the snapshot body is clicked', async () => {
    mocks.snapshotOf = 'page-hist'
    const wrapper = mount(BlockModal, { props: { blockId: 'b1' } })
    await flushPromises()

    const snapshotRow = document.body.querySelector('.snapshot-block') as HTMLElement
    expect(snapshotRow).toBeTruthy()
    snapshotRow.click()
    await wrapper.vm.$nextTick()

    expect(mocks.activateSpy).not.toHaveBeenCalled()
  })

  it('closing the read-only modal has no write side effects (no deactivate / refresh)', async () => {
    mocks.snapshotOf = 'page-hist'
    mocks.activeId = 'b1'
    const wrapper = mount(BlockModal, { props: { blockId: 'b1' } })
    await flushPromises()

    const closeBtn = document.body.querySelector('[data-testid="block-modal-close"]') as HTMLElement
    closeBtn.click()
    await flushPromises()

    expect(wrapper.emitted('close')).toBeTruthy()
    expect(mocks.deactivateSpy).not.toHaveBeenCalled()
    expect(mocks.refreshIfDirtySpy).not.toHaveBeenCalled()
  })

  it('does not recursively open another BlockModal when a dot inside the snapshot modal is clicked', async () => {
    mocks.snapshotOf = 'page-hist'
    mount(BlockModal, { props: { blockId: 'b1' } })
    await flushPromises()

    const dot = document.body.querySelector('.snapshot-block .bullet-dot') as HTMLElement
    expect(dot).toBeTruthy()
    dot.click()
    await flushPromises()

    expect(mocks.openBlockModalSpy).not.toHaveBeenCalled()
  })
})
