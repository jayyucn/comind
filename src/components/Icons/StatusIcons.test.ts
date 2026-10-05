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
    // status-done 的默认语义色为 --success（形状仍为主、颜色为辅）
    expect(wrapper.find('svg').attributes('stroke')).toBe('var(--success)')
    expect(container.attributes('fill')).toBe('var(--success)')
    expect(container.attributes('fill-opacity')).toBe('0.18')
    expect(container.attributes('stroke')).toBe('none')
  })

  it('默认尺寸为 24（组件直挂与经 Icon 渲染两条路径一致）', () => {
    const direct = mount(StatusArchived)
    expect(direct.find('svg').attributes('width')).toBe('24')

    const viaIcon = mount(Icon, { props: { name: 'status-todo' } })
    expect(viaIcon.find('svg').attributes('width')).toBe('24')
  })

  it('5 个状态的默认语义色与查表一致（防止 STATUS_DEFAULT_COLORS 漂移）', () => {
    // 默认语义色集中维护在 Icon.vue 的 STATUS_DEFAULT_COLORS，组件文件零改动
    const EXPECTED: Record<string, string> = {
      'status-todo': 'var(--text-tertiary)',
      'status-doing': 'var(--accent)',
      'status-done': 'var(--success)',
      'status-canceled': 'var(--error)',
      'status-archived': 'var(--text-secondary)',
    }
    for (const name of STATUS_NAMES) {
      const svg = mount(Icon, { props: { name } }).find('svg')
      expect(svg.attributes('width'), `${name} 尺寸不一致`).toBe('24')
      expect(svg.attributes('stroke-width'), `${name} 描边不一致`).toBe('2')
      expect(svg.attributes('stroke'), `${name} 颜色不一致`).toBe(EXPECTED[name])
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

/**
 * priority 图标 = 象限方格（ADR-0054 D3）。
 *
 * 关键回归：包装组件必须透传 attrs。曾经的缺陷是`h()` 第二参数硬编码 props，
 * 导致模板传入的 `color` 丢失、图标退回 currentColor（文字色）—— 四档看起来没有对应颜色。
 * 「未显式传 color 时按 name 注入语义色」这条已有status 用例覆盖不到（priority 走包装层），
 * 故此处单独钉住。
 */
const PRIORITY_NAMES = ['priority-low', 'priority-medium', 'priority-high', 'priority-urgent']
const PRIORITY_EXPECT_COLOR: Record<string, string> = {
  'priority-low': 'var(--priority-low-fg)',
  'priority-medium': 'var(--priority-medium-fg)',
  'priority-high': 'var(--priority-high-fg)',
  'priority-urgent': 'var(--priority-urgent-fg)',
}

describe('优先级图标（象限方格，ADR-0054）', () => {
  it('4 档都能渲染出 svg，且 2×2 四格齐备（无旧十字轴 path）', () => {
    for (const name of PRIORITY_NAMES) {
      const wrapper = mount(Icon, { props: { name } })
      expect(wrapper.find('svg').exists(), `${name} 未渲染出 svg`).toBe(true)
      expect(wrapper.findAll('rect').length, `${name} 方格数不为 4`).toBe(4)
      expect(wrapper.find('path').exists(), `${name} 不应残留旧十字轴 path`).toBe(false)
    }
  })

  it('未显式传 color 时按档位注入对应语义色（attrs 透传回归）', () => {
    for (const name of PRIORITY_NAMES) {
      const wrapper = mount(Icon, { props: { name } })
      expect(wrapper.find('svg').attributes('stroke'), `${name} 未注入语义色`).toBe(PRIORITY_EXPECT_COLOR[name])
      // 点亮格用 fill（非 stroke）承载颜色，两者都应是语义色
      const active = wrapper.findAll('rect').find((r) => r.attributes('fill') === PRIORITY_EXPECT_COLOR[name])
      expect(active, `${name} 找不到实心点亮格`).toBeTruthy()
    }
  })

  it('四档点亮格各异：urgent 右上 / medium 左上 / high 右下 / low 左下（横轴=紧急、纵轴=重要）', () => {
    // 四格位置固定，只有实心格随 quadrant 变化 ⇒ 各档实心格的 x/y 组合必不相同
    const dots = PRIORITY_NAMES.map((name) => {
      const rects = mount(Icon, { props: { name } }).findAll('rect')
      const active = rects.find((r) => r.attributes('fill') === PRIORITY_EXPECT_COLOR[name])!
      return { name, x: Number(active.attributes('x')), y: Number(active.attributes('y')) }
    })
    const uniq = new Set(dots.map((d) => `${d.x},${d.y}`))
    expect(uniq.size, '四档点亮格出现重合，会导致并档').toBe(4)

    const at = (name: string) => dots.find((d) => d.name === name)!
    // viewBox 坐标：右 = x 较大，上 = y 较小
    const isRight = (d: { x: number }) => d.x > 12
    const isTop = (d: { y: number }) => d.y < 12
    expect(isRight(at('priority-urgent'))).toBe(true)   // 重要 + 紧急
    expect(isTop(at('priority-urgent'))).toBe(true)
    expect(isTop(at('priority-medium'))).toBe(true)      // 重要但不紧急
    expect(isRight(at('priority-medium'))).toBe(false)
    expect(isRight(at('priority-high'))).toBe(true)      // 紧急但不重要
    expect(isTop(at('priority-high'))).toBe(false)
    expect(isRight(at('priority-low'))).toBe(false)     // 都不重要
    expect(isTop(at('priority-low'))).toBe(false)
  })

  it('未点亮的三格为空心描边，且以降不透明度退居次要', () => {
    const wrapper = mount(Icon, { props: { name: 'priority-urgent' } })
    const hollow = wrapper.findAll('rect').filter((r) => r.attributes('fill') === 'none')
    expect(hollow.length, '空心格数不为 3').toBe(3)
    for (const r of hollow) {
      expect(r.attributes('stroke-opacity')).toBe('0.45')
    }
    // 实心格不设描边不透明度（继承 root 的 1），保证最突出
    const active = wrapper.findAll('rect').find((r) => r.attributes('fill') === PRIORITY_EXPECT_COLOR['priority-urgent'])
    expect(active!.attributes('stroke-opacity')).toBeUndefined()
  })

  it('size / strokeWidth / color 可透传（包装层）', () => {
    const wrapper = mount(Icon, {
      props: { name: 'priority-urgent', size: 20, strokeWidth: 1.7, color: 'red' },
    })
    const svg = wrapper.find('svg')
    expect(svg.attributes('width')).toBe('20')
    expect(svg.attributes('height')).toBe('20')
    expect(svg.attributes('stroke-width')).toBe('1.7')
    expect(svg.attributes('stroke')).toBe('red')
    const active = wrapper.findAll('rect').find((r) => r.attributes('fill') === 'red')
    expect(active, '点亮格未落透传色').toBeTruthy()
  })
})
