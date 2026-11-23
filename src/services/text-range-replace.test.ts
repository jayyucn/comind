import { describe, expect, it } from 'vitest'

import { planTextRangeReplacement } from './text-range'
import type { Block } from '../types/block'

/**
 * 选区替换（「转为页面引用」的写回路径）的纯计算契约。
 *
 * 与删除计划共用同一条坐标链（渲染偏移 → 编码偏移 → content 拼接），但只走
 * 「同块 + 普通文本块」这一条最窄分支：跨块没有单一页名语义，表格的 content
 * 不承载正文。
 */
function block(overrides: Partial<Block> = {}): Block {
  return {
    id: 'b1',
    pageId: 'p1',
    parentId: null,
    pos: 1000,
    content: '我看项目A了',
    format: {},
    type: 'text',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const sameBlockRange = (from: number, to: number) => ({
  anchor: { blockId: 'b1', offset: from },
  head: { blockId: 'b1', offset: to },
})

describe('planTextRangeReplacement — 同块替换', () => {
  it('替换选中片段，caret 落在替换文本末尾（编码偏移）', () => {
    const plan = planTextRangeReplacement([block()], sameBlockRange(2, 5), '[[项目A]]')
    expect(plan).not.toBeNull()
    expect(plan!.content).toBe('我看[[项目A]]了')
    expect(plan!.caretOffset).toBe(2 + '[[项目A]]'.length)
  })

  it('反向选区（从右往左拖）按归一化后区间替换', () => {
    const plan = planTextRangeReplacement(
      [block()],
      {
        anchor: { blockId: 'b1', offset: 5 },
        head: { blockId: 'b1', offset: 2 },
      },
      '[[项目A]]',
    )
    expect(plan!.content).toBe('我看[[项目A]]了')
  })

  it('逗号等标点不影响偏移（UTF-16 逐码元）', () => {
    const plan = planTextRangeReplacement(
      [block({ content: 'a, 项目A; b' })],
      sameBlockRange(3, 6),
      '[[X]]',
    )
    expect(plan!.content).toBe('a, [[X]]; b')
  })

  it('渲染偏移先换算成编码偏移（别名链接比可见文本长）', () => {
    // 存储 `x[[项目A|别名]]y`，渲染 `x[[别名]]y`
    const content = 'x[[项目A|别名]]y'
    const plan = planTextRangeReplacement(
      [block({ content })],
      sameBlockRange(7, 8),
      '[[Z]]',
    )
    expect(plan!.content).toBe('x[[项目A|别名]][[Z]]')
  })
})

describe('planTextRangeReplacement — 格式切片', () => {
  const marked = block({
    content: 'abcdef',
    format: { inlineMarks: [{ start: 0, end: 2, bold: true }, { start: 4, end: 6, italic: true }] },
  })

  it('插入点两侧 marks 保留，右侧按插入长度平移，括号本身无格式', () => {
    const plan = planTextRangeReplacement([marked], sameBlockRange(2, 4), '[[X]]')
    expect(plan!.content).toBe('ab[[X]]ef')
    expect(plan!.inlineMarks).toEqual([
      { start: 0, end: 2, bold: true },
      { start: 2 + '[[X]]'.length + 0, end: 2 + '[[X]]'.length + 2, italic: true },
    ])
  })

  it('选区覆盖的格式随文字一起消失', () => {
    const plan = planTextRangeReplacement([marked], sameBlockRange(0, 4), '[[X]]')
    expect(plan!.content).toBe('[[X]]ef')
    expect(plan!.inlineMarks).toEqual([
      { start: '[[X]]'.length, end: '[[X]]'.length + 2, italic: true },
    ])
  })
})

describe('planTextRangeReplacement — 拒绝面', () => {
  it('跨块返回 null（没有单一页名语义）', () => {
    const blocks = [block(), block({ id: 'b2', pos: 2000, content: '第二块' })]
    expect(
      planTextRangeReplacement(
        blocks,
        {
          anchor: { blockId: 'b1', offset: 1 },
          head: { blockId: 'b2', offset: 2 },
        },
        '[[X]]',
      ),
    ).toBeNull()
  })

  it('表格块返回 null（content 不承载正文）', () => {
    expect(
      planTextRangeReplacement(
        [block({ type: 'table', content: '' })],
        sameBlockRange(0, 1),
        '[[X]]',
      ),
    ).toBeNull()
  })

  it('折叠区间返回 null（没有可替换的文字）', () => {
    expect(planTextRangeReplacement([block()], sameBlockRange(2, 2), '[[X]]')).toBeNull()
  })
})
