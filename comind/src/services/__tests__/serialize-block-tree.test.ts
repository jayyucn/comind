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

  test('rootBlockId 不存在时应返回空数组', () => {
    const blocks: Block[] = [{
      id: 'b1', pageId: 'p1', parentId: null, pos: 1000,
      content: 'hello', format: {}, type: 'bullet',
      properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'non-existent-id')
    expect(result).toEqual([])
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

// ─── 更多边界情况和深层嵌套测试 ─────────────────────────────────

describe('serializeBlockTree - edge cases', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  test('空 blocks 数组返回空数组', () => {
    const result = serializeBlockTree([], 'any-id')
    expect(result).toEqual([])
  })

  test('heading level 边界值（1, 2, 3）', () => {
    const blocks: Block[] = [
      { id: 'h1', pageId: 'p1', parentId: null, pos: 1000, content: 'H1', format: { type: 'heading', level: 1 }, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'h2', pageId: 'p1', parentId: null, pos: 2000, content: 'H2', format: { type: 'heading', level: 2 }, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'h3', pageId: 'p1', parentId: null, pos: 3000, content: 'H3', format: { type: 'heading', level: 3 }, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
    ]
    const result = serializeBlockTree(blocks, 'h1')
    expect(result[0].headingLevel).toBe(1)
  })

  test('heading level 无效值默认为 2', () => {
    const blocks: Block[] = [
      { id: 'h', pageId: 'p1', parentId: null, pos: 1000, content: 'H', format: { type: 'heading', level: 5 }, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
    ]
    const result = serializeBlockTree(blocks, 'h')
    expect(result[0].headingLevel).toBe(2)
  })

  test('heading level 为 0 默认为 2', () => {
    const blocks: Block[] = [
      { id: 'h', pageId: 'p1', parentId: null, pos: 1000, content: 'H', format: { type: 'heading', level: 0 }, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
    ]
    const result = serializeBlockTree(blocks, 'h')
    expect(result[0].headingLevel).toBe(2)
  })

  test('property 分隔符 :: 在 content 开头', () => {
    const blocks: Block[] = [{
      id: 'p', pageId: 'p1', parentId: null, pos: 1000,
      content: ':: value', format: {},
      type: 'property', properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'p')
    expect(result).toEqual([{ type: 'property', propertyKey: '', content: 'value' }])
  })

  test('property 分隔符 :: 在 content 结尾', () => {
    const blocks: Block[] = [{
      id: 'p', pageId: 'p1', parentId: null, pos: 1000,
      content: 'key::', format: {},
      type: 'property', properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'p')
    expect(result).toEqual([{ type: 'property', propertyKey: 'key', content: '' }])
  })

  test('property 含多个 ::', () => {
    const blocks: Block[] = [{
      id: 'p', pageId: 'p1', parentId: null, pos: 1000,
      content: 'key:: value:: more', format: {},
      type: 'property', properties: {}, createdAt: 0, updatedAt: 0
    }]
    const result = serializeBlockTree(blocks, 'p')
    // 只在第一个 :: 处分割
    expect(result).toEqual([{ type: 'property', propertyKey: 'key', content: 'value:: more' }])
  })

  test('深层嵌套子树（5 层）', () => {
    const blocks: Block[] = [
      { id: 'l1', pageId: 'p1', parentId: null, pos: 1000, content: 'Level 1', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'l2', pageId: 'p1', parentId: 'l1', pos: 2000, content: 'Level 2', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'l3', pageId: 'p1', parentId: 'l2', pos: 3000, content: 'Level 3', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'l4', pageId: 'p1', parentId: 'l3', pos: 4000, content: 'Level 4', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'l5', pageId: 'p1', parentId: 'l4', pos: 5000, content: 'Level 5', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
    ]
    const result = serializeBlockTree(blocks, 'l1')
    expect(result[0].content).toBe('Level 1')
    expect(result[0].children?.[0].content).toBe('Level 2')
    expect(result[0].children?.[0].children?.[0].content).toBe('Level 3')
    expect(result[0].children?.[0].children?.[0].children?.[0].content).toBe('Level 4')
    expect(result[0].children?.[0].children?.[0].children?.[0].children?.[0].content).toBe('Level 5')
  })

  test('多个不支持的类型都降级为 bullet', () => {
    const blocks: Block[] = [
      { id: 'q', pageId: 'p1', parentId: null, pos: 1000, content: 'query', format: {}, type: 'query', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'e', pageId: 'p1', parentId: null, pos: 2000, content: 'embed', format: {}, type: 'embed', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c', pageId: 'p1', parentId: null, pos: 3000, content: 'code', format: {}, type: 'code', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'i', pageId: 'p1', parentId: null, pos: 4000, content: 'image', format: {}, type: 'image', properties: {}, createdAt: 0, updatedAt: 0 },
    ]
    const result = serializeBlockTree(blocks, 'q')
    expect(result[0].type).toBe('bullet')
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  test('子节点按 pos 排序', () => {
    const blocks: Block[] = [
      { id: 'p', pageId: 'p1', parentId: null, pos: 1000, content: 'Parent', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c3', pageId: 'p1', parentId: 'p', pos: 3000, content: 'Child 3', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c1', pageId: 'p1', parentId: 'p', pos: 1000, content: 'Child 1', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'c2', pageId: 'p1', parentId: 'p', pos: 2000, content: 'Child 2', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
    ]
    const result = serializeBlockTree(blocks, 'p')
    expect(result[0].children?.map(c => c.content)).toEqual(['Child 1', 'Child 2', 'Child 3'])
  })

  test('孤儿 block（parentId 指向不存在的 ID）被跳过', () => {
    const blocks: Block[] = [
      { id: 'p', pageId: 'p1', parentId: null, pos: 1000, content: 'Parent', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
      { id: 'o', pageId: 'p1', parentId: 'non-existent', pos: 2000, content: 'Orphan', format: {}, type: 'bullet', properties: {}, createdAt: 0, updatedAt: 0 },
    ]
    const result = serializeBlockTree(blocks, 'p')
    expect(result[0].children).toBeUndefined()
  })
})

describe('deserializeBlockTree - edge cases', () => {
  test('空 TemplateBlock 数组返回空数组', () => {
    const result = deserializeBlockTree([], { pageId: 'p1', parentId: null })
    expect(result).toEqual([])
  })

  test('自定义 basePos', () => {
    const blocks = deserializeBlockTree(
      [{ type: 'bullet', content: 'a' }],
      { pageId: 'p1', parentId: null, basePos: 5000 }
    )
    expect(blocks[0].pos).toBe(5000)
  })

  test('basePos 为 0', () => {
    const blocks = deserializeBlockTree(
      [{ type: 'bullet', content: 'a' }],
      { pageId: 'p1', parentId: null, basePos: 0 }
    )
    expect(blocks[0].pos).toBe(0)
  })

  test('heading 无 headingLevel 默认为 2', () => {
    const blocks = deserializeBlockTree(
      [{ type: 'heading', content: 'Title' }],
      { pageId: 'p1', parentId: null }
    )
    expect(blocks[0].format).toEqual({ type: 'heading', level: 2 })
  })

  test('property 无 propertyKey 使用空字符串', () => {
    const blocks = deserializeBlockTree(
      [{ type: 'property', content: 'value' }],
      { pageId: 'p1', parentId: null }
    )
    expect(blocks[0].content).toBe(':: value')
    expect(blocks[0].type).toBe('property')
  })

  test('深层嵌套 children（5 层）', () => {
    const template = {
      type: 'bullet' as const,
      content: 'L1',
      children: [{
        type: 'bullet' as const,
        content: 'L2',
        children: [{
          type: 'bullet' as const,
          content: 'L3',
          children: [{
            type: 'bullet' as const,
            content: 'L4',
            children: [{
              type: 'bullet' as const,
              content: 'L5'
            }]
          }]
        }]
      }]
    }
    const blocks = deserializeBlockTree([template], { pageId: 'p1', parentId: null })
    expect(blocks.length).toBe(5)
    expect(blocks[0].parentId).toBeNull()
    expect(blocks[1].parentId).toBe(blocks[0].id)
    expect(blocks[2].parentId).toBe(blocks[1].id)
    expect(blocks[3].parentId).toBe(blocks[2].id)
    expect(blocks[4].parentId).toBe(blocks[3].id)
  })

  test('多个顶级 blocks', () => {
    const blocks = deserializeBlockTree(
      [
        { type: 'bullet', content: 'A' },
        { type: 'bullet', content: 'B' },
        { type: 'bullet', content: 'C' },
      ],
      { pageId: 'p1', parentId: 'root' }
    )
    expect(blocks.length).toBe(3)
    expect(blocks[0].parentId).toBe('root')
    expect(blocks[1].parentId).toBe('root')
    expect(blocks[2].parentId).toBe('root')
  })

  test('生成的 id 是有效 UUID', () => {
    const blocks = deserializeBlockTree(
      [{ type: 'bullet', content: 'test' }],
      { pageId: 'p1', parentId: null }
    )
    // UUID 格式：xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(blocks[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  test('createdAt 和 updatedAt 接近当前时间', () => {
    const before = Date.now()
    const blocks = deserializeBlockTree(
      [{ type: 'bullet', content: 'test' }],
      { pageId: 'p1', parentId: null }
    )
    const after = Date.now()
    expect(blocks[0].createdAt).toBeGreaterThanOrEqual(before)
    expect(blocks[0].createdAt).toBeLessThanOrEqual(after)
    expect(blocks[0].updatedAt).toBe(blocks[0].createdAt)
  })

  test('所有 blocks 共享相同的 pageId', () => {
    const template = {
      type: 'bullet' as const,
      content: 'parent',
      children: [
        { type: 'bullet' as const, content: 'child1' },
        { type: 'bullet' as const, content: 'child2' },
      ]
    }
    const blocks = deserializeBlockTree([template], { pageId: 'custom-page', parentId: null })
    expect(blocks.every(b => b.pageId === 'custom-page')).toBe(true)
  })
})
