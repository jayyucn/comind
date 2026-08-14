<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useSavedFilterStore } from '../../stores/savedFilter'
import { Plus, X, Save, Bookmark } from 'lucide-vue-next'
import type { BlockQuery, BlockField, FilterCondition, FilterOp, SortRule } from '../../types/blockQuery'

const props = defineProps<{
  query: BlockQuery
}>()

const emit = defineEmits<{
  apply: [query: BlockQuery]
  close: []
}>()

const savedFilterStore = useSavedFilterStore()

// Local state for editing
const filters = ref<FilterCondition[]>(props.query.filters.map(f => ({ ...f, value: f.value })))
const sortField = ref<string>('')
const sortDir = ref<'asc' | 'desc'>('desc')
const showSaveDialog = ref(false)
const saveName = ref('')
const showSavedFilters = ref(false)

// Detect if sort is already set
watch(() => props.query, (q) => {
  filters.value = q.filters.map(f => ({ ...f, value: f.value }))
  if (q.sort.length > 0) {
    const first = q.sort[0]
    if (first.field.kind === 'property') sortField.value = first.field.key
    else if (first.field.kind === 'dateRef') sortField.value = 'dateRef.' + first.field.ref
    else sortField.value = 'content'
    sortDir.value = first.dir
  }
}, { immediate: true })

const fieldOptions = [
  { label: '状态', value: 'property:status' },
  { label: '优先级', value: 'property:priority' },
  { label: '项目', value: 'property:project' },
  { label: '领域', value: 'property:area' },
  { label: '内容', value: 'content' },
  { label: '日期类型', value: 'dateRef:kind' },
  { label: '日期', value: 'dateRef:date' },
]

function addFilter() {
  filters.value.push({
    field: { kind: 'property', key: 'status' },
    op: 'hasAny',
    value: null,
  })
}

function removeFilter(index: number) {
  filters.value.splice(index, 1)
}

function getFieldKind(value: string): BlockField {
  if (value === 'content') return { kind: 'content' }
  if (value.startsWith('dateRef:')) {
    return { kind: 'dateRef', ref: value.split(':')[1] as 'kind' | 'date' }
  }
  return { kind: 'property', key: value.split(':')[1] ?? value }
}

function getFieldDisplay(filter: FilterCondition): string {
  if (filter.field.kind === 'content') return 'content'
  if (filter.field.kind === 'dateRef') return `dateRef:${filter.field.ref}`
  return `property:${filter.field.key}`
}

function availableOps(filter: FilterCondition): FilterOp[] {
  if (filter.field.kind === 'content') return ['contains', 'hasAny', 'isEmpty']
  if (filter.field.kind === 'dateRef') {
    if (filter.field.ref === 'date') return ['before', 'after', 'hasAny', 'isEmpty']
    return ['is', 'hasAny', 'isEmpty']
  }
  return ['is', 'isNot', 'contains', 'hasAny', 'isEmpty']
}

function updateField(index: number, fieldValue: string) {
  const field = getFieldKind(fieldValue)
  filters.value[index].field = field
  const ops = availableOps(filters.value[index])
  if (!ops.includes(filters.value[index].op)) {
    filters.value[index].op = ops[0]
  }
}

function apply() {
  const sortRules: SortRule[] = sortField.value
    ? [{ field: getFieldKind(sortField.value), dir: sortDir.value }]
    : []

  emit('apply', {
    filters: filters.value,
    sort: sortRules,
    groupBy: props.query.groupBy,
  })
}

async function saveAsFilter() {
  if (!saveName.value.trim()) return
  await savedFilterStore.save(saveName.value.trim(), JSON.stringify({
    filters: filters.value,
    sort: sortField.value ? [{ field: getFieldKind(sortField.value), dir: sortDir.value }] : [],
    groupBy: props.query.groupBy,
  }))
  saveName.value = ''
  showSaveDialog.value = false
}

async function loadSavedFilter(queryJson: string) {
  try {
    const q: BlockQuery = JSON.parse(queryJson)
    filters.value = q.filters
    if (q.sort.length > 0) {
      const first = q.sort[0]
      if (first.field.kind === 'property') sortField.value = first.field.key
      else if (first.field.kind === 'dateRef') sortField.value = 'dateRef.' + first.field.ref
      else sortField.value = 'content'
      sortDir.value = first.dir
    }
    showSavedFilters.value = false
  } catch {
    // ignore corrupt JSON
  }
}

async function loadSavedFilters() {
  await savedFilterStore.load()
  showSavedFilters.value = true
}

const opLabels: Record<string, string> = {
  'is': '是',
  'isNot': '不是',
  'contains': '包含',
  'before': '早于',
  'after': '晚于',
  'hasAny': '有值',
  'isEmpty': '为空',
}

const sortFieldOptions = [
  { label: '无排序', value: '' },
  ...fieldOptions,
  { label: '更新时间', value: 'updated_at' },
]
</script>

<template>
  <div class="filter-bar">
    <div class="filter-bar-header">
      <span class="filter-bar-title">筛选条件</span>
      <div class="filter-bar-actions">
        <button class="text-btn" @click="loadSavedFilters">
          <Bookmark :size="14" /> 已保存
        </button>
        <button class="text-btn" @click="showSaveDialog = true">
          <Save :size="14" /> 另存为
        </button>
        <button class="bar-btn primary" @click="apply">应用</button>
        <button class="bar-btn" @click="emit('close')"><X :size="16" /></button>
      </div>
    </div>

    <div class="filter-conditions">
      <div v-for="(filter, idx) in filters" :key="idx" class="filter-row">
        <!-- Field selector -->
        <select
          class="filter-select"
          :value="getFieldDisplay(filter)"
          @change="updateField(idx, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="opt in fieldOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>

        <!-- Op selector -->
        <select
          class="filter-select filter-op"
          v-model="filter.op"
        >
          <option v-for="o in availableOps(filter)" :key="o" :value="o">{{ opLabels[o] ?? o }}</option>
        </select>

        <!-- Value input (hidden for hasAny/isEmpty) -->
        <input
          v-if="!['hasAny', 'isEmpty'].includes(filter.op)"
          class="filter-value"
          v-model="filter.value"
          :type="filter.field.kind === 'dateRef' && filter.field.ref === 'date' ? 'date' : 'text'"
          :placeholder="filter.field.kind === 'dateRef' ? 'YYYY-MM-DD' : '值...'"
        />

        <button class="btn-icon-sm remove-btn" @click="removeFilter(idx)" title="删除条件">
          <X :size="14" />
        </button>
      </div>
    </div>

    <div class="filter-add-row">
      <button class="text-btn" @click="addFilter">
        <Plus :size="14" /> 添加条件
      </button>

      <div class="sort-section">
        <span class="sort-label">排序</span>
        <select class="filter-select" v-model="sortField">
          <option v-for="opt in sortFieldOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <button
          class="btn-icon-sm"
          :class="{ active: sortDir === 'asc' }"
          @click="sortDir = sortDir === 'asc' ? 'desc' : 'asc'"
          title="切换排序方向"
        >
          {{ sortDir === 'asc' ? '↑' : '↓' }}
        </button>
      </div>
    </div>

    <!-- Save dialog -->
    <div v-if="showSaveDialog" class="save-dialog-overlay" @click.self="showSaveDialog = false">
      <div class="save-dialog">
        <h4>保存筛选规则</h4>
        <input v-model="saveName" placeholder="规则名称..." class="save-input" @keyup.enter="saveAsFilter" />
        <div class="save-dialog-actions">
          <button class="bar-btn" @click="showSaveDialog = false">取消</button>
          <button class="bar-btn primary" @click="saveAsFilter" :disabled="!saveName.trim()">保存</button>
        </div>
      </div>
    </div>

    <!-- Saved filters dropdown -->
    <div v-if="showSavedFilters" class="saved-filters-overlay" @click.self="showSavedFilters = false">
      <div class="saved-filters-list">
        <h4>已保存的筛选规则</h4>
        <div v-if="savedFilterStore.filters.length === 0" class="empty-hint">暂无保存的规则</div>
        <div
          v-for="f in savedFilterStore.filters"
          :key="f.id"
          class="saved-filter-item"
          @click="loadSavedFilter(f.query_json)"
        >
          <span>{{ f.name }}</span>
          <button
            class="btn-icon-sm"
            @click.stop="savedFilterStore.remove(f.id)"
            title="删除"
          >
            <X :size="12" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.filter-bar {
  width: 100%;
  border-top: 1px solid var(--border-color, var(--app-split));
  background: var(--bg-base2);
  padding: 12px 16px;
}

.filter-bar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.filter-bar-title {
  font-size: var(--text-sm);
  font-weight: var(--font-semibold);
  color: var(--text-secondary);
}

.filter-bar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filter-conditions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.filter-select {
  padding: 4px 8px;
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--text-sm);
  outline: none;

  &:focus {
    border-color: var(--accent);
  }
}

.filter-op {
  min-width: 80px;
}

.filter-value {
  padding: 4px 8px;
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: 4px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--text-sm);
  outline: none;
  flex: 1;
  min-width: 0;

  &:focus {
    border-color: var(--accent);
  }
}

.filter-add-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.sort-section {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sort-label {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}

.text-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--text-xs);
  transition: all 100ms ease;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
}

.bar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--text-sm);
  transition: all 100ms ease;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  &.primary {
    background: var(--accent);
    color: white;
    &:hover {
      background: var(--accent);
      opacity: 0.9;
    }
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.btn-icon-sm {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  &.active {
    color: var(--accent);
    background: var(--accent-bg, rgba(99, 102, 241, 0.08));
  }
}

.remove-btn:hover {
  color: var(--error, #DC2626);
}

.save-dialog-overlay,
.saved-filters-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.save-dialog,
.saved-filters-list {
  background: var(--bg-primary);
  border-radius: 10px;
  padding: 20px;
  min-width: 280px;
  max-width: 360px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.16);

  h4 {
    margin: 0 0 12px;
    font-size: var(--text-base);
    font-weight: var(--font-semibold);
    color: var(--text-primary);
  }
}

.save-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: 6px;
  font-size: var(--text-sm);
  outline: none;
  background: var(--bg-primary);
  color: var(--text-primary);

  &:focus {
    border-color: var(--accent);
  }
}

.save-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 12px;
}

.saved-filter-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: var(--text-sm);
  color: var(--text-secondary);

  &:hover {
    background: var(--bg-hover);
  }
}

.empty-hint {
  font-size: var(--text-sm);
  color: var(--text-tertiary);
  padding: 12px 0;
  text-align: center;
}
</style>
