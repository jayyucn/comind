/**
 * 末尾空块不变量 + 底部留白单击（ADR-0070 D7）回归测试。
 *
 * 三条行为：
 * 1. 页面数据就绪后，根级末位补齐一个空块；已有空块则不重复补。
 * 2. 末块由空转实后立即补一个新的空块。
 * 3. 单击根容器自身的底部留白 → 光标落进末尾空块；单击块内容不接管。
 *
 * 夹具照 BlockList.keyboard-delete.test.ts：mount(BlockList) + 真实 store，
 * 只替换 `extractLinksFromContent`（jsdom 下该方法硬编码 throw）。
 */
import { describe, test, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import BlockList from './BlockList.vue'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'
import { getCoreClient } from '../wasm/client'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
})

const stubGlobal = {
  stubs: {
    VueDraggable: { template: '<div><slot /></div>' },
    BlockDropIndicator: true,
  },
}

let extractLinksSpy: MockInstance
let wrapper: VueWrapper | null = null

async function flushAsync() {
  await flushPromises()
  await new Promise((r) => setTimeout(r, 0))
  await flushPromises()
}

/** 页内块（含末尾空块），按 pos 升序。测试环境的页面根块不存在，全部块 parentId 为 null */
function rootBlocks(pageId: string) {
  return [...useBlockStore().getBlocksByPage(pageId)].sort((a, b) => a.pos - b.pos)
}

async function mountList(pageId: string): Promise<VueWrapper> {
  wrapper = mount(BlockList, {
    props: { pageId },
    attachTo: document.body,
    global: stubGlobal,
  })
  await nextTick()
  await flushAsync()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  extractLinksSpy = vi
    .spyOn(getCoreClient()!, 'extractLinksFromContent')
    .mockResolvedValue([])
})

afterEach(() => {
  extractLinksSpy.mockRestore()
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('末尾空块不变量', () => {
  test('进页补齐：末块非空 → 末尾多出一个空块', async () => {
    const store = useBlockStore()
    const pageId = 'page-trailing-fill'
    await store.createBlock({ pageId, content: 'aaa' })

    await mountList(pageId)

    const blocks = rootBlocks(pageId)
    expect(blocks).toHaveLength(2)
    expect(blocks[1].content.trim()).toBe('')
  })

  test('已有空块则不重复补（恰一个）', async () => {
    const store = useBlockStore()
    const pageId = 'page-trailing-idempotent'
    await store.createBlock({ pageId, content: 'aaa' })
    await store.createBlock({ pageId, content: '' })

    await mountList(pageId)

    expect(rootBlocks(pageId)).toHaveLength(2)
  })

  test('末块由空转实 → 立即补一个新的空块', async () => {
    const store = useBlockStore()
    const pageId = 'page-trailing-after-write'
    const a = await store.createBlock({ pageId, content: 'aaa' })
    await store.createBlock({ pageId, content: '' })

    await mountList(pageId)
    expect(rootBlocks(pageId)).toHaveLength(2)

    const last = rootBlocks(pageId)[1]
    await store.updateBlockContent(last.id, 'bbb')
    await flushAsync()

    const blocks = rootBlocks(pageId)
    expect(blocks).toHaveLength(3)
    expect(blocks[0].id).toBe(a.id)
    expect(blocks[2].content.trim()).toBe('')
  })
})

describe('底部留白单击', () => {
  test('单击根容器留白 → 光标落进末尾空块', async () => {
    const store = useBlockStore()
    const editor = useEditorStore()
    const pageId = 'page-trailing-click'
    await store.createBlock({ pageId, content: 'aaa' })
    await store.createBlock({ pageId, content: '' })

    const w = await mountList(pageId)
    const root = w.element as HTMLElement
    const blank = rootBlocks(pageId)[1]

    // 直接落在根容器上（留白区在真实布局中是根的 padding-bottom，target 即根）
    root.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushAsync()

    expect(editor.activeBlockId).toBe(blank.id)
  })

  test('单击块内容不接管（由块自己的点击语义处理）', async () => {
    const store = useBlockStore()
    const editor = useEditorStore()
    const pageId = 'page-trailing-click-inner'
    const a = await store.createBlock({ pageId, content: 'aaa' })
    await store.createBlock({ pageId, content: '' })

    const w = await mountList(pageId)
    const contentEl = (w.element as HTMLElement).querySelector<HTMLElement>(
      `[data-block-id="${a.id}"] .block-content`,
    )!
    contentEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushAsync()

    // 不因冒泡到根而落到末尾空块
    expect(editor.activeBlockId).not.toBe(rootBlocks(pageId)[1].id)
  })
})
