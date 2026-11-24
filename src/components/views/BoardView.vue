<script setup lang="ts" generic="T">
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { FieldDescriptor, Option } from '../../core/query'
import type { BoardConfig } from '../../core/view'
import { TAG_COLOR_TOKENS } from '../../utils/tag-color'
import {
  canConsumeVertical,
  countHiddenRight,
  EDGE_SCROLL_BAND,
  edgeAutoScrollSpeed,
  isPanStartAllowed,
  pageStepOf,
} from './board-scroll'

const props = defineProps<{
  /** 已过滤+排序的扁平列表。实体无关。 */
  items: T[]
  /** 实体字段描述符（驱动列/卡片按类型渲染）。 */
  fields: FieldDescriptor[]
  /** 分组字段 key（通常来自 ViewQuery.groupBy，如 'status'）。列由该字段 options 派生。 */
  groupBy: string
  /** 看板布局配置：cardFields 列出卡片额外徽章字段。 */
  config?: BoardConfig
  /** 取记录 id 的字段名（默认 'id'）。BlockCard 用 'block_id'。 */
  idKey?: string
  /**
   * 列底染色：列用自身色相做底 + 边框（分组值无色时按列序轮转调色板）。
   *
   * 默认关 —— 任务中心的分组是状态机（Todo/Doing/Done/…），只有 Doing 有语义色，
   * 给其余列轮转上色等于用「列序」冒充「状态语义」（Todo 被染红会被读成危险/阻塞）。
   * 只有标签聚合页开：那里列是标签自定义的枚举，颜色本来就只是分类标识。
   */
  tintColumns?: boolean
}>()

const emit = defineEmits<{
  /** 拖拽改分组：把记录的分组字段值改为目标列值。 */
  cellChange: [itemId: string, fieldKey: string, value: unknown]
  /** 点击卡片导航到源记录。 */
  navigate: [itemId: string]
}>()

function idOf(item: T): string {
  return String((item as Record<string, unknown>)[props.idKey ?? 'id'])
}

function fieldOf(key: string): FieldDescriptor | undefined {
  return props.fields.find((f) => f.key === key)
}

function resolveOptions(field: FieldDescriptor | undefined): Option[] {
  if (!field?.options) return []
  return typeof field.options === 'function' ? field.options() : field.options
}

/** 无分组值的记录列 key（仅当存在这类记录时才追加该列）。 */
const UNASSIGNED_KEY = '__unassigned__'

/**
 * 轮转色序：从蓝（`--tag-color-8`）环形遍历标签调色板，跳过灰色 `--tag-color-1`
 * （灰染到 14% 与中性列底几乎无差，占掉一个色位反而使后续列错位）。
 * 名单仍是 `TAG_COLORS` 单源，这里只决定起点，不新增色表。
 */
const TINT_PALETTE: readonly string[] = (() => {
  const usable = TAG_COLOR_TOKENS.filter((t) => t !== '--tag-color-1')
  const start = Math.max(usable.indexOf('--tag-color-8'), 0)
  return [...usable.slice(start), ...usable.slice(0, start)]
})()

/** 分组字段缺值判定：null / 空串 / 空数组（multiSelect 未选）。 */
function isUnassigned(value: unknown): boolean {
  if (value == null || value === '') return true
  return Array.isArray(value) && value.length === 0
}

/** 分组列：优先取分组字段的 options（select 语义）；否则由记录实际取值派生唯一列。 */
const columns = computed<{ key: string; label: string; color?: string; tint?: string }[]>(() => {
  const groupField = fieldOf(props.groupBy)
  if (!groupField) {
    // 分组字段未注册：退化为单一「全部」列
    return [{ key: '__all__', label: '全部' }]
  }
  const opts = resolveOptions(groupField)
  const cols: { key: string; label: string; color?: string; tint?: string }[] = []
  if (opts.length > 0) {
    for (const o of opts) cols.push({ key: o.id, label: o.label, color: o.color })
  } else {
    const seen = new Map<string, string>()
    for (const item of props.items) {
      const v = groupField.get(item)
      const arr = Array.isArray(v) ? v : [v]
      for (const val of arr) {
        if (val != null && val !== '' && !seen.has(String(val))) seen.set(String(val), String(val))
      }
    }
    for (const [key, label] of seen) cols.push({ key, label })
  }
  // 缺值记录必须有落脚列：否则它们在看板上静默消失（标签聚合页里未填字段的成员是常态）。
  if (props.items.some((i) => isUnassigned(groupField.get(i)))) {
    cols.push({ key: UNASSIGNED_KEY, label: '未分组' })
  }
  if (props.tintColumns) {
    // 色位按「成员列序号」分配（不因列自带语义色而跳号），位置与颜色的对应关系稳定可预期。
    // 「未分组」是兜底落点不是阶段，固定中性，且不占色位。
    let i = 0
    for (const col of cols) {
      if (col.key === UNASSIGNED_KEY) continue
      col.tint = col.color ?? `var(${TINT_PALETTE[i % TINT_PALETTE.length]})`
      i++
    }
  }
  return cols
})

function matchGroup(value: unknown, colKey: string): boolean {
  return Array.isArray(value) ? value.map(String).includes(colKey) : String(value) === colKey
}

function cardsIn(colKey: string): T[] {
  const groupField = fieldOf(props.groupBy)
  if (!groupField || colKey === '__all__') return props.items
  if (colKey === UNASSIGNED_KEY) return props.items.filter((i) => isUnassigned(groupField.get(i)))
  return props.items.filter((i) => matchGroup(groupField.get(i), colKey))
}

/** 卡片标题：content 字段（或首个 text 字段）的取值。 */
const titleField = computed<FieldDescriptor | undefined>(
  () => fieldOf('content') ?? props.fields.find((f) => f.type === 'string'),
)

/** 卡片额外徽章字段（config.cardFields，缺省空 —— 块实体的默认集由调用方 boardConfig 注入）。 */
const metaFields = computed<FieldDescriptor[]>(
  () => (props.config?.cardFields ?? []).map((k) => fieldOf(k)).filter((f): f is FieldDescriptor => !!f),
)

function isOverdue(day?: unknown): boolean {
  if (typeof day !== 'string' || !day) return false
  const d = new Date(day)
  if (Number.isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}

function formatDate(day?: unknown): string {
  if (typeof day !== 'string' || !day) return ''
  const d = new Date(day)
  if (Number.isNaN(d.getTime())) return String(day)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dayN = String(d.getDate()).padStart(2, '0')
  return `${m}-${dayN}`
}

/** 单条徽章元数据：按字段类型通用绘制（select 带色圆点 / date 逾期标红 / 默认文本）。 */
function metaChips(item: T): { text: string; color?: string; overdue?: boolean }[] {
  const out: { text: string; color?: string; overdue?: boolean }[] = []
  for (const f of metaFields.value) {
    const raw = f.get(item)
    if (raw == null || raw === '') continue
    if (f.type === 'select' || f.type === 'multiSelect') {
      const vals = Array.isArray(raw) ? raw : [raw]
      for (const v of vals) {
        const opt = resolveOptions(f).find((o) => o.id === v)
        if (opt) out.push({ text: opt.label, color: opt.color })
      }
    } else if (f.type === 'date' || f.type === 'datetime') {
      const txt = formatDate(raw)
      if (txt) out.push({ text: `⏰ ${txt}`, overdue: isOverdue(raw) })
    } else {
      out.push({ text: String(raw) })
    }
  }
  return out
}

// ── 横向滚动（无滚动条方案）──
// 全局 CSS 关掉了原生滚动条（styles/components/_scrollbar.scss），替代它的浮层指示条只实现
// 纵轴（overlayScrollbar.ts 只认纵向溢出），所以列数超出视口时看板一条滚动条也没有。
// 这里补偿三条入口：滚轮接力、边缘翻页、键盘；拖拽另有边缘自动滚（见下方 startDragLoop）。
const boardEl = ref<HTMLElement | null>(null)
const boardScrollLeft = ref(0)
/** 最大横向滚动量（scrollWidth - clientWidth）。 */
const boardScrollMax = ref(0)
/** 完全落在视口右侧之外的列数（半截露出的不算）。 */
const hiddenRight = ref(0)

const canScrollLeft = computed(() => boardScrollLeft.value > 1)
// 按钮可见性按「还有余量可滚」判断，不用 hiddenRight —— 否则最后一列被切掉半截、
// 但没有整列完全不可见时按钮会提前消失，用户以为到头了，其实还能再滚一点。
const canScrollRight = computed(() => boardScrollLeft.value < boardScrollMax.value - 1)

/** 重新量取滚动位置与右侧不可见列数（scroll / resize / 列数变化时调用）。 */
function syncScrollMeta() {
  const el = boardEl.value
  if (!el) return
  boardScrollLeft.value = el.scrollLeft
  boardScrollMax.value = Math.max(0, el.scrollWidth - el.clientWidth)
  const box = el.getBoundingClientRect()
  const rects = Array.from(el.querySelectorAll<HTMLElement>('.board-column')).map((c) =>
    c.getBoundingClientRect(),
  )
  hiddenRight.value = countHiddenRight(rects, box.right)
}

/** 一列宽（含 gap），翻页与键盘共用。 */
function columnStep(): number {
  const col = boardEl.value?.querySelector<HTMLElement>('.board-column')
  return (col?.offsetWidth || 260) + 8
}

/**
 * 平滑滚动的「目标位置」，连按 ←/→ 时作为累积基准。
 *
 * `behavior: 'smooth'` 期间 `el.scrollLeft` 停在动画中间值，而每次按键都从它再算一次
 * 目标 —— 真机连按 3 次只前进 1 列（271px）。改为从上次目标累积；动画落地后清空，
 * 交还给真实的 scrollLeft（滚轮 / 平移 / 拖拽自动滚都会抢先作废它）。
 */
const SMOOTH_SETTLE_MS = 400
let smoothTarget: number | null = null
let smoothTimer: ReturnType<typeof setTimeout> | null = null

/** 起点：动画未落地时用目标值，否则用真实滚动量。 */
function scrollBase(el: HTMLElement): number {
  return smoothTarget ?? el.scrollLeft
}

function clearSmoothTarget() {
  smoothTarget = null
  if (smoothTimer != null) {
    clearTimeout(smoothTimer)
    smoothTimer = null
  }
}

function scrollToLeft(left: number) {
  const el = boardEl.value
  if (!el) return
  const max = Math.max(0, el.scrollWidth - el.clientWidth)
  const next = Math.max(0, Math.min(max, left))
  if (typeof el.scrollTo === 'function') el.scrollTo({ left: next, behavior: 'smooth' })
  else el.scrollLeft = next
  // 平滑滚动期间 scroll 事件异步到达，先落一次元信息，避免边缘按钮延迟出现/消失
  boardScrollLeft.value = next
  smoothTarget = next
  if (smoothTimer != null) clearTimeout(smoothTimer)
  smoothTimer = setTimeout(() => {
    smoothTarget = null
    smoothTimer = null
  }, SMOOTH_SETTLE_MS)
}

/** 翻页：一屏减一列（留一列作锚，翻完仍能对上上下文）。 */
function pageBy(dir: 1 | -1) {
  const el = boardEl.value
  if (!el) return
  scrollToLeft(scrollBase(el) + dir * pageStepOf(el.clientWidth, columnStep()))
}

/** 边界内最近的纵向可滚容器（列内的卡片列表）。 */
function verticalScrollerIn(target: EventTarget | null, boundary: HTMLElement): HTMLElement | null {
  let node = target as HTMLElement | null
  while (node && node !== boundary) {
    const cs = getComputedStyle(node)
    if (/(auto|scroll|overlay)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

/**
 * 滚轮接力：列内列表还有余量就先让它滚，滚到底再把 deltaY 转成看板横滚。
 *
 * 触控板横滑（|deltaX| > |deltaY|）一律不接管 —— 浏览器原生横向就够，接管会让
 * 斜向双指手势被双倍加速。
 */
function onWheel(e: WheelEvent) {
  const el = boardEl.value
  if (!el) return
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
  const inner = verticalScrollerIn(e.target, el)
  if (inner && canConsumeVertical(inner, e.deltaY)) return
  const max = el.scrollWidth - el.clientWidth
  if (max <= 1) return
  const next = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY))
  if (next === el.scrollLeft) return
  clearSmoothTarget()
  el.scrollLeft = next
  syncScrollMeta()
  e.preventDefault()
}

/** 键盘：←/→ 滚一列，Home/End 到首末列（无滚动条时的无障碍入口）。 */
function onKeydown(e: KeyboardEvent) {
  const el = boardEl.value
  if (!el || e.altKey || e.ctrlKey || e.metaKey) return
  if (el.scrollWidth - el.clientWidth <= 1) return
  const step = columnStep()
  const from = scrollBase(el)
  let target: number | null = null
  if (e.key === 'ArrowLeft') target = from - step
  else if (e.key === 'ArrowRight') target = from + step
  else if (e.key === 'Home') target = 0
  else if (e.key === 'End') target = el.scrollWidth
  if (target == null) return
  e.preventDefault()
  scrollToLeft(target)
}

// ── 容器尺寸变化 ──
// 横向入口的可用性全部建立在 `boardScrollMax` 上，而它只在 mount / window resize / 列数
// 变化时刷新。真实触发源几乎都不是 window：分屏开关、拖分隔条、侧栏折叠、标签切回
// （v-show 期间 clientWidth=0）都只改祖先宽度。R.O. 是唯一能覆盖全部分支的信号。
let boardRO: ResizeObserver | null = null

onMounted(() => {
  syncScrollMeta()
  window.addEventListener('resize', syncScrollMeta)
  if (typeof ResizeObserver === 'function' && boardEl.value) {
    boardRO = new ResizeObserver(() => syncScrollMeta())
    boardRO.observe(boardEl.value)
  }
})

onBeforeUnmount(() => {
  boardRO?.disconnect()
  boardRO = null
  clearSmoothTarget()
  window.removeEventListener('resize', syncScrollMeta)
  stopDragLoop()
  // 平移的监听挂在 window 上：卸载时若正在平移，必须摘掉，否则指针事件会打到已销毁的组件
  detachPanListeners()
  isPanning.value = false
  panStart = null
})

// 列数变化（换了分组字段 / 标签字段增删）会改变「还有几列」，容器尺寸不变故 RO 不触发。
watch(() => columns.value.length, () => nextTick(syncScrollMeta))

// ── 拖拽（Pointer Events，兼容 Tauri webview / 触屏）──
// 原生 HTML5 DnD 在 Tauri 桌面端 webview 下经常不触发 dragstart（象限视图 2026-10 同源事故，
// 见 QuadrantView 的拖拽段注释），故统一走 pointerdown→pointermove→pointerup，落格时改写分组字段。
const draggedCardId = ref<string | null>(null)
// 当前拖拽悬停的列（高亮放置目标，Pointer Events 默认无列级反馈）
const dragOverCol = ref<string | null>(null)
// 跟随指针的悬浮 ghost（Pointer Events 无浏览器原生拖影，补一个可视载体让拖拽「有形」）
const dragPos = ref<{ x: number; y: number } | null>(null)
const dragCard = ref<T | null>(null)
// 源卡片真实宽度（拖拽开始时抓取 offsetWidth），让 ghost 与实际卡片等宽
const dragWidth = ref<number | null>(null)
// 拖拽结束后浏览器紧接触发一次 click，标记抑制以免误导航
const suppressClick = ref(false)

const ghost = computed<{ content: string; x: number; y: number; w: number } | null>(() => {
  if (!draggedCardId.value || !dragPos.value) return null
  const card = dragCard.value
  const title = card && titleField.value ? titleField.value.get(card) : draggedCardId.value
  return { content: String(title ?? ''), x: dragPos.value.x, y: dragPos.value.y, w: dragWidth.value ?? 0 }
})

let pointerStart: { x: number; y: number; id: string } | null = null
let pointerItem: T | null = null
let dragging = false

function onPointerDown(item: T, e: PointerEvent) {
  // 仅响应主键（鼠标左键 / 触摸 / 触控笔接触）；右键等忽略，避免误触
  if (e.button != null && e.button !== 0) return
  pointerItem = item
  pointerStart = { x: e.clientX, y: e.clientY, id: idOf(item) }
  // 可能由卡片子元素触发，向上找到 .board-card 抓宽度
  const cardEl = (e.target as HTMLElement | null)?.closest?.('.board-card') as HTMLElement | null
  dragWidth.value = cardEl?.offsetWidth ?? null
  dragging = false
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
}

/** 从事件目标向上找到所属列，取 data-col-key。 */
function resolveColKey(target: EventTarget | null): string | null {
  const el = (target as Element | null)?.closest?.('.board-column') as HTMLElement | null
  return el?.dataset.colKey ?? null
}

// ── 拖拽中的边缘自动滚 ──
// 列在视口外时必须能边拖边滚：先松手才能滚，而松手就是落格，跨列搬运会变成多次搬运。
let dragLoop: number | null = null
let lastPointer = { x: 0, y: 0 }

function stopDragLoop() {
  if (dragLoop != null) {
    cancelAnimationFrame(dragLoop)
    dragLoop = null
  }
}

/**
 * 拖拽期间逐帧：贴边时横滚看板，并按当前指针位置重算落格目标。
 * 指针不动而内容在动时，dragOverCol 会陈旧，所以落格必须每帧按 elementFromPoint 实时取。
 */
function startDragLoop() {
  if (dragLoop != null) return
  const tick = () => {
    dragLoop = null
    const el = boardEl.value
    if (!dragging || !el) return
    const box = el.getBoundingClientRect()
    const speed = edgeAutoScrollSpeed(lastPointer.x, box.left, box.right, EDGE_SCROLL_BAND)
    if (speed !== 0) {
      const max = el.scrollWidth - el.clientWidth
      const next = Math.max(0, Math.min(max, el.scrollLeft + speed))
      if (next !== el.scrollLeft) {
        clearSmoothTarget()
        el.scrollLeft = next
        syncScrollMeta()
      }
    }
    if (typeof document.elementFromPoint === 'function') {
      dragOverCol.value = resolveColKey(document.elementFromPoint(lastPointer.x, lastPointer.y))
    }
    dragLoop = requestAnimationFrame(tick)
  }
  dragLoop = requestAnimationFrame(tick)
}

function onPointerMove(e: PointerEvent) {
  if (!pointerStart) return
  lastPointer = { x: e.clientX, y: e.clientY }
  // 超过阈值才判定为拖拽，避免与点击/轻触冲突
  if (!dragging) {
    if (Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) < 6) return
    dragging = true
    draggedCardId.value = pointerStart.id
    dragCard.value = pointerItem
    document.body.style.userSelect = 'none'
    startDragLoop()
  }
  dragOverCol.value = resolveColKey(e.target)
  dragPos.value = { x: e.clientX, y: e.clientY }
  e.preventDefault()
}

function finishDrag() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  stopDragLoop()
  document.body.style.userSelect = ''
  draggedCardId.value = null
  dragOverCol.value = null
  dragPos.value = null
  dragCard.value = null
  dragWidth.value = null
  pointerItem = null
  const wasDragging = dragging
  dragging = false
  pointerStart = null
  if (wasDragging) {
    suppressClick.value = true
    setTimeout(() => { suppressClick.value = false }, 0)
  }
}

function onPointerUp(e: PointerEvent) {
  if (dragging && pointerStart) {
    const target = resolveColKey(e.target)
    const id = pointerStart.id
    // 「全部」是分组字段未注册时的退化列；「未分组」不是合法取值（拖入即清空字段是没有依据的副作用）。
    // 卡片已在该列时不写库 —— 同列内移动是无效操作。
    if (
      target
      && target !== '__all__'
      && target !== UNASSIGNED_KEY
      && !cardsIn(target).some((i) => idOf(i) === id)
    ) {
      emit('cellChange', id, props.groupBy, target)
    }
  }
  finishDrag()
}

function onPointerCancel() {
  finishDrag()
}

function onCardClick(item: T) {
  if (suppressClick.value) {
    suppressClick.value = false
    return
  }
  emit('navigate', idOf(item))
}

// ── 空白区拖拽平移（grab-to-pan）──
// 桌面鼠标在 overflow 容器里按住拖动本来不产生滚动，只会选中一片跨列文本（真机实测：
// 14 列看板从背景拖 260px，scrollLeft 仍为 0，但选中了「暂无卡片 / 报价中 / 卡片 1 …」）。
// 那块区域占看板可见面积 79.4%（20px 网格采样 1768 点），是这里唯一能「连续」横向定位的入口
// —— 滚轮是离散跳、箭头是一屏、键盘是一列 —— 所以接管为平移，把负价值操作换成正价值。
// 只横向：纵向归外层列表滚（看板自身高度 100%，纵向无余量）。
const isPanning = ref(false)
/** 可平移 = 横向确有溢出。决定光标形状，也是「能不能拖」的唯一诚实信号。 */
const canPan = computed(() => boardScrollMax.value > 1)
let panStart: { x: number; left: number } | null = null
// 拖动后浏览器会补一次 click：必须吞掉，否则会被外层当成「点了空白」（如关闭浮层）。
const suppressBoardClick = ref(false)
/** 焦点由指针带进来（而非 Tab）：抑制焦点环，见 `focusBoardForPointer`。 */
const pointerFocus = ref(false)

/**
 * 指针交互时把焦点收进看板 —— 键盘横向滚动（←/→、Home/End）的前置条件。
 *
 * 必须显式聚焦：点击空白区会走 `preventDefault()`（阻止「从背景划一片选区」），而这条
 * 默认行为正是浏览器「点空白 = 转移焦点」的载体，被吃掉后焦点会留在**上一个**持有者上。
 * 分屏时那个持有者通常是另一栏的编辑器，于是 ←/→ 去挪左边光标、看板纹丝不动（真机
 * 2026-10-31：点右栏看板空白后按 →，scrollLeft 恒为 0，activeElement 是左栏编辑器）。
 *
 * 焦点环另用 `.is-pointer-focus` 抑制：鼠标用户不期待一圈 accent 描边罩住整块看板；
 * Tab 进来的那条路径不经过 pointerdown，照常显示。
 */
function focusBoardForPointer(target: EventTarget | null) {
  const el = boardEl.value
  if (!el || document.activeElement === el) return
  const node = target as Element | null
  // 将来若有内嵌输入控件，别把焦点从它手里抢走
  if (node?.closest?.('input, textarea, select, [contenteditable="true"]')) return
  pointerFocus.value = true
  el.focus({ preventScroll: true })
}

function onBoardBlur() {
  pointerFocus.value = false
}

function onBoardPointerDown(e: PointerEvent) {
  const el = boardEl.value
  if (!el) return
  focusBoardForPointer(e.target)
  if (!isPanStartAllowed(e.target as Element | null, {
    button: e.button ?? 0,
    pointerType: e.pointerType ?? '',
    maxScroll: boardScrollMax.value,
  })) return
  // 阻止默认行为 = 阻止「从这里开始划选区」（焦点已在上方显式收进看板）。
  e.preventDefault()
  panStart = { x: e.clientX, left: el.scrollLeft }
  window.addEventListener('pointermove', onPanMove)
  window.addEventListener('pointerup', onPanEnd)
  window.addEventListener('pointercancel', onPanEnd)
}

function onPanMove(e: PointerEvent) {
  const el = boardEl.value
  if (!panStart || !el) return
  const dx = e.clientX - panStart.x
  if (!isPanning.value) {
    // 与卡片拖拽同一阈值：小于它算点击，不进入平移（否则轻点会轻微位移）。
    // 只按横向位移判定 —— 纵向拖动在这个容器里没有可移动的内容。
    if (Math.abs(dx) < 6) return
    isPanning.value = true
  }
  e.preventDefault()
  const max = el.scrollWidth - el.clientWidth
  clearSmoothTarget()
  el.scrollLeft = Math.max(0, Math.min(max, panStart.left - dx))
  syncScrollMeta()
}

function detachPanListeners() {
  window.removeEventListener('pointermove', onPanMove)
  window.removeEventListener('pointerup', onPanEnd)
  window.removeEventListener('pointercancel', onPanEnd)
}

function onPanEnd() {
  detachPanListeners()
  if (isPanning.value) {
    // 拖动期间可能已经因为 preventDefault 迟了一步而选到文本，收尾清一次
    window.getSelection()?.removeAllRanges()
    suppressBoardClick.value = true
    setTimeout(() => {
      suppressBoardClick.value = false
    }, 0)
  }
  isPanning.value = false
  panStart = null
}

/** 捕获阶段吞掉平移后紧随的 click（不能只 preventDefault：外层 click-outside 依赖 stopPropagation）。 */
function onBoardClickCapture(e: MouseEvent) {
  if (!suppressBoardClick.value) return
  suppressBoardClick.value = false
  e.stopPropagation()
  e.preventDefault()
}
</script>

<template>
  <div class="board-shell">
    <div
      ref="boardEl"
      class="board-view"
      :class="{ 'can-pan': canPan, 'is-panning': isPanning, 'is-pointer-focus': pointerFocus }"
      tabindex="0"
      role="region"
      aria-label="看板视图：左右方向键横向滚动，Home / End 跳到首末列"
      @scroll.passive="syncScrollMeta"
      @wheel="onWheel"
      @keydown="onKeydown"
      @blur="onBoardBlur"
      @pointerdown="onBoardPointerDown"
      @click.capture="onBoardClickCapture"
    >
      <div
        v-for="col in columns"
        :key="col.key"
        class="board-column"
        :class="{ 'drag-over': dragOverCol === col.key, 'is-tinted': !!col.tint }"
        :style="col.tint ? { '--col-tint': col.tint } : undefined"
        :data-col-key="col.key"
      >
        <div class="column-header">
          <span
            class="column-title"
            :class="{ 'is-unassigned': col.key === UNASSIGNED_KEY }"
            :style="col.color ? { color: col.color } : undefined"
          >{{ col.label }}</span>
          <span class="column-count">{{ cardsIn(col.key).length }}</span>
        </div>

        <div class="column-cards">
          <div
            v-if="cardsIn(col.key).length === 0"
            class="column-empty"
          >
            暂无卡片
          </div>

          <div
            v-for="card in cardsIn(col.key)"
            :key="idOf(card)"
            class="board-card"
            :class="{ dragging: draggedCardId === idOf(card) }"
            @pointerdown="onPointerDown(card, $event)"
            @click="onCardClick(card)"
          >
            <div class="card-grip">
              <GripVertical :size="12" />
            </div>
            <div class="card-body">
              <p class="card-content">
                {{ titleField ? titleField.get(card) : idOf(card) }}
              </p>
              <div
                v-if="metaChips(card).length"
                class="card-meta"
              >
                <span
                  v-for="(chip, i) in metaChips(card)"
                  :key="i"
                  class="card-chip"
                  :class="{ overdue: chip.overdue }"
                  :style="chip.color ? { color: chip.color, borderColor: chip.color } : undefined"
                >{{ chip.text }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 边缘翻页：没有滚动条时的位置信号兼入口；拖拽期间让开（否则会挡住落格采样） -->
    <button
      v-if="canScrollLeft"
      type="button"
      class="board-pager is-left"
      :class="{ 'is-dragging': !!draggedCardId }"
      aria-label="向左滚动"
      @click="pageBy(-1)"
    >
      <ChevronLeft :size="14" />
    </button>
    <button
      v-if="canScrollRight"
      type="button"
      class="board-pager is-right"
      :class="{ 'is-dragging': !!draggedCardId }"
      :aria-label="hiddenRight ? `向右滚动，右侧还有 ${hiddenRight} 列` : '向右滚动'"
      @click="pageBy(1)"
    >
      <span
        v-if="hiddenRight"
        class="pager-label"
      >还有 {{ hiddenRight }} 列</span>
      <ChevronRight :size="14" />
    </button>

    <!-- 拖拽 ghost：跟随指针的悬浮卡片（Pointer Events 无原生拖影）；浮层必须 Teleport 到 body -->
    <Teleport to="body">
      <div
        v-if="ghost"
        class="board-drag-ghost"
        :style="{ left: ghost.x + 'px', top: ghost.y + 'px', width: ghost.w ? ghost.w + 'px' : undefined }"
      >
        {{ ghost.content }}
      </div>
    </Teleport>
  </div>
</template>

<style lang="scss" scoped>
// 滚动容器外面套一层，边缘翻页按钮才能相对「可见区域」定位（放进滚动容器会跟着内容滚走）
.board-shell {
  position: relative;
  height: 100%;
  min-width: 0;
}

.board-view {
  display: flex;
  align-items: flex-start; // 列高随内容，不拉满容器（参考截图：卡片少的列就是矮的）
  gap: 8px; // 列是独立面板，贴放会粘连成一条带
  height: 100%;
  overflow-x: auto;
  padding: 12px;

  // 可平移时给抓手指针 —— 这是「这里能拖」的唯一信号（没有滚动条，也没有提示文案）。
  // 只承诺真的能拖的地方：卡片有自己的 grab，列头显示 default（列头不平移）。
  &.can-pan {
    cursor: grab;
  }

  &.is-panning {
    cursor: grabbing;

    // 平移中指针划过卡片时不能退回 grab，否则「正在拖画布」和「可以拖卡片」两种光标打架
    .board-card {
      cursor: grabbing;
    }
  }

  // 可聚焦（键盘横向滚动）。默认不画焦点环，仅键盘导航时给一圈内描边；
  // 指针带进来的焦点（`.is-pointer-focus`）不算键盘导航 —— 否则点一下看板就罩一圈紫框。
  &:focus {
    outline: none;
  }

  &:focus-visible:not(.is-pointer-focus) {
    border-radius: var(--radius-md);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
}

// 边缘翻页：只有该方向还有列时才出现。没有滚动条，它同时承担「右边还有东西」的发现入口
// 与「还剩多少」的位置信号。拖拽期间 pointer-events 关闭 —— 边缘既是自动滚的触边带，
// 也是落格判定的采样点，浮层不能让开就不能拖进视口外的列。
.board-pager {
  position: absolute;
  top: 50%;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 26px;
  padding: 0 6px;
  transform: translateY(-50%);
  background: color-mix(in srgb, var(--bg-base2) 92%, transparent);
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-elevation-2);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  cursor: pointer;
  transition: opacity var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
  user-select: none;

  // 边缘翻页按钮不可选中，否则会遮挡点击事件
  &.is-left {
    left: 2px;
  }

  &.is-right {
    right: 2px;
  }

  &:hover {
    color: var(--text-primary);
  }

  &.is-dragging {
    opacity: 0.35;
    pointer-events: none;
  }
}

.pager-label {
  white-space: nowrap;
}

// 列 = 独立圆角面板：自带底色 + 边框，不再用竖分隔线切分。
// 中性态与页面同底（--bg-base）：卡片 --grad-surface 顶 #202024 比它亮，卡片自然浮起。
.board-column {
  flex: 1;
  // 220 时卡片标题被切（实测），260 起列内可读、滚动边界更可预期。
  // 但不能死守 260：分屏右栏可能只有 200px 上下，死守会让每列都被右边裁掉半截，
  // 用户永远看不到完整一列。窄容器时退成「一列正好一屏」，横滚仍在但按列整屏移动。
  min-width: min(260px, 100%);
  max-width: 340px;
  max-height: 100%; // 内容超出时列内滚动，不撑破看板
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: var(--radius-md);

  // 染色态：色相取自 --col-tint（分组值的语义色，或按列序轮转的标签调色板）
  &.is-tinted {
    background: color-mix(in srgb, var(--col-tint) 14%, var(--bg-base));
    border-color: color-mix(in srgb, var(--col-tint) 30%, var(--border-color, var(--app-split)));
  }

  // 拖拽悬停的放置目标高亮（列级反馈，原生 DnD 默认无）
  // 只用 accent 描边 + 底色加深一档，不覆盖列自身的色相身份。
  &.drag-over {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);

    &.is-tinted {
      background: color-mix(in srgb, var(--col-tint) 24%, var(--bg-base));
    }

    &:not(.is-tinted) {
      background: color-mix(in srgb, var(--accent) 8%, var(--bg-base));
    }
  }
}

// 卡片随列色（仅染色列）：列底是「页底 + 14% 色」，卡片若仍是中性近黑渐变，
// 会比列底更暗、读成凹槽。混 9% 列色让卡片浮起来，与参考截图的层次关系一致。
.is-tinted > .column-cards .board-card {
  background: color-mix(in srgb, var(--col-tint) 9%, var(--bg-base));
  border-color: color-mix(in srgb, var(--col-tint) 26%, var(--border-color, var(--app-split)));

  // 悬停仍用 accent 描边（选择器已比基础 hover 更具体，必须显式重申）
  &:hover {
    border-color: var(--accent);
  }
}

.column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding: 8px 12px;
  user-select: none;
  // 列头不参与平移（留给将来的列排序），故不继承 .board-view 的 grab
  cursor: default;
}

// 标题胶囊：同色系底，宽度只包标题（计数仍在右侧）。
.column-title {
  min-width: 0;
  overflow: hidden;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.is-tinted > .column-header .column-title {
  background: color-mix(in srgb, var(--col-tint) 20%, transparent);
}

// 未分组列是兜底落点，不是正常阶段：视觉上退一档，避免被当成第五个阶段
.column-title.is-unassigned {
  color: var(--text-tertiary);
  font-weight: var(--font-medium);
}

.column-count {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--bg-base2);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.is-tinted > .column-header .column-count {
  background: color-mix(in srgb, var(--col-tint) 16%, transparent);
}

.column-cards {
  flex: 1;
  min-height: 0; // 允许在 max-height 约束内收缩并滚动，而不是撑高整列
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

// 空态高度不得超过一张卡片：原先 24px 上下留白使空列（≈66px）比单行卡片（≈42px）还高，
// 看板上「空了反而更大」。留白收到与卡片同档（10px），行高也统一 1.4 —— 空列恒矮于有卡片的列。
.column-empty {
  padding: 10px 12px;
  line-height: 1.4;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  user-select: none;
}

.board-card {
  display: flex;
  gap: 6px;
  padding: 10px;
  background: var(--grad-surface); // 维度②：顶亮渐变表面（修复原 --bg-primary 未定义导致透明背景的 bug）
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: 8px;
  cursor: grab;
  user-select: none; // 指针拖拽时避免选中卡片文字，干扰拖影与落格判定
  transition: box-shadow var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);

  &:hover {
    box-shadow: var(--shadow-elevation-hover); // 维度①+②：物理抬升 + token 化（替换硬编码阴影）
    border-color: var(--accent);
    transform: translateY(-1px);
  }

  &.dragging {
    opacity: 0.4;
    transform: none;
  }
}

.card-grip {
  display: flex;
  align-items: flex-start;
  padding-top: 3px;
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.card-body {
  flex: 1;
  min-width: 0;
}

.card-content {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.card-chip {
  font-size: 11px;
  font-weight: var(--font-semibold);
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border-color, var(--app-split));
  color: var(--text-secondary);

  &.overdue {
    color: var(--error, #DC2626);
    border-color: var(--error, #DC2626);
  }
}

// 拖拽 ghost：固定定位跟随指针、不拦截事件；轻微旋转营造「被拎起」的层次感
.board-drag-ghost {
  position: fixed;
  left: 0;
  top: 0;
  z-index: var(--z-toast);
  box-sizing: border-box;
  min-width: 160px;
  overflow: hidden;
  padding: 10px;
  transform: translate(12px, 12px) rotate(-1.5deg);
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-base2));
  border: 1px solid var(--accent);
  border-radius: 8px;
  box-shadow: var(--shadow-elevation-hover);
  color: var(--text-primary);
  font-size: var(--text-sm);
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.96;
  pointer-events: none;
}
</style>
