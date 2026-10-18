/**
 * 标签管理页测试（ADR-0050 D5）。
 *
 * 接缝：只 mock `src/wasm/client` 边界，tags / blockCard 两个真 store + 页面组件全真
 * （先例：`stores/__tests__/blockCard.test.ts` 的边界 mock × `TaskHub.test.ts` 的页面级 mount）。
 * 解析结果（有效字段 / 后代闭包）由 mock 按 Rust 契约喂入 —— 本测试只验页面消费与写意图，
 * Rust 侧解析与环守卫另由 `cargo test -p comind-core` 覆盖。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import type { PersistedTagTreeEntry, PersistedFieldDefinition } from '../../types/tag-persisted'
import type { BlockCard } from '../../wasm/types'
import { useEditorStore } from '../../stores/editor'
import { reorderOwnFieldIds } from '../../utils/tag-field-order'
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

// Sortable.js 依赖浏览器 API，在 jsdom 下挂载会崩 —— 与 Block/index.test.ts 同款，把
// VueDraggable 桩成只透传 slot 的 div（卡片照常渲染，单列验证结构）。
vi.mock('vue-draggable-plus', () => ({
  VueDraggable: defineComponent({
    name: 'VueDraggable',
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: `<div class="tag-fields f-card-grid"><slot /></div>`,
  }),
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

    const fieldCards = texts(wrapper, '.tag-detail .f-card')
    expect(fieldCards).toHaveLength(2)
    expect(fieldCards[0]).toContain('工时')
    expect(fieldCards[0]).toContain('自身')
    expect(fieldCards[1]).toContain('负责人')
    // 来源徽标（ADR-0050 D10 修订增补 #4）：继承卡只留来源名，kind 收敛进悬浮提示
    const inheritedBadge = wrapper.findAll('.tag-detail .f-card')[1].find('.f-card-origin')
    expect(inheritedBadge.find('.f-card-origin-src').text()).toBe('项目')
    expect(inheritedBadge.attributes('title')).toBe('继承自 项目')
  })

  it('来源徽标三态：引用字段以「引用自 首个声明者」悬浮提示标注来源，系统定义入口可点开只读弹窗', async () => {
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

    const refCard = wrapper
      .findAll('.tag-detail .f-card')
      .find((c) => c.text().includes('状态'))!
    expect(refCard.find('.f-card-origin-src').text()).toBe('任务')
    // is_system 定义恒只读，但入口可点开只读弹窗（ADR-0057：系统字段可查看配置）
    const refEntry = refCard.find('.field-label-entry')
    expect(refEntry.attributes('disabled')).toBeUndefined()
    await refEntry.trigger('click')
    expect(useEditorStore().fieldSettingsFieldId).toBe('f-status')
    // 徽标 title = 引用 + 完整来源（不截断判定已并入文案单源）
    expect(refCard.find('.f-card-origin').attributes('title')).toBe('引用自 任务')
  })

  it('字段模板是流式卡片网格（ADR-0057 D2）：无表头、卡片数 = 有效字段数、页内无配置控件', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    expect(wrapper.find('.tag-fields.f-card-grid').exists()).toBe(true)
    expect(wrapper.findAll('.tag-detail .f-card')).toHaveLength(2)
    // 卡片只承担识别与入口；类型 / 默认 / 隐藏 / 形态 / 特化配置统一进字段设置弹窗
    expect(wrapper.find('.tag-detail .tag-fields select').exists()).toBe(false)
    expect(wrapper.find('.tag-detail .tag-fields input').exists()).toBe(false)
  })

  it('字段卡片：FieldLabel 入口可点 → editorStore 记录字段 id（弹窗由 App 层打开）', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const cards = wrapper.findAll('.tag-detail .f-card')
    // 自身卡（工时）：图标可点 → 打开字段设置
    const editableEntry = cards[0].find('.field-label-entry')
    expect(editableEntry.attributes('disabled')).toBeUndefined()
    await editableEntry.trigger('click')
    expect(useEditorStore().fieldSettingsFieldId).toBe('f-estimate')

    // 继承卡（负责人）：设置入口不分来源（ADR-0057 D1 修订）——可点开弹窗自由编辑
    const inheritedEntry = cards[1].find('.field-label-entry')
    expect(inheritedEntry.attributes('disabled')).toBeUndefined()
    await inheritedEntry.trigger('click')
    expect(useEditorStore().fieldSettingsFieldId).toBe('f-owner')
  })

  it('字段卡片展示描述（两行截断）与继承虚线边框', async () => {
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-status', title: '状态', is_system: true }),
      fieldDef({
        id: 'f-owner',
        title: '负责人',
        closed_values: ['张三', '李四'],
        description: '块的负责人，可多值',
      }),
      fieldDef({ id: 'f-estimate', title: '工时', type: 'number' }),
      fieldDef({ id: 'f-pinned', title: '置顶', type: 'boolean' }),
    ])
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const inheritedCard = wrapper
      .findAll('.tag-detail .f-card')
      .find((c) => c.text().includes('负责人'))!
    expect(inheritedCard.find('.f-card-desc').text()).toBe('块的负责人，可多值')
    expect(inheritedCard.classes()).toContain('f-card--inherited')
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
    // 标签级写入口全无；但 is_system 字段（状态）卡片的设置入口可点——弹窗内整体
    // 只读，不会触任何 reject_system_tag 写路径
    const openEntries = wrapper.findAll('.f-card .field-label-entry:not(:disabled)')
    expect(openEntries).toHaveLength(1)
    await openEntries[0].trigger('click')
    expect(useEditorStore().fieldSettingsFieldId).toBe('f-status')
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

  it('来源徽标最多 5 个字：截断的卡片 hover 显示完整来源', async () => {
    // 项目改名到 7 个字 —— 开发任务继承来的 负责人 来源徽标必然放不下
    mockClient.getTagTree.mockResolvedValue([
      SYSTEM_TASK,
      { ...PROJECT, title: '产品路线图规划' },
      DEV_TASK,
      IDEA,
    ])
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const inheritedCard = wrapper
      .findAll('.tag-detail .f-card')
      .find((c) => c.text().includes('负责人'))!
    const origin = inheritedCard.find('.f-card-origin')
    expect(origin.find('.f-card-origin-src').text()).toBe('产品路线图…')
    // title = 继承 + 完整来源（未截断的来源也能看全名）
    expect(origin.attributes('title')).toBe('继承自 产品路线图规划')
  })

  it('继承卡片：虚线边框 + 设置入口可点（继承方与声明方同权编辑弹窗），点击只记弹窗意图不直写', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const inheritedCard = wrapper
      .findAll('.tag-detail .f-card')
      .find((c) => c.text().includes('负责人'))!
    // 定义归祖先（项目），改它等于改所有引用方——弹窗「全局生效」提示承担告知
    expect(inheritedCard.classes()).toContain('f-card--inherited')
    const entry = inheritedCard.find('.field-label-entry')
    expect(entry.attributes('disabled')).toBeUndefined()

    await entry.trigger('click')
    expect(useEditorStore().fieldSettingsFieldId).toBe('f-owner')
    // 卡片点击只 emit 弹窗意图，写库只发生在弹窗「保存」
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

  // ── 字段模板排序（feat：字段可排序）──

  it('字段卡片：自身 / 引用字段带拖拽手柄，继承字段不带手柄', async () => {
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-dev').trigger('click')
    await flushPromises()

    const cards = wrapper.findAll('.tag-detail .f-card')
    // 自身卡（工时）：可排序 → 有手柄
    expect(cards[0].find('.f-card-grip').exists()).toBe(true)
    // 继承卡（负责人）：不可排序 → 无手柄（由父链决定顺序）
    expect(cards[1].find('.f-card-grip').exists()).toBe(false)
  })

  it('系统标签右栏不渲染任何拖拽手柄（只读面不可重排）', async () => {
    mockClient.getTagTree.mockResolvedValue([
      { ...SYSTEM_TASK, description: '内置定义' },
      PROJECT,
      DEV_TASK,
      IDEA,
    ])
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--sys-tag-system-task').trigger('click')
    await flushPromises()

    // 系统标签整体禁用拖拽，且 own/ref 判定对系统标签恒假 → 无任何手柄
    expect(wrapper.findAll('.tag-detail .f-card-grip')).toHaveLength(0)
  })

  it('重排自身字段后落库为新的 field_ids（继承字段不混入）', async () => {
    // 自建标签带两个自身字段，重排后顺序翻转
    mockClient.getTagTree.mockResolvedValue([
      SYSTEM_TASK,
      PROJECT,
      DEV_TASK,
      IDEA,
      treeEntry({
        id: 't-multi',
        title: '多字段',
        field_ids: ['f-owner', 'f-estimate'],
        effective_field_ids: ['f-owner', 'f-estimate'],
      }),
    ])
    mockClient.getFieldDefinitions.mockResolvedValue([
      fieldDef({ id: 'f-status', title: '状态', is_system: true }),
      fieldDef({ id: 'f-owner', title: '负责人', type: 'string', closed_values: ['张三', '李四'] }),
      fieldDef({ id: 'f-estimate', title: '工时', type: 'number' }),
      fieldDef({ id: 'f-pinned', title: '置顶', type: 'boolean' }),
    ])
    const wrapper = await mountPage()
    await wrapper.find('.tag-row--t-multi').trigger('click')
    await flushPromises()

    // 直接驱动组件内的重排落库路径：把本地卡片顺序翻转为 [工时, 负责人]
    wrapper.vm.fieldRows = [
      { def: { id: 'f-estimate' }, kind: 'own' },
      { def: { id: 'f-owner' }, kind: 'own' },
    ]
    await wrapper.vm.onFieldReorder()
    await flushPromises()

    expect(mockClient.updateTag).toHaveBeenCalledWith({
      id: 't-multi',
      field_ids: ['f-estimate', 'f-owner'],
    })
  })
})

describe('reorderOwnFieldIds（字段模板重排推导，纯函数）', () => {
  it('抽出 own/ref 字段的新相对顺序，忽略继承字段', () => {
    const rows = [
      { def: { id: 'a' }, kind: 'own' },
      { def: { id: 'x' }, kind: 'inherited' },
      { def: { id: 'b' }, kind: 'ref' },
      { def: { id: 'y' }, kind: 'inherited' },
    ]
    // 继承字段 x / y 不进 field_ids；own/ref 保持拖拽后的相对顺序 a → b
    expect(reorderOwnFieldIds(rows, ['a', 'b'])).toEqual(['a', 'b'])
  })

  it('顺序未变时返回原数组引用（调用方可据此跳过落库）', () => {
    const current = ['a', 'b']
    const rows = [
      { def: { id: 'a' }, kind: 'own' },
      { def: { id: 'b' }, kind: 'own' },
    ]
    expect(reorderOwnFieldIds(rows, current)).toBe(current)
  })

  it('继承字段被拖到自身组之后也不污染 field_ids', () => {
    const rows = [
      { def: { id: 'b' }, kind: 'own' },
      { def: { id: 'x' }, kind: 'inherited' },
      { def: { id: 'a' }, kind: 'own' },
    ]
    // 自身组被重排为 b → a，继承字段仍在末尾（Rust 解析保证）
    expect(reorderOwnFieldIds(rows, ['a', 'b'])).toEqual(['b', 'a'])
  })
})
