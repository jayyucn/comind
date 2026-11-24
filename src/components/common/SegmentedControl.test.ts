import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SegmentedControl from './SegmentedControl.vue'

/**
 * SegmentedControl（ADR-0057 ② 特化行载体）：
 * radiogroup 语义、点击/方向键换档（roving tabindex + 循环）。
 */

const OPTIONS = [
  { value: '', label: '无' },
  { value: 'a', label: '甲' },
  { value: 'b', label: '乙' },
]

function mountSeg(modelValue = '') {
  return mount(SegmentedControl, {
    props: { options: OPTIONS, modelValue, 'aria-label': '测试分段' },
  })
}

describe('SegmentedControl', () => {
  it('渲染 radiogroup；激活档 aria-checked 且 tabindex=0（roving），其余 -1', () => {
    const w = mountSeg('a')
    expect(w.find('[role="radiogroup"]').attributes('aria-label')).toBe('测试分段')
    const items = w.findAll('[role="radio"]')
    expect(items).toHaveLength(3)
    expect(items[1].classes()).toContain('seg-item--active')
    expect(items[1].attributes('aria-checked')).toBe('true')
    expect(items[1].attributes('tabindex')).toBe('0')
    expect(items[0].attributes('tabindex')).toBe('-1')
    w.unmount()
  })

  it('点击档位 emit update:modelValue', async () => {
    const w = mountSeg('')
    await w.findAll('[role="radio"]')[2].trigger('click')
    expect(w.emitted('update:modelValue')![0]).toEqual(['b'])
    w.unmount()
  })

  it('方向键循环换档：→ 到下一档，← 在首档循环回末档', async () => {
    const w = mountSeg('a')
    await w.find('[role="radiogroup"]').trigger('keydown', { key: 'ArrowRight' })
    expect(w.emitted('update:modelValue')![0]).toEqual(['b'])
    // ← 从当前模型值 'a' 退一档到「无」（props 未随 emit 变，以模型值为基准计算）
    await w.findAll('[role="radio"]')[0].trigger('keydown', { key: 'ArrowLeft' })
    expect(w.emitted('update:modelValue')![1]).toEqual([''])
    w.unmount()
  })
})
