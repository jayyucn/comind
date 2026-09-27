/**
 * 标签色选色器单测（ADR-0050 D11 身份三要素之三）。
 *
 * 接缝：`BasePopover` 会 Teleport 到 body，故挂载需 `attachTo`，断言面板要从
 * `document.body` 里查（先例：`TagsLibrary.test.ts` 的 parent-picker）。
 *
 * 重点覆盖「不该发事件」的分支 —— 点自己当前那一色不落库，是本组件唯一的逻辑分支。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import TagColorPicker from './TagColorPicker.vue'
import { TAG_COLORS } from '../../utils/tag-color'

function mountPicker(props: { value: string; readonly?: boolean }) {
  return mount(TagColorPicker, { props, attachTo: document.body })
}

/** 点触发点展开弹层，返回面板元素。 */
async function openPanel(wrapper: ReturnType<typeof mount>) {
  await wrapper.find('.tag-color-trigger').trigger('click')
  const panel = document.body.querySelector('.tag-color-panel')
  expect(panel, '弹层应已展开').toBeTruthy()
  return panel as HTMLElement
}

function swatchByLabel(panel: HTMLElement, label: string): HTMLElement {
  const el = Array.from(panel.querySelectorAll('.tag-color-swatch')).find(
    (s) => s.getAttribute('aria-label') === label,
  )
  expect(el, `找不到色点「${label}」`).toBeTruthy()
  return el as HTMLElement
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TagColorPicker（标签色选色器）', () => {
  it('有色：触发点是实心色点，背景取该 token', () => {
    const wrapper = mountPicker({ value: '--tag-color-3' })
    const trigger = wrapper.find('.tag-color-trigger')
    expect(trigger.attributes('style')).toContain('var(--tag-color-3)')
    expect(trigger.classes()).not.toContain('tag-color-trigger--empty')
    wrapper.unmount()
  })

  it('无色（空串）与非法值：落成空心环，且不带任何内联背景', () => {
    for (const value of ['', 'red; background: url(//evil)']) {
      const wrapper = mountPicker({ value })
      const trigger = wrapper.find('.tag-color-trigger')
      expect(trigger.classes(), value).toContain('tag-color-trigger--empty')
      expect(trigger.attributes('style'), value).toBeUndefined()
      wrapper.unmount()
    }
  })

  it('readonly：不渲染可点触发按钮，点击也不弹面板', async () => {
    const wrapper = mountPicker({ value: '--tag-color-2', readonly: true })
    expect(wrapper.find('button.tag-color-trigger').exists()).toBe(false)
    const dot = wrapper.find('span.tag-color-trigger')
    expect(dot.classes()).toContain('tag-color-trigger--readonly')

    await dot.trigger('click')
    expect(document.body.querySelector('.tag-color-panel')).toBeFalsy()
    wrapper.unmount()
  })

  it('展开面板：无色项 + 全量调色板，且只有一个当前色被标记', async () => {
    const wrapper = mountPicker({ value: '--tag-color-5' })
    const panel = await openPanel(wrapper)

    expect(panel.querySelector('.tag-color-swatch--none')).toBeTruthy()
    // 无色档（Ban 图标）也复用 .tag-color-swatch，总数 = 全量调色板 + 1
    expect(panel.querySelectorAll('.tag-color-swatch')).toHaveLength(TAG_COLORS.length + 1)

    const active = panel.querySelectorAll('.tag-color-swatch--active')
    expect(active).toHaveLength(1)
    expect(swatchByLabel(panel, '琥珀').classList).toContain('tag-color-swatch--active')
    wrapper.unmount()
  })

  it('选色：emit pick 带 token 名', async () => {
    const wrapper = mountPicker({ value: '' })
    const panel = await openPanel(wrapper)

    swatchByLabel(panel, '青绿').click()

    expect(wrapper.emitted('pick')).toEqual([['--tag-color-3']])
    wrapper.unmount()
  })

  it('选「无色」：emit pick 带 null（调用方据此发空串，D11 空串是有效值）', async () => {
    const wrapper = mountPicker({ value: '--tag-color-3' })
    const panel = await openPanel(wrapper)

    ;(panel.querySelector('.tag-color-swatch--none') as HTMLElement).click()

    expect(wrapper.emitted('pick')).toEqual([[null]])
    wrapper.unmount()
  })

  it('点自己当前那一色：不 emit（省掉一次无意义的写与 store 重读）', async () => {
    const wrapper = mountPicker({ value: '--tag-color-3' })
    const panel = await openPanel(wrapper)

    ;(panel.querySelector('.tag-color-swatch--active') as HTMLElement).click()

    expect(wrapper.emitted('pick')).toBeUndefined()
    wrapper.unmount()
  })

  it('无色状态下点「无色」同样不 emit', async () => {
    const wrapper = mountPicker({ value: '' })
    const panel = await openPanel(wrapper)

    ;(panel.querySelector('.tag-color-swatch--none') as HTMLElement).click()

    expect(wrapper.emitted('pick')).toBeUndefined()
    wrapper.unmount()
  })
})
