import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FieldManagerPanel from './FieldManagerPanel.vue'
import type { FieldDescriptor } from '../../core/query'
import type { TableColumnConfig } from '../../core/view'

const FIELDS: FieldDescriptor[] = [
  { key: 'title', label: '标题', type: 'text', get: () => '' },
  { key: 'type', label: '类型', type: 'select', get: () => '' },
  { key: 'createdAt', label: '创建日期', type: 'date', get: () => '' },
  { key: 'status', label: '状态', type: 'select', get: () => '' },
  { key: 'priority', label: '优先级', type: 'select', get: () => '' },
]

// 当前 tab 的列：title / status(隐藏) / createdAt —— 顺序即渲染顺序
const COLUMNS: TableColumnConfig[] = [
  { key: 'title' },
  { key: 'status', visible: false },
  { key: 'createdAt' },
]

function mountPanel(props: Partial<{ fields: FieldDescriptor[]; columns: TableColumnConfig[] }> = {}) {
  return mount(FieldManagerPanel, {
    props: { fields: FIELDS, columns: COLUMNS, ...props },
  })
}

describe('FieldManagerPanel', () => {
  it('第一组渲染当前 tab 列（含顺序），候选=全量字段减已用', () => {
    const w = mountPanel()
    const active = w.findAll('[data-testid="fm-active-row"]')
    expect(active).toHaveLength(3)
    // 顺序遵循 columns：title / status / createdAt
    expect(active[0].text()).toContain('标题')
    expect(active[1].text()).toContain('状态')
    expect(active[2].text()).toContain('创建日期')
    // 编辑关时候选组不渲染
    expect(w.findAll('[data-testid="fm-candidate-row"]')).toHaveLength(0)
  })

  it('隐藏列（visible=false）整行置灰', () => {
    const w = mountPanel()
    const active = w.findAll('[data-testid="fm-active-row"]')
    expect(active[1].classes()).toContain('hidden')
    expect(active[0].classes()).not.toContain('hidden')
  })

  it('per-tab 显示/隐藏 emit toggle-visibility：隐藏→emits true，显示→emits false', async () => {
    const w = mountPanel()
    const eyes = w.findAll('[data-testid="fm-eye"]')
    // status 当前隐藏 → 点开 → 期望 visible=true
    await eyes[1].trigger('click')
    // title 当前显示 → 点关 → 期望 visible=false
    await eyes[0].trigger('click')
    expect(w.emitted('toggle-visibility')).toEqual([
      ['status', true],
      ['title', false],
    ])
  })

  it('编辑开关默认关；开启后显示候选组（按字段注册顺序）', async () => {
    const w = mountPanel()
    expect(w.findAll('[data-testid="fm-candidate-row"]')).toHaveLength(0)
    await w.find('[data-testid="fm-edit"]').setValue(true)
    const cand = w.findAll('[data-testid="fm-candidate-row"]')
    expect(cand).toHaveLength(2)
    // 候选顺序遵循 props.fields 注册顺序：type / priority
    expect(cand[0].text()).toContain('类型')
    expect(cand[1].text()).toContain('优先级')
  })

  it('全局新增 emit add-global；删除（编辑开）emit remove-global', async () => {
    const w = mountPanel()
    await w.find('[data-testid="fm-edit"]').setValue(true)
    // 候选第一项 type → 点 + 新增
    await w.findAll('[data-testid="fm-candidate-row"]')[0].find('[data-testid="fm-add"]').trigger('click')
    expect(w.emitted('add-global')?.[0]).toEqual(['type'])
    // 已用第一项 title → 点删除
    await w.findAll('[data-testid="fm-active-row"]')[0].find('[data-testid="fm-del"]').trigger('click')
    expect(w.emitted('remove-global')?.[0]).toEqual(['title'])
  })

  it('搜索框同时过滤两组（按 label）', async () => {
    const w = mountPanel()
    await w.find('[data-testid="fm-edit"]').setValue(true)
    await w.find('[data-testid="fm-search"]').setValue('日期')
    // 已用：3 行均渲染（v-show），仅「创建日期」可见
    const active = [...w.findAll('[data-testid="fm-active-row"]')]
    expect(active).toHaveLength(3)
    expect(active.filter((r) => r.isVisible()).length).toBe(1)
    expect(active.some((r) => r.text().includes('创建日期') && r.isVisible())).toBe(true)
    // 候选：类型/优先级均不命中 → 0 行
    expect(w.findAll('[data-testid="fm-candidate-row"]')).toHaveLength(0)
  })

  it('拖拽排序 emit reorder（per-tab 新顺序）', async () => {
    const w = mountPanel()
    const vm = w.vm as any
    // 模拟 VueDraggable 真实拖拽结束：先把本地顺序重排为 [status, title, createdAt]
    vm.__test_setOrder(['status', 'title', 'createdAt'])
    await vm.onDragEnd()
    // title 拖到 status 之前：emit 新顺序 [status, title, createdAt]
    expect(w.emitted('reorder')?.[0]).toEqual([['status', 'title', 'createdAt']])
  })

  it('候选组无剩余字段时显示「无候选字段」空态', async () => {
    // 所有字段均已作为列 → 候选组为空，应渲染空态文案
    const allCols = FIELDS.map((f) => ({ key: f.key }))
    const w = mountPanel({ columns: allCols })
    await w.find('[data-testid="fm-edit"]').setValue(true)
    expect(w.findAll('[data-testid="fm-candidate-row"]')).toHaveLength(0)
    expect(w.text()).toContain('无候选字段')
  })

  it('搜索按列 key 回退匹配（无对应字段描述符的自定义属性）', async () => {
    // 列 key 在 props.fields 中无对应描述符 → matchesSearch 回退到 column.key（此前未覆盖分支）
    const w = mountPanel({ columns: [{ key: 'customProp' }] })
    await w.find('[data-testid="fm-search"]').setValue('custom')
    const active = w.findAll('[data-testid="fm-active-row"]')
    expect(active).toHaveLength(1)
    expect(active[0].isVisible()).toBe(true)
    expect(active[0].text()).toContain('customProp')
  })
})
