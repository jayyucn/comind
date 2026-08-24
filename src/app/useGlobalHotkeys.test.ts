import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'

const { push, toggle, onToggleSearch } = vi.hoisted(() => ({
  push: vi.fn(),
  toggle: vi.fn(),
  onToggleSearch: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('../composables/useSidebar', () => ({ useSidebar: () => ({ toggle }) }))

import { useGlobalHotkeys } from './useGlobalHotkeys'

function setup() {
  mount({
    setup() {
      useGlobalHotkeys({ onToggleSearch })
      return {}
    },
  })
}

function fire(key: string, ctrlKey = true) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true }))
}

beforeEach(() => {
  push.mockClear()
  toggle.mockClear()
  onToggleSearch.mockClear()
})

describe('useGlobalHotkeys', () => {
  it('ctrl+k 触发 onToggleSearch（不导航）', () => {
    setup()
    fire('k')
    expect(onToggleSearch).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('ctrl+g 路由到 /graph', () => {
    setup()
    fire('g')
    expect(push).toHaveBeenCalledWith('/graph')
  })

  it('ctrl+i 路由到 /ideas', () => {
    setup()
    fire('i')
    expect(push).toHaveBeenCalledWith('/ideas')
  })

  it('ctrl+t 路由到 /tasks', () => {
    setup()
    fire('t')
    expect(push).toHaveBeenCalledWith('/tasks')
  })

  it('ctrl+b 切换侧栏', () => {
    setup()
    fire('b')
    expect(toggle).toHaveBeenCalled()
  })

  it('无 ctrl 修饰不触发', () => {
    setup()
    fire('g', false)
    expect(push).not.toHaveBeenCalled()
  })
})
