<script setup lang="ts">
/**
 * 表格块（P0）
 *
 * - 编辑态与只读态共用同一个组件：readonly 时渲染带格式的纯文本网格，编辑态渲染 contenteditable 单元格
 * - 数据来自 Block.format.table；单元格文本与行内格式（`cellMarks`）经 500ms 防抖写回 store
 * - 键盘导航（Enter/Tab/Shift+Tab/方向键/Esc）在单元格内拦截；IME 组合期间不触发
 * - Ctrl+Z / Ctrl+Y 路由到页面唯一撤销栈，禁用原生撤销
 * - 格内文本选区与格/行/列范围共用**同一个选区浮层**（`range-menu`），
 *   公共项（对齐 + B/I/U/S/A）恒在，结构项按选区类型增减
 */
import type { Editor } from '@tiptap/core'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardPaste,
  Copy,
  Eraser,
  Merge,
  Plus,
  Scissors,
  TableCellsMerge,
  TableCellsSplit,
  TableProperties,
  Trash2,
} from 'lucide-vue-next'
import { computed, h, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useBlockEntryMenuExtra } from '../../../../composables/useBlockEntryMenuExtra'
import type { CrossBlockSelection } from '../../../../composables/useCrossBlockSelection'
import { runUndoOrRedo } from '../../../../composables/useUndoRestore'
import { writePlainTextToClipboard } from '../../../../services/block-clipboard'
import type { SelectionRect } from '../../../../services/selection-geometry'
import {
  applyAlignToRange,
  type CellRange,
  cellRangeHasContent,
  cellRangeToMatrix,
  cellRangeToTsv,
  type CellRef,
  clearCellRange,
  isWithinTable,
  normalizeCellRange,
  writeRangeIntoData,
} from '../../../../services/table-cell-range'
import { getTableClipboard, hasTableClipboard, setTableClipboard } from '../../../../services/table-clipboard'
import {
  addColumn,
  addColumnToAligns,
  addColumnToCellMarks,
  addColumnToMerges,
  addRow,
  addRowToAligns,
  addRowToCellMarks,
  addRowToMerges,
  anchorFor,
  cellAlign,
  isSameTableData,
  mergeRange,
  type MergeRect,
  mergeRectAt,
  readTableData,
  removeColumn,
  removeColumnFromAligns,
  removeColumnFromCellMarks,
  removeColumnFromMerges,
  removeRow,
  removeRowFromAligns,
  removeRowFromCellMarks,
  removeRowFromMerges,
  sanitizeCellText,
  swapColumnsInAligns,
  swapColumnsInCellMarks,
  swapColumnsInMerges,
  swapRowsInAligns,
  swapRowsInCellMarks,
  swapRowsInMerges,
  type TableAlign,
  type TableData,
  type TableHeaderAlign,
  unmergeRange,
} from '../../../../services/table-model'
import { useBlockStore } from '../../../../stores/blocks'
import { useEditorStore } from '../../../../stores/editor'
import {
  clearInlineMarkRange,
  type InlineMarkAttrs,
  type InlineMarkKey,
  type InlineMarkRange,
  inlineMarksToHtml,
  normalizeInlineMarks,
  rangeColorToken,
  rangeHasAttr,
  sameInlineMarks,
  setInlineMarkRange,
} from '../../../../utils/inline-marks'
import BasePopover from '../../../common/BasePopover.vue'
import FloatingSubmenu from '../../../common/FloatingSubmenu.vue'
import SelectionMarkRow from '../../../common/SelectionMarkRow.vue'
import InlineAlignMenu from '../../../InlineAlignMenu.vue'
import InlineColorPalette from '../../../InlineColorPalette.vue'
import BlockMenuCommon from '../../components/BlockMenuCommon.vue'
import TableEntryMenuItems from './TableEntryMenuItems.vue'

const props = defineProps<{
  blockId?: string
  content: string
  blockFormat?: Record<string, unknown>
  readonly?: boolean
  showPlaceholder?: boolean
  /** 脱离 Block 外壳使用时（Ideas 快照）自带入口按钮；外壳内由 .block-bullet 统一渲染 */
  standaloneEntry?: boolean
}>()

const emit = defineEmits<{
  (e: 'content-click', event: MouseEvent): void
}>()

const blockStore = useBlockStore()
const editorStore = useEditorStore()
/** 入口菜单的类型专属项：外壳按 blockId 取用（见文件内 `entryMenuExtra`） */
const { register: registerEntryMenuExtra, unregister: unregisterEntryMenuExtra } = useBlockEntryMenuExtra()

const initial = readTableData(props.blockFormat)
const rows = ref<string[][]>(initial.rows)
const header = ref(initial.header)
const headerAlign = ref<TableHeaderAlign>(initial.headerAlign)
/** 逐格对齐覆盖（稀疏）；缺省回退 headerAlign（表头行）/ left（表体行） */
const aligns = ref<Record<string, TableAlign>>(initial.aligns)
/** 合并区：区内内容合并后拼进左上格，被覆盖的格不渲染（没有 DOM） */
const merges = ref<MergeRect[]>(initial.merges)
/** 逐格行内格式（稀疏）：键 `"row:col"`，只存有格式的格 */
const cellMarks = ref<Record<string, InlineMarkRange[]>>(initial.cellMarks ?? {})
/** 格内文本选区（驱动 detached 模式的行内格式工具条） */
const cellTextSel = ref<{
  row: number
  col: number
  start: number
  end: number
  rect: SelectionRect
  format: InlineMarkAttrs
} | null>(null)
const activeCell = ref<{ row: number; col: number } | null>(null)
const composing = ref(false)
const rootEl = ref<HTMLElement | null>(null)

const cellEls = new Map<string, HTMLElement>()
let saveTimer: number | undefined
let dirty = false
// 结构变更会重建单元格 DOM，期间产生的 blur 不应清掉操作条
let restoringFocus = false

const cols = computed(() => rows.value[0]?.length ?? 0)
const bodyStart = computed(() => (header.value ? 1 : 0))
/** 渲染用的一格：被合并覆盖的格不出现，左上格带 rowspan/colspan */
interface RenderedCell {
  col: number
  text: string
  rowspan: number
  colspan: number
}

/**
 * 某行的可渲染格。合并区里只有左上角那一格进 DOM，其余整格跳过——
 * 这正是「被覆盖格没有 DOM」的来源，所有按坐标找 DOM 的路径都得先过 `anchorFor`。
 */
function renderedRow(rowIndex: number): RenderedCell[] {
  const row = rows.value[rowIndex]
  if (!row) return []
  const out: RenderedCell[] = []
  for (let col = 0; col < row.length; col++) {
    const rect = mergeRectAt(merges.value, rowIndex, col)
    if (!rect) {
      out.push({ col, text: row[col] ?? '', rowspan: 1, colspan: 1 })
      continue
    }
    if (rect.row1 !== rowIndex || rect.col1 !== col) continue
    out.push({
      col,
      text: row[col] ?? '',
      rowspan: rect.row2 - rect.row1 + 1,
      colspan: rect.col2 - rect.col1 + 1,
    })
  }
  return out
}

/** 表体行下标（表头行在 thead 里单独渲染） */
const bodyRowIndexes = computed(() =>
  Array.from({ length: Math.max(0, rows.value.length - bodyStart.value) }, (_, i) => bodyStart.value + i),
)
const tableMinWidth = computed(() => `${Math.max(1, cols.value) * 120}px`)
/** standalone 入口按钮：锚点给 BasePopover 定位悬浮菜单 */
const entryEl = ref<HTMLButtonElement | null>(null)
/**
 * standalone 菜单（Ideas 快照等**脱离 Block 外壳**的场景）：锚点就是自己的按钮。
 *
 * 外壳内的入口菜单已收敛到 Block 一层（ADR-0039 D9）：本组件的类型专属项经
 * `useBlockEntryMenuExtra` 交给外壳，这里只剩没人替它开菜单的那一种用法。
 */
const menuAnchor = ref<HTMLElement | null>(null)
const menuOpen = ref(false)

const tableEl = ref<HTMLElement | null>(null)
/** 横向滚动容器：列数超宽时它把表格裁在可视宽度内，条也必须遵守同一条裁剪线 */
const scrollEl = ref<HTMLElement | null>(null)

const cellKey = (row: number, col: number) => `${row}:${col}`

function setCellEl(row: number, col: number, el: HTMLElement | null) {
  const key = cellKey(row, col)
  if (el) cellEls.set(key, el)
  else cellEls.delete(key)
}

function isActiveCell(row: number, col: number): boolean {
  return activeCell.value?.row === row && activeCell.value?.col === col
}

function marksAt(row: number, col: number): InlineMarkRange[] {
  return cellMarks.value[cellKey(row, col)] ?? []
}

function setMarksAt(row: number, col: number, marks: InlineMarkRange[]) {
  const key = cellKey(row, col)
  if (marks.length === 0) {
    if (!(key in cellMarks.value)) return
    const next = { ...cellMarks.value }
    delete next[key]
    cellMarks.value = next
    return
  }
  cellMarks.value = { ...cellMarks.value, [key]: marks }
}

/** 落库用的稀疏副本（空表不写键，保证 JSON 与旧数据同形） */
function cellMarksSnapshot(): Record<string, InlineMarkRange[]> | undefined {
  const entries = Object.entries(cellMarks.value)
  if (entries.length === 0) return undefined
  return Object.fromEntries(entries.map(([key, marks]) => [key, marks.map(mark => ({ ...mark }))]))
}

/** 只读态渲染用：纯文本 + 行内格式 → 已转义的 HTML */
function cellHtml(row: number, col: number): string {
  return inlineMarksToHtml(rows.value[row]?.[col] ?? '', marksAt(row, col))
}

/**
 * 从格内 DOM 反推行内格式。
 *
 * contenteditable 是格式的唯一真源：用户输入、原生 Ctrl+B、我们自己的重写都会落到 DOM 上，
 * 再从这里读回区间存进 `cellMarks`。识别口径与 `inlineMarksToHtml` 的产出严格对称
 * （`strong/b`、`em/i`、`u`、`s/strike/del`、`data-inline-color`、`data-inline-bg`）。
 */
function readMarksFromDom(el: HTMLElement): InlineMarkRange[] {
  const out: InlineMarkRange[] = []
  let offset = 0
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node) {
    const length = node.nodeValue?.length ?? 0
    if (length > 0) {
      const attrs = attrsFromAncestors(node.parentElement, el)
      if (attrs) {
        const previous = out[out.length - 1]
        if (previous && previous.end === offset && sameMarkAttrs(previous, attrs)) previous.end = offset + length
        else out.push({ start: offset, end: offset + length, ...attrs })
      }
      offset += length
    }
    node = walker.nextNode() as Text | null
  }
  return normalizeInlineMarks(out, offset)
}

function attrsFromAncestors(node: HTMLElement | null, root: HTMLElement): InlineMarkAttrs | null {
  const attrs: InlineMarkAttrs = {}
  let current: HTMLElement | null = node
  while (current && current !== root) {
    const tag = current.tagName
    if (tag === 'STRONG' || tag === 'B') attrs.bold = true
    else if (tag === 'EM' || tag === 'I') attrs.italic = true
    else if (tag === 'U') attrs.underline = true
    else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') attrs.strike = true
    const color = current.dataset?.inlineColor
    if (color) attrs.color = color
    const background = current.dataset?.inlineBg
    if (background) attrs.background = background
    current = current.parentElement
  }
  return Object.keys(attrs).length > 0 ? attrs : null
}

function sameMarkAttrs(a: InlineMarkAttrs, b: InlineMarkAttrs): boolean {
  return a.bold === b.bold
    && a.italic === b.italic
    && a.underline === b.underline
    && a.strike === b.strike
    && a.color === b.color
    && a.background === b.background
}

/** 用当前 `rows` + `cellMarks` 重写格内 HTML；内容已一致时不动 DOM（保住光标） */
function renderCell(el: HTMLElement, row: number, col: number) {
  const text = rows.value[row]?.[col] ?? ''
  const marks = marksAt(row, col)
  if ((el.textContent ?? '') === text && sameInlineMarks(readMarksFromDom(el), marks)) return
  el.innerHTML = inlineMarksToHtml(text, marks)
}

/** 外部数据写入后把所有格的 HTML 拉回与状态一致（结构变更重建的新格也得补内容） */
function syncAllCells() {
  if (props.readonly) return
  for (const [key, el] of cellEls) {
    const [row, col] = key.split(':').map(Number)
    if (row === undefined || col === undefined) continue
    renderCell(el, row, col)
  }
}

/** 同步 DOM 内容后重量行高（两态同高依赖它） */
function refreshCells() {
  syncAllCells()
  resizeAllCells()
}

function autoResize(el: HTMLElement) {
  // contenteditable 按内容自然长高；先清掉上一轮的对齐高度，才能量到本格自身的内容高
  el.style.minHeight = ''
}

/**
 * 把一行的单元格统一拉到该行**最高内容**的高度。
 *
 * 行高由行内最高的那一格决定。矮格若只按自身内容高，格子下方就留一块「点不到光标」的死区：
 * 那一带的 mousedown 命中 `<td>` 而不是单元格，走的是格选区手势 —— 同一张表里
 * 「点得进去」的范围随内容长短变化，手感很怪。拉满之后整格都是可编辑区，点在哪儿落哪儿。
 *
 * 同值重设不产生布局变更，所以这里不会把 ResizeObserver 顶成自激循环。
 */
function fitRowHeights(tr: Element | null | undefined) {
  const inputs = tr?.querySelectorAll<HTMLElement>('.cell-input')
  if (!inputs?.length) return
  let tallest = 0
  for (const el of inputs) {
    autoResize(el)
    tallest = Math.max(tallest, el.offsetHeight)
  }
  if (!tallest) return
  for (const el of inputs) el.style.minHeight = `${tallest}px`
}

/**
 * 全表重算单元格高度。
 *
 * contenteditable 按内容自然撑开，但「拉满整行」这一步仍需手写；渲染态用的是 `<div>`，
 * 两态同高只有在「每次可能改变折行数或字号的变更之后，把每一格都重量一遍」时才成立 ——
 * 漏一处就是「编辑态比渲染态矮、折行文字被裁」。
 */
function resizeAllCells() {
  if (props.readonly || !tableEl.value) return
  for (const tr of tableEl.value.querySelectorAll('tr')) fitRowHeights(tr)
}

// ── 格内字符偏移 ↔ DOM 坐标 ───────────────────────────────────────

/** 节点（文本节点或元素）对应的格内字符偏移（UTF-16） */
function textOffsetInCell(el: HTMLElement, container: Node, offset: number): number | null {
  if (!el.contains(container)) return null
  const probe = document.createRange()
  probe.selectNodeContents(el)
  try {
    probe.setEnd(container, offset)
  } catch {
    return null
  }
  return probe.toString().length
}

/** 折叠光标所在的格内偏移（选区非折叠或不在格内 → null） */
function caretOffsetInCell(el: HTMLElement): number | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null
  const node = selection.focusNode
  if (!node) return null
  return textOffsetInCell(el, node, selection.focusOffset)
}

/** 偏移 → 文本节点落点；格内无文本时落到元素自身 */
function locateTextOffset(el: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = Math.max(0, offset)
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  let last: Text | null = null
  while (node) {
    last = node
    if (remaining <= node.length) return { node, offset: remaining }
    remaining -= node.length
    node = walker.nextNode() as Text | null
  }
  return last ? { node: last, offset: last.length } : { node: el, offset: 0 }
}

function setCaretInCell(el: HTMLElement, offset: number) {
  const point = locateTextOffset(el, offset)
  const range = document.createRange()
  range.setStart(point.node, point.node === el ? 0 : point.offset)
  range.collapse(true)
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

function selectCellText(el: HTMLElement, start: number, end: number) {
  const from = locateTextOffset(el, start)
  const to = locateTextOffset(el, end)
  const range = document.createRange()
  range.setStart(from.node, from.node === el ? 0 : from.offset)
  range.setEnd(to.node, to.node === el ? 0 : to.offset)
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

function focusCell(row: number, col: number, caret: 'start' | 'end' = 'end') {
  if (props.readonly) return
  const maxRow = Math.max(0, rows.value.length - 1)
  const maxCol = Math.max(0, cols.value - 1)
  const clamped = {
    row: Math.min(Math.max(0, row), maxRow),
    col: Math.min(Math.max(0, col), maxCol),
  }
  // 被合并覆盖的格没有编辑区：焦点落到所属合并区的左上格
  const { row: r, col: c } = anchorFor(merges.value, clamped.row, clamped.col)
  activeCell.value = { row: r, col: c }
  restoringFocus = true
  void nextTick(() => {
    const el = cellEls.get(cellKey(r, c))
    restoringFocus = false
    if (!el) return
    el.focus()
    const length = (rows.value[r]?.[c] ?? '').length
    setCaretInCell(el, caret === 'start' ? 0 : length)
    fitRowHeights(el.closest('tr'))
  })
}

function focusFirstCell() {
  focusCell(0, 0, 'start')
}

/**
 * 表格最近的纵向滚动祖先（`overflow-y: auto|scroll` 且内容确实溢出）。
 *
 * 只用来在「渲染态 → 编辑态」重挂载的瞬间保住滚动位置：编辑态首帧的格高塌陷会让这个盒子
 * 的 `scrollTop` 被钳掉，见 `editorStore.pendingTableScroll`。
 */
function scrollAncestorOfTable(): HTMLElement | null {
  let el = rootEl.value?.parentElement ?? null
  while (el && el !== document.body) {
    const overflowY = getComputedStyle(el).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2) {
      return el
    }
    el = el.parentElement
  }
  return null
}

/**
 * 本次挂载是否已经按「格行列」交接落好了光标。
 *
 * 交接坐标比像素坐标精确，也更抗布局变化：`pendingClickCoords` 是 mousedown 那一刻的视口坐标，
 * 等 `focusActiveEditor` 的 rAF 用到它时，块已重挂载、滚动位置也可能已经变了，`elementFromPoint`
 * 就会解析成**另一格** —— 表现为「光标落在我点的那个屏幕位置上，但那已经不是点的那一格了」。
 * 所以交接生效后不再让像素坐标改主意（只消费一次）。
 */
let handoffApplied = false

/**
 * 沿单轴前进一格，跳过被合并覆盖的格。
 *
 * 合并区跨行/跨列时，逐格 +1 会一路落回同一个左上格（`focusCell` 会 anchor 回来），
 * 键盘表现为「卡在合并区里」。这里直接跨过整个合并区；越界返回 null。
 */
function stepCell(
  row: number,
  col: number,
  dRow: number,
  dCol: number,
): { row: number; col: number } | null {
  let r = row + dRow
  let c = col + dCol
  while (r >= 0 && r < rows.value.length && c >= 0 && c < cols.value) {
    const rect = mergeRectAt(merges.value, r, c)
    if (!rect) return { row: r, col: c }
    r = dRow !== 0 ? (dRow > 0 ? rect.row2 + 1 : rect.row1 - 1) : r
    c = dCol !== 0 ? (dCol > 0 ? rect.col2 + 1 : rect.col1 - 1) : c
  }
  return null
}

// ── 落库 ──────────────────────────────────────────────────────────

function scheduleSave() {
  dirty = true
  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined
    flushSave()
  }, 500)
}

function flushSave() {
  if (!dirty || !props.blockId) return
  dirty = false
  const marks = cellMarksSnapshot()
  void blockStore.updateBlockFormat(props.blockId, {
    table: {
      rows: rows.value.map(row => [...row]),
      header: header.value,
      headerAlign: headerAlign.value,
      aligns: { ...aligns.value },
      merges: merges.value.map(rect => ({ ...rect })),
      ...(marks ? { cellMarks: marks } : {}),
    },
  })
}

/** 结构变更后立即落库（不依赖输入防抖留下的 dirty 标记） */
function persist() {
  dirty = true
  flushSave()
  // 结构 / 内容整体替换会改变折行数，且重建 DOM 的格需要补内容并重量行高
  void nextTick(refreshCells)
}

/** 当前表格数据快照（纯函数层的入参） */
const dataSnapshot = computed<TableData>(() => ({
  rows: rows.value,
  header: header.value,
  headerAlign: headerAlign.value,
  aligns: aligns.value,
  merges: merges.value,
  cellMarks: cellMarksSnapshot(),
}))

/** 写入一份新的表格数据快照（内容 / 表头 / 对齐 / 行内格式一起落库） */
function applyData(next: TableData) {
  rows.value = next.rows
  header.value = next.header
  headerAlign.value = next.headerAlign
  aligns.value = next.aligns
  merges.value = next.merges
  cellMarks.value = next.cellMarks ?? {}
  // 活动格可能被新合并区覆盖（没有 DOM）：归一到合并区左上角
  const active = activeCell.value
  if (active) activeCell.value = anchorFor(next.merges, active.row, active.col)
  persist()
}

/** 某格实际生效的对齐（逐格覆盖 > 表头缺省 > left） */
function alignAt(row: number, col: number): TableAlign {
  return cellAlign(dataSnapshot.value, row, col)
}

/** 外部改动（撤销/重做、其他入口）同步到本地状态；自身写入会因数据相同而跳过 */
watch(
  () => JSON.stringify(props.blockFormat ?? null),
  () => {
    const incoming = readTableData(props.blockFormat)
    if (isSameTableData(incoming, dataSnapshot.value)) return
    rows.value = incoming.rows
    header.value = incoming.header
    headerAlign.value = incoming.headerAlign
    aligns.value = incoming.aligns
    merges.value = incoming.merges
    cellMarks.value = incoming.cellMarks ?? {}
    const active = activeCell.value
    if (active) activeCell.value = anchorFor(incoming.merges, active.row, active.col)
    // 撤销 / 重做 / 其他入口写入的文本与格式都可能变，DOM 内容与行高必须一起重量
    void nextTick(refreshCells)
  },
)

// ── 单元格输入 ─────────────────────────────────────────────────────

function onCellInput(row: number, col: number, e: Event) {
  const el = e.currentTarget as HTMLElement
  const raw = el.textContent ?? ''
  // IME 组合期间不改写 DOM：动 innerHTML 会打断候选窗
  if (composing.value) {
    rows.value[row][col] = sanitizeCellText(raw)
    return
  }
  const text = sanitizeCellText(raw)
  if (text !== raw) {
    const caret = caretOffsetInCell(el) ?? text.length
    el.textContent = text
    setCaretInCell(el, Math.min(caret, text.length))
  }
  // 删空的格留 `<br>` 会让 `:empty` 占位失效：清成真正的空节点
  if (text.length === 0 && el.childNodes.length > 0) {
    el.innerHTML = ''
  }
  rows.value[row][col] = text
  setMarksAt(row, col, readMarksFromDom(el))
  // 本格变高/变矮都会牵动整行：同行其它格必须一起拉到新的行高
  fitRowHeights(el.closest('tr'))
  scheduleSave()
}

/** 粘贴：tab / 换行替换为空格后插入，保证单元格单行纯文本 */
function onCellPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain')
  if (text === undefined) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  const clean = sanitizeCellText(text)
  // 走原生插入：保留光标位置与 IME 状态，input 事件再统一回写文本与格式
  el.focus()
  document.execCommand('insertText', false, clean)
  fitRowHeights(el.closest('tr'))
}

function onCompositionStart() {
  composing.value = true
}

function onCompositionEnd() {
  composing.value = false
}

function onCellBlur(e: FocusEvent) {
  if (restoringFocus) return
  const next = e.relatedTarget as HTMLElement | null
  if (next && rootEl.value?.contains(next)) return
  activeCell.value = null
  flushSave()
}

// ── 键盘导航 ──────────────────────────────────────────────────────

function onCellKeydown(row: number, col: number, e: KeyboardEvent) {
  if (composing.value || e.isComposing || e.keyCode === 229) return

  const mod = e.ctrlKey || e.metaKey
  if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
    e.preventDefault()
    flushSave()
    const pageId = props.blockId ? blockStore.getBlock(props.blockId)?.pageId : undefined
    if (pageId) {
      const redo = e.key === 'y' || e.key === 'Y' || e.shiftKey
      void runUndoOrRedo(pageId, redo ? 'redo' : 'undo')
    }
    return
  }

  // 有文本选区时接管格式快捷键：工具条的写入路径是「重写 innerHTML + 存区间」，
  // 原生 execCommand 产出的标签不保证能被格式模型读回，统一走自己的那条路
  if (mod && !e.altKey) {
    const key = e.key.toLowerCase()
    const mark: InlineMarkKey | null = !e.shiftKey && key === 'b'
      ? 'bold'
      : !e.shiftKey && key === 'i'
        ? 'italic'
        : !e.shiftKey && key === 'u'
          ? 'underline'
          : e.shiftKey && key === 'x'
            ? 'strike'
            : null
    if (mark && captureCellTextSelection()) {
      e.preventDefault()
      applyCellMark(mark, null)
      return
    }
  }

  if (e.key === 'Enter') {
    e.preventDefault()
    const down = stepCell(row, col, 1, 0)
    if (down) {
      focusCell(down.row, down.col, 'end')
    } else {
      rows.value = addRow(rows.value, rows.value.length)
      // 必须 persist()：新追加的行还没把 dirty 立起来，flushSave() 会因 `!dirty` 直接返回，
      // 于是「干净表格上按 Enter/Tab 加出来的行」在退回渲染态时凭空消失。
      persist()
      focusCell(row + 1, col, 'end')
    }
    return
  }

  if (e.key === 'Tab') {
    e.preventDefault()
    if (!e.shiftKey) {
      const right = stepCell(row, col, 0, 1)
      if (right) {
        focusCell(right.row, right.col, 'start')
      } else if (row + 1 < rows.value.length) {
        focusCell(row + 1, 0, 'start')
      } else {
        rows.value = addRow(rows.value, rows.value.length)
        // 同 Enter 分支：新行不带 dirty，flushSave() 会早退，加出来的行会丢
        persist()
        focusCell(row + 1, 0, 'start')
      }
    } else {
      const left = stepCell(row, col, 0, -1)
      if (left) {
        focusCell(left.row, left.col, 'end')
      } else if (row > 0) {
        focusCell(row - 1, cols.value - 1, 'end')
      }
    }
    return
  }

  if (e.key === 'Escape') {
    e.preventDefault()
    flushSave()
    activeCell.value = null
    editorStore.deactivateBlock()
    return
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault()
    const up = stepCell(row, col, -1, 0)
    if (up) focusCell(up.row, up.col, 'end')
    return
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const down = stepCell(row, col, 1, 0)
    if (down) focusCell(down.row, down.col, 'end')
    return
  }

  const el = e.currentTarget as HTMLElement
  const caret = caretOffsetInCell(el)
  const length = (rows.value[row]?.[col] ?? '').length
  const atStart = caret === 0
  const atEnd = caret !== null && caret === length

  if (e.key === 'ArrowLeft' && atStart) {
    e.preventDefault()
    const left = stepCell(row, col, 0, -1)
    if (left) focusCell(left.row, left.col, 'end')
    else if (row > 0) focusCell(row - 1, cols.value - 1, 'end')
    return
  }

  if (e.key === 'ArrowRight' && atEnd) {
    e.preventDefault()
    const right = stepCell(row, col, 0, 1)
    if (right) focusCell(right.row, right.col, 'start')
    else if (row + 1 < rows.value.length) focusCell(row + 1, 0, 'start')
  }
}

// ── 格内文本选区的行内格式 ─────────────────────────────────────────

/** 文本节点 / 元素所属的单元格（编辑态 .cell-input / 渲染态 .cell-text） */
function cellInputOf(node: Node | null): HTMLElement | null {
  if (!node) return null
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
  const found = el?.closest?.('.cell-input, .cell-text')
  return found instanceof HTMLElement ? found : null
}

/**
 * 读取当前格内文本选区，并同步工具条状态。
 *
 * 只认「起止点在同一格内、且非折叠」的选区：跨格的原生选区由格选区手势接管，
 * 这里的格式模型是按格存的，跨格没有可写的目标。
 *
 * 两态都要读：渲染态没有可编辑实例，但格内拖出的原生文本选区同样该浮出工具条，
 * 格式写入走 `cellMarks` + `v-html` 重画（见 applyCellMark）。
 */
function captureCellTextSelection() {
  const clear = () => {
    if (cellTextSel.value) cellTextSel.value = null
    // 文本选区没了，它撑起来的那个浮层也得走（格/行/列范围的菜单另有驱动，不动）
    if (rangeMenu.value?.kind === 'text') closeRangeMenu()
    return null
  }
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return clear()
  const range = selection.getRangeAt(0)
  const el = cellInputOf(range.startContainer)
  if (!el || el !== cellInputOf(range.endContainer) || !tableEl.value?.contains(el)) return clear()
  const row = Number(el.dataset.row)
  const col = Number(el.dataset.col)
  if (!Number.isFinite(row) || !Number.isFinite(col)) return clear()
  const start = textOffsetInCell(el, range.startContainer, range.startOffset)
  const end = textOffsetInCell(el, range.endContainer, range.endOffset)
  if (start === null || end === null || end <= start) return clear()

  const text = rows.value[row]?.[col] ?? ''
  const marks = normalizeInlineMarks(readMarksFromDom(el), text.length)
  const format: InlineMarkAttrs = {}
  for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
    if (rangeHasAttr(marks, start, end, key, text.length)) format[key] = true
  }
  const color = rangeColorToken(marks, start, end, 'color', text.length)
  if (color) format.color = color
  const background = rangeColorToken(marks, start, end, 'background', text.length)
  if (background) format.background = background

  const box = range.getClientRects()[0] ?? range.getBoundingClientRect()
  cellTextSel.value = {
    row,
    col,
    start,
    end,
    rect: { left: box.left, top: box.top, width: box.width, height: box.height },
    format,
  }
  syncTextMenu(row, col, el, start, end)
  return cellTextSel.value
}

/**
 * 文本选区 → 同一个选区浮层（只在选区真正变了的时候写，避免拖动过程中反复重挂浮层）。
 *
 * 锚点用**所在的 td** 而不是文本矩形：这样文本选区与格矩形选区的浮层出自同一个
 * 锚点规则（挂在这一格上沿、空间不足自动翻面），「表现形式一样」才有据可依。
 */
function syncTextMenu(row: number, col: number, el: HTMLElement, start: number, end: number) {
  const td = el.closest('td')
  if (!(td instanceof HTMLElement)) return
  const current = rangeMenu.value
  const prev = current?.kind === 'text' ? current.textSel : undefined
  if (prev && prev.row === row && prev.col === col && prev.start === start
    && prev.end === end && current?.anchor === td) return
  rangeMenu.value = {
    anchor: td,
    range: { row1: row, row2: row, col1: col, col2: col },
    kind: 'text',
    textSel: { row, col, start, end },
  }
  submenu.value = null
}

function onSelectionChange() {
  captureCellTextSelection()
}

/**
 * 读一格的当前格式。
 *
 * 编辑态以 contenteditable 的 HTML 为准 —— 它是编辑中的真源（store 会滞后 500ms）；
 * 渲染态反过来只读 `cellMarks`：`.cell-text` 是它画出来的派生物，读 DOM 会读到
 * 尚未 patch 的旧内容（`menuFormat` 是 computed，重算时机与 v-html 的 patch 谁先谁后不定）。
 */
function readCellMarks(row: number, col: number): InlineMarkRange[] {
  const el = props.readonly ? null : (cellEls.get(cellKey(row, col)) ?? null)
  if (!el) return marksAt(row, col)
  const text = rows.value[row]?.[col] ?? ''
  return normalizeInlineMarks(readMarksFromDom(el), text.length)
}

/** 在 `[from, to)` 上切换一个行内格式：已全覆盖 → 清掉；色值相同 → 清掉；否则设上 */
function toggleMarksInRange(
  marks: InlineMarkRange[],
  from: number,
  to: number,
  key: InlineMarkKey,
  token: string | null,
  length: number,
): InlineMarkRange[] {
  if (key === 'color' || key === 'background') {
    const current = rangeColorToken(marks, from, to, key, length)
    if (token && current !== token) {
      const patch: InlineMarkAttrs = {}
      patch[key] = token
      return setInlineMarkRange(marks, from, to, patch, length)
    }
    return clearInlineMarkRange(marks, from, to, [key], length)
  }
  if (rangeHasAttr(marks, from, to, key, length)) {
    return clearInlineMarkRange(marks, from, to, [key], length)
  }
  const patch: InlineMarkAttrs = {}
  patch[key] = true
  return setInlineMarkRange(marks, from, to, patch, length)
}

/** 文本选区：格式只作用于选中的那几个字 */
function applyCellMark(key: InlineMarkKey, token: string | null) {
  const active = captureCellTextSelection()
  if (!active) return
  const text = rows.value[active.row]?.[active.col] ?? ''
  const from = Math.min(active.start, text.length)
  const to = Math.min(active.end, text.length)
  if (to <= from) return

  const cellSelector = `.cell-text[data-row="${active.row}"][data-col="${active.col}"]`
  const el = cellEls.get(cellKey(active.row, active.col)) ?? null
  const marks = readCellMarks(active.row, active.col)
  const next = toggleMarksInRange(marks, from, to, key, token, text.length)

  if (sameInlineMarks(marks, next)) return
  setMarksAt(active.row, active.col, next)

  if (props.readonly) {
    // 渲染态的格内容是 `v-html="cellHtml()"`，改完 cellMarks 会自动重画；
    // DOM 换掉后原生选区随之失效，等重画完按原字符偏移恢复，菜单与选区才不会凭空消失。
    // 立即落库（不走输入防抖）：格式是一次性操作，且切换两态前必须已经写回 store。
    persist()
    void nextTick(() => {
      const redrawn = tableEl.value?.querySelector<HTMLElement>(cellSelector)
      if (redrawn) selectCellText(redrawn, from, to)
    })
    return
  }
  if (!el) return
  renderCell(el, active.row, active.col)
  selectCellText(el, from, to)
  scheduleSave()
}

/**
 * 范围里的「实际有 DOM 的格」：被合并区覆盖的格没有 DOM，内容只认左上格，
 * 所有逐格操作（格式 / 对齐 / 复制）都必须按这个集合走。
 */
function cellsInRange(range: CellRange): { row: number; col: number }[] {
  const cells: { row: number; col: number }[] = []
  for (let r = range.row1; r <= range.row2; r += 1) {
    for (let c = range.col1; c <= range.col2; c += 1) {
      const origin = anchorFor(merges.value, r, c)
      if (origin.row !== r || origin.col !== c) continue
      cells.push({ row: r, col: c })
    }
  }
  return cells
}

/**
 * 格 / 行 / 列范围：格式作用于**选区内每一格的整格全文**。
 *
 * `cellMarks` 是按字符偏移存的，格矩形选区表达不了「格内哪几个字」，
 * 因此这里把每一格都当成 `[0, 全文长度]` 来写；被合并区覆盖的格没有 DOM，
 * 由 `cellsInRange` 跳过，内容只认左上格。
 *
 * 动作**整段只定一次**：先看选区是否已全覆盖 —— 全覆盖就整体清掉，否则整体设上。
 * 不能让每格各判一次：选区里部分格已有该格式时，逐格判定会「有的被加上、有的被清掉」，
 * 与浮层按钮的激活态（也按全覆盖判定，见 menuFormat）自相矛盾。
 */
function applyRangeMark(range: CellRange, key: InlineMarkKey, token: string | null) {
  const cells = cellsInRange(range)
    .filter(({ row, col }) => (rows.value[row]?.[col] ?? '').length > 0)
  if (!cells.length) return

  const fullCoverage = cells.every(({ row, col }) => {
    const text = rows.value[row]?.[col] ?? ''
    const marks = readCellMarks(row, col)
    return key === 'color' || key === 'background'
      ? !!token && rangeColorToken(marks, 0, text.length, key, text.length) === token
      : rangeHasAttr(marks, 0, text.length, key, text.length)
  })
  // 「默认颜色 / 无背景」本身就是清除动作，token 为空时不必再看覆盖情况
  const wantsClear = (key === 'color' || key === 'background') ? (!token || fullCoverage) : fullCoverage

  const touched: { row: number; col: number }[] = []
  for (const { row, col } of cells) {
    const text = rows.value[row]?.[col] ?? ''
    const marks = readCellMarks(row, col)
    let next: InlineMarkRange[]
    if (wantsClear) {
      next = clearInlineMarkRange(marks, 0, text.length, [key], text.length)
    } else {
      const patch: InlineMarkAttrs = {}
      if (key === 'color' || key === 'background') {
        // token 为空时走的是 wantsClear 分支，这里 token 必有值
        if (!token) continue
        patch[key] = token
      } else {
        patch[key] = true
      }
      next = setInlineMarkRange(marks, 0, text.length, patch, text.length)
    }
    if (sameInlineMarks(marks, next)) continue
    setMarksAt(row, col, next)
    touched.push({ row, col })
  }
  if (!touched.length) return

  if (props.readonly) {
    // 渲染态靠 `v-html` 自动重画，只需落库
    persist()
    return
  }
  for (const { row, col } of touched) {
    const el = cellEls.get(cellKey(row, col))
    if (el) renderCell(el, row, col)
  }
  scheduleSave()
}

/** 浮层上的 B/I/U/S/A：文本选区走字符段，格范围走整格全文 */
function applyMenuMark(key: InlineMarkKey, token: string | null) {
  const menu = rangeMenu.value
  if (!menu) return
  if (menu.kind === 'text') {
    applyCellMark(key, token)
    return
  }
  applyRangeMark(menu.range, key, token)
}

/** 选色后浮层保持打开（与正文工具条同口径：字体色与背景色连续调整不反复展开） */
function applyMenuColor(kind: 'color' | 'background', token: string | null) {
  applyMenuMark(kind, token)
}

function resetMenuColors() {
  applyMenuMark('color', null)
  applyMenuMark('background', null)
}

// ── 结构操作 ──────────────────────────────────────────────────────

/**
 * 交给 Block 外壳的类型专属菜单项（ADR-0039 D9）。
 *
 * 外壳持有 popover 与「关菜单」这件事，本组件只交出「表格多出来的那两项」——
 * 它们依赖本实例的 `header` 状态，而 `render()` 在外壳的渲染 effect 里执行，
 * 所以开关的勾选态照常跟着 `header` 变。
 */
const entryMenuExtra = {
  render: (close: () => void) => [
    h(TableEntryMenuItems, {
      header: header.value,
      onToggleHeader: () => {
        close()
        toggleHeader()
      },
    }),
  ],
}

onMounted(() => {
  if (props.blockId) registerEntryMenuExtra(props.blockId, entryMenuExtra)
})
onBeforeUnmount(() => {
  if (props.blockId) unregisterEntryMenuExtra(props.blockId, entryMenuExtra)
})

/** standalone 入口按钮点击（Ideas 快照等脱离外壳的场景）：显式切换 */
function toggleStandaloneMenu() {
  if (menuOpen.value) {
    menuOpen.value = false
    return
  }
  menuAnchor.value = entryEl.value
  menuOpen.value = true
}

function toggleHeader() {
  // standalone 浮层由自己关；外壳托管的浮层由 render() 收到的 close 关（见 entryMenuExtra）
  menuOpen.value = false
  const next = !header.value
  // 打开表头后，跨「第 0 行 / 表体」边界的合并区会横穿 thead/tbody（HTML 不支持），拆开
  if (next) merges.value = merges.value.filter(rect => rect.row1 !== 0 || rect.row2 === 0)
  header.value = next
  persist()
}

// ── 行 / 列操作条（贴表格外缘的纯色块） ─────────────────────────
// 三级显隐，三个触发域互不重叠：
//   L0 鼠标不在块内 → 无控件；
//   L1 块 hover → 行/列条通栏基座出现（不可点，只是「这里能操作」的底座）；
//   L2 鼠标压在某一段条上 → 该段升档 = 这一段可点开菜单；
//   L3 鼠标压在该段条的**端点**（「+」自身 PLUS_HOT_RADIUS 内）→ 「+」与引导线浮出 = 一键插入。
// L2 与 L3 必须分开：条的命中区是整段长条，若让「+」跟着整段走，
// 光标压在条的左端也会把几十像素外的「+」拉出来，插入入口的触发区就被放大到整条。
// 条 = 菜单入口（点击弹出），「+」= 一键插入（行下方 / 列右侧），互补不重叠。

/** 条厚度（短边）：一条紧贴表格边框外侧的窄带，与表格共用同一条边线 */
const ENTRY_THICKNESS = 10

interface StripGeometry {
  index: number
  left: number
  top: number
  width: number
  height: number
  /** 整段被滚出可视区：不渲染 */
  hidden: boolean
  /** 该段右端被滚动容器裁掉（列宽超出可视宽度）：「+」画在可视区之外，必须隐藏 */
  clipped: boolean
  /** 可视区内的首 / 末段：只有它们带圆头 */
  first: boolean
  last: boolean
}

/** 表格相对块根的位置与尺寸：引导线按整表跨度画，不受条自身尺寸限制 */
const tableBox = ref({ left: 0, top: 0, width: 0, height: 0 })
/** 表格在滚动容器里实际可见的横向范围（块根坐标）：列超宽时条只画到这里为止 */
const visibleBox = ref({ left: 0, right: 0 })

/**
 * 横向滚动条滑块（块根坐标，仅列宽总和超出可视宽度时存在）。
 * 全局浮层滚动条只服务纵向，横向溢出没有任何指示，超宽表只能靠 Shift+滚轮摸索，
 * 所以在表格下方补一条同色同尺寸的横向滑块。
 */
const hScroll = ref<{ left: number; top: number; width: number; now: number; max: number } | null>(null)
const colStrips = ref<StripGeometry[]>([])
const rowStrips = ref<StripGeometry[]>([])
/** 渲染用的子集：滚出可视区的段不留在 DOM 里（0 宽 <button> 仍是可聚焦元素） */
const renderedColStrips = computed(() => colStrips.value.filter(s => !s.hidden))
const activeCol = ref<number | null>(null)
const activeRow = ref<number | null>(null)

/**
 * 「+」的独立热区：只有光标落在「+」自身周围 PLUS_HOT_RADIUS 内才浮出。
 * 条的长条本身只管「升档 = 可点开菜单」，不能顺带把「+」拉出来——
 * 否则光标压在条左端，几十像素外的另一个按钮凭空出现，插入入口的触发区就被放大了。
 */
const PLUS_HOT_RADIUS = 14
const plusHot = ref<{ kind: EntryKind; index: number } | null>(null)

type EntryKind = 'row' | 'col'

/**
 * 统一的范围菜单（原「列条 / 行条菜单」+「格选区菜单」合并）。
 *
 * 三类入口共用同一个浮层，区别只在**目标矩形**：
 * - 列条 → 整列矩形；行条 → 整行矩形；拖出的格选区 → 拖出来的矩形。
 * 于是「行列专属操作」（删除行 / 上移下移 / 删除列 / 左右移）不必单独一套菜单，
 * 由「范围是否覆盖整行整列、是否仅一行一列」决定显隐。
 */
interface RangeMenuState {
  anchor: HTMLElement
  range: CellRange
  kind: 'row' | 'col' | 'cells' | 'text'
  /**
   * `kind === 'text'`：格内原生文本选区的字符区间。
   *
   * 这一种选区只表达「这一格里的哪几个字」，所以公共项（对齐 + B/I/U/S/A）照旧，
   * 结构项（合并 / 复制粘贴 / 删行列 / 移动）没有作用对象，整组不渲染。
   */
  textSel?: { row: number; col: number; start: number; end: number }
}

const rangeMenu = ref<RangeMenuState | null>(null)

/**
 * 二级浮层：对齐下拉与取色面板。
 *
 * 定位与 Esc/收起规则收口在 `FloatingSubmenu`（对齐下拉与正文工具条共用同一个），
 * 这里只留「同一时刻最多开一个」的状态，以及触发按钮的引用。
 */
type SubmenuKind = 'align' | 'palette'
const submenu = ref<SubmenuKind | null>(null)
const submenuAnchor = ref<HTMLElement | null>(null)

const rangeMenuRange = computed(() => rangeMenu.value?.range ?? null)
/**
 * 浮层在**目标上方**：格矩形 / 文本选区锚在范围的左上格，`top` 即整块选区的上沿；
 * 行条贴在行左侧，菜单挂右侧（`top` 会压住上面一行，看起来像属于上一行）；
 * 列条贴在表格上沿，`top` 落在表格之外，不会盖住表头。
 */
const rangeMenuPlacement = computed<'top' | 'right'>(() => (rangeMenu.value?.kind === 'row' ? 'right' : 'top'))
const isColMenuOpen = computed(() => rangeMenu.value?.kind === 'col')
const isRowMenuOpen = computed(() => rangeMenu.value?.kind === 'row')
const canPasteRange = computed(() => hasTableClipboard())

/** 本块浮层白名单：范围工具条 + 它的二级浮层（对齐下拉 / 取色面板）。
 *  三者都 Teleport 到 body 且共用同一个句柄（`data-table-menu="<blockId>"`），
 *  一个选择器就能表达「这些是本块内部」，不用为每层各开一个属性名。 */
const overlaySelector = computed(() =>
  props.blockId ? `[data-table-menu="${props.blockId}"]` : '',
)

/** 范围覆盖整行（可删行 / 移行） */
const rangeCoversAllCols = computed(() => {
  const range = rangeMenuRange.value
  return !!range && cols.value > 0 && range.col1 === 0 && range.col2 === cols.value - 1
})

/** 范围覆盖整列（可删列 / 移列） */
const rangeCoversAllRows = computed(() => {
  const range = rangeMenuRange.value
  return !!range && rows.value.length > 0 && range.row1 === 0 && range.row2 === rows.value.length - 1
})

const rangeIsSingleRow = computed(() => {
  const range = rangeMenuRange.value
  return !!range && range.row1 === range.row2
})

const rangeIsSingleCol = computed(() => {
  const range = rangeMenuRange.value
  return !!range && range.col1 === range.col2
})

// 不可用项直接不渲染（工具条随范围变形），只有「未实现」的合并单元格常驻置灰。
const showDeleteRow = computed(() => rangeCoversAllCols.value && rows.value.length > 1)
const showDeleteCol = computed(() => rangeCoversAllRows.value && cols.value > 1)
const canMoveRowUp = computed(() => rangeIsSingleRow.value && (rangeMenuRange.value?.row1 ?? 0) > bodyStart.value)
const canMoveRowDown = computed(
  () => rangeIsSingleRow.value && (rangeMenuRange.value?.row1 ?? 0) < rows.value.length - 1,
)
const canMoveColLeft = computed(() => rangeIsSingleCol.value && (rangeMenuRange.value?.col1 ?? 0) > 0)
const canMoveColRight = computed(
  () => rangeIsSingleCol.value && (rangeMenuRange.value?.col1 ?? 0) < cols.value - 1,
)

/**
 * 合并 / 取消合并是两个独立按钮，不共用同一个位置。
 *
 * 拖选手势表达不了「只选这个合并区」——被覆盖格没有 DOM 拖不进去，1×1 拖选又会被撤销；
 * 这条路径由合并格左下角的把手补齐（`openMergeMenu` 直接写入整块矩形）。
 * 即便如此，「取消合并」仍按**相交**触发（范围内有几个合并区就拆几个），
 * 和「把这个矩形合并起来」互不排斥，大范围里既有合并区又想要新合并时也不会二选一。
 */
const mergeBlocked = computed(() => {
  const range = rangeMenuRange.value
  if (!range) return false
  // 跨「表头 / 表体」边界会横穿 thead/tbody，HTML 不支持
  return header.value && range.row1 < bodyStart.value && range.row2 >= bodyStart.value
})

/** 范围恰好就是一个已有合并区（合并格里点把手时的常态） */
const rangeIsExactMerge = computed(() => {
  const range = rangeMenuRange.value
  if (!range) return false
  return merges.value.some(rect =>
    rect.row1 === range.row1 && rect.col1 === range.col1
    && rect.row2 === range.row2 && rect.col2 === range.col2,
  )
})

const canMerge = computed(() => {
  const range = rangeMenuRange.value
  if (!range || mergeBlocked.value) return false
  if (range.row1 === range.row2 && range.col1 === range.col2) return false
  // 已经是这一块合并区：再「合并」只会把内容重新拼一遍，纯噪音
  return !rangeIsExactMerge.value
})

/** 范围内与之相交的合并区（1×N / N×1 / 更大矩形都算） */
const mergeTargets = computed<MergeRect[]>(() => {
  const range = rangeMenuRange.value
  if (!range) return []
  return merges.value.filter(rect =>
    rect.row1 <= range.row2 && range.row1 <= rect.row2
    && rect.col1 <= range.col2 && range.col1 <= rect.col2,
  )
})

/** 工具条上的对齐图标跟随范围左上格的实际对齐 */
const rangeAlign = computed<TableAlign>(() => {
  const range = rangeMenuRange.value
  if (!range) return 'left'
  const origin = anchorFor(merges.value, range.row1, range.col1)
  return alignAt(origin.row, origin.col)
})

/** 当前浮层目标范围里的实际格（文本选区就是它所在的那一格） */
const rangeCells = computed(() => {
  const range = rangeMenuRange.value
  return range ? cellsInRange(range) : []
})

/**
 * 浮层上 B/I/U/S/A 的激活态。
 *
 * 文本选区按字符段读（`cellTextSel.format` 已是合并后的结果）；
 * 格范围按「整格全覆盖」判定 —— 只要有一格没全带上就显示为未激活，
 * 点一下正好把它补齐（与整段格式的常规语义一致）。
 */
const menuFormat = computed<InlineMarkAttrs>(() => {
  // 编辑态的格式读自 contenteditable（非响应式），这里显式订阅 store 版本：
  // 每次格式写入都先落 `cellMarks` 再重画 DOM，订阅它才能让激活态跟上。
  void cellMarks.value
  const menu = rangeMenu.value
  if (!menu) return {}
  if (menu.kind === 'text') return cellTextSel.value?.format ?? {}

  const out: InlineMarkAttrs = {}
  const cells = rangeCells.value
  if (!cells.length) return out

  for (const key of ['bold', 'italic', 'underline', 'strike'] as const) {
    const all = cells.every(({ row, col }) => {
      const text = rows.value[row]?.[col] ?? ''
      if (!text.length) return true
      return rangeHasAttr(readCellMarks(row, col), 0, text.length, key, text.length)
    })
    if (all) out[key] = true
  }

  // 色值取第一格作代表：多格不同色时按钮只表达「有颜色」，点开面板再统一覆盖
  const first = cells.find(({ row, col }) => (rows.value[row]?.[col] ?? '').length > 0)
  if (first) {
    const text = rows.value[first.row]?.[first.col] ?? ''
    const marks = readCellMarks(first.row, first.col)
    const color = rangeColorToken(marks, 0, text.length, 'color', text.length)
    if (color) out.color = color
    const background = rangeColorToken(marks, 0, text.length, 'background', text.length)
    if (background) out.background = background
  }
  return out
})

function openStripMenu(event: MouseEvent, kind: EntryKind, index: number) {
  menuOpen.value = false
  submenu.value = null
  const anchor = event.currentTarget as HTMLElement
  const range: CellRange = kind === 'row'
    ? { row1: index, row2: index, col1: 0, col2: Math.max(0, cols.value - 1) }
    : { row1: 0, row2: Math.max(0, rows.value.length - 1), col1: index, col2: index }
  rangeMenu.value = { anchor, range, kind }
}

/**
 * 拖出格矩形后浮出工具条：锚在选区**左上格**。
 *
 * 浮层挂在目标上方（`placement="top"`），所以锚点必须是范围的上沿而非右下角——
 * 锚在下沿的话 `top` 会让菜单落进选区里，压住刚选中的那几行。
 * 左上格可能被合并覆盖（没有 DOM），先归一到所属合并区的左上格。
 */
function openCellMenu() {
  const sel = selection?.cellSelection.value
  const table = tableEl.value
  if (!sel || !table || sel.blockId !== props.blockId) return
  const range = normalizeCellRange(sel.anchor, sel.head)
  const corner = anchorFor(merges.value, range.row1, range.col1)
  const anchor = table.querySelector<HTMLElement>(`td[data-row="${corner.row}"][data-col="${corner.col}"]`)
  if (!anchor) return
  submenu.value = null
  rangeMenu.value = { anchor, range, kind: 'cells' }
}

function closeRangeMenu() {
  rangeMenu.value = null
  submenu.value = null
}

/**
 * 格子左下角的**通用**热区（18×18，透明，只改光标）：单击选中这一格所在的范围并浮出菜单。
 *
 * 普通格 → 1×1（单击「进入这一格」之外的旁路入口，单格也能用对齐 / 复制 / 清空）；
 * 合并格 → 整个合并区 —— 被覆盖格没有 DOM，拖不出「只选这块合并区」的矩形，而 1×1 拖选
 * 又会被 `onCellDragEnd` 撤销，所以「取消合并」只有这条路可走。
 *
 * 用 mousedown 而不是 click：格子的 mouseup 会走「单击 = 进入这一格」的分支把选区清掉。
 */
function openCornerMenu(row: number, col: number) {
  const blockId = props.blockId
  if (!blockId) return
  // 被覆盖格不该有热区（没有 DOM），但坐标归一仍然做一遍，防止将来热区扩到别处
  const origin = anchorFor(merges.value, row, col)
  const rect = mergeRectAt(merges.value, row, col)
  const range: CellRange = rect
    ? { row1: rect.row1, col1: rect.col1, row2: rect.row2, col2: rect.col2 }
    : { row1: origin.row, col1: origin.col, row2: origin.row, col2: origin.col }
  const anchor = tableEl.value?.querySelector<HTMLElement>(
    `td[data-row="${range.row1}"][data-col="${range.col1}"]`,
  )
  if (!anchor) return
  closeRangeMenu()
  // 与拖选手势同一口径：先撤掉格内插入光标 / 原生选区，再写格选区，
  // 否则「刚点过某格」的 caret 会和整块选区同时显示。
  dropNativeTextSelection()
  selection?.setCellSelection({
    blockId,
    anchor: { row: range.row1, col: range.col1 },
    head: { row: range.row2, col: range.col2 },
  })
  rangeMenu.value = { anchor, range, kind: 'cells' }
}

// ── 二级浮层（对齐下拉 / 取色面板）──────────────────────────────
// 定位（目标上方优先）、Esc（window 捕获，只关二级）、滚动收起全部收口在
// `FloatingSubmenu`；这里只负责「同一时刻最多开一个」与记住触发按钮。

function openSubmenu(kind: SubmenuKind, anchor: HTMLElement) {
  if (submenu.value === kind) {
    submenu.value = null
    return
  }
  submenuAnchor.value = anchor
  submenu.value = kind
}

/** 菜单打开期间该段保持升档，避免锚点视觉断开 */
function isColActive(index: number): boolean {
  // 「+」跨在列边界上：光标压在它右半边时，hover 命中的是右边那段条，
  // 但「+」语义上属于左列（在它右侧插入）。升档跟着「+」走，否则高亮与按钮对不上。
  const hot = plusHot.value
  if (hot?.kind === 'col') return hot.index === index
  const menu = rangeMenu.value
  return activeCol.value === index || (menu?.kind === 'col' && menu.range.col1 === index)
}

function isRowActive(index: number): boolean {
  const hot = plusHot.value
  if (hot?.kind === 'row') return hot.index === index
  const menu = rangeMenu.value
  return activeRow.value === index || (menu?.kind === 'row' && menu.range.row1 === index)
}

function setActiveCol(index: number) {
  activeCol.value = index
  activeRow.value = null
}

function setActiveRow(index: number) {
  activeRow.value = index
  activeCol.value = null
}

/** 「+」的圆心就在条的长轴端点上：列条在右端、行条在底端 */
function isPlusHot(kind: EntryKind, index: number): boolean {
  const hot = plusHot.value
  return !!hot && hot.kind === kind && hot.index === index
}

/**
 * 按几何位置判定「+」热区，不能按「哪一段条被 hover」判定：
 * 「+」落在列边界上，光标压过去时命中的是**右边那一段**条，它自己的「+」还在 148px 外，
 * 于是永远点不到。这里用条几何（已含 root 相对坐标）直接算光标到「+」圆心的距离。
 */
function onRootMouseMove(e: MouseEvent) {
  // 拖滚动滑块时鼠标必然贴着行条末端滑过，别让「+」热区被误触发
  if (hDrag) {
    if (plusHot.value) plusHot.value = null
    return
  }
  const root = rootEl.value
  if (!root) return
  const r = root.getBoundingClientRect()
  const mx = e.clientX - r.left
  const my = e.clientY - r.top
  const near = (cx: number, cy: number) =>
    Math.abs(mx - cx) <= PLUS_HOT_RADIUS && Math.abs(my - cy) <= PLUS_HOT_RADIUS

  let next: { kind: EntryKind; index: number } | null = null
  for (const s of colStrips.value) {
    // 被裁掉的末列：「+」在可视区之外，热区也不能在那儿
    if (s.hidden || s.clipped) continue
    if (near(s.left + s.width, s.top + s.height / 2)) {
      next = { kind: 'col', index: s.index }
      break
    }
  }
  if (!next) {
    // 表格底边以下是滚动条的领地：末行「+」的热区与滑块左端会重叠，拖滑块时容易误点成插入行
    const box = tableBox.value
    const belowTable = my > box.top + box.height + 1
    for (const s of rowStrips.value) {
      if (belowTable) break
      // 表头行底边的「+」同样要有热区：它负责在表头下方插入第一行数据
      if (s.hidden) continue
      if (near(s.left + s.width / 2, s.top + s.height)) {
        next = { kind: 'row', index: s.index }
        break
      }
    }
  }
  if (next?.kind !== plusHot.value?.kind || next?.index !== plusHot.value?.index) plusHot.value = next
}

function clearActive() {
  activeCol.value = null
  activeRow.value = null
  plusHot.value = null
}

function clearActiveCol() {
  activeCol.value = null
  if (plusHot.value?.kind === 'col') plusHot.value = null
}

function clearActiveRow() {
  activeRow.value = null
  if (plusHot.value?.kind === 'row') plusHot.value = null
}

/** 结构变更后条与菜单的 index 全部失效，统一收口 */
function resetEntries() {
  closeRangeMenu()
  clearActive()
}

function swapRows(a: number, b: number) {
  const next = rows.value.map(row => [...row])
  const tmp = next[a]!
  next[a] = next[b]!
  next[b] = tmp
  rows.value = next
}

function swapCols(a: number, b: number) {
  rows.value = rows.value.map((row) => {
    const next = [...row]
    const tmp = next[a]!
    next[a] = next[b]!
    next[b] = tmp
    return next
  })
}

/** 移动后把焦点从原位置带到新位置（焦点不在被移动的行/列时不动） */
function followActiveRow(from: number, to: number) {
  const active = activeCell.value
  if (active?.row === from) focusCell(to, active.col, 'end')
}

function followActiveCol(from: number, to: number) {
  const active = activeCell.value
  if (active?.col === from) focusCell(active.row, to, 'end')
}

// ── 范围操作 ──────────────────────────────────────────────────────
// 所有菜单动作都从这里走：目标是一个 CellRange（整行 / 整列 / 拖出来的矩形）。

/** 只读态（未激活的渲染态）点菜单项先激活块：没有可编辑实例就改不了文档 */
async function ensureEditable(): Promise<boolean> {
  if (!props.readonly) return true
  if (!props.blockId) return false
  editorStore.activateBlock(props.blockId)
  await nextTick()
  return true
}

/**
 * 菜单动作统一入口：先冻结范围再关菜单。
 * 关菜单是必须的——只读态激活会重建单元格 DOM，锚点元素随之失效；
 * 而范围本身已复制成快照，不受行列增删影响。
 */
async function runRange(
  action: (range: CellRange) => void | Promise<void>,
  options: { editable?: boolean; keepOpen?: boolean } = {},
) {
  const state = rangeMenu.value
  if (!state) return
  const range = { ...state.range }
  // keepOpen 只对已激活的表格成立：只读态激活会重建单元格 DOM，锚点元素随即失效
  if (options.keepOpen === true && !props.readonly) {
    submenu.value = null
  } else {
    closeRangeMenu()
  }
  if (options.editable !== false) {
    const editable = await ensureEditable()
    if (!editable) return
  }
  await action(range)
}

/** 复制范围：内部剪贴板（矩形）+ 系统剪贴板（TSV） */
async function copyRange(range: CellRange) {
  const data = dataSnapshot.value
  if (!isWithinTable(data, range)) return
  setTableClipboard(cellRangeToMatrix(data, range))
  try {
    await writePlainTextToClipboard(cellRangeToTsv(data, range))
  } catch {
    // 系统剪贴板不可用（无权限 / 非安全上下文）：内部剪贴板已写入，剪切/复制照常成立
  }
}

/** 剪切范围 = 复制 + 清空内容（结构保留） */
async function cutRange(range: CellRange) {
  await copyRange(range)
  if (!cellRangeHasContent(dataSnapshot.value, range)) return
  applyData(clearCellRange(dataSnapshot.value, range))
}

function pasteRange(range: CellRange) {
  const matrix = getTableClipboard()
  if (!matrix || matrix.length === 0) return
  applyData(writeRangeIntoData(dataSnapshot.value, range, matrix))
}

/** 清空内容：矩形全空时不写库（避免制造一条无变更的保存，与删除键同口径） */
function clearRange(range: CellRange) {
  if (!cellRangeHasContent(dataSnapshot.value, range)) return
  applyData(clearCellRange(dataSnapshot.value, range))
}

/** 把当前范围合并成一块。范围会在 `runRange` 里先冻结成快照，关菜单不影响 */
function mergeSelection() {
  void runRange((range) => {
    const rect: MergeRect = { row1: range.row1, col1: range.col1, row2: range.row2, col2: range.col2 }
    applyData(mergeRange(dataSnapshot.value, rect))
    selection?.clearCellSelection()
  })
}

/** 取消范围内所有相交的合并区（内容留在各自左上格，不丢） */
function unmergeSelection() {
  void runRange((range) => {
    const rect: MergeRect = { row1: range.row1, col1: range.col1, row2: range.row2, col2: range.col2 }
    applyData(unmergeRange(dataSnapshot.value, rect))
  })
}

function alignRange(range: CellRange, align: TableAlign) {
  applyData(applyAlignToRange(dataSnapshot.value, range, align))
}

/** 删行：表只剩一行时 removeRow 是「清空」，对齐键不能跟着前移 */
function removeRowAt(index: number) {
  if (rows.value.length > 1) {
    aligns.value = removeRowFromAligns(aligns.value, index)
    cellMarks.value = removeRowFromCellMarks(cellMarks.value, index) ?? {}
    // 撞到合并区直接拆开（禁止会让人删不掉行）
    merges.value = removeRowFromMerges(merges.value, index)
  }
  rows.value = removeRow(rows.value, index)
}

function removeColumnAt(index: number) {
  if (cols.value > 1) {
    aligns.value = removeColumnFromAligns(aligns.value, index)
    cellMarks.value = removeColumnFromCellMarks(cellMarks.value, index) ?? {}
    merges.value = removeColumnFromMerges(merges.value, index)
  }
  rows.value = removeColumn(rows.value, index)
}

function deleteRowsInRange(range: CellRange) {
  for (let row = range.row2; row >= range.row1; row -= 1) removeRowAt(row)
  selection?.clearCellSelection()
  persist()
  resetEntries()
}

function deleteColumnsInRange(range: CellRange) {
  for (let col = range.col2; col >= range.col1; col -= 1) removeColumnAt(col)
  selection?.clearCellSelection()
  persist()
  resetEntries()
}

function moveRowInRange(range: CellRange, delta: -1 | 1) {
  const index = range.row1
  if (range.row1 !== range.row2) return
  // 表头行既不能上移也不能下移：表头标记与首行绑定，移走就错位
  if (index < bodyStart.value) return
  if (delta < 0 && index <= bodyStart.value) return
  if (delta > 0 && index >= rows.value.length - 1) return
  aligns.value = swapRowsInAligns(aligns.value, index, index + delta)
  cellMarks.value = swapRowsInCellMarks(cellMarks.value, index, index + delta) ?? {}
  merges.value = swapRowsInMerges(merges.value, index, index + delta)
  swapRows(index, index + delta)
  followActiveRow(index, index + delta)
  persist()
  resetEntries()
}

function moveColumnInRange(range: CellRange, delta: -1 | 1) {
  const index = range.col1
  if (range.col1 !== range.col2) return
  if (delta < 0 && index <= 0) return
  if (delta > 0 && index >= cols.value - 1) return
  aligns.value = swapColumnsInAligns(aligns.value, index, index + delta)
  cellMarks.value = swapColumnsInCellMarks(cellMarks.value, index, index + delta) ?? {}
  merges.value = swapColumnsInMerges(merges.value, index, index + delta)
  swapCols(index, index + delta)
  followActiveCol(index, index + delta)
  persist()
  resetEntries()
}

// 模板用的零参包装：把「当前范围」交给 runRange 统一冻结
const copyRangeAction = () => runRange(copyRange, { editable: false })
const cutRangeAction = () => runRange(cutRange)
const pasteRangeAction = () => runRange(pasteRange)
const clearRangeAction = () => runRange(clearRange)
const deleteRowAction = () => runRange(deleteRowsInRange)
const deleteColAction = () => runRange(deleteColumnsInRange)
const moveRowUpAction = () => runRange(range => moveRowInRange(range, -1))
const moveRowDownAction = () => runRange(range => moveRowInRange(range, 1))
const moveColLeftAction = () => runRange(range => moveColumnInRange(range, -1))
const moveColRightAction = () => runRange(range => moveColumnInRange(range, 1))

function setRangeAlign(align: TableAlign) {
  void runRange(range => alignRange(range, align), { keepOpen: true })
}

// ── 格选区（表格两段式选择）──────────────────────────────────────
// 光标留在起点格内 → 该格内的原生文本选择（textarea 原生 / 渲染态 span 原生）；
// 光标离开起点格 → 整格矩形选区（行列都含端点）。
//
// 格坐标只有表格知道，所以手势与高亮在这里；选区本体由 useCrossBlockSelection 统一持有
// （判别联合的第三态），复制 / 删除走 BlockList 的键盘分派表，与块选区、文本选区互斥。
// 表格不再进入跨块文本选区（见 useBlockEditorLifecycle）：把单元格按行优先拼成一条
// 字符流时，「从 A 格拖到 A 下方的格」在偏移上已经越过整行后面的 B 格。

const selection = inject<CrossBlockSelection | null>('crossBlockSelection', null)

interface CellDragState {
  row: number
  col: number
  x: number
  y: number
  moved: boolean
  /** 本手势出过格、起点格已被撤焦（决定松手时是否值得把光标还回去） */
  detached?: boolean
}

let cellDrag: CellDragState | null = null
/** 与文本拖拽同一阈值：小于它算单击（激活编辑），不产生选区 */
const CELL_DRAG_THRESHOLD_PX = 4
/** 格选区色块（块根坐标），与文本选区同色 */
const cellSelBoxes = ref<Array<{ left: number; top: number; width: number; height: number }>>([])

/** 指针下的格坐标；不属于本表（含落在条 / 菜单 / 表格外）时返回 null */
function cellAtPoint(x: number, y: number): CellRef | null {
  const table = tableEl.value
  if (!table) return null
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  const td = el?.closest?.('td') as HTMLElement | null
  if (!td || !table.contains(td)) return null
  const row = Number(td.dataset.row)
  const col = Number(td.dataset.col)
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null
  return { row, col }
}

/**
 * 出格后清掉浏览器原生文本选区，并撤掉格内可编辑区的焦点。
 *
 * 两段式的分界线就在这里：格内的高亮归浏览器原生选择（渲染态 div / 编辑态 contenteditable），
 * 一旦跨出起点格，跨格的原生区间必须立刻收掉，否则它会和整格色块同时画出
 * 「B 格文字被选中」的假象——这正是本次要修的现象本身。
 *
 * 焦点必须一并撤：只要起点格的可编辑区还持焦，浏览器每次 mousemove 都要刷新它的
 * 原生选区，输入法工具栏（候选窗 / 软键盘）就被反复唤醒、一直闪。整格选区不需要格内光标。
 * 撤焦还有个必要副作用——键盘事件的 target 落回 body，BlockList 的文档级分派表才接得住
 * Ctrl+C / Delete（焦点在可编辑控件里会被 `isInEditableInput` 豁免掉，格选区反倒吃不到键）。
 */
function dropNativeTextSelection() {
  window.getSelection()?.removeAllRanges()
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !active.classList.contains('cell-input')) return
  if (!tableEl.value?.contains(active)) return
  // 先落库再失焦：blur 会触发 onCellBlur 的 flushSave，这里提前显式落一次，
  // 避免拖拽末尾敲的几个字卡在「失焦 → 手势收尾」之间没写下去。
  flushSave()
  active.blur()
  if (cellDrag) cellDrag.detached = true
}

/**
 * 表格内禁止原生拖拽（dragstart）。
 *
 * 一旦格内已有原生文字选区，再从选区内按下并拖动，浏览器会切进原生 DnD：
 * 期间 document 上不再派发 mousemove，两段式手势整段失效，松手还会把文字拖到别处。
 * 表格没有「拖字出去」「拖字进格」的需求，直接把拖拽关掉，手势才能一直归我们。
 */
function onCellDragStart(e: DragEvent) {
  e.preventDefault()
}

function onCellMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  if (!props.blockId) return
  const td = (e.target as HTMLElement | null)?.closest?.('td') as HTMLElement | null
  if (!td || !tableEl.value?.contains(td)) return
  // 在表格里重新起手：上一次的范围工具条先收起，松手后按新范围重新浮出
  closeRangeMenu()
  const row = Number(td.dataset.row)
  const col = Number(td.dataset.col)
  if (!Number.isFinite(row) || !Number.isFinite(col)) return
  cellDrag = { row, col, x: e.clientX, y: e.clientY, moved: false }
  document.addEventListener('mousemove', onCellDragMove)
  document.addEventListener('mouseup', onCellDragEnd)
}

/**
 * 离指针最近的格：指针已离开表格（拖过表底 / 表右）时用它兜住端点。
 *
 * 拖出表格边界仍属同一次手势，端点应当停在最边上那一格而不是原地冻住，
 * 更不能因为「没有命中任何格」就放开原生选区让它去选中旁边的块。
 */
function nearestCell(x: number, y: number): CellRef | null {
  const table = tableEl.value
  if (!table) return null
  let best: CellRef | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const td of Array.from(table.querySelectorAll<HTMLElement>('td[data-row][data-col]'))) {
    const r = td.getBoundingClientRect()
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      bestDist = dist
      best = { row: Number(td.dataset.row), col: Number(td.dataset.col) }
    }
  }
  return best
}

function onCellDragMove(e: MouseEvent) {
  const drag = cellDrag
  if (!drag) return
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < CELL_DRAG_THRESHOLD_PX) return
    drag.moved = true
  }
  const target = cellAtPoint(e.clientX, e.clientY) ?? nearestCell(e.clientX, e.clientY)
  if (!target) return
  const sameCell = target.row === drag.row && target.col === drag.col
  if (sameCell) {
    // 拖回起点格：撤销格选区，把选区交还该格内的原生文本选择
    if (selection?.cellSelection.value) selection.clearCellSelection()
    return
  }
  // 每次出格移动都清一遍：浏览器在自己的拖拽状态里仍会不断延伸原生区间，
  // 清一次不够，下一次 mousemove 又会长出来（编辑态 textarea 尤其明显）。
  dropNativeTextSelection()
  selection?.setCellSelection({
    blockId: props.blockId ?? '',
    anchor: { row: drag.row, col: drag.col },
    head: target,
  })
}

async function onCellDragEnd() {
  const drag = cellDrag
  cellDrag = null
  document.removeEventListener('mousemove', onCellDragMove)
  document.removeEventListener('mouseup', onCellDragEnd)

  if (drag?.moved) {
    // 出格拖拽：mouseup 这一刻浏览器会按自己的锚点再延伸一次原生区间，
    // 不在这里最后清一遍，松手瞬间就会重新出现「B 格文字被选中」的残影。
    if (selection?.cellSelection.value) {
      dropNativeTextSelection()
      // 选区成形即浮出工具条（行列条菜单与格选区菜单是同一个范围菜单）
      openCellMenu()
      return
    }
    // 拖出去又拖回起点格（格选区已撤销）：把光标还给这一格，用户可以接着输入。
    // 只在松手后回焦，手势途中不碰焦点——途中反复 focus 正是输入法工具栏闪烁的来源。
    // 且只对「出过格」的手势生效：格内正常选字从没撤过焦，贸然 focusCell 会把刚选中的文字折叠掉。
    if (drag.detached && !props.readonly) focusCell(drag.row, drag.col, 'end')
    return
  }

  // 单击：先撤掉遗留的格选区（格内单击的语义是「进入这一格」，不是「追加选区」），
  // 再在渲染态激活表格并聚焦该格。表格不再走跨块文本拖拽，
  // 原先挂在 mouseup 上的「内容区单击激活」路径也就不再命中。
  if (!drag) return
  if (selection?.cellSelection.value) selection.clearCellSelection()
  if (!props.readonly || !props.blockId) return
  // 坐标必须走 store 交接：激活会把本组件重新挂载，局部 ref 活不过去
  editorStore.setTableCellFocus({ blockId: props.blockId, row: drag.row, col: drag.col })
  editorStore.activateBlock(props.blockId)
}

/** readonly 翻转后补聚焦：若某处复用同一实例（不触发重挂载），mount 钩子跑不到 */
watch(
  () => props.readonly,
  (readonly) => {
    if (readonly) return
    // 渲染态的 `.cell-text` 换成空的可编辑区：先补内容（focusCell 的选区不能被重写清掉）
    void nextTick(refreshCells)
    const cell = editorStore.consumeTableCellFocus(props.blockId)
    if (cell) {
      handoffApplied = true
      void nextTick(() => focusCell(cell.row, cell.col, 'end'))
    } else {
      // 没有交接坐标时，像素坐标才是唯一依据 —— 别让上一次交接的标记把这次也挡掉
      handoffApplied = false
    }
  },
)

/**
 * 祖先 transform 的缩放系数（布局宽度不受 transform 影响，视口矩形受影响）。
 *
 * 每个新挂载的 block 都播 block-enter（300ms，scale 0.96 → 1，见 _block.scss）。
 * 挂载那一帧量到的视口坐标全被缩小了，而条 / 色块用的是「相对块根的 inline px」
 * （布局坐标）：直接写进去，动画结束后会永久偏小一圈。ResizeObserver 只报 border-box，
 * transform 不改变布局尺寸，不会兜底重测，所以必须在测量时自己换算。
 */
function viewportScaleOf(table: HTMLElement): number {
  const layoutWidth = table.offsetWidth
  return layoutWidth > 0 ? table.getBoundingClientRect().width / layoutWidth : 1
}

/** 量格选区色块（块根坐标）。行列越界 / 不属于本块时清空。 */
function measureCellSelection() {
  const sel = selection?.cellSelection.value
  const root = rootEl.value
  const table = tableEl.value
  if (!sel || !root || !table || sel.blockId !== props.blockId) {
    if (cellSelBoxes.value.length > 0) cellSelBoxes.value = []
    return
  }
  const range = normalizeCellRange(sel.anchor, sel.head)
  const rootRect = root.getBoundingClientRect()
  const scale = viewportScaleOf(table)
  const boxes: Array<{ left: number; top: number; width: number; height: number }> = []
  // 被合并覆盖的格没有 DOM：按合并区左上格去重，一个合并区只画一整块，
  // 否则「只选了合并区里的一格」会一条带都画不出来（缺格）或重复叠色。
  const drawn = new Set<string>()
  for (let row = range.row1; row <= range.row2; row++) {
    for (let col = range.col1; col <= range.col2; col++) {
      const origin = anchorFor(merges.value, row, col)
      const key = cellKey(origin.row, origin.col)
      if (drawn.has(key)) continue
      const td = table.querySelector<HTMLElement>(`td[data-row="${origin.row}"][data-col="${origin.col}"]`)
      if (!td) continue
      drawn.add(key)
      const box = td.getBoundingClientRect()
      boxes.push({
        left: (box.left - rootRect.left) / scale,
        top: (box.top - rootRect.top) / scale,
        width: box.width / scale,
        height: box.height / scale,
      })
    }
  }
  cellSelBoxes.value = boxes
}

watch(
  () => selection?.cellSelection.value ?? null,
  () => {
    void nextTick(measureCellSelection)
  },
)

/** 点在表格之外 → 撤销格选区：格选区只对所属的那张表有意义 */
function onDocMouseDownCapture(e: MouseEvent) {
  if (!selection?.cellSelection.value) return
  const target = e.target as HTMLElement | null
  if (target?.closest?.('.table-block') === rootEl.value) return
  // 范围工具条与它的二级浮层都 Teleport 到 body，落在「表格之外」的判定里。
  // 不豁免的话，点菜单项会先把格选区清掉，操作就对着空范围执行了。
  // 用 blockId 限定，避免别的表格块的菜单被当成本块的白名单。
  if (props.blockId && target?.closest?.(overlaySelector.value)) return
  selection.clearCellSelection()
}

// ── 条几何测量 ────────────────────────────────────────────────────
// 条的位置只在「布局变化」时重算（挂载、行列数变化、表格尺寸变化、横向滚动），
// 不跟随 mousemove —— L2 的触发完全交给条元素自身的 mouseenter。

const sameStrips = (a: StripGeometry[], b: StripGeometry[]) =>
  a.length === b.length
  && a.every((s, i) => {
    const t = b[i]!
    return s.index === t.index && s.left === t.left && s.top === t.top && s.width === t.width
      && s.height === t.height && s.hidden === t.hidden && s.clipped === t.clipped
      && s.first === t.first && s.last === t.last
  })

/** 亚像素容差：clientWidth 取整后可能比表格窄不到 1px，不能据此判定「被裁掉」 */
const CLIP_EPSILON = 1

/** 横向滑块最小长度：过短既难点中，也看不出还能滚多远 */
const HSCROLL_MIN_THUMB = 36
/** 滑块与表格底边的间隙（下方留白 8px = 2px 间隙 + 6px 滑块） */
const HSCROLL_GAP = 2

/** 只有真的溢出才给滚动条：差 1px 以内算不溢出，避免无溢出时凭空多出一条 */
function measureHScroll(rootRect: DOMRect, tableRect: DOMRect, scale: number) {
  const scroll = scrollEl.value
  if (!scroll) return
  const max = scroll.scrollWidth - scroll.clientWidth
  if (max <= CLIP_EPSILON) {
    if (hScroll.value) hScroll.value = null
    return
  }
  const trackWidth = scroll.clientWidth
  const width = Math.min(trackWidth, Math.max(HSCROLL_MIN_THUMB, (trackWidth * trackWidth) / scroll.scrollWidth))
  const shift = max > 0 ? (scroll.scrollLeft / max) * (trackWidth - width) : 0
  const left = (scroll.getBoundingClientRect().left - rootRect.left) / scale + scroll.clientLeft + shift
  const top = (tableRect.bottom - rootRect.top) / scale + HSCROLL_GAP
  const prev = hScroll.value
  if (
    prev
    && Math.abs(prev.left - left) < 0.5
    && Math.abs(prev.top - top) < 0.5
    && Math.abs(prev.width - width) < 0.5
    && prev.max === max
  ) {
    // 位置没变也要更新 now（屏幕阅读器读的当前值）
    if (prev.now !== scroll.scrollLeft) prev.now = scroll.scrollLeft
    return
  }
  hScroll.value = { left, top, width, now: scroll.scrollLeft, max }
}

const hScrollStyle = computed(() => {
  const s = hScroll.value
  return s ? { left: `${s.left}px`, top: `${s.top}px`, width: `${s.width}px` } : undefined
})

function measureStrips() {
  const root = rootEl.value
  const table = tableEl.value
  const scroll = scrollEl.value
  if (!root || !table) return
  const rootRect = root.getBoundingClientRect()
  const tableRect = table.getBoundingClientRect()
  // 下面所有 inline px 都是「相对块根的布局坐标」，而 rect 是视口坐标。祖先带 transform 缩放时
  // 两者差一个 scale（block-enter 动画首帧 = 0.96），必须先换算，否则动画结束条就永久错位。
  const scale = viewportScaleOf(table)
  const localX = (clientX: number) => (clientX - rootRect.left) / scale
  const localY = (clientY: number) => (clientY - rootRect.top) / scale
  // 滚动条与编辑无关：只读表格同样可能列超宽，必须在只读早退之前测
  measureHScroll(rootRect, tableRect, scale)
  // 格选区色块同理：拖拽发生在渲染态（readonly），早退之后测就永远画不出来
  measureCellSelection()
  // 行列条与菜单入口两态一致（渲染态 hover 同样要出条），因此这里不再区分 readonly：
  // 渲染态的 td 同样带 data-row/data-col，几何口径完全一样。
  // 一切几何都以表格边框盒为唯一基准：滚动容器的盒子比表格宽（含左侧 gutter 与右侧余量），
  // 用它算出来的条会左溢 / 悬空 / 右超。
  tableBox.value = {
    left: localX(tableRect.left),
    top: localY(tableRect.top),
    width: tableRect.width / scale,
    height: tableRect.height / scale,
  }
  const box = tableBox.value

  // 列数超宽时表格被 .table-scroll 裁在可视宽度内，条不能跟着整表宽度画到背景上去。
  // 可视区 = 滚动容器客户区 ∩ 表格盒子，取并集会在窄表时把条拉长。
  const scrollRect = scroll ? scroll.getBoundingClientRect() : null
  const viewLeft = scrollRect
    ? Math.max(localX(scrollRect.left) + scroll!.clientLeft, box.left)
    : box.left
  const viewRight = scrollRect
    ? Math.min(localX(scrollRect.left) + scroll!.clientLeft + scroll!.clientWidth, box.left + box.width)
    : box.left + box.width
  visibleBox.value = { left: viewLeft, right: viewRight }

  const trs = Array.from(table.querySelectorAll('tr'))
  // 列条不能只看第一行：表头被合并（colspan）时那一行会缺段，且数组下标 ≠ 真实列号，
  // 点列条会操作到错误的列。改用所有「未跨列」的 td 建列 → 单列宽表，按 data-col 索引。
  const colRects = new Map<number, DOMRect>()
  for (const td of Array.from(table.querySelectorAll<HTMLTableCellElement>('td[data-col]'))) {
    if (td.colSpan > 1) continue
    const col = Number(td.dataset.col)
    if (!Number.isInteger(col) || colRects.has(col)) continue
    colRects.set(col, td.getBoundingClientRect())
  }
  const nextCols: StripGeometry[] = []
  for (let col = 0; col < cols.value; col += 1) {
    const rect = colRects.get(col)
    if (!rect) continue
    nextCols.push({
      index: col,
      left: localX(rect.left),
      top: box.top - ENTRY_THICKNESS,
      width: rect.width / scale,
      height: ENTRY_THICKNESS,
      hidden: false,
      clipped: false,
      first: false,
      last: false,
    })
  }
  // 首尾段对齐表格边框盒：border-collapse 下单元格 rect 带半像素误差，逐段累积会在两端露出缝
  const firstCol = nextCols[0]
  if (firstCol) firstCol.left = box.left
  const lastCol = nextCols[nextCols.length - 1]
  if (lastCol) lastCol.width = box.left + box.width - lastCol.left

  // 再按可视区收口：越界的左端贴到可视左边，右端裁到可视右边；
  // 只有真的超出一个像素才算被裁（否则末列的「+」会因为 clientWidth 取整而消失）
  for (const strip of nextCols) {
    const rawLeft = strip.left
    const rawRight = rawLeft + strip.width
    const right = rawRight > viewRight + CLIP_EPSILON ? viewRight : rawRight
    const left = rawLeft < viewLeft - CLIP_EPSILON ? viewLeft : rawLeft
    strip.clipped = right < rawRight - CLIP_EPSILON
    strip.left = left
    strip.width = Math.max(0, right - left)
    strip.hidden = strip.width <= 0.5
  }
  markVisibleEdges(nextCols)

  const nextRows: StripGeometry[] = []
  trs.forEach((tr, index) => {
    // 用 tr 自身几何：合并区跨行时被覆盖的行可能整行没有 td，但仍是一行（可能被压到 0 高）
    const r = tr.getBoundingClientRect()
    if (r.height <= 0) return
    nextRows.push({
      index,
      // 行条贴的是「表格此刻可见的左缘」而不是内容左缘：横向滚动后内容左缘会跑到屏幕外，
      // 用它算行条会跟着内容一起左移、直接消失
      left: viewLeft - ENTRY_THICKNESS,
      top: localY(r.top),
      width: ENTRY_THICKNESS,
      height: r.height / scale,
      hidden: false,
      clipped: false,
      first: false,
      last: false,
    })
  })
  const firstRow = nextRows[0]
  if (firstRow) firstRow.top = box.top
  const lastRow = nextRows[nextRows.length - 1]
  if (lastRow) lastRow.height = box.top + box.height - lastRow.top
  markVisibleEdges(nextRows)

  if (!sameStrips(colStrips.value, nextCols)) colStrips.value = nextCols
  if (!sameStrips(rowStrips.value, nextRows)) rowStrips.value = nextRows
}

/** 圆头只给「渲染出来的那条带子」的两端：首段左端、末段右端，中间段保持直角才能拼成连续长条 */
function markVisibleEdges(strips: StripGeometry[]) {
  const rendered = strips.filter(s => !s.hidden)
  const first = rendered[0]
  const last = rendered[rendered.length - 1]
  if (first) first.first = true
  if (last) last.last = true
}

/** 横向滚动会改变 td 相对块根的 left，必须重测 */
function onTableScroll() {
  clearActive()
  measureStrips()
}

// ── 横向滚动滑块拖拽 ─────────────────────────────────────────────
// 滑块 6px 高，却要驱动上千像素的内容：位移按「轨道可走距离」等比映射，不做像素跟随。

let hDrag: { startX: number; startScroll: number; span: number; max: number } | null = null

function onHScrollPointerDown(e: PointerEvent) {
  const scroll = scrollEl.value
  const geo = hScroll.value
  if (!scroll || !geo) return
  hDrag = {
    startX: e.clientX,
    startScroll: scroll.scrollLeft,
    span: Math.max(1, scroll.clientWidth - geo.width),
    max: Math.max(0, scroll.scrollWidth - scroll.clientWidth),
  }
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  e.preventDefault()
}

function onHScrollPointerMove(e: PointerEvent) {
  const drag = hDrag
  const scroll = scrollEl.value
  if (!drag || !scroll) return
  const dx = e.clientX - drag.startX
  scroll.scrollLeft = drag.startScroll + (dx / drag.span) * drag.max
}

function onHScrollPointerEnd(e: PointerEvent) {
  if (!hDrag) return
  hDrag = null
  try {
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  } catch {
    /* 指针已释放 */
  }
}

/** 引导线是「插入」的预告，跟「+」同生共死；只看条升档会误导成「点了条就插入」 */
const colGuideStyle = computed(() => {
  const hot = plusHot.value
  if (hot?.kind !== 'col') return undefined
  const strip = colStrips.value[hot.index]
  if (!strip) return undefined
  return {
    left: `${strip.left + strip.width - 1}px`,
    top: `${tableBox.value.top}px`,
    height: `${tableBox.value.height}px`,
  }
})

const rowGuideStyle = computed(() => {
  const hot = plusHot.value
  if (hot?.kind !== 'row') return undefined
  const strip = rowStrips.value[hot.index]
  if (!strip) return undefined
  // 横向引导线同样只画在可视宽度内，否则列超宽时它会伸到背景上去
  const view = visibleBox.value
  return {
    left: `${view.left}px`,
    top: `${strip.top + strip.height - 1}px`,
    width: `${Math.max(0, view.right - view.left)}px`,
  }
})

// ── 「+」一键插入 ────────────────────────────────────────────────

/** 在第 index 行下方插入一行，保持当前单元格焦点（行号按插入位置顺移） */
function insertRowAt(index: number) {
  const insertAt = index + 1
  aligns.value = addRowToAligns(aligns.value, insertAt)
  cellMarks.value = addRowToCellMarks(cellMarks.value, insertAt) ?? {}
  merges.value = addRowToMerges(merges.value, insertAt)
  rows.value = addRow(rows.value, insertAt)
  const cell = activeCell.value
  persist()
  clearActive()
  // 渲染态没有输入框可聚焦：插入后激活块，由 store 交接坐标把光标落到新行首格
  if (props.readonly) {
    if (!props.blockId) return
    editorStore.setTableCellFocus({ blockId: props.blockId, row: insertAt, col: 0 })
    editorStore.activateBlock(props.blockId)
    return
  }
  if (cell) focusCell(cell.row >= insertAt ? cell.row + 1 : cell.row, cell.col, 'end')
}

/** 在第 index 列右侧插入一列，保持当前单元格焦点（列号按插入位置顺移） */
function insertColumnAt(index: number) {
  const insertAt = index + 1
  aligns.value = addColumnToAligns(aligns.value, insertAt)
  cellMarks.value = addColumnToCellMarks(cellMarks.value, insertAt) ?? {}
  merges.value = addColumnToMerges(merges.value, insertAt)
  rows.value = addColumn(rows.value, insertAt)
  const cell = activeCell.value
  persist()
  clearActive()
  if (props.readonly) {
    if (!props.blockId) return
    // 渲染态没有输入框可聚焦：落点取首个表体行（纯表头表则退到第 0 行），再激活块
    const row = Math.min(bodyStart.value, Math.max(0, rows.value.length - 1))
    editorStore.setTableCellFocus({ blockId: props.blockId, row, col: insertAt })
    editorStore.activateBlock(props.blockId)
    return
  }
  if (cell) focusCell(cell.row, cell.col >= insertAt ? cell.col + 1 : cell.col, 'end')
}

function onRootClick(e: MouseEvent) {
  if (props.readonly) emit('content-click', e)
}

// ── 生命周期 / Block 编辑器契约 ───────────────────────────────────

let resizeObserver: ResizeObserver | undefined

onMounted(() => {
  // 先把文本 / 格式灌进各格，再落光标：重写 innerHTML 会清掉刚设好的选区
  refreshCells()
  if (!props.readonly) {
    // 渲染态单击某格激活时，要落的是**那一格**，不是首格（坐标由 store 交接，见 onCellDragEnd）
    const target = editorStore.consumeTableCellFocus(props.blockId)
    if (target) {
      handoffApplied = true
      focusCell(target.row, target.col, 'end')
    } else {
      focusFirstCell()
    }
  }
  void nextTick(() => {
    // 挂载这一帧所有格都还没对齐行高：先全量重量，再量条几何
    resizeAllCells()
    measureStrips()
    // 高度重量回来之后再还原滚动位置：塌陷那一帧浏览器已经把 scrollTop 钳掉了（见 pendingTableScroll）
    const scrollTop = editorStore.consumeTableScroll(props.blockId)
    if (scrollTop !== null) {
      const scroller = scrollAncestorOfTable()
      if (scroller) scroller.scrollTop = scrollTop
    }
  })
  window.addEventListener('resize', measureStrips)
  // 格内文本选区驱动行内格式工具条（工具条只在非折叠选区出现）
  document.addEventListener('selectionchange', onSelectionChange)
  // 点表格之外任意位置撤销格选区（表格内的点击由 onCellMouseDown 重新起选）
  document.addEventListener('mousedown', onDocMouseDownCapture, true)
  if (typeof ResizeObserver !== 'undefined') {
    // 容器变窄 → 列宽变窄 → 折行数变多，行高必须重算（不只是条几何）
    resizeObserver = new ResizeObserver(() => {
      resizeAllCells()
      measureStrips()
    })
    if (tableEl.value) resizeObserver.observe(tableEl.value)
    // 容器变窄（侧栏折叠等）时表格盒子不一定变（min-width 撑着），必须单独盯可视区
    if (scrollEl.value) resizeObserver.observe(scrollEl.value)
  }
})

// 行列数变化会重建单元格 DOM、合并区变化会改变行高与列段划分，条几何都随之失效
watch([() => rows.value.length, cols, merges, header], () => {
  void nextTick(() => {
    resizeAllCells()
    measureStrips()
  })
})

onBeforeUnmount(() => {
  // 卸载前记下滚动位置：编辑态首帧的格高塌陷会把滚动祖先的 scrollTop 钳掉（长表格底部单击
  // 页面会跳上去）。只记渲染态 —— 塌陷只发生在这一侧。
  if (props.readonly) {
    const scroller = scrollAncestorOfTable()
    if (scroller) editorStore.setTableScroll(props.blockId ?? '', scroller.scrollTop)
  }
  window.removeEventListener('resize', measureStrips)
  document.removeEventListener('selectionchange', onSelectionChange)
  document.removeEventListener('mousedown', onDocMouseDownCapture, true)
  document.removeEventListener('mousemove', onCellDragMove)
  document.removeEventListener('mouseup', onCellDragEnd)
  cellDrag = null
  resizeObserver?.disconnect()
  resizeObserver = undefined
  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  saveTimer = undefined
  flushSave()
})

defineExpose({
  syncContent: () => {},
  focus: () => focusFirstCell(),
  focusRange: () => {},
  getText: () => props.content ?? '',
  markSaved: () => {},
  getEditor: () => undefined as unknown as Editor,
  cancelDebouncedSave: () => {
    if (saveTimer !== undefined) window.clearTimeout(saveTimer)
    saveTimer = undefined
  },
  focusAtCoords: (x: number, y: number) => {
    // 交接坐标（格行列）已经落好光标：像素坐标是 mousedown 那一刻的视口坐标，此刻滚动位置
    // 可能已经变了，按它解析只会把光标改到另一格（见 handoffApplied）。只挡这一次。
    if (handoffApplied) {
      handoffApplied = false
      return
    }
    const hit = document.elementFromPoint(x, y) as HTMLElement | null
    // 落点未必正好压在输入框上（压在格线上、点在合并区被覆盖的一侧、非活动格只有 span），
    // 但只要能找到「格」就按格坐标落光标。找不到格才退回首格——
    // 早先按 textarea 找、找不到就 focusFirstCell，正是「点最后一行却跳到第一行」的来源。
    const td = hit?.closest?.('td[data-row][data-col]') as HTMLElement | null
    if (!td || !rootEl.value?.contains(td)) {
      // 光标已经落在本表某格里（挂载时按交接坐标落的，或刚被别处落好）就不要抢回首格：
      // 坐标解析失败（点在格线 / 表格留白 / 滚动与动画期间）不该成为「跳到第一行」的理由。
      if (rootEl.value?.contains(document.activeElement)) return
      focusFirstCell()
      return
    }
    focusCell(Number(td.dataset.row), Number(td.dataset.col), 'end')
  },
})
</script>

<template>
  <div
    ref="rootEl"
    class="table-block"
    :class="{
      'is-readonly': readonly,
      'is-col-menu-open': isColMenuOpen,
      'is-row-menu-open': isRowMenuOpen,
    }"
    data-text-atomic="true"
    @click="onRootClick"
    @mousedown="onCellMouseDown"
    @dragstart="onCellDragStart"
    @mousemove="onRootMouseMove"
    @mouseleave="clearActive"
  >
    <!-- 自带入口：仅 standaloneEntry 时渲染（Ideas 快照这类脱离 Block 外壳的场景）。
         外壳内入口统一由 Block/index.vue 的 .block-bullet 渲染，菜单也归外壳
         （ADR-0039 D9）；那边通过 useBlockEntryMenuExtra 取本组件的专属项。 -->
    <div
      v-if="standaloneEntry"
      class="table-entry"
    >
      <button
        ref="entryEl"
        type="button"
        class="table-menu-entry"
        title="表格菜单"
        aria-label="表格菜单"
        @mousedown.prevent
        @click.stop="toggleStandaloneMenu"
      >
        <TableProperties
          :size="12"
          :stroke-width="1.8"
        />
      </button>
    </div>

    <BasePopover
      :visible="menuOpen"
      :anchor-el="menuAnchor"
      placement="bottom"
      @close="menuOpen = false"
    >
      <div
        class="block-entry-menu"
        :data-table-menu="blockId"
        @mousedown.prevent
      >
        <!-- 类型专属项一律排在通用段上面：表格结构组（表头开关 / 均分列宽）→ 通用段。
             专属项抽成组件（外壳托管的菜单渲染的是同一份），两处定义不漂移；
             两行都走 BlockMenuItem，所以 .menu-row 的样式只有一处（common/BlockMenuItem.vue）。 -->
        <TableEntryMenuItems
          :header="header"
          @toggle-header="toggleHeader"
        />

        <!-- 通用段（缩进 / 复制剪切粘贴 / 清空 / 删除）：与所有块类型共用同一份实现与同一处顺序定义。
             类型专属项一律排在它上面，所以这里让通用段自带一条前置分隔线。 -->
        <BlockMenuCommon
          :block-id="blockId"
          @close="menuOpen = false"
        />
      </div>
    </BasePopover>

    <!-- 行 / 列操作条：贴表格外缘。块 hover 出基座，压在某段上升档（菜单入口），
         压在该段端点才浮出「+」（一键插入）。两态一致：渲染态 hover 同样出条。 -->
    <button
      v-for="strip in renderedColStrips"
      :key="`cs-${strip.index}`"
      type="button"
      class="strip strip--col"
      :class="{
        'is-active': isColActive(strip.index),
        'is-plus': isPlusHot('col', strip.index),
        'is-first': strip.first,
        'is-last': strip.last,
      }"
      aria-label="列操作"
      :style="{
        left: `${strip.left}px`,
        top: `${strip.top}px`,
        width: `${strip.width}px`,
        height: `${strip.height}px`,
      }"
      @mousedown.prevent
      @mouseenter="setActiveCol(strip.index)"
      @mouseleave="clearActiveCol"
      @click.stop="openStripMenu($event, 'col', strip.index)"
    >
      <span
        v-if="!strip.clipped"
        class="strip-plus"
        role="button"
        aria-label="插入列"
        @mousedown.prevent
        @click.stop="insertColumnAt(strip.index)"
      >
        <Plus
          :size="11"
          :stroke-width="2.5"
        />
        <span class="strip-tip strip-tip--above">插入列</span>
      </span>
    </button>
    <button
      v-for="strip in rowStrips"
      :key="`rs-${strip.index}`"
      type="button"
      class="strip strip--row"
      :class="{
        'is-active': isRowActive(strip.index),
        'is-plus': isPlusHot('row', strip.index),
        'is-first': strip.index === 0,
        'is-last': strip.index === rowStrips.length - 1,
      }"
      aria-label="行操作"
      :style="{
        left: `${strip.left}px`,
        top: `${strip.top}px`,
        width: `${strip.width}px`,
        height: `${strip.height}px`,
      }"
      @mousedown.prevent
      @mouseenter="setActiveRow(strip.index)"
      @mouseleave="clearActiveRow"
      @click.stop="openStripMenu($event, 'row', strip.index)"
    >
      <!-- 表头行的「+」= 在表头下方插入第一行数据；纯表头表全靠它开张，
           所以不能按 bodyStart 把 index 0 的入口屏蔽掉。 -->
      <span
        class="strip-plus"
        role="button"
        aria-label="插入行"
        @mousedown.prevent
        @click.stop="insertRowAt(strip.index)"
      >
        <Plus
          :size="11"
          :stroke-width="2.5"
        />
        <span class="strip-tip strip-tip--below">插入行</span>
      </span>
    </button>

    <!-- 引导线：与「+」同显隐，只预告「将插在哪」，1px 中性色 -->
    <div
      v-if="plusHot?.kind === 'col'"
      class="strip-guide strip-guide--col"
      :style="colGuideStyle"
    />
    <div
      v-if="plusHot?.kind === 'row'"
      class="strip-guide strip-guide--row"
      :style="rowGuideStyle"
    />

    <!-- 选区浮层：格内文本选区 / 格矩形 / 行条 / 列条 **同一个浮层**，区别只在菜单项。
         公共项（对齐 + B/I/U/S/A）恒在且位置固定在前面，结构项按选区类型增减；
         纯图标单行 + 竖线分组，不可用项不渲染（工具条随范围变形），
         「合并单元格」是未实现而非不可用，因此常驻置灰。 -->
    <BasePopover
      v-if="rangeMenu"
      :visible="true"
      :anchor-el="rangeMenu.anchor"
      :placement="rangeMenuPlacement"
      :modal="false"
      :ignore-outside-selector="overlaySelector"
      @close="closeRangeMenu"
    >
      <div
        class="range-menu"
        :data-table-menu="blockId"
        @mousedown.prevent
      >
        <!-- 公共段（对齐 + B/I/U/S/A）：与正文行内工具条是**同一个组件** ——
             顺序 / 字形 / 尺寸 / 激活态同源，两个入口的差异只允许出现在它之后的结构项。 -->
        <SelectionMarkRow
          :format="menuFormat"
          :align="rangeAlign"
          :open="submenu"
          @apply-mark="applyMenuMark"
          @toggle-align="(anchor: HTMLElement) => openSubmenu('align', anchor)"
          @toggle-palette="(anchor: HTMLElement) => openSubmenu('palette', anchor)"
        >
          <!-- 结构项：只对「格 / 行 / 列」范围成立。文本选区不表达结构，整组不渲染。 -->
          <template v-if="rangeMenu.kind !== 'text'">
            <span class="sel-sep" />
            <button
              v-if="canMerge"
              type="button"
              class="sel-btn"
              title="合并单元格"
              aria-label="合并单元格"
              @click="mergeSelection"
            >
              <TableCellsMerge :size="14" />
            </button>
            <button
              v-else-if="mergeBlocked"
              type="button"
              class="sel-btn"
              disabled
              title="表头与表体不能合并"
              aria-label="表头与表体不能合并"
            >
              <Merge :size="14" />
            </button>
            <button
              v-if="mergeTargets.length > 0"
              type="button"
              class="sel-btn sel-btn--link"
              title="取消合并"
              aria-label="取消合并"
              @click="unmergeSelection"
            >
              <TableCellsSplit :size="14" />
            </button>

            <span class="sel-sep" />

            <button
              type="button"
              class="sel-btn"
              title="复制"
              aria-label="复制"
              @click="copyRangeAction"
            >
              <Copy :size="14" />
            </button>
            <button
              type="button"
              class="sel-btn"
              title="剪切"
              aria-label="剪切"
              @click="cutRangeAction"
            >
              <Scissors :size="14" />
            </button>
            <button
              type="button"
              class="sel-btn"
              :disabled="!canPasteRange"
              title="粘贴"
              aria-label="粘贴"
              @click="pasteRangeAction"
            >
              <ClipboardPaste :size="14" />
            </button>
            <button
              type="button"
              class="sel-btn"
              title="清空内容"
              aria-label="清空内容"
              @click="clearRangeAction"
            >
              <Eraser :size="14" />
            </button>

            <template v-if="showDeleteRow || showDeleteCol">
              <span class="sel-sep" />
              <button
                v-if="showDeleteRow"
                type="button"
                class="sel-btn"
                title="删除行"
                aria-label="删除行"
                @click="deleteRowAction"
              >
                <Trash2 :size="14" />
              </button>
              <template v-if="showDeleteRow && rangeIsSingleRow">
                <button
                  type="button"
                  class="sel-btn"
                  :disabled="!canMoveRowUp"
                  title="上移"
                  aria-label="上移"
                  @click="moveRowUpAction"
                >
                  <ArrowUp :size="14" />
                </button>
                <button
                  type="button"
                  class="sel-btn"
                  :disabled="!canMoveRowDown"
                  title="下移"
                  aria-label="下移"
                  @click="moveRowDownAction"
                >
                  <ArrowDown :size="14" />
                </button>
              </template>
              <button
                v-if="showDeleteCol"
                type="button"
                class="sel-btn"
                title="删除列"
                aria-label="删除列"
                @click="deleteColAction"
              >
                <Trash2 :size="14" />
              </button>
              <template v-if="showDeleteCol && rangeIsSingleCol">
                <button
                  type="button"
                  class="sel-btn"
                  :disabled="!canMoveColLeft"
                  title="左移"
                  aria-label="左移"
                  @click="moveColLeftAction"
                >
                  <ArrowLeft :size="14" />
                </button>
                <button
                  type="button"
                  class="sel-btn"
                  :disabled="!canMoveColRight"
                  title="右移"
                  aria-label="右移"
                  @click="moveColRightAction"
                >
                  <ArrowRight :size="14" />
                </button>
              </template>
            </template>
          </template>
        </SelectionMarkRow>
      </div>
    </BasePopover>

    <!-- 对齐二级：与正文工具条共用 InlineAlignMenu（选项来源同一份、定位与 Esc 同一套）。
         独立 Teleport 到 body —— 不被工具条面板的 `overflow: auto` 裁掉，
         也不与它共用 overlay / Esc（Esc 在 FloatingSubmenu 的 window 捕获里截住，只关二级）。 -->
    <InlineAlignMenu
      :open="submenu === 'align' && !!rangeMenu"
      :anchor="submenuAnchor"
      :current="rangeAlign"
      :menu-id="blockId"
      @pick="setRangeAlign"
      @close="submenu = null"
    />

    <!-- 取色面板：与对齐二级同一套浮层规则；面板本体复用正文工具条的 InlineColorPalette。 -->
    <FloatingSubmenu
      :open="submenu === 'palette' && !!rangeMenu"
      :anchor="submenuAnchor"
      :menu-id="blockId"
      @close="submenu = null"
    >
      <div
        class="palette-menu"
        @mousedown.prevent
      >
        <InlineColorPalette
          :color="menuFormat.color ?? ''"
          :background="menuFormat.background ?? ''"
          @apply="applyMenuColor"
          @reset="resetMenuColors"
        />
      </div>
    </FloatingSubmenu>

    <div
      ref="scrollEl"
      class="table-scroll"
      @scroll="onTableScroll"
    >
      <table
        ref="tableEl"
        class="block-table"
        :style="{ minWidth: tableMinWidth }"
      >
        <thead v-if="header">
          <tr>
            <td
              v-for="cell in renderedRow(0)"
              :key="`h-${cell.col}`"
              class="table-cell header-cell"
              :class="{ 'is-active': isActiveCell(0, cell.col) }"
              :rowspan="cell.rowspan > 1 ? cell.rowspan : undefined"
              :colspan="cell.colspan > 1 ? cell.colspan : undefined"
              :data-row="0"
              :data-col="cell.col"
            >
              <div
                v-if="!readonly"
                :ref="el => setCellEl(0, cell.col, el as HTMLElement | null)"
                class="cell-input"
                contenteditable="true"
                role="textbox"
                data-placeholder="列名"
                :style="{ textAlign: alignAt(0, cell.col) }"
                :data-row="0"
                :data-col="cell.col"
                data-table-cell
                @input="onCellInput(0, cell.col, $event)"
                @keydown="onCellKeydown(0, cell.col, $event)"
                @paste="onCellPaste"
                @blur="onCellBlur"
                @compositionstart="onCompositionStart"
                @compositionend="onCompositionEnd"
              />
              <div
                v-else
                class="cell-text"
                :class="{ 'is-placeholder': !cell.text }"
                :style="{ textAlign: alignAt(0, cell.col) }"
                :data-row="0"
                :data-col="cell.col"
                v-html="cellHtml(0, cell.col)"
              />
              <button
                type="button"
                class="cell-corner"
                tabindex="-1"
                aria-label="单元格菜单"
                @mousedown.stop.prevent="openCornerMenu(0, cell.col)"
              />
            </td>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="rowIndex in bodyRowIndexes"
            :key="`r-${rowIndex}`"
          >
            <td
              v-for="cell in renderedRow(rowIndex)"
              :key="`c-${rowIndex}-${cell.col}`"
              class="table-cell"
              :class="{ 'is-active': isActiveCell(rowIndex, cell.col) }"
              :rowspan="cell.rowspan > 1 ? cell.rowspan : undefined"
              :colspan="cell.colspan > 1 ? cell.colspan : undefined"
              :data-row="rowIndex"
              :data-col="cell.col"
            >
              <div
                v-if="!readonly"
                :ref="el => setCellEl(rowIndex, cell.col, el as HTMLElement | null)"
                class="cell-input"
                contenteditable="true"
                role="textbox"
                :style="{ textAlign: alignAt(rowIndex, cell.col) }"
                :data-row="rowIndex"
                :data-col="cell.col"
                data-table-cell
                @input="onCellInput(rowIndex, cell.col, $event)"
                @keydown="onCellKeydown(rowIndex, cell.col, $event)"
                @paste="onCellPaste"
                @blur="onCellBlur"
                @compositionstart="onCompositionStart"
                @compositionend="onCompositionEnd"
              />
              <div
                v-else
                class="cell-text"
                :style="{ textAlign: alignAt(rowIndex, cell.col) }"
                :data-row="rowIndex"
                :data-col="cell.col"
                v-html="cellHtml(rowIndex, cell.col)"
              />
              <button
                type="button"
                class="cell-corner"
                tabindex="-1"
                aria-label="单元格菜单"
                @mousedown.stop.prevent="openCornerMenu(rowIndex, cell.col)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 格选区色块：逐格铺底色（与文本选区同色），不吃指针，条与「+」照常可点 -->
    <div
      v-for="(box, i) in cellSelBoxes"
      :key="`cell-sel-${i}`"
      class="cell-select-box"
      :style="{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }"
    />

    <!-- 横向滚动条：列宽总和超出可视宽度时才出现，压在表格下方的留白里。
         全局浮层滚动条只管纵向，横向溢出原本毫无指示，超宽表只能靠 Shift+滚轮摸索。 -->
    <div
      v-if="hScroll"
      class="table-hscroll"
      role="scrollbar"
      aria-orientation="horizontal"
      aria-label="横向滚动"
      aria-valuemin="0"
      :aria-valuenow="Math.round(hScroll?.now ?? 0)"
      :aria-valuemax="hScroll?.max ?? 0"
      :style="hScrollStyle"
      @pointerdown="onHScrollPointerDown"
      @pointermove="onHScrollPointerMove"
      @pointerup="onHScrollPointerEnd"
      @pointercancel="onHScrollPointerEnd"
    />
  </div>
</template>

<style scoped>
.table-block {
  /* 上留白比下留白大 8px：上方 16px 槽位供「列操作入口条」吸附表头时不压到上一个块 */
  --table-pad-top: 8px;
  --table-pad-y: 8px;
  /* 不再向左侧借 gutter：入口已上提到 .block-bullet（Block 外壳统一渲染），
     盒子只覆盖自己的内容区。行列条仍贴在表格左缘外 10px（absolute 可溢出），
     显隐改由 .strip:hover 自持，不再依赖块盒子把它们圈进 :hover 判定域。 */
  position: relative;
  /* 表格块上下比普通块（2px）更需要呼吸：否则单元格边框紧贴相邻块文本 */
  margin: 2px 0;
  padding: var(--table-pad-top) 0 var(--table-pad-y);
}

/* 表格菜单入口：接在列条左端的角块，与条同高、垂直居中于顶带。
   不放在 bullet 左侧——窄窗口下那里会被侧栏压住（bullet 已占 20px，gutter 只剩 30px）。 */
.table-entry {
  position: absolute;
  top: 0;
  left: -12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 14px;
  opacity: 0;
  /* 不可见时不吃指针：本按钮的左端伸进 bullet 那 20px（left: -12px），
     opacity 0 仍可点击等于在 dot 附近埋了个隐形热区。 */
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease-out) 240ms;
}

.table-block:hover .table-entry,
.table-entry:hover {
  opacity: 1;
  pointer-events: auto;
  transition-delay: 0s;
}

.table-menu-entry {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--block-entry-size);
  height: var(--block-entry-size);
  padding: 0;
  border: 0;
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.table-menu-entry:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* 菜单容器 / 菜单行 / 分隔线的样式已收口：
   - 容器与分隔线 → src/styles/components/_block.scss 的 .block-entry-menu（浮层 Teleport 到 body，全局类）
   - 菜单行       → src/components/common/BlockMenuItem.vue（scoped）
   - 表头开关轨道 → ./TableEntryMenuItems.vue（独占菜单项的那一份，与它一起搬走了） */

/* 表格外框与圆角都挂在滚动容器上：overflow 非 visible 时 border-radius 会裁剪内容，
   四角随圆弧裁掉；外框用 box-shadow 而不是 border —— 边框会占布局宽度，
   超宽表本就在溢出临界点上，多 2px 就等于凭空多出一条横向滚动条。 */
.table-scroll {
  overflow-x: auto;
  max-width: 100%;
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 1px var(--border);
}

/* 格选区色块：整格底色，比 ::selection（--selection-bg）浅一档（--table-cell-select-bg），
   压在格子之上但不吃指针。逐格铺而非画一个大矩形：跨行列时中间格线保持可见，
   边界一眼看得出选中了哪几格。 */
.cell-select-box {
  position: absolute;
  z-index: var(--z-sticky);
  background: var(--table-cell-select-bg);
  pointer-events: none;
}

/* 横向滚动条滑块：无轨道底、不占布局，长度与位置由 inline style 给出（随可视宽度与滚动位置变化）。
   尺寸与配色复用全局浮层滚动条的 --scrollbar-* / --color-scrollbar，保持全应用一致。 */
.table-hscroll {
  position: absolute;
  z-index: var(--z-sticky);
  height: var(--scrollbar-size);
  border-radius: var(--scrollbar-radius);
  background: var(--color-scrollbar);
  opacity: 0.55;
  cursor: grab;
  touch-action: none;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.table-hscroll:hover {
  opacity: 0.9;
}

.table-hscroll:active {
  opacity: 1;
  cursor: grabbing;
}

/* 必须是 separate 而不是 collapse：collapse 模式下 td 的 border-radius 不生效，
   四角要圆就只能让格子各自持边框。相邻格边框叠成 2px 的问题见 .table-cell 的逐边分配。 */
.block-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  font-size: var(--text-sm);
}

.table-cell {
  position: relative;
  padding: 0;
  border: 0;
  vertical-align: top;
  background: var(--bg-base);
}

/* 网格线只画「上 + 左」：separate 下左右相邻两格各画一条会叠成 2px 粗线。
   判定用 data-row / data-col（视觉行列号），不用 :first-child / :last-child ——
   合并区的被覆盖格没有 DOM，首尾判断会错位到别的列上。
   最上行 / 最左列不画，外框由 .table-scroll 的 box-shadow 提供。 */
.table-cell[data-row]:not([data-row='0']) {
  border-top: 1px solid var(--border);
}

.table-cell[data-col]:not([data-col='0']) {
  border-left: 1px solid var(--border);
}

/* 表头行与内容区用背景区分：--table-header-bg 在暗色下明显高于格子线（--border） */
.header-cell {
  background: var(--table-header-bg);
}

/* 聚焦格不画描边：激活表格（或跨格移动）时，位置由格内插入光标指示，
   再加一圈 --accent 内描边会在格线上叠出一道粗蓝框，视觉噪音明显。
   `is-active` 类保留（activeCell 仍是插入/删除行列的锚点），只是不再有视觉投影。 */

.cell-input {
  display: block;
  width: 100%;
  min-height: 30px;
  padding: 6px 9px;
  border: 0;
  outline: 0;
  overflow: hidden;
  box-sizing: border-box;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  /* 可编辑区必须能选中文字（`.block` 的 user-select:none 会连格内一起禁掉） */
  user-select: text;
  cursor: text;
}

.header-cell .cell-input {
  font-weight: var(--font-semibold);
}

/* 空表头格的占位：contenteditable 没有原生 placeholder，用 `:empty` 伪元素补上
   （伪元素不进选区、不进复制，与「不是内容」的语义一致）。 */
.cell-input:empty::before {
  content: attr(data-placeholder);
  color: var(--text-disabled);
}

.cell-text {
  display: block;
  min-height: 30px;
  padding: 6px 9px;
  box-sizing: border-box;
  color: var(--text-primary);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  /* 渲染态格内文字必须可选中：`.block` 全局 user-select:none 会连表格文字一起禁掉，
     于是「光标不出格 → 只选该格文字」这条分支永远拿不到原生选区。
     范围只到格内文本，条的 gutter 与菜单仍然不可选（拖不出原生选区的残影）。 */
  user-select: text;
}

.header-cell .cell-text {
  font-weight: var(--font-semibold);
}

/* 空表头格的占位与编辑态对齐：编辑态是 contenteditable 的 `data-placeholder`「列名」，
   渲染态若什么都不画，同一张表在两态下会差一行字。
   用 ::before 而不是塞文本节点——伪元素不进选区、不进复制，
   与 placeholder「不是内容」的语义一致（导出 / 复制仍按空的处理）。 */
.header-cell .cell-text.is-placeholder::before {
  content: '列名';
  color: var(--text-disabled);
}

/* 每个格子的左下角热区：12×12，完全透明、不画任何视觉，只把光标从文本 I-beam 换成箭头，
   提示「这一小块不选字，点它会开菜单」。单击 = 选中本格（合并格 = 整块）并浮出工具条。
   压在输入框之上（--z-sticky 之上）才收得到 mousedown。

   尺寸上限由格高决定：格子最小高约 30px，热区再大就会盖到格内文字第一行，
   `table-cell-selection` 的「格内拖选」起手点正好落在 (左+4, 垂直中点)，16px 以上必然抢事件。
   为什么不像拖拽条那样「编辑态让位」：`activeCell` 常常正好落在刚操作过的那一格
   （合并完往往就是合并区左上格），一让位就会表现为「有时点不出菜单」，入口必须稳定。 */
.cell-corner {
  position: absolute;
  left: 0;
  bottom: 0;
  z-index: calc(var(--z-sticky) + 1);
  width: 12px;
  height: 12px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: var(--cursor-cell-menu, default);
}

/* ── 行 / 列操作条 ── */

/* 条本体：贴表格边框外侧的纯色窄带，位置与尺寸全部由 inline style 给出（随行高 / 列宽变化）。
   默认透明观感、但**恒吃指针**：条带落在表格盒子之外（左缘 -10px），块 hover 已覆盖不到它，
   只能靠条带自己 :hover 接力。若隐藏态 pointer-events:none，鼠标一移到条上就穿透，
   条的 :hover 永远不成立 —— 带子闪一帧就消失。（透明热区与表格左缘外的空白重叠，
   鼠标一进去条立刻显现，不存在「点了看不见的东西」的窗口。）
   圆角只给整条的两个外端（见下），段与段之间保持直角，拼起来才是一条连续的带子。 */
.strip {
  position: absolute;
  z-index: var(--z-sticky);
  display: block;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: var(--table-strip-bg);
  cursor: pointer;
  opacity: 0;
  pointer-events: auto;
  transition: opacity var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

/* 列条：首段圆左端、末段圆右端（厚度 10px，6px 圆角被钳制为半高 = 5px，端头正好是半圆） */
.strip--col.is-first {
  border-top-left-radius: var(--radius-sm);
  border-bottom-left-radius: var(--radius-sm);
}

.strip--col.is-last {
  border-top-right-radius: var(--radius-sm);
  border-bottom-right-radius: var(--radius-sm);
}

/* 行条：首段圆上端、末段圆下端 */
.strip--row.is-first {
  border-top-left-radius: var(--radius-sm);
  border-top-right-radius: var(--radius-sm);
}

.strip--row.is-last {
  border-bottom-left-radius: var(--radius-sm);
  border-bottom-right-radius: var(--radius-sm);
}

/* 条带自持显隐：块 hover 与条带自身 hover 任一成立即显现。
   撤掉左侧 gutter 外延后，条带已不在块盒子内，只写 .table-block:hover 会让鼠标碰到条时
   块 hover 断开、条自己消失（点不到也看不见）。 */
.table-block:hover .strip,
.strip:hover {
  opacity: 1;
}

/* 菜单打开期间整排条一起亮：弹层 Teleport 到 body，鼠标移进菜单后 `.table-block:hover`
   就断了，只靠块 hover 的话整条带子会消失，看不出「现在操作的是哪一整条」。
   只亮同类——列菜单亮列条、行菜单亮行条，另一侧的条保持隐藏。
   根类由 rangeMenu.kind 驱动，与应用状态同步，不依赖 DOM 结构。 */
.table-block.is-col-menu-open .strip--col,
.table-block.is-row-menu-open .strip--row {
  opacity: 1;
  pointer-events: auto;
}

/* 激活段抬一层：否则相邻列的条会盖掉「+」溢出的那一半 */
.strip.is-active,
.strip.is-plus {
  z-index: calc(var(--z-sticky) + 1);
}

/* 菜单打开期间那一段必须留在原地：弹层 Teleport 到 body，鼠标移进菜单后 `.table-block:hover`
   就断了，只靠块 hover 的话被点开菜单的这一段会连同激活底色一起淡出，看不出菜单属于哪一列 / 行。
   `is-active` 本身就包含「本段菜单正打开」这一情形（见 isColActive / isRowActive）。 */
.strip.is-active {
  opacity: 1;
  pointer-events: auto;
  background: var(--table-strip-active-bg);
}

/* 「+」贴在条的端点：列条在右端（列右边界）、行条在底端（行底边）。
   它是条的子元素——鼠标从条移到「+」上时父级 hover 不中断，不会闪。 */
.strip-plus {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent);
  color: var(--color-white);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

/* 「+」只在自身热区内浮出（.is-plus），与条的升档（.is-active）分开：
   条升档 = 这一段可点开菜单；「+」热区 = 一键插入。混在一起会把插入的触发区放大到整条。 */
.strip.is-plus .strip-plus {
  opacity: 1;
  pointer-events: auto;
}

.strip--col .strip-plus {
  top: 50%;
  right: 0;
  transform: translate(50%, -50%) scale(0.8);
}

.strip--col.is-plus .strip-plus {
  transform: translate(50%, -50%) scale(1);
}

.strip--row .strip-plus {
  bottom: 0;
  left: 50%;
  transform: translate(-50%, 50%) scale(0.8);
}

.strip--row.is-plus .strip-plus {
  transform: translate(-50%, 50%) scale(1);
}

/* 提示气泡：统一 token 样式，不用原生 title */
.strip-tip {
  position: absolute;
  padding: 3px 7px;
  border: 1px solid var(--border);
  border-radius: var(--radius-xs);
  background: var(--surface-subtle);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  color: var(--text-primary);
  font-size: var(--text-xs);
  line-height: 1.5;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.strip-plus:hover .strip-tip {
  opacity: 1;
}

/* 列条在表格上方：气泡向上，落在表格外的空白里 */
.strip-tip--above {
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

/* 行条在表格左缘：气泡向下，落在左侧 gutter 内，不压表格 */
.strip-tip--below {
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
}

/* 引导线：1px 中性色，跨度按整表算，只标示「将插在哪」 */
.strip-guide {
  position: absolute;
  z-index: var(--z-sticky);
  background: var(--border-strong);
  pointer-events: none;
}

.strip-guide--col {
  width: 1px;
}

.strip-guide--row {
  height: 1px;
}

/* 范围工具条：纯图标单行 + 竖线分组。公共段（对齐 + B/I/U/S/A）的按钮视觉由
   `common/SelectionMarkRow` 提供（与正文行内工具条同一份），这里只管这一层的排布：
   按钮直接是它的 flex 子项（该组件是片段根），结构项经它的插槽接在后面，
   因此 gap / wrap 对两段一视同仁。不可用项直接不渲染（工具条随范围变形）。 */
.range-menu {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  padding: 4px;
  max-width: min(92vw, 520px);
}

/* 取色面板：面皮与定位在 FloatingSubmenu，面板自带内边距与最小宽度（InlineColorPalette） */
.palette-menu {
  display: flex;
}

</style>
