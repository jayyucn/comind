import { describe, it, expect, vi } from 'vitest'
import { ref, defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import RelationshipMenu from './RelationshipMenu.vue'

/**
 * 3a6f4517 修复：弹窗位置为空的异常。
 * 根因：`:position="state.position"` 在 state.position 为 null 时把 null 透传给 BasePopover，
 * 导致浮层定位缺失。修复改为 `state.position || { x: 0, y: 0 }`。
 * 本测试锁定该回退契约——重活依赖全部桩掉，仅验证 position 透传行为，确定且无副作用。
 */
vi.mock('../composables/useModalKeyboard', () => ({
  useModalKeyboardRef: vi.fn(),
}))

vi.mock('../composables/useRelationshipMenu', () => ({
  attachKeyboardListener: vi.fn(),
  detachKeyboardListener: vi.fn(),
}))

const BasePopoverStub = defineComponent({
  name: 'BasePopover',
  props: ['visible', 'position'],
  template: '<div class="base-popover-stub"><slot /></div>',
})

function makeMenu(position: { x: number; y: number } | null) {
  return {
    state: ref({
      visible: true,
      position,
      selectedGroupIndex: 0,
      selectedDirection: 'forward' as const,
    }),
    items: ref<any[]>([]),
    select: vi.fn(),
    close: vi.fn(),
    setSelectedGroupIndex: vi.fn(),
    setDirection: vi.fn(),
  }
}

describe('RelationshipMenu 浮层位置回退 (3a6f4517 修复)', () => {
  it('state.position 为空时回退 {x:0,y:0}，避免弹窗位置为空', () => {
    const menu = makeMenu(null)
    const wrapper = mount(RelationshipMenu, {
      props: { menu: menu as any },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    const pop = wrapper.findComponent(BasePopoverStub)
    expect(pop.props('position')).toEqual({ x: 0, y: 0 })
  })

  it('state.position 有值时原样透传', () => {
    const menu = makeMenu({ x: 120, y: 80 })
    const wrapper = mount(RelationshipMenu, {
      props: { menu: menu as any },
      global: { stubs: { BasePopover: BasePopoverStub } },
    })
    expect(wrapper.findComponent(BasePopoverStub).props('position')).toEqual({ x: 120, y: 80 })
  })
})
