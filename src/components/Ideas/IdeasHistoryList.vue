<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { usePageStore } from '../../stores/pages'
import MonthPicker from '../MonthPicker.vue'
import IdeasHistoryItem from './IdeasHistoryItem.vue'

const pageStore = usePageStore()

const MAX_LENGTH = 31
const currentMonth = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
})()

// ===== 状态 =====
const selectedMonth = ref(currentMonth)
/** 有快照的月份（倒序），由后端按月查询轻量返回 */
const monthsWithData = computed(() => pageStore.ideasMonths)
/** 当前月历史页清单（纯快照驱动：内部只引用 ideasSnapshots） */
const currentPages = computed(() => pageStore.ideasHistoryPages(selectedMonth.value))
const loading = ref(true)
const error = ref<string | null>(null)
/** 抑制由 loadMonths 程序化回退选中月份时触发的 watch（避免重复拉取同一月） */
let suppressMonthWatch = false

// ===== 数据加载：按月异步获取 =====

async function loadMonths() {
  error.value = null
  loading.value = true
  try {
    await pageStore.loadIdeasSnapshotMonths()
    // 默认选中当前月；当前月无快照则回退到最新有数据的月
    if (!monthsWithData.value.includes(selectedMonth.value) && monthsWithData.value.length > 0) {
      suppressMonthWatch = true
      selectedMonth.value = monthsWithData.value[0]
    }
    await loadMonth(selectedMonth.value)
  } catch (e) {
    console.error('[IdeasHistoryList] loadIdeasSnapshotMonths failed:', e)
    error.value = '加载失败'
  } finally {
    loading.value = false
  }
}

async function loadMonth(month: string) {
  if (!month) return
  error.value = null
  loading.value = true
  try {
    await pageStore.loadIdeasSnapshotsByMonth(month)
  } catch (e) {
    console.error('[IdeasHistoryList] loadIdeasSnapshotsByMonth failed:', e)
    error.value = '加载失败'
  } finally {
    loading.value = false
  }
}

// 切换月份 → 异步拉该月快照
watch(selectedMonth, (m) => {
  if (suppressMonthWatch) {
    suppressMonthWatch = false
    return
  }
  if (monthsWithData.value.includes(m)) loadMonth(m)
})

function retry() {
  loadMonths()
}

// ===== 生命周期 =====

onMounted(loadMonths)
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
    <div v-else-if="currentPages.length === 0" class="empty-state">
      <div class="empty-text">暂无历史点滴</div>
    </div>

    <!-- normal -->
    <div v-else class="history-scroller">
      <IdeasHistoryItem
        v-for="page in currentPages.slice(0, MAX_LENGTH)"
        :key="page.pageId"
        :page-id="page.pageId"
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
  padding: 8px 36px;
  border-bottom: 1px solid var(--border, #E7E5E4);
  backdrop-filter: blur(4px);
  user-select: none;
}

.history-scroller {
  flex: 1;
  overflow-y: auto;
  background: transparent;
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
</style>
