import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import SlashCommandMenu from './SlashCommandMenu.vue'
import { useEditorStore } from '../stores/editor'
import { usePropertyStore } from '../stores/property'
import { useSlashCommands } from '../composables/useSlashCommands'

// Mock stores
vi.mock('../stores/editor', () => ({
  useEditorStore: vi.fn()
}))

vi.mock('../stores/property', () => ({
  usePropertyStore: vi.fn()
}))

vi.mock('../composables/useSlashCommands', () => ({
  useSlashCommands: vi.fn()
}))

// Mock TaskIcon component
vi.mock('./Icons', () => ({
  TaskIcon: { template: '<span class="task-icon"></span>' }
}))

function createMockCommands(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `cmd-${i}`,
    name: `Command ${i}`,
    alias: [],
    group: 'Test Group',
    icon: '📌',
    action: () => {}
  }))
}

describe('SlashCommandMenu', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    
    const mockEditorStore = {
      activeEditor: null,
      showSlashCommand: vi.fn(),
      hideSlashCommand: vi.fn(),
      showQuickPropertyEditor: vi.fn()
    }
    vi.mocked(useEditorStore).mockReturnValue(mockEditorStore as any)
    
    const mockPropertyStore = {
      setProperty: vi.fn()
    }
    vi.mocked(usePropertyStore).mockReturnValue(mockPropertyStore as any)
  })

  it('renders correctly when visible', async () => {
    const mockCommands = createMockCommands(5)
    vi.mocked(useSlashCommands).mockReturnValue({
      commands: mockCommands
    } as any)

    const wrapper = mount(SlashCommandMenu, {
      global: {
        stubs: {
          Teleport: { template: '<div><slot /></div>' }
        }
      }
    })

    // 触发显示菜单
    document.dispatchEvent(new CustomEvent('slash-command-trigger', {
      detail: {
        view: { coordsAtPos: () => ({ left: 100, bottom: 200 }) },
        position: 0,
        range: { from: 0, to: 1 }
      }
    }))

    await flushPromises()

    expect(wrapper.find('.slash-command-menu').exists()).toBe(true)
  })

  it('auto-scrolls when selected item is out of viewport', async () => {
    // 创建足够多的命令，确保列表会超出可视范围
    const mockCommands = createMockCommands(20)
    vi.mocked(useSlashCommands).mockReturnValue({
      commands: mockCommands
    } as any)

    const wrapper = mount(SlashCommandMenu, {
      global: {
        stubs: {
          Teleport: { template: '<div><slot /></div>' }
        }
      }
    })

    // 触发显示菜单
    document.dispatchEvent(new CustomEvent('slash-command-trigger', {
      detail: {
        view: { coordsAtPos: () => ({ left: 100, bottom: 200 }) },
        position: 0,
        range: { from: 0, to: 1 }
      }
    }))

    await flushPromises()

    const listElement = wrapper.find('.slash-command-list').element as HTMLElement
    const scrollIntoViewSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')

    // 模拟向下按多次，直到选中项超出可视范围
    for (let i = 0; i < 15; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
      await flushPromises()
    }

    // 验证 scrollIntoView 被调用
    expect(scrollIntoViewSpy).toHaveBeenCalled()
    
    scrollIntoViewSpy.mockRestore()
  })
})
