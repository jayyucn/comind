import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

// 在 BlockModal import 之前替换依赖：
// - Block 真实编辑器依赖 stores/router/CodeMirror，本测试只验"点击弹窗内 block 激活编辑器"、
//   头部展示所在 Page 标题、以及关闭时按激活态守卫调用 deactivateBlock
// - editor/blocks/pages 用最小 stub
const mocks = vi.hoisted(() => ({
  activateSpy: vi.fn(),
  deactivateSpy: vi.fn(),
  // 模拟 editorStore.activeBlockId 当前值（由测试在挂载前/关闭前改写）
  activeId: null as string | null,
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
  mocks.activeId = null
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
})
