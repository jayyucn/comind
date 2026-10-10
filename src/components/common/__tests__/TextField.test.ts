import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TextField from '../TextField.vue'

function emitLast(w: ReturnType<typeof mount>): string | undefined {
  const e = w.emitted('update:modelValue')
  return e ? (e[e.length - 1][0] as string | undefined) : undefined
}

describe('TextField（字段值家族 · 纯 string）', () => {
  it('渲染输入框 + 占位符', () => {
    const w = mount(TextField, { props: { placeholder: '输入文本' } })
    expect(w.find('input').exists()).toBe(true)
    expect((w.find('input').element as HTMLInputElement).placeholder).toBe('输入文本')
  })

  it('受控值回填到输入框', () => {
    const w = mount(TextField, { props: { modelValue: '随手记一句' } })
    expect((w.find('input').element as HTMLInputElement).value).toBe('随手记一句')
  })

  it('无值时清除 × 不渲染（hover 渐进披露）', () => {
    const w = mount(TextField, { props: { modelValue: undefined } })
    expect(w.find('[data-testid="tf-clear"]').exists()).toBe(false)
  })

  it('有值时渲染清除 ×', () => {
    const w = mount(TextField, { props: { modelValue: 'abc' } })
    expect(w.find('[data-testid="tf-clear"]').exists()).toBe(true)
  })

  it('失焦：提交 trim 后的文本，落库为 string', async () => {
    const w = mount(TextField, { props: { modelValue: '' } })
    const input = w.find('input')
    await input.setValue('  新备注  ')
    await input.trigger('blur')
    expect(emitLast(w)).toBe('新备注')
  })

  it('失焦：空输入 → emit undefined（删值行语义）', async () => {
    const w = mount(TextField, { props: { modelValue: '旧值' } })
    const input = w.find('input')
    await input.setValue('   ')
    await input.trigger('blur')
    expect(emitLast(w)).toBeUndefined()
  })

  it('回车：提交当前文本', async () => {
    const w = mount(TextField, { props: { modelValue: '' } })
    const input = w.find('input')
    await input.setValue('回车提交')
    await input.trigger('keydown', { key: 'Enter' })
    expect(emitLast(w)).toBe('回车提交')
  })

  it('清除 × 点击：emit undefined（删值行语义）', async () => {
    const w = mount(TextField, { props: { modelValue: '待清除' } })
    await w.find('[data-testid="tf-clear"]').trigger('click')
    expect(emitLast(w)).toBeUndefined()
  })

  it('外部值变化（非聚焦态）同步到草稿', async () => {
    const w = mount(TextField, { props: { modelValue: 'A' } })
    await w.setProps({ modelValue: 'B' })
    expect((w.find('input').element as HTMLInputElement).value).toBe('B')
  })

  it('受控值不受内部草稿回写覆盖（聚焦态不跟随外部）', async () => {
    const w = mount(TextField, { props: { modelValue: 'A' } })
    const input = w.find('input')
    await input.trigger('focus')
    await input.setValue('A-改')
    // 外部值未变，聚焦态不回写
    expect((w.find('input').element as HTMLInputElement).value).toBe('A-改')
  })
})
