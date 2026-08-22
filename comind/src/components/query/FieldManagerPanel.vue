<script setup lang="ts">
import {
  Calendar,
  CircleDot,
  Eye,
  EyeOff,
  GripVertical,
  Hash,
  List,
  Plus,
  Search,
  SquareCheck,
  Trash2,
  Type,
} from 'lucide-vue-next'
import { VueDraggable } from 'vue-draggable-plus'
import { computed, ref, watch } from 'vue'
import type { FieldDescriptor } from '../../core/query'
import type { TableColumnConfig } from '../../core/view'

/**
 * 字段管理面板（ADR-0011）—— 通用、零业务耦合，仅 emit 意图由消费方持久化。
 *
 * 两层作用域（M1，复用各 Tab 的 TableConfig.columns）：
 *  - 第一组「已用字段」：当前 tab 的 columns（含 visible 标记与顺序）。
 *      · 拖拽（VueDraggable / force-fallback）= per-tab 排序（emit reorder）
 *      · 👁 = per-tab 显示/隐藏（emit toggle-visibility；字段仍留第一组）
 *      · 编辑开关开时追加 🗑 = 全局移除（emit remove-global，字段移入第二组）
 *  - 第二组「候选字段」：props.fields 中不在 columns 的字段；编辑开关开时可见。
 *      · + = 全局新增（emit add-global）
 *  - 顶部搜索框同时过滤两组（按字段 label）；搜索态下禁用拖拽（v-show 隐藏非命中项）。
 *
 * 拖拽数据源为本地 `localActive`：VueDraggable 直接重排它，持久化真相仍在
 * props.columns（消费方经 store 回流后同步回本地，避免 props 被组件内改写）。
 */
const props = defineProps<{
  /** 实体全量字段池（有序，来自消费方注入）。 */
  fields: FieldDescriptor[]
  /** 当前 tab 的表格列配置（有序，含 visible 标记）。 */
  columns: TableColumnConfig[]
}>()

const emit = defineEmits<{
  /** per-tab 显示/隐藏（newVisible 为切换后的目标态）。 */
  'toggle-visibility': [key: string, newVisible: boolean]
  /** per-tab 排序：Group1 的新字段 key 顺序。 */
  reorder: [keys: string[]]
  /** 全局新增：把某字段加入所有 tab 的 columns。 */
  'add-global': [key: string]
  /** 全局移除：从所有 tab 的 columns 删除某字段。 */
  'remove-global': [key: string]
}>()

/** 编辑开关默认关：默认仅暴露安全的 per-tab 操作，全局增删显式开启（ADR-0011）。 */
const editMode = ref(false)
const search = ref('')
const q = computed(() => search.value.trim().toLowerCase())

const activeKeys = computed(() => new Set(props.columns.map((c) => c.key)))
const activeList = computed(() =>
  props.columns.map((c) => ({ column: c, field: props.fields.find((f) => f.key === c.key) })),
)
// 候选 = 全量字段池减去已用（保持 props.fields 注册顺序，ADR-0011 Round-4）
const candidateList = computed(() => props.fields.filter((f) => !activeKeys.value.has(f.key)))
const filteredCandidates = computed(() =>
  candidateList.value.filter((f) => !q.value || f.label.toLowerCase().includes(q.value)),
)

/** 第一组本地拖拽数组：VueDraggable 直接改它；props.columns 才是持久化真相（父经 store 回流）。 */
const localActive = ref(activeList.value)
// 父持久化后 props.columns 变化（排序/显隐/增删）→ 同步回本地，保持单一显示权威
watch(
  () => [props.columns, props.fields] as const,
  () => {
    localActive.value = activeList.value
  },
)

function iconFor(type?: string) {
  switch (type) {
    case 'number':
      return Hash
    case 'date':
      return Calendar
    case 'select':
      return List
    case 'multiSelect':
      return CircleDot
    case 'boolean':
      return SquareCheck
    default:
      return Type
  }
}

function matchesSearch(item: { column: TableColumnConfig; field?: FieldDescriptor }): boolean {
  if (!q.value) return true
  return (item.field?.label ?? item.column.key).toLowerCase().includes(q.value)
}

function toggleVisibility(key: string, newVisible: boolean) {
  emit('toggle-visibility', key, newVisible)
}

/** 拖拽结束：localActive 已被 VueDraggable 重排，emit 新 key 顺序（per-tab）。 */
function onDragEnd() {
  emit('reorder', localActive.value.map((i) => i.column.key))
}

// 测试接缝：直接设定本地拖拽数组顺序后触发 onDragEnd，等价于 VueDraggable 真实拖拽结束。
function __test_setOrder(keys: string[]) {
  const map = new Map(localActive.value.map((i) => [i.column.key, i]))
  localActive.value = keys
    .map((k) => map.get(k))
    .filter((i): i is (typeof localActive.value)[number] => !!i)
}
defineExpose({ onDragEnd, __test_setOrder })
</script>

<template>
  <div class="field-manager">
    <div class="fm-header">
      <span class="fm-title">字段</span>
      <label class="fm-edit-toggle" :class="{ on: editMode }">
        <input type="checkbox" v-model="editMode" data-testid="fm-edit" />
        <span>编辑</span>
      </label>
    </div>

    <div class="fm-search">
      <Search :size="14" class="fm-search-icon" />
      <input v-model="search" type="text" placeholder="搜索字段..." data-testid="fm-search" class="fm-search-input" />
    </div>

    <!-- 第一组：已用字段（per-tab 拖拽排序 + 显示/隐藏；编辑开时含全局删除） -->
    <div class="fm-group">
      <div class="fm-group-title">已用字段</div>
      <VueDraggable
        v-model="localActive"
        class="fm-list"
        handle=".fm-grip"
        :force-fallback="true"
        :disabled="!!q"
        ghost-class="fm-ghost"
        @end="onDragEnd"
      >
        <li
          v-for="item in localActive"
          :key="item.column.key"
          v-show="matchesSearch(item)"
          class="fm-row"
          :class="{ hidden: item.column.visible === false }"
          data-testid="fm-active-row"
        >
          <span class="fm-grip" title="拖拽排序"><GripVertical :size="14" /></span>
          <component :is="iconFor(item.field?.type)" :size="14" class="fm-icon" />
          <span class="fm-label">{{ item.field?.label ?? item.column.key }}</span>
          <button
            class="fm-eye"
            data-testid="fm-eye"
            :title="item.column.visible === false ? '显示' : '隐藏'"
            @click="toggleVisibility(item.column.key, item.column.visible === false)"
          >
            <component :is="item.column.visible === false ? EyeOff : Eye" :size="15" />
          </button>
          <button
            v-if="editMode"
            class="fm-del"
            data-testid="fm-del"
            title="从所有视图移除该字段"
            @click="emit('remove-global', item.column.key)"
          >
            <Trash2 :size="14" />
          </button>
        </li>
      </VueDraggable>
    </div>

    <!-- 第二组：候选字段（编辑开时显示；+ = 全局新增） -->
    <div v-if="editMode" class="fm-group">
      <div class="fm-group-title">候选字段</div>
      <ul class="fm-list">
        <li v-for="field in filteredCandidates" :key="field.key" class="fm-row candidate" data-testid="fm-candidate-row">
          <component :is="iconFor(field.type)" :size="14" class="fm-icon" />
          <span class="fm-label">{{ field.label }}</span>
          <button class="fm-add" data-testid="fm-add" title="添加到所有视图" @click="emit('add-global', field.key)">
            <Plus :size="14" />
          </button>
        </li>
        <li v-if="filteredCandidates.length === 0" class="fm-empty">无候选字段</li>
      </ul>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.field-manager {
  width: 260px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--text-sm);
  color: var(--text-primary);
  /* 拖拽/点击时字段名、图标、按钮均不被选中（搜索框单独恢复） */
  user-select: none;
}

.fm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.fm-title {
  font-weight: var(--font-semibold);
}

.fm-edit-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: var(--text-secondary);
  user-select: none;

  input {
    accent-color: var(--accent, #6366f1);
  }

  &.on {
    color: var(--accent, #6366f1);
  }
}

.fm-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-base2, var(--bg-base));
}

.fm-search-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.fm-search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: var(--text-sm);
  color: var(--text-primary);
  font-family: inherit;
  user-select: text;

  &::placeholder {
    color: var(--text-tertiary);
  }
}

.fm-group-title {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 2px 0 4px;
}

.fm-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 240px;
  overflow: auto;
}

.fm-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-base2, var(--bg-base));

  &:hover {
    background: var(--bg-hover);
  }

  &.hidden {
    opacity: 0.5;
  }

  &.candidate {
    background: transparent;
  }
}

.fm-grip {
  color: var(--text-tertiary);
  cursor: grab;
  flex-shrink: 0;

  &:active {
    cursor: grabbing;
  }
}

.fm-icon {
  color: var(--text-tertiary);
  flex-shrink: 0;
}

.fm-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fm-eye,
.fm-del,
.fm-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--text-tertiary);
  flex-shrink: 0;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
}

.fm-del:hover {
  color: var(--error, #dc2626);
}

.fm-add:hover {
  color: var(--accent, #6366f1);
}

.fm-empty {
  padding: 6px;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.fm-ghost {
  opacity: 0.4;
  background: var(--bg-hover);
}
</style>
