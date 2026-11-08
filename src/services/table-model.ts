/**
 * 表格块数据模型（P0）
 *
 * 表格数据随 Block.format 持久化，键为 `table`：
 * `{ table: { rows, header, headerAlign, aligns?, merges? } }`
 * - 叶子块：不携带子块；单元格只允许单行纯文本
 * - 至少 1 行 1 列；表头绑定首行
 * - `aligns` 是**逐格**对齐覆盖（稀疏，只存被显式设置过的格）：
 *   缺省回退 `headerAlign`（表头行）/ `left`（表体行）。`headerAlign` 保留为旧数据与
 *   表头缺省值，逐格覆盖优先。行列增删移动必须同步重映射键（见 `*FromAligns`）。
 * - `merges` 是**合并区**列表（闭区间矩形），内容只认左上角那一格。
 *   被覆盖的格在渲染时**没有 DOM**（`td[data-row][data-col]` 查不到），
 *   因此所有「按坐标找格」的路径必须先过 `anchorFor`。行列增删移动见 `*ToMerges`。
 *
 * 本模块保持纯函数，供编辑组件、剪贴板与 Markdown 导出共用。
 */

/** 合并区（闭区间，四边均包含；与 `CellRange` 结构相同）。1×1 不算合并 */
export interface MergeRect {
  row1: number
  col1: number
  row2: number
  col2: number
}

export interface TableData {
  rows: string[][]
  header: boolean
  /** 表头文本对齐方式（仅表头行，作为逐格对齐的缺省值） */
  headerAlign: TableHeaderAlign
  /** 逐格对齐覆盖，键 `"row:col"` */
  aligns: Record<string, TableAlign>
  /** 合并区列表（有序：按 左上→右下 排序，保证 JSON 比较稳定） */
  merges: MergeRect[]
}

export type TableHeaderAlign = 'left' | 'center' | 'right'

export type TableAlign = TableHeaderAlign

const ALIGN_SET: readonly string[] = ['left', 'center', 'right']
/** 键形如 `"1:2"`；行列上限按表格实际尺寸另行校验 */
const ALIGN_KEY = /^(\d{1,5}):(\d{1,5})$/

export const TABLE_FORMAT_KEY = 'table'
export const DEFAULT_TABLE_ROWS = 3
export const DEFAULT_TABLE_COLS = 3

/** 单元格文本归一化：tab / 换行一律替换为空格（单行纯文本约束） */
export function sanitizeCellText(text: string): string {
  return text.replace(/[\t\r\n]+/g, ' ')
}

/** 新建表格：默认 3×3，首行为表头 */
export function createTableData(rowCount = DEFAULT_TABLE_ROWS, colCount = DEFAULT_TABLE_COLS): TableData {
  return {
    rows: Array.from({ length: Math.max(1, rowCount) }, () =>
      Array.from({ length: Math.max(1, colCount) }, () => ''),
    ),
    header: true,
    headerAlign: 'left',
    aligns: {},
    merges: [],
  }
}

/** 从任意 format 值中读取并归一化表格数据；缺失/损坏 → 默认表格 */
export function readTableData(format: Record<string, unknown> | null | undefined): TableData {
  return normalizeTableData(format?.[TABLE_FORMAT_KEY])
}

/** 归一化表格数据：补矩形、至少 1×1、单元格转字符串、表头布尔、对齐枚举与逐格覆盖 */
export function normalizeTableData(value: unknown): TableData {
  if (!value || typeof value !== 'object') return createTableData()
  const candidate = value as {
    rows?: unknown
    header?: unknown
    headerAlign?: unknown
    aligns?: unknown
    merges?: unknown
  }
  if (!Array.isArray(candidate.rows) || candidate.rows.length === 0) return createTableData()

  const rawRows = candidate.rows.filter(Array.isArray) as unknown[][]
  if (rawRows.length === 0) return createTableData()

  const colCount = Math.max(1, ...rawRows.map(row => row.length))
  const rows = rawRows.map(row =>
    Array.from({ length: colCount }, (_, i) => String(row[i] ?? '')),
  )
  return {
    rows,
    header: candidate.header !== false,
    headerAlign:
      candidate.headerAlign === 'center' || candidate.headerAlign === 'right'
        ? candidate.headerAlign
        : 'left',
    aligns: normalizeAligns(candidate.aligns, rows.length, colCount),
    merges: normalizeMerges(candidate.merges, rows.length, colCount),
  }
}

/**
 * 逐格对齐归一化：丢弃非法值、非 `r:c` 键、越界坐标。
 * 越界 key 来自失效的历史数据（删行删列后残留），留着会让重映射一路错下去。
 */
function normalizeAligns(value: unknown, rowCount: number, colCount: number): Record<string, TableAlign> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, TableAlign> = {}
  for (const [key, align] of Object.entries(value as Record<string, unknown>)) {
    const matched = ALIGN_KEY.exec(key)
    if (!matched) continue
    if (typeof align !== 'string' || !ALIGN_SET.includes(align)) continue
    const row = Number(matched[1])
    const col = Number(matched[2])
    if (row >= rowCount || col >= colCount) continue
    out[alignKey(row, col)] = align as TableAlign
  }
  return out
}

/** 逐格对齐的键编码：唯一来源，其它模块不得自行拼 `"r:c"` */
export function alignKey(row: number, col: number): string {
  return `${row}:${col}`
}

// ── 合并区（merges）────────────────────────────────────────────────

/** 两个合并区是否相交（含边界接触） */
function rectsOverlap(a: MergeRect, b: MergeRect): boolean {
  return a.row1 <= b.row2 && b.row1 <= a.row2 && a.col1 <= b.col2 && b.col1 <= a.col2
}

/** 稳定排序：`isSameTableData` 用 JSON 比较，顺序不同会被误判为「有变更」 */
function compareMergeRects(a: MergeRect, b: MergeRect): number {
  return a.row1 - b.row1 || a.col1 - b.col1 || a.row2 - b.row2 || a.col2 - b.col2
}

/**
 * 合并区归一化。丢弃：非整数 / 负数 / 倒序 / 完全越界 / 1×1；
 * 越界部分裁进表格（旧数据删行删列后残留的坐标）；
 * 与前序区**重叠**的整块丢弃（重叠在表格语义里非法，先到者胜，顺序稳定）。
 */
export function normalizeMerges(value: unknown, rowCount: number, colCount: number): MergeRect[] {
  if (!Array.isArray(value)) return []
  const out: MergeRect[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const rect = raw as Partial<Record<keyof MergeRect, unknown>>
    const nums = [rect.row1, rect.col1, rect.row2, rect.col2]
    if (!nums.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0)) continue
    const [row1, col1, row2, col2] = nums as number[]
    if (row1! > row2! || col1! > col2!) continue
    if (row1! >= rowCount || col1! >= colCount) continue
    const merged: MergeRect = {
      row1: row1!,
      col1: col1!,
      row2: Math.min(row2!, rowCount - 1),
      col2: Math.min(col2!, colCount - 1),
    }
    if (merged.row1 === merged.row2 && merged.col1 === merged.col2) continue
    if (out.some(other => rectsOverlap(other, merged))) continue
    out.push(merged)
  }
  return out.sort(compareMergeRects)
}

/** 包含该格的合并区（不含左上角也算），没有则 null */
export function mergeRectAt(merges: readonly MergeRect[], row: number, col: number): MergeRect | null {
  for (const rect of merges) {
    if (row >= rect.row1 && row <= rect.row2 && col >= rect.col1 && col <= rect.col2) return rect
  }
  return null
}

/** 该格是否被合并覆盖（不是它所属合并区的左上角） */
export function isCoveredCell(merges: readonly MergeRect[], row: number, col: number): boolean {
  const rect = mergeRectAt(merges, row, col)
  return !!rect && !(rect.row1 === row && rect.col1 === col)
}

/** 该格是否是某合并区的左上角（真正持有 rowspan/colspan 与内容的那一格） */
export function isMergeAnchor(merges: readonly MergeRect[], row: number, col: number): boolean {
  return merges.some(rect => rect.row1 === row && rect.col1 === col)
}

/**
 * 坐标归一：被合并覆盖的格回落到其合并区左上角，否则原样返回。
 *
 * 被覆盖格**没有 DOM**，`td[data-row][data-col]` 与 `textarea[data-row][data-col]`
 * 都查不到。凡是「按坐标找格」的路径（聚焦、菜单锚点、选区盒测量）必须先过这里。
 */
export function anchorFor(
  merges: readonly MergeRect[],
  row: number,
  col: number,
): { row: number; col: number } {
  const rect = mergeRectAt(merges, row, col)
  return rect ? { row: rect.row1, col: rect.col1 } : { row, col }
}

/** 某格实际生效的对齐：逐格覆盖优先，其次表头缺省，最后 left */
export function cellAlign(data: TableData, row: number, col: number): TableAlign {
  return data.aligns[alignKey(row, col)] ?? (data.header && row === 0 ? data.headerAlign : 'left')
}

/** 数据等价判定（用于忽略自身写入引发的回环） */
export function isSameTableData(a: TableData, b: TableData): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 在 index 处插入空行（index 可等于行数 = 追加） */
export function addRow(rows: string[][], index: number): string[][] {
  const colCount = Math.max(1, rows[0]?.length ?? 1)
  const next = rows.map(row => [...row])
  const at = Math.min(Math.max(0, index), next.length)
  next.splice(at, 0, Array.from({ length: colCount }, () => ''))
  return next
}

/** 删除行；仅剩一行时改为清空该行（表格至少 1 行） */
export function removeRow(rows: string[][], index: number): string[][] {
  const next = rows.map(row => [...row])
  if (next.length <= 1) {
    return next.map(row => row.map(() => ''))
  }
  next.splice(Math.min(Math.max(0, index), next.length - 1), 1)
  return next
}

/** 在 index 处插入空列 */
export function addColumn(rows: string[][], index: number): string[][] {
  return rows.map(row => {
    const next = [...row]
    const at = Math.min(Math.max(0, index), next.length)
    next.splice(at, 0, '')
    return next
  })
}

/** 删除列；仅剩一列时改为清空该列（表格至少 1 列） */
export function removeColumn(rows: string[][], index: number): string[][] {
  const colCount = rows[0]?.length ?? 0
  if (colCount <= 1) {
    return rows.map(row => row.map(() => ''))
  }
  const at = Math.min(Math.max(0, index), colCount - 1)
  return rows.map(row => row.filter((_, i) => i !== at))
}

// ── 逐格对齐的坐标重映射 ────────────────────────────────────────────
// aligns 的键是 `"row:col"` 字符串，行列一变就会指到别的格上，所以每个结构操作
// 都必须配一次重映射。这些函数只搬键，不判「表格是否可以删」（那是 removeRow /
// removeColumn 的事）——调用方在同一分支里一并调用，避免出现「数据删了、对齐没删」。

type AxisMap = (index: number) => number | null

const identity: AxisMap = index => index

function remapAligns(
  aligns: Record<string, TableAlign>,
  rowMap: AxisMap,
  colMap: AxisMap,
): Record<string, TableAlign> {
  const out: Record<string, TableAlign> = {}
  for (const [key, align] of Object.entries(aligns)) {
    const [row, col] = key.split(':').map(Number)
    const nextRow = rowMap(row!)
    if (nextRow === null) continue
    const nextCol = colMap(col!)
    if (nextCol === null) continue
    out[alignKey(nextRow, nextCol)] = align
  }
  return out
}

export function removeRowFromAligns(aligns: Record<string, TableAlign>, index: number) {
  return remapAligns(aligns, i => (i === index ? null : i > index ? i - 1 : i), identity)
}

export function addRowToAligns(aligns: Record<string, TableAlign>, index: number) {
  return remapAligns(aligns, i => (i >= index ? i + 1 : i), identity)
}

export function removeColumnFromAligns(aligns: Record<string, TableAlign>, index: number) {
  return remapAligns(aligns, identity, i => (i === index ? null : i > index ? i - 1 : i))
}

export function addColumnToAligns(aligns: Record<string, TableAlign>, index: number) {
  return remapAligns(aligns, identity, i => (i >= index ? i + 1 : i))
}

export function swapRowsInAligns(aligns: Record<string, TableAlign>, a: number, b: number) {
  return remapAligns(aligns, i => (i === a ? b : i === b ? a : i), identity)
}

export function swapColumnsInAligns(aligns: Record<string, TableAlign>, a: number, b: number) {
  return remapAligns(aligns, identity, i => (i === a ? b : i === b ? a : i))
}

// ── 合并 / 取消合并 ─────────────────────────────────────────────────

function orderedRect(range: MergeRect): MergeRect {
  return {
    row1: Math.min(range.row1, range.row2),
    col1: Math.min(range.col1, range.col2),
    row2: Math.max(range.row1, range.row2),
    col2: Math.max(range.col1, range.col2),
  }
}

/**
 * 合并取值：区内各格按**行优先**顺序取非空内容，用单个空格拼成一行。
 *
 * 单元格是单行纯文本（粘贴时换行已被替换为空格），所以拼接也用空格。
 * 关键在于**不能静默丢内容**：合并后取消合并，留在左上格里的文字是唯一副本。
 */
export function mergeCellTexts(cells: readonly string[]): string {
  return cells
    .map(text => text.trim())
    .filter(Boolean)
    .join(' ')
}

/**
 * 合并矩形：区内内容拼进左上角，其余格清空（文字已搬走，不是丢失）；
 * 与之重叠的旧合并区被替换。1×1 等价于取消该格所在的合并（不是「合并一个格」）。
 */
export function mergeRange(data: TableData, range: MergeRect): TableData {
  const rect = orderedRect(range)
  const rest = data.merges.filter(other => !rectsOverlap(other, rect))
  if (rect.row1 === rect.row2 && rect.col1 === rect.col2) return { ...data, merges: rest }
  const texts: string[] = []
  for (let row = rect.row1; row <= rect.row2; row++) {
    const cells = data.rows[row]
    if (!cells) continue
    for (let col = rect.col1; col <= rect.col2; col++) texts.push(cells[col] ?? '')
  }
  const merged = mergeCellTexts(texts)
  const rows = data.rows.map((cells, row) => {
    if (row < rect.row1 || row > rect.row2) return cells
    return cells.map((cell, col) => {
      if (col < rect.col1 || col > rect.col2) return cell
      return row === rect.row1 && col === rect.col1 ? merged : ''
    })
  })
  return { ...data, rows, merges: [...rest, rect].sort(compareMergeRects) }
}

/** 取消合并：删掉所有与矩形相交的合并区。内容留在左上格，不丢 */
export function unmergeRange(data: TableData, range: MergeRect): TableData {
  const rect = orderedRect(range)
  return { ...data, merges: data.merges.filter(other => !rectsOverlap(other, rect)) }
}

// ── 合并区的结构重映射 ──────────────────────────────────────────────
// 与 `*FromAligns` 同批调用。口径：
// - 插入：落在合并区之前整体顺移；落在区内则**撑大**（新行/列归并进去）
// - 删除 / 移动：撞到合并区**直接拆开** —— 禁止会让人删不掉行

export function addRowToMerges(merges: readonly MergeRect[], index: number): MergeRect[] {
  return merges
    .map((rect) => {
      if (index <= rect.row1) return { ...rect, row1: rect.row1 + 1, row2: rect.row2 + 1 }
      if (index > rect.row2) return { ...rect }
      return { ...rect, row2: rect.row2 + 1 }
    })
    .sort(compareMergeRects)
}

export function removeRowFromMerges(merges: readonly MergeRect[], index: number): MergeRect[] {
  const out: MergeRect[] = []
  for (const rect of merges) {
    if (index >= rect.row1 && index <= rect.row2) continue
    out.push(rect.row1 > index ? { ...rect, row1: rect.row1 - 1, row2: rect.row2 - 1 } : { ...rect })
  }
  return out
}

export function addColumnToMerges(merges: readonly MergeRect[], index: number): MergeRect[] {
  return merges
    .map((rect) => {
      if (index <= rect.col1) return { ...rect, col1: rect.col1 + 1, col2: rect.col2 + 1 }
      if (index > rect.col2) return { ...rect }
      return { ...rect, col2: rect.col2 + 1 }
    })
    .sort(compareMergeRects)
}

export function removeColumnFromMerges(merges: readonly MergeRect[], index: number): MergeRect[] {
  const out: MergeRect[] = []
  for (const rect of merges) {
    if (index >= rect.col1 && index <= rect.col2) continue
    out.push(rect.col1 > index ? { ...rect, col1: rect.col1 - 1, col2: rect.col2 - 1 } : { ...rect })
  }
  return out
}

/** 移动行：涉及被移动行的合并区直接拆开（跨行的合并区无法「跟着某一行走」） */
export function swapRowsInMerges(merges: readonly MergeRect[], a: number, b: number): MergeRect[] {
  return merges.filter(rect => !inRows(rect, a) && !inRows(rect, b))
}

export function swapColumnsInMerges(merges: readonly MergeRect[], a: number, b: number): MergeRect[] {
  return merges.filter(rect => !inCols(rect, a) && !inCols(rect, b))
}

function inRows(rect: MergeRect, index: number): boolean {
  return index >= rect.row1 && index <= rect.row2
}

function inCols(rect: MergeRect, index: number): boolean {
  return index >= rect.col1 && index <= rect.col2
}

/** 表格 → TSV（复制到外部；单元格内 tab/换行已替换为空格）。
 *  被合并覆盖的格没有独立内容，输出空串（左上格出值），与 Excel 一致。 */
export function serializeTableTsv(data: TableData): string {
  return data.rows
    .map((row, rowIndex) =>
      row
        .map((cell, colIndex) => (isCoveredCell(data.merges, rowIndex, colIndex) ? '' : sanitizeCellText(cell)))
        .join('\t'),
    )
    .join('\n')
}

/**
 * 表格 → GFM（Markdown 导出用）
 * - `|` 转义为 `\|`；tab / 换行替换为空格
 * - 无表头时补一行空表头 + 分隔行
 */
export function serializeTableGfm(data: TableData): string {
  const rows = data.rows.map((row, rowIndex) =>
    row.map((cell, colIndex) =>
      (isCoveredCell(data.merges, rowIndex, colIndex) ? '' : sanitizeCellText(cell)).replace(/\|/g, '\\|'),
    ),
  )
  const colCount = Math.max(1, rows[0]?.length ?? 1)
  const headerRow = data.header
    ? rows[0] ?? Array.from({ length: colCount }, () => '')
    : Array.from({ length: colCount }, () => '')
  const bodyRows = data.header ? rows.slice(1) : rows

  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  const separator = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`
  return [line(headerRow), separator, ...bodyRows.map(line)].join('\n')
}
