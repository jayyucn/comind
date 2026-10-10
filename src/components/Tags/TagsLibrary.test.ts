/**
 * 标签管理页测试（ADR-0050 D5）。
 *
 * 接缝：只 mock `src/wasm/client` 边界，tags / blockCard 两个真 store + 页面组件全真
 * （先例：`stores/__tests__/blockCard.test.ts` 的边界 mock × `TaskHub.test.ts` 的页面级 mount）。
 * 解析结果（有效字段 / 后代闭包）由 mock 按 Rust 契约喂入 —— 本测试只验页面消费与写意图，
 * Rust 侧解析与环守卫另由 `cargo test -p comind-core` 覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import type { PersistedTagTreeEntry, PersistedFieldDefinition } from '../../types/tag-persisted'
import type { BlockCard } from '../../wasm/types'
import TagsLibrary from './TagsLibrary.vue'

const { mockInitCoreClient, mockClient, navigateToTagMock } = vi.hoisted(() => {
  const mockClient = {
    getTagTree: vi.fn(),
    getFieldDefinitions: vi.fn(),
    getDeletedPresetFieldDefinitions: vi.fn().mockResolvedValue([]),
    restoreBuiltinPresets: vi.fn().mockResolvedValue({ restored: 0 }),
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
    description: '',
    color: '',
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
    default_value: null,
    hide_when: 'never',
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
  title: '任务',
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
    // 直系成员数：项目 3 / 开发任务 2 / 任务 1 / 灵感碎片 0 —— 互不相同，
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

  // 弹层 Teleport 到 body：先 unmount（走组件卸载路径，BasePopover 摘掉 document 监听、
  // Transition 正常收尾），再清场 —— 直接抹 innerHTML 会留下活实例，其后续更新对已剥离
  // 节点做 Transition leave 会抛错并打断 Vue 更新队列，殃及下例。
  const mountedWrappers: Array<ReturnType<typeof mount>> = []

  afterEach(() => {
    for (const w of mountedWrappers.splice(0)) w.unmount()
    document.body.innerHTML = ''
  })

  async function mountPage(selectTagId?: string) {
    const wrapper = mount(TagsLibrary, {
      // 预选提示（ADR-0050 D12）走 props 而非读 route —— 本文件因此无需装路由。
      props: selectTagId ? { selectTagId } : {},
      attachTo: document.body,
    })
    mountedWrappers.push(wrapper)
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

  it('「全部」默认树状：根按成员数降序，子标签缩进嵌套在父下', async () => {
    const wrapper = await mountPage()
    const rows = texts(wrapper, '.tag-row')

    // 树序：根（项目3 / 任务1 / 灵感碎片0），开发任务作为 项目 的子嵌套其后
    expect(rows[0]).toContain('#项目')
    expect(rows[0]).toContain('3 个成员')
    expect(rows[1]).toContain('#开发任务')
    expect(rows[1]).toContain('2 个成员')
    expect(rows[2]).toContain('#任务')
    expect(rows[3]).toContain('#灵感碎片')

    // 层级用 depth 类表达：子（开发任务）带 depth-1，根（项目）不带
    expect(wrapper.find('.tag-row--t-dev').classes()).toContain('tag-row--depth-1')
    expect(wrapper.find('.tag-row--t-project').classes()).not.toContain('tag-row--depth-1')

    // 左栏不再展示「字段数」列
    expect(wrapper.find('.tag-rows').text()).not.toContain('个字段')
  })

  it('「全部」树状中子标签经层级类缩进，且左栏已无「来源」列', async () => {
    const wrapper = await mountPage()
    // 开发任务是 项目 的子 → 带 depth-1；父 项目 是根 depth-0
    expect(wrapper.find('.tag-row--t-project').classes()).toContain('tag-row--depth-0')
    expect(wrapper.find('.tag-row--t-dev').classes()).toContain('tag-row--depth-1')
    // 顶级标签 / ← 父名 / 未使用 这类来源徽标不再展示
    expect(wrapper.find('.tag-row-source').exists()).toBe(false)
  })

  it('「未使用」筛选只留直系成员为 0 的标签', async () => {
    const wrapper = await mountPage()
    await findButton(wrapper, '未使用')!.trigger('click')
    await flushPromises()

    const rows = texts(wrapper, '.tag-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('#灵感碎片')
  })

  it('树状下搜索按标题过滤，并保留命中节点的祖先链', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-search-input').setValue('开发')
    await flushPromises()

    const rows = texts(wrapper, '.tag-row')
    // 开发任务 命中，其父 项目 作为祖先链一并保留（否则子节点孤立缩进）；其余根被过滤
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('#项目')
    expect(rows[1]).toContain('#开发任务')
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

    const fieldRows = texts(wrapper, '.tag-detail .tag-field-row:not(.tag-field-row--head)')
    expect(fieldRows).toHaveLength(2)
    expect(fieldRows[0]).toContain('工时')
    expect(fieldRows[0]).toContain('自身')
    expect(fieldRows[1]).toContain('负责人')
    // 来源列三态（ADR-0050 D10 修订增补 #4）：继承行显式拼「继承←祖先」
    expect(fieldRows[1]).toContain('继承←项目')
  })

  it('来源列三态：引用字段显示「引用←首个声明者」，且系统定义行仍只读', async () => {
    // 开发任务引用了系统任务的 状态（首个声明者 = 任务，created_at 并列按 id 兜底排序）
    mockClient.getTagTree.mockResolvedValue([
      SYSTEM_TASK,
      PROJECT,
      {
        ...DEV_TASK,
        field_ids: ['f-estimate', 'f-status'],
        effective_field_ids: ['f-estimate', 'f-owner', 'f-status'],
      },
      IDEA,
    ])
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const refRow = wrapper
      .findAll('.tag-field-row:not(.tag-field-row--head)')
      .find((r) => r.text().includes('状态'))!
    expect(refRow.text()).toContain('引用←任务')
    // 修订增补 #3：is_system 定义在任何表中恒只读 —— 引用方也无类型下拉
    expect(refRow.find('.tag-field-type-select').exists()).toBe(false)
    // 引用来源超过 5 字截断后才挂 title：这里「任务」2 字，不应有 tip
    expect(refRow.find('.tag-field-origin-title').attributes('title')).toBeUndefined()
  })

  it('字段模块带五列表头：字段 / 类型 / 默认 / 来源 / 隐藏', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const cells = texts(wrapper, '.tag-field-row--head .tag-field-cell')
    expect(cells.slice(0, 5)).toEqual(['字段', '类型', '默认', '来源', '隐藏'])
    // 数据行与表头同列数（表头不含「编辑」类入口）
    expect(wrapper.find('.tag-detail').text()).not.toContain('编辑')
  })

  // ── 隐藏列（ADR-0050 D18）──

  it('隐藏列：可编辑字段是下拉，切换即以 hide_when 落库', async () => {
    mockClient.updateFieldDefinition.mockResolvedValue(fieldDef({ id: 'f-estimate', title: '工时' }))
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    // 只有自身声明的 工时 行有下拉；继承的 负责人 行是只读文本
    const editableRow = wrapper
      .findAll('.tag-field-row:not(.tag-field-row--head)')
      .find((r) => r.text().includes('工时'))!
    const inheritedRow = wrapper
      .findAll('.tag-field-row:not(.tag-field-row--head)')
      .find((r) => r.text().includes('负责人'))!
    const select = editableRow.find('select.tag-field-hide-select')
    expect(select.exists()).toBe(true)
    expect((select.element as HTMLSelectElement).value).toBe('never')
    expect(inheritedRow.find('select.tag-field-hide-select').exists()).toBe(false)
    expect(inheritedRow.find('.tag-field-hide').text()).toBe('从不')

    await select.setValue('when_empty')
    await flushPromises()

    expect(mockClient.updateFieldDefinition).toHaveBeenCalledWith({
      id: 'f-estimate',
      hide_when: 'when_empty',
    })
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
    mockClient.getTagTree.mockResolvedValue([
      { ...SYSTEM_TASK, description: '内置定义' },
      PROJECT,
      DEV_TASK,
      IDEA,
    ])
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--sys-tag-system-task').trigger('click')
    await flushPromises()

    expect(wrapper.find('.tag-detail').text()).toContain('#任务')
    // 只读说明在，写入口全无 —— 否则点了会撞 Rust reject_system_tag 且无任何提示
    expect(wrapper.find('.tag-system-note').text()).toContain('系统标签')
    expect(findButton(wrapper, '删除标签')).toBeUndefined()
    expect(wrapper.find('.tag-add-field').exists()).toBe(false)
    expect(wrapper.find('.tag-parent-add').exists()).toBe(false)
    expect(wrapper.find('.tag-parent-clear').exists()).toBe(false)
    expect(wrapper.findAll('.tag-field-remove')).toHaveLength(0)
    expect(wrapper.findAll('.tag-field-row--editable')).toHaveLength(0)
    // 字段四列全部只读：无类型下拉、无就地改名入口
    expect(wrapper.findAll('.tag-field-type-select')).toHaveLength(0)
    expect(wrapper.findAll('.tag-field-name--editable')).toHaveLength(0)
    // 身份同属只读面（D11/D5）：描述渲染成文本、选色器不给可点触发点
    expect(wrapper.find('.tag-desc').classes()).toContain('tag-desc--readonly')
    expect(wrapper.find('input.tag-desc').exists()).toBe(false)
    expect(wrapper.find('button.tag-color-trigger').exists()).toBe(false)
  })

  // ── 身份第三要素：颜色（ADR-0050 D11） ──

  it('右栏选色（内联面板不弹窗）：点色块 → emit pick → setIdentity → updateTag 只发 color', async () => {
    mockClient.updateTag.mockResolvedValue(PROJECT)
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-project').trigger('click')
    await flushPromises()

    // 内联模式（ADR-0050 D14）：面板直接嵌在 .tag-detail-color，不弹窗、不 Teleport，
    // 故从页面内（而非 document.body）取面板。
    const panel = wrapper.find('.tag-detail-color .tag-color-panel')
    expect(panel.exists()).toBe(true)
    const swatch = Array.from(panel.findAll('.tag-color-swatch')).find(
      (s) => s.attributes('aria-label') === '青绿',
    )
    expect(swatch, '应含「青绿」色块').toBeTruthy()
    await swatch!.trigger('click')
    await flushPromises()

    expect(mockClient.updateTag).toHaveBeenCalledWith({ id: 't-project', color: '--tag-color-3' })
  })

  it('左栏行色点：有色为实心点、无色为空心环（两者判据同源）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      SYSTEM_TASK,
      { ...PROJECT, color: '--tag-color-7' },
      DEV_TASK,
      IDEA,
    ])
    const wrapper = await mountPage()

    const colored = wrapper.find('.tag-row--t-project .tag-color-dot')
    expect(colored.attributes('style')).toContain('var(--tag-color-7)')
    expect(colored.classes()).not.toContain('tag-color-dot--empty')

    // 开发任务未设色 → 空心环，且不带内联背景
    const colorless = wrapper.find('.tag-row--t-dev .tag-color-dot')
    expect(colorless.classes()).toContain('tag-color-dot--empty')
    expect(colorless.attributes('style')).toBeUndefined()
  })

  it('继承区父标签带色点（与左栏行同一形态）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      SYSTEM_TASK,
      { ...PROJECT, color: '--tag-color-2' },
      DEV_TASK,
      IDEA,
    ])
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const dot = wrapper.find('.tag-parent-label .tag-color-dot')
    expect(dot.exists()).toBe(true)
    expect(dot.attributes('style')).toContain('var(--tag-color-2)')
  })

  // ── 身份（描述）与「一步到达」预选（ADR-0050 D11 / D12） ──

  it('右栏描述就地编辑 → 经 setIdentity 落库', async () => {
    mockClient.updateTag.mockResolvedValue(PROJECT)
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-project').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-desc').trigger('click')
    await wrapper.find('input.tag-desc').setValue('与产品路线图对齐')
    await wrapper.find('input.tag-desc').trigger('keydown.enter')
    await flushPromises()

    expect(mockClient.updateTag).toHaveBeenCalledWith({
      id: 't-project',
      description: '与产品路线图对齐',
    })
  })

  it('selectTagId 传入时右栏直接选中该标签（预选覆盖默认的成员数首位）', async () => {
    // 无提示时默认选成员数最多的 项目；提示应把它换成 开发任务
    const wrapper = await mountPage('t-dev')
    expect(wrapper.find('.tag-detail-title').text()).toBe('#开发任务')
  })

  it('selectTagId 变化时重新选中（同路由只换 query 不重新挂载）', async () => {
    const wrapper = await mountPage('t-project')
    expect(wrapper.find('.tag-detail-title').text()).toBe('#项目')

    await wrapper.setProps({ selectTagId: 't-idea' })
    await flushPromises()

    expect(wrapper.find('.tag-detail-title').text()).toBe('#灵感碎片')
  })

  it('保存描述后的标签树整体重读不会把选中态拽回提示值', async () => {
    mockClient.updateTag.mockResolvedValue(PROJECT)
    const wrapper = await mountPage('t-project')
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()
    expect(wrapper.find('.tag-detail-title').text()).toBe('#开发任务')

    // setIdentity 会 ensureLoaded(true) → 标签树换新数组重读；若预选提示写成了
    // 「监听标签树」，选中态会在这里被拽回 t-project —— 本断言钉住它不回流。
    await wrapper.find('.tag-desc').trigger('click')
    await wrapper.find('input.tag-desc').setValue('补测试')
    await wrapper.find('input.tag-desc').trigger('keydown.enter')
    await flushPromises()

    expect(wrapper.find('.tag-detail-title').text()).toBe('#开发任务')
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
    expect(panel.textContent).toContain('任务')
    expect(panel.textContent).not.toContain('开发任务')
    expect(panel.textContent).not.toContain('项目')
    const option = Array.from(panel.querySelectorAll('.tag-parent-option')).find((o) =>
      o.textContent?.includes('任务'),
    ) as HTMLButtonElement
    option.click()
    await flushPromises()

    expect(mockClient.setTagParent).toHaveBeenCalledWith({
      id: 't-project',
      parent_id: 'sys-tag-system-task',
    })
  })

  it('挑父标签候选行带色点（有色实心 / 无色空心，与左栏行同一形态）', async () => {
    // 本例局部给 IDEA 上色：候选两态各占其一
    mockClient.getTagTree.mockResolvedValue([
      SYSTEM_TASK,
      { ...PROJECT, color: '--tag-color-3' },
      DEV_TASK,
      { ...IDEA, color: '--tag-color-5' },
    ])
    mockClient.setTagParent.mockResolvedValue(SYSTEM_TASK)
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-project').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-parent-add').trigger('click')
    await flushPromises()

    const panel = document.body.querySelector('.tag-parent-panel') as HTMLElement
    const options = Array.from(panel.querySelectorAll('.tag-parent-option'))
    const sysDot = options
      .find((o) => o.textContent?.includes('任务'))!
      .querySelector('.tag-color-dot') as HTMLElement
    expect(sysDot.className).toContain('tag-color-dot--empty')
    expect(sysDot.getAttribute('style')).toBeNull()
    const ideaDot = options
      .find((o) => o.textContent?.includes('灵感碎片'))!
      .querySelector('.tag-color-dot') as HTMLElement
    expect(ideaDot.className).not.toContain('tag-color-dot--empty')
    expect(ideaDot.getAttribute('style')).toContain('var(--tag-color-5)')

    // 面板处于打开态：必须随卸载移除，否则遗留的 Teleport 节点会被
    // 后续测试的 document.body.querySelector 先抓到（本文件无全局清理）。
    wrapper.unmount()
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
    expect(panel.textContent).toContain('任务')
    expect(panel.textContent).not.toContain('开发任务')

    const option = Array.from(panel.querySelectorAll('.tag-parent-option')).find((o) =>
      o.textContent?.includes('任务'),
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

  it('添加字段（新建路径）：先建字段定义、再追加进该标签自身字段', async () => {
    mockClient.createFieldDefinition.mockResolvedValue(fieldDef({ id: 'def-new', title: '截止' }))
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-add-field').trigger('click')
    await flushPromises()

    // 搜索合一式：打开先见候选列表，经「手动新建字段」进入新建表单
    const body = document.body
    expect(body.querySelector('.tag-field-candidates')).toBeTruthy()
    ;(body.querySelector('.tag-field-create-toggle') as HTMLButtonElement).click()
    await flushPromises()

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

  it('添加字段（引用路径）：候选 = 全部存活定义 − 有效字段已含项，点行即引用不新建定义', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-add-field').trigger('click')
    await flushPromises()

    const body = document.body
    const rows = [...body.querySelectorAll('.tag-field-candidate')].filter(
      (el) => !el.classList.contains('tag-field-candidate--create'),
    )
    const titles = rows.map((el) => el.querySelector('.tag-field-candidate-title')?.textContent)
    // t-dev 有效字段 = 工时（自身）+ 负责人（继承）→ 候选只剩 状态（系统）与 置顶
    expect(titles).toEqual(['状态', '置顶'])
    // 系统字段带「系统」徽标；被引用的定义带声明方数元信息
    expect(body.querySelector('.tag-field-candidate-badge')?.textContent).toBe('系统')
    expect(body.textContent).toContain('1 个标签')

    mockClient.updateTag.mockClear()
    ;(rows[0] as HTMLButtonElement).click()
    await flushPromises()

    expect(mockClient.createFieldDefinition).not.toHaveBeenCalled()
    expect(mockClient.updateTag).toHaveBeenCalledWith({
      id: 't-dev',
      field_ids: ['f-estimate', 'f-status'],
    })
  })

  it('引用候选含孤儿定义（无任何标签声明仍可复引）', async () => {
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-status', title: '状态', is_system: true }),
      fieldDef({ id: 'f-owner', title: '负责人', type: 'string', closed_values: ['张三', '李四'] }),
      fieldDef({ id: 'f-estimate', title: '工时', type: 'number' }),
      fieldDef({ id: 'f-ghost', title: '弃用字段' }),
    ])
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-add-field').trigger('click')
    await flushPromises()

    const body = document.body
    expect(body.textContent).toContain('弃用字段')
    expect(body.textContent).toContain('未被使用')
  })

  it('搜索合一式：过滤候选；无精确命中出「新建」行，回车引用首个候选', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-add-field').trigger('click')
    await flushPromises()

    const body = document.body
    const search = body.querySelector('.tag-field-search-input') as HTMLInputElement
    search.value = '状'
    search.dispatchEvent(new Event('input'))
    await flushPromises()

    // 「状」子串过滤后只剩 状态；无精确命中 → 同时出「新建」行（回车优先引用候选）
    const rows = [...body.querySelectorAll('.tag-field-candidate')].filter(
      (el) => !el.classList.contains('tag-field-candidate--create'),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('状态')
    expect(body.textContent).toContain('新建「状」')

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(mockClient.createFieldDefinition).not.toHaveBeenCalled()
    expect(mockClient.updateTag).toHaveBeenCalledWith({
      id: 't-dev',
      field_ids: ['f-estimate', 'f-status'],
    })
  })

  it('搜索词命中有效字段已覆盖的定义 → 提示已在该标签中，不出「新建」行', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-add-field').trigger('click')
    await flushPromises()

    const body = document.body
    const search = body.querySelector('.tag-field-search-input') as HTMLInputElement
    search.value = '工时'
    search.dispatchEvent(new Event('input'))
    await flushPromises()

    expect(body.textContent).toContain('已在该标签中')
    expect(body.textContent).not.toContain('新建「工时」')
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

  it('字段名点一下变输入框且文本全选 → 回车就地改名（已无「编辑」按钮）', async () => {
    mockClient.updateFieldDefinition.mockResolvedValue(fieldDef({ id: 'f-estimate', title: '预计工时' }))
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    // 开发任务自身只有 工时（可编辑）；负责人是继承来的 → 整行只读
    expect(wrapper.findAll('.tag-field-row--editable')).toHaveLength(1)
    expect(findButton(wrapper, '编辑')).toBeUndefined()

    await wrapper.find('.tag-field-name--editable').trigger('click')
    await flushPromises()

    const input = wrapper.find('input.tag-field-name-input')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('工时')
    // 挂载即聚焦并全选：点开就能直接覆写，不必先删整段
    expect(document.activeElement).toBe(input.element)
    expect((input.element as HTMLInputElement).selectionStart).toBe(0)
    expect((input.element as HTMLInputElement).selectionEnd).toBe('工时'.length)

    await input.setValue('预计工时')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(mockClient.updateFieldDefinition).toHaveBeenCalledWith({
      id: 'f-estimate',
      title: '预计工时',
    })
    // 回车后退出编辑态
    expect(wrapper.find('input.tag-field-name-input').exists()).toBe(false)
  })

  it('类型列切成「枚举」→ 打开默认列的选项面板，补第一个选项才落库（此前不写）', async () => {
    mockClient.updateFieldDefinition.mockResolvedValue(fieldDef({ id: 'f-estimate', title: '工时' }))
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    // 写后整体重读 —— 让后端真的把选项落实，面板内容才跟得上
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-status', title: '状态', is_system: true }),
      fieldDef({ id: 'f-owner', title: '负责人', closed_values: ['张三', '李四'] }),
      fieldDef({ id: 'f-estimate', title: '工时', type: 'string', closed_values: ['1'] }),
      fieldDef({ id: 'f-pinned', title: '置顶', type: 'boolean' }),
    ])

    const typeSelect = wrapper.find('select.tag-field-type-select')
    expect((typeSelect.element as HTMLSelectElement).value).toBe('number')

    // 切成「枚举」：选项还没补 → 不落库（空选项的枚举无意义，落了会显示回文本）
    await typeSelect.setValue('select')
    await flushPromises()
    expect(mockClient.updateFieldDefinition).not.toHaveBeenCalled()

    const panel = document.body.querySelector('.tag-enum-panel') as HTMLElement
    expect(panel, '切成枚举应直接打开选项面板').toBeTruthy()
    const addInput = panel.querySelector('.tag-enum-input--new') as HTMLInputElement
    addInput.value = '1'
    addInput.dispatchEvent(new Event('input'))
    await flushPromises()
    addInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    // 挂起态的第一个选项把 type 一并写死
    expect(mockClient.updateFieldDefinition).toHaveBeenCalledWith({
      id: 'f-estimate',
      type: 'string',
      closed_values: ['1'],
    })
    // 面板处于打开态：必须随卸载移除，否则遗留的 Teleport 节点会被后续测试的
    // document.body.querySelector 先抓到（本文件无全局清理）。
    wrapper.unmount()
  })

  it('枚举选项改成重名 → 不落库（两个同名选项选不出来）', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-project').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-field-default--enum').trigger('click')
    await flushPromises()
    const panel = document.body.querySelector('.tag-enum-panel') as HTMLElement
    ;(panel.querySelectorAll('button[aria-label="改选项名"]')[0] as HTMLButtonElement).click()
    await flushPromises()

    const input = panel.querySelector(
      'input.tag-enum-input:not(.tag-enum-input--new)',
    ) as HTMLInputElement
    input.value = '李四' // 与第二个选项重名
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(mockClient.updateFieldDefinition).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('移除字段时顺手收起它的选项面板（锚点行被摘掉，不留无锚浮层）', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-project').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-field-default--enum').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.tag-enum-panel')).toBeTruthy()

    await wrapper.find('.tag-field-remove').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('.tag-enum-panel')).toBeFalsy()
  })

  it('切成枚举后没补选项就关面板 → 放弃这次切换（不落库，类型显示回原值）', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const typeSelect = wrapper.find('select.tag-field-type-select')
    expect((typeSelect.element as HTMLSelectElement).value).toBe('number')
    await typeSelect.setValue('select')
    await flushPromises()
    expect((typeSelect.element as HTMLSelectElement).value).toBe('select')

    // Escape 关面板（BasePopover 的关闭路径）→ 挂起态一并放弃
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()

    expect(document.body.querySelector('.tag-enum-panel')).toBeFalsy()
    expect(mockClient.updateFieldDefinition).not.toHaveBeenCalled()
    expect((typeSelect.element as HTMLSelectElement).value).toBe('number')
  })

  it('枚举字段：默认列的下拉里可增 / 改 / 删选项，点选项即设为默认值', async () => {
    mockClient.updateFieldDefinition.mockResolvedValue(fieldDef({ id: 'f-owner', title: '负责人' }))
    const wrapper = await mountPage()
    // 项目自身声明了 负责人（枚举：张三 / 李四）
    await wrapper.find('.tag-row--t-project').trigger('click')
    await flushPromises()

    // 默认列是下拉触发器，不是就地输入框
    const trigger = wrapper.find('.tag-field-default--enum')
    expect(trigger.exists()).toBe(true)
    await trigger.trigger('click')
    await flushPromises()

    const panel = document.body.querySelector('.tag-enum-panel') as HTMLElement
    expect(panel).toBeTruthy()
    const options = Array.from(panel.querySelectorAll('.tag-enum-option:not(.tag-enum-option--none)'))
    expect(options.map((o) => o.textContent?.trim())).toEqual(['张三', '李四'])

    // 点选项 = 设为默认值（JSON 文本形态，与 FieldValue.value_json 同形）
    ;(options[1] as HTMLButtonElement).click()
    await flushPromises()
    expect(mockClient.updateFieldDefinition).toHaveBeenLastCalledWith({
      id: 'f-owner',
      default_value: '"李四"',
    })

    // 改：铅笔 → 输入框（挂载即全选）→ 回车落库
    await wrapper.find('.tag-field-default--enum').trigger('click')
    await flushPromises()
    const renamePanel = document.body.querySelector('.tag-enum-panel') as HTMLElement
    ;(renamePanel.querySelectorAll('button[aria-label="改选项名"]')[0] as HTMLButtonElement).click()
    await flushPromises()
    const renameInput = renamePanel.querySelector(
      'input.tag-enum-input:not(.tag-enum-input--new)',
    ) as HTMLInputElement
    expect(renameInput.value).toBe('张三')
    renameInput.value = '张三丰'
    renameInput.dispatchEvent(new Event('input'))
    renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(mockClient.updateFieldDefinition).toHaveBeenLastCalledWith({
      id: 'f-owner',
      closed_values: ['张三丰', '李四'],
    })

    // 写后整体重读 —— 让后端真的把「删掉李四」落实，下一步的「增」才接得上
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-status', title: '状态', is_system: true }),
      fieldDef({ id: 'f-owner', title: '负责人', closed_values: ['张三'] }),
      fieldDef({ id: 'f-estimate', title: '工时', type: 'number' }),
      fieldDef({ id: 'f-pinned', title: '置顶', type: 'boolean' }),
    ])

    // 删：× 移除该选项（最后一项不给删）
    const deletePanel = document.body.querySelector('.tag-enum-panel') as HTMLElement
    ;(deletePanel.querySelectorAll('button[aria-label="删除选项"]')[1] as HTMLButtonElement).click()
    await flushPromises()
    expect(mockClient.updateFieldDefinition).toHaveBeenLastCalledWith({
      id: 'f-owner',
      closed_values: ['张三'],
    })

    // 增：底部输入框回车追加（已是枚举 → 只写 closed_values）
    const addPanel = document.body.querySelector('.tag-enum-panel') as HTMLElement
    const addInput = addPanel.querySelector('.tag-enum-input--new') as HTMLInputElement
    addInput.value = '王五'
    addInput.dispatchEvent(new Event('input'))
    await flushPromises()
    addInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(mockClient.updateFieldDefinition).toHaveBeenLastCalledWith({
      id: 'f-owner',
      closed_values: ['张三', '王五'],
    })
    wrapper.unmount()
  })

  it('类型下拉：枚举降级为数值时显式清空选项', async () => {
    mockClient.updateFieldDefinition.mockResolvedValue(fieldDef({ id: 'f-owner', title: '负责人' }))
    const wrapper = await mountPage()
    // 项目自身声明了 负责人（枚举）
    await wrapper.find('.tag-row--t-project').trigger('click')
    await flushPromises()

    // 写后整体重读 —— 让后端真的把「降级」落实（选项清空）再验渲染
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-status', title: '状态', is_system: true }),
      fieldDef({ id: 'f-owner', title: '负责人', type: 'number', closed_values: null }),
      fieldDef({ id: 'f-estimate', title: '工时', type: 'number' }),
      fieldDef({ id: 'f-pinned', title: '置顶', type: 'boolean' }),
    ])

    const typeSelect = wrapper.find('select.tag-field-type-select')
    expect((typeSelect.element as HTMLSelectElement).value).toBe('select')
    await typeSelect.setValue('number')
    await flushPromises()

    // 非枚举型不再渲染选项面板触发器
    expect(wrapper.find('.tag-field-default--enum').exists()).toBe(false)
    expect((typeSelect.element as HTMLSelectElement).value).toBe('number')
    expect(mockClient.updateFieldDefinition).toHaveBeenCalledWith({
      id: 'f-owner',
      type: 'number',
      closed_values: null,
      // 换类型同步重置特化标记（spec 归类型族所有，残留会在切回时复活）
      spec: null,
    })
  })

  it('类型下拉：历史遗留类型（不在点选表内）不会被显示成别的类型', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-idea').trigger('click')
    await flushPromises()

    const typeSelect = wrapper.find('select.tag-field-type-select')
    expect((typeSelect.element as HTMLSelectElement).value).toBe('boolean')
    // 兜底项在，且显示名取自同一张表
    expect(
      Array.from((typeSelect.element as HTMLSelectElement).options).map((o) => o.textContent?.trim()),
    ).toContain('是/否')
  })

  it('默认列点一下变控件：数值型填值回车 → updateFieldDefinition 带 default_value(JSON 文本)', async () => {
    mockClient.updateFieldDefinition.mockResolvedValue(fieldDef({ id: 'f-estimate', title: '工时' }))
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    await wrapper.find('.tag-field-default--editable').trigger('click')
    await flushPromises()

    // 按字段类型出控件（工时 = 数值型）
    const input = wrapper.find('input.tag-field-default-input')
    expect(input.attributes('type')).toBe('number')

    await input.setValue('8')
    await input.trigger('keydown.enter')
    await flushPromises()

    // 数值经 encodeDefault 编码为 JSON 文本「8」（JSON.stringify(8)，1 个字符），与
    // PersistedFieldValue.value_json 同形；store 透传。
    expect(mockClient.updateFieldDefinition).toHaveBeenLastCalledWith({ id: 'f-estimate', default_value: '8' })
    expect(mockClient.getTagTree).toHaveBeenCalled()
  })

  it('来源列最多 5 个字：截断的行 hover 显示完整标签名', async () => {
    // 项目改名到 7 个字 —— 开发任务继承来的 负责人 来源列必然放不下
    mockClient.getTagTree.mockResolvedValue([
      SYSTEM_TASK,
      { ...PROJECT, title: '产品路线图规划' },
      DEV_TASK,
      IDEA,
    ])
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const inheritedRow = wrapper
      .findAll('.tag-field-row:not(.tag-field-row--head)')
      .find((r) => r.text().includes('负责人'))!
    const origin = inheritedRow.find('.tag-field-origin-title')
    expect(origin.text()).toBe('产品路线图…')
    // 只有截断的行才挂 title —— 没截断还弹 tip 是噪音
    expect(origin.attributes('title')).toBe('产品路线图规划')
  })

  it('继承字段整行只读：无类型下拉、无改名/改默认入口', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const inheritedRow = wrapper
      .findAll('.tag-field-row:not(.tag-field-row--head)')
      .find((r) => r.text().includes('负责人'))!
    // 定义归祖先（项目），改它等于改所有引用方
    expect(inheritedRow.find('.tag-field-type-select').exists()).toBe(false)
    expect(inheritedRow.find('.tag-field-name--editable').exists()).toBe(false)

    // 默认值只读：点击不进编辑态（候选值型也不会冒出 `<select>`）
    await inheritedRow.find('.tag-field-default').trigger('click')
    await flushPromises()
    expect(wrapper.find('.tag-field-default-input').exists()).toBe(false)
    expect(wrapper.find('.tag-field-name-input').exists()).toBe(false)
    expect(mockClient.updateFieldDefinition).not.toHaveBeenCalled()
  })

  // ── 继承树只读可视化（ADR-0050 D17 §3）──

  it('继承树：有祖先时呈现祖先链 + 字段贡献，节点点击本页选中该标签', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const tree = wrapper.find('.tag-inherit-tree')
    expect(tree.exists()).toBe(true)
    expect(tree.text()).toContain('#项目')
    // 项目向 开发任务 贡献 负责人（继承字段按最近声明祖先归组）
    expect(tree.text()).toContain('贡献：负责人')

    // 节点可点击跳转 = 本页选中：右栏详情切到 项目
    await tree.find('.tag-inherit-node-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.tag-detail-title').text()).toContain('#项目')
  })

  it('继承树：本标签自行声明的字段在祖先节点标注「被本标签覆盖」', async () => {
    // 开发任务同时自行声明 负责人（覆盖项目的声明）—— 自身声明优先级更高
    mockClient.getTagTree.mockResolvedValue([
      SYSTEM_TASK,
      PROJECT,
      {
        ...DEV_TASK,
        field_ids: ['f-estimate', 'f-owner'],
        effective_field_ids: ['f-estimate', 'f-owner'],
      },
      IDEA,
    ])
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const tree = wrapper.find('.tag-inherit-tree')
    expect(tree.exists()).toBe(true)
    expect(tree.text()).toContain('被本标签覆盖：负责人')
    // 负责人已由本标签声明 → 不再计入项目的「贡献」
    expect(tree.text()).not.toContain('贡献：负责人')
  })

  it('继承树：顶级标签（无祖先）不渲染', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-project').trigger('click')
    await flushPromises()

    expect(wrapper.find('.tag-inherit-tree').exists()).toBe(false)
  })
})
