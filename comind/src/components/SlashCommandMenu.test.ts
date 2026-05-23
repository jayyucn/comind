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

vi.mock('../composables/useSlashCommands', async () => {
  const actual = await vi.importActual('../composables/useSlashCommands')
  return {
    ...actual,
    useSlashCommands: vi.fn()
  }
})

// Mock Icons module
vi.mock('./Icons', () => ({
  TaskIcon: { template: '<span class="task-icon"></span>' },
  TASK_STATUS_ICONS: {
    Todo: 'status-todo',
    Doing: 'status-doing',
    Done: 'status-done',
    Canceled: 'status-canceled',
  },
  TASK_PRIORITY_ICONS: {
    Low: 'priority-low',
    Medium: 'priority-medium',
    High: 'priority-high',
    Urgent: 'priority-urgent',
  }
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
    
    // Mock scrollIntoView
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
    
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
      commands: mockCommands,
      filterCommands: vi.fn((query: string) => mockCommands),
      groupCommands: vi.fn(() => new Map([['Test Group', mockCommands]])),
      parseCommandInput: vi.fn(() => ({ command: null, argument: null }))
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
      commands: mockCommands,
      filterCommands: vi.fn((query: string) => mockCommands),
      groupCommands: vi.fn(() => new Map([['Test Group', mockCommands]])),
      parseCommandInput: vi.fn(() => ({ command: null, argument: null }))
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
