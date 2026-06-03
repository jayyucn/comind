import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import RelationshipMenu from './RelationshipMenu.vue'
import { useRelationshipMenu } from '../composables/useRelationshipMenu'
import { PREDEFINED_RELATIONSHIPS } from '../types/relationship'

const mountOptions = {
  global: {
    stubs: {
      Teleport: { template: '<div><slot /></div>' }
    }
  }
}

describe('RelationshipMenu', () => {
  let menu: ReturnType<typeof useRelationshipMenu>

  beforeEach(() => {
    menu = useRelationshipMenu()
  })

  it('visible=false 时不渲染', () => {
    const wrapper = mount(RelationshipMenu, { props: { menu }, ...mountOptions })
    expect(wrapper.find('.rel-menu').exists()).toBe(false)
  })

  it('visible=true 时渲染全部 10 项', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu }, ...mountOptions })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    expect(wrapper.findAll('.rel-menu-item')).toHaveLength(PREDEFINED_RELATIONSHIPS.length)
  })

  it('第一项默认高亮', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu }, ...mountOptions })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    const items = wrapper.findAll('.rel-menu-item')
    expect(items[0].classes()).toContain('selected')
    expect(items[0].text()).toContain(PREDEFINED_RELATIONSHIPS[0].type)
  })

  it('输入过滤后只剩匹配项', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu }, ...mountOptions })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    menu.setQuery('rel')
    await nextTick()
    const items = wrapper.findAll('.rel-menu-item')
    expect(items.length).toBeGreaterThan(0)
    items.forEach(item => {
      expect(item.text().toLowerCase()).toContain('rel')
    })
  })

  it('点击 item 触发 onSelect 并关闭', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu }, ...mountOptions })
    let selected: string | null = null
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: (t) => { selected = t } })
    await nextTick()
    const targetIndex = 2
    await wrapper.findAll('.rel-menu-item')[targetIndex].trigger('mousedown')
    expect(selected).toBe(PREDEFINED_RELATIONSHIPS[targetIndex].type)
    expect(menu.state.value.visible).toBe(false)
  })

  it('无匹配时显示占位', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu }, ...mountOptions })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    menu.setQuery('xyz')
    await nextTick()
    expect(wrapper.find('.rel-menu-empty').exists()).toBe(true)
  })
})
