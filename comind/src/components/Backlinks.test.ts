import { describe, test, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import Backlinks from './Backlinks.vue'

vi.mock('../stores/pages', () => ({
  usePageStore: vi.fn(() => ({
    currentPageId: 'test-page-id',
    getPage: vi.fn(() => ({ id: 'source-page-1', title: '页面A' }))
  }))
}))

vi.mock('../stores/editor', () => ({
  useEditorStore: vi.fn(() => ({
    activeBlockId: null,
    deactivateBlock: vi.fn(),
    activateBlock: vi.fn()
  }))
}))

vi.mock('../composables/useNavigateToPage', () => ({
  useNavigateToPage: vi.fn(() => ({
    navigateToPage: vi.fn()
  }))
}))

vi.mock('../stores/blocks', () => ({
  useBlockStore: vi.fn(() => ({
    loadMultiPageBlocks: vi.fn().mockResolvedValue([]),
    loadBlock: vi.fn().mockResolvedValue(undefined),
    getBacklinks: vi.fn().mockResolvedValue([]),
    getBlock: vi.fn(() => undefined),
    getBlocksByPage: vi.fn(() => [])
  }))
}))

vi.mock('../stores/property', () => ({
  usePropertyStore: vi.fn(() => ({
    loadBlockProperties: vi.fn().mockResolvedValue([]),
    getBlockProperties: vi.fn(() => []),
    getBlockProperty: vi.fn(() => undefined)
  }))
}))

vi.mock('../composables/useBlockRegistry', () => ({
  useBlockRegistry: vi.fn(() => ({
    getHandler: vi.fn(() => undefined)
  }))
}))

vi.mock('./Block/PropertyInline.vue', () => ({
  default: { template: '<span class="property-inline-stub" />' }
}))

vi.mock('./Block/PropertyDisplay.vue', () => ({
  default: { template: '<div class="property-display-stub" />' }
}))

vi.mock('../utils/block-helpers', () => ({
  buildDocumentOrder: vi.fn(() => new Map())
}))

describe('Backlinks.vue', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('基本功能', () => {
    test('无反链时面板不渲染', () => {
      const wrapper = mount(Backlinks)
      expect(wrapper.find('.backlinks-panel').exists()).toBe(false)
    })

    test('组件能正确挂载', () => {
      const wrapper = mount(Backlinks)
      expect(wrapper.exists()).toBe(true)
    })
  })
})
