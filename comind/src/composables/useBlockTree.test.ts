import { describe, test, expect } from 'vitest'
import { buildTree, syncTreeToStore } from './useBlockTree'
import type { Block, TreeNode } from '../types/block'

describe('buildTree', () => {
  test('空数组返回空根节点', () => {
    const blocks: Block[] = []
    const roots = buildTree(blocks, 'page-1', null)
    expect(roots).toEqual([])
  })

  test('单一根节点', () => {
    const blocks: Block[] = [{
      id: 'block-1',
      pageId: 'page-1',
      parentId: null,
      pos: 1000,
      content: 'Test',
      format: {},
      type: 'bullet',
      properties: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    }]
    const roots = buildTree(blocks, 'page-1', null)
    expect(roots.length).toBe(1)
    expect(roots[0].id).toBe('block-1')
    expect(roots[0].children).toEqual([])
  })

  test('两层嵌套结构', () => {
    const blocks: Block[] = [
      { id: 'p1', pageId: 'page-1', parentId: null, pos: 1000, content: 'Parent', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c1', pageId: 'page-1', parentId: 'p1', pos: 1000, content: 'Child1', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c2', pageId: 'page-1', parentId: 'p1', pos: 2000, content: 'Child2', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]
    const roots = buildTree(blocks, 'page-1', null)
    expect(roots.length).toBe(1)
    expect(roots[0].children.length).toBe(2)
    expect(roots[0].children[0].id).toBe('c1')
    expect(roots[0].children[1].id).toBe('c2')
  })

  test('三层嵌套结构', () => {
    const blocks: Block[] = [
      { id: 'gp', pageId: 'page-1', parentId: null, pos: 1000, content: 'Grandparent', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'p', pageId: 'page-1', parentId: 'gp', pos: 1000, content: 'Parent', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c', pageId: 'page-1', parentId: 'p', pos: 1000, content: 'Child', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]
    const roots = buildTree(blocks, 'page-1', null)
    expect(roots.length).toBe(1)
    expect(roots[0].children.length).toBe(1)
    expect(roots[0].children[0].children.length).toBe(1)
    expect(roots[0].children[0].children[0].id).toBe('c')
  })

  test('孤儿节点处理 - parentId 不存在时不挂载', () => {
    const blocks: Block[] = [
      { id: 'b1', pageId: 'page-1', parentId: null, pos: 1000, content: 'B1', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'b2', pageId: 'page-1', parentId: 'non-existent', pos: 1000, content: 'Orphan', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]
    const roots = buildTree(blocks, 'page-1', null)
    expect(roots.length).toBe(1)
    expect(roots[0].id).toBe('b1')
  })

  test('按 pos 升序排列', () => {
    const blocks: Block[] = [
      { id: 'b3', pageId: 'page-1', parentId: null, pos: 3000, content: 'B3', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'b1', pageId: 'page-1', parentId: null, pos: 1000, content: 'B1', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'b2', pageId: 'page-1', parentId: null, pos: 2000, content: 'B2', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]
    const roots = buildTree(blocks, 'page-1', null)
    expect(roots.length).toBe(3)
    expect(roots[0].id).toBe('b1')
    expect(roots[1].id).toBe('b2')
    expect(roots[2].id).toBe('b3')
  })

  test('过滤指定 pageId', () => {
    const blocks: Block[] = [
      { id: 'b1', pageId: 'page-1', parentId: null, pos: 1000, content: 'Page1 Block', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'b2', pageId: 'page-2', parentId: null, pos: 1000, content: 'Page2 Block', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]
    const roots = buildTree(blocks, 'page-1', null)
    expect(roots.length).toBe(1)
    expect(roots[0].id).toBe('b1')
  })
})

describe('syncTreeToStore', () => {
  test('同步树形结构到扁平数组', () => {
    const blocks: Block[] = [
      { id: 'b1', pageId: 'page-1', parentId: null, pos: 1000, content: 'B1', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'b2', pageId: 'page-1', parentId: null, pos: 2000, content: 'B2', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]

    const tree: TreeNode[] = [
      { id: 'b2', block: blocks[1], children: [] },
      { id: 'b1', block: blocks[0], children: [] }
    ]

    const changed = syncTreeToStore(tree, null, blocks)

    expect(blocks[0].pos).toBe(2000)
    expect(blocks[1].pos).toBe(1000)
    expect(changed).toContain('b1')
    expect(changed).toContain('b2')
  })

  test('同步嵌套结构更新 parentId', () => {
    const blocks: Block[] = [
      { id: 'parent', pageId: 'page-1', parentId: null, pos: 1000, content: 'Parent', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'child', pageId: 'page-1', parentId: null, pos: 2000, content: 'Child', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]

    const tree: TreeNode[] = [
      { 
        id: 'parent', 
        block: blocks[0], 
        children: [
          { id: 'child', block: blocks[1], children: [] }
        ]
      }
    ]

    const changed = syncTreeToStore(tree, null, blocks)

    expect(blocks[1].parentId).toBe('parent')
    expect(blocks[1].pos).toBe(1000)
    expect(changed).toContain('child')
  })

  test('同步后更新 updatedAt', () => {
    const blocks: Block[] = [
      { id: 'b1', pageId: 'page-1', parentId: null, pos: 1000, content: 'B1', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'b2', pageId: 'page-1', parentId: null, pos: 2000, content: 'B2', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]

    const tree: TreeNode[] = [
      { id: 'b2', block: blocks[1], children: [] },
      { id: 'b1', block: blocks[0], children: [] }
    ]

    const beforeTime = Date.now()
    syncTreeToStore(tree, null, blocks)
    const afterTime = Date.now()

    expect(blocks[0].updatedAt).toBeGreaterThanOrEqual(beforeTime)
    expect(blocks[0].updatedAt).toBeLessThanOrEqual(afterTime)
    expect(blocks[1].updatedAt).toBeGreaterThanOrEqual(beforeTime)
    expect(blocks[1].updatedAt).toBeLessThanOrEqual(afterTime)
  })

  test('递归同步子节点', () => {
    const blocks: Block[] = [
      { id: 'gp', pageId: 'page-1', parentId: null, pos: 1000, content: 'GP', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'p', pageId: 'page-1', parentId: 'gp', pos: 1000, content: 'P', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c', pageId: 'page-1', parentId: 'p', pos: 1000, content: 'C', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]

    const tree: TreeNode[] = [
      { 
        id: 'gp', 
        block: blocks[0], 
        children: [
          { 
            id: 'p', 
            block: blocks[1], 
            children: [
              { id: 'c', block: blocks[2], children: [] }
            ]
          }
        ]
      }
    ]

    const changed = syncTreeToStore(tree, null, blocks)

    expect(blocks[0].parentId).toBe(null)
    expect(blocks[1].parentId).toBe('gp')
    expect(blocks[2].parentId).toBe('p')
    expect(changed).toEqual([])
  })

  test('递归同步时子节点位置变化', () => {
    const blocks: Block[] = [
      { id: 'gp', pageId: 'page-1', parentId: null, pos: 1000, content: 'GP', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'p', pageId: 'page-1', parentId: 'gp', pos: 2000, content: 'P', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c', pageId: 'page-1', parentId: 'p', pos: 2000, content: 'C', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]

    const tree: TreeNode[] = [
      { 
        id: 'gp', 
        block: blocks[0], 
        children: [
          { 
            id: 'p', 
            block: blocks[1], 
            children: [
              { id: 'c', block: blocks[2], children: [] }
            ]
          }
        ]
      }
    ]

    const changed = syncTreeToStore(tree, null, blocks)

    expect(blocks[1].pos).toBe(1000)
    expect(blocks[2].pos).toBe(1000)
    expect(changed).toContain('p')
    expect(changed).toContain('c')
  })

  test('未修改的节点不被标记为 changed', () => {
    const blocks: Block[] = [
      { id: 'b1', pageId: 'page-1', parentId: null, pos: 1000, content: 'B1', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'b2', pageId: 'page-1', parentId: null, pos: 2000, content: 'B2', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 }
    ]

    const tree: TreeNode[] = [
      { id: 'b1', block: blocks[0], children: [] },
      { id: 'b2', block: blocks[1], children: [] }
    ]

    const changed = syncTreeToStore(tree, null, blocks)

    expect(changed).toEqual([])
  })
})