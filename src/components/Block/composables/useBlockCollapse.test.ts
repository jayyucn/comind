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
    // 折叠标志直连 store（不留本地副本），所以 mock 必须真的写回——且**必须经响应式代理**写：
    // 直接改原始对象不会触发 computed 失效，会得到「值已变但读回来还是旧值」的假失败。
    const spy = vi.spyOn(blockStore, 'updateBlockFormat').mockImplementation(
      async (id: string, format: Record<string, unknown>) => {
        const target = blockStore.blocks.find(b => b.id === id)
        if (target) target.format = { ...target.format, ...format }
      }
    )
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

  // ADR-0045 D2：折叠的读取侧唯一判定 = format.collapsed && 有子节点。
  it('0 子节点 + collapsed=true（删除掏空后的 stale 残留）⇒ 生效态为展开', () => {
    const block = {
      id: 'b1', pageId: 'p1', parentId: null, pos: 0,
      content: '', format: { collapsed: true }, type: 'bullet', createdAt: 0, updatedAt: 0
    }
    const node: TreeNode = { id: 'b1', block, children: [] }
    const nodeRef = ref(node)
    const { collapsed } = useBlockCollapse(nodeRef)
    expect(collapsed.value).toBe(false)
  })

  it('有子节点时 collapsed 标志照常生效（兜底不吞掉正常折叠）', () => {
    const { node } = makeNode(true)
    const nodeRef = ref(node)
    const { collapsed } = useBlockCollapse(nodeRef)
    expect(collapsed.value).toBe(true)
  })

  it('stale 残留块获得子节点后，从展开态变为折叠态（说明复位必须落在写入侧）', () => {
    const block = {
      id: 'b1', pageId: 'p1', parentId: null, pos: 0,
      content: '', format: { collapsed: true }, type: 'bullet', createdAt: 0, updatedAt: 0
    }
    const childBlock = {
      id: 'b2', pageId: 'p1', parentId: 'b1', pos: 0,
      content: '', format: {}, type: 'bullet', createdAt: 0, updatedAt: 0
    }
    const node = ref<TreeNode>({ id: 'b1', block, children: [] })
    const { collapsed } = useBlockCollapse(node)
    expect(collapsed.value).toBe(false)
    node.value = { id: 'b1', block, children: [{ id: 'b2', block: childBlock, children: [] }] }
    expect(collapsed.value).toBe(true)
  })
})
