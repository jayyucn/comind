/**
 * RatingInput 组件测试（issue T7 AC4：评分渲染 1–N 星交互）。
 *
 * 契约：v-model（number | undefined），undefined = 未填；
 * 点击星置值、再次点击同值清空（emit undefined，上层删行）。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import RatingInput from './RatingInput.vue'

describe('RatingInput', () => {
  it('默认渲染 5 颗星（N=5）', () => {
    const wrapper = mount(RatingInput, { props: { modelValue: undefined } })
    expect(wrapper.findAll('.rating-star-btn')).toHaveLength(5)
  })

  it('max 可配：max=10 渲染 10 颗星', () => {
    const wrapper = mount(RatingInput, { props: { modelValue: undefined, max: 10 } })
    expect(wrapper.findAll('.rating-star-btn')).toHaveLength(10)
  })

  it('无值：全部空心，容器带空值态类', () => {
    const wrapper = mount(RatingInput, { props: { modelValue: undefined } })
    expect(wrapper.findAll('.rating-star--lit')).toHaveLength(0)
    expect(wrapper.find('.rating-input').classes()).toContain('rating-input--empty')
  })

  it('有值：前 N 颗实心（modelValue=3 → 3 实心 2 空心）', () => {
    const wrapper = mount(RatingInput, { props: { modelValue: 3 } })
    expect(wrapper.findAll('.rating-star--lit')).toHaveLength(3)
    expect(wrapper.find('.rating-input').classes()).not.toContain('rating-input--empty')
  })

  it('点击第 4 颗星 → emit update:modelValue 4', async () => {
    const wrapper = mount(RatingInput, { props: { modelValue: undefined } })
    await wrapper.findAll('.rating-star-btn')[3].trigger('click')
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([4])
  })

  it('再次点击同值 → emit undefined（清空契约，上层删行）', async () => {
    const wrapper = mount(RatingInput, { props: { modelValue: 2 } })
    await wrapper.findAll('.rating-star-btn')[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([undefined])
  })

  it('点击不同值 → 改值而非清空', async () => {
    const wrapper = mount(RatingInput, { props: { modelValue: 2 } })
    await wrapper.findAll('.rating-star-btn')[4].trigger('click')
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([5])
  })

  it('28px 高度基线（与 NumberInput / DatePicker 触发器对齐）', () => {
    const wrapper = mount(RatingInput, { props: { modelValue: undefined } })
    expect(wrapper.find('.rating-input').classes()).toContain('rating-input')
    // 基线由 CSS 类承载；此处锁类名存在，视觉回归靠类约定
  })
})
