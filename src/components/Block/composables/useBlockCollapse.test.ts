import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { useBlockCollapse } from './useBlockCollapse'
import { useBlockStore } from '../../../stores/blocks'
import type { TreeNode } from '../../../types/block'

describe('useBlockCollapse', () => {
  beforeEach(() => setActivePinia(createPinia()))

  function makeNode(collapsed = false): { node: TreeNode; block: any } {
    const block = {
      id: 'b1', pageId: 'p1', parentId: null, pos: 0,
      content: '', format: { collapsed }, type: 'bullet', createdAt: 0, updatedAt: 0
    }
    const childBlock = { id: 'b2', pageId: 'p1', parentId: 'b1', pos: 0, content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0 }
    const node: TreeNode = { id: 'b1', block, children: [{ id: 'b2', block: childBlock, children: [] }] }
    return { node, block }
  }

  it('collapsed initializes from block.format.collapsed', () => {
    const { node } = makeNode(true)
    const blockStore = useBlockStore()
    blockStore.blocks = [node.block]
    const nodeRef = ref(node)
    const { collapsed } = useBlockCollapse(nodeRef)
    expect(collapsed.value).toBe(true)
  })

  it('toggleCollapse flips collapsed and calls updateBlockFormat', async () => {
    const { node, block } = makeNode(false)
    const blockStore = useBlockStore()
    blockStore.blocks = [block]
    const spy = vi.spyOn(blockStore, 'updateBlockFormat').mockResolvedValue(undefined)
    const nodeRef = ref(node)
    const { collapsed, toggleCollapse } = useBlockCollapse(nodeRef)
    await toggleCollapse()
    expect(collapsed.value).toBe(true)
    expect(spy).toHaveBeenCalledWith('b1', { collapsed: true })
  })

  it('toggleCollapse is no-op when no children', async () => {
    const block = { id: 'b1', pageId: 'p1', parentId: null, pos: 0, content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0 }
    const node: TreeNode = { id: 'b1', block, children: [] }
    const blockStore = useBlockStore()
    blockStore.blocks = [block]
    const spy = vi.spyOn(blockStore, 'updateBlockFormat').mockResolvedValue(undefined)
    const nodeRef = ref(node)
    const { toggleCollapse } = useBlockCollapse(nodeRef)
    await toggleCollapse()
    expect(spy).not.toHaveBeenCalled()
  })
})
