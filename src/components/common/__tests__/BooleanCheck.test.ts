import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import BooleanCheck from '../BooleanCheck.vue'

function emitLast(w: ReturnType<typeof mount>): boolean | undefined {
  const e = w.emitted('update:modelValue')
  return e ? (e[e.length - 1][0] as boolean | undefined) : undefined
}

describe('BooleanCheck（boolean 字段专属录入控件）', () => {
  it('渲染勾选按钮，role=checkbox + aria-checked', () => {
    const w = mount(BooleanCheck, { props: { modelValue: true, ariaLabel: '完成' } })
    const btn = w.find('[data-testid="boolean-check"]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('role')).toBe('checkbox')
    expect(btn.attributes('aria-checked')).toBe('true')
    expect(btn.attributes('aria-label')).toBe('完成')
  })

  it('true → ✓（bc-checked），false → ✗', () => {
    const yes = mount(BooleanCheck, { props: { modelValue: true } })
    expect(yes.find('[data-testid="boolean-check"]').classes()).toContain('bc-checked')
    expect(yes.text()).toBe('✓')

    const no = mount(BooleanCheck, { props: { modelValue: false } })
    expect(no.find('[data-testid="boolean-check"]').classes()).not.toContain('bc-checked')
    expect(no.text()).toBe('✗')
  })

  it('undefined / 无值 = 未填：ghost 占位（bc-empty），aria-checked=false', () => {
    const w = mount(BooleanCheck, { props: { modelValue: undefined } })
    const btn = w.find('[data-testid="boolean-check"]')
    expect(btn.classes()).toContain('bc-empty')
    expect(btn.attributes('aria-checked')).toBe('false')
  })

  it('未填点击 → emit true（点击即录入，ghost 语义）', async () => {
    const w = mount(BooleanCheck, { props: { modelValue: undefined } })
    await w.find('[data-testid="boolean-check"]').trigger('click')
    expect(emitLast(w)).toBe(true)
  })

  it('true 点击 → emit false，false 点击 → emit true（checkbox 切换语义）', async () => {
    const yes = mount(BooleanCheck, { props: { modelValue: true } })
    await yes.find('[data-testid="boolean-check"]').trigger('click')
    expect(emitLast(yes)).toBe(false)

    const no = mount(BooleanCheck, { props: { modelValue: false } })
    await no.find('[data-testid="boolean-check"]').trigger('click')
    expect(emitLast(no)).toBe(true)
  })

  it('v-model 往返：受控值更新后渲染随动', async () => {
    const w = mount(BooleanCheck, { props: { modelValue: undefined } })
    await w.setProps({ modelValue: true })
    await nextTick()
    expect(w.text()).toBe('✓')
    await w.setProps({ modelValue: false })
    await nextTick()
    expect(w.text()).toBe('✗')
  })
})
