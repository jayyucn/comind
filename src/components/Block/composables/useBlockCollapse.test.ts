import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, nextTick } from 'vue'
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

  // ── 折叠范围扩展（ADR-0045）：折叠范围 = 子树 + 字段带，守卫两路来源 ──
  describe('字段行通道（canCollapse = 有子块 或 有字段行）', () => {
    /** 0 子块的块（折叠来源只能来自字段行）。 */
    function fieldOnlyNode(collapsed = false): { node: TreeNode; block: any } {
      const block = {
        id: 'b1', pageId: 'p1', parentId: null, pos: 0,
        content: '', format: { collapsed }, type: 'bullet', createdAt: 0, updatedAt: 0
      }
      return { node: { id: 'b1', block, children: [] }, block }
    }

    it('仅字段块（0 子块 + 有字段行）可折叠，toggle 写库', async () => {
      const { node, block } = fieldOnlyNode(false)
      const blockStore = useBlockStore()
      blockStore.blocks = [block]
      const spy = vi.spyOn(blockStore, 'updateBlockFormat').mockImplementation(
        async (id: string, format: Record<string, unknown>) => {
          const target = blockStore.blocks.find(b => b.id === id)
          if (target) target.format = { ...target.format, ...format }
        }
      )
      const { collapsed, canCollapse, toggleCollapse } = useBlockCollapse(ref(node), ref(2))
      expect(canCollapse.value).toBe(true)
      await toggleCollapse()
      expect(collapsed.value).toBe(true)
      expect(spy).toHaveBeenCalledWith('b1', { collapsed: true })
    })

    it('toggleCollapse 在「无子块且无字段行」时是 no-op', async () => {
      const { node, block } = fieldOnlyNode(false)
      const blockStore = useBlockStore()
      blockStore.blocks = [block]
      const spy = vi.spyOn(blockStore, 'updateBlockFormat').mockResolvedValue(undefined)
      const { canCollapse, toggleCollapse } = useBlockCollapse(ref(node), ref(0))
      expect(canCollapse.value).toBe(false)
      await toggleCollapse()
      expect(spy).not.toHaveBeenCalled()
    })

    // stale 双条件兜底：字段删光后残留 collapsed=true，同样不能让 UI 撒谎
    it('既无子块又无字段行 + collapsed=true ⇒ 呈现展开态', () => {
      const { node } = fieldOnlyNode(true)
      const { collapsed, canCollapse } = useBlockCollapse(ref(node), ref(0))
      expect(canCollapse.value).toBe(false)
      expect(collapsed.value).toBe(false)
    })

    it('字段行数变化即时驱动守卫（字段删光 ⇒ 生效态回落展开）', () => {
      const { node } = fieldOnlyNode(true)
      const fieldRows = ref(3)
      const { collapsed, canCollapse } = useBlockCollapse(ref(node), fieldRows)
      expect(canCollapse.value).toBe(true)
      expect(collapsed.value).toBe(true)

      fieldRows.value = 0
      expect(canCollapse.value).toBe(false)
      expect(collapsed.value).toBe(false)
    })

    it('未传 fieldRowCount 时行为与旧版一致（仅子块通道）', async () => {
      const { node, block } = fieldOnlyNode(false)
      const blockStore = useBlockStore()
      blockStore.blocks = [block]
      const spy = vi.spyOn(blockStore, 'updateBlockFormat').mockResolvedValue(undefined)
      const { canCollapse, toggleCollapse } = useBlockCollapse(ref(node))
      expect(canCollapse.value).toBe(false)
      await toggleCollapse()
      expect(spy).not.toHaveBeenCalled()
    })
  })

  // ── 折叠/展开精确高度动画（修复收起末段卡顿，ADR-0045 折叠过渡） ──
  // 把真实高度注入子容器 max-height，使过渡比例与实际内容一致，而不是用 CSS
  // 写死的 2000px 起点（真实高度远小于 2000 时可见坍缩全挤在末段、ease-in-out
  // 末尾减速 → 收起末段卡顿）。
  describe('折叠/展开精确高度动画', () => {
    function makeFakeEl(scrollHeight = 250) {
      return { style: { maxHeight: '', transition: '' }, scrollHeight, offsetHeight: 0 } as any
    }
    /** mock store 写回（与上方 toggle 测试同源），让 collapsedFlag 同步失效。 */
    function mockStoreWrite() {
      const blockStore = useBlockStore()
      vi.spyOn(blockStore, 'updateBlockFormat').mockImplementation(
        async (id: string, format: Record<string, unknown>) => {
          const target = blockStore.blocks.find(b => b.id === id)
          if (target) target.format = { ...target.format, ...format }
        }
      )
      return blockStore
    }

    it('折叠：把容器 max-height 锚定到真实高度再过渡到 0', async () => {
      const { node, block } = makeNode(false)
      const blockStore = mockStoreWrite()
      blockStore.blocks = [block]
      const fakeEl = makeFakeEl(250)
      const { toggleCollapse, collapsed } = useBlockCollapse(ref(node), undefined, ref(fakeEl))
      expect(collapsed.value).toBe(false)
      await toggleCollapse()
      // 起点 = 真实高度（childrenHeight 未测时为 0，兜底取 scrollHeight），而非 CSS 2000px
      expect(fakeEl.style.maxHeight).toBe('250px')
      // 动画跑完后内联 max-height 清回，交回 CSS 基线（避免残留裁剪）
      await new Promise(r => setTimeout(r, 260))
      expect(fakeEl.style.maxHeight).toBe('')
    })

    it('展开：把容器 max-height 从 0 过渡到真实高度', async () => {
      const { node, block } = makeNode(true)
      const blockStore = mockStoreWrite()
      blockStore.blocks = [block]
      const fakeEl = makeFakeEl(250)
      const { toggleCollapse, collapsed } = useBlockCollapse(ref(node), undefined, ref(fakeEl))
      expect(collapsed.value).toBe(true)
      await toggleCollapse() // 展开
      // 起点 = 0（从折叠态高度 0 增长），而非直接从 2000px 滑下导致末段突兀
      expect(fakeEl.style.maxHeight).toBe('0px')
      await new Promise(r => setTimeout(r, 260))
    })
  })
})
