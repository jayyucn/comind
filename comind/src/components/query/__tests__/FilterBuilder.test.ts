import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRegistry } from '../../../core/query'
import type { FieldDescriptor, Registry, ViewQuery } from '../../../core/query'
import FilterBuilder from '../FilterBuilder.vue'

interface Task {
  title?: string
  count?: number
  due?: string
  status?: string
  tags?: string[]
  done?: boolean
}

function makeRegistry(): Registry {
  const reg = createRegistry()
  const fields: FieldDescriptor<Task>[] = [
    { key: 'title', label: '标题', type: 'text', get: (i) => i.title },
    { key: 'count', label: '数量', type: 'number', get: (i) => i.count },
    { key: 'due', label: '截止', type: 'date', get: (i) => i.due, dateBucket: 'day' },
    {
      key: 'status',
      label: '状态',
      type: 'select',
      get: (i) => i.status,
      options: [
        { id: 'open', label: '进行中' },
        { id: 'done', label: '完成' },
      ],
    },
    {
      key: 'tags',
      label: '标签',
      type: 'multiSelect',
      get: (i) => i.tags,
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    },
    { key: 'done', label: '已完成', type: 'boolean', get: (i) => i.done },
  ]
  for (const f of fields) reg.register('task', f)
  return reg
}

function baseQuery(): ViewQuery {
  return { version: 1, filter: { combinator: 'and', children: [] }, sort: [], groupBy: null }
}

/** 点击根条件组里的「添加条件」按钮。 */
async function addCondition(wrapper: ReturnType<typeof mount>) {
  const btns = wrapper.findAll('.qb-group-actions .qb-text-btn')
  // 第一个按钮是「添加条件」（第二个是「添加条件组」）
  await btns[0].trigger('click')
}

/** 点击根条件组里的「添加条件组」按钮。 */
async function addGroup(wrapper: ReturnType<typeof mount>) {
  const btns = wrapper.findAll('.qb-group-actions .qb-text-btn')
  await btns[1].trigger('click')
}

let registry: Registry
let wrapper: ReturnType<typeof mount>

beforeEach(() => {
  registry = makeRegistry()
  wrapper = mount(FilterBuilder, {
    props: { registry, entityType: 'task', modelValue: baseQuery() },
  })
})

function lastEmitted(): ViewQuery {
  const events = wrapper.emitted('update:modelValue')
  expect(events).toBeTruthy()
  // wrapper.emitted 返回「每次 emit 的参数数组」列表；参数数组首项即 ViewQuery
  const last = events[events.length - 1] as unknown[]
  return last[0] as ViewQuery
}

describe('FilterBuilder 字段选择器', () => {
  it('渲染注册表中的全部字段', async () => {
    await addCondition(wrapper)
    const fieldSelect = wrapper.find('.qb-row .qb-select')
    expect(fieldSelect.exists()).toBe(true)
    expect(fieldSelect.findAll('option').length).toBe(6)
  })
})

describe('FilterBuilder 操作符按类型派生', () => {
  it('select 字段仅暴露 is / isNot / isEmpty / isNotEmpty', async () => {
    await addCondition(wrapper)
    await wrapper.find('.qb-row .qb-select').setValue('status')
    const ops = wrapper.find('.qb-op').findAll('option').map((o) => o.attributes('value'))
    expect(ops).toEqual(['is', 'isNot', 'isEmpty', 'isNotEmpty'])
  })

  it('text 字段暴露文本类操作符集', async () => {
    await addCondition(wrapper)
    await wrapper.find('.qb-row .qb-select').setValue('title')
    const ops = wrapper.find('.qb-op').findAll('option').map((o) => o.attributes('value'))
    expect(ops).toContain('contains')
    expect(ops).toContain('notContains')
  })
})

describe('FilterBuilder 值编辑器按类型分派', () => {
  it('select 字段渲染选项下拉（值存 id）', async () => {
    await addCondition(wrapper)
    await wrapper.find('.qb-row .qb-select').setValue('status')
    const valueSelect = wrapper.find('.qb-row select.qb-value')
    expect(valueSelect.exists()).toBe(true)
    expect(valueSelect.findAll('option').length).toBe(2)
  })

  it('boolean 字段渲染 是/否 下拉', async () => {
    await addCondition(wrapper)
    await wrapper.find('.qb-row .qb-select').setValue('done')
    const valueSelect = wrapper.find('.qb-row select.qb-value')
    expect(valueSelect.exists()).toBe(true)
    const vals = valueSelect.findAll('option').map((o) => o.attributes('value'))
    expect(vals).toEqual(['true', 'false'])
  })

  it('multiSelect 字段渲染复选项', async () => {
    await addCondition(wrapper)
    await wrapper.find('.qb-row .qb-select').setValue('tags')
    const multi = wrapper.find('.qb-multi')
    expect(multi.exists()).toBe(true)
    expect(multi.findAll('input[type="checkbox"]').length).toBe(2)
  })

  it('isEmpty / isNotEmpty 不渲染值编辑器', async () => {
    await addCondition(wrapper)
    await wrapper.find('.qb-row .qb-select').setValue('title')
    await wrapper.find('.qb-op').setValue('isEmpty')
    expect(wrapper.find('.qb-row .qb-value').exists()).toBe(false)
    expect(wrapper.find('.qb-row .qb-multi').exists()).toBe(false)
  })
})

describe('FilterBuilder 条件组嵌套', () => {
  it('软限制 3 层：第 3 层不再显示「添加条件组」', async () => {
    await addCondition(wrapper)
    await addGroup(wrapper) // depth 1 -> 2
    // 子组（第二个 .qb-group）内的添加组
    const groups = wrapper.findAll('.qb-group')
    expect(groups.length).toBe(2)
    const nestedBtns = groups[1].findAll('.qb-group-actions .qb-text-btn')
    await nestedBtns[1].trigger('click') // depth 2 -> 3
    const allGroups = wrapper.findAll('.qb-group')
    expect(allGroups.length).toBe(3)
    // 最内层组（depth 3）应只有「添加条件」，无「添加条件组」
    const deepestBtns = allGroups[2].findAll('.qb-group-actions .qb-text-btn')
    expect(deepestBtns.length).toBe(1)
  })

  it('组级 negate 不在 UI 暴露', async () => {
    expect(wrapper.find('.qb-negate').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('取反')
  })
})

describe('FilterBuilder 排序 / 分组配置', () => {
  it('添加排序规则并选择字段后产出含 sort', async () => {
    await addCondition(wrapper)
    // 排序区：点击「添加排序」
    const sortBtn = wrapper.findAll('.qb-section').at(1)!.find('.qb-text-btn')
    await sortBtn.trigger('click')
    const sortSelect = wrapper.find('.qb-sort-row .qb-select')
    await sortSelect.setValue('title')
    const emitted = lastEmitted()
    expect(emitted.sort).toEqual([{ field: 'title', dir: 'asc' }])
  })

  it('选择分组字段后产出含 groupBy', async () => {
    await addCondition(wrapper)
    const groupSelect = wrapper.findAll('.qb-section').at(2)!.find('.qb-select')
    await groupSelect.setValue('status')
    const emitted = lastEmitted()
    expect(emitted.groupBy).toBe('status')
  })
})

describe('FilterBuilder 产出合法 ViewQuery', () => {
  it('整体结构为 version:1 + filter + sort[] + groupBy', async () => {
    await addCondition(wrapper)
    await wrapper.find('.qb-row .qb-select').setValue('status')
    await wrapper.find('.qb-row select.qb-value').setValue('open')

    const sortBtn = wrapper.findAll('.qb-section').at(1)!.find('.qb-text-btn')
    await sortBtn.trigger('click')
    await wrapper.find('.qb-sort-row .qb-select').setValue('count')

    const groupSelect = wrapper.findAll('.qb-section').at(2)!.find('.qb-select')
    await groupSelect.setValue('due')

    const emitted = lastEmitted()
    expect(emitted.version).toBe(1)
    expect(emitted.filter).toMatchObject({ combinator: 'and', children: expect.any(Array) })
    expect(Array.isArray(emitted.sort)).toBe(true)
    expect(emitted.sort[0]).toEqual({ field: 'count', dir: 'asc' })
    expect(emitted.groupBy).toBe('due')
    // 条件被实际写入
    const firstCond = emitted.filter.children[0] as { field: string; op: string; value: unknown }
    expect(firstCond).toMatchObject({ field: 'status', op: 'is', value: { kind: 'literal', value: 'open' } })
  })
})

// —— 字段引用值（field / pageField）UI 测试 ——
// 注册两个同类型 number 字段（count / score），使「字段」开关与跨记录字段列表非空；
// 并注入 availablePages 以触发「其他页面…」入口。
interface RefTask {
  count?: number
  score?: number
}
function makeRefRegistry(): Registry {
  const reg = createRegistry()
  const fields: FieldDescriptor<RefTask>[] = [
    { key: 'count', label: '数量', type: 'number', get: (i) => i.count },
    { key: 'score', label: '分值', type: 'number', get: (i) => i.score },
  ]
  for (const f of fields) reg.register('task', f)
  return reg
}
const refAvailablePages = [
  { id: 'p1', title: '产品规划' },
  { id: 'p2', title: '周报' },
]

describe('FilterBuilder 字段引用值（field / pageField）', () => {
  let refWrapper: ReturnType<typeof mount>

  beforeEach(() => {
    refWrapper = mount(FilterBuilder, {
      props: { registry: makeRefRegistry(), entityType: 'task', modelValue: baseQuery(), availablePages: refAvailablePages },
    })
  })

  function refEmitted(): ViewQuery {
    const events = refWrapper.emitted('update:modelValue')
    expect(events).toBeTruthy()
    const last = events[events.length - 1] as unknown[]
    return last[0] as ViewQuery
  }

  it('顶部「字段」开关：切到字段后值序列化为 field 引用', async () => {
    await addCondition(refWrapper)
    await refWrapper.find('.qb-row .qb-select').setValue('count')
    // 顶部出现 固定值 / 字段 切换
    const modeBtns = refWrapper.findAll('.qb-vmode button')
    expect(modeBtns.length).toBe(2)
    await modeBtns[1].trigger('click') // 「字段」
    const cond = (refEmitted().filter.children[0] as { field: string; op: string; value: unknown })
    expect(cond.value).toEqual({ kind: 'field', field: 'score' }) // 同类型首个非自身字段
  })

  it('「+」菜单 → 其他页面 → 选页 + 选字段：序列化为 pageField 引用', async () => {
    await addCondition(refWrapper)
    await refWrapper.find('.qb-row .qb-select').setValue('count')
    // 打开 + 菜单
    await refWrapper.find('.qb-ref-btn').trigger('click')
    const rootItems = refWrapper.findAll('.qb-pop-item')
    const otherPageItem = rootItems.find((b) => b.text().includes('其他页面'))!
    expect(otherPageItem).toBeTruthy()
    await otherPageItem.trigger('click')
    // PageFieldRefPicker：选页
    const pages = refWrapper.findAll('.pf-page')
    expect(pages.length).toBe(2)
    await pages[0].trigger('click') // 产品规划 (p1)
    // 选同类型字段（分值）
    const fields = refWrapper.findAll('.pf-field')
    expect(fields.length).toBe(1) // 仅 score 同类型
    await fields[0].trigger('click')
    const cond = (refEmitted().filter.children[0] as { field: string; op: string; value: unknown })
    expect(cond.value).toEqual({ kind: 'pageField', pageId: 'p1', field: 'score' })
  })

  it('未注入 availablePages 时隐藏「其他页面」入口', async () => {
    // 重新挂载一个无 availablePages 的实例
    const bare = mount(FilterBuilder, {
      props: { registry: makeRefRegistry(), entityType: 'task', modelValue: baseQuery() },
    })
    await addCondition(bare)
    await bare.find('.qb-row .qb-select').setValue('count')
    await bare.find('.qb-ref-btn').trigger('click')
    const rootItems = bare.findAll('.qb-pop-item')
    expect(rootItems.some((b) => b.text().includes('其他页面'))).toBe(false)
    expect(rootItems.some((b) => b.text().includes('当前记录字段'))).toBe(true)
  })
})
