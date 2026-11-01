import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'

import { useTagsStore } from '../../../stores/tags'
import type { TreeNode } from '../../../types/block'
import IdeasSnapshotNode from '../IdeasSnapshotNode.vue'
import { SNAPSHOT_PROPS_KEY, SNAPSHOT_TREE_KEY } from '../snapshotContext'

// 快照节点依赖 router 家族的 composable（useRouter / getCoreClient），mock 掉只留导航断言
const mocks = vi.hoisted(() => ({
  navigateToPage: vi.fn().mockResolvedValue(undefined),
  navigateToTag: vi.fn().mockResolvedValue(undefined),
  openPageInOtherPane: vi.fn().mockResolvedValue(undefined),
  openBlockModal: vi.fn(),
}))

vi.mock('../../../composables/useNavigateToPage', () => ({
  useNavigateToPage: () => ({ navigateToPage: mocks.navigateToPage }),
}))

vi.mock('../../../composables/useNavigateToTag', () => ({
  useNavigateToTag: () => ({ navigateToTag: mocks.navigateToTag }),
}))

vi.mock('../../../composables/useOpenPageInOtherPane', () => ({
  useOpenPageInOtherPane: () => ({ openPageInOtherPane: mocks.openPageInOtherPane }),
}))

vi.mock('../../../stores/editor', () => ({
  useEditorStore: () => ({ openBlockModal: mocks.openBlockModal }),
}))

/** 单块快照树节点（无子块） */
function makeNode(content: string): TreeNode {
  return {
    id: 'b1',
    block: {
      id: 'b1',
      pageId: 'p-snapshot',
      parentId: null,
      pos: 0,
      content,
      format: {},
      type: 'bullet',
      createdAt: 0,
      updatedAt: 0,
    },
    children: [],
  }
}

function mountNode(node: TreeNode) {
  return mount(IdeasSnapshotNode, {
    props: { node, pageId: 'p-snapshot', depth: 0 },
    global: {
      provide: {
        [SNAPSHOT_PROPS_KEY]: {
          propsByBlock: {},
          getBlockProps: () => [],
        },
        [SNAPSHOT_TREE_KEY]: {
          isCollapsed: () => false,
          toggle: () => {},
        },
      },
    },
  })
}

/** 标签树就绪态：entries 直接写入 store（ensureLoaded 短路，不触达真 IPC） */
function seedTags(entries: { id: string; title: string }[]) {
  const tagsStore = useTagsStore()
  tagsStore.loaded = true
  tagsStore.entries = entries.map(e => ({
    id: e.id,
    title: e.title,
    field_ids: [],
    parent_id: null,
    description: '',
    color: '',
    is_system: 0,
    is_preset: 0,
    created_at: 0,
    updated_at: 0,
    version: 0,
    deleted_at: null,
    effective_field_ids: [],
    descendant_ids: [],
  })) as never
  return tagsStore
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('IdeasSnapshotNode — 只读快照内容区点击', () => {
  it('点 inline `#tag` chip → 标签聚合页（快照无 renderSegments，走兜底渲染只有标题）', async () => {
    seedTags([{ id: 't-1', title: '标签' }])
    const wrapper = mountNode(makeNode('这是 #标签'))

    const chip = wrapper.find('.block-tag')
    expect(chip.exists()).toBe(true)
    // 兜底 chip 不带 data-page：标签名绝不能当页面名
    expect(chip.attributes('data-page')).toBeUndefined()

    await chip.trigger('click')
    await flushPromises()

    expect(mocks.navigateToTag).toHaveBeenCalledWith('t-1')
    expect(mocks.navigateToPage).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('标签树里查无此 tag → 不导航（既不进聚合页，也不建页）', async () => {
    seedTags([])
    const wrapper = mountNode(makeNode('这是 #未落库'))

    await wrapper.find('.block-tag').trigger('click')
    await flushPromises()

    expect(mocks.navigateToTag).not.toHaveBeenCalled()
    expect(mocks.navigateToPage).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('点 wiki link 仍走页面导航（tag 分支不误拦）', async () => {
    seedTags([])
    const wrapper = mountNode(makeNode('查看 [[项目A]]'))

    await wrapper.find('.block-link').trigger('click')
    await flushPromises()

    expect(mocks.navigateToPage).toHaveBeenCalledWith('项目A')
    expect(mocks.navigateToTag).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
