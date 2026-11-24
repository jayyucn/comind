import { describe, test, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import Backlinks from './Backlinks.vue'
import type { FieldValue } from '../types/field-value'

// 可配置 mock：各用例按需重设（块加载 / 反链 / 页面反查）
const mocks = vi.hoisted(() => ({
  getBacklinks: vi.fn().mockResolvedValue([]),
  loadBlock: vi.fn().mockResolvedValue(undefined),
  loadMultiPageBlocks: vi.fn().mockResolvedValue([]),
  getBlock: vi.fn(() => undefined),
  getBlocksByPage: vi.fn(() => []),
  getPage: vi.fn(() => ({ id: 'source-page-1', title: '页面A' })),
  /** 默认无 handler → 走 `.backlink-text-fallback`；tag 点击用例注入带渲染的 handler */
  getHandler: vi.fn((): unknown => undefined),
  navigateToPage: vi.fn().mockResolvedValue(undefined),
  navigateToTag: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../stores/pages', () => ({
  usePageStore: vi.fn(() => ({
    currentPageId: 'test-page-id',
    getPage: mocks.getPage
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
    navigateToPage: mocks.navigateToPage
  }))
}))

// inline `#tag` → 标签聚合页（ADR-0050 D7），与正文渲染态同口径
vi.mock('../composables/useNavigateToTag', () => ({
  useNavigateToTag: vi.fn(() => ({
    navigateToTag: mocks.navigateToTag,
    navigateToTagLibrary: vi.fn()
  }))
}))

vi.mock('../stores/blocks', () => ({
  useBlockStore: vi.fn(() => ({
    loadMultiPageBlocks: mocks.loadMultiPageBlocks,
    loadBlock: mocks.loadBlock,
    getBacklinks: mocks.getBacklinks,
    getBlock: mocks.getBlock,
    getBlocksByPage: mocks.getBlocksByPage
  }))
}))

vi.mock('../composables/useBlockRegistry', () => ({
  useBlockRegistry: vi.fn(() => ({
    getHandler: mocks.getHandler
  }))
}))

vi.mock('../utils/block-helpers', () => ({
  buildDocumentOrder: vi.fn(() => new Map())
}))

// 字段值加载路径会触达 client（allSettled 吞掉失败，但 mock 掉避免真实 wasm 初始化）
vi.mock('../wasm/client', () => ({
  initCoreClient: vi.fn(),
  getCoreClient: vi.fn()
}))

/** 库内 FieldValue 行桩（同 BlockFieldZone.test.ts 口径） */
function fv(over: Partial<FieldValue> & { id: string; key: string }): FieldValue {
  return {
    block_id: 'b-x',
    field_definition_id: over.key,
    value_json: '',
    value_type: 'string',
    seq: 0,
    created_at: 1,
    updated_at: 1,
    version: 0,
    deleted_at: null,
    ...over,
  }
}

describe('Backlinks.vue', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.getBacklinks.mockResolvedValue([])
    mocks.loadBlock.mockResolvedValue(undefined)
    mocks.loadMultiPageBlocks.mockResolvedValue([])
    mocks.getBlock.mockReturnValue(undefined)
    mocks.getBlocksByPage.mockReturnValue([])
    mocks.getPage.mockImplementation(((id: string) =>
      id === 'source-page-1' ? { id: 'source-page-1', title: '页面A' } : undefined) as never)
    // clearAllMocks 只清调用记录，不清返回实现 —— 带渲染 handler 的用例须显式复位
    mocks.getHandler.mockReturnValue(undefined)
    document.body.innerHTML = ''
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

  describe('字段引用并入反链（issue T3 AC4）', () => {
    test('字段值 value_type=page 且值=本页 id 的块并入反链列表', async () => {
      mocks.loadBlock.mockResolvedValue({
        id: 'b-field',
        pageId: 'source-page-1',
        content: '字段引用来源块',
        type: 'text',
      })
      const { useFieldValueStore } = await import('../stores/fieldValue')
      useFieldValueStore().fieldValuesByBlock.set('b-field', [
        fv({ id: 'v1', key: 'related', value_json: 'test-page-id', value_type: 'page' }),
      ])

      const wrapper = mount(Backlinks, { props: { pageId: 'test-page-id' } })
      await flushPromises()

      expect(wrapper.find('.backlinks-panel').exists()).toBe(true)
      // 组标题按源页标题渲染
      expect(wrapper.text()).toContain('页面A')
      // 块内容 fallback 可见
      expect(wrapper.text()).toContain('字段引用来源块')
      wrapper.unmount()
    })

    test('字段值指向其他页 / 软删行不产生字段引用反链', async () => {
      const { useFieldValueStore } = await import('../stores/fieldValue')
      useFieldValueStore().fieldValuesByBlock.set('b-field', [
        fv({ id: 'v1', key: 'related', value_json: 'other-page', value_type: 'page' }),
        fv({ id: 'v2', key: 'old', value_json: 'test-page-id', value_type: 'page', deleted_at: 9 }),
      ])

      const wrapper = mount(Backlinks, { props: { pageId: 'test-page-id' } })
      await flushPromises()

      expect(wrapper.find('.backlinks-panel').exists()).toBe(false)
      wrapper.unmount()
    })
  })

  describe('视觉结构（反链区优化）', () => {
    /** 单条反链的公共桩：源块来自「页面A」，内容为纯文本。 */
    function stubSingleBacklink() {
      mocks.getBacklinks.mockResolvedValue([
        { id: 'l1', sourceBlockId: 'b-src', targetPageId: 'test-page-id', relationshipType: null, createdAt: 1 },
      ])
      mocks.loadBlock.mockResolvedValue({ id: 'b-src', pageId: 'source-page-1', content: '来源块', type: 'text' })
    }

    test('组标题渲染页面身份（图标 + 页名），不残留 [[ ]] wiki 语法', async () => {
      stubSingleBacklink()

      const wrapper = mount(Backlinks, { props: { pageId: 'test-page-id' } })
      await flushPromises()

      expect(wrapper.find('.backlink-group-title').text()).toBe('页面A')
      expect(wrapper.find('.backlink-group-icon').exists()).toBe(true)
      expect(wrapper.text()).not.toContain('[[')

      wrapper.unmount()
    })

    test('字段名取持久化定义标题，不漏出内部 field key（回归：f-xxx 上屏）', async () => {
      const { useTagsStore } = await import('../stores/tags')
      const { useFieldValueStore } = await import('../stores/fieldValue')
      const KEY = 'f-muov2kdy-96qy8r'
      useTagsStore().fieldDefinitions.push({
        id: KEY,
        key: KEY,
        title: '地点',
        type: 'string',
        closed_values: null,
        default_value: null,
        hide_when: 'never',
        is_system: false,
        created_at: 0,
        updated_at: 0,
        version: 1,
        deleted_at: null,
      })
      stubSingleBacklink()
      useFieldValueStore().fieldValuesByBlock.set('b-src', [
        fv({ id: 'v1', block_id: 'b-src', key: KEY, value_json: '生活' }),
      ])

      const wrapper = mount(Backlinks, { props: { pageId: 'test-page-id' } })
      await flushPromises()

      // 编译期定义里没有 f-* ⇒ 修复前 titleOf 回退成 key 本身
      expect(wrapper.find('.property-key').text()).toBe('地点:')
      expect(wrapper.text()).not.toContain(KEY)

      wrapper.unmount()
    })

    test('折叠指示与 block 折叠按钮同图标（lucide），折叠态由 CSS 旋转表达', async () => {
      stubSingleBacklink()

      const wrapper = mount(Backlinks, { props: { pageId: 'test-page-id' } })
      await flushPromises()

      const toggle = wrapper.find('.backlinks-toggle')
      expect(toggle.exists()).toBe(true)
      // 文本三角（▶/▼）已换成 lucide 图标：不再有文本内容
      expect(toggle.text()).toBe('')
      expect(toggle.find('svg').exists()).toBe(true)

      // 方向由 .is-collapsed 上的 CSS rotate 表达，不靠换图标
      expect(wrapper.find('.backlinks-panel').classes()).not.toContain('is-collapsed')
      await wrapper.find('.backlinks-header').trigger('click')
      expect(wrapper.find('.backlinks-panel').classes()).toContain('is-collapsed')

      wrapper.unmount()
    })
  })

  describe('inline #tag 跳转（与 wikilink 同口径）', () => {
    /** 渲染 handler 桩：把 content 当 HTML 输出，任意点击冒泡出 content-click。 */
    const StubRender = defineComponent({
      props: { content: { type: String, default: '' } },
      emits: ['content-click'],
      setup(props, { emit }) {
        return () => h('span', {
          class: 'stub-render',
          innerHTML: props.content,
          onClick: (e: MouseEvent) => emit('content-click', e),
        })
      },
    })

    /** 单条反链，块内容按渲染态 HTML 直接给出（省掉真实渲染器的间接层）。 */
    function stubBacklinkWithHtml(html: string) {
      mocks.getBacklinks.mockResolvedValue([
        { id: 'l1', sourceBlockId: 'b-src', targetPageId: 'test-page-id', relationshipType: null, createdAt: 1 },
      ])
      mocks.loadBlock.mockResolvedValue({ id: 'b-src', pageId: 'source-page-1', content: html, type: 'text' })
      mocks.getHandler.mockReturnValue({ renderComponent: StubRender, editorComponent: StubRender })
    }

    test('点 inline #tag → 标签聚合页，不当作 wiki-link 页面跳转', async () => {
      stubBacklinkWithHtml('<span class="block-tag" data-tag-id="t1" data-tag-title="读书">#读书</span>')

      const wrapper = mount(Backlinks, { props: { pageId: 'test-page-id' } })
      await flushPromises()

      const chip = wrapper.find('.block-tag')
      expect(chip.exists()).toBe(true)
      await chip.trigger('click')

      expect(mocks.navigateToTag).toHaveBeenCalledWith('t1')
      expect(mocks.navigateToPage).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    test('点兜底渲染的 tag（无 data-tag-id，带 data-page=标签名）→ 不跳任何页面', async () => {
      stubBacklinkWithHtml('<span class="block-link block-tag" data-page="读书">#读书</span>')

      const wrapper = mount(Backlinks, { props: { pageId: 'test-page-id' } })
      await flushPromises()

      await wrapper.find('.block-tag').trigger('click')

      expect(mocks.navigateToTag).not.toHaveBeenCalled()
      // 兜底 tag 的 data-page 是标签名而非页面 —— 跳过去只会得到一个空页
      expect(mocks.navigateToPage).not.toHaveBeenCalled()
      wrapper.unmount()
    })

    test('点 wiki link 仍走页面导航（tag 分支不误拦）', async () => {
      stubBacklinkWithHtml('<span class="block-link" data-page="目标页"><span class="wiki-bracket">[[</span>目标页<span class="wiki-bracket">]]</span></span>')

      const wrapper = mount(Backlinks, { props: { pageId: 'test-page-id' } })
      await flushPromises()

      await wrapper.find('.block-link').trigger('click')

      expect(mocks.navigateToPage).toHaveBeenCalledWith('目标页')
      expect(mocks.navigateToTag).not.toHaveBeenCalled()
      wrapper.unmount()
    })
  })
})
