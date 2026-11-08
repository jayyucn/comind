import { describe, expect, test } from 'vitest'

import {
  addColumn,
  addColumnToAligns,
  addColumnToMerges,
  addRow,
  addRowToAligns,
  addRowToMerges,
  anchorFor,
  cellAlign,
  createTableData,
  isCoveredCell,
  isMergeAnchor,
  isSameTableData,
  mergeCellTexts,
  mergeRange,
  mergeRectAt,
  normalizeMerges,
  normalizeTableData,
  readTableData,
  removeColumn,
  removeColumnFromAligns,
  removeColumnFromMerges,
  removeRow,
  removeRowFromAligns,
  removeRowFromMerges,
  sanitizeCellText,
  serializeTableGfm,
  serializeTableTsv,
  swapColumnsInAligns,
  swapColumnsInMerges,
  swapRowsInAligns,
  swapRowsInMerges,
  unmergeRange,
} from './table-model'

describe('table-model — 初始化与归一化', () => {
  test('默认 3×3、首行表头', () => {
    const data = createTableData()
    expect(data.header).toBe(true)
    expect(data.rows).toHaveLength(3)
    expect(data.rows.every(row => row.length === 3 && row.every(cell => cell === ''))).toBe(true)
  })

  test('缺失/损坏的 format → 默认表格', () => {
    expect(readTableData(null).rows).toHaveLength(3)
    expect(readTableData({ table: { rows: [] } }).rows).toHaveLength(3)
    expect(readTableData({ table: 'bad' }).rows).toHaveLength(3)
  })

  test('补矩形、单元格转字符串、表头默认 true', () => {
    const data = normalizeTableData({ rows: [['a'], [1, 2, 3]], header: false })
    expect(data.rows).toEqual([['a', '', ''], ['1', '2', '3']])
    expect(data.header).toBe(false)
    expect(data.headerAlign).toBe('left')
  })

  test('表头对齐归一化：合法枚举保留，其余回落 left', () => {
    const center = normalizeTableData({ rows: [['a']], headerAlign: 'center' })
    expect(center.headerAlign).toBe('center')
    expect(normalizeTableData({ rows: [['a']], headerAlign: 'right' }).headerAlign).toBe('right')
    expect(normalizeTableData({ rows: [['a']], headerAlign: 'justify' }).headerAlign).toBe('left')
    expect(normalizeTableData({ rows: [['a']], headerAlign: 42 }).headerAlign).toBe('left')
  })

  test('等价判定', () => {
    const a = createTableData()
    const b = createTableData()
    expect(isSameTableData(a, b)).toBe(true)
    b.rows[0]![0] = 'x'
    expect(isSameTableData(a, b)).toBe(false)
  })

  test('等价判定把逐格对齐计入', () => {
    const a = createTableData()
    const b = createTableData()
    b.aligns['1:1'] = 'center'
    expect(isSameTableData(a, b)).toBe(false)
  })
})

describe('table-model — 逐格对齐', () => {
  test('归一化：合法保留，非法值 / 坏键 / 越界坐标丢弃', () => {
    const data = normalizeTableData({
      rows: [['a', 'b'], ['c', 'd']],
      aligns: {
        '0:0': 'center',
        '1:1': 'right',
        '0:9': 'left', // 越界列
        '9:0': 'left', // 越界行
        'x:0': 'left', // 坏键
        '0:1': 'justify', // 非法枚举
        '1:0': 42, // 非法类型
      },
    })
    expect(data.aligns).toEqual({ '0:0': 'center', '1:1': 'right' })
  })

  test('缺省渲染值：逐格覆盖 > 表头缺省 > left', () => {
    const data: ReturnType<typeof createTableData> = {
      rows: [['h', 'h'], ['a', 'b']],
      header: true,
      headerAlign: 'right',
      aligns: { '1:0': 'center' },
      merges: [],
    }
    expect(cellAlign(data, 0, 1)).toBe('right') // 表头缺省
    expect(cellAlign(data, 1, 0)).toBe('center') // 逐格覆盖
    expect(cellAlign(data, 1, 1)).toBe('left') // 表体缺省
    expect(cellAlign({ ...data, header: false }, 0, 1)).toBe('left') // 无表头则无表头缺省
  })

  test('删行/删列：被删的键消失，其后的键前移', () => {
    const aligns = { '0:0': 'center' as const, '1:1': 'right' as const, '2:2': 'left' as const }
    expect(removeRowFromAligns(aligns, 1)).toEqual({ '0:0': 'center', '1:2': 'left' })
    expect(removeColumnFromAligns(aligns, 0)).toEqual({ '1:0': 'right', '2:1': 'left' })
  })

  test('插行/插列：其后的键后移', () => {
    const aligns = { '0:0': 'center' as const, '1:2': 'right' as const }
    expect(addRowToAligns(aligns, 1)).toEqual({ '0:0': 'center', '2:2': 'right' })
    expect(addColumnToAligns(aligns, 0)).toEqual({ '0:1': 'center', '1:3': 'right' })
  })

  test('移动：整行/整列互换键', () => {
    const aligns = { '0:1': 'center' as const, '2:1': 'right' as const, '1:0': 'left' as const }
    expect(swapRowsInAligns(aligns, 0, 2)).toEqual({ '2:1': 'center', '0:1': 'right', '1:0': 'left' })
    expect(swapColumnsInAligns(aligns, 0, 1)).toEqual({ '0:0': 'center', '2:0': 'right', '1:1': 'left' })
  })
})

describe('table-model — 行列增删', () => {
  const base = () => [['h1', 'h2'], ['a', 'b']]

  test('插入行不修改原数组', () => {
    const rows = base()
    const next = addRow(rows, 1)
    expect(next).toHaveLength(3)
    expect(next[1]).toEqual(['', ''])
    expect(rows).toHaveLength(2)
  })

  test('删除行；仅剩一行时清空而非删除', () => {
    expect(removeRow(base(), 1)).toEqual([['h1', 'h2']])
    expect(removeRow([['a', 'b']], 0)).toEqual([['', '']])
  })

  test('插入/删除列', () => {
    expect(addColumn(base(), 1)).toEqual([['h1', '', 'h2'], ['a', '', 'b']])
    expect(removeColumn(base(), 1)).toEqual([['h1'], ['a']])
  })

  test('仅剩一列时清空而非删除', () => {
    expect(removeColumn([['a'], ['b']], 0)).toEqual([[''], ['']])
  })
})

describe('table-model — 序列化', () => {
  test('单元格内 tab / 换行替换为空格（TSV）', () => {
    expect(sanitizeCellText('a\tb\nc\r\nd')).toBe('a b c d')
    expect(serializeTableTsv({
      rows: [['A', 'B'], ['1\t2', '3\n4']],
      header: true,
      headerAlign: 'left',
      aligns: {},
      merges: [],
    })).toBe('A\tB\n1 2\t3 4')
  })

  test('GFM：有表头', () => {
    expect(serializeTableGfm({
      rows: [['A', 'B'], ['1', '2']],
      header: true,
      headerAlign: 'center',
      aligns: {},
      merges: [],
    })).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |')
  })

  test('GFM：无表头补空表头行 + 分隔行', () => {
    expect(serializeTableGfm({
      rows: [['1', '2']],
      header: false,
      headerAlign: 'left',
      aligns: {},
      merges: [],
    })).toBe('|  |  |\n| --- | --- |\n| 1 | 2 |')
  })

  test('GFM：竖线转义、tab 替换', () => {
    expect(serializeTableGfm({
      rows: [['a|b', 'c\td']],
      header: false,
      headerAlign: 'left',
      aligns: {},
      merges: [],
    })).toBe('|  |  |\n| --- | --- |\n| a\\|b | c d |')
  })
})

describe('table-model — 合并单元格', () => {
  const base = () => ({
    rows: [['h', 'h', 'h'], ['a', 'b', 'c'], ['d', 'e', 'f']],
    header: true,
    headerAlign: 'left' as const,
    aligns: {},
    merges: [],
  })

  test('归一化：越界裁剪 / 1×1 丢弃 / 倒序丢弃 / 非法值丢弃', () => {
    expect(normalizeMerges([{ row1: 0, col1: 0, row2: 9, col2: 9 }], 3, 3)).toEqual([
      { row1: 0, col1: 0, row2: 2, col2: 2 },
    ])
    expect(normalizeMerges([{ row1: 1, col1: 1, row2: 1, col2: 1 }], 3, 3)).toEqual([])
    expect(normalizeMerges([{ row1: 2, col1: 0, row2: 1, col2: 0 }], 3, 3)).toEqual([])
    expect(normalizeMerges([{ row1: 0, col1: 0, row2: 'x', col2: 1 }], 3, 3)).toEqual([])
    expect(normalizeMerges([null, 'x', 42], 3, 3)).toEqual([])
    expect(normalizeMerges(null, 3, 3)).toEqual([])
  })

  test('归一化：重叠的后者丢弃、结果按左上排序（JSON 比较才稳定）', () => {
    const out = normalizeMerges(
      [
        { row1: 1, col1: 0, row2: 1, col2: 1 },
        { row1: 1, col1: 1, row2: 2, col2: 2 },
        { row1: 0, col1: 2, row2: 2, col2: 2 },
      ],
      3,
      3,
    )
    expect(out).toEqual([
      { row1: 0, col1: 2, row2: 2, col2: 2 },
      { row1: 1, col1: 0, row2: 1, col2: 1 },
    ])
  })

  test('包含关系：左上格是锚点，其余被覆盖', () => {
    const merges = [{ row1: 1, col1: 0, row2: 2, col2: 1 }]
    expect(mergeRectAt(merges, 2, 1)).toEqual(merges[0])
    expect(mergeRectAt(merges, 0, 0)).toBeNull()
    expect(isCoveredCell(merges, 1, 0)).toBe(false)
    expect(isCoveredCell(merges, 1, 1)).toBe(true)
    expect(isMergeAnchor(merges, 1, 0)).toBe(true)
    expect(isMergeAnchor(merges, 2, 1)).toBe(false)
    expect(anchorFor(merges, 2, 1)).toEqual({ row: 1, col: 0 })
    expect(anchorFor(merges, 0, 2)).toEqual({ row: 0, col: 2 })
  })

  test('合并：区内内容按行优先拼进左上格，其余清空', () => {
    const data = base()
    const next = mergeRange(data, { row1: 1, col1: 0, row2: 2, col2: 1 })
    expect(next.merges).toEqual([{ row1: 1, col1: 0, row2: 2, col2: 1 }])
    expect(next.rows[1]).toEqual(['a b d e', '', 'c'])
    expect(next.rows[2]).toEqual(['', '', 'f'])
    // 纯函数：不改入参
    expect(data.rows[1]).toEqual(['a', 'b', 'c'])
  })

  test('合并取值：跳过空内容、两端 trim、单个空格连接', () => {
    expect(mergeCellTexts(['', '   ', 'x'])).toBe('x')
    expect(mergeCellTexts(['  a  ', '', 'b'])).toBe('a b')
    // 单行纯文本是前提：换行早在粘贴时就被替换成空格，这里只剩空格语义
    expect(mergeCellTexts(['a', 'b c'])).toBe('a b c')
    expect(mergeCellTexts([])).toBe('')
  })

  test('合并 1×1 等价于取消该格所在的合并', () => {
    const merged = mergeRange(base(), { row1: 1, col1: 0, row2: 2, col2: 1 })
    const unmerged = mergeRange(merged, { row1: 2, col1: 1, row2: 2, col2: 1 })
    expect(unmerged.merges).toEqual([])
  })

  test('合并区替换重叠的旧区', () => {
    const merged = mergeRange(base(), { row1: 1, col1: 0, row2: 1, col2: 1 })
    const next = mergeRange(merged, { row1: 1, col1: 1, row2: 2, col2: 2 })
    expect(next.merges).toEqual([{ row1: 1, col1: 1, row2: 2, col2: 2 }])
  })

  test('取消合并：只删相交的区，内容不动', () => {
    const merged = mergeRange(base(), { row1: 1, col1: 0, row2: 2, col2: 1 })
    const next = unmergeRange(merged, { row1: 2, col1: 1, row2: 2, col2: 1 })
    expect(next.merges).toEqual([])
    // 合并时已被拼进左上格，取消后仍只有这一份（不会凭空「复活」到各格）
    expect(next.rows[1]![0]).toBe('a b d e')
  })

  test('插入行：区内撑大，之前顺移，之后不动', () => {
    const merges = [{ row1: 1, col1: 0, row2: 2, col2: 1 }]
    expect(addRowToMerges(merges, 0)).toEqual([{ row1: 2, col1: 0, row2: 3, col2: 1 }])
    expect(addRowToMerges(merges, 2)).toEqual([{ row1: 1, col1: 0, row2: 3, col2: 1 }])
    expect(addRowToMerges(merges, 3)).toEqual([{ row1: 1, col1: 0, row2: 2, col2: 1 }])
  })

  test('删除行 / 列：撞到合并区直接拆开，其余顺移', () => {
    const merges = [{ row1: 1, col1: 0, row2: 1, col2: 1 }]
    expect(removeRowFromMerges(merges, 1)).toEqual([])
    expect(removeRowFromMerges(merges, 0)).toEqual([{ row1: 0, col1: 0, row2: 0, col2: 1 }])
    expect(removeColumnFromMerges(merges, 0)).toEqual([])
    expect(removeColumnFromMerges(merges, 2)).toEqual(merges)
  })

  test('移动行 / 列：涉及被移动行列的合并区拆开', () => {
    const merges = [{ row1: 1, col1: 0, row2: 1, col2: 1 }]
    expect(swapRowsInMerges(merges, 2, 3)).toEqual(merges)
    expect(swapRowsInMerges(merges, 1, 2)).toEqual([])
    expect(swapColumnsInMerges(merges, 0, 1)).toEqual([])
    expect(swapColumnsInMerges(merges, 2, 3)).toEqual(merges)
  })

  test('TSV / GFM 按合并展开：被覆盖格输出空', () => {
    const merged = mergeRange(base(), { row1: 1, col1: 0, row2: 2, col2: 1 })
    expect(serializeTableTsv(merged)).toBe('h\th\th\na b d e\t\tc\n\t\tf')
    expect(serializeTableGfm(merged).split('\n')[2]).toBe('| a b d e |  | c |')
  })

  test('等价判定把 merges 算进去', () => {
    const a = createTableData()
    const b = mergeRange(a, { row1: 1, col1: 1, row2: 2, col2: 2 })
    expect(isSameTableData(a, a)).toBe(true)
    expect(isSameTableData(a, b)).toBe(false)
  })
})
