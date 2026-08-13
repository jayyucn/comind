<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronLeft, ChevronRight, FileText } from 'lucide-vue-next'
import type { Page } from '../../types/page'

const props = defineProps<{
  pages: Page[]
}>()

const today = new Date()
const viewYear = ref(today.getFullYear())
const viewMonth = ref(today.getMonth()) // 0-based

/** 把 timestamp 转成 yyyy-MM-dd（本地时区）。 */
function toDateKey(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 按 updatedAt 分桶：{ '2026-08-14': Page[], ... } */
const buckets = computed(() => {
  const map: Record<string, Page[]> = {}
  for (const p of props.pages) {
    const key = toDateKey(p.updatedAt)
    ;(map[key] ??= []).push(p)
  }
  return map
})

/** 当前月历网格数据。 */
const calendarGrid = computed(() => {
  const firstDay = new Date(viewYear.value, viewMonth.value, 1)
  const startDow = (firstDay.getDay() + 6) % 7 // 周一=0
  const daysInMonth = new Date(viewYear.value, viewMonth.value + 1, 0).getDate()

  const cells: Array<{ day: number; key: string; isCurrent: boolean }> = []
  for (let i = 0; i < startDow; i++) {
    cells.push({ day: 0, key: '', isCurrent: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${viewYear.value}-${String(viewMonth.value + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    cells.push({
      day: d,
      key,
      isCurrent:
        d === today.getDate() &&
        viewMonth.value === today.getMonth() &&
        viewYear.value === today.getFullYear(),
    })
  }
  return cells
})

const monthLabel = computed(() => {
  return `${viewYear.value} 年 ${viewMonth.value + 1} 月`
})

function prev() {
  if (viewMonth.value === 0) {
    viewMonth.value = 11
    viewYear.value--
  } else {
    viewMonth.value--
  }
}

function next() {
  if (viewMonth.value === 11) {
    viewMonth.value = 0
    viewYear.value++
  } else {
    viewMonth.value++
  }
}
</script>

<template>
  <div class="page-calendar-view">
    <!-- 月导航 -->
    <div class="cal-header">
      <button class="cal-nav-btn" @click="prev" title="上个月">
        <ChevronLeft :size="16" />
      </button>
      <span class="cal-month-label">{{ monthLabel }}</span>
      <button class="cal-nav-btn" @click="next" title="下个月">
        <ChevronRight :size="16" />
      </button>
    </div>

    <!-- 星期头 -->
    <div class="cal-weekdays">
      <span v-for="w in ['一', '二', '三', '四', '五', '六', '日']" :key="w" class="calweekday">{{ w }}</span>
    </div>

    <!-- 日期网格 -->
    <div class="cal-grid">
      <div
        v-for="(cell, i) in calendarGrid"
        :key="i"
        class="cal-cell"
        :class="{ 'cal-empty': cell.day === 0, 'cal-today': cell.isCurrent, 'cal-has-pages': cell.key && buckets[cell.key]?.length }"
      >
        <span v-if="cell.day" class="cal-day-num">{{ cell.day }}</span>
        <ul v-if="cell.key && buckets[cell.key]" class="cal-page-list">
          <li v-for="p in buckets[cell.key]" :key="p.id" class="cal-page-item">
            <FileText :size="10" :stroke-width="1.5" />
            <span class="cal-page-title">{{ p.title || '(无标题)' }}</span>
          </li>
        </ul>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="pages.length === 0" class="empty-state">
      <FileText :size="32" :stroke-width="1" class="empty-icon" />
      <p>暂无页面</p>
    </div>
  </div>
</template>

<style scoped>
.page-calendar-view {
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
}

.cal-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 12px 0;
}

.cal-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 80ms ease, color 80ms ease;
}

.cal-nav-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.cal-month-label {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  min-width: 120px;
  text-align: center;
}

.cal-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
}

.calweekday {
  text-align: center;
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--text-tertiary);
  padding: 4px 0;
}

.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  padding-top: 4px;
}

.cal-cell {
  min-height: 64px;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  transition: background 80ms ease;
}

.cal-cell:hover {
  background: var(--bg-hover);
}

.cal-empty {
  background: transparent;
}

.cal-today .cal-day-num {
  font-weight: var(--font-bold);
  color: var(--accent, #6366f1);
}

.cal-has-pages {
  background: var(--bg-hover, rgba(128, 128, 128, 0.06));
}

.cal-day-num {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  display: block;
  margin-bottom: 2px;
}

.cal-page-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.cal-page-item {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  line-height: 16px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: default;
}

.cal-page-title {
  overflow: hidden;
  text-overflow: ellipsis;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--text-tertiary);
  gap: 8px;
}

.empty-icon {
  opacity: 0.3;
}
</style>
