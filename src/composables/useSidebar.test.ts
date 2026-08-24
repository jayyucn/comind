import { describe, test, expect, beforeEach } from 'vitest'
import { useSidebar } from './useSidebar'

beforeEach(() => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('comind:sidebar-collapsed')
  }
  // 重置模块级状态
  const { expand } = useSidebar()
  expand()
})

describe('useSidebar', () => {
  test('初始状态下 isCollapsed 为 false', () => {
    const { isCollapsed } = useSidebar()
    expect(isCollapsed.value).toBe(false)
  })

  test('toggle 切换侧边栏状态', () => {
    const { isCollapsed, toggle } = useSidebar()
    expect(isCollapsed.value).toBe(false)
    toggle()
    expect(isCollapsed.value).toBe(true)
    toggle()
    expect(isCollapsed.value).toBe(false)
  })

  test('collapse 折叠侧边栏', () => {
    const { isCollapsed, collapse } = useSidebar()
    collapse()
    expect(isCollapsed.value).toBe(true)
  })

  test('expand 展开侧边栏', () => {
    const { isCollapsed, expand, collapse } = useSidebar()
    collapse()
    expect(isCollapsed.value).toBe(true)
    expand()
    expect(isCollapsed.value).toBe(false)
  })

  test('多次调用 collapse 无副作用', () => {
    const { isCollapsed, collapse } = useSidebar()
    collapse()
    expect(isCollapsed.value).toBe(true)
    collapse()
    expect(isCollapsed.value).toBe(true)
  })

  test('多次调用 expand 无副作用', () => {
    const { isCollapsed, expand } = useSidebar()
    expand()
    expect(isCollapsed.value).toBe(false)
    expand()
    expect(isCollapsed.value).toBe(false)
  })

  test('多个实例共享同一状态（单例）', () => {
    const instance1 = useSidebar()
    const instance2 = useSidebar()

    instance1.toggle()
    expect(instance2.isCollapsed.value).toBe(true)

    instance2.expand()
    expect(instance1.isCollapsed.value).toBe(false)
  })
})
