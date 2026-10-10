/**
 * DateTimePicker（日期时间选择，T2）测试。
 *
 * 覆盖值契约（'yyyy-MM-dd HH:mm' | undefined）与交互语义：
 * - 触发器显示原文 / 占位
 * - 选日期 → 带时间部分（默认 00:00）回传，面板保持打开
 * - 改时间档 → 同日新时间回传；未选日期时不产半值
 * - 清除 → undefined
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DateTimePicker from './DateTimePicker.vue'

type VM = { onSelect: (date: string) => void }

function lastEmitted(wrapper: ReturnType<typeof mount>): unknown[] | undefined {
  const events = wrapper.emitted('update:modelValue')
  return events?.[events.length - 1]
}

describe('DateTimePicker（日期时间选择）', () => {
  it('无值：触发器显示占位「选择日期时间」', () => {
    const wrapper = mount(DateTimePicker)
    expect(wrapper.find('[data-testid="dtp-trigger"]').classes()).toContain('placeholder')
    expect(wrapper.find('.dtp-text').text()).toBe('选择日期时间')
  })

  it('有值：触发器原样显示 yyyy-MM-dd HH:mm', () => {
    const wrapper = mount(DateTimePicker, { props: { modelValue: '2026-09-06 10:44' } })
    expect(wrapper.find('.dtp-text').text()).toBe('2026-09-06 10:44')
  })

  it('选日期 → 带默认 00:00 的时间部分回传，面板保持打开以便调时间', async () => {
    const wrapper = mount(DateTimePicker)
    await wrapper.find('[data-testid="dtp-trigger"]').trigger('click')
    expect(document.body.querySelector('.dtp-panel')).not.toBeNull()

    ;(wrapper.vm as unknown as VM).onSelect('2026-09-06')

    const events = wrapper.emitted('update:modelValue')
    expect(events).toHaveLength(1)
    expect(events![0]).toEqual(['2026-09-06 00:00'])
    // 与 DatePicker「单选即关」不同：datetime 需留在面板里调时间
    expect(document.body.querySelector('.dtp-panel')).not.toBeNull()
    wrapper.unmount()
  })

  it('已有值下改时间档 → 同日新时间回传', async () => {
    const wrapper = mount(DateTimePicker, { props: { modelValue: '2026-09-06 10:44' } })
    await wrapper.find('[data-testid="dtp-trigger"]').trigger('click')

    const time = document.body.querySelector('[data-testid="dtp-time"]') as HTMLInputElement
    expect(time.disabled).toBe(false)
    time.value = '08:30'
    await time.dispatchEvent(new Event('input'))

    expect(lastEmitted(wrapper)).toEqual(['2026-09-06 08:30'])
    wrapper.unmount()
  })

  it('未选日期时时间输入禁用且不回传半值', async () => {
    const wrapper = mount(DateTimePicker)
    await wrapper.find('[data-testid="dtp-trigger"]').trigger('click')

    const time = document.body.querySelector('[data-testid="dtp-time"]') as HTMLInputElement
    expect(time.disabled).toBe(true)
    time.value = '08:30'
    await time.dispatchEvent(new Event('input'))

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('清除 → 回传 undefined', async () => {
    const wrapper = mount(DateTimePicker, { props: { modelValue: '2026-09-06 10:44' } })
    await wrapper.find('.dtp-clear').trigger('click')
    expect(lastEmitted(wrapper)).toEqual([undefined])
  })

  it('值拼装为纯字符串操作：回传恒为 yyyy-MM-dd HH:mm 形（跨引擎安全，不经空格形 Date 解析）', async () => {
    const wrapper = mount(DateTimePicker, { props: { modelValue: '2026-09-06 10:44' } })
    ;(wrapper.vm as unknown as VM).onSelect('2026-09-07')
    expect(lastEmitted(wrapper)).toEqual(['2026-09-07 10:44'])
    expect(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(lastEmitted(wrapper)![0] as string)).toBe(true)
  })
})
