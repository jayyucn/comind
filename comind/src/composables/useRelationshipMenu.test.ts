import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRelationshipMenu } from './useRelationshipMenu'

describe('useRelationshipMenu', () => {
  let menu: ReturnType<typeof useRelationshipMenu>

  beforeEach(() => {
    menu = useRelationshipMenu()
  })

  it('初始状态不可见', () => {
    expect(menu.state.value.visible).toBe(false)
  })

  it('open 设置 visible 和初始 query', () => {
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
    expect(menu.state.value.selectedIndex).toBe(0)
    expect(menu.state.value.onSelect).toBe(onSelect)
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
})
