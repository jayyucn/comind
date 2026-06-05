import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Block } from '../../types/block'
import { serializeBlockTree, deserializeBlockTree } from '../serialize-block-tree'

describe('serializeBlockTree', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  test('bullet Block 序列化为 type=bullet 的 TemplateBlock', () => {
    const blocks: Block[] = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 1000,
      content: 'hello', format: {}, type: 'bullet',
      properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'b1')
    expect(result).toEqual([{ type: 'bullet', content: 'hello' }])
  })

  test('heading Block（format.type=heading）序列化为 type=heading + headingLevel', () => {
    const blocks: Block[] = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 1000,
      content: 'Title', format: { type: 'heading', level: 2 },
      type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'b1')
    expect(result).toEqual([{ type: 'heading', content: 'Title', headingLevel: 2 }])
  })

  test('property Block 序列化为 type=property + propertyKey', () => {
    const blocks: Block[] = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 1000,
      content: '时间:: 2026-06-05', format: {},
      type: 'property', properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'b1')
    expect(result).toEqual([{ type: 'property', propertyKey: '时间', content: '2026-06-05' }])
  })

  test('不支持的 Block 类型（query/embed/code/image）降级为 bullet 并 console.warn', () => {
    const blocks: Block[] = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 1000,
      content: '```js\ncode\n```', format: {},
      type: 'code', properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'b1')
    expect(result).toEqual([{ type: 'bullet', content: '```js\ncode\n```' }])
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('code'))
  })

  test('嵌套子树：children 正确组装', () => {
    const blocks: Block[] = [
      { id: 'p', pageId: 'p1', parentId: null, pos: 1000, content: 'Parent', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c1', pageId: 'p1', parentId: 'p', pos: 1000, content: 'Child1', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c2', pageId: 'p1', parentId: 'p', pos: 2000, content: 'Child2', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'orphan', pageId: 'p1', parentId: 'non-existent', pos: 3000, content: 'Orphan', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
    ]
    const result = serializeBlockTree(blocks, 'p')
    expect(result).toEqual([{
      type: 'bullet', content: 'Parent',
      children: [
        { type: 'bullet', content: 'Child1' },
        { type: 'bullet', content: 'Child2' },
      ]
    }])
    // Orphan 不应出现
    expect(JSON.stringify(result)).not.toContain('Orphan')
  })

  test('property 行 content 缺少 `::` 时退化为 bullet', () => {
    const blocks: Block[] = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 1000,
      content: 'no separator', format: {},
      type: 'property', properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'b1')
    expect(result).toEqual([{ type: 'bullet', content: 'no separator' }])
  })
})

describe('deserializeBlockTree', () => {
  test('TemplateBlock[] → Block[]：生成 UUID + pos=1000 起步', () => {
    const blocks = deserializeBlockTree(
      [
        { type: 'bullet', content: 'a' },
        { type: 'heading', content: 'b', headingLevel: 2 },
      ],
      { pageId: 'p1', parentId: null, basePos: 1000 }
    )
    expect(blocks.length).toBe(2)
    expect(blocks[0].id).not.toBe(blocks[1].id)
    expect(blocks[0].pageId).toBe('p1')
    expect(blocks[0].parentId).toBeNull()
    expect(blocks[0].pos).toBe(1000)
    expect(blocks[1].pos).toBe(2000)
    expect(blocks[0].type).toBe('bullet')
    expect(blocks[0].content).toBe('a')
    expect(blocks[1].type).toBe('bullet')
    expect(blocks[1].format).toEqual({ type: 'heading', level: 2 })
  })

  test('property 反序列化为 `key:: value` 格式', () => {
    const blocks = deserializeBlockTree(
      [{ type: 'property', propertyKey: '时间', content: '2026-06-05' }],
      { pageId: 'p1', parentId: null, basePos: 1000 }
    )
    expect(blocks[0].type).toBe('property')
    expect(blocks[0].content).toBe('时间:: 2026-06-05')
  })

  test('children 正确展开为嵌套 Block（DFS 顺序）', () => {
    const blocks = deserializeBlockTree(
      [{
        type: 'bullet', content: 'parent',
        children: [
          { type: 'bullet', content: 'child' }
        ]
      }],
      { pageId: 'p1', parentId: null, basePos: 1000 }
    )
    expect(blocks.length).toBe(2)
    expect(blocks[0].content).toBe('parent')
    expect(blocks[0].parentId).toBeNull()
    expect(blocks[0].pos).toBe(1000)
    expect(blocks[1].content).toBe('child')
    expect(blocks[1].parentId).toBe(blocks[0].id)
    expect(blocks[1].pos).toBe(2000)
  })
})
