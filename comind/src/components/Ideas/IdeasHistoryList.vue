<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, onDeactivated, onActivated, nextTick } from 'vue'
import { format } from 'date-fns'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import type { Page } from '../../types/page'
import IdeasHistoryItem from './IdeasHistoryItem.vue'
import MonthPicker from '../MonthPicker.vue'

/** 跨 remount 保留：避免 ideas-list ↔ ideas-page 来回切换重复批量 IPC */
const loadedMonthsGlobal = new Set<string>()
const monthPagesCacheGlobal = new Map<string, Page[]>()
/** 同月并发/重入 loadMonthData 去重，避免 remount 叠加多次批量 IPC */
const inflightMonthLoads = new Map<string, Promise<void>>()

const pageStore = usePageStore()
const blockStore = useBlockStore()

const props = defineProps<{
  targetPageId?: string
}>()

const MAX_LENGTH = 31
const currentMonth = format(new Date(), 'yyyy-MM')
const todayKey = format(new Date(), 'yyyy-MM-dd')

// ===== 状态 =====
const selectedMonth = ref(currentMonth)
const monthsWithData = ref<string[]>([])
const currentPages = ref<Page[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// 已加载过的月份缓存（页面元数据 + blocks 都已加载）
const loadedMonths = loadedMonthsGlobal

// 已加载月份的页面数据缓存
const monthPagesCache = monthPagesCacheGlobal

// 竞态保护：generation counter
let requestId = 0
let idleLoadHandle: ReturnType<typeof requestIdleCallback> | null = null
let idleLoadTimeout: ReturnType<typeof setTimeout> | null = null

// ===== 数据加载 =====

function parseMonth(monthKey: string): [number, number] {
  const [year, mon] = monthKey.split('-').map(Number)
  return [year, mon]
}

function cancelDeferredLoad() {
  if (idleLoadHandle !== null) {
    cancelIdleCallback(idleLoadHandle)
    idleLoadHandle = null
  }
  if (idleLoadTimeout !== null) {
    clearTimeout(idleLoadTimeout)
    idleLoadTimeout = null
  }
}

function scheduleLoadMonthData(month: string) {
  cancelDeferredLoad()
  const run = () => {
    idleLoadHandle = null
    idleLoadTimeout = null
    loadMonthData(month)
  }
  if (typeof requestIdleCallback !== 'undefined') {
    idleLoadHandle = requestIdleCallback(run, { timeout: 1500 })
  } else {
    idleLoadTimeout = setTimeout(run, 50)
  }
}

function historyPageIdsFrom(pages: Page[]): string[] {
  return pages.filter(p => p.title !== todayKey).map(p => p.id)
}

function isMonthReady(month: string): boolean {
  if (!loadedMonths.has(month)) return false
  const pages = monthPagesCache.get(month) ?? []
  const ids = historyPageIdsFrom(pages)
  return ids.length === 0 || ids.every(id => blockStore.getBlocksByPage(id).length > 0)
}

function applyMonthUi(month: string) {
  if (isMonthReady(month)) {
    currentPages.value = monthPagesCache.get(month) ?? []
    loading.value = false
    error.value = null
  }
}

async function loadMonthDataImpl(month: string) {
  const myId = ++requestId
  loading.value = true
  error.value = null
  const loadT0 = import.meta.env.DEV ? performance.now() : 0

  try {
    const [year, mon] = parseMonth(month)
    let metaT0 = 0
    if (import.meta.env.DEV) metaT0 = performance.now()
    const pages = await pageStore.getIdeasPagesByMonth(year, mon)
    if (import.meta.env.DEV) {
      console.debug('[ipc-timing] getIdeasPagesByMonth', {
        ms: +(performance.now() - metaT0).toFixed(1),
        month,
        pageCount: pages.length,
      })
    }

    // 竞态检查：被后续请求取代则丢弃
    if (myId !== requestId) return

    const pageIds = pages.map(p => p.id)
    const uncachedPageIds = pageIds.filter(
      id => !blockStore.getBlocksByPage(id).length
    )
    if (uncachedPageIds.length > 0) {
      await blockStore.loadMultiPageBlocks(uncachedPageIds)
    } else if (import.meta.env.DEV) {
      console.debug('[ipc-timing] loadMonthData blocks already cached', { month, pageCount: pageIds.length })
    }
    if (import.meta.env.DEV) {
      console.debug('[ipc-timing] loadMonthData total', {
        ms: +(performance.now() - loadT0).toFixed(1),
        month,
        pageCount: pageIds.length,
      })
    }

    // 再次检查竞态
    if (myId !== requestId) return

    const historyIds = historyPageIdsFrom(pages)
    if (historyIds.some(id => blockStore.getBlocksByPage(id).length === 0)) {
      // abort 或 IPC 失败：不标记 loadedMonths，避免下次误判为已缓存
      const filtered = pages.filter(p => p.title !== todayKey)
      currentPages.value = filtered.sort((a, b) => b.title.localeCompare(a.title))
      loading.value = false
      return
    }

    // 排除今日页面（今日由左侧面板负责），保留当月其他日期
    const filtered = pages.filter(p => p.title !== todayKey)
    const sorted = filtered.sort((a, b) => b.title.localeCompare(a.title))
    currentPages.value = sorted
    loadedMonths.add(month)
    monthPagesCache.set(month, sorted)
    loading.value = false
  } catch (e) {
    if (myId !== requestId) return
    console.error('[IdeasHistoryList] loadMonthData failed:', e)
    error.value = '加载失败'
    loading.value = false
  }
}

async function loadMonthData(month: string) {
  if (isMonthReady(month)) {
    applyMonthUi(month)
    return
  }
  const inflight = inflightMonthLoads.get(month)
  if (inflight) {
    await inflight
    applyMonthUi(month)
    return
  }
  const task = loadMonthDataImpl(month)
  inflightMonthLoads.set(month, task)
  try {
    await task
  } finally {
    inflightMonthLoads.delete(month)
  }
}

function handleMonthChange(month: string) {
  if (isMonthReady(month)) {
    applyMonthUi(month)
    return
  }
  scheduleLoadMonthData(month)
}

function retry() {
  loadMonthData(selectedMonth.value)
}

// ===== 生命周期 =====

// 标记 onMounted 首次加载完成，避免 watch 重复触发
let initialized = false

onBeforeUnmount(() => {
  cancelDeferredLoad()
  blockStore.abortMultiPageLoad()
})

onDeactivated(() => {
  // 仅取消尚未开始的 idle 加载；进行中的 IPC 让它跑完以写入 blocks 缓存
  cancelDeferredLoad()
})

onActivated(async () => {
  if (!initialized) return
  if (isMonthReady(selectedMonth.value)) {
    applyMonthUi(selectedMonth.value)
    return
  }
  const inflight = inflightMonthLoads.get(selectedMonth.value)
  if (inflight) {
    loading.value = true
    await inflight
    applyMonthUi(selectedMonth.value)
    if (isMonthReady(selectedMonth.value)) return
  }
  scheduleLoadMonthData(selectedMonth.value)
})

onMounted(async () => {
  try {
    const months = await pageStore.getIdeasMonths()
    monthsWithData.value = months

    if (months.length === 0) {
      loading.value = false
      initialized = true
      return
    }

    selectedMonth.value = months[0]
    if (isMonthReady(selectedMonth.value)) {
      applyMonthUi(selectedMonth.value)
    } else {
      scheduleLoadMonthData(selectedMonth.value)
    }
    initialized = true
  } catch (e) {
    console.error('[IdeasHistoryList] getIdeasMonths failed:', e)
    error.value = '加载失败'
    loading.value = false
    initialized = true
  }
})

// MonthPicker 月份切换（初始化完成后才响应）
watch(selectedMonth, (newMonth) => {
  if (!initialized) return
  handleMonthChange(newMonth)
})

// 跳转到目标页面（来自 BlockTaskList 的 navigate）
watch(() => props.targetPageId, async (targetId) => {
  if (!targetId || !initialized) return
  // 找到目标页面
  const targetPage = currentPages.value.find(p => p.id === targetId)
  if (!targetPage) {
    // 可能不在当前月份，从 page title 解析月份 (yyyy-MM-dd)
    // 先查找所有缓存
    for (const [month, pages] of monthPagesCache) {
      const found = pages.find(p => p.id === targetId)
      if (found) {
        if (selectedMonth.value !== month) {
          selectedMonth.value = month
          handleMonthChange(month)
        }
        break
      }
    }
    // 仍然没找到，尝试从 pageStore 获取
    const page = pageStore.getPage(targetId)
    if (page) {
      const month = page.title.substring(0, 7) // yyyy-MM
      if (selectedMonth.value !== month) {
        selectedMonth.value = month
        handleMonthChange(month)
      }
    }
  }
  // 等待 DOM 更新后滚动到目标项
  await nextTick()
  await nextTick() // 双 nextTick 确保数据加载完成
  const el = document.querySelector(`[data-page-id="${targetId}"]`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('task-highlight')
    setTimeout(() => el.classList.remove('task-highlight'), 2000)
  }
})

// ===== 计算属性 =====
const isEmpty = computed(() => currentPages.value.length === 0)
</script>

<template>
  <div class="history-list">
    <div class="history-sticky-header">
      <MonthPicker v-model="selectedMonth" :months-with-data="monthsWithData" />
    </div>

    <!-- loading: 骨架屏 -->
    <div v-if="loading" class="history-scroller skeleton-list">
      <div v-for="i in 3" :key="i" class="skeleton-item">
        <div class="skeleton-header">
          <div class="skeleton-dot"></div>
          <div class="skeleton-date"></div>
          <div class="skeleton-weekday"></div>
        </div>
        <div class="skeleton-body">
          <div class="skeleton-line"></div>
          <div class="skeleton-line short"></div>
        </div>
      </div>
    </div>

    <!-- error -->
    <div v-else-if="error" class="error-state">
      <span class="error-text">{{ error }}，点击重试</span>
      <button class="retry-btn" @click="retry">重试</button>
    </div>

    <!-- empty -->
    <div v-else-if="isEmpty" class="empty-state">
      <div class="empty-text">暂无历史点滴</div>
    </div>

    <!-- normal -->
    <div v-else class="history-scroller">
      <IdeasHistoryItem
        v-for="page in currentPages.slice(0, MAX_LENGTH)"
        :key="page.id"
        :page-id="page.id"
        :data-page-id="page.id"
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.history-list {
  flex: 0 0 480px;
  margin-left: auto;
  display: flex;
  background: transparent;
  flex-direction: column;
  margin-top: var(--nav-height);
  overflow: hidden;
  border-radius: var(--radius-lg) 0 0 0 ;
  border-left: 1px solid var(--border, #E7E5E4);
  border-top: 1px solid var(--border, #E7E5E4);
  box-shadow: -4px -2px 5px rgba($color: #000000, $alpha: 0.08);
}

.history-sticky-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 0;
  background: transparent;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border, #E7E5E4);
  backdrop-filter: blur(4px);
}

.history-scroller {
  flex: 1;
  overflow-y: auto;
  background: transparent;
  padding: 0 12px 0 20px;
  position: relative;
  scrollbar-width: thin; // Firefox: 保留细条但默认半透明
  scrollbar-color: transparent transparent;
  transition: scrollbar-color 0.3s ease;

  &:hover {
    scrollbar-color: var(--border, #C7C7CC) transparent;
  }

  // WebKit (Chrome/Edge/Tauri WebView)
  &::-webkit-scrollbar {
    width: 6px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background-color: transparent;
    border-radius: 3px;
    transition: background-color 0.3s ease;
  }
  &:hover::-webkit-scrollbar-thumb {
    background-color: var(--border, #C7C7CC);
  }
}

// 骨架屏
.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 12px 0 20px;
}

.skeleton-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skeleton-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--linear-gradient);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-date {
  width: 60px;
  height: 12px;
  background: var(--linear-gradient);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 3px;
}

.skeleton-weekday {
  width: 30px;
  height: 10px;
  background: var(--linear-gradient);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 3px;
}

.skeleton-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-left: 16px;
}

.skeleton-line {
  height: 10px;
  background: var(--linear-gradient);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 3px;
}

.skeleton-line.short {
  width: 60%;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

// 错误态
.error-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
}

.error-text {
  font-size: 12px;
  color: var(--text-tertiary, #A8A29E);
}

.retry-btn {
  font-size: 12px;
  color: var(--accent, #6366F1);
  background: transparent;
  border: 1px solid var(--border, #E7E5E4);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  transition: background var(--transition-base, 0.15s), border-color var(--transition-base, 0.15s);

  &:hover {
    background: var(--bg-hover, #F0F0F0);
    border-color: var(--border-strong, #D6D3D1);
  }
}

// 空状态
.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.empty-text {
  font-size: 12px;
  color: var(--text-tertiary, #A8A29E);
}

:deep(.task-highlight) {
  animation: task-highlight-fade 2s ease-out;
}

@keyframes task-highlight-fade {
  0% { background-color: rgba(59, 130, 246, 0.2); }
  100% { background-color: transparent; }
}
</style>
