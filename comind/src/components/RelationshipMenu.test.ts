import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import RelationshipMenu from './RelationshipMenu.vue'
import { useRelationshipMenu } from '../composables/useRelationshipMenu'
import { useRelationshipTypes } from '../composables/useRelationshipTypes'
import { db } from '../storage/db'

const mountOptions = {
  global: {
    stubs: {
      Teleport: { template: '<div><slot /></div>' }
    }
  }
}

describe('RelationshipMenu', () => {
  let menu: ReturnType<typeof useRelationshipMenu>
  let wrapper: VueWrapper | null = null

  beforeEach(async () => {
    await db.relationshipTypes.clear()
    const { _resetForTest, load } = useRelationshipTypes()
    _resetForTest()
    await load()
    menu = useRelationshipMenu()
    menu.close()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    menu.close()
  })

  function mountMenu() {
    wrapper = mount(RelationshipMenu, { props: { menu }, ...mountOptions })
    return wrapper
  }

  it('visible=false 时不渲染', () => {
    mountMenu()
    expect(wrapper!.find('.rel-menu').exists()).toBe(false)
  })

  it('visible=true 时渲染 6 行（4 对 + 2 自反）', async () => {
    mountMenu()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    expect(wrapper!.findAll('.rel-menu-item')).toHaveLength(useRelationshipTypes().items.value.length)
  })

  it('第一行默认高亮 forward 方向', async () => {
    mountMenu()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    const firstItem = wrapper!.findAll('.rel-menu-item')[0]
    expect(firstItem.classes()).toContain('selected')
    const forwardBtn = firstItem.find('.rel-menu-direction-forward')
    expect(forwardBtn.classes()).toContain('active')
  })

  it('配对行显示两个方向按钮 + 分隔符', async () => {
    mountMenu()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    const firstItem = wrapper!.findAll('.rel-menu-item')[0] // parent/child
    expect(firstItem.findAll('.rel-menu-direction')).toHaveLength(2)
    expect(firstItem.find('.rel-menu-sep').exists()).toBe(true)
  })

  it('自反行只显示一个方向按钮', async () => {
    mountMenu()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    const selfInverseItems = wrapper!.findAll('.rel-menu-item').filter(i => i.find('.rel-menu-direction-single').exists())
    expect(selfInverseItems).toHaveLength(2)
  })

  it('每行 forward 按钮显示中文 label', async () => {
    mountMenu()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    const items = wrapper!.findAll('.rel-menu-item')
    items.forEach((item, i) => {
      const forwardLabel = item.find('.rel-menu-direction-forward .rel-menu-type').text()
      expect(forwardLabel).toBe(menu.items.value[i].label)
    })
  })

  it('点击 forward 按钮触发 onSelect 并关闭', async () => {
    mountMenu()
    let selected: string | null = null
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: (t) => { selected = t } })
    await nextTick()
    await wrapper!.findAll('.rel-menu-item')[0].find('.rel-menu-direction-forward').trigger('mousedown')
    expect(selected).toBe(menu.items.value[0].type)
    expect(menu.state.value.visible).toBe(false)
  })

  it('点击 inverse 按钮触发 onSelect 并传入 inverse type', async () => {
    mountMenu()
    let selected: string | null = null
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: (t) => { selected = t } })
    await nextTick()
    await wrapper!.findAll('.rel-menu-item')[0].find('.rel-menu-direction-inverse').trigger('mousedown')
    expect(selected).toBe(menu.items.value[0].inverse)
    expect(menu.state.value.visible).toBe(false)
  })

  it('点击自反行按钮触发 onSelect 并关闭', async () => {
    mountMenu()
    let selected: string | null = null
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: (t) => { selected = t } })
    await nextTick()
    const lastIndex = menu.items.value.length - 1
    const lastItem = wrapper!.findAll('.rel-menu-item')[lastIndex]
    await lastItem.find('.rel-menu-direction-single').trigger('mousedown')
    expect(selected).toBe(menu.items.value[lastIndex].type)
    expect(menu.state.value.visible).toBe(false)
  })

  it('输入过滤后只剩匹配组', async () => {
    mountMenu()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    menu.setQuery('parent')
    await nextTick()
    const items = wrapper!.findAll('.rel-menu-item')
    expect(items.length).toBeGreaterThan(0)
    items.forEach(item => {
      expect(item.attributes('data-type')).toBe('parent')
    })
  })

  it('无匹配时显示占位', async () => {
    mountMenu()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    menu.setQuery('xyz')
    await nextTick()
    expect(wrapper!.find('.rel-menu-empty').exists()).toBe(true)
  })

  it('打开后键盘 ArrowDown 移动选中行', async () => {
    mountMenu()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    expect(menu.state.value.selectedGroupIndex).toBe(0)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await nextTick()
    expect(menu.state.value.selectedGroupIndex).toBe(1)
    expect(wrapper!.findAll('.rel-menu-item')[1].classes()).toContain('selected')
  })

  it('键盘 ArrowRight 切换到 inverse 方向', async () => {
    mountMenu()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    expect(menu.state.value.selectedDirection).toBe('forward')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    expect(menu.state.value.selectedDirection).toBe('inverse')
    const firstItem = wrapper!.findAll('.rel-menu-item')[0]
    expect(firstItem.find('.rel-menu-direction-inverse').classes()).toContain('active')
  })

  it('键盘 ArrowLeft 切回 forward 方向', async () => {
    mountMenu()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    menu.setDirection('inverse')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await nextTick()
    expect(menu.state.value.selectedDirection).toBe('forward')
  })

  it('键盘 Enter 在配对行触发 onSelect 并传入正向 type', async () => {
    mountMenu()
    let selected: string | null = null
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: (t) => { selected = t } })
    await nextTick()
    // 默认 group=0, direction=forward -> parent
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick()
    expect(selected).toBe('parent')
    expect(menu.state.value.visible).toBe(false)
  })

  it('键盘 ArrowDown + ArrowRight + Enter 组合：先选组再选方向', async () => {
    mountMenu()
    let selected: string | null = null
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: (t) => { selected = t } })
    await nextTick()
    // Step 1: 移到 references 组（index=2）
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await nextTick()
    expect(menu.state.value.selectedGroupIndex).toBe(2)
    // Step 2: 切到 inverse
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    expect(menu.state.value.selectedDirection).toBe('inverse')
    // 确认
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick()
    expect(selected).toBe('referenced-by')
  })

  it('键盘 Escape 关闭菜单', async () => {
    mountMenu()
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()
    expect(menu.state.value.visible).toBe(false)
  })
})
