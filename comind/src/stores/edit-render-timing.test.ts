import { describe, test, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, computed, ref, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useBlockStore } from './blocks'
import { useEditorStore } from './editor'

vi.mock('./storage/indexedDB', () => ({
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
 * 模拟 index.vue 的 v-if/v-else 切换行为：
 * - isActive 时显示 Editor（接收 editContent）
 * - !isActive 时显示 BulletRender（接收 block.content）
 *
 * 关键：Editor 卸载时 onBeforeUnmount emit('save', text) → updateBlockContent
 * 此时 Vue 正在同一渲染周期中挂载 BulletRender——props 可能是旧值。
 */
const FakeBlockComponent = defineComponent({
  props: {
    blockId: String,
    isActive: Boolean,
  },
  setup(props) {
    const blockStore = useBlockStore()
    const block = computed(() => blockStore.getBlock(props.blockId!))

    // 模拟 Editor 的 onBeforeUnmount 行为
    const onEditorUnmount = async () => {
      // 模拟 editor.getText() = 'a'
      const text = 'a'
      if (text) {
        await blockStore.updateBlockContent(props.blockId!, text)
      }
    }

    return () => {
      if (props.isActive) {
        // 模拟 Editor 组件 — 用 onBeforeUnmount 钩子
        return h('div', {
          class: 'fake-editor',
          'data-text': 'a',
          onVnodeUnmounted: () => onEditorUnmount(),
        }, `Editor: ${block.value?.content ?? ''}`)
      } else {
        // 模拟 BulletRender 组件
        const content = block.value?.content ?? ''
        const segs = block.value?.renderSegments
        const displayText = segs && segs.length > 0
          ? content.slice(0, (segs[0] as any).end ?? content.length)
          : content
        return h('div', { class: 'fake-render' }, `Render: ${displayText}`)
      }
    }
  },
})

describe('edit-to-render timing', () => {
  test('content updates correctly when switching from edit to render', async () => {
    const blockStore = useBlockStore()
    const pageId = 'page-1'

    // Create block, simulate loadPageBlocks
    const block = await blockStore.createBlock({ pageId, content: '' })
    const blockInStore = blockStore.blocks.find(b => b.id === block.id)!
    blockInStore.renderSegments = [{ type: 'text', start: 0, end: 0 }]

    // Mount with isActive=true (editor mode)
    const wrapper = mount(FakeBlockComponent, {
      props: { blockId: block.id, isActive: true },
    })
    console.log('[Editor mode] HTML:', wrapper.html())

    // Switch to render mode
    await wrapper.setProps({ isActive: false })
    await flushPromises()

    console.log('[Render mode] HTML:', wrapper.html())
    console.log('[Store] content:', JSON.stringify(blockStore.getBlock(block.id)?.content))
    console.log('[Store] renderSegments:', JSON.stringify(blockStore.getBlock(block.id)?.renderSegments))

    // Content should be 'a'
    expect(blockStore.getBlock(block.id)?.content).toBe('a')
    // Render should show 'a'
    expect(wrapper.html()).toContain('a')
  })

  test('simulates the exact bug: deactivate → unmount editor → save → mount render', async () => {
    const blockStore = useBlockStore()
    const editorStore = useEditorStore()
    const pageId = 'page-1'

    // Create block, simulate loadPageBlocks
    const block = await blockStore.createBlock({ pageId, content: '' })
    const blockInStore = blockStore.blocks.find(b => b.id === block.id)!
    blockInStore.renderSegments = [{ type: 'text', start: 0, end: 0 }]

    // Track activeBlockId
    const isActive = computed(() => editorStore.activeBlockId === block.id)

    // Mount block component
    const wrapper = mount(FakeBlockComponent, {
      props: { blockId: block.id, isActive: isActive.value },
    })

    // Activate block (user clicks to edit)
    editorStore.activateBlock(block.id)
    await wrapper.setProps({ isActive: true })
    await flushPromises()
    console.log('[After activate] HTML:', wrapper.html())

    // Simulate user typing 'a' — update content via editor
    // (In real app, this goes through debouncedEmitSave → handleSave → updateBlockContent)
    // But for timing test, we DON'T save yet — the save happens on unmount

    // Deactivate (user clicks outside) — this triggers editor unmount
    editorStore.deactivateBlock()
    await wrapper.setProps({ isActive: false })
    await flushPromises()

    console.log('[After deactivate] HTML:', wrapper.html())
    console.log('[Store] content:', JSON.stringify(blockStore.getBlock(block.id)?.content))
    console.log('[Store] renderSegments:', JSON.stringify(blockStore.getBlock(block.id)?.renderSegments))

    expect(blockStore.getBlock(block.id)?.content).toBe('a')
  })
})

describe('Editor.vue onBeforeUnmount timing analysis', () => {
  test('emit save during onBeforeUnmount updates store before render component mounts', async () => {
    const blockStore = useBlockStore()
    const pageId = 'page-1'

    const block = await blockStore.createBlock({ pageId, content: '' })
    const blockInStore = blockStore.blocks.find(b => b.id === block.id)!
    blockInStore.renderSegments = [{ type: 'text', start: 0, end: 0 }]

    // Track the order of operations
    const log: string[] = []

    // Simulate the exact flow in index.vue:
    // v-if="isActive" → Editor (onBeforeUnmount emits save)
    // v-else → BulletRender (reads block.content)
    const ParentComp = defineComponent({
      props: { isActive: Boolean },
      setup(props) {
        const blockRef = computed(() => blockStore.getBlock(block.id)!)

        return () => {
          if (props.isActive) {
            return h('div', {
              class: 'editor',
              onVnodeUnmounted: async () => {
                log.push('onBeforeUnmount: start')
                // Simulate emit('save', 'a') → handleSave → updateBlockContent
                await blockStore.updateBlockContent(block.id, 'a')
                log.push('onBeforeUnmount: after updateBlockContent')
              },
            }, 'Editor')
          } else {
            const content = blockRef.value?.content ?? ''
            const segs = blockRef.value?.renderSegments
            log.push(`BulletRender mount: content="${content}", segs=${JSON.stringify(segs)}`)
            return h('div', { class: 'render' }, `Render: ${content}`)
          }
        }
      },
    })

    const wrapper = mount(ParentComp, { props: { isActive: true } })
    log.push(`Initial: content="${blockStore.getBlock(block.id)?.content}"`)

    // Switch to render mode
    await wrapper.setProps({ isActive: false })
    await flushPromises()

    log.push(`Final: content="${blockStore.getBlock(block.id)?.content}"`)
    log.push(`Final HTML: ${wrapper.html()}`)

    console.log(log.join('\n'))

    // The store should have 'a'
    expect(blockStore.getBlock(block.id)?.content).toBe('a')
    // The render should eventually show 'a'
    expect(wrapper.html()).toContain('a')
  })

  test('additional nextTick after switch ensures content is visible', async () => {
    const blockStore = useBlockStore()
    const pageId = 'page-1'

    const block = await blockStore.createBlock({ pageId, content: '' })
    const blockInStore = blockStore.blocks.find(b => b.id === block.id)!
    blockInStore.renderSegments = [{ type: 'text', start: 0, end: 0 }]

    const log: string[] = []

    const ParentComp = defineComponent({
      props: { isActive: Boolean },
      setup(props) {
        const blockRef = computed(() => blockStore.getBlock(block.id)!)

        return () => {
          if (props.isActive) {
            return h('div', {
              class: 'editor',
              onVnodeUnmounted: async () => {
                log.push('unmount: before save')
                await blockStore.updateBlockContent(block.id, 'a')
                log.push('unmount: after save')
              },
            }, 'Editor')
          } else {
            const content = blockRef.value?.content ?? ''
            log.push(`render: content="${content}"`)
            return h('div', { class: 'render' }, content || '(empty)')
          }
        }
      },
    })

    const wrapper = mount(ParentComp, { props: { isActive: true } })

    await wrapper.setProps({ isActive: false })
    // First flush handles unmount + mount
    await flushPromises()
    log.push(`After 1st flush: ${wrapper.html()}`)

    // Second flush ensures reactive updates propagate
    await nextTick()
    await flushPromises()
    log.push(`After 2nd flush: ${wrapper.html()}`)

    console.log(log.join('\n'))

    expect(wrapper.html()).toContain('a')
  })
})
