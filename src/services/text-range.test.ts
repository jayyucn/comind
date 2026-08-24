import { describe, test, expect } from 'vitest'
import { normalizeTextRange, textRangeToText } from './text-range'
import type { Block } from '../types/block'
import type { BlockOffset, TextRange } from './text-range'

function makeBlock(overrides: Partial<Block> & Pick<Block, 'id' | 'content'>): Block {
  return {
    pageId: 'page-1',
    parentId: null,
    pos: 1000,
    type: 'bullet',
    format: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Block
}

/** 便捷：构造同页、按 pos 顺序排列的顶层 block 列表 */
function blocks(items: Array<{ id: string; content: string; type?: Block['type']; parentId?: string | null; pos?: number }>): Block[] {
  return items.map((it, i) =>
    makeBlock({
      id: it.id,
      content: it.content,
      type: it.type ?? 'bullet',
      parentId: it.parentId ?? null,
      pos: it.pos ?? (i + 1) * 1000,
    })
  )
}

function offset(blockId: string, offset: number): BlockOffset {
  return { blockId, offset }
}

function range(anchor: BlockOffset, head: BlockOffset): TextRange {
  return { anchor, head }
}

describe('textRangeToText', () => {
  test('单块内部分选区：只复制 [start,end) 切片', () => {
    const bs = blocks([{ id: 'a', content: 'Hello World' }])
    expect(textRangeToText(bs, range(offset('a', 0), offset('a', 5)))).toBe('Hello')
  })

  test('跨多块：首块尾段 + 中间整块 + 末块前段，块间换行', () => {
    const bs = blocks([
      { id: 'a', content: 'aaa' },
      { id: 'b', content: 'bbb' },
      { id: 'c', content: 'ccc' },
    ])
    expect(textRangeToText(bs, range(offset('a', 1), offset('c', 2)))).toBe('aa\nbbb\ncc')
  })

  test('反向拖拽（anchor 在 head 之后）归一化为同一结果', () => {
    const bs = blocks([
      { id: 'a', content: 'aaa' },
      { id: 'b', content: 'bbb' },
      { id: 'c', content: 'ccc' },
    ])
    const forward = textRangeToText(bs, range(offset('a', 1), offset('c', 2)))
    const backward = textRangeToText(bs, range(offset('c', 2), offset('a', 1)))
    expect(backward).toBe(forward)
    expect(backward).toBe('aa\nbbb\ncc')
  })

  test('中间含 image/code/heading 块时按其 content 表示输出', () => {
    const bs = blocks([
      { id: 'a', content: 'start' },
      { id: 'img', content: '![alt](url)', type: 'image' },
      { id: 'code', content: 'const x = 1', type: 'code' },
      { id: 'h', content: '# Title', type: 'bullet' },
      { id: 'z', content: 'end' },
    ])
    expect(textRangeToText(bs, range(offset('a', 0), offset('z', 3)))).toBe(
      'start\n![alt](url)\nconst x = 1\n# Title\nend'
    )
  })

  test('offset 落在块边界（0 / content.length）时行为正确', () => {
    const bs = blocks([
      { id: 'a', content: 'aaa' },
      { id: 'b', content: 'bbb' },
    ])
    // 首块从头、末块到结尾
    expect(textRangeToText(bs, range(offset('a', 0), offset('b', 3)))).toBe('aaa\nbbb')
    // 首块 offset 越界（>length）被 clamp 到末尾
    expect(textRangeToText(bs, range(offset('a', 99), offset('b', 0)))).toBe('\n')
  })

  test('空范围（anchor == head 且同 offset）输出空串', () => {
    const bs = blocks([{ id: 'a', content: 'Hello' }])
    expect(textRangeToText(bs, range(offset('a', 2), offset('a', 2)))).toBe('')
  })

  test('单块反向（head offset < anchor offset）仍按大小切片', () => {
    const bs = blocks([{ id: 'a', content: 'abcdef' }])
    expect(textRangeToText(bs, range(offset('a', 5), offset('a', 1)))).toBe('bcde')
  })
})

describe('normalizeTextRange', () => {
  test('嵌套块按预序文档序归一化，中间整块含子树', () => {
    // 根块（parentId=null）→ a → b(子) → c → d
    const bs = [
      makeBlock({ id: 'root', content: 'Title', parentId: null, pos: 0 }),
      ...blocks([
        { id: 'a', content: 'aaa', parentId: 'root', pos: 1000 },
        { id: 'b', content: 'bbb', parentId: 'a', pos: 1000 },
        { id: 'c', content: 'ccc', parentId: 'root', pos: 2000 },
        { id: 'd', content: 'ddd', parentId: 'root', pos: 3000 },
      ]),
    ]

    const norm = normalizeTextRange(bs, range(offset('a', 1), offset('d', 1)))
    expect(norm.start).toEqual({ blockId: 'a', offset: 1 })
    expect(norm.end).toEqual({ blockId: 'd', offset: 1 })
    expect(norm.middleBlockIds).toEqual(['b', 'c'])
  })

  test('根块（parentId=null）不落入选区范围', () => {
    const bs = [
      makeBlock({ id: 'root', content: 'Title', parentId: null, pos: 0 }),
      ...blocks([
        { id: 'a', content: 'aaa', parentId: 'root', pos: 1000 },
        { id: 'b', content: 'bbb', parentId: 'root', pos: 2000 },
      ]),
    ]
    expect(textRangeToText(bs, range(offset('a', 0), offset('b', 3)))).toBe('aaa\nbbb')
  })

  test('顶层块 parentId 指向不在列表中的根块时仍正确（根块已过滤）', () => {
    // 调用方已过滤根块：顶层块的 parentId 指向不在此列表的 'root'
    const bs = blocks([
      { id: 'a', content: 'aaa', parentId: 'root', pos: 1000 },
      { id: 'b', content: 'bbb', parentId: 'root', pos: 2000 },
      { id: 'c', content: 'ccc', parentId: 'root', pos: 3000 },
    ])
    expect(textRangeToText(bs, range(offset('a', 1), offset('c', 2)))).toBe('aa\nbbb\ncc')
  })

  test('反向拖拽时 start/end 按文档序交换', () => {
    const bs = blocks([
      { id: 'a', content: 'aaa' },
      { id: 'b', content: 'bbb' },
    ])
    const norm = normalizeTextRange(bs, range(offset('b', 0), offset('a', 0)))
    expect(norm.start).toEqual({ blockId: 'a', offset: 0 })
    expect(norm.end).toEqual({ blockId: 'b', offset: 0 })
    expect(norm.middleBlockIds).toEqual([])
  })
})
