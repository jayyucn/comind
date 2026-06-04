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
    expect(items[0].text()).toContain(PREDEFINED_RELATIONSHIPS[0].label)
  })

  it('item 显示中文 label 而非英文 type', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu }, ...mountOptions })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    const items = wrapper.findAll('.rel-menu-item')
    items.forEach((item, i) => {
      const typeSpan = item.find('.rel-menu-type')
      const expected = PREDEFINED_RELATIONSHIPS[i].label
      expect(typeSpan.text()).toBe(expected)
    })
  })

  it('self-inverse 项不显示 inverse 部分', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu }, ...mountOptions })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    await nextTick()
    const items = wrapper.findAll('.rel-menu-item')
    const selfInverse = PREDEFINED_RELATIONSHIPS.filter(r => r.type === r.inverse)
    const selfInverseIdx = PREDEFINED_RELATIONSHIPS.findIndex(r => r.type === selfInverse[0].type)
    expect(items[selfInverseIdx].find('.rel-menu-inverse').exists()).toBe(false)
  })

  it('输入过滤后只剩匹配项', async () => {
    const wrapper = mount(RelationshipMenu, { props: { menu }, ...mountOptions })
    menu.open({ view: { dom: { isConnected: true } }, position: { x: 0, y: 0 }, range: { from: 0, to: 0 }, onSelect: () => {} })
    menu.setQuery('rel')
    await nextTick()
    const items = wrapper.findAll('.rel-menu-item')
    expect(items.length).toBeGreaterThan(0)
    // 过滤按英文 type 匹配（query 是英文），显示是中文 label
    // 验证：每个 item 的 [data-type] 都含 'rel'，且显示的是对应中文 label
    items.forEach(item => {
      const dataType = item.attributes('data-type') ?? ''
      expect(dataType.toLowerCase()).toContain('rel')
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
