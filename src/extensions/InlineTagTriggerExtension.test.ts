import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  findTagAtCursor,
  closeTagMenuByEditor,
  InlineTagTriggerExtension,
} from './InlineTagTriggerExtension'

/** 按累积偏移给出每个文本节点的正确 nodePos（规避既有 mock 的错位）。 */
function makeDoc(parts: string[]): any {
  let offset = 0
  const nodes = parts.map((text) => {
    const pos = offset
    offset += text.length
    return { isText: true, text, nodeSize: text.length, pos }
  })
  return {
    descendants(fn: (node: any, pos: number) => void) {
      for (const n of nodes) fn(n, n.pos)
    },
  }
}

describe('findTagAtCursor', () => {
  test('should find #tag at start with query', () => {
    const doc = makeDoc(['#tag'])
    const result = findTagAtCursor(doc, 3)
    expect(result.found).toBe(true)
    expect(result.range).toEqual({ from: 0, to: 4 })
    expect(result.query).toBe('ta')
  })

  test('should find lone # (empty query)', () => {
    const doc = makeDoc(['#'])
    const result = findTagAtCursor(doc, 1)
    expect(result.found).toBe(true)
    expect(result.query).toBe('')
    expect(result.range).toEqual({ from: 0, to: 1 })
  })

  test('should find #tag with surrounding text', () => {
    const doc = makeDoc(['Hello #World foo'])
    // #World 位于 6..11，光标在 8（W 内）
    const result = findTagAtCursor(doc, 8)
    expect(result.found).toBe(true)
    expect(result.range).toEqual({ from: 6, to: 12 })
    expect(result.query).toBe('W')
  })

  test('should not find when cursor outside token', () => {
    const doc = makeDoc(['Hello #World'])
    const result = findTagAtCursor(doc, 0)
    expect(result.found).toBe(false)
  })

  test('should support slash-nested tag (#proj/sub)', () => {
    const doc = makeDoc(['a #proj/sub b'])
    // # 在 2，proj/sub 到 11
    const result = findTagAtCursor(doc, 9)
    expect(result.found).toBe(true)
    expect(result.query).toBe('proj/s')
    expect(result.range).toEqual({ from: 2, to: 11 })
  })

  test('should ignore # preceded by /', () => {
    const doc = makeDoc(['a/#tag'])
    const result = findTagAtCursor(doc, 6)
    expect(result.found).toBe(false)
  })

  test('should ignore # preceded by |', () => {
    const doc = makeDoc(['a|#tag'])
    const result = findTagAtCursor(doc, 6)
    expect(result.found).toBe(false)
  })

  test('should ignore # preceded by [ (wiki link scope)', () => {
    const doc = makeDoc(['[[#x]]'])
    const result = findTagAtCursor(doc, 3)
    expect(result.found).toBe(false)
  })

  test('should close token at whitespace', () => {
    const doc = makeDoc(['foo #ba r'])
    // #ba 在 4..7，空格在 7，光标点 8（r 内）→ 越过 token 末，未命中
    const result = findTagAtCursor(doc, 8)
    expect(result.found).toBe(false)
  })

  test('should find tag across multiple text nodes', () => {
    const doc = makeDoc(['start ', '#Tag', ' end'])
    // #Tag 在全局 6..10
    const result = findTagAtCursor(doc, 8)
    expect(result.found).toBe(true)
    expect(result.range).toEqual({ from: 6, to: 10 })
    expect(result.query).toBe('T')
  })

  test('should not find when cursor at exact start position', () => {
    const doc = makeDoc(['#tag'])
    const result = findTagAtCursor(doc, 0)
    expect(result.found).toBe(false)
  })

  test('should find when cursor at exact end position', () => {
    const doc = makeDoc(['#tag'])
    const result = findTagAtCursor(doc, 4)
    expect(result.found).toBe(true)
    expect(result.query).toBe('tag')
  })
})
