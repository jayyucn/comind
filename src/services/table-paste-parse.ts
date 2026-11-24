/**
 * 外部表格解析（ADR-0061）
 *
 * 三条来源，统一产出 `TableData`：
 * - HTML `<table>`（网页 / Excel / Word / 渲染后的富文本剪贴板）
 * - GFM 管道表格（markdown 源码，必须有 `|---|` 分隔行）
 * - TSV（Excel / Sheets 的 text/plain 载荷）
 *
 * 口径（ADR-0061 D2/D4/D5/D7/D8/D10）：
 * - 有效列数（展平 colspan 后）< 2 → 返回 null，由调用方沿用旧展平路径
 *   （网页布局容器普遍是单列表格）
 * - 单元格取纯文本：链接 / 加粗 / 图片丢弃，`<br>` 拍成空格（单元格单行纯文本约束）
 * - 嵌套表格按行优先把内层单元格用空格拼成一行，填进外层对应格
 * - 表头严格按源：thead 或首行 `<th>` → `header=true`；TSV 无表头信息 → `false`
 * - GFM 分隔行的 `:---:` 与 HTML 的 text-align 都落到逐格 `aligns`
 *
 * 本模块保持纯函数，不触碰 store / DOM 全局状态。
 */
import type { BlockClipPayload } from '../types/block'
import type { MergeRect, TableAlign, TableData } from './table-model'
import {
  alignKey,
  normalizeTableData,
  sanitizeCellText,
  TABLE_FORMAT_KEY,
} from './table-model'

/** 整枝丢弃的标签（与 external-paste-parse 同口径，只取文本） */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE',
  'IFRAME', 'OBJECT', 'SVG',
])

const CELL_TAGS = new Set(['TD', 'TH'])

/** 嵌套表格递归深度上限（布局表可能套很多层，超过就退化成整段文本） */
const MAX_NEST_DEPTH = 4

/** rowspan/colspan 上限：坏数据（colspan=99999）会把网格撑爆 */
const MAX_SPAN = 1000

function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** 外部表格统一以 table 块载荷交付（叶子块：无 content、无子块） */
export function tablePayload(data: TableData): BlockClipPayload {
  return {
    content: '',
    type: 'table',
    format: { [TABLE_FORMAT_KEY]: data },
    properties: null,
    children: [],
  }
}

// ── HTML <table> ─────────────────────────────────────────────────

/** 只取本表的行：嵌套表格的 tr 不能算进来 */
function directRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll('tr')).filter(tr => tr.closest('table') === table)
}

function directCells(tr: Element): Element[] {
  return Array.from(tr.children).filter(el => CELL_TAGS.has(el.tagName))
}

function spanOf(el: Element, attr: 'rowspan' | 'colspan', max: number): number {
  const raw = Number(el.getAttribute(attr))
  if (!Number.isFinite(raw) || raw < 1) return 1
  return Math.min(Math.floor(raw), Math.max(1, Math.min(MAX_SPAN, max)))
}

/** 单元格对齐：inline style 优先，其次 align 属性；认不出返回 null（不写 aligns） */
function cellAlignOf(el: Element): TableAlign | null {
  const inline = (el as HTMLElement).style?.textAlign || ''
  const raw = (inline || el.getAttribute('align') || '').trim().toLowerCase()
  if (raw === 'center') return 'center'
  if (raw === 'right' || raw === 'end') return 'right'
  if (raw === 'left' || raw === 'start') return 'left'
  return null
}

/** 行内文本收集：<br> 记一个空格，跳过 script/style/img 等 */
function inlineText(node: Node, depth: number): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  const tag = el.tagName
  if (SKIP_TAGS.has(tag) || tag === 'IMG') return ''
  if (tag === 'BR') return ' '
  if (tag === 'TABLE') return flattenTableText(el, depth - 1)
  let out = ''
  el.childNodes.forEach((child) => { out += inlineText(child, depth) })
  return out
}

/** 嵌套表格 → 行优先把单元格用空格拼成一行 */
function flattenTableText(table: Element, depth: number): string {
  if (depth <= 0) return collapseWs(table.textContent ?? '')
  return directRows(table)
    .map(tr => directCells(tr).map(cell => collapseWs(inlineText(cell, depth))).join(' '))
    .join(' ')
}

function cellTextOf(cell: Element): string {
  return sanitizeCellText(collapseWs(inlineText(cell, MAX_NEST_DEPTH)))
}

/**
 * HTML `<table>` → TableData。
 *
 * - 有效列数 < 2 → null（布局容器）
 * - thead 或首行含 `<th>` → header
 * - rowspan/colspan → merges（交给 normalizeTableData 校验裁剪）
 */
export function parseHtmlTableData(table: Element): TableData | null {
  const trs = directRows(table)
  if (trs.length === 0) return null

  const rows: string[][] = trs.map(() => [])
  const taken: Set<number>[] = trs.map(() => new Set<number>())
  const merges: MergeRect[] = []
  const aligns: Record<string, TableAlign> = {}
  let colCount = 0

  trs.forEach((tr, rowIndex) => {
    let col = 0
    for (const cell of directCells(tr)) {
      const rowTaken = taken[rowIndex]!
      while (rowTaken.has(col)) col++
      const rowspan = spanOf(cell, 'rowspan', trs.length - rowIndex)
      const colspan = spanOf(cell, 'colspan', MAX_SPAN)
      rows[rowIndex]![col] = cellTextOf(cell)
      for (let r = rowIndex; r < rowIndex + rowspan; r++) {
        const covered = taken[r]
        if (!covered) continue
        for (let c = col; c < col + colspan; c++) covered.add(c)
      }
      if (rowspan > 1 || colspan > 1) {
        merges.push({ row1: rowIndex, col1: col, row2: rowIndex + rowspan - 1, col2: col + colspan - 1 })
      }
      const align = cellAlignOf(cell)
      if (align) aligns[alignKey(rowIndex, col)] = align
      col += colspan
      colCount = Math.max(colCount, col)
    }
  })

  if (colCount < 2) return null

  const header =
    Array.from(table.children).some(child => child.tagName === 'THEAD')
    || directCells(trs[0]!).some(cell => cell.tagName === 'TH')

  const padded = rows.map(row => Array.from({ length: colCount }, (_, i) => row[i] ?? ''))
  return normalizeTableData({ rows: padded, header, headerAlign: 'left', aligns, merges })
}

// ── GFM 管道表格 ──────────────────────────────────────────────────

/** `| --- | :---: | ---: |` —— 必须含内部 `|`（≥2 列）且至少一个 `-` */
function isGfmSeparator(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false
  return /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?$/.test(trimmed)
}

/** 按未转义的 `|` 切行；`\|` 还原为字面竖线；去掉首尾管道符 */
function splitGfmRow(line: string): string[] {
  const trimmed = line.trim()
  const cells: string[] = []
  let current = ''
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|'
      i++
      continue
    }
    if (ch === '|') {
      cells.push(current)
      current = ''
      continue
    }
    current += ch
  }
  cells.push(current)
  if (trimmed.startsWith('|')) cells.shift()
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) cells.pop()
  return cells.map(cell => sanitizeCellText(collapseWs(cell)))
}

function gfmAlignOf(separatorCell: string): TableAlign {
  const left = separatorCell.startsWith(':')
  const right = separatorCell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  return 'left'
}

/**
 * 从 `start` 行开始读一张 GFM 表格。
 * 命中返回数据与消耗行数，否则返回 null（调用方按普通行处理）。
 */
export function parseGfmTable(
  lines: readonly string[],
  start: number,
): { data: TableData; consumed: number } | null {
  const headerLine = lines[start]
  const separatorLine = lines[start + 1]
  if (headerLine === undefined || separatorLine === undefined) return null
  if (!headerLine.includes('|')) return null
  if (!isGfmSeparator(separatorLine)) return null

  const headerCells = splitGfmRow(headerLine)
  if (headerCells.length < 2) return null
  const colCount = headerCells.length
  const separatorCells = splitGfmRow(separatorLine)

  const body: string[][] = []
  let index = start + 2
  while (index < lines.length) {
    const line = lines[index]!
    if (!line.trim() || !line.includes('|')) break
    body.push(splitGfmRow(line))
    index++
  }

  const pad = (cells: string[]) =>
    Array.from({ length: colCount }, (_, col) => cells[col] ?? '')
  const rows = [pad(headerCells), ...body.map(pad)]

  // 对齐是列级语义，展成逐格覆盖；left 是缺省值，不必落库
  const aligns: Record<string, TableAlign> = {}
  separatorCells.slice(0, colCount).forEach((cell, col) => {
    const align = gfmAlignOf(cell)
    if (align === 'left') return
    for (let row = 0; row < rows.length; row++) aligns[alignKey(row, col)] = align
  })

  return {
    data: normalizeTableData({ rows, header: true, headerAlign: 'left', aligns, merges: [] }),
    consumed: index - start,
  }
}

// ── TSV ──────────────────────────────────────────────────────────

/**
 * TSV 切分：`\t` 分格，`\n` 分行，双引号包裹的单元格可含制表符与换行
 * （Excel 复制含内嵌换行的单元格时会加引号，`""` 表示字面引号）。
 */
function parseTsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && field === '') {
      quoted = true
      i++
      continue
    }
    if (ch === '\t') {
      row.push(field)
      field = ''
      i++
      continue
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
      i++
      continue
    }
    field += ch
    i++
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/**
 * TSV → TableData。
 *
 * 段边界规则（ADR-0061 D6）：「整段所有行都 ≥2 列且列数完全一致」才成表；
 * 任意一行列数不同即整段放弃（避免把「标题 + 表格」误切两半）。
 */
export function parseTsvTable(text: string): TableData | null {
  if (!text.includes('\t')) return null

  const rows = parseTsvRows(text).map(row =>
    row.map(cell => sanitizeCellText(cell.trim())),
  )
  // 尾部空行（复制常带结尾换行）不算行，但中间空行会破坏列数一致 → 整段放弃
  while (rows.length > 0 && rows[rows.length - 1]!.every(cell => cell === '')) rows.pop()

  if (rows.length < 2) return null
  const colCount = rows[0]!.length
  if (colCount < 2) return null
  if (rows.some(row => row.length !== colCount)) return null

  return normalizeTableData({ rows, header: false, headerAlign: 'left', aligns: {}, merges: [] })
}
