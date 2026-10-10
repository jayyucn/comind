import { describe, it, expect, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import MultiEnumSelect from '../MultiEnumSelect.vue'
import type { EnumOption } from '../EnumSelect.vue'

const OPTIONS: EnumOption[] = [
  { value: 'a', label: '甲' },
  { value: 'b', label: '乙' },
  { value: 'c', label: '丙' },
]

function emitLast(w: ReturnType<typeof mount>): string[] | undefined {
  const e = w.emitted('update:modelValue')
  return e ? (e[e.length - 1][0] as string[] | undefined) : undefined
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('MultiEnumSelect（多选枚举组件，T4）', () => {
  it('未填：触发按钮显示占位符，无清除按钮', () => {
    const w = mount(MultiEnumSelect, { props: { options: OPTIONS, placeholder: '未填' } })
    const trigger = w.find('[data-testid="mes-trigger"]')
    expect(trigger.exists()).toBe(true)
    expect(trigger.text()).toContain('未填')
    expect(w.find('.mes-clear').exists()).toBe(false)
  })

  it('有值：触发按钮按选项顺序拼接已选文案，带清除按钮', () => {
    const w = mount(MultiEnumSelect, { props: { options: OPTIONS, modelValue: ['c', 'a'] } })
    const trigger = w.find('[data-testid="mes-trigger"]')
    expect(trigger.text()).toContain('甲、丙')
    expect(w.find('.mes-clear').exists()).toBe(true)
  })

  it('展开：选项面板 Teleport 到 body，已选项高亮', async () => {
    const w = mount(MultiEnumSelect, { props: { options: OPTIONS, modelValue: ['a'] }, attachTo: document.body })
    w.vm.openPanel()
    await flushPromises()

    const panel = document.body.querySelector('.mes-list')
    expect(panel).not.toBeNull()
    const opts = document.body.querySelectorAll('.mes-option')
    expect(opts).toHaveLength(3)
    expect(opts[0].classList.contains('selected')).toBe(true)
    expect(opts[1].classList.contains('selected')).toBe(false)
    w.unmount()
  })

  it('勾选未选项：emit 追加后的数组，面板保持展开（多选连续勾选）', async () => {
    const w = mount(MultiEnumSelect, { props: { options: OPTIONS, modelValue: ['a'] }, attachTo: document.body })
    w.vm.openPanel()
    await flushPromises()
    ;(document.body.querySelectorAll('.mes-option')[2] as HTMLElement).click()
    await flushPromises()

    expect(emitLast(w)).toEqual(['a', 'c'])
    expect(document.body.querySelector('.mes-list')).not.toBeNull()
    w.unmount()
  })

  it('取消最后一个已选项：emit undefined（空 = 未填 = 删行语义）', async () => {
    const w = mount(MultiEnumSelect, { props: { options: OPTIONS, modelValue: ['b'] }, attachTo: document.body })
    w.vm.openPanel()
    await flushPromises()
    ;(document.body.querySelectorAll('.mes-option')[1] as HTMLElement).click()
    await flushPromises()

    expect(emitLast(w)).toBeUndefined()
    w.unmount()
  })

  it('无值时勾选首项：emit 单元素数组', async () => {
    const w = mount(MultiEnumSelect, { props: { options: OPTIONS }, attachTo: document.body })
    w.vm.openPanel()
    await flushPromises()
    ;(document.body.querySelectorAll('.mes-option')[0] as HTMLElement).click()
    await flushPromises()

    expect(emitLast(w)).toEqual(['a'])
    w.unmount()
  })

  it('清除按钮：emit undefined', async () => {
    const w = mount(MultiEnumSelect, { props: { options: OPTIONS, modelValue: ['a', 'b'] } })
    await w.find('.mes-clear').trigger('click')
    expect(emitLast(w)).toBeUndefined()
  })
})
