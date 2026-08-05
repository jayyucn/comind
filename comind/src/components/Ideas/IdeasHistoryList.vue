<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { format } from 'date-fns'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import type { Page } from '../../types/page'
import IdeasHistoryItem from './IdeasHistoryItem.vue'
import MonthPicker from '../MonthPicker.vue'

const pageStore = usePageStore()
const blockStore = useBlockStore()

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
const loadedMonths = new Set<string>()

// 已加载月份的页面数据缓存
const monthPagesCache = new Map<string, Page[]>()

// 竞态保护：generation counter
let requestId = 0

// ===== 数据加载 =====

function parseMonth(monthKey: string): [number, number] {
  const [year, mon] = monthKey.split('-').map(Number)
  return [year, mon]
}

async function loadMonthData(month: string) {
  const myId = ++requestId
  loading.value = true
  error.value = null

  try {
    const [year, mon] = parseMonth(month)
    const pages = await pageStore.getIdeasPagesByMonth(year, mon)

    // 竞态检查：被后续请求取代则丢弃
    if (myId !== requestId) return

    const pageIds = pages.map(p => p.id)
    if (pageIds.length > 0) {
      await blockStore.loadMultiPageBlocks(pageIds)
    }

    // 再次检查竞态
    if (myId !== requestId) return

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

function handleMonthChange(month: string) {
  // 缓存命中：直接使用缓存数据
  if (loadedMonths.has(month)) {
    currentPages.value = monthPagesCache.get(month) ?? []
    loading.value = false
    error.value = null
    return
  }
  // 未命中：加载数据
  loadMonthData(month)
}

function retry() {
  loadMonthData(selectedMonth.value)
}

// ===== 生命周期 =====

// 标记 onMounted 首次加载完成，避免 watch 重复触发
let initialized = false

onMounted(async () => {
  try {
    const months = await pageStore.getIdeasMonths()
    monthsWithData.value = months

    if (months.length === 0) {
      // 没有历史数据，显示空状态
      loading.value = false
      initialized = true
      return
    }

    // 选中最近的月份（列表已是倒序，第一项是最近的）
    // 直接加载数据，不触发 watch
    selectedMonth.value = months[0]
    await loadMonthData(selectedMonth.value)
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
      />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.history-list {
  flex: 0 0 360px;
  margin-left: auto;
  display: flex;
  background: var(--bg-base2);// #1A1b1f;//var(#0c39ac, transparent);
  flex-direction: column;
  overflow: hidden;
  margin-top: 2px;
  border-left: 1px solid var(--border, #E7E5E4);
  box-shadow: -4px -2px 5px  rgba($color: #000000, $alpha: 0.0);
}

.history-sticky-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  position: sticky;
  top: 0;
  background: transparent;
  padding: 8px 12px;
  z-index: 2;
  border-bottom: 1px solid var(--border, #E7E5E4);
  backdrop-filter: blur(4px);
}

.history-scroller {
  flex: 1;
  overflow-y: auto;
  background: transparent;//var(--bg-base, #F5F5F7);
  padding: 0 12px 0 20px;
  position: relative;
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
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.skeleton-date {
  width: 60px;
  height: 12px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 3px;
}

.skeleton-weekday {
  width: 30px;
  height: 10px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
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
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
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
</style>
