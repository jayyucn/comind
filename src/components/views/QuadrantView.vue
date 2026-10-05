<script setup lang="ts" generic="T">
import { computed, nextTick, ref } from 'vue'
import type { Registry, SortRule } from '../../core/query'
import { sortItems } from '../../core/query'
import type { QuadrantConfig } from '../../core/view'
import { useTagsStore } from '../../stores/tags'
import type { PersistedTag } from '../../types/tag-persisted'
import { resolveRelativeExpr } from '../../utils/date-parser'
import type { BlockCard } from '../../wasm/types'
import BulletRender from '../Block/handlers/bullet/BulletRender.vue'
import Icon from '../Icons/Icon.vue'
import PriorityQuadrant from '../Icons/PriorityIcons/PriorityQuadrant.vue'

/**
 * 任务四象限视图（艾森豪威尔矩阵）。
 * 卡片按 priority 四值落格。**轴向：列 = 紧急（左→右递增）、行 = 重要（上→下递增）**
 * —— 与块行象限网格图标（`Icons/PriorityIcons/PriorityQuadrant.vue`）同一套读法，
 * 同一字段禁止两种轴向：
 *   左上 Medium  重要不紧急 → 计划做
 *   右上 Urgent  重要且紧急 → 立即做
 *   左下 Low     不重要不紧急 → 减少
 *   右下 High    不重要但紧急 → 委托
 * 视觉形态：**统一矩阵** —— 四象限共用一个带边框容器，内部以十字分隔线切格；
 * 四色语义只落在象限头部的象限图标上，其余界面保持中性色。
 * 任务项为无框列表行（分隔线切行），行内层级：标题 → 标签 → 辅助信息（截止日）。
 * 拖拽卡片到另一象限即改写其 priority（复用消费方 onCellChange → fieldValueStore.setFieldValue）。
 * 系统默认筛选（组件内置，无需 tab 存储 query）：含 priority 且 status 命中——
 * status 是 Todo / 是 Doing /（是 Done 且 updatedAt 在昨天及之后）；无 priority 或久前完成的 Done 不显示。
 * 系统默认排序：status asc → updatedAt desc；工具栏设了排序规则时按规则（复用引擎 sortItems）。
 * 组件消费 items（泛型）与 BlockCard 形状，事件经 cell-change / navigate 上抛；
 * 标签 chip 经 tagsStore 解析 BlockCard.tags（id → 标题/色 token）。
 */
const props = defineProps<{
  /** 已过滤+排序的扁平列表（与看板/表格共用）；组件内按 status/priority 二次分拣。 */
  items: T[]
  /** 布局配置（当前无附加元数据，预留透传）。 */
  config?: QuadrantConfig
  /** 取记录 id 的字段名（默认 'id'；BlockCard 用 'block_id'）。 */
  idKey?: string
  /** 排序规则（来自工具栏；非空时按规则排序，与表格/看板共用引擎逻辑；空时回落 created_at 降序）。 */
  sort?: SortRule[]
  /** 字段注册表：按 sort 规则解析字段值（与引擎同套）。 */
  registry?: Registry
  /** 实体类型（注册表命名空间 key，如 'block'）。 */
  entityType?: string
}>()

const emit = defineEmits<{
  /** 拖拽改象限：把记录 priority 改为目标象限对应值。 */
  cellChange: [itemId: string, fieldKey: string, value: unknown]
  /** 点击卡片打开单 block 编辑弹窗（由消费方渲染 BlockModal）。 */
  openBlock: [itemId: string]
  /** 新增任务：priority 为目标象限值，title 为输入标题（由消费方创建 block）。 */
  addItem: [priority: string, title: string]
}>()

type Card = T & Partial<BlockCard>

function idOf(item: T): string {
  return String((item as Record<string, unknown>)[props.idKey ?? 'id'])
}
function asCard(item: T): Card {
  return item as Card
}

// 仅纳入活跃/已完成任务（排除已取消）且含 priority 的卡片：
// 四象限需同时具备 status 与 priority，无 priority 的卡片不显示。
const ACTIVE_STATUSES = new Set(['Todo', 'Doing', 'Done'])

/** 象限系统默认排序：status asc → updatedAt desc（与「重要紧急视图」默认规则一致）。 */
const DEFAULT_QUADRANT_SORT: SortRule[] = [
  { field: 'status', dir: 'asc' },
  { field: 'updatedAt', dir: 'desc' },
]
/** status asc 显式顺序（与 block 注册表 status.sortOrder 对齐：进行中最相关，终止态沉底）。 */
const STATUS_SORT_ORDER = ['Doing', 'Todo', 'Done', 'Canceled']

/** 取卡片 updatedAt 的可比较日期串，镜像引擎：优先用注册表 updatedAt getter（toLocalDatetime），
 *  无注册表时回退 BlockCard.updated_at（epoch）→ 本地 YYYY-MM-DDTHH:mm:ss（保证同日 > 昨日日期串）。 */
function resolveUpdatedAtString(item: T): string | undefined {
  const reg = props.registry
  if (reg) {
    const d = reg.get(props.entityType ?? 'block', 'updatedAt')
    if (d) {
      const v = d.get(item)
      if (v != null) return String(v)
    }
  }
  const ts = asCard(item).updated_at
  if (ts == null) return undefined
  const dt = new Date(ts)
  if (Number.isNaN(dt.getTime())) return undefined
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`
}

/** 落格资格：含 priority 且 status 命中系统默认筛选（含「Done 须昨日后」）。 */
function qualifies(item: T): boolean {
  const card = asCard(item)
  const pr = card.properties?.['priority']
  if (pr == null || pr === '' || !QUADRANT_KEYS.includes(String(pr))) return false
  const st = card.properties?.['status']
  if (st == null) return false
  const s = String(st)
  if (s === 'Todo' || s === 'Doing') return true
  if (s === 'Done') {
    // 镜像引擎 op:'after' + relativeDate('yesterday')：updatedAt > 昨日日期串（含昨日起更新）
    const updated = resolveUpdatedAtString(item)
    const y = resolveRelativeExpr('yesterday') ?? ''
    return updated != null && String(updated) > String(y)
  }
  return false
}

/** 全部记录 id → item（供父级可见性判断）。 */
const itemById = computed(() => {
  const m = new Map<string, T>()
  for (const i of props.items) m.set(idOf(i), i)
  return m
})

/** 父级 block id（BlockCard.parent_id；泛型下经 Partial<BlockCard> 读取）。 */
function parentIdOf(item: T): string {
  return String((item as Partial<BlockCard>).parent_id ?? '')
}

// 顶层卡片：有落格资格，且其父级不落格（父级落格时本卡作为嵌套子任务显示，避免重复落格）
const visibleItems = computed<T[]>(() =>
  props.items.filter((i) => {
    if (!qualifies(i)) return false
    const pid = parentIdOf(i)
    const parent = itemById.value.get(pid)
    return !pid || parent === undefined || !qualifies(parent)
  }),
)

interface Quadrant {
  priority: string
  title: string
  action: string
  /** 主题色（仅用于象限头部图标），5xx 级别，明暗主题均可读。 */
  tint: string
  /** 象限图标点亮格（与屏幕格位一致，见 PriorityQuadrant）。 */
  cell: 'tl' | 'tr' | 'bl' | 'br'
}
// tint 取项目内置优先级配色（useBlockQueryRegistry 的 PRIORITY_COLORS），
// 与表格/看板圆点、块行象限网格图标共用同一组 --priority-*-fg，保证跨视图同档同色。
// 色板按档位固定，不随象限轴向变动 —— 轴向只决定图标点亮哪一格。
// **数组顺序即屏幕位置**：`grid-template-columns: 1fr 1fr` + 先横后纵展开为
// 数组第1 项 → 左上、第 2 项 → 右上、第 3 项 → 左下、第 4 项 → 右下。
// 轴向：列 = 紧急（左→右递增）、行 = 重要（上→下递增），与块行象限网格图标
// （Icons/PriorityIcons/PriorityQuadrant.vue）同一套读法。
//   左上 Medium 重要不紧急（重要 + 不紧急）
//   右上 Urgent 重要且紧急（重要 + 紧急）
//   左下 Low    不重要不紧急（不重要 + 不紧急）
//   右下 High   不重要但紧急（不重要 + 紧急）
// ⚠️ 改此顺序必须同步块行图标的 PRIORITY_QUADRANT，否则两处格位会相反。
const QUADRANTS: Quadrant[] = [
  { priority: 'Medium', title: '重要不紧急', action: '计划做·长期规划，持续投入', tint: 'var(--priority-medium-fg)', cell: 'tl' },
  { priority: 'Urgent', title: '重要且紧急', action: '立即做·立即处理，避免延误', tint: 'var(--priority-urgent-fg)', cell: 'tr' },
  { priority: 'Low', title: '不重要不紧急', action: '减少·适当放下，聚焦核心', tint: 'var(--priority-low-fg)', cell: 'bl' },
  { priority: 'High', title: '不重要但紧急', action: '委托·授权他人，提高效率', tint: 'var(--priority-high-fg)', cell: 'br' },
]
const QUADRANT_KEYS = QUADRANTS.map((q) => q.priority)

function priorityOf(item: T): string | undefined {
  const v = asCard(item).properties?.['priority']
  return v == null || v === '' ? undefined : String(v)
}

// ── 标签 chip（BlockCard.tags id → tagsStore 解析标题/色）──
const tagsStore = useTagsStore()
void tagsStore.ensureLoaded()

function cardTags(item: T): PersistedTag[] {
  return tagsStore.resolveTags(asCard(item).tags ?? [])
}

/** 标签色 token（如 `--tag-color-3`）→ chip 内联样式；空 token = 无色（中性 chip）。 */
function tagStyle(tag: PersistedTag): Record<string, string> {
  if (!tag.color) return {}
  return {
    color: `var(${tag.color})`,
    background: `color-mix(in srgb, var(${tag.color}) 12%, transparent)`,
  }
}

/** 截止日（与注册表 deadline getter 同义：deadline kind 优先，回退 schedule）。 */
function cardDeadline(item: T): string | undefined {
  const refs = asCard(item).date_refs ?? []
  const ref = refs.find((dr) => dr.kind === 'deadline') ?? refs.find((dr) => dr.kind === 'schedule')
  return ref?.date_day ?? undefined
}
function isOverdue(day?: string): boolean {
  if (!day) return false
  const d = new Date(day)
  if (Number.isNaN(d.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d < today
}
function formatDate(day?: string): string {
  if (!day) return ''
  const d = new Date(day)
  if (Number.isNaN(d.getTime())) return day
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const n = String(d.getDate()).padStart(2, '0')
  return `${m}-${n}`
}
function isDone(item: T): boolean {
  return String(asCard(item).properties?.['status']) === 'Done'
}

/** 卡片状态 → 状态图标名（status-todo/doing/done），复用项目 StatusIcons 家族 */
function statusKey(item: T): string {
  const s = String(asCard(item).properties?.['status'] ?? '')
  return 'status-' + s.toLowerCase()
}

// 象限内排序：工具栏设了排序规则则按规则（复用引擎 sortItems，与表格/看板一致）；
// 否则回落「系统默认排序」status asc → updatedAt desc（沿用「重要紧急视图」默认规则）。
// 两套路径都基于已分桶结果独立排序。
function sortByCreatedAt(list: T[]): T[] {
  return [...list].sort((a, b) => (asCard(b).created_at ?? 0) - (asCard(a).created_at ?? 0))
}

/** 无注册表时的系统默认排序回退：status asc（见 STATUS_SORT_ORDER）→ updatedAt desc。 */
function sortByDefault(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const sa = String(asCard(a).properties?.['status'] ?? '')
    const sb = String(asCard(b).properties?.['status'] ?? '')
    const ra = STATUS_SORT_ORDER.indexOf(sa)
    const rb = STATUS_SORT_ORDER.indexOf(sb)
    const ia = ra === -1 ? STATUS_SORT_ORDER.length : ra
    const ib = rb === -1 ? STATUS_SORT_ORDER.length : rb
    if (ia !== ib) return ia - ib
    return (asCard(b).updated_at ?? 0) - (asCard(a).updated_at ?? 0)
  })
}

/** 按规则排序：有注册表走引擎 sortItems（含默认规则），无注册表时默认规则走 sortByDefault、自定义规则回退 sortByCreatedAt。 */
function sortWithRules(list: T[], rules: SortRule[]): T[] {
  if (props.registry) return sortItems(list, rules, props.registry, props.entityType ?? 'block')
  return rules === DEFAULT_QUADRANT_SORT ? sortByDefault(list) : sortByCreatedAt(list)
}

// 预先分桶（单次遍历 + 每桶排序），避免模板内重复计算
const buckets = computed<Record<string, T[]>>(() => {
  const map: Record<string, T[]> = { Medium: [], Urgent: [], Low: [], High: [] }
  for (const i of visibleItems.value) {
    const p = priorityOf(i)
    if (p && map[p]) map[p].push(i)
  }
  // 象限内排序：工具栏设了排序规则则按规则，否则用系统默认排序（status asc → updatedAt desc）
  const rules = props.sort && props.sort.length > 0 ? props.sort : DEFAULT_QUADRANT_SORT
  for (const k of QUADRANT_KEYS) {
    map[k] = sortWithRules(map[k], rules)
  }
  return map
})
// ── 子任务树（最多 3 层：卡片 1 层 → 子任务 2 层 → 孙任务 3 层）──
// 数据源为扁平 BlockCard（含 parent_id）；子任务 = 活跃任务且其父级同为活跃任务。
// 子任务不要求 priority（不落格），仅在父卡片内嵌套展示；有 priority 的子任务不再重复落格。
const MAX_DEPTH = 3

/** 活跃任务（status ∈ Todo/Doing/Done）id → item，建树用。 */
const activeById = computed(() => {
  const m = new Map<string, T>()
  for (const i of props.items) {
    const st = asCard(i).properties?.['status']
    if (st != null && ACTIVE_STATUSES.has(String(st))) m.set(idOf(i), i)
  }
  return m
})

/** parent_id → 直接子任务（父级须活跃，整枝才可见；列表已按 sort 规则或创建时间排序）。 */
const childrenMap = computed(() => {
  const rules = props.sort && props.sort.length > 0 ? props.sort : DEFAULT_QUADRANT_SORT
  const m = new Map<string, T[]>()
  for (const i of props.items) {
    const st = asCard(i).properties?.['status']
    if (st == null || !ACTIVE_STATUSES.has(String(st))) continue
    const pid = parentIdOf(i)
    if (pid && activeById.value.has(pid)) {
      const arr = m.get(pid) ?? []
      arr.push(i)
      m.set(pid, arr)
    }
  }
  // 与顶层卡片同引擎排序：有规则按规则，无规则回退系统默认排序（status asc → updatedAt desc）
  for (const [pid, list] of m) {
    m.set(pid, sortWithRules(list, rules))
  }
  return m
})

function childrenOf(item: T): T[] {
  return childrenMap.value.get(idOf(item)) ?? []
}

interface SubtaskNode {
  item: T
  depth: number
}

/** 卡片子任务先序展平（depth 2=子任务、3=孙任务）；超过 MAX_DEPTH 的层级不再展开。 */
function subtasksOf(card: T): SubtaskNode[] {
  const out: SubtaskNode[] = []
  const walk = (item: T, depth: number) => {
    out.push({ item, depth })
    if (depth < MAX_DEPTH) for (const c of childrenOf(item)) walk(c, depth + 1)
  }
  for (const c of childrenOf(card)) walk(c, 2)
  return out
}

/** 点击子任务行：打开该子任务的 block 编辑弹窗（与卡片点击同通道）。 */
function onOpenSub(item: T) {
  emit('openBlock', idOf(item))
}

// ── 象限内新增任务（ghost 行 / 空态主角按钮 → 内联输入行，连续录入）──
const addingFor = ref<string | null>(null)
const addDraft = ref('')
// 模板 ref 处于 v-for（四象限循环）内会被 Vue 收集为数组，故用函数 ref 直接捕获元素
const addInputRef = ref<HTMLInputElement | null>(null)

function setAddInputRef(el: unknown) {
  if (el instanceof HTMLInputElement) addInputRef.value = el
}

function startAdd(priority: string) {
  addingFor.value = priority
  addDraft.value = ''
  nextTick(() => addInputRef.value?.focus())
}

async function commitAdd() {
  const priority = addingFor.value
  const title = addDraft.value.trim()
  if (!priority || !title) return
  emit('addItem', priority, title)
  addDraft.value = '' // 连续录入：保留输入行
}

function cancelAdd() {
  addingFor.value = null
  addDraft.value = ''
}

// ── 拖拽（Pointer Events，兼容 Tauri webview / 触屏）──
// 原生 HTML5 DnD 在 Tauri 桌面端 webview 下经常不触发 dragstart，故改用 Pointer Events：
// 鼠标 / 触控笔 / 触摸统一走 pointerdown→pointermove→pointerup，drop 时改写 priority。
// 与大纲拖拽（vue-draggable-plus force-fallback）同理，规避原生 DnD 在 webview 的失效。
const dragId = ref<string | null>(null)
const hoveredPriority = ref<string | null>(null)
const suppressClick = ref(false)
// 拖拽中跟随指针的悬浮 ghost（Pointer Events 无浏览器原生拖影，补一个可视载体让拖拽「有形」）
const dragPos = ref<{ x: number; y: number } | null>(null)
const dragCard = ref<T | null>(null)
// 源卡片真实宽度（拖拽开始时抓取 offsetWidth），让 ghost 与实际任务项等宽
const dragWidth = ref<number | null>(null)
// ghost 渲染数据快照（非泛型结构，规避模板内 T | null 解包的类型收窄问题）
const ghost = computed<{ id: string; content: string; status: string; x: number; y: number; w: number } | null>(() => {
  if (!dragId.value || !dragPos.value || !dragCard.value) return null
  const c = dragCard.value
  return {
    id: idOf(c),
    content: asCard(c).content_preview || idOf(c),
    status: statusKey(c),
    x: dragPos.value.x,
    y: dragPos.value.y,
    w: dragWidth.value ?? 0,
  }
})

let pointerStart: { x: number; y: number; id: string } | null = null
let pointerItem: T | null = null
let dragging = false

function onPointerDown(item: T, e: PointerEvent) {
  // 仅响应主键（鼠标左键 / 触摸 / 触控笔接触）；右键等忽略，避免误触
  if (e.button != null && e.button !== 0) return
  pointerItem = item
  pointerStart = { x: e.clientX, y: e.clientY, id: idOf(item) }
  // 抓取源卡片真实宽度（可能为子元素触发，向上找到 .q-card），ghost 等宽
  const cardEl = (e.target as HTMLElement | null)?.closest?.('.q-card') as HTMLElement | null
  dragWidth.value = cardEl?.offsetWidth ?? null
  dragging = false
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
}

/** 从事件目标向上找到所属象限 section，取 data-priority。 */
function resolvePriority(target: EventTarget | null): string | null {
  const el = (target as Element | null)?.closest?.('.q-cell') as HTMLElement | null
  return el?.dataset.priority ?? null
}

function onPointerMove(e: PointerEvent) {
  if (!pointerStart) return
  // 超过阈值才判定为拖拽，避免与点击/轻触冲突
  if (!dragging) {
    if (Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) < 6) return
    dragging = true
    dragId.value = pointerStart.id
    dragCard.value = pointerItem
    document.body.style.userSelect = 'none'
  }
  hoveredPriority.value = resolvePriority(e.target)
  dragPos.value = { x: e.clientX, y: e.clientY }
  e.preventDefault()
}

function finishDrag() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  document.body.style.userSelect = ''
  dragId.value = null
  hoveredPriority.value = null
  dragPos.value = null
  dragCard.value = null
  dragWidth.value = null
  pointerItem = null
  const wasDragging = dragging
  dragging = false
  pointerStart = null
  // 拖拽结束后浏览器会紧接着触发一次 click，标记抑制以免误导航
  if (wasDragging) {
    suppressClick.value = true
    setTimeout(() => { suppressClick.value = false }, 0)
  }
}

function onPointerUp(e: PointerEvent) {
  if (dragging && pointerStart) {
    const target = resolvePriority(e.target)
    if (target) {
      const src = props.items.find((i) => idOf(i) === pointerStart!.id)
      const srcPriority = src ? priorityOf(src) : undefined
      // 落到不同象限才改写（同象限为无效操作，避免无谓写库）
      if (target !== srcPriority) emit('cellChange', pointerStart!.id, 'priority', target)
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
  emit('openBlock', idOf(item))
}
</script>

<template>
  <div class="quadrant-view">
    <!-- 统一矩阵：一个带边框容器，内部十字分隔线切出四格（无外露轴线） -->
    <div class="q-matrix">
      <section
        v-for="q in QUADRANTS"
        :key="q.priority"
        class="q-cell q-quadrant"
        :class="{ 'drop-hover': dragId && hoveredPriority === q.priority }"
        :style="{ '--q-tint': q.tint }"
        :data-priority="q.priority"
      >
        <header class="q-head">
          <PriorityQuadrant
            class="q-head-icon"
            :quadrant="q.cell"
            :size="14"
            :stroke-width="2"
            :color="q.tint"
          />
          <span class="q-title">{{ q.title }}</span>
          <span class="q-action">{{ q.action }}</span>
          <span class="q-count">{{ buckets[q.priority].length }}</span>
          <button
            type="button"
            class="q-add-head"
            :class="{ active: addingFor === q.priority }"
            title="新建任务"
            @click="startAdd(q.priority)"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
            ><path
              d="M7 2.5V11.5M2.5 7H11.5"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            /></svg>
          </button>
        </header>
        <div class="q-cards">
          <div
            v-if="addingFor === q.priority"
            class="q-add-box"
          >
            <Icon
              name="status-todo"
              :size="15"
            />
            <input
              :ref="setAddInputRef"
              v-model="addDraft"
              class="q-add-input"
              placeholder="输入任务标题"
              @keydown.enter.prevent="commitAdd()"
              @keydown.esc.prevent="cancelAdd()"
              @blur="cancelAdd()"
            >
          </div>
          <div
            v-if="addingFor === q.priority"
            class="q-add-hint"
          >
            回车添加 · Esc 收起 · 可连续录入
          </div>
          <article
            v-for="card in buckets[q.priority]"
            :key="idOf(card)"
            class="q-card"
            :class="{ dragging: dragId === idOf(card), done: isDone(card) }"
            @pointerdown="onPointerDown(card, $event)"
            @click="onCardClick(card)"
          >
            <div class="q-card-main">
              <Icon
                class="q-status"
                :name="statusKey(card)"
                :size="15"
              />
              <BulletRender
                class="q-content"
                :content="asCard(card).content_preview || idOf(card)"
                :block-id="idOf(card)"
              />
              <span
                v-if="formatDate(cardDeadline(card))"
                class="q-deadline"
                :class="{ overdue: isOverdue(cardDeadline(card)) }"
              >{{ formatDate(cardDeadline(card)) }}</span>
            </div>
            <!-- 标签行：任务标题之下的次级信息层 -->
            <div
              v-if="cardTags(card).length"
              class="q-tags"
            >
              <span
                v-for="tag in cardTags(card)"
                :key="tag.id"
                class="q-tag"
                :style="tagStyle(tag)"
              >{{ tag.title }}</span>
            </div>
            <!-- 子任务：按 depth 缩进（2=子任务、3=孙任务），最多 3 层；行内点击打开子任务，不参与拖拽 -->
            <div
              v-if="subtasksOf(card).length"
              class="q-subtasks"
            >
              <div
                v-for="node in subtasksOf(card)"
                :key="idOf(node.item)"
                class="q-subtask"
                :class="['l' + node.depth, { done: isDone(node.item) }]"
                @pointerdown.stop
                @click.stop="onOpenSub(node.item)"
              >
                <Icon
                  class="q-status"
                  :name="statusKey(node.item)"
                  :size="13"
                />
                <BulletRender
                  class="q-content"
                  :content="asCard(node.item).content_preview || idOf(node.item)"
                  :block-id="idOf(node.item)"
                />
                <span
                  v-if="formatDate(cardDeadline(node.item))"
                  class="q-deadline"
                  :class="{ overdue: isOverdue(cardDeadline(node.item)) }"
                >{{ formatDate(cardDeadline(node.item)) }}</span>
              </div>
            </div>
          </article>
          <!-- 空态：主角按钮引导新增，兼顾拖拽落格提示 -->
          <div
            v-if="!buckets[q.priority].length && addingFor !== q.priority"
            class="q-empty"
          >
            <svg
              class="q-empty-icon"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            ><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>
            <span class="q-empty-title">暂无任务</span>
            <span class="q-empty-hint">拖拽任务到此处，或</span>
            <button
              type="button"
              class="q-empty-add"
              @click="startAdd(q.priority)"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 14 14"
                fill="none"
              ><path
                d="M7 2.5V11.5M2.5 7H11.5"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              /></svg>
              <span>新建任务</span>
            </button>
          </div>
        </div>
      </section>
    </div>

    <!-- 拖拽 ghost：跟随指针的悬浮卡片，给 Pointer Events 拖拽一个可见载体 -->
    <div
      v-if="ghost"
      class="q-drag-ghost"
      :style="{ left: ghost.x + 'px', top: ghost.y + 'px', width: ghost.w ? ghost.w + 'px' : undefined }"
    >
      <Icon
        class="q-status"
        :name="ghost.status"
        :size="15"
      />
      <BulletRender
        class="q-content"
        :content="ghost.content"
        :block-id="ghost.id"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.quadrant-view {
  height: 100%;
  padding: 4px;
  background: var(--bg-base);
}

/* 统一矩阵容器：一格边框包住四象限，内部以 1px 十字分隔线切格。
   格子内容顺序由 QUADRANTS 数组决定（先横后纵），故数组须与上方注释的格位一致。 */
.q-matrix {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 10px);
  background: var(--bg-base);
  overflow: hidden;
}

.q-cell {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: var(--bg-base);
  transition: background var(--dur-fast) var(--ease-out);
}

/* 内部十字分隔线：左列格带右边线、下行格带上边线 */
.q-cell:nth-child(odd) {
  border-right: 1px solid var(--border);
}

.q-cell:nth-child(n + 3) {
  border-top: 1px solid var(--border);
}

/* 象限头部：图标承载四色语义，其余中性色 */
.q-head {
  display: flex;
  align-items: center;
  background: var(--surface-muted);
  gap: 7px;
  padding: 10px 14px 8px;
}

.q-head-icon {
  flex-shrink: 0;
}

.q-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.q-action {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.q-count {
  font-size: 11px;
  line-height: 1;
  color: var(--text-tertiary);
  background: var(--bg-base2);
  padding: 3px 7px;
  border-radius: 9px;
}

/* 新增入口：header 右侧图标按钮 + 内联输入行 */
.q-add-head {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &:hover,
  &.active {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

/* 任务列表：无框行 + 分隔线，弱化卡片边框感 */
.q-cards {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px 10px;
  display: flex;
  flex-direction: column;
}

.q-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 8px;
  border-radius: var(--radius-sm, 4px);
  cursor: grab;
  // 触屏下让 Pointer Events 接管手势（禁用浏览器原生滚动/缩放抢占），鼠标无影响
  touch-action: none;
  transition: background var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);

  &:not(:last-child) {
    border-bottom: 1px solid var(--border);
  }

  &:hover {
    background: var(--bg-hover);
  }

  &.dragging {
    opacity: 0.4;
    background: transparent;
    cursor: grabbing;
  }

  &.done {
    opacity: 0.6;

    .q-card-main .q-content {
      text-decoration: line-through;
    }
  }
}

// 卡片主体行（标题层：状态图标 + 标题 + 截止日）
.q-card-main {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

// 标签层：标题之下、与标题文字左对齐（状态图标宽 + 间距）
.q-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-left: 22px;
}

.q-tag {
  font-size: 11px;
  line-height: 1;
  padding: 3px 8px;
  border-radius: 4px;
  color: var(--text-secondary);
  background: var(--bg-subtle, var(--bg-base2));
  white-space: nowrap;
}

// 辅助信息层：截止日为纯文本弱化（逾期才点亮红色）
.q-deadline {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;

  &.overdue {
    color: var(--error, #dc2626);
    font-weight: 600;
  }
}

// 子任务区：左侧竖线营造树形缩进；行内点击打开子任务、不参与拖拽
.q-subtasks {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 2px 0 0 4px;
  padding: 4px 0 2px 8px;
  border-left: 2px solid var(--border);
}

.q-subtask {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 6px;
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
  }

  .q-content {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  &.done .q-content {
    text-decoration: line-through;
  }

  // 第 3 层相对第 2 层再缩进
  &.l3 {
    margin-left: 14px;
  }
}

.q-status {
  flex-shrink: 0;
}

.q-content {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;

  // BulletRender 富渲染：标题块（# 开头）在卡片内降级为正文字号，保持信息密度
  :deep(h1),
  :deep(h2),
  :deep(h3),
  :deep(h4),
  :deep(h5),
  :deep(h6) {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 400;
    line-height: 1.4;
    color: var(--text-primary);
  }

  :deep(.block-placeholder) {
    color: var(--text-tertiary);
  }
}

.q-add-box {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 6px 0 2px;
  padding: 8px 10px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  background: var(--bg-base2);
}

.q-add-input {
  flex: 1;
  min-width: 0;
  padding: 0;
  background: transparent;
  border: none;
  outline: none;
  font-size: var(--text-sm);
  font-family: inherit;
  color: var(--text-primary);

  &::placeholder {
    color: var(--text-tertiary);
  }
}

.q-add-hint {
  padding: 4px 10px 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

/* 空态：图标 + 文案 + 主角按钮（颜色语义回归中性） */
.q-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px 12px;
  color: var(--text-tertiary);
}

.q-empty-icon {
  opacity: 0.6;
}

.q-empty-title {
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.q-empty-hint {
  font-size: var(--text-xs);
}

.q-empty-add {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);

  &:hover {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(99, 102, 241, 0.1);
  }
}

// 拖拽悬停的放置目标高亮（inset 以避免被容器 overflow:hidden 裁掉）
.q-cell.drop-hover {
  box-shadow: inset 0 0 0 2px var(--q-tint);
}

// 拖拽 ghost：固定定位跟随指针、不拦截事件；轻微旋转营造「被拎起」的层次感
.q-drag-ghost {
  position: fixed;
  left: 0;
  top: 0;
  z-index: var(--z-toast);
  pointer-events: none;
  transform: translate(12px, 12px) rotate(-1.5deg);
  // 宽度由内联 style 取源卡片真实 offsetWidth 锁定，保证与实际任务项等宽
  min-width: 160px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  background: var(--bg-base2);
  border: 1px solid var(--accent);
  border-radius: 8px;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32);
  opacity: 0.96;

  .q-content {
    -webkit-line-clamp: 2;
  }
}
</style>
