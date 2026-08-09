import { describe, test, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import BulletRender from './BulletRender.vue'
import { useBlockStore } from '../../../../stores/blocks'

vi.mock('../../../../storage/indexedDB', () => ({
  storage: {
    saveBlock: vi.fn(),
    deleteBlock: vi.fn(),
    deleteBlockCascade: vi.fn(),
    getBlockTree: vi.fn().mockResolvedValue([])
  }
}))

beforeEach(() => {
  setActivePinia(createPinia())
})

/**
 * 复现 bug：编辑 block 内容后切换到渲染态，内容消失。
 *
 * 流程：
 * 1. 创建 block（content = 'Hello'）
 * 2. 模拟 loadPageBlocks 设置 renderSegments
 * 3. 挂载 BulletRender，验证初始渲染正确
 * 4. 调用 updateBlockContent 修改内容
 * 5. 重新挂载/更新 BulletRender，验证内容正确显示
 */
describe('BulletRender content-disappear bug', () => {
  test('renders initial content with segments', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({ pageId, content: 'Hello world' })

    // Simulate loadPageBlocks setting renderSegments
    const blockInStore = store.blocks.find(b => b.id === block.id)!
    blockInStore.renderSegments = [{ type: 'text', start: 0, end: 11 }]

    const wrapper = mount(BulletRender, {
      props: {
        content: blockInStore.content,
        blockId: blockInStore.id,
      },
    })

    const html = wrapper.html()
    console.log('[初始渲染] HTML:', html)
    expect(html).toContain('Hello world')
  })

  test('content disappears after updateBlockContent (THE BUG)', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // Step 1: Create block with initial content
    const block = await store.createBlock({ pageId, content: 'Hello' })

    // Step 2: Simulate loadPageBlocks setting renderSegments
    const blockInStore = store.blocks.find(b => b.id === block.id)!
    blockInStore.renderSegments = [{ type: 'text', start: 0, end: 5 }] // matches 'Hello'

    // Step 3: Mount BulletRender with initial content — should show 'Hello'
    const wrapper = mount(BulletRender, {
      props: {
        content: blockInStore.content,
        blockId: blockInStore.id,
      },
    })

    console.log('[编辑前] content:', blockInStore.content)
    console.log('[编辑前] renderSegments:', JSON.stringify(blockInStore.renderSegments))
    console.log('[编辑前] BulletRender HTML:', wrapper.html())
    expect(wrapper.html()).toContain('Hello')

    // Step 4: User edits content to 'a' (simulating typing in Editor)
    await store.updateBlockContent(block.id, 'a')

    // Step 5: Re-read block state
    const updatedBlock = store.blocks.find(b => b.id === block.id)!
    console.log('[编辑后] content:', updatedBlock.content)
    console.log('[编辑后] renderSegments:', JSON.stringify(updatedBlock.renderSegments))

    // Step 6: Update BulletRender props to simulate switching from edit to render mode
    // In index.vue, render mode uses :content="block.content" which is reactive
    await wrapper.setProps({
      content: updatedBlock.content,
    })

    await flushPromises()

    console.log('[编辑后] BulletRender HTML:', wrapper.html())

    // THE BUG: content 'a' should be visible
    expect(wrapper.html()).toContain('a')
  })

  test('full flow: create → loadPageBlocks → edit → render', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // Create empty block (like clicking "写点什么")
    const block = await store.createBlock({ pageId, content: '' })

    // Simulate loadPageBlocks — Rust sets renderSegments for empty content too
    const blockInStore = store.blocks.find(b => b.id === block.id)!
    blockInStore.renderSegments = [] // empty content → empty segments

    // Mount BulletRender for empty block
    const wrapper = mount(BulletRender, {
      props: {
        content: blockInStore.content,
        blockId: blockInStore.id,
      },
    })

    console.log('[空 block] HTML:', wrapper.html())

    // User types 'a' in editor → onBlur → handleSave → updateBlockContent
    await store.updateBlockContent(block.id, 'a')

    const updated = store.blocks.find(b => b.id === block.id)!
    console.log('[输入 a 后] content:', JSON.stringify(updated.content))
    console.log('[输入 a 后] renderSegments:', JSON.stringify(updated.renderSegments))

    // Switch to render mode: update props
    await wrapper.setProps({
      content: updated.content,
    })
    await flushPromises()

    console.log('[输入 a 后渲染] HTML:', wrapper.html())
    expect(wrapper.html()).toContain('a')
  })

  test('verify blockStore.getBlock returns same reference after update', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    const block = await store.createBlock({ pageId, content: 'Original' })

    // Simulate loadPageBlocks
    const blockInStore = store.blocks.find(b => b.id === block.id)!
    blockInStore.renderSegments = [{ type: 'text', start: 0, end: 8 }]

    const ref1 = store.getBlock(block.id)
    expect(ref1).toBeDefined()
    expect(ref1!.content).toBe('Original')
    expect(ref1!.renderSegments).toHaveLength(1)

    // Update content
    await store.updateBlockContent(block.id, 'New content')

    const ref2 = store.getBlock(block.id)
    expect(ref2).toBeDefined()
    expect(ref2!.content).toBe('New content')
    // After our fix, renderSegments should be undefined
    expect(ref2!.renderSegments).toBeUndefined()

    // Verify it's the same object reference (Vue3 ref deep reactivity)
    expect(ref1).toBe(ref2)

    console.log('Same reference:', ref1 === ref2)
    console.log('Content after update:', ref2!.content)
    console.log('renderSegments after update:', JSON.stringify(ref2!.renderSegments))
  })

  test('diagnostic: what does BulletRender show with stale segments + new content', async () => {
    const store = useBlockStore()
    const pageId = 'page-1'

    // Create block, set renderSegments for old content
    const block = await store.createBlock({ pageId, content: 'Hello' })
    const blockInStore = store.blocks.find(b => b.id === block.id)!
    blockInStore.renderSegments = [{ type: 'text', start: 0, end: 5 }]

    // DON'T call updateBlockContent — manually simulate the stale state
    // (what would happen if renderSegments wasn't cleared)
    const newContent = 'a'
    const staleSegments = blockInStore.renderSegments // [{type:'text', start:0, end:5}]

    // Mount BulletRender with new content but stale segments
    const wrapper = mount(BulletRender, {
      props: {
        content: newContent,
        blockId: blockInStore.id,
      },
    })

    // BulletRender reads segments from store, which still has stale segments
    console.log('[stale segments] store.getBlock renderSegments:',
      JSON.stringify(store.getBlock(block.id)?.renderSegments))
    console.log('[stale segments] BulletRender HTML:', wrapper.html())

    // With stale segments [{start:0, end:5}] and content 'a':
    // content.slice(0, 5) = 'a' (slice clamps) → shows 'a'
    // But if content was '' (empty):
    blockInStore.content = ''
    await wrapper.setProps({ content: '' })
    await flushPromises()
    console.log('[stale segments + empty content] HTML:', wrapper.html())
    // content.slice(0, 5) = '' → shows nothing!

    // This confirms the bug: stale segments + changed content = wrong output
  })
})
