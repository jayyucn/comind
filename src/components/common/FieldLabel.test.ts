import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { Banknote, Hash, User } from 'lucide-vue-next'
import FieldLabel from './FieldLabel.vue'

/**
 * FieldLabel（ADR-0057 D1）：类型图标 + 字段名，图标即设置入口。
 * 门禁语义：editable=false 时图标仍渲染但不可点击（不静默失败）。
 * 特化语义：传入 spec 且命中特化档时图标跟随特化（与 FieldSettingsModal 头部同源）。
 */
describe('FieldLabel', () => {
  it('渲染字段名与类型图标（select → List 系图标）', () => {
    const w = mount(FieldLabel, { props: { title: '状态', type: 'select' } })
    expect(w.text()).toContain('状态')
    const btn = w.find('button.field-label-entry')
    expect(btn.exists()).toBe(true)
    expect(btn.find('svg').exists()).toBe(true)
  })

  it('可编辑字段：点击图标 emit open-settings', async () => {
    const w = mount(FieldLabel, { props: { title: '状态', type: 'select', editable: true } })
    await w.find('button.field-label-entry').trigger('click')
    expect(w.emitted('open-settings')).toHaveLength(1)
  })

  it('门禁：editable=false 时按钮 disabled 且点击不 emit（不静默失败）', async () => {
    const w = mount(FieldLabel, { props: { title: '负责人', type: 'page', editable: false } })
    const btn = w.find('button.field-label-entry')
    expect(btn.attributes('disabled')).toBeDefined()
    await btn.trigger('click')
    expect(w.emitted('open-settings')).toBeUndefined()
  })

  it('openable 与 editable 解耦：系统字段不可编辑但可点开只读弹窗', async () => {
    const w = mount(FieldLabel, {
      props: { title: '状态', type: 'select', editable: false, openable: true },
    })
    const btn = w.find('button.field-label-entry')
    expect(btn.attributes('disabled')).toBeUndefined()
    // tooltip 说明只读语义，调用方不猜
    expect(btn.attributes('title')).toContain('只读')
    await btn.trigger('click')
    expect(w.emitted('open-settings')).toHaveLength(1)
    w.unmount()
  })

  it('openable=false 显式压过 editable=true（调用方显式关闭入口，tooltip 中性提示）', async () => {
    const w = mount(FieldLabel, {
      props: { title: '负责人', type: 'page', editable: true, openable: false },
    })
    const btn = w.find('button.field-label-entry')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.attributes('title')).toContain('不开放')
    w.unmount()
  })

  it('默认可编辑（editable 缺省 true）', async () => {
    const w = mount(FieldLabel, { props: { title: '预估工时', type: 'number' } })
    expect(w.find('button.field-label-entry').attributes('disabled')).toBeUndefined()
    await w.find('button.field-label-entry').trigger('click')
    expect(w.emitted('open-settings')).toHaveLength(1)
  })

  it('未知类型回落 Type 图标（不抛错）', () => {
    const w = mount(FieldLabel, { props: { title: '神秘字段', type: 'mystery' } })
    expect(w.find('svg').exists()).toBe(true)
  })

  it('无特化回落类型图标（number → Hash）', () => {
    const w = mount(FieldLabel, { props: { title: '价格', type: 'number' } })
    expect(w.findComponent(Hash).exists()).toBe(true)
    w.unmount()
  })

  it('特化命中时图标跟随特化（number + currency → Banknote；page + person → User）', () => {
    const w = mount(FieldLabel, { props: { title: '价格', type: 'number', spec: 'currency' } })
    expect(w.findComponent(Banknote).exists()).toBe(true)
    w.unmount()

    const w2 = mount(FieldLabel, { props: { title: '负责人', type: 'page', spec: 'person' } })
    expect(w2.findComponent(User).exists()).toBe(true)
    w2.unmount()
  })

  it('未知特化回落类型图标（spec 不命中表时安全降级）', () => {
    const w = mount(FieldLabel, { props: { title: '价格', type: 'number', spec: 'mystery' } })
    expect(w.findComponent(Hash).exists()).toBe(true)
    w.unmount()
  })
})
