<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import CalendarPopover from '../CalendarPopover.vue'
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

// CalendarPopover 状态（Q11: 每框一个 popover）
const startPickerVisible = ref(false)
const endPickerVisible = ref(false)

function getPopoverPosition(e: MouseEvent): { x: number; y: number } {
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  return { x: rect.left, y: rect.bottom + 4 }
}

const startPickerPos = ref({ x: 0, y: 0 })
const endPickerPos = ref({ x: 0, y: 0 })

function openStartPicker(e: MouseEvent) {
  startPickerPos.value = getPopoverPosition(e)
  startPickerVisible.value = true
  endPickerVisible.value = false
}

function openEndPicker(e: MouseEvent) {
  endPickerPos.value = getPopoverPosition(e)
  endPickerVisible.value = true
  startPickerVisible.value = false
}

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

// Q12: 日期格式 YYYY-MM-DD
function getStartDateStr(): string {
  if (timeRange.value.start === null) return ''
  const d = new Date(timeRange.value.start)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getEndDateStr(): string {
  if (timeRange.value.end === null) return ''
  const d = new Date(timeRange.value.end)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function selectStartDate(date: string) {
  timeRange.value.start = new Date(date).getTime()
  startPickerVisible.value = false
  emitChange()
}

function selectEndDate(date: string) {
  timeRange.value.end = new Date(date).getTime()
  endPickerVisible.value = false
  emitChange()
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

// ---- 持久化：只持久化偏好类条件（Q11 决策） ----
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
            :style="{ '--chip-color': relType.color }"
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
        <!-- Q19: 日期容器用输入框风格 -->
        <div class="custom-date-range">
          <button class="date-field" @click="openStartPicker">
            <span v-if="getStartDateStr()">{{ getStartDateStr() }}</span>
            <span v-else class="date-placeholder">开始日期</span>
          </button>
          <span class="date-separator">→</span>
          <button class="date-field" @click="openEndPicker">
            <span v-if="getEndDateStr()">{{ getEndDateStr() }}</span>
            <span v-else class="date-placeholder">结束日期</span>
          </button>
        </div>
      </div>

      <div class="filter-divider" />

      <!-- 显示选项：Q28 chip 风格 toggle -->
      <div class="filter-section">
        <div class="filter-section-label">显示选项</div>
        <div class="toggle-row">
          <span class="toggle-label">显示日记</span>
          <button
            class="toggle-chip"
            :class="{ active: showIdeas }"
            @click="showIdeas = !showIdeas; emitChange()"
          >
            {{ showIdeas ? '开' : '关' }}
          </button>
        </div>
        <div class="toggle-row">
          <span class="toggle-label">置灰孤立节点</span>
          <button
            class="toggle-chip"
            :class="{ active: dimIsolated }"
            @click="dimIsolated = !dimIsolated; emitChange()"
          >
            {{ dimIsolated ? '开' : '关' }}
          </button>
        </div>
      </div>

      <div class="filter-divider" />

      <!-- 重置 -->
      <button class="reset-btn" @click="resetFilters">重置筛选</button>
    </div>

    <!-- CalendarPopover 弹出 -->
    <CalendarPopover
      :visible="startPickerVisible"
      :position="startPickerPos"
      :selected-date="getStartDateStr()"
      @select="selectStartDate"
      @close="startPickerVisible = false"
    />
    <CalendarPopover
      :visible="endPickerVisible"
      :position="endPickerPos"
      :selected-date="getEndDateStr()"
      @select="selectEndDate"
      @close="endPickerVisible = false"
    />
  </div>
</template>

<style scoped>

.filter-panel {
  position: absolute;
  top: var(--graph-header-height);
  bottom: 0;
  left: 0;
  z-index: 100;
  width: var(--panel-width-md);
  background: var(--bg-sidebar);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  flex: 1;
  border-left: 1px solid var(--border);
}

.filter-panel.collapsed {
  width: 0;
  transition: width var(--transition-base);
  border-left: none;
}

/* Header */
.filter-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3);
}

.filter-panel-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
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
  transition: background var(--transition-base), border-color var(--transition-base), color var(--transition-base);
  flex-shrink: 0;

  &:hover {
    background: var(--bg-active);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
}

/* Content */
.filter-panel-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  padding: var(--space-2) var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.filter-section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.filter-section-label {
  font-size: var(--text-xs);
  font-weight: var(--font-medium);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: var(--letter-wide-1);
}

.filter-divider {
  height: 1px;
  background: var(--border);
  margin: var(--space-1) 0;
}

/* 搜索框 */
.search-input {
  width: 100%;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-xs);
  transition: all var(--transition-base);

  &:hover:not(:disabled) {
    border-color: var(--border-strong);
  }

  &:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: var(--shadow-focus);
  }

  &::placeholder {
    color: var(--text-tertiary);
  }

  &:disabled {
    background: var(--bg-hover);
    cursor: not-allowed;
  }
}

/* 关系类型 chips（Q2: CSS 变量 + color-mix） */
.relationship-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.rel-chip {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  background: var(--bg-base);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  transition: all var(--transition-base);

  &:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
}

.rel-chip.active {
  --chip-color: var(--accent);
  background: color-mix(in srgb, var(--chip-color) 12%, transparent);
  border-color: var(--chip-color);
  color: var(--chip-color);
  font-weight: var(--font-medium);
}

.empty-hint {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  font-style: italic;
}

/* 时间快捷按钮（Q3: subtle active） */
.quick-time-ranges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.quick-range-btn {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  background: transparent;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  transition: all var(--transition-base);

  &:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
}

.quick-range-btn.active {
  background: var(--accent-subtle);
  color: var(--accent);
  border-color: transparent;
  font-weight: var(--font-medium);
}

/* 日期容器（Q19: 输入框风格） */
.custom-date-range {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.date-field {
  flex: 1;
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: border-color var(--transition-base), box-shadow var(--transition-base);

  &:hover { border-color: var(--border-strong); }
  &:focus { outline: none; border-color: var(--accent); box-shadow: var(--shadow-focus); }
}

.date-placeholder {
  color: var(--text-tertiary);
}

.date-separator {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  flex-shrink: 0;
}

/* Toggle chips（Q28: chip 风格） */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.toggle-label {
  font-size: var(--text-xs);
  color: var(--text-secondary);
}

.toggle-chip {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border);
  background: transparent;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
  min-width: 36px;
  transition: all var(--transition-base);

  &:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
}

.toggle-chip.active {
  background: var(--accent-subtle);
  color: var(--accent);
  border-color: transparent;
  font-weight: var(--font-medium);
}

/* 重置按钮（Q29: 展开 button-base，避免 scoped + @use 兼容问题） */
.reset-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
  transition: background var(--transition-base), color var(--transition-base), border-color var(--transition-base), transform var(--transition-base);
  width: 100%;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-strong);
  }

  &:active:not(:disabled) {
    background: var(--bg-active);
    transform: scale(0.98);
  }

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>
