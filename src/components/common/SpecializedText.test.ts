/**
 * 特化文本编辑器测试（issue T6 AC2）：email / phone 格式校验 + 红字提示 + 回车不落库。
 * 契约与 TextField 对齐：undefined = 未填（emit undefined）、28px 基线不在此测（样式）。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SpecializedText from './SpecializedText.vue'

async function typeAndCommit(value: string) {
  const wrapper = mount(SpecializedText, { props: { spec: 'email', modelValue: undefined } })
  const input = wrapper.find('[data-testid="st-input"]')
  await input.setValue(value)
  ;(wrapper.vm as unknown as { commit: () => void }).commit()
  await wrapper.vm.$nextTick()
  return wrapper
}

describe('SpecializedText（特化文本编辑器）', () => {
  it('合法 email：提交 emit 值，无错误提示', async () => {
    const wrapper = await typeAndCommit('a@b.com')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['a@b.com'])
    expect(wrapper.find('[data-testid="st-error"]').exists()).toBe(false)
  })

  it('非法 email：不 emit（回车不落库），红字提示出现', async () => {
    const wrapper = await typeAndCommit('不是邮箱')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find('[data-testid="st-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="st-error"]').text()).toBe('邮箱格式不正确')
    expect(wrapper.find('[data-testid="st-input"]').attributes('aria-invalid')).toBe('true')
  })

  it('空串：emit undefined（未填 = 删行），不出错', async () => {
    const wrapper = mount(SpecializedText, { props: { spec: 'email', modelValue: 'a@b.com' } })
    await wrapper.find('[data-testid="st-input"]').setValue('   ')
    ;(wrapper.vm as unknown as { commit: () => void }).commit()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([undefined])
    expect(wrapper.find('[data-testid="st-error"]').exists()).toBe(false)
  })

  it('phone 特化：宽松数字 / + / - / 空格 7-20 位', async () => {
    const ok = mount(SpecializedText, { props: { spec: 'phone', modelValue: '+86 138-0013-8000' } })
    await ok.find('[data-testid="st-input"]').setValue('+86 138-0013-8000')
    ;(ok.vm as unknown as { commit: () => void }).commit()
    await ok.vm.$nextTick()
    expect(ok.find('[data-testid="st-error"]').exists()).toBe(false)

    const bad = mount(SpecializedText, { props: { spec: 'phone', modelValue: undefined } })
    await bad.find('[data-testid="st-input"]').setValue('abc123')
    ;(bad.vm as unknown as { commit: () => void }).commit()
    await bad.vm.$nextTick()
    expect(bad.emitted('update:modelValue')).toBeUndefined()
    expect(bad.find('[data-testid="st-error"]').text()).toBe('电话格式不正确')
  })

  it('清除按钮：emit undefined', async () => {
    const wrapper = mount(SpecializedText, { props: { spec: 'email', modelValue: 'a@b.com' } })
    ;(wrapper.vm as unknown as { clearValue: () => void }).clearValue()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([undefined])
  })
})
