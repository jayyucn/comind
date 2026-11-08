/**
 * 表格格选区（cell range）纯计算。
 *
 * 表格在跨块文本流里不是可切分的文本：单元格内容存在 `format.table`，块 `content` 为空。
 * 因此格选区不能复用文本选区的字符偏移模型，必须有自己的一套「矩形区间」语义：
 * 起点格与当前格张成的矩形，行列都包含两端。
 *
 * 本模块保持纯函数（不碰 DOM、不碰 store），供拖拽手势、复制与删除共用。
 */

import { alignKey, isCoveredCell, type TableAlign, type TableData } from './table-model'

/** 单元格坐标（0 基，行优先，与 `td[data-row]` / `td[data-col]` 同源） */
export interface CellRef {
  row: number
  col: number
}

/** 归一化后的矩形：row1 ≤ row2、col1 ≤ col2，四边均包含 */
export interface CellRange {
  row1: number
  col1: number
  row2: number
  col2: number
}

/** 两个格坐标张成的矩形。反向拖拽（先右下后左上）自动归一，调用方不必判序 */
export function normalizeCellRange(a: CellRef, b: CellRef): CellRange {
  return {
    row1: Math.min(a.row, b.row),
    col1: Math.min(a.col, b.col),
    row2: Math.max(a.row, b.row),
    col2: Math.max(a.col, b.col),
  }
}

/** 矩形是否落在真实行列范围内（越界坐标来自失效的 DOM 缓存，不能直接拿来切数据） */
export function isWithinTable(data: TableData, range: CellRange): boolean {
  const rows = data.rows.length
  const cols = data.rows[0]?.length ?? 0
  return rows > 0 && cols > 0
    && range.row1 >= 0 && range.col1 >= 0
    && range.row2 < rows && range.col2 < cols
}

/**
 * 矩形 → TSV（行内 Tab、行间换行，Excel / 表格软件可直接粘贴）。
 * 单元格文本由写入侧保证不含 Tab/换行（`sanitizeCellText`），这里不再二次清洗。
 */
export function cellRangeToTsv(data: TableData, range: CellRange): string {
  return cellRangeToMatrix(data, range).map(cells => cells.join('\t')).join('\n')
}

/** 矩形内是否已有内容（全空时删除键不写库，避免制造一条无变更的保存） */
export function cellRangeHasContent(data: TableData, range: CellRange): boolean {
  for (let row = range.row1; row <= range.row2; row++) {
    const cells = data.rows[row]
    if (!cells) continue
    for (let col = range.col1; col <= range.col2; col++) {
      if (isCoveredCell(data.merges, row, col)) continue
      if ((cells[col] ?? '').length > 0) return true
    }
  }
  return false
}

/** 清空矩形内单元格内容；表结构（行列数、表头标记）保持不变 */
export function clearCellRange(data: TableData, range: CellRange): TableData {
  return {
    ...data,
    rows: data.rows.map((cells, row) => {
      if (row < range.row1 || row > range.row2) return cells
      return cells.map((cell, col) => (col >= range.col1 && col <= range.col2 ? '' : cell))
    }),
  }
}

/**
 * 矩形 → 二维文本矩阵（内部剪贴板用）。
 * 与 `cellRangeToTsv` 的区别：保留行/列结构，粘贴时才能按左上角对齐回写。
 */
export function cellRangeToMatrix(data: TableData, range: CellRange): string[][] {
  const matrix: string[][] = []
  for (let row = range.row1; row <= range.row2; row++) {
    const cells = data.rows[row]
    if (!cells) continue
    const picked: string[] = []
    for (let col = range.col1; col <= range.col2; col++) {
      // 被合并覆盖的格没有独立内容：复制出来是空串（与 TSV / Excel 一致）
      picked.push(isCoveredCell(data.merges, row, col) ? '' : (cells[col] ?? ''))
    }
    matrix.push(picked)
  }
  return matrix
}

/**
 * 用文本矩阵覆盖矩形（左上角对齐，**不改变行列数**）。
 * - 矩阵超出矩形的部分忽略：一次误粘贴不该把表撑大
 * - 矩阵不足的地方保留原值：不该把没覆盖到的格清空
 */
export function writeRangeIntoData(data: TableData, range: CellRange, matrix: string[][]): TableData {
  if (matrix.length === 0) return data
  return {
    ...data,
    rows: data.rows.map((cells, row) => {
      if (row < range.row1 || row > range.row2) return cells
      const source = matrix[row - range.row1]
      if (!source) return cells
      return cells.map((cell, col) => {
        if (col < range.col1 || col > range.col2) return cell
        // 合并区里被覆盖的格不接收粘贴内容：写进去也看不见，取消合并后会莫名冒出来
        if (isCoveredCell(data.merges, row, col)) return cell
        const next = source[col - range.col1]
        return next === undefined ? cell : next
      })
    }),
  }
}

/**
 * 给矩形内每一格写入显式对齐（逐格覆盖）。
 * 不做「等于缺省值就删键」的稀疏优化：点「左对齐」就该是左对齐，
 * 否则在 headerAlign=center 的表头上点左对齐会被回退成 center。
 */
export function applyAlignToRange(data: TableData, range: CellRange, align: TableAlign): TableData {
  const aligns = { ...data.aligns }
  for (let row = range.row1; row <= range.row2; row++) {
    for (let col = range.col1; col <= range.col2; col++) {
      // 对齐作用于可见格：被合并覆盖的格由所属合并区的左上角统一表现
      if (isCoveredCell(data.merges, row, col)) continue
      aligns[alignKey(row, col)] = align
    }
  }
  return { ...data, aligns }
}
