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
import { ref, watch, type Component } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
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

/**
 * 行的稳定 key：rule 对象引用级 WeakMap 映射。
 * 拖拽重排只改数组顺序不改对象引用，key 稳定；update 生成新对象自然获得新 key。
 */
let uidSeq = 0
const uidOf = new WeakMap<object, number>()
function keyFor(rule: SortRule): number {
  let k = uidOf.get(rule)
  if (k === undefined) {
    k = ++uidSeq
    uidOf.set(rule, k)
  }
  return k
}

/** 拖拽结束：VueDraggable 已就地重排 local，对外 emit 新数组（父组件持久化后经 props 回流）。 */
function onDragEnd() {
  emit('update:sort', [...local.value])
}

function fieldOf(key: string): FieldDescriptor | undefined {
  return props.fields.find((f) => f.key === key)
}

const FIELD_META: Record<FieldType, { icon: Component; dirs: { asc: string; desc: string } }> = {
  text: { icon: Type, dirs: { asc: 'A → Z', desc: 'Z → A' } },
  number: { icon: Hash, dirs: { asc: '1 → 9', desc: '9 → 1' } },
  date: { icon: CalendarDays, dirs: { asc: '旧 → 新', desc: '新 → 旧' } },
  datetime: { icon: CalendarDays, dirs: { asc: '旧 → 新', desc: '新 → 旧' } },
  select: { icon: List, dirs: { asc: 'A → Z', desc: 'Z → A' } },
  multiSelect: { icon: List, dirs: { asc: 'A → Z', desc: 'Z → A' } },
  boolean: { icon: CheckSquare, dirs: { asc: '假 → 真', desc: '真 → 假' } },
}

function fieldIcon(type: FieldType) {
  return FIELD_META[type].icon
}

function dirMeta(rule: SortRule): { asc: string; desc: string } {
  const field = fieldOf(rule.field)
  // 显式排序顺序（sortOrder）的字段：方向选项直接展示排序内容链（如 进行中 > 待办 > 已完成 > 已取消）
  if (field?.sortOrder?.length) {
    const opts = typeof field.options === 'function' ? field.options() : field.options ?? []
    const labels = field.sortOrder.map((id) => opts.find((o) => o.id === id)?.label ?? id)
    return { asc: labels.join(' > '), desc: [...labels].reverse().join(' > ') }
  }
  const type = field?.type ?? 'text'
  return FIELD_META[type].dirs
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
    <VueDraggable
      v-model="local"
      class="sort-list"
      handle=".drag-handle"
      :force-fallback="true"
      ghost-class="sort-ghost"
      @end="onDragEnd"
    >
      <div v-for="(rule, idx) in local" :key="keyFor(rule)" class="sort-row" data-testid="sort-row">
        <span class="drag-handle" aria-hidden="true" title="拖拽排序">
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
    </VueDraggable>

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
  /* 面板内无需文本选择，也顺带杜绝拖拽把手的原生选区 */
  user-select: none;
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

.drag-handle:active {
  cursor: grabbing;
}

/* 拖拽中的占位行（VueDraggable ghost-class） */
.sort-ghost {
  opacity: 0.4;
  background: var(--accent-bg);
  border-radius: var(--radius-sm);
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
  /* 容纳 sortOrder 内容链（如 进行中 > 待办 > 已完成 > 已取消），超出部分由原生 select 裁切 */
  min-width: 160px;
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
