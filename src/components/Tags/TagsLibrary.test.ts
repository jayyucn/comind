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
import TagsLibrary from './TagsLibrary.vue'

const { mockInitCoreClient, mockClient, navigateToTagMock } = vi.hoisted(() => {
  const mockClient = {
    getTagTree: vi.fn(),
    getFieldDefinitions: vi.fn(),
    createTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    setTagParent: vi.fn(),
    createFieldDefinition: vi.fn(),
    updateFieldDefinition: vi.fn(),
    getBlockCards: vi.fn(),
  }
  return { mockInitCoreClient: vi.fn(), mockClient, navigateToTagMock: vi.fn().mockResolvedValue(undefined) }
})

vi.mock('../../wasm/client', () => ({
  initCoreClient: mockInitCoreClient,
  getCoreClient: vi.fn(),
}))

// 导航工具依赖 vue-router（本文件不装路由）→ 边界桩替换。
vi.mock('../../composables/useNavigateToTag', () => ({
  useNavigateToTag: () => ({
    navigateToTag: navigateToTagMock,
    navigateToTagLibrary: vi.fn(),
  }),
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

/** 项目：自身 1 个字段（负责人），后代 = 开发任务。 */
const PROJECT = treeEntry({
  id: 't-project',
  title: '项目',
  field_ids: ['f-owner'],
  effective_field_ids: ['f-owner'],
  descendant_ids: ['t-dev'],
})

/** 开发任务：自身只有工时，但从 项目 继承到负责人 → 有效字段 2 个。 */
const DEV_TASK = treeEntry({
  id: 't-dev',
  title: '开发任务',
  field_ids: ['f-estimate'],
  parent_id: 't-project',
  effective_field_ids: ['f-estimate', 'f-owner'],
})

/** 零成员标签：来源显示「未使用」，只在「未使用」筛选里出现；另挂一个历史遗留类型的字段（布尔）。 */
const IDEA = treeEntry({
  id: 't-idea',
  title: '灵感碎片',
  field_ids: ['f-pinned'],
  effective_field_ids: ['f-pinned'],
})

describe('TagsLibrary（标签管理页）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    mockClient.getTagTree.mockResolvedValue([SYSTEM_TASK, PROJECT, DEV_TASK, IDEA])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-status', title: '状态', is_system: true }),
      // 负责人做成「下拉选择」（type string + closed_values）——供降级用例取证
      fieldDef({ id: 'f-owner', title: '负责人', type: 'string', closed_values: ['张三', '李四'] }),
      fieldDef({ id: 'f-estimate', title: '工时', type: 'number' }),
      // 历史遗留类型：不在类型点选表内
      fieldDef({ id: 'f-pinned', title: '置顶', type: 'boolean' }),
    ])
    // 直系成员数：项目 3 / 开发任务 2 / 系统任务 1 / 灵感碎片 0 —— 互不相同，
    // 让「成员数降序」成为一个可判定的断言（不依赖标题排序的 locale 规则）。
    mockClient.getBlockCards.mockResolvedValue([
      makeCard({ block_id: 'a', page_id: 'page-1', tags: ['t-project'] }),
      makeCard({ block_id: 'a2', page_id: 'page-2', tags: ['t-project'] }),
      makeCard({ block_id: 'a3', page_id: 'page-3', tags: ['t-project'] }),
      makeCard({ block_id: 'b', page_id: 'page-2', tags: ['t-dev'] }),
      makeCard({ block_id: 'b2', page_id: 'page-4', tags: ['t-dev'] }),
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
    // 4 个标签 · 1 个带父标签（开发任务） · 直系成员数之和 = 3+2+1+0
    expect(wrapper.find('.page-title-subtitle').text()).toBe('4 个标签 · 1 个带父标签 · 6 个成员')
  })

  it('筛选胶囊带计数（全部 / 未使用），最近使用不带计数', async () => {
    const wrapper = await mountPage()
    const chips = texts(wrapper, '.tag-filter-chip')
    expect(chips[0]).toBe('全部 4')
    expect(chips[1]).toBe('最近使用')
    expect(chips[2]).toBe('未使用 1')
  })

  it('行按直系成员数降序，且字段数是有效口径（含继承）', async () => {
    const wrapper = await mountPage()
    const rows = texts(wrapper, '.tag-row')

    expect(rows).toHaveLength(4)
    expect(rows[0]).toContain('#项目')
    expect(rows[0]).toContain('3 个成员')
    expect(rows[0]).toContain('1 个字段')
    expect(rows[1]).toContain('#开发任务')
    expect(rows[1]).toContain('2 个成员')
    // 开发任务自身只有 1 个字段（工时），有效字段 2 个（+ 继承自项目的负责人）
    expect(rows[1]).toContain('2 个字段')
    expect(rows[2]).toContain('#系统任务')
    expect(rows[3]).toContain('#灵感碎片')
  })

  it('来源列区分 顶级标签 / ← 父名 / 未使用', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('.tag-row--t-project .tag-row-source').text()).toBe('顶级标签')
    expect(wrapper.find('.tag-row--t-dev .tag-row-source').text()).toBe('← 项目')
    expect(wrapper.find('.tag-row--t-idea .tag-row-source').text()).toBe('未使用')
  })

  it('「未使用」筛选只留直系成员为 0 的标签', async () => {
    const wrapper = await mountPage()
    await findButton(wrapper, '未使用')!.trigger('click')
    await flushPromises()

    const rows = texts(wrapper, '.tag-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('#灵感碎片')
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
    // 直系口径：2 个成员 · 来自 2 个页面（page-2 / page-4）
    expect(detail).toContain('2 个成员')
    expect(detail).toContain('来自 2 个页面')

    const fieldRows = texts(wrapper, '.tag-detail .tag-field-row')
    expect(fieldRows[0]).toContain('工时')
    expect(fieldRows[0]).toContain('自身')
    expect(fieldRows[1]).toContain('负责人')
    expect(fieldRows[1]).toContain('继承 ← 项目')
  })

  it('右栏提供进该标签聚合页的入口', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-detail-open').trigger('click')
    await flushPromises()

    expect(navigateToTagMock).toHaveBeenCalledWith('t-dev')
  })

  it('系统标签右栏只读：字段/继承/删除一律不给写入口', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--sys-tag-system-task').trigger('click')
    await flushPromises()

    expect(wrapper.find('.tag-detail').text()).toContain('#系统任务')
    // 只读说明在，写入口全无 —— 否则点了会撞 Rust reject_system_tag 且无任何提示
    expect(wrapper.find('.tag-system-note').text()).toContain('系统标签')
    expect(findButton(wrapper, '删除标签')).toBeUndefined()
    expect(wrapper.find('.tag-add-field').exists()).toBe(false)
    expect(wrapper.find('.tag-parent-add').exists()).toBe(false)
    expect(wrapper.find('.tag-parent-clear').exists()).toBe(false)
    expect(wrapper.findAll('.tag-field-remove')).toHaveLength(0)
    expect(wrapper.findAll('.tag-field-row--editable')).toHaveLength(0)
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

    expect(wrapper.find('.tag-parent-chip').text()).toContain('项目')
    await wrapper.find('.tag-parent-clear').trigger('click')
    await flushPromises()

    expect(mockClient.setTagParent).toHaveBeenCalledWith({ id: 't-dev', parent_id: null })
  })

  it('顶级标签可从候选里添加父标签（候选已排除自身与后代）', async () => {
    mockClient.setTagParent.mockResolvedValue(SYSTEM_TASK)
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-project').trigger('click')
    await flushPromises()

    expect(wrapper.find('.tag-parent-add').text()).toBe('+ 添加父标签')
    await wrapper.find('.tag-parent-add').trigger('click')
    await flushPromises()

    const panel = document.body.querySelector('.tag-parent-panel') as HTMLElement
    expect(panel).toBeTruthy()
    // 项目 的后代是 开发任务 → 候选里不应出现它自己与开发任务
    expect(panel.textContent).toContain('系统任务')
    expect(panel.textContent).not.toContain('开发任务')
    expect(panel.textContent).not.toContain('项目')
    const option = Array.from(panel.querySelectorAll('.tag-parent-option')).find((o) =>
      o.textContent?.includes('系统任务'),
    ) as HTMLButtonElement
    option.click()
    await flushPromises()

    expect(mockClient.setTagParent).toHaveBeenCalledWith({
      id: 't-project',
      parent_id: 'sys-tag-system-task',
    })
  })

  it('已有父时也可更换父标签（候选排除自身与后代）；按钮措辞随之改为「更换」', async () => {
    mockClient.setTagParent.mockResolvedValue(SYSTEM_TASK)
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    expect(wrapper.find('.tag-parent-chip').text()).toContain('项目')
    // 单父槽位：已有父时点它是「换掉」，文案不能还写「添加」
    expect(wrapper.find('.tag-parent-add').text()).toBe('更换父标签')

    await wrapper.find('.tag-parent-add').trigger('click')
    await flushPromises()

    const panel = document.body.querySelector('.tag-parent-panel') as HTMLElement
    expect(panel.textContent).toContain('系统任务')
    expect(panel.textContent).not.toContain('开发任务')

    const option = Array.from(panel.querySelectorAll('.tag-parent-option')).find((o) =>
      o.textContent?.includes('系统任务'),
    ) as HTMLButtonElement
    option.click()
    await flushPromises()

    expect(mockClient.setTagParent).toHaveBeenCalledWith({
      id: 't-dev',
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
    expect(dialog.textContent).toContain('2 个成员')
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

  it('字段模板：点自身字段行 → 改标题/类型/候选值 → 调 updateFieldDefinition', async () => {
    mockClient.updateFieldDefinition.mockResolvedValue(fieldDef({ id: 'f-estimate', title: '预计工时' }))
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    // 开发任务自身只有 工时（可编辑）；负责人是继承来的 → 不可点
    const editable = wrapper.findAll('.tag-field-row--editable')
    expect(editable).toHaveLength(1)
    expect(editable[0].text()).toContain('工时')
    await editable[0].trigger('click')
    await flushPromises()

    const body = document.body
    const titleInput = body.querySelector('.tag-field-edit-title') as HTMLInputElement
    expect(titleInput.value).toBe('工时')
    titleInput.value = '预计工时'
    titleInput.dispatchEvent(new Event('input'))

    const typeSelect = body.querySelector('.tag-field-edit-type') as HTMLSelectElement
    expect(typeSelect.value).toBe('number')
    typeSelect.value = 'select'
    typeSelect.dispatchEvent(new Event('change'))
    await flushPromises()

    const options = body.querySelector('.tag-field-edit-options') as HTMLInputElement
    expect(options).toBeTruthy()
    options.value = '1, 2, 3'
    options.dispatchEvent(new Event('input'))
    await flushPromises()

    ;(body.querySelector('.tag-field-confirm') as HTMLButtonElement).click()
    await flushPromises()

    expect(mockClient.updateFieldDefinition).toHaveBeenCalledWith({
      id: 'f-estimate',
      title: '预计工时',
      type: 'string',
      closed_values: ['1', '2', '3'],
    })
  })

  it('字段模板：下拉选择降级为数值时显式清空候选值', async () => {
    mockClient.updateFieldDefinition.mockResolvedValue(fieldDef({ id: 'f-owner', title: '负责人' }))
    const wrapper = await mountPage()
    // 项目自身声明了 负责人（下拉选择）
    await wrapper.find('.tag-row--t-project').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-field-row--editable').trigger('click')
    await flushPromises()

    const body = document.body
    const typeSelect = body.querySelector('.tag-field-edit-type') as HTMLSelectElement
    expect(typeSelect.value).toBe('select')
    typeSelect.value = 'number'
    typeSelect.dispatchEvent(new Event('change'))
    await flushPromises()

    // 非选项型不再渲染候选值输入框
    expect(body.querySelector('.tag-field-edit-options')).toBeFalsy()

    ;(body.querySelector('.tag-field-confirm') as HTMLButtonElement).click()
    await flushPromises()

    expect(mockClient.updateFieldDefinition).toHaveBeenCalledWith({
      id: 'f-owner',
      title: '负责人',
      type: 'number',
      closed_values: null,
    })
  })

  it('字段模板：历史遗留类型（不在点选表内）不会被显示成别的类型', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-idea').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-field-row--editable').trigger('click')
    await flushPromises()

    const typeSelect = document.body.querySelector('.tag-field-edit-type') as HTMLSelectElement
    expect(typeSelect.value).toBe('boolean')
    // 兜底项在，且显示名取自同一张表
    expect(Array.from(typeSelect.options).map((o) => o.textContent?.trim())).toContain('是/否')
  })
})
