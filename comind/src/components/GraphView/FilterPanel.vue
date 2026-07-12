<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { useRelationshipTypes } from '../../composables/useRelationshipTypes'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import { getRelationshipColor } from '../../types/relationship'
import type { RelationshipType } from '../../types/relationship-type'

const pageStore = usePageStore()
const blockStore = useBlockStore()
const types = useRelationshipTypes()

const emit = defineEmits<{
  (e: 'filter-change', filters: FilterState): void
}>()

export interface FilterCondition {
  id: string
  type: 'search' | 'relationship' | 'time' | 'journal'
  operator: FilterOperator
  value: string | string[] | boolean | DateRange | null
  logic: 'AND' | 'OR' | 'NOT'
}

export type FilterOperator = 
  | 'contains' | 'not_contains' | 'equals' | 'not_equals'
  | 'before' | 'after' | 'between'
  | 'is' | 'is_not'

export interface DateRange {
  start: number | null
  end: number | null
}

export interface FilterState {
  conditions: FilterCondition[]
  expandedGroups: Set<string>
}

const defaultConditions: FilterCondition[] = [
  { id: 'search-1', type: 'search', operator: 'contains', value: '', logic: 'AND' },
  { id: 'relationship-1', type: 'relationship', operator: 'contains', value: [], logic: 'AND' },
  { id: 'time-1', type: 'time', operator: 'between', value: { start: null, end: null }, logic: 'AND' },
  { id: 'journal-1', type: 'journal', operator: 'is_not', value: false, logic: 'AND' },
]

const conditions = ref<FilterCondition[]>([...defaultConditions])
const expandedGroups = ref<Set<string>>(new Set(['search', 'relationship', 'time', 'journal']))
const searchResults = ref<{ id: string; title: string; contentMatch?: string }[]>([])
const isSearching = ref(false)
const collapsed = ref(false)
const hideJournalCount = ref(0)
const highlightedNodeId = ref<string | null>(null)

const groupedRelationshipTypes = computed(() => {
  const groups: Record<string, RelationshipType[]> = {}
  for (const type of types.items.value) {
    const groupName = type.group || 'custom'
    if (!groups[groupName]) {
      groups[groupName] = []
    }
    groups[groupName].push(type)
  }
  return groups
})

const groupLabels: Record<string, string> = {
  family: '家庭',
  work: '工作',
  concept: '概念',
  action: '动作',
  custom: '自定义',
}

const searchCondition = computed(() => conditions.value.find(c => c.type === 'search'))
const relationshipCondition = computed(() => conditions.value.find(c => c.type === 'relationship'))
const timeCondition = computed(() => conditions.value.find(c => c.type === 'time'))
const journalCondition = computed(() => conditions.value.find(c => c.type === 'journal'))

const selectedRelationshipTypes = computed(() => {
  return (relationshipCondition.value?.value as string[]) ?? []
})

const quickTimeRanges = [
  { label: '全部', value: 'all' },
  { label: '今天', value: 'today' },
  { label: '本周', value: 'week' },
  { label: '本月', value: 'month' },
  { label: '今年', value: 'year' },
]

const logicOptions = [
  { value: 'AND', label: '与' },
  { value: 'OR', label: '或' },
  { value: 'NOT', label: '非' },
]

const activeTimeRange = computed((): string | null => {
  if (!timeCondition.value) return null
  const range = timeCondition.value.value as DateRange
  if (range.start === null) return 'all'

  const oneDay = 24 * 60 * 60 * 1000
  const oneWeek = 7 * oneDay
  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()

  if (range.start === todayStart && range.end === todayStart + oneDay) return 'today'

  const weekStart = new Date()
  weekStart.setDate(weekStart.getDate() - weekStart.getDay())
  const weekStartTs = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()).getTime()
  if (range.start === weekStartTs && range.end === weekStartTs + oneWeek) return 'week'

  const monthStart = new Date()
  monthStart.setDate(1)
  const monthStartTs = new Date(monthStart.getFullYear(), monthStart.getMonth(), monthStart.getDate()).getTime()
  const monthEndTs = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1).getTime()
  if (range.start === monthStartTs && range.end === monthEndTs) return 'month'

  const yearStartTs = new Date(today.getFullYear(), 0, 1).getTime()
  const yearEndTs = new Date(today.getFullYear() + 1, 0, 1).getTime()
  if (range.start === yearStartTs && range.end === yearEndTs) return 'year'

  return null
})

function toggleGroup(group: string) {
  if (expandedGroups.value.has(group)) {
    expandedGroups.value.delete(group)
  } else {
    expandedGroups.value.add(group)
  }
}

function updateSearch(value: string) {
  if (searchCondition.value) {
    searchCondition.value.value = value
    performSearch(value)
  }
}

async function performSearch(query: string) {
  if (!query.trim()) {
    searchResults.value = []
    return
  }
  
  isSearching.value = true
  try {
    const results: { id: string; title: string; contentMatch?: string }[] = []
    const q = query.toLowerCase()
    
    for (const page of pageStore.pages) {
      if (page.deleted) continue
      
      let matched = false
      
      if (page.title.toLowerCase().includes(q)) {
        matched = true
      } else {
        await blockStore.loadPageBlocks(page.id)
        const blocks = blockStore.blocks.filter(b => b.pageId === page.id)
        for (const block of blocks) {
          if (block.content.toLowerCase().includes(q)) {
            matched = true
            break
          }
        }
      }
      
      if (matched) {
        results.push({ id: page.id, title: page.title })
      }
    }
    
    searchResults.value = results.slice(0, 20)
  } finally {
    isSearching.value = false
  }
}

function selectSearchResult(pageId: string) {
  highlightedNodeId.value = pageId
  emit('filter-change', getFilterState())
}

function toggleRelationshipType(type: string) {
  if (!relationshipCondition.value) return
  
  const currentValues = relationshipCondition.value.value as string[]
  const idx = currentValues.indexOf(type)
  
  if (idx === -1) {
    currentValues.push(type)
  } else {
    currentValues.splice(idx, 1)
  }
  
  emit('filter-change', getFilterState())
}

function updateRelationshipLogic(logic: 'AND' | 'OR' | 'NOT') {
  if (relationshipCondition.value) {
    relationshipCondition.value.logic = logic
    emit('filter-change', getFilterState())
  }
}

function updateTimeRange(range: string) {
  if (!timeCondition.value) return
  
  const oneDay = 24 * 60 * 60 * 1000
  const oneWeek = 7 * oneDay
  
  let start: number | null = null
  let end: number | null = null
  
  switch (range) {
    case 'today':
      const today = new Date()
      start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
      end = start + oneDay
      break
    case 'week':
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      start = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()).getTime()
      end = start + oneWeek
      break
    case 'month':
      const monthStart = new Date()
      monthStart.setDate(1)
      start = new Date(monthStart.getFullYear(), monthStart.getMonth(), monthStart.getDate()).getTime()
      end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1).getTime()
      break
    case 'year':
      const yearStart = new Date()
      start = new Date(yearStart.getFullYear(), 0, 1).getTime()
      end = new Date(yearStart.getFullYear() + 1, 0, 1).getTime()
      break
    default:
      start = null
      end = null
  }
  
  timeCondition.value.value = { start, end }
  emit('filter-change', getFilterState())
}

function updateCustomDate(type: 'start' | 'end', value: string) {
  if (!timeCondition.value) return
  
  const dateRange = timeCondition.value.value as DateRange
  if (value) {
    dateRange[type] = new Date(value).getTime()
  } else {
    dateRange[type] = null
  }
  
  emit('filter-change', getFilterState())
}

function getTimeRangeStart(): string {
  if (!timeCondition.value) return ''
  const dateRange = timeCondition.value.value as DateRange
  if (dateRange.start === null || dateRange.start === undefined) return ''
  return new Date(dateRange.start).toISOString().split('T')[0]
}

function getTimeRangeEnd(): string {
  if (!timeCondition.value) return ''
  const dateRange = timeCondition.value.value as DateRange
  if (dateRange.end === null || dateRange.end === undefined) return ''
  return new Date(dateRange.end).toISOString().split('T')[0]
}

function updateJournalFilter(value: boolean) {
  if (journalCondition.value) {
    journalCondition.value.value = value
    
    if (value) {
      hideJournalCount.value = pageStore.pages.filter(p => !p.deleted && p.type === 'journal').length
    } else {
      hideJournalCount.value = 0
    }
    
    emit('filter-change', getFilterState())
  }
}

function resetFilters() {
  conditions.value = [...defaultConditions]
  searchResults.value = []
  hideJournalCount.value = 0
  emit('filter-change', getFilterState())
}

function toggleCollapse() {
  collapsed.value = !collapsed.value
  localStorage.setItem('graph-filter-panel-collapsed', String(collapsed.value))
}

function getFilterState(): FilterState {
  return {
    conditions: conditions.value,
    expandedGroups: expandedGroups.value,
  }
}

watch(conditions, () => {
  emit('filter-change', getFilterState())
}, { deep: true })

watch(expandedGroups, () => {
  emit('filter-change', getFilterState())
}, { deep: true })

function init() {
  const saved = localStorage.getItem('graph-filter-panel-collapsed')
  collapsed.value = saved === 'true'
  
  const journalPages = pageStore.pages.filter(p => !p.deleted && p.type === 'journal')
  hideJournalCount.value = journalPages.length
}

init()
</script>

<template>
  <div class="filter-panel" :class="{ collapsed }">
    <div class="filter-panel-header">
      <div class="filter-panel-title">筛选条件</div>
      <button class="collapse-btn" @click="toggleCollapse" :title="collapsed ? '展开面板' : '折叠面板'">
        <ChevronRight v-if="collapsed" :size="16" />
        <ChevronLeft v-else :size="16" />
      </button>
    </div>
    
    <div v-if="!collapsed" class="filter-panel-content">
      <div class="filter-group">
        <div class="filter-group-header" @click="toggleGroup('search')">
          <span class="filter-group-title">🔍 搜索</span>
          <span class="filter-group-arrow">{{ expandedGroups.has('search') ? '▼' : '▶' }}</span>
        </div>
        <div v-if="expandedGroups.has('search')" class="filter-group-body">
          <div class="search-input-wrapper">
            <input
              type="text"
              :value="searchCondition?.value as string"
              placeholder="搜索标题或内容..."
              class="search-input"
              @input="updateSearch(($event.target as HTMLInputElement).value)"
            />
          </div>
          <div v-if="searchResults.length > 0" class="search-results">
            <div
              v-for="result in searchResults"
              :key="result.id"
              class="search-result-item"
              @click="selectSearchResult(result.id)"
            >
              {{ result.title }}
            </div>
          </div>
          <div class="filter-logic">
            <select
              :value="searchCondition?.logic"
              @change="searchCondition && (searchCondition.logic = ($event.target as HTMLSelectElement).value as 'AND' | 'OR' | 'NOT')"
              class="logic-select"
            >
              <option v-for="opt in logicOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <div class="filter-group">
        <div class="filter-group-header" @click="toggleGroup('relationship')">
          <span class="filter-group-title">🔗 关系类型</span>
          <span class="filter-group-arrow">{{ expandedGroups.has('relationship') ? '▼' : '▶' }}</span>
        </div>
        <div v-if="expandedGroups.has('relationship')" class="filter-group-body">
          <div class="selected-chips">
            <span
              v-for="type in selectedRelationshipTypes"
              :key="type"
              class="selected-chip"
              :style="{ backgroundColor: getRelationshipColor(type) + '20', borderColor: getRelationshipColor(type), color: getRelationshipColor(type) }"
            >
              {{ types.items.value.find(t => t.type === type || t.inverse === type)?.label || type }}
              <button class="chip-remove" @click.stop="toggleRelationshipType(type)">×</button>
            </span>
            <span v-if="selectedRelationshipTypes.length === 0" class="no-selection">未选择</span>
          </div>
          
          <div v-for="(typesInGroup, groupName) in groupedRelationshipTypes" :key="groupName" class="relationship-subgroup">
            <div class="relationship-subgroup-header">
              {{ groupLabels[groupName] || groupName }}
            </div>
            <div class="relationship-type-list">
              <label
                v-for="relType in typesInGroup"
                :key="relType.type"
                class="relationship-type-item"
              >
                <input
                  type="checkbox"
                  :checked="selectedRelationshipTypes.includes(relType.type)"
                  @change="toggleRelationshipType(relType.type)"
                  class="relationship-checkbox"
                />
                <span class="relationship-color" :style="{ backgroundColor: relType.color }"></span>
                <span class="relationship-label">{{ relType.label }}</span>
              </label>
            </div>
          </div>
          
          <div class="filter-logic">
            <select
              :value="relationshipCondition?.logic"
              @change="updateRelationshipLogic(($event.target as HTMLSelectElement).value as 'AND' | 'OR' | 'NOT')"
              class="logic-select"
            >
              <option v-for="opt in logicOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <div class="filter-group">
        <div class="filter-group-header" @click="toggleGroup('time')">
          <span class="filter-group-title">📅 时间范围</span>
          <span class="filter-group-arrow">{{ expandedGroups.has('time') ? '▼' : '▶' }}</span>
        </div>
        <div v-if="expandedGroups.has('time')" class="filter-group-body">
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
              placeholder="开始日期"
            />
            <span class="date-separator">→</span>
            <input
              type="date"
              :value="getTimeRangeEnd()"
              class="date-input"
              @change="updateCustomDate('end', ($event.target as HTMLInputElement).value)"
              placeholder="结束日期"
            />
          </div>
          <div class="filter-logic">
            <select
              :value="timeCondition?.logic"
              @change="timeCondition && (timeCondition.logic = ($event.target as HTMLSelectElement).value as 'AND' | 'OR' | 'NOT')"
              class="logic-select"
            >
              <option v-for="opt in logicOptions" :key="opt.value" :value="opt.value">
                {{ opt.label }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <div class="filter-group">
        <div class="filter-group-header" @click="toggleGroup('journal')">
          <span class="filter-group-title">📔 日记屏蔽</span>
          <span class="filter-group-arrow">{{ expandedGroups.has('journal') ? '▼' : '▶' }}</span>
        </div>
        <div v-if="expandedGroups.has('journal')" class="filter-group-body">
          <div class="toggle-switch-wrapper">
            <label class="toggle-switch">
              <input
                type="checkbox"
                :checked="journalCondition?.value as boolean"
                @change="updateJournalFilter(($event.target as HTMLInputElement).checked)"
              />
              <span class="toggle-slider"></span>
            </label>
            <span class="toggle-label">{{ journalCondition?.value ? '隐藏日记' : '显示日记' }}</span>
            <span v-if="journalCondition?.value && hideJournalCount > 0" class="toggle-count">
              (已隐藏 {{ hideJournalCount }} 篇)
            </span>
          </div>
        </div>
      </div>

      <div class="filter-panel-footer">
        <button class="reset-btn" @click="resetFilters">重置筛选</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filter-panel {
  width: 280px;
  background: var(--bg-base);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  transition: width 200ms ease;
  flex-shrink: 0;
}

.filter-panel.collapsed {
  width: 40px;
  border-right: none;
}

.filter-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--border);
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
  padding: 8px;
}

.filter-group {
  margin-bottom: 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
  overflow: hidden;
}

.filter-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
}

.filter-group-header:hover {
  background: var(--bg-active);
}

.filter-group-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
}

.filter-group-arrow {
  font-size: 10px;
  color: var(--text-tertiary);
}

.filter-group-body {
  padding: 0 12px 12px;
}

.search-input-wrapper {
  position: relative;
}

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

.search-results {
  margin-top: 8px;
  max-height: 150px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base);
}

.search-result-item {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}

.search-result-item:last-child {
  border-bottom: none;
}

.search-result-item:hover {
  background: var(--bg-hover);
}

.selected-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.selected-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid;
  border-radius: 12px;
  font-size: 11px;
}

.chip-remove {
  border: none;
  background: transparent;
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
}

.no-selection {
  font-size: 11px;
  color: var(--text-tertiary);
  font-style: italic;
}

.relationship-subgroup {
  margin-bottom: 8px;
}

.relationship-subgroup-header {
  font-size: 10px;
  color: var(--text-tertiary);
  padding: 4px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.relationship-type-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.relationship-type-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
}

.relationship-type-item:hover {
  background: var(--bg-active);
}

.relationship-checkbox {
  width: 12px;
  height: 12px;
}

.relationship-color {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.relationship-label {
  color: var(--text-secondary);
}

.quick-time-ranges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
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

.toggle-switch-wrapper {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 20px;
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

.toggle-count {
  font-size: 11px;
  color: var(--text-tertiary);
}

.filter-logic {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.logic-select {
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: 10px;
  background: var(--bg-base);
  color: var(--text-secondary);
  font-family: inherit;
}

.filter-panel-footer {
  padding: 12px;
  border-top: 1px solid var(--border);
}

.reset-btn {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  background: var(--bg-base);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
}

.reset-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>