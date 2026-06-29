/**
 * Core Layer - BlockService 单元测试
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { BlockService } from '../services/blockService'
import { MemoryAdapter } from '../storage/memoryAdapter'
import type { Block } from '../types'

describe('BlockService', () => {
  let service: BlockService
  let storage: MemoryAdapter

  beforeEach(() => {
    storage = new MemoryAdapter()
    service = new BlockService({ storage })
  })

  // =============================================================================
  // 辅助函数
  // =============================================================================

  async function createBlock(options: {
    pageId?: string
    parentId?: string | null
    content?: string
    type?: 'bullet' | 'concept'
  } = {}): Promise<Block> {
    return service.create({
      pageId: options.pageId ?? 'page-1',
      parentId: options.parentId ?? null,
      content: options.content ?? 'Test Block',
      type: options.type ?? 'bullet',
    })
  }

  // =============================================================================
  // CRUD 操作
  // =============================================================================

  describe('getById', () => {
    it('应返回已创建的 Block', async () => {
      const created = await createBlock({ content: 'Hello' })
      const found = await service.getById(created.id)
      expect(found).toBeDefined()
      expect(found?.id).toBe(created.id)
      expect(found?.content).toBe('Hello')
    })

    it('不存在的 ID 返回 undefined', async () => {
      const found = await service.getById('non-existent')
      expect(found).toBeUndefined()
    })
  })

  describe('getByPageId', () => {
    it('应返回页面内的所有 Block', async () => {
      await createBlock({ pageId: 'page-1', content: 'Block 1' })
      await createBlock({ pageId: 'page-1', content: 'Block 2' })
      await createBlock({ pageId: 'page-2', content: 'Other Page' })

      const blocks = await service.getByPageId('page-1')
      expect(blocks.length).toBe(2)
      expect(blocks.every(b => b.pageId === 'page-1')).toBe(true)
    })

    it('空页面返回空数组', async () => {
      const blocks = await service.getByPageId('non-existent-page')
      expect(blocks.length).toBe(0)
    })
  })

  describe('getChildren', () => {
    it('应返回指定父级的子 Block', async () => {
      const parent = await createBlock({ content: 'Parent' })
      await createBlock({ parentId: parent.id, content: 'Child 1' })
      await createBlock({ parentId: parent.id, content: 'Child 2' })

      const children = await service.getChildren(parent.id)
      expect(children.length).toBe(2)
    })

    it('null 父级返回根 Block', async () => {
      const root1 = await createBlock({ parentId: null, content: 'Root 1' })
      const root2 = await createBlock({ parentId: null, content: 'Root 2' })

      const roots = await service.getChildren(null)
      expect(roots.length).toBeGreaterThanOrEqual(2)
      expect(roots.map(b => b.id)).toContain(root1.id)
      expect(roots.map(b => b.id)).toContain(root2.id)
    })
  })

  describe('create', () => {
    it('应创建带默认值的 Block', async () => {
      const block = await service.create({ pageId: 'page-1' })

      expect(block.id).toBeDefined()
      expect(block.pageId).toBe('page-1')
      expect(block.parentId).toBeNull()
      expect(block.pos).toBe(1000)
      expect(block.content).toBe('')
      expect(block.type).toBe('bullet')
    })

    it('应使用提供的值覆盖默认值', async () => {
      const block = await service.create({
        pageId: 'page-1',
        parentId: 'parent-1',
        content: 'Custom Content',
        type: 'concept',
      })

      expect(block.parentId).toBe('parent-1')
      expect(block.content).toBe('Custom Content')
      expect(block.type).toBe('concept')
    })
  })

  describe('update', () => {
    it('应更新 Block 的内容', async () => {
      const block = await createBlock({ content: 'Original' })
      const updated = await service.update(block.id, { content: 'Updated' })

      expect(updated.content).toBe('Updated')
    })

    it('应更新多个字段', async () => {
      const block = await createBlock({ content: 'Original', type: 'bullet' })
      const updated = await service.update(block.id, {
        content: 'New Content',
        type: 'concept',
      })

      expect(updated.content).toBe('New Content')
      expect(updated.type).toBe('concept')
    })
  })

  describe('delete', () => {
    it('应删除单个 Block', async () => {
      const block = await createBlock()
      await service.delete(block.id)

      const found = await service.getById(block.id)
      expect(found).toBeUndefined()
    })

    it('应递归删除子 Block', async () => {
      const parent = await createBlock({ content: 'Parent' })
      const child = await createBlock({ parentId: parent.id, content: 'Child' })
      const grandchild = await createBlock({ parentId: child.id, content: 'Grandchild' })

      await service.delete(parent.id)

      expect(await service.getById(parent.id)).toBeUndefined()
      expect(await service.getById(child.id)).toBeUndefined()
      expect(await service.getById(grandchild.id)).toBeUndefined()
    })

    it('删除不存在的 Block 不抛出错误', async () => {
      await expect(service.delete('non-existent')).resolves.not.toThrow()
    })
  })

  // =============================================================================
  // 树形结构操作
  // =============================================================================

  describe('buildTree', () => {
    it('应构建正确的树形结构', async () => {
      // 创建层级结构：Root -> Child1 -> Grandchild
      //                Root -> Child2
      const root = await createBlock({ pageId: 'page-1', content: 'Root' })
      const child1 = await createBlock({ pageId: 'page-1', parentId: root.id, content: 'Child 1' })
      const child2 = await createBlock({ pageId: 'page-1', parentId: root.id, content: 'Child 2' })
      const grandchild = await createBlock({ pageId: 'page-1', parentId: child1.id, content: 'Grandchild' })

      const tree = await service.buildTree('page-1')

      // 应该有 1 个根节点
      expect(tree.length).toBe(1)

      const rootNode = tree[0]
      expect(rootNode.block.id).toBe(root.id)
      expect(rootNode.children.length).toBe(2)

      const [c1Node, c2Node] = rootNode.children
      expect(c1Node.block.id).toBe(child1.id)
      expect(c2Node.block.id).toBe(child2.id)
      expect(c1Node.children.length).toBe(1)
      expect(c1Node.children[0].block.id).toBe(grandchild.id)
    })

    it('空页面返回空数组', async () => {
      const tree = await service.buildTree('empty-page')
      expect(tree.length).toBe(0)
    })

    it('应按 pos 排序', async () => {
      const root1 = await createBlock({ pageId: 'page-1', content: 'Z-Last' })
      const root2 = await createBlock({ pageId: 'page-1', content: 'A-First' })

      // 手动设置 pos
      await service.update(root1.id, { pos: 2000 })
      await service.update(root2.id, { pos: 1000 })

      const tree = await service.buildTree('page-1')
      expect(tree[0].block.id).toBe(root2.id)
      expect(tree[1].block.id).toBe(root1.id)
    })

    it('孤立节点应视为根节点', async () => {
      const orphan = await createBlock({ pageId: 'page-1', parentId: 'non-existent', content: 'Orphan' })
      const root = await createBlock({ pageId: 'page-1', content: 'Root' })

      const tree = await service.buildTree('page-1')
      expect(tree.length).toBe(2)
      expect(tree.map(n => n.block.id)).toContain(orphan.id)
    })
  })

  // =============================================================================
  // 移动操作
  // =============================================================================

  describe('move', () => {
    it('应移动 Block 到新父级', async () => {
      const parent1 = await createBlock({ pageId: 'page-1', content: 'Parent 1' })
      const parent2 = await createBlock({ pageId: 'page-1', content: 'Parent 2' })
      const child = await createBlock({ pageId: 'page-1', parentId: parent1.id, content: 'Child' })

      await service.move(child.id, parent2.id)

      const updated = await service.getById(child.id)
      expect(updated?.parentId).toBe(parent2.id)
    })

    it('应设置正确的 pos', async () => {
      const parent = await createBlock({ pageId: 'page-1', content: 'Parent' })
      const child1 = await createBlock({ pageId: 'page-1', parentId: parent.id, content: 'Child 1' })
      const child2 = await createBlock({ pageId: 'page-1', parentId: parent.id, content: 'Child 2' })

      await service.move(child2.id, parent.id)

      const updated = await service.getById(child2.id)
      expect(updated?.pos).toBeGreaterThan(child1.pos)
    })
  })

  describe('indent', () => {
    it('应缩进 Block 到前一个兄弟的子级', async () => {
      const parent = await createBlock({ pageId: 'page-1', content: 'Parent' })
      const child1 = await createBlock({ pageId: 'page-1', parentId: parent.id, content: 'Child 1' })
      const child2 = await createBlock({ pageId: 'page-1', parentId: parent.id, content: 'Child 2' })

      await service.indent(child2.id)

      const updated = await service.getById(child2.id)
      expect(updated?.parentId).toBe(child1.id)
    })

    it('第一个 Block 不应缩进', async () => {
      const parent = await createBlock({ pageId: 'page-1', content: 'Parent' })
      const firstChild = await createBlock({ pageId: 'page-1', parentId: parent.id, content: 'First' })

      await service.indent(firstChild.id)

      const updated = await service.getById(firstChild.id)
      expect(updated?.parentId).toBe(parent.id)
    })
  })

  describe('outdent', () => {
    it('应反缩进 Block 到父节点同级', async () => {
      const grandparent = await createBlock({ pageId: 'page-1', content: 'Grandparent' })
      const parent = await createBlock({ pageId: 'page-1', parentId: grandparent.id, content: 'Parent' })
      const child = await createBlock({ pageId: 'page-1', parentId: parent.id, content: 'Child' })

      await service.outdent(child.id)

      const updated = await service.getById(child.id)
      expect(updated?.parentId).toBe(grandparent.id)
    })

    it('根 Block 不应反缩进', async () => {
      const root = await createBlock({ pageId: 'page-1', content: 'Root' })

      await service.outdent(root.id)

      const updated = await service.getById(root.id)
      expect(updated?.parentId).toBeNull()
    })
  })

  // =============================================================================
  // 路径查询
  // =============================================================================

  describe('getBlockPath', () => {
    it('应返回正确的祖先路径', async () => {
      const root = await createBlock({ pageId: 'page-1', content: 'Root' })
      const child = await createBlock({ pageId: 'page-1', parentId: root.id, content: 'Child' })
      const grandchild = await createBlock({ pageId: 'page-1', parentId: child.id, content: 'Grandchild' })

      const path = await service.getBlockPath(grandchild.id)

      expect(path).toBeDefined()
      expect(path!.ancestors.length).toBe(2)
      expect(path!.ancestors[0].id).toBe(root.id)
      expect(path!.ancestors[1].id).toBe(child.id)
      expect(path!.current.id).toBe(grandchild.id)
    })

    it('根 Block 应返回空祖先', async () => {
      const root = await createBlock({ pageId: 'page-1', content: 'Root' })

      const path = await service.getBlockPath(root.id)

      expect(path).toBeDefined()
      expect(path!.ancestors.length).toBe(0)
      expect(path!.current.id).toBe(root.id)
    })

    it('不存在的 Block 返回 null', async () => {
      const path = await service.getBlockPath('non-existent')
      expect(path).toBeNull()
    })
  })
})
