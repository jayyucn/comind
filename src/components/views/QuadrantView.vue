<script setup lang="ts" generic="T">
import { computed, nextTick, ref } from 'vue'
import type { QuadrantConfig } from '../../core/view'
import type { BlockCard } from '../../wasm/types'
import BulletRender from '../Block/handlers/bullet/BulletRender.vue'
import Icon from '../Icons/Icon.vue'

/**
 * 任务四象限视图（艾森豪威尔矩阵）。
 * 卡片按 priority 四值落格，行=重要/不重要（上→下）、列=不紧急/不紧急（左→右）：
 *   左上 Medium  重要不紧急 → 计划做
 *   右上 Urgent  重要且紧急 → 立即做
 *   左下 Low     不重要不紧急 → 减少
 *   右下 High    不重要但紧急 → 委托
 * 拖拽卡片到另一象限即改写其 priority（复用消费方 onCellChange → propertyStore.setProperty）。
 * 仅纳入 status ∈ {Todo, Doing, Done} 且含 priority 的卡片（四象限需同时具备 status 与 priority），无 priority 的卡片不显示。
 * 组件零业务耦合：只消费 items（泛型）与 BlockCard 形状，事件经 cell-change / navigate 上抛。
 */
const props = defineProps<{
  /** 已过滤+排序的扁平列表（与看板/表格共用）；组件内按 status/priority 二次分拣。 */
  items: T[]
  /** 布局配置（当前无附加元数据，预留透传）。 */
  config?: QuadrantConfig
  /** 取记录 id 的字段名（默认 'id'；BlockCard 用 'block_id'）。 */
  idKey?: string
}>()

const emit = defineEmits<{
  /** 拖拽改象限：把记录 priority 改为目标象限对应值。 */
  cellChange: [itemId: string, fieldKey: string, value: unknown]
  /** 点击卡片打开单 block 编辑抽屉（由消费方渲染 BlockDrawer）。 */
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
const visibleItems = computed<T[]>(() =>
  props.items.filter((i) => {
    const card = asCard(i)
    const st = card.properties?.['status']
    const pr = card.properties?.['priority']
    return (
      st != null &&
      ACTIVE_STATUSES.has(String(st)) &&
      pr != null &&
      pr !== '' &&
      QUADRANT_KEYS.includes(String(pr))
    )
  }),
)

interface Quadrant {
  priority: string
  title: string
  action: string
  /** 主题色（用于象限背景柔染与顶边强调），5xx 级别，明暗主题均可读。 */
  tint: string
}
// tint 取项目内置优先级配色（useBlockQueryRegistry 的 PRIORITY_COLORS），
// 与表格/看板中优先级圆点、block 背景染色同色系，保证视觉一致（内联以零业务耦合）。
const QUADRANTS: Quadrant[] = [
  { priority: 'Medium', title: '重要不紧急', action: '计划做', tint: '#3B82F6' },
  { priority: 'Urgent', title: '重要且紧急', action: '立即做', tint: '#DC2626' },
  { priority: 'Low', title: '不重要不紧急', action: '减少', tint: '#9CA3AF' },
  { priority: 'High', title: '不重要但紧急', action: '委托', tint: '#F59E0B' },
]
const QUADRANT_KEYS = QUADRANTS.map((q) => q.priority)

function priorityOf(item: T): string | undefined {
  const v = asCard(item).properties?.['priority']
  return v == null || v === '' ? undefined : String(v)
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

// 象限内按 deadline 升序；新建任务默认无截止日，置顶（放在首位）
function sortByDeadline(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const da = cardDeadline(a)
    const db = cardDeadline(b)
    if (!da && !db) return 0
    if (!da) return -1 // 无日期（多为新建任务）置顶
    if (!db) return 1
    return da < db ? -1 : da > db ? 1 : 0
  })
}

// 预先分桶（单次遍历 + 每桶排序），避免模板内重复计算
const buckets = computed<Record<string, T[]>>(() => {
  const map: Record<string, T[]> = { Medium: [], Urgent: [], Low: [], High: [] }
  for (const i of visibleItems.value) {
    const p = priorityOf(i)
    if (p && map[p]) map[p].push(i)
  }
  for (const k of QUADRANT_KEYS) map[k] = sortByDeadline(map[k])
  return map
})
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

let pointerStart: { x: number; y: number; id: string } | null = null
let dragging = false

function onPointerDown(item: T, e: PointerEvent) {
  // 仅响应主键（鼠标左键 / 触摸 / 触控笔接触）；右键等忽略，避免误触
  if (e.button != null && e.button !== 0) return
  pointerStart = { x: e.clientX, y: e.clientY, id: idOf(item) }
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
    document.body.style.userSelect = 'none'
  }
  hoveredPriority.value = resolvePriority(e.target)
  e.preventDefault()
}

function finishDrag() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  document.body.style.userSelect = ''
  dragId.value = null
  hoveredPriority.value = null
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
    <div class="q-axis q-axis-y" aria-hidden="true">
      <span class="q-axis-label">重要</span>
      <span class="q-axis-line" />
      <span class="q-axis-label">不重要</span>
    </div>

    <div class="q-grid">
      <section
        v-for="q in QUADRANTS"
        :key="q.priority"
        class="q-cell q-quadrant"
        :class="{ 'drop-hover': dragId && hoveredPriority === q.priority }"
        :style="{ '--q-tint': q.tint }"
        :data-priority="q.priority"
      >
        <header class="q-head">
          <span class="q-title">{{ q.title }}</span>
          <span class="q-action">{{ q.action }}</span>
          <span class="q-count">{{ buckets[q.priority].length }}</span>
          <button
            type="button"
            class="q-add-head"
            :class="{ active: addingFor === q.priority }"
            @click="startAdd(q.priority)"
          >
            <svg class="q-add-plus" width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2.5V11.5M2.5 7H11.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
            <span>新建任务</span>
          </button>
        </header>
        <div class="q-cards">
          <div v-if="addingFor === q.priority" class="q-add-box">
            <Icon name="status-todo"/>
            <input
              :ref="setAddInputRef"
              v-model="addDraft"
              class="q-add-input"
              placeholder="输入任务标题"
              @keydown.enter.prevent="commitAdd()"
              @keydown.esc.prevent="cancelAdd()"
              @blur="cancelAdd()"
            />
          </div>
          <div v-if="addingFor === q.priority" class="q-add-hint">回车添加 · Esc 收起 · 可连续录入</div>
          <article
            v-for="card in buckets[q.priority]"
            :key="idOf(card)"
            class="q-card"
            :class="{ dragging: dragId === idOf(card), done: isDone(card) }"
            @pointerdown="onPointerDown(card, $event)"
            @click="onCardClick(card)"
          >
            <Icon class="q-status" :name="statusKey(card)" />
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
          </article>
        </div>
      </section>
    </div>

    <div class="q-axis q-axis-x" aria-hidden="true">
      <span class="q-axis-label">不紧急</span>
      <span class="q-axis-line" />
      <span class="q-axis-label">紧急</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.quadrant-view {
  display: grid;
  grid-template-columns: 22px 1fr;
  grid-template-rows: 1fr 22px;
  gap: 8px;
  height: 100%;
  padding: 4px;
  background: var(--bg-base);
}

/* 显式坐标轴：Y=重要/不重要（上→下），X=不紧急/紧急（左→右） */
.q-axis {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.q-axis-y {
  grid-column: 1;
  grid-row: 1;
  flex-direction: column;
  padding: 4px 0;
}

.q-axis-y .q-axis-line {
  flex: 1;
  width: 1px;
  background: var(--border);
}

.q-axis-x {
  grid-column: 2;
  grid-row: 2;
  padding: 0 4px;
}

.q-axis-x .q-axis-line {
  flex: 1;
  height: 1px;
  background: var(--border);
}

/* 2×2 网格：行=重要/不重要（上→下），列=不紧急/紧急（左→右） */
.q-grid {
  grid-column: 2;
  grid-row: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 10px;
}

.q-cell {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 10px);
  background: var(--bg-base);
  overflow: hidden;
  transition: box-shadow 120ms ease, background 120ms ease;
}

/* 四象限柔染背景 + 同色顶边强调；改用 rgba 叠色（不依赖 color-mix），
   明暗主题通用、跨 webview 稳定。tint 已烘焙为带透明度实色，盖在主题底色上。 */
.q-quadrant {
  border-top: 4px solid var(--q-tint);

  .q-action {
    color: var(--q-tint);
    background: rgba(59, 130, 246, 0.16); // 默认 Medium 蓝，下方按象限覆盖
  }

  .q-count {
    color: var(--q-tint);
    background: rgba(59, 130, 246, 0.12);
  }
}

/* 优先级视觉梯度：立即做(Urgent) 最突出，减少(Low) 最弱 */
.q-quadrant[data-priority='Medium'] {
  background:
    linear-gradient(rgba(59, 130, 246, 0.11), rgba(59, 130, 246, 0.11)),
    var(--bg-base);
  .q-head { background: linear-gradient(rgba(59, 130, 246, 0.15), rgba(59, 130, 246, 0.15)), var(--bg-base2); }
}
.q-quadrant[data-priority='Urgent'] {
  background:
    linear-gradient(rgba(220, 38, 38, 0.16), rgba(220, 38, 38, 0.16)),
    var(--bg-base);
  box-shadow: inset 0 1px 0 rgba(220, 38, 38, 0.35);
  .q-head { background: linear-gradient(rgba(220, 38, 38, 0.22), rgba(220, 38, 38, 0.22)), var(--bg-base2); }
  .q-action { background: rgba(220, 38, 38, 0.22); }
  .q-count { background: rgba(220, 38, 38, 0.14); }
}
.q-quadrant[data-priority='High'] {
  background:
    linear-gradient(rgba(245, 158, 11, 0.12), rgba(245, 158, 11, 0.12)),
    var(--bg-base);
  .q-head { background: linear-gradient(rgba(245, 158, 11, 0.14), rgba(245, 158, 11, 0.14)), var(--bg-base2); }
  .q-action { background: rgba(245, 158, 11, 0.18); }
  .q-count { background: rgba(245, 158, 11, 0.12); }
}
.q-quadrant[data-priority='Low'] {
  background:
    linear-gradient(rgba(156, 163, 175, 0.09), rgba(156, 163, 175, 0.09)),
    var(--bg-base);
  .q-head { background: linear-gradient(rgba(156, 163, 175, 0.11), rgba(156, 163, 175, 0.11)), var(--bg-base2); }
  .q-action { background: rgba(156, 163, 175, 0.18); }
  .q-count { background: rgba(156, 163, 175, 0.12); }
}

.q-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-base2);
}

.q-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
}

.q-action {
  font-size: var(--text-xs);
  color: var(--accent);
  background: var(--accent-subtle, rgba(129, 140, 248, 0.12));
  padding: 1px 7px;
  border-radius: 10px;
}

.q-count {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  background: var(--bg-base);
  padding: 1px 6px;
  border-radius: 10px;
}

.q-cards {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.q-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  min-width: 160px;
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: grab;
  // 触屏下让 Pointer Events 接管手势（禁用浏览器原生滚动/缩放抢占），鼠标无影响
  touch-action: none;
  transition: box-shadow 120ms ease, border-color 120ms ease, opacity 120ms ease, transform 120ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    border-color: var(--accent);
  }

  &.dragging {
    opacity: 0.55;
    transform: translateY(-2px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
    border-color: var(--accent);
    cursor: grabbing;
  }

  &.done {
    opacity: 0.6;

    .q-content {
      text-decoration: line-through;
    }
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

.q-deadline {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  color: var(--text-secondary);

  &.overdue {
    color: var(--error, #dc2626);
    border-color: var(--error, #dc2626);
  }
}

/* 新增入口：header 内「新建任务」按钮（置于 q-count 右侧）+ 内联输入行 */
.q-add-head {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 8px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: transparent;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background 120ms ease;

  &:hover,
  &.active {
    border-color: var(--accent);
    color: var(--accent);
    background: rgba(99, 102, 241, 0.1);
  }
}

.q-add-box {
  display: flex;
  align-items: center;
  gap: 6px;
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
  padding: 0 2px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

// 拖拽悬停的放置目标高亮（inset 以避免被 .q-cell 的 overflow:hidden 裁掉）
.q-cell.drop-hover {
  box-shadow: inset 0 0 0 2px var(--q-tint);
}
</style>
