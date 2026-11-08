import { describe, expect, it } from 'vitest'

import {
  applyAlignToRange,
  cellRangeHasContent,
  cellRangeToMatrix,
  cellRangeToTsv,
  clearCellRange,
  isWithinTable,
  normalizeCellRange,
  writeRangeIntoData,
} from './table-cell-range'
import type { TableData } from './table-model'

function table(rows: string[][]): TableData {
  return { rows, header: true, headerAlign: 'left', aligns: {}, merges: [] }
}

const data = table([
  ['A', 'B', 'C'],
  ['D', 'E', 'F'],
  ['G', 'H', 'I'],
])

describe('normalizeCellRange - 矩形归一', () => {
  it('正向拖拽保持原值', () => {
    expect(normalizeCellRange({ row: 0, col: 0 }, { row: 1, col: 2 }))
      .toEqual({ row1: 0, col1: 0, row2: 1, col2: 2 })
  })

  it('反向拖拽（右下→左上）与正向等价', () => {
    expect(normalizeCellRange({ row: 1, col: 2 }, { row: 0, col: 0 }))
      .toEqual({ row1: 0, col1: 0, row2: 1, col2: 2 })
  })

  it('同格塌缩成单格矩形', () => {
    expect(normalizeCellRange({ row: 2, col: 1 }, { row: 2, col: 1 }))
      .toEqual({ row1: 2, col1: 1, row2: 2, col2: 1 })
  })

  it('斜向拖拽取矩形而非路径', () => {
    expect(normalizeCellRange({ row: 0, col: 2 }, { row: 2, col: 0 }))
      .toEqual({ row1: 0, col1: 0, row2: 2, col2: 2 })
  })
})

describe('isWithinTable - 越界守卫', () => {
  it('表内矩形通过', () => {
    expect(isWithinTable(data, { row1: 0, col1: 0, row2: 2, col2: 2 })).toBe(true)
  })

  it('行越界拒绝（DOM 缓存失效后的陈旧坐标）', () => {
    expect(isWithinTable(data, { row1: 0, col1: 0, row2: 3, col2: 0 })).toBe(false)
  })

  it('列越界拒绝', () => {
    expect(isWithinTable(data, { row1: 0, col1: 0, row2: 0, col2: 3 })).toBe(false)
  })
})

describe('cellRangeToTsv - 复制输出', () => {
  it('单格输出纯文本', () => {
    expect(cellRangeToTsv(data, normalizeCellRange({ row: 0, col: 0 }, { row: 0, col: 0 }))).toBe('A')
  })

  it('同行多格用 Tab 连接', () => {
    expect(cellRangeToTsv(data, normalizeCellRange({ row: 0, col: 0 }, { row: 0, col: 2 }))).toBe('A\tB\tC')
  })

  it('矩形按行输出、行间换行', () => {
    expect(cellRangeToTsv(data, normalizeCellRange({ row: 0, col: 0 }, { row: 1, col: 1 })))
      .toBe('A\tB\nD\tE')
  })

  it('空单元格保留占位，不塌缩列', () => {
    const withHole = table([['A', '', 'C']])
    expect(cellRangeToTsv(withHole, normalizeCellRange({ row: 0, col: 0 }, { row: 0, col: 2 })))
      .toBe('A\t\tC')
  })
})

describe('cellRangeHasContent / clearCellRange - 删除', () => {
  const range = normalizeCellRange({ row: 0, col: 0 }, { row: 1, col: 1 })

  it('有内容时判定为真', () => {
    expect(cellRangeHasContent(data, range)).toBe(true)
  })

  it('矩形内全空时判定为假（删除键据此跳过写库）', () => {
    const blank = table([['', ''], ['', '']])
    expect(cellRangeHasContent(blank, range)).toBe(false)
  })

  it('只清矩形内的格，矩形外原样保留', () => {
    const next = clearCellRange(data, range)
    expect(next.rows).toEqual([
      ['', '', 'C'],
      ['', '', 'F'],
      ['G', 'H', 'I'],
    ])
  })

  it('清空不改变表结构（行列数与表头标记）', () => {
    const next = clearCellRange(data, normalizeCellRange({ row: 0, col: 0 }, { row: 2, col: 2 }))
    expect(next.rows).toHaveLength(3)
    expect(next.rows[0]).toHaveLength(3)
    expect(next.header).toBe(true)
  })

  it('纯函数：不修改入参', () => {
    const before = JSON.stringify(data)
    clearCellRange(data, range)
    expect(JSON.stringify(data)).toBe(before)
  })
})

describe('applyAlignToRange - 范围对齐', () => {
  it('给矩形内每一格写入显式对齐，矩形外不受影响', () => {
    const next = applyAlignToRange(data, normalizeCellRange({ row: 0, col: 0 }, { row: 1, col: 1 }), 'center')
    expect(next.aligns).toEqual({
      '0:0': 'center', '0:1': 'center',
      '1:0': 'center', '1:1': 'center',
    })
  })

  it('保留矩形外已存在的逐格对齐', () => {
    const base: TableData = { ...data, aligns: { '2:2': 'right' } }
    const next = applyAlignToRange(base, normalizeCellRange({ row: 0, col: 0 }, { row: 0, col: 0 }), 'left')
    expect(next.aligns['2:2']).toBe('right')
    expect(next.aligns['0:0']).toBe('left')
  })

  it('不改动内容与表结构', () => {
    const next = applyAlignToRange(data, normalizeCellRange({ row: 0, col: 0 }, { row: 2, col: 2 }), 'right')
    expect(next.rows).toEqual(data.rows)
    expect(next.header).toBe(data.header)
  })
})

describe('cellRangeToMatrix / writeRangeIntoData - 范围剪贴板与粘贴', () => {
  it('矩阵保留行列结构（空格保留占位）', () => {
    const withHole = table([['A', '', 'C'], ['D', 'E', 'F']])
    expect(cellRangeToMatrix(withHole, normalizeCellRange({ row: 0, col: 0 }, { row: 1, col: 1 })))
      .toEqual([['A', ''], ['D', 'E']])
  })

  it('粘贴按左上角对齐覆盖，矩形外原样保留', () => {
    const next = writeRangeIntoData(data, normalizeCellRange({ row: 1, col: 1 }, { row: 2, col: 2 }), [['x', 'y'], ['z', 'w']])
    expect(next.rows).toEqual([
      ['A', 'B', 'C'],
      ['D', 'x', 'y'],
      ['G', 'z', 'w'],
    ])
  })

  it('矩阵超出矩形时丢弃多余部分（不改行列数）', () => {
    const next = writeRangeIntoData(data, normalizeCellRange({ row: 0, col: 0 }, { row: 0, col: 0 }), [['x', 'y'], ['z', 'w']])
    expect(next.rows).toHaveLength(3)
    expect(next.rows[0]).toHaveLength(3)
    expect(next.rows[0]![0]).toBe('x')
    expect(next.rows[1]![1]).toBe('E')
  })

  it('矩阵不足时保留原值（不把没覆盖到的格清空）', () => {
    const next = writeRangeIntoData(data, normalizeCellRange({ row: 0, col: 0 }, { row: 2, col: 2 }), [['x']])
    expect(next.rows[0]![0]).toBe('x')
    expect(next.rows[2]![2]).toBe('I')
  })
})

describe('table-cell-range — 合并区适配', () => {
  /** 3×3，把 (1,0)-(2,1) 合并：内容只认左上格 */
  function merged(): TableData {
    return {
      rows: [['h', 'h', 'h'], ['a', '', 'c'], ['', '', 'f']],
      header: true,
      headerAlign: 'left',
      aligns: {},
      merges: [{ row1: 1, col1: 0, row2: 2, col2: 1 }],
    }
  }

  it('复制矩阵：被覆盖的格输出空（左上格出值）', () => {
    expect(cellRangeToMatrix(merged(), { row1: 1, col1: 0, row2: 2, col2: 1 })).toEqual([
      ['a', ''],
      ['', ''],
    ])
    expect(cellRangeToTsv(merged(), { row1: 1, col1: 0, row2: 1, col2: 2 })).toBe('a\t\tc')
  })

  it('内容判定：只有被覆盖的残留内容不算「有内容」', () => {
    const data: TableData = { ...merged(), rows: [['h'], ['a'], ['x']], merges: [{ row1: 1, col1: 0, row2: 2, col2: 0 }] }
    // (2,0) 被 (1,0) 覆盖，残留的 'x' 不可见，不该让「清空」认为有变更
    expect(cellRangeHasContent(data, { row1: 2, col1: 0, row2: 2, col2: 0 })).toBe(false)
    expect(cellRangeHasContent(data, { row1: 1, col1: 0, row2: 1, col2: 0 })).toBe(true)
  })

  it('粘贴：不往被覆盖的格里写（取消合并后不会莫名冒内容）', () => {
    const next = writeRangeIntoData(merged(), { row1: 1, col1: 0, row2: 2, col2: 1 }, [
      ['X', 'Y'],
      ['Z', 'W'],
    ])
    expect(next.rows[1]).toEqual(['X', '', 'c'])
    expect(next.rows[2]).toEqual(['', '', 'f'])
  })

  it('对齐：只写可见格，被覆盖格不留键', () => {
    const next = applyAlignToRange(merged(), { row1: 1, col1: 0, row2: 2, col2: 1 }, 'center')
    expect(next.aligns).toEqual({ '1:0': 'center' })
  })
})
