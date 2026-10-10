import { describe, it, expect, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import EnumSelect from '../EnumSelect.vue'
import type { EnumOption } from '../EnumSelect.vue'

const OPTIONS: EnumOption[] = [
  { value: 'Todo', label: '待办', icon: 'status-todo' },
  { value: 'Doing', label: '进行中', icon: 'status-doing', description: '正在推进' },
  { value: 'Done', label: '已完成', icon: '✓' },
]

function emitLast(w: ReturnType<typeof mount>): string | undefined {
  const e = w.emitted('update:modelValue')
  return e ? (e[e.length - 1][0] as string | undefined) : undefined
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('EnumSelect（通用枚举组件）', () => {
  // ── trigger 模式 ──────────────────────────────────────────

  it('未填：触发按钮显示占位符，无清除按钮', () => {
    const w = mount(EnumSelect, { props: { options: OPTIONS, placeholder: '未填' } })
    const trigger = w.find('[data-testid="es-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.text()).toBe('未填')
    expect(trigger.classes()).toContain('es-placeholder')
    expect(w.find('.es-clear').exists()).toBe(false)
  })

  it('有值：触发按钮显示当前选项的文案，带清除按钮', () => {
    const w = mount(EnumSelect, { props: { options: OPTIONS, modelValue: 'Doing' } })
    const trigger = w.find('[data-testid="es-trigger"]')
    expect(trigger.text()).toContain('进行中')
    expect(w.find('.es-clear').exists()).toBe(true)
  })

  it('值不在选项内：按未填占位处理（不凭空造标签）', () => {
    const w = mount(EnumSelect, { props: { options: OPTIONS, modelValue: 'Archived' } })
    expect(w.find('[data-testid="es-trigger"]').classes()).toContain('es-placeholder')
  })

  it('点击触发按钮：选项面板 Teleport 到 body 展开，当前值高亮', async () => {
    const w = mount(EnumSelect, { props: { options: OPTIONS, modelValue: 'Doing' }, attachTo: document.body })
    await w.find('[data-testid="es-trigger"]').trigger('click')
    await flushPromises()

    const panel = document.body.querySelector('.es-panel')
    expect(panel).not.toBeNull()
    const opts = document.body.querySelectorAll('.es-option')
    expect(opts).toHaveLength(3)
    expect(opts[1].classList.contains('selected')).toBe(true)
    w.unmount()
  })

  it('点选选项：emit 所选值并收起面板', async () => {
    const w = mount(EnumSelect, { props: { options: OPTIONS }, attachTo: document.body })
    w.vm.openPanel()
    await flushPromises()
    ;(document.body.querySelectorAll('.es-option')[2] as HTMLElement).click()
    await flushPromises()

    expect(emitLast(w)).toBe('Done')
    expect(document.body.querySelector('.es-panel')).toBeNull()
    w.unmount()
  })

  it('清除按钮：emit undefined（上层据此删值行）', async () => {
    const w = mount(EnumSelect, { props: { options: OPTIONS, modelValue: 'Todo' } })
    await w.find('.es-clear').trigger('click')
    expect(emitLast(w)).toBeUndefined()
  })

  it('图标：SVG 图标名走 Icon 组件，字符图标按原文渲染', async () => {
    const w = mount(EnumSelect, { props: { options: OPTIONS, modelValue: 'Todo' } })
    expect(w.find('.es-trigger .es-option-icon svg').exists()).toBe(true)

    await w.setProps({ modelValue: 'Done' })
    expect(w.find('.es-trigger .es-option-icon svg').exists()).toBe(false)
    expect(w.find('.es-trigger .es-option-icon').text()).toBe('✓')
  })

  // ── inline 模式（嵌进既有弹层） ──────────────────────────

  it('inline：平铺选项列表，无触发按钮与弹层', () => {
    const w = mount(EnumSelect, { props: { options: OPTIONS, modelValue: 'Doing', inline: true } })
    expect(w.find('[data-testid="es-trigger"]').exists()).toBe(false)
    expect(w.findAll('.es-option')).toHaveLength(3)
    expect(w.findAll('.es-option')[1].classes()).toContain('selected')
    expect(w.find('.es-option-description').text()).toBe('正在推进')
  })

  it('inline：点击选项 emit 值（事件带 stop，不冒泡关宿主弹层）', async () => {
    const w = mount(EnumSelect, { props: { options: OPTIONS, inline: true } })
    await w.findAll('.es-option')[0].trigger('click')
    expect(emitLast(w)).toBe('Todo')
  })

  it('inline：字符图标按原文渲染', () => {
    const w = mount(EnumSelect, { props: { options: OPTIONS, modelValue: 'Done', inline: true } })
    expect(w.findAll('.es-option')[2].find('.es-option-icon').text()).toBe('✓')
  })
})
