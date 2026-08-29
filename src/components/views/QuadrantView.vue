<script setup lang="ts" generic="T">
import { computed, ref } from 'vue'
import type { QuadrantConfig } from '../../core/view'
import type { BlockCard } from '../../wasm/types'

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
  /** 点击卡片导航到源记录。 */
  navigate: [itemId: string]
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

// 象限内按 deadline 升序（无日期沉底）
function sortByDeadline(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const da = cardDeadline(a)
    const db = cardDeadline(b)
    if (!da && !db) return 0
    if (!da) return 1
    if (!db) return -1
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
  emit('navigate', idOf(item))
}
</script>

<template>
  <div class="quadrant-view">
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
        </header>
        <div class="q-cards">
          <div v-if="buckets[q.priority].length === 0" class="q-empty">暂无任务</div>
          <article
            v-for="card in buckets[q.priority]"
            :key="idOf(card)"
            class="q-card"
            :class="{ dragging: dragId === idOf(card), done: isDone(card) }"
            @pointerdown="onPointerDown(card, $event)"
            @click="onCardClick(card)"
          >
            <p class="q-content">{{ asCard(card).content_preview || idOf(card) }}</p>
            <span
              v-if="formatDate(cardDeadline(card))"
              class="q-deadline"
              :class="{ overdue: isOverdue(cardDeadline(card)) }"
            >⏰ {{ formatDate(cardDeadline(card)) }}</span>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.quadrant-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  background: var(--bg-base);
}

/* 2×2 网格：行=重要/不重要（上→下），列=不紧急/紧急（左→右） */
.q-grid {
  flex: 1;
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
}

/* 四象限柔染背景 + 同色顶边强调；color-mix 跟随明暗主题，文字始终可读 */
.q-quadrant {
  background: color-mix(in srgb, var(--q-tint) 8%, var(--bg-base));
  border-top: 3px solid var(--q-tint);

  .q-head {
    background: color-mix(in srgb, var(--q-tint) 14%, var(--bg-base2));
  }

  .q-action {
    color: var(--q-tint);
    background: color-mix(in srgb, var(--q-tint) 16%, transparent);
  }

  .q-count {
    color: var(--q-tint);
    background: color-mix(in srgb, var(--q-tint) 12%, var(--bg-base));
  }
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

.q-empty {
  padding: 20px 12px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.q-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 10px;
  min-width: 160px;
  background: var(--bg-base2);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: grab;
  // 触屏下让 Pointer Events 接管手势（禁用浏览器原生滚动/缩放抢占），鼠标无影响
  touch-action: none;
  transition: box-shadow 100ms ease, border-color 100ms ease, opacity 100ms ease;

  &:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    border-color: var(--accent);
  }

  &.dragging {
    opacity: 0.4;
  }

  &.done {
    opacity: 0.6;

    .q-content {
      text-decoration: line-through;
    }
  }
}

// 拖拽悬停的放置目标高亮（inset 以避免被 .q-cell 的 overflow:hidden 裁掉）
.q-cell.drop-hover {
  box-shadow: inset 0 0 0 2px var(--q-tint);
}

.q-content {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-primary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.q-deadline {
  align-self: flex-start;
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
</style>
