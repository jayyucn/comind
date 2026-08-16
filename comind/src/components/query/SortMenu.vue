<script setup lang="ts">
import {
  CalendarDays,
  CheckSquare,
  GripVertical,
  Hash,
  List,
  Trash2,
  Type,
  X,
} from 'lucide-vue-next';
import { ref, watch } from 'vue';
import type { FieldDescriptor, FieldType, SortRule } from '../../core/query';

const props = defineProps<{
  /** 当前全部排序规则。 */
  sort: SortRule[]
  /** 可排序字段清单。 */
  fields: FieldDescriptor[]
}>()

const emit = defineEmits<{
  /** 排序规则数组整体变更。 */
  'update:sort': [sort: SortRule[]]
  /** 请求关闭编辑器。 */
  close: []
}>()

const local = ref<SortRule[]>([...props.sort])
watch(
  () => props.sort,
  (s) => {
    local.value = [...s]
  },
  { deep: true },
)

function fieldOf(key: string): FieldDescriptor | undefined {
  return props.fields.find((f) => f.key === key)
}

function fieldIcon(type: FieldType) {
  switch (type) {
    case 'text':
      return Type
    case 'number':
      return Hash
    case 'date':
      return CalendarDays
    case 'select':
    case 'multiSelect':
      return List
    case 'boolean':
      return CheckSquare
    default:
      return Type
  }
}

function dirMeta(rule: SortRule): { asc: string; desc: string } {
  const type = fieldOf(rule.field)?.type ?? 'text'
  switch (type) {
    case 'number':
      return { asc: '1 → 9', desc: '9 → 1' }
    case 'date':
      return { asc: '旧 → 新', desc: '新 → 旧' }
    case 'boolean':
      return { asc: '假 → 真', desc: '真 → 假' }
    case 'select':
    case 'multiSelect':
      return { asc: 'A → Z', desc: 'Z → A' }
    case 'text':
    default:
      return { asc: 'A → Z', desc: 'Z → A' }
  }
}

function update(index: number, patch: Partial<SortRule>) {
  const next = [...local.value]
  next[index] = { ...next[index], ...patch }
  local.value = next
  emit('update:sort', next)
}

function remove(index: number) {
  const next = [...local.value]
  next.splice(index, 1)
  local.value = next
  emit('update:sort', next)
  if (next.length === 0) emit('close')
}

function addSort() {
  const f = props.fields[0]
  if (!f) return
  const next = [...local.value, { field: f.key, dir: 'asc' as const }]
  local.value = next
  emit('update:sort', next)
}

function deleteAll() {
  local.value = []
  emit('update:sort', [])
  emit('close')
}
</script>

<template>
  <div class="sort-editor" data-testid="sort-editor">
    <div v-for="(rule, idx) in local" :key="idx" class="sort-row" data-testid="sort-row">
      <span class="drag-handle" aria-hidden="true">
        <GripVertical :size="14" />
      </span>

      <div class="select-wrap field-select-wrap">
        <component :is="fieldIcon(fieldOf(rule.field)?.type ?? 'text')" :size="14" class="select-icon" />
        <select
          class="sort-select sort-field"
          data-testid="sort-field"
          :value="rule.field"
          @change="update(idx, { field: ($event.target as HTMLSelectElement).value })"
        >
          <option v-for="f in fields" :key="f.key" :value="f.key">{{ f.label }}</option>
        </select>
        <span class="select-caret">▾</span>
      </div>

      <div class="select-wrap dir-select-wrap">
        <select
          class="sort-select sort-dir"
          data-testid="sort-dir"
          :value="rule.dir"
          @change="update(idx, { dir: ($event.target as HTMLSelectElement).value as 'asc' | 'desc' })"
        >
          <option value="asc"> {{ dirMeta(rule).asc }}</option>
          <option value="desc"> {{ dirMeta(rule).desc }}</option>
        </select>
        <span class="select-caret">▾</span>
      </div>

      <button
        type="button"
        class="row-remove"
        data-testid="sort-row-remove"
        aria-label="移除排序"
        @click="remove(idx)"
      >
        <X :size="14" />
      </button>
    </div>

    <div class="sort-foot">
      <button type="button" class="sort-add" data-testid="sort-add" @click="addSort">
        + Add sort
      </button>
      <button v-if="local.length" type="button" class="sort-del-all" data-testid="sort-del-all" @click="deleteAll">
        <Trash2 :size="14" />
        Delete sort
      </button>
    </div>
  </div>
</template>

<style scoped>
.sort-editor {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  box-sizing: border-box;
  min-width: 360px;
}

.sort-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border-radius: var(--radius-sm);
}

.sort-row:hover {
  background: var(--bg-hover);
}

.drag-handle {
  display: inline-flex;
  align-items: center;
  color: var(--text-tertiary);
  cursor: grab;
  padding: 2px;
}

.select-wrap {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
}

.select-icon {
  position: absolute;
  left: 8px;
  color: var(--text-tertiary);
  pointer-events: none;
  flex-shrink: 0;
}

.select-caret {
  position: absolute;
  right: 8px;
  font-size: 10px;
  color: var(--text-tertiary);
  pointer-events: none;
}

.sort-select {
  appearance: none;
  -webkit-appearance: none;
  background: var(--bg-base);
  color: var(--text-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 5px 22px 5px 8px;
  font-size: var(--text-sm);
  font-family: inherit;
  outline: none;
  cursor: pointer;
  min-width: 0;
}

.sort-select:focus {
  border-color: var(--accent);
}

.sort-field {
  padding-left: 30px;
  min-width: 110px;
}

.sort-dir {
  min-width: 80px;
}

.row-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  margin-left: auto;
  flex-shrink: 0;
}

.row-remove:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.sort-foot {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0 0;
}

.sort-add,
.sort-del-all {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
}

.sort-add {
  color: var(--text-secondary);
}

.sort-add:hover {
  color: var(--accent);
  background: var(--bg-hover);
}

.sort-del-all {
  color: var(--text-secondary);
}

.sort-del-all:hover {
  color: var(--error);
  background: var(--bg-hover);
}
</style>
