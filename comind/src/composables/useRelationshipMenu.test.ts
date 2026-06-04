import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { useRelationshipMenu } from './useRelationshipMenu'
import { useRelationshipTypes } from './useRelationshipTypes'
import { getGroupByType } from '../types/relationship'

beforeEach(async () => {
  const { _resetForTest, load } = useRelationshipTypes()
  _resetForTest()
  await load()
})

describe('useRelationshipMenu', () => {
  let menu: ReturnType<typeof useRelationshipMenu>

  beforeEach(() => {
    menu = useRelationshipMenu()
    menu.close()
  })

  it('初始状态不可见', () => {
    expect(menu.state.value.visible).toBe(false)
  })

  it('open 设置 visible、position、range、query', () => {
    const onSelect = vi.fn()
    menu.open({
      view: { dom: { isConnected: true } },
      position: { x: 100, y: 200 },
      range: { from: 5, to: 5 },
      initialQuery: '',
      onSelect
    })
    expect(menu.state.value.visible).toBe(true)
    expect(menu.state.value.position).toEqual({ x: 100, y: 200 })
    expect(menu.state.value.range).toEqual({ from: 5, to: 5 })
    expect(menu.state.value.query).toBe('')
    expect(menu.state.value.selectedGroupIndex).toBe(0)
    expect(menu.state.value.selectedDirection).toBe('forward')
    expect(menu.state.value.onSelect).toBe(onSelect)
  })

  it('open 带 currentType 会预选到对应组和方向', () => {
    menu.open({
      view: { dom: { isConnected: true } },
      position: { x: 0, y: 0 },
      range: { from: 0, to: 0 },
      currentType: 'child',
      onSelect: vi.fn()
    })
    const group = getGroupByType('child')!
    const items = useRelationshipTypes().items.value
    const idx = items.findIndex(g => g.type === group!.type)
    expect(menu.state.value.selectedGroupIndex).toBe(idx)
    expect(menu.state.value.selectedDirection).toBe('inverse')
  })

  it('再次 open 会先关闭上一个（单例）', () => {
    const onSelect1 = vi.fn()
    const onSelect2 = vi.fn()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: onSelect1 })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 1, y: 1 }, range: { from: 1, to: 1 }, onSelect: onSelect2 })
    expect(menu.state.value.onSelect).toBe(onSelect2)
  })

  it('editor view 已销毁时 open no-op', () => {
    menu.open({
      view: { dom: { isConnected: false } },
      position: { x: 0, y: 0 },
      range: { from: 0, to: 0 },
      onSelect: vi.fn()
    })
    expect(menu.state.value.visible).toBe(false)
  })

  it('openSwitch 设置 currentType 用于预选', () => {
    menu.openSwitch({
      view: { dom: { isConnected: true } },
      position: { x: 0, y: 0 },
      range: { from: 0, to: 0 },
      currentType: 'related',
      onSelect: vi.fn()
    })
    expect(menu.state.value.currentType).toBe('related')
  })

  it('close 重置状态', () => {
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: vi.fn() })
    menu.close()
    expect(menu.state.value.visible).toBe(false)
    expect(menu.state.value.position).toBeNull()
    expect(menu.state.value.range).toBeNull()
  })

  it('items 默认返回所有 6 个组', () => {
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: vi.fn() })
    expect(menu.items.value).toHaveLength(useRelationshipTypes().items.value.length)
  })

  it('items 按 query 过滤（匹配正反 type 和 label）', () => {
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: vi.fn() })
    menu.setQuery('parent')
    // parent/child 组有 label "父级"，但 type 字段是 forward 的 'parent'
    expect(menu.items.value.some(g => g.type === 'parent')).toBe(true)

    menu.setQuery('依赖')
    // 依赖 组同时有 label "依赖" 和 inverseLabel "被依赖"，匹配中文 query
    expect(menu.items.value.some(g => g.type === 'depends-on')).toBe(true)
    // 正反 type 都参与英文匹配
    menu.setQuery('referenced')
    expect(menu.items.value.some(g => g.type === 'references')).toBe(true)
  })

  it('moveGroup 上下移动 selectedGroupIndex 并在边界环绕', () => {
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: vi.fn() })
    expect(menu.state.value.selectedGroupIndex).toBe(0)
    menu.moveGroup(1)
    expect(menu.state.value.selectedGroupIndex).toBe(1)
    menu.moveGroup(-1)
    expect(menu.state.value.selectedGroupIndex).toBe(0)
    menu.moveGroup(-1)
    expect(menu.state.value.selectedGroupIndex).toBe(useRelationshipTypes().items.value.length - 1)
  })

  it('切换到自反组时 direction 强制为 forward', () => {
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: vi.fn() })
    menu.setSelectedGroupIndex(useRelationshipTypes().items.value.length - 1) // similar
    expect(menu.state.value.selectedDirection).toBe('forward')
    menu.setDirection('inverse')
    expect(menu.state.value.selectedDirection).toBe('forward') // 自反组忽略 inverse
  })

  it('setDirection 切换正反方向', () => {
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: vi.fn() })
    expect(menu.state.value.selectedDirection).toBe('forward')
    menu.setDirection('inverse')
    expect(menu.state.value.selectedDirection).toBe('inverse')
    menu.setDirection('forward')
    expect(menu.state.value.selectedDirection).toBe('forward')
  })

  it('resolveType 根据 (group, direction) 解析为正确 type', () => {
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: vi.fn() })
    expect(menu.resolveType()).toBe('parent')
    menu.setDirection('inverse')
    expect(menu.resolveType()).toBe('child')
  })

  it('select 触发 onSelect 并传入解析后的 type', () => {
    const onSelect = vi.fn()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect })
    menu.setSelectedGroupIndex(2) // references
    menu.setDirection('inverse') // referenced-by
    menu.select()
    expect(onSelect).toHaveBeenCalledWith('referenced-by')
    expect(menu.state.value.visible).toBe(false)
  })
})

describe('useRelationshipMenu 与 useRelationshipTypes 联动', () => {
  it('创建新类型后菜单 items 立即出现', async () => {
    const menu = useRelationshipMenu()
    menu.close()
    const { create } = useRelationshipTypes()
    await create({ type: 'blocker', inverse: 'blocked-by', label: '阻塞', inverseLabel: '被阻塞', color: '#ff0000' })
    expect(menu.items.value.find(g => g.type === 'blocker')).toBeTruthy()
  })

  it('软删后菜单 items 不再包含', async () => {
    const menu = useRelationshipMenu()
    menu.close()
    const { softDelete } = useRelationshipTypes()
    await softDelete('rt_seed_parent')
    expect(menu.items.value.find(g => g.type === 'parent')).toBeUndefined()
  })

  it('恢复后菜单 items 重新包含', async () => {
    const menu = useRelationshipMenu()
    menu.close()
    const { softDelete, restore } = useRelationshipTypes()
    await softDelete('rt_seed_parent')
    await restore('rt_seed_parent')
    expect(menu.items.value.find(g => g.type === 'parent')).toBeTruthy()
  })
})
