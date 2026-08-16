import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ConditionPopover from './ConditionPopover.vue'
import type { Condition, FieldDescriptor } from '../../core/query'

const BasePopoverStub = {
  props: ['visible', 'position', 'closeOnOverlay'],
  emits: ['close'],
  template: `<div class="bp" @click.self="$emit('close')"><slot /></div>`,
}

const FIELDS: FieldDescriptor[] = [
  { key: 'title', label: '标题', type: 'text', get: () => '' },
  {
    key: 'type', label: '类型', type: 'select',
    options: [{ id: 'normal', label: '普通' }, { id: 'ideas', label: '灵感' }],
    get: () => '',
  },
  { key: 'createdAt', label: '创建日期', type: 'date', get: () => '' },
]

function lastCond(wrapper: ReturnType<typeof mount>): Condition {
  const e = wrapper.emitted('update:condition')
  return e![e!.length - 1][0] as Condition
}

describe('ConditionPopover', () => {
  it('shows field + op + value editors', () => {
    const cond: Condition = { field: 'title', op: 'contains', value: { kind: 'literal', value: 'abc' } }
    const w = mount(ConditionPopover, {
      props: { field: FIELDS[0], condition: cond, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    expect(w.find('[data-testid="cond-field"]').exists()).toBe(true)
    expect(w.find('[data-testid="cond-op"]').exists()).toBe(true)
    expect(w.find('[data-testid="cve-text"]').exists()).toBe(true)
  })

  it('changing field resets op to default and clears value', async () => {
    const cond: Condition = { field: 'title', op: 'contains', value: { kind: 'literal', value: 'abc' } }
    const w = mount(ConditionPopover, {
      props: { field: FIELDS[0], condition: cond, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    const sel = w.find('[data-testid="cond-field"]').element as HTMLSelectElement
    sel.value = 'type'
    await w.find('[data-testid="cond-field"]').trigger('change')
    const out = lastCond(w)
    expect(out.field).toBe('type')
    expect(out.op).toBe('is') // select default op
    expect(out.value).toBeUndefined()
  })

  it('changing op to isEmpty clears value', async () => {
    const cond: Condition = { field: 'title', op: 'contains', value: { kind: 'literal', value: 'abc' } }
    const w = mount(ConditionPopover, {
      props: { field: FIELDS[0], condition: cond, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    const sel = w.find('[data-testid="cond-op"]').element as HTMLSelectElement
    sel.value = 'isEmpty'
    await w.find('[data-testid="cond-op"]').trigger('change')
    const out = lastCond(w)
    expect(out.op).toBe('isEmpty')
    expect(out.value).toBeUndefined()
  })

  it('editing value emits condition with wrapped literal', async () => {
    const cond: Condition = { field: 'title', op: 'contains', value: undefined }
    const w = mount(ConditionPopover, {
      props: { field: FIELDS[0], condition: cond, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    const input = w.find('[data-testid="cve-text"]')
    await input.setValue('hello')
    const out = lastCond(w)
    expect(out.value).toEqual({ kind: 'literal', value: 'hello' })
  })

  it('remove emits remove after opening ⋯ panel', async () => {
    const cond: Condition = { field: 'title', op: 'contains', value: undefined }
    const w = mount(ConditionPopover, {
      props: { field: FIELDS[0], condition: cond, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    // 默认面板折叠
    expect(w.find('[data-testid="cond-remove"]').exists()).toBe(false)
    // 点击 ⋯ 展开
    await w.find('[data-testid="cond-more"]').trigger('click')
    expect(w.find('[data-testid="cond-remove"]').exists()).toBe(true)
    await w.find('[data-testid="cond-remove"]').trigger('click')
    expect(w.emitted('remove')).toBeTruthy()
  })

  it('advanced emits advanced after opening ⋯ panel', async () => {
    const cond: Condition = { field: 'title', op: 'contains', value: undefined }
    const w = mount(ConditionPopover, {
      props: { field: FIELDS[0], condition: cond, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    expect(w.find('[data-testid="cond-advanced"]').exists()).toBe(false)
    await w.find('[data-testid="cond-more"]').trigger('click')
    expect(w.find('[data-testid="cond-advanced"]').exists()).toBe(true)
    await w.find('[data-testid="cond-advanced"]').trigger('click')
    expect(w.emitted('advanced')).toBeTruthy()
  })

  it('⋯ toggles the secondary panel open/closed', async () => {
    const cond: Condition = { field: 'title', op: 'contains', value: undefined }
    const w = mount(ConditionPopover, {
      props: { field: FIELDS[0], condition: cond, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    expect(w.find('[data-testid="cond-more-panel"]').exists()).toBe(false)
    await w.find('[data-testid="cond-more"]').trigger('click')
    expect(w.find('[data-testid="cond-more-panel"]').exists()).toBe(true)
    await w.find('[data-testid="cond-more"]').trigger('click')
    expect(w.find('[data-testid="cond-more-panel"]').exists()).toBe(false)
  })

  it('renders field + op on same row with more button', () => {
    const cond: Condition = { field: 'title', op: 'contains', value: undefined }
    const w = mount(ConditionPopover, {
      props: { field: FIELDS[0], condition: cond, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    // 字段和操作符在同一行（cond-top-row 内）
    const topRow = w.find('.cond-top-row')
    expect(topRow.exists()).toBe(true)
    expect(topRow.find('[data-testid="cond-field"]').exists()).toBe(true)
    expect(topRow.find('[data-testid="cond-op"]').exists()).toBe(true)
    expect(topRow.find('[data-testid="cond-more"]').exists()).toBe(true)
  })

  it('delete filter is a text link not a red button', async () => {
    const cond: Condition = { field: 'title', op: 'contains', value: undefined }
    const w = mount(ConditionPopover, {
      props: { field: FIELDS[0], condition: cond, fields: FIELDS },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    await w.find('[data-testid="cond-more"]').trigger('click')
    const remove = w.find('[data-testid="cond-remove"]')
    expect(remove.classes()).toContain('cond-action-link')
    // 不应再有旧的 .cond-remove 样式（红色按钮）
    expect(remove.classes()).not.toContain('cond-remove')
  })

  it('auto-focuses the value text input on open', () => {
    const cond: Condition = { field: 'title', op: 'contains', value: undefined }
    const w = mount(ConditionPopover, {
      props: { field: FIELDS[0], condition: cond, fields: FIELDS },
      attachTo: document.body,
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    // 弹出后焦点应落在值输入区（text 输入框）
    expect(document.activeElement).toBe(w.find('[data-testid="cve-text"]').element)
    w.unmount()
  })

  it('auto-focuses the first option for a short select list (no input)', () => {
    const cond: Condition = { field: 'type', op: 'is', value: undefined }
    const w = mount(ConditionPopover, {
      props: { field: FIELDS[1], condition: cond, fields: FIELDS },
      attachTo: document.body,
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    // 短下拉无搜索框：焦点应落在首个可聚焦选项
    expect(document.activeElement).toBe(w.find('[data-testid="cve-option"]').element)
    w.unmount()
  })
})
