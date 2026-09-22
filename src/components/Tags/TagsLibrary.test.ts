/**
 * 标签管理页测试（ADR-0050 D5）。
 *
 * 接缝：只 mock `src/wasm/client` 边界，tags / blockCard 两个真 store + 页面组件全真
 * （先例：`stores/__tests__/blockCard.test.ts` 的边界 mock × `TaskHub.test.ts` 的页面级 mount）。
 * 解析结果（有效字段 / 后代闭包）由 mock 按 Rust 契约喂入 —— 本测试只验页面消费与写意图，
 * Rust 侧解析与环守卫另由 `cargo test -p comind-core` 覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import type { PersistedTagTreeEntry, PersistedFieldDefinition } from '../../types/tag-persisted'
import type { BlockCard } from '../../wasm/types'

const { mockInitCoreClient, mockClient } = vi.hoisted(() => {
  const mockClient = {
    getTagTree: vi.fn(),
    getFieldDefinitions: vi.fn(),
    createTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    setTagParent: vi.fn(),
    createFieldDefinition: vi.fn(),
    getBlockCards: vi.fn(),
  }
  return { mockInitCoreClient: vi.fn(), mockClient }
})

vi.mock('../../wasm/client', () => ({
  initCoreClient: mockInitCoreClient,
  getCoreClient: vi.fn(),
}))

function treeEntry(
  over: Partial<PersistedTagTreeEntry> & { id: string; title: string },
): PersistedTagTreeEntry {
  return {
    field_ids: [],
    parent_id: null,
    is_system: false,
    created_at: 1,
    updated_at: 1,
    version: 0,
    deleted_at: null,
    effective_field_ids: [],
    descendant_ids: [],
    ...over,
  }
}

function fieldDef(
  over: Partial<PersistedFieldDefinition> & { id: string; title: string },
): PersistedFieldDefinition {
  return {
    key: over.id,
    type: 'string',
    closed_values: null,
    is_system: false,
    created_at: 1,
    updated_at: 1,
    version: 0,
    deleted_at: null,
    ...over,
  }
}

function makeCard(over: Partial<BlockCard> = {}): BlockCard {
  return {
    block_id: 'block-1',
    page_id: 'page-1',
    parent_id: 'page-1',
    content_preview: 'Test content',
    properties: {},
    date_refs: [],
    tags: [],
    updated_at: 1000,
    created_at: 1000,
    ...over,
  }
}

const SYSTEM_TASK = treeEntry({
  id: 'sys-tag-system-task',
  title: '系统任务',
  field_ids: ['f-status'],
  is_system: true,
  effective_field_ids: ['f-status'],
})

const PROJECT = treeEntry({
  id: 't-project',
  title: '项目',
  field_ids: ['f-owner'],
  descendant_ids: ['t-dev'],
})
const DEV_TASK = treeEntry({
  id: 't-dev',
  title: '开发任务',
  field_ids: ['f-estimate'],
  parent_id: 't-project',
  effective_field_ids: ['f-estimate', 'f-owner'],
})

describe('TagsLibrary（标签管理页）', () => {
  let TagsLibrary: typeof import('./TagsLibrary.vue').default

  beforeEach(async () => {
    vi.resetModules()
    setActivePinia(createPinia())
    vi.clearAllMocks()

    vi.doMock('../../wasm/client', () => ({
      initCoreClient: mockInitCoreClient,
      getCoreClient: vi.fn(),
    }))

    TagsLibrary = (await import('./TagsLibrary.vue')).default

    mockClient.getTagTree.mockResolvedValue([SYSTEM_TASK, PROJECT, DEV_TASK])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-status', title: '状态', is_system: true }),
      fieldDef({ id: 'f-owner', title: '负责人', type: 'string' }),
      fieldDef({ id: 'f-estimate', title: '工时', type: 'number' }),
    ])
    mockClient.getBlockCards.mockResolvedValue([
      makeCard({ block_id: 'a', page_id: 'page-1', tags: ['t-project'] }),
      makeCard({ block_id: 'b', page_id: 'page-2', tags: ['t-dev'] }),
      makeCard({ block_id: 'c', page_id: 'page-2', tags: ['sys-tag-system-task'] }),
    ])
    mockInitCoreClient.mockResolvedValue(mockClient)
  })

  async function mountPage() {
    const wrapper = mount(TagsLibrary, { attachTo: document.body })
    await flushPromises()
    return wrapper
  }

  function texts(wrapper: { findAll: (s: string) => { text: () => string }[] }, sel: string) {
    return wrapper.findAll(sel).map((n) => n.text())
  }

  function findButton(wrapper: ReturnType<typeof mount>, label: string) {
    return wrapper.findAll('button').find((b) => b.text().includes(label))
  }

  // ── 列表 ──

  it('渲染标签总数 / 带父标签数 / 成员总数 的统计副标题', async () => {
    const wrapper = await mountPage()
    // 3 个标签 · 1 个带父标签（开发任务） · 成员总数 = 直系成员数之和 = 3
    expect(wrapper.text()).toContain('3 个标签')
    expect(wrapper.text()).toContain('1 个带父标签')
    expect(wrapper.text()).toContain('3 个成员')
  })

  it('每行显示 成员数 / 字段数 / 来源（顶级、←父名、未使用）', async () => {
    const wrapper = await mountPage()
    const rows = texts(wrapper, '.tag-row')

    expect(rows[0]).toContain('#系统任务')
    expect(rows[0]).toContain('1 成员')
    expect(rows[0]).toContain('1 个字段')
    expect(rows[0]).toContain('顶级标签')

    expect(rows[1]).toContain('#项目')
    expect(rows[2]).toContain('#开发任务')
    // 开发任务的来源显示父名
    expect(rows[2]).toContain('← 项目')
  })

  it('「未使用」筛选只留直系成员为 0 的标签', async () => {
    const wrapper = await mountPage()
    await findButton(wrapper, '未使用')!.trigger('click')
    await flushPromises()

    const rows = texts(wrapper, '.tag-row')
    expect(rows).toEqual([])
  })

  it('搜索按标题过滤', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-search-input').setValue('开发')
    await flushPromises()

    const rows = texts(wrapper, '.tag-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('#开发任务')
  })

  // ── 详情 ──

  it('选中标签后右栏显示成员/来源页统计与字段模板（区分自身与继承）', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const detail = wrapper.find('.tag-detail').text()
    // 直系口径：1 个成员 · 来自 1 个页面
    expect(detail).toContain('1 个成员')
    expect(detail).toContain('来自 1 个页面')

    const fieldRows = texts(wrapper, '.tag-detail .tag-field-row')
    expect(fieldRows[0]).toContain('工时')
    expect(fieldRows[0]).toContain('自身')
    expect(fieldRows[1]).toContain('负责人')
    expect(fieldRows[1]).toContain('继承 ← 项目')
  })

  it('系统标签不提供删除入口', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--sys-tag-system-task').trigger('click')
    await flushPromises()

    expect(wrapper.find('.tag-detail').text()).toContain('#系统任务')
    expect(findButton(wrapper, '删除标签')).toBeUndefined()
  })

  // ── 写：新建 / 设父 / 删除 / 字段模板 ──

  it('新建标签：弹层填标题 + 选父后调 createTag', async () => {
    mockClient.createTag.mockResolvedValue(treeEntry({ id: 't-new', title: '读书' }))
    const wrapper = await mountPage()

    await findButton(wrapper, '新建标签')!.trigger('click')
    await flushPromises()

    const body = document.body
    const titleInput = body.querySelector('.tag-create-title') as HTMLInputElement
    expect(titleInput).toBeTruthy()
    titleInput.value = '读书'
    titleInput.dispatchEvent(new Event('input'))
    await flushPromises()

    const confirm = body.querySelector('.tag-create-confirm') as HTMLButtonElement
    confirm.click()
    await flushPromises()

    expect(mockClient.createTag).toHaveBeenCalledWith({ title: '读书', parent_id: null })
  })

  it('新建标签：可选父标签一并写入', async () => {
    mockClient.createTag.mockResolvedValue(treeEntry({ id: 't-new', title: '读书' }))
    const wrapper = await mountPage()

    await findButton(wrapper, '新建标签')!.trigger('click')
    await flushPromises()

    const body = document.body
    const titleInput = body.querySelector('.tag-create-title') as HTMLInputElement
    titleInput.value = '读书'
    titleInput.dispatchEvent(new Event('input'))
    const parentSelect = body.querySelector('.tag-create-parent') as HTMLSelectElement
    parentSelect.value = 't-project'
    parentSelect.dispatchEvent(new Event('change'))
    await flushPromises()

    const confirm = body.querySelector('.tag-create-confirm') as HTMLButtonElement
    confirm.click()
    await flushPromises()

    expect(mockClient.createTag).toHaveBeenCalledWith({ title: '读书', parent_id: 't-project' })
  })

  it('继承区清除父：调 setTagParent 传 null', async () => {
    mockClient.setTagParent.mockResolvedValue(PROJECT)
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    // 详情里可清除/更换父标签
    const clearBtn = wrapper.find('.tag-parent-clear')
    expect(clearBtn.exists()).toBe(true)
    await clearBtn.trigger('click')
    await flushPromises()

    expect(mockClient.setTagParent).toHaveBeenCalledWith({ id: 't-dev', parent_id: null })
  })

  it('顶级标签可从候选里添加父标签（候选已排除自身与后代）', async () => {
    mockClient.setTagParent.mockResolvedValue(SYSTEM_TASK)
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-project').trigger('click')
    await flushPromises()

    const select = wrapper.find('.tag-parent-select')
    expect(select.exists()).toBe(true)
    // 项目 的后代是 开发任务 → 候选里不应出现它自己与开发任务
    expect(select.text()).toContain('系统任务')
    expect(select.text()).not.toContain('开发任务')

    await select.setValue('sys-tag-system-task')
    await flushPromises()

    expect(mockClient.setTagParent).toHaveBeenCalledWith({
      id: 't-project',
      parent_id: 'sys-tag-system-task',
    })
  })

  it('删除标签：先弹确认并告知影响，确认后才调 deleteTag', async () => {
    mockClient.deleteTag.mockResolvedValue(undefined)
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    await findButton(wrapper, '删除标签')!.trigger('click')
    await flushPromises()

    // 未确认前不落库
    expect(mockClient.deleteTag).not.toHaveBeenCalled()

    const dialog = document.body.querySelector('.dialog-card') as HTMLElement
    expect(dialog).toBeTruthy()
    expect(dialog.textContent).toContain('删除标签 #开发任务')
    // 影响告知：成员规模 + 「值保留、可复挂恢复」语义
    expect(dialog.textContent).toContain('1 个成员')
    expect(dialog.textContent).toContain('已填的值会保留')

    ;(dialog.querySelector('.btn-confirm') as HTMLButtonElement).click()
    await flushPromises()

    expect(mockClient.deleteTag).toHaveBeenCalledWith('t-dev')
  })

  it('删除确认取消时不删', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    await findButton(wrapper, '删除标签')!.trigger('click')
    await flushPromises()

    ;(document.body.querySelector('.btn-cancel') as HTMLButtonElement).click()
    await flushPromises()

    expect(mockClient.deleteTag).not.toHaveBeenCalled()
    expect(document.body.querySelector('.dialog-card')).toBeFalsy()
  })

  it('已有父时也可更换父标签（候选排除自身与后代）', async () => {
    mockClient.setTagParent.mockResolvedValue(SYSTEM_TASK)
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    expect(wrapper.find('.tag-parent-chip').text()).toContain('项目')

    const select = wrapper.find('.tag-parent-select')
    expect(select.exists()).toBe(true)
    expect(select.text()).toContain('系统任务')
    expect(select.text()).not.toContain('开发任务')

    await select.setValue('sys-tag-system-task')
    await flushPromises()

    expect(mockClient.setTagParent).toHaveBeenCalledWith({
      id: 't-dev',
      parent_id: 'sys-tag-system-task',
    })
  })

  it('添加字段：先建字段定义、再追加进该标签自身字段', async () => {
    mockClient.createFieldDefinition.mockResolvedValue(fieldDef({ id: 'def-new', title: '截止' }))
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-add-field').trigger('click')
    await flushPromises()

    const body = document.body
    const titleInput = body.querySelector('.tag-field-title-input') as HTMLInputElement
    titleInput.value = '截止'
    titleInput.dispatchEvent(new Event('input'))
    await flushPromises()

    const confirm = body.querySelector('.tag-field-confirm') as HTMLButtonElement
    confirm.click()
    await flushPromises()

    expect(mockClient.createFieldDefinition).toHaveBeenCalled()
    expect(mockClient.updateTag).toHaveBeenCalledWith({
      id: 't-dev',
      field_ids: ['f-estimate', 'def-new'],
    })
  })

  it('移除字段：只从该标签解除引用（不删字段定义）', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-detail .tag-field-remove').trigger('click')
    await flushPromises()

    expect(mockClient.updateTag).toHaveBeenCalledWith({ id: 't-dev', field_ids: [] })
    expect(mockClient.deleteTag).not.toHaveBeenCalled()
  })
})
