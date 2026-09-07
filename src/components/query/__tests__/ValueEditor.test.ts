import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createRegistry } from '../../../core/query'
import type { FieldDescriptor, ReferenceableRecord, Registry } from '../../../core/query'
import ValueEditor from '../ValueEditor.vue'
import DatePicker from '../../common/DatePicker.vue'

function makeRegistry(): Registry {
  const reg = createRegistry()
  const fields: FieldDescriptor[] = [
    { key: 'title', label: '标题', type: 'text', get: () => '' },
    { key: 'title2', label: '副标题', type: 'text', get: () => '' },
    { key: 'status', label: '状态', type: 'select', get: () => '', options: [{ id: 'open', label: '进行中' }] },
  ]
  for (const f of fields) reg.register('task', f)
  return reg
}

const SOURCES: ReferenceableRecord[] = [
  { id: 'r1', title: '其他记录', entityType: 'task', fields: [{ key: 'title', label: '标题' }] },
]

describe('ValueEditor 引用值弹层', () => {
  it('引用值弹层 teleport 到 body，不被 FilterBuilder 面板 overflow 裁切', async () => {
    const reg = makeRegistry()
    const descriptor = reg.get('task', 'title')!
    const w = mount(ValueEditor, {
      props: {
        descriptor,
        op: 'contains',
        entityType: 'task',
        registry: reg,
        conditionField: 'title',
        crossRecordSources: SOURCES,
      },
      attachTo: document.body,
    })
    // 打开 + 菜单
    await w.find('.qb-ref-btn').trigger('click')
    await w.vm.$nextTick()
    // 弹层应渲染在 document.body（teleport），而非组件子树内部
    const pop = document.body.querySelector('.qb-popover')
    expect(pop).not.toBeNull()
    expect(w.element.contains(pop)).toBe(false)
    // 含「其他记录…」入口（证明菜单完整渲染，未被裁切）
    expect(pop!.textContent).toContain('其他记录')
    w.unmount()
  })
})

describe('allowRefs=false（chip 快捷编辑路径，ADR-0022 Q5）', () => {
  it('隐藏引用控件，仅字面量输入', async () => {
    const reg = makeRegistry()
    const descriptor = reg.get('task', 'title')!
    const w = mount(ValueEditor, {
      props: {
        descriptor,
        op: 'contains',
        entityType: 'task',
        registry: reg,
        allowRefs: false,
      },
    })
    // 无「+」引用入口（引用控件整体隐藏）
    expect(w.find('.qb-ref-btn').exists()).toBe(false)
    // 输入字面量 → emit { kind:'literal', value }
    await w.find('input.qb-value').setValue('hello')
    const emitted = w.emitted('update:modelValue')!
    expect(emitted[emitted.length - 1][0]).toEqual({ kind: 'literal', value: 'hello' })
    w.unmount()
  })

  it('布尔字段渲染为 select（Q4 收敛：Chip 分段按钮语义并入）', async () => {
    const reg = createRegistry()
    reg.register('task', { key: 'done', label: '完成', type: 'boolean', get: () => false })
    const descriptor = reg.get('task', 'done')!
    const w = mount(ValueEditor, {
      props: { descriptor, op: 'equals', entityType: 'task', registry: reg, allowRefs: false },
    })
    expect(w.find('select.qb-value').exists()).toBe(true)
    w.unmount()
  })
})

describe('date 字段动态值（relativeDate）', () => {
  function dateReg(): Registry {
    const reg = createRegistry()
    reg.register('task', { key: 'due', label: '截止日', type: 'date', get: () => '' })
    return reg
  }

  it('单日期（op=after）快捷「今日」→ 包为 { kind: relativeDate, expr: today }（不固化）', async () => {
    const reg = dateReg()
    const descriptor = reg.get('task', 'due')!
    const w = mount(ValueEditor, {
      props: { descriptor, op: 'after', entityType: 'task', registry: reg, allowRefs: false },
    })
    const dp = w.findComponent(DatePicker)
    expect(dp.exists()).toBe(true)
    ;(dp.vm as unknown as { applyShortcut: (k: string) => void }).applyShortcut('today')
    await nextTick()
    const emitted = w.emitted('update:modelValue')!
    expect(emitted[emitted.length - 1][0]).toEqual({ kind: 'relativeDate', expr: 'today' })
    w.unmount()
  })

  it('已存 relativeDate（expr=weekStart）回填触发器显示中文「本周起始」', () => {
    const reg = dateReg()
    const descriptor = reg.get('task', 'due')!
    const w = mount(ValueEditor, {
      props: {
        descriptor,
        op: 'after',
        entityType: 'task',
        registry: reg,
        allowRefs: false,
        modelValue: { kind: 'relativeDate', expr: 'weekStart' },
      },
    })
    expect(w.find('[data-testid="dp-trigger"]').text()).toContain('本周起始')
    w.unmount()
  })

  it('range（op=between）快捷仍 resolve 静态日期 → literal 区间', async () => {
    const reg = dateReg()
    const descriptor = reg.get('task', 'due')!
    const w = mount(ValueEditor, {
      props: { descriptor, op: 'between', entityType: 'task', registry: reg, allowRefs: false },
    })
    const dp = w.findComponent(DatePicker)
    ;(dp.vm as unknown as { applyShortcut: (k: string) => void }).applyShortcut('today')
    await nextTick()
    const emitted = w.emitted('update:modelValue')!
    const lastV = emitted[emitted.length - 1][0] as { kind: string; value: unknown }
    expect(lastV.kind).toBe('literal')
    expect(Array.isArray(lastV.value)).toBe(true)
    w.unmount()
  })
})
