<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { useRelationshipTypes } from '../../composables/useRelationshipTypes'
import type { FilterState } from './graphSelectors'
import { DEFAULT_FILTER_STATE } from './graphSelectors'

const emit = defineEmits<{
  (e: 'filter-change', filters: FilterState): void
  (e: 'collapsed-change', collapsed: boolean): void
}>()

const types = useRelationshipTypes()

const collapsed = ref(false)

const search = ref(DEFAULT_FILTER_STATE.search)
const relationshipTypes = ref<string[]>([...DEFAULT_FILTER_STATE.relationshipTypes])
const timeRange = ref({ ...DEFAULT_FILTER_STATE.timeRange })
const showIdeas = ref(DEFAULT_FILTER_STATE.showIdeas)
const dimIsolated = ref(DEFAULT_FILTER_STATE.dimIsolated)

const quickTimeRanges = [
  { label: '全部', value: 'all' },
  { label: '今天', value: 'today' },
  { label: '本周', value: 'week' },
  { label: '本月', value: 'month' },
  { label: '今年', value: 'year' },
]

const activeTimeRange = computed((): string | null => {
  if (timeRange.value.start === null) return 'all'

  const oneDay = 24 * 60 * 60 * 1000
  const oneWeek = 7 * oneDay
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()

  if (timeRange.value.start === todayStart && timeRange.value.end === todayStart + oneDay) return 'today'

  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const weekStartTs = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()).getTime()
  if (timeRange.value.start === weekStartTs && timeRange.value.end === weekStartTs + oneWeek) return 'week'

  const monthStart = new Date()
  monthStart.setDate(1)
  const monthStartTs = new Date(monthStart.getFullYear(), monthStart.getMonth(), monthStart.getDate()).getTime()
  const monthEndTs = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1).getTime()
  if (timeRange.value.start === monthStartTs && timeRange.value.end === monthEndTs) return 'month'

  const yearStartTs = new Date(today.getFullYear(), 0, 1).getTime()
  const yearEndTs = new Date(today.getFullYear() + 1, 0, 1).getTime()
  if (timeRange.value.start === yearStartTs && timeRange.value.end === yearEndTs) return 'year'

  return null
})

function getFilterState(): FilterState {
  return {
    search: search.value,
    relationshipTypes: [...relationshipTypes.value],
    timeRange: { ...timeRange.value },
    showIdeas: showIdeas.value,
    dimIsolated: dimIsolated.value,
  }
}

function emitChange() {
  emit('filter-change', getFilterState())
}

function toggleRelationshipType(type: string) {
  const idx = relationshipTypes.value.indexOf(type)
  if (idx === -1) {
    relationshipTypes.value.push(type)
  } else {
    relationshipTypes.value.splice(idx, 1)
  }
  emitChange()
}

function updateTimeRange(range: string) {
  const oneDay = 24 * 60 * 60 * 1000
  const oneWeek = 7 * oneDay

  let start: number | null = null
  let end: number | null = null

  switch (range) {
    case 'today': {
      const today = new Date()
      start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
      end = start + oneDay
      break
    }
    case 'week': {
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      start = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()).getTime()
      end = start + oneWeek
      break
    }
    case 'month': {
      const monthStart = new Date()
      monthStart.setDate(1)
      start = new Date(monthStart.getFullYear(), monthStart.getMonth(), monthStart.getDate()).getTime()
      end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1).getTime()
      break
    }
    case 'year': {
      const yearStart = new Date()
      start = new Date(yearStart.getFullYear(), 0, 1).getTime()
      end = new Date(yearStart.getFullYear() + 1, 0, 1).getTime()
      break
    }
    default:
      start = null
      end = null
  }

  timeRange.value = { start, end }
  emitChange()
}

function updateCustomDate(type: 'start' | 'end', value: string) {
  if (value) {
    timeRange.value[type] = new Date(value).getTime()
  } else {
    timeRange.value[type] = null
  }
  emitChange()
}

function getTimeRangeStart(): string {
  if (timeRange.value.start === null) return ''
  return new Date(timeRange.value.start).toISOString().split('T')[0]
}

function getTimeRangeEnd(): string {
  if (timeRange.value.end === null) return ''
  return new Date(timeRange.value.end).toISOString().split('T')[0]
}

function resetFilters() {
  search.value = DEFAULT_FILTER_STATE.search
  relationshipTypes.value = [...DEFAULT_FILTER_STATE.relationshipTypes]
  timeRange.value = { ...DEFAULT_FILTER_STATE.timeRange }
  showIdeas.value = DEFAULT_FILTER_STATE.showIdeas
  dimIsolated.value = DEFAULT_FILTER_STATE.dimIsolated
  emitChange()
}

function toggleCollapse() {
  collapsed.value = !collapsed.value
  localStorage.setItem('graph-filter-panel-collapsed', String(collapsed.value))
  emit('collapsed-change', collapsed.value)
}

// ---- 持久化：只持久化偏好类条件 ----
function savePreferences() {
  const prefs = {
    showIdeas: showIdeas.value,
    dimIsolated: dimIsolated.value,
  }
  try {
    localStorage.setItem('graph-filter-prefs', JSON.stringify(prefs))
  } catch { /* ignore quota */ }
}

function loadPreferences() {
  try {
    const raw = localStorage.getItem('graph-filter-prefs')
    if (!raw) return
    const prefs = JSON.parse(raw)
    if (typeof prefs.showIdeas === 'boolean') showIdeas.value = prefs.showIdeas
    if (typeof prefs.dimIsolated === 'boolean') dimIsolated.value = prefs.dimIsolated
  } catch { /* ignore */ }
}

// ---- 初始化 ----
function init() {
  const savedCollapsed = localStorage.getItem('graph-filter-panel-collapsed')
  collapsed.value = savedCollapsed === 'true'

  loadPreferences()

  emitChange()
  emit('collapsed-change', collapsed.value)
}

// 偏好类条件变更时保存
watch([showIdeas, dimIsolated], () => {
  savePreferences()
})

init()
</script>

<template>
  <div class="filter-panel" :class="{ collapsed }">
    <div class="filter-panel-header">
      <div class="filter-panel-title">筛选</div>
      <button class="collapse-btn" @click="toggleCollapse" :title="collapsed ? '展开面板' : '折叠面板'">
        <ChevronRight v-if="collapsed" :size="16" />
        <ChevronLeft v-else :size="16" />
      </button>
    </div>

    <div v-if="!collapsed" class="filter-panel-content">
      <!-- 搜索 -->
      <div class="filter-section">
        <input
          type="text"
          v-model="search"
          placeholder="搜索标题..."
          class="search-input"
          @input="emitChange"
        />
      </div>

      <div class="filter-divider" />

      <!-- 关系类型 -->
      <div class="filter-section">
        <div class="filter-section-label">关系类型</div>
        <div class="relationship-chips">
          <button
            v-for="relType in types.items.value"
            :key="relType.type"
            class="rel-chip"
            :class="{ active: relationshipTypes.includes(relType.type) }"
            :style="relationshipTypes.includes(relType.type)
              ? { backgroundColor: relType.color + '20', borderColor: relType.color, color: relType.color }
              : {}"
            @click="toggleRelationshipType(relType.type)"
          >
            {{ relType.label }}
          </button>
          <span v-if="types.items.value.length === 0" class="empty-hint">无关系类型</span>
        </div>
      </div>

      <div class="filter-divider" />

      <!-- 时间范围 -->
      <div class="filter-section">
        <div class="filter-section-label">时间</div>
        <div class="quick-time-ranges">
          <button
            v-for="range in quickTimeRanges"
            :key="range.value"
            class="quick-range-btn"
            :class="{ active: range.value === activeTimeRange }"
            @click="updateTimeRange(range.value)"
          >
            {{ range.label }}
          </button>
        </div>
        <div class="custom-date-range">
          <input
            type="date"
            :value="getTimeRangeStart()"
            class="date-input"
            @change="updateCustomDate('start', ($event.target as HTMLInputElement).value)"
          />
          <span class="date-separator">→</span>
          <input
            type="date"
            :value="getTimeRangeEnd()"
            class="date-input"
            @change="updateCustomDate('end', ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>

      <div class="filter-divider" />

      <!-- 显示选项 -->
      <div class="filter-section">
        <div class="filter-section-label">显示选项</div>
        <div class="toggle-row">
          <label class="toggle-switch">
            <input type="checkbox" v-model="showIdeas" @change="emitChange" />
            <span class="toggle-slider"></span>
          </label>
          <span class="toggle-label">显示日记</span>
        </div>
        <div class="toggle-row">
          <label class="toggle-switch">
            <input type="checkbox" v-model="dimIsolated" @change="emitChange" />
            <span class="toggle-slider"></span>
          </label>
          <span class="toggle-label">置灰孤立节点</span>
        </div>
      </div>

      <div class="filter-divider" />

      <!-- 重置 -->
      <button class="reset-btn" @click="resetFilters">重置筛选</button>
    </div>
  </div>
</template>

<style scoped>
.filter-panel {
  width: 280px;
  background: var(--bg-sidebar);
  display: flex;
  flex-direction: column;
  transition: background 120ms ease, border-color 120ms ease;
  flex-shrink: 0;
  flex: 1;
  min-height: 0;
  border-radius: var(--radius-sm);
}

.filter-panel.collapsed {
  width: 40px;
  background: transparent;
  border-right: none;
}

.filter-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
}

.filter-panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.filter-panel.collapsed .filter-panel-title {
  display: none;
}

.filter-panel.collapsed .filter-panel-header {
  border-bottom: none;
}

.collapse-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: background 80ms ease, border-color 80ms ease, color 80ms ease;
  flex-shrink: 0;
}

.collapse-btn:hover {
  background: var(--bg-active);
  border-color: var(--text-tertiary);
  color: var(--text-primary);
}

.filter-panel-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: 8px 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.filter-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.filter-section-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.filter-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}

/* 搜索 */
.search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 12px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: inherit;
  box-sizing: border-box;
}

.search-input::placeholder {
  color: var(--text-tertiary);
}

/* 关系类型 */
.relationship-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.rel-chip {
  padding: 4px 10px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  border-radius: 20px;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  transition: all 80ms ease;
}

.rel-chip:hover {
  background: var(--bg-hover);
}

.rel-chip.active {
  font-weight: 500;
}

.empty-hint {
  font-size: 11px;
  color: var(--text-tertiary);
  font-style: italic;
}

/* 时间 */
.quick-time-ranges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.quick-range-btn {
  padding: 4px 8px;
  border: 1px solid var(--border);
  background: transparent;
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  transition: background 80ms ease, border-color 80ms ease, color 80ms ease;
}

.quick-range-btn:hover {
  background: var(--bg-hover);
  border-color: var(--text-tertiary);
}

.quick-range-btn.active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.custom-date-range {
  display: flex;
  align-items: center;
  gap: 8px;
}

.date-input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 11px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-family: inherit;
  box-sizing: border-box;
  min-width: 0;
}

.date-separator {
  font-size: 12px;
  color: var(--text-tertiary);
}

/* Toggle */
.toggle-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 20px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--border);
  transition: 0.2s;
  border-radius: 20px;
}

.toggle-slider:before {
  position: absolute;
  content: '';
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: white;
  transition: 0.2s;
  border-radius: 50%;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--accent);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(20px);
}

.toggle-label {
  font-size: 12px;
  color: var(--text-secondary);
}

/* 重置 */
.reset-btn {
  padding: 6px 14px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  align-self: stretch;
}

.reset-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
