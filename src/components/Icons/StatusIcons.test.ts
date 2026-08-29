import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Icon from './Icon.vue'
import StatusArchived from './StatusIcons/StatusArchived.vue'
import { TASK_STATUS_ICONS } from './index'

const STATUS_NAMES = [
  'status-todo',
  'status-doing',
  'status-done',
  'status-canceled',
  'status-archived',
]

describe('任务状态图标家族（V2 实心徽章）', () => {
  it('5 个状态名都能渲染出图标，含新增的 archived', () => {
    for (const name of STATUS_NAMES) {
      const wrapper = mount(Icon, { props: { name } })
      expect(wrapper.find('svg').exists(), `${name} 未渲染出 svg`).toBe(true)
    }
  })

  it('TASK_STATUS_ICONS 暴露全部 5 个状态', () => {
    expect(Object.values(TASK_STATUS_ICONS).sort()).toEqual([...STATUS_NAMES].sort())
  })

  it('默认渲染方形容器', () => {
    const wrapper = mount(Icon, { props: { name: 'status-done' } })
    expect(wrapper.find('rect').exists()).toBe(true)
    expect(wrapper.find('circle').exists()).toBe(false)
  })

  it('shape=round 渲染圆形容器', () => {
    const wrapper = mount(Icon, { props: { name: 'status-done', shape: 'round' } })
    expect(wrapper.find('circle').exists()).toBe(true)
    expect(wrapper.find('rect').exists()).toBe(false)
  })

  it('填充与描边同色，填充 18% 且不描边', () => {
    const wrapper = mount(Icon, { props: { name: 'status-done' } })
    const container = wrapper.find('rect')
    expect(wrapper.find('svg').attributes('stroke')).toBe('var(--text-primary)')
    expect(container.attributes('fill')).toBe('var(--text-primary)')
    expect(container.attributes('fill-opacity')).toBe('0.18')
    expect(container.attributes('stroke')).toBe('none')
  })

  it('默认尺寸为 24（组件直挂与经 Icon 渲染两条路径一致）', () => {
    const direct = mount(StatusArchived)
    expect(direct.find('svg').attributes('width')).toBe('24')

    const viaIcon = mount(Icon, { props: { name: 'status-todo' } })
    expect(viaIcon.find('svg').attributes('width')).toBe('24')
  })

  it('5 个组件的默认值保持一致（防止单个文件漂移）', () => {
    // 默认值分散在 5 个文件里，曾出现过 18/24、round/square 混杂的漂移
    for (const name of STATUS_NAMES) {
      const svg = mount(Icon, { props: { name } }).find('svg')
      expect(svg.attributes('width'), `${name} 尺寸不一致`).toBe('24')
      expect(svg.attributes('stroke-width'), `${name} 描边不一致`).toBe('2')
      expect(svg.attributes('stroke'), `${name} 颜色不一致`).toBe('var(--text-primary)')
    }
  })

  it('archived 的符号随容器变化：圆=盒子+箭头，方=仅箭头', () => {
    const round = mount(StatusArchived, { props: { shape: 'round' } })
    expect(round.find('circle').exists()).toBe(true)
    expect(round.find('rect').attributes('x')).toBe('8.5')

    const square = mount(StatusArchived, { props: { shape: 'square' } })
    expect(square.find('circle').exists()).toBe(false)
    expect(square.find('rect').attributes('x')).toBe('3')
    expect(square.findAll('path').length).toBe(1)
  })

  it('size / strokeWidth / color 可透传', () => {
    const wrapper = mount(Icon, {
      props: { name: 'status-todo', size: 24, strokeWidth: 1.5, color: 'red' },
    })
    const svg = wrapper.find('svg')
    expect(svg.attributes('width')).toBe('24')
    expect(svg.attributes('height')).toBe('24')
    expect(svg.attributes('stroke-width')).toBe('1.5')
    expect(svg.attributes('stroke')).toBe('red')
  })

  it('shape 不透传给非状态图标', () => {
    const wrapper = mount(Icon, { props: { name: 'icon-close', shape: 'square' } })
    expect(wrapper.find('svg').attributes('shape')).toBeUndefined()
  })
})
