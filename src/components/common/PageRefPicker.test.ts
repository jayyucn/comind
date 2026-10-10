/**
 * PageRefPicker（页面引用 picker）测试（issue T3 AC2）。
 *
 * 接缝：mock `src/wasm/client` 边界（ensurePagesLoaded 兜底路径会触达 client）；
 * pages store 全真，用例直接向 store 注入页面清单。
 * 覆盖：触发按钮三态（占位 / 标题反查 / 悬空 id 降级）、面板展开与排除已删页、
 * 搜索过滤、选中 emit（page id）并收起。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import type { Page } from '../../types/page'

vi.mock('../../wasm/client', () => ({
  initCoreClient: vi.fn(),
  getCoreClient: vi.fn(),
}))

function page(over: Partial<Page> & { id: string; title: string }): Page {
  return {
    blockId: null,
    type: 'normal',
    icon: null,
    cover: null,
    aliases: [],
    filePath: null,
    childrenCount: 0,
    wordCount: 0,
    createdAt: 1,
    updatedAt: 1,
    deleted: false,
    deletedAt: null,
    ...over,
  }
}

describe('PageRefPicker（页面引用 picker）', () => {
  let PageRefPicker: typeof import('./PageRefPicker.vue').default
  let usePageStore: typeof import('../../stores/pages').usePageStore

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.doMock('../../wasm/client', () => ({
      initCoreClient: vi.fn(),
      getCoreClient: vi.fn(),
    }))
    PageRefPicker = (await import('./PageRefPicker.vue')).default
    usePageStore = (await import('../../stores/pages')).usePageStore
    document.body.innerHTML = ''
  })

  function mountPicker(modelValue?: string) {
    return mount(PageRefPicker, { props: { modelValue, placeholder: '选择页面' } })
  }

  it('未选值：触发按钮显示占位符', () => {
    const wrapper = mountPicker()
    const trigger = wrapper.find('[data-testid="prp-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.text()).toBe('选择页面')
  })

  it('已选值：触发按钮显示目标页标题（page id 反查）', () => {
    usePageStore().pages.push(page({ id: 'p1', title: '目标页' }))
    const wrapper = mountPicker('p1')
    expect(wrapper.find('[data-testid="prp-trigger"]').text()).toBe('目标页')
  })

  it('已选值悬空 id：触发按钮降级显示原始 id', () => {
    const wrapper = mountPicker('p-missing')
    expect(wrapper.find('[data-testid="prp-trigger"]').text()).toBe('p-missing')
  })

  it('展开面板：列出候选页面（排除已删页）', async () => {
    usePageStore().pages.push(
      page({ id: 'p1', title: '页面甲' }),
      page({ id: 'p2', title: '页面乙' }),
      page({ id: 'p3', title: '已删页', deleted: true }),
    )
    const wrapper = mountPicker()
    await wrapper.find('[data-testid="prp-trigger"]').trigger('click')
    await flushPromises()

    const options = document.body.querySelectorAll('.prp-option')
    expect(options).toHaveLength(2)
    expect(document.body.querySelector('[data-testid="prp-search"]')).not.toBeNull()
    wrapper.unmount()
  })

  it('搜索过滤：按标题子串匹配（大小写不敏感）', async () => {
    usePageStore().pages.push(
      page({ id: 'p1', title: '读书笔记' }),
      page({ id: 'p2', title: '项目计划' }),
    )
    const wrapper = mountPicker()
    await wrapper.find('[data-testid="prp-trigger"]').trigger('click')
    await flushPromises()

    const search = document.body.querySelector('[data-testid="prp-search"]') as HTMLInputElement
    search.value = '笔记'
    search.dispatchEvent(new Event('input'))
    await flushPromises()

    const options = document.body.querySelectorAll('.prp-option')
    expect(options).toHaveLength(1)
    expect(options[0].getAttribute('data-page-id')).toBe('p1')
    wrapper.unmount()
  })

  it('无匹配：面板出「无匹配页面」空态', async () => {
    usePageStore().pages.push(page({ id: 'p1', title: '页面甲' }))
    const wrapper = mountPicker()
    await wrapper.find('[data-testid="prp-trigger"]').trigger('click')
    await flushPromises()

    const search = document.body.querySelector('[data-testid="prp-search"]') as HTMLInputElement
    search.value = '不存在的页'
    search.dispatchEvent(new Event('input'))
    await flushPromises()

    expect(document.body.querySelectorAll('.prp-option')).toHaveLength(0)
    expect(document.body.querySelector('.prp-empty')?.textContent).toContain('无匹配页面')
    wrapper.unmount()
  })

  it('选中候选：emit update:modelValue（page id）并收起面板', async () => {
    usePageStore().pages.push(
      page({ id: 'p1', title: '页面甲' }),
      page({ id: 'p2', title: '页面乙' }),
    )
    const wrapper = mountPicker()
    await wrapper.find('[data-testid="prp-trigger"]').trigger('click')
    await flushPromises()

    ;(document.body.querySelectorAll('.prp-option')[1] as HTMLElement).click()
    await flushPromises()

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['p2'])
    expect(document.body.querySelector('.prp-panel')).toBeNull()
    wrapper.unmount()
  })

  // ── personOnly 过滤（issue T10 负责人字段）────────────────────

  /** personOnly 桩：person 页 = 主页块挂了 'person' 标签（判据 utils/person-page）。 */
  async function mountPersonPicker(modelValue?: string) {
    const { useBlockStore } = await import('../../stores/blocks')
    const blockStore = useBlockStore()
    blockStore.blocks.push(
      { id: 'blk-person', pageId: 'pg1', parentId: null, pos: 0, content: '', format: {}, type: 'bullet', tags: ['person'], createdAt: 1, updatedAt: 1 },
      { id: 'blk-other', pageId: 'pg2', parentId: null, pos: 0, content: '', format: {}, type: 'bullet', tags: ['project'], createdAt: 1, updatedAt: 1 },
    )
    usePageStore().pages.push(
      page({ id: 'p-person', title: '张三', blockId: 'blk-person' }),
      page({ id: 'p-other', title: '项目页', blockId: 'blk-other' }),
      page({ id: 'p-noblock', title: '随笔页', blockId: null }),
    )
    return mount(PageRefPicker, { props: { personOnly: true, modelValue, placeholder: '选择人员' } })
  }

  it('personOnly：候选列表仅显示 person 页（主页块挂 person 标签）', async () => {
    const wrapper = await mountPersonPicker()
    await wrapper.find('[data-testid="prp-trigger"]').trigger('click')
    await flushPromises()

    const options = [...document.body.querySelectorAll('.prp-option')]
    expect(options).toHaveLength(1)
    expect(options[0].getAttribute('data-page-id')).toBe('p-person')
    wrapper.unmount()
  })

  it('personOnly：无候选时出「暂无可选人员」空态', async () => {
    const { useBlockStore } = await import('../../stores/blocks')
    useBlockStore().blocks.push(
      { id: 'blk-x', pageId: 'pg2', parentId: null, pos: 0, content: '', format: {}, type: 'bullet', tags: ['project'], createdAt: 1, updatedAt: 1 },
    )
    usePageStore().pages.push(page({ id: 'p-other', title: '项目页', blockId: 'blk-x' }))
    const wrapper = mount(PageRefPicker, { props: { personOnly: true } })
    await wrapper.find('[data-testid="prp-trigger"]').trigger('click')
    await flushPromises()

    expect(document.body.querySelectorAll('.prp-option')).toHaveLength(0)
    expect(document.body.querySelector('.prp-empty')?.textContent).toContain('暂无可选人员')
    wrapper.unmount()
  })

  it('personOnly：personOnly=false 时不过滤（原路径零回归）', async () => {
    const { useBlockStore } = await import('../../stores/blocks')
    const blockStore = useBlockStore()
    blockStore.blocks.push(
      { id: 'blk-person', pageId: 'pg1', parentId: null, pos: 0, content: '', format: {}, type: 'bullet', tags: ['person'], createdAt: 1, updatedAt: 1 },
    )
    usePageStore().pages.push(
      page({ id: 'p-person', title: '张三', blockId: 'blk-person' }),
      page({ id: 'p-noblock', title: '随笔页', blockId: null }),
    )
    const wrapper = mountPicker()
    await wrapper.find('[data-testid="prp-trigger"]').trigger('click')
    await flushPromises()

    expect(document.body.querySelectorAll('.prp-option')).toHaveLength(2)
    wrapper.unmount()
  })
})
