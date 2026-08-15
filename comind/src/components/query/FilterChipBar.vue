<script setup lang="ts">
import { ref, computed } from 'vue'
import type {
  Condition,
  ConditionGroup,
  FieldDescriptor,
  SortRule,
  ViewQuery,
} from '../../core/query'
import FilterCombinatorToggle from './FilterCombinatorToggle.vue'
import FilterChip from './FilterChip.vue'
import ConditionPopover from './ConditionPopover.vue'
import FieldSelectMenu from './FieldSelectMenu.vue'
import SortChip from './SortChip.vue'
import SortMenu from './SortMenu.vue'
import GroupChip from './GroupChip.vue'
import GroupMenu from './GroupMenu.vue'
import { defaultOpFor, summarizeCondition } from './filterMeta'

const props = defineProps<{
  /** 当前视图查询（投影源：筛选/排序/分组均派生自此）。 */
  modelValue: ViewQuery
  /** 可筛选/排序/分组的字段清单。 */
  fields: FieldDescriptor[]
}>()

const emit = defineEmits<{
  /** 任意筛选/排序/分组变更，emit 完整的新 ViewQuery（父级持有真相）。 */
  'update:modelValue': [q: ViewQuery]
  /** 点「高级筛选」/ 聚合 chip → 由父级决定如何打开 FilterBuilder。 */
  'open-advanced': []
}>()

function isCondition(c: Condition | ConditionGroup): c is Condition {
  return !('combinator' in c)
}

function countConditions(g: ConditionGroup): number {
  let n = 0
  for (const c of g.children) {
    if (isCondition(c)) n++
    else n += countConditions(c)
  }
  return n
}

const anchor = ref<{ x: number; y: number }>({ x: 0, y: 0 })
type Active =
  | { kind: 'fieldMenu' }
  | { kind: 'cond'; index: number }
  | { kind: 'sortEdit'; index: number }
  | { kind: 'group' }
  | null
const active = ref<Active>(null)

function openAt(kind: Exclude<Active, null>, e: Event) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  anchor.value = { x: r.left, y: r.bottom + 4 }
  active.value = kind
}
function close() {
  active.value = null
}

function patch(p: Partial<ViewQuery>) {
  emit('update:modelValue', { ...props.modelValue, ...p })
}

// ── 筛选 ──
const flatConds = computed(() => props.modelValue.filter.children.filter(isCondition))
const hasNested = computed(() => props.modelValue.filter.children.some((c) => !isCondition(c)))
const condCount = computed(() => countConditions(props.modelValue.filter))
const combinator = computed(() => props.modelValue.filter.combinator)

function fieldOf(key: string): FieldDescriptor | undefined {
  return props.fields.find((f) => f.key === key)
}
function setCombinator(v: 'and' | 'or') {
  patch({ filter: { ...props.modelValue.filter, combinator: v } })
}
function onCondUpdate(index: number, cond: Condition) {
  const children = [...props.modelValue.filter.children]
  children[index] = cond
  patch({ filter: { ...props.modelValue.filter, children } })
}
function onCondRemove(index: number) {
  const children = [...props.modelValue.filter.children]
  children.splice(index, 1)
  patch({ filter: { ...props.modelValue.filter, children } })
}
function addFilter(key: string) {
  const f = fieldOf(key)
  if (!f) return
  const cond: Condition = { field: key, op: defaultOpFor(f) }
  const children = [...props.modelValue.filter.children, cond]
  patch({ filter: { ...props.modelValue.filter, children } })
  // 复用 fieldMenu 的锚点，直接切到新条件的编辑器
  active.value = { kind: 'cond', index: children.length - 1 }
}

// ── 排序 ──
const sorts = computed(() => props.modelValue.sort)
function sortLabel(key: string): string {
  return fieldOf(key)?.label ?? key
}
/** 条件摘要；字段缺失（如指向已删除/未加载字段的脏数据）时降级为原始 key。 */
function condLabel(c: Condition): string {
  const f = fieldOf(c.field)
  return f ? summarizeCondition(f, c) : c.field
}
function onSortUpdate(index: number, rule: SortRule) {
  const sort = [...props.modelValue.sort]
  sort[index] = rule
  patch({ sort })
}
function onSortRemove(index: number) {
  const sort = [...props.modelValue.sort]
  sort.splice(index, 1)
  patch({ sort })
}
function addSort() {
  const f = props.fields[0]
  if (!f) return
  const ni = props.modelValue.sort.length
  patch({ sort: [...props.modelValue.sort, { field: f.key, dir: 'asc' }] })
  active.value = { kind: 'sortEdit', index: ni }
}
function onSortAdd() {
  const f = props.fields[0]
  if (!f || active.value?.kind !== 'sortEdit') return
  const idx = active.value.index
  const sort = [...props.modelValue.sort]
  sort.splice(idx + 1, 0, { field: f.key, dir: 'asc' })
  patch({ sort })
  active.value = { kind: 'sortEdit', index: idx + 1 }
}

// ── 分组 ──
const groupBy = computed(() => props.modelValue.groupBy)
function onGroupUpdate(key: string | null) {
  patch({ groupBy: key })
}

// ── 当前激活目标（供模板类型安全访问）──
const condIndex = computed(() => (active.value?.kind === 'cond' ? active.value.index : -1))
const condTarget = computed<Condition | null>(() => {
  if (condIndex.value < 0) return null
  const c = props.modelValue.filter.children[condIndex.value]
  return c && isCondition(c) ? c : null
})
const condTargetField = computed<FieldDescriptor | undefined>(() =>
  condTarget.value ? fieldOf(condTarget.value.field) : undefined,
)
const sortIndex = computed(() => (active.value?.kind === 'sortEdit' ? active.value.index : -1))
const sortTarget = computed<SortRule | null>(() =>
  sortIndex.value >= 0 ? (props.modelValue.sort[sortIndex.value] ?? null) : null,
)

function onAdvancedFromMenu() {
  close()
  emit('open-advanced')
}

// ── 供 Header 按钮直接唤起菜单（锚定到按钮自身）──
function anchorTo(el?: HTMLElement | null) {
  if (!el) return
  const r = el.getBoundingClientRect()
  anchor.value = { x: r.left, y: r.bottom + 4 }
}
function openSortMenu(el?: HTMLElement | null) {
  anchorTo(el)
  if (props.modelValue.sort.length === 0) {
    const f = props.fields[0]
    if (!f) return
    patch({ sort: [{ field: f.key, dir: 'asc' }] })
    active.value = { kind: 'sortEdit', index: 0 }
  } else {
    active.value = { kind: 'sortEdit', index: props.modelValue.sort.length - 1 }
  }
}
function openGroupMenu(el?: HTMLElement | null) {
  anchorTo(el)
  active.value = { kind: 'group' }
}

defineExpose({ openSortMenu, openGroupMenu })
</script>

<template>
  <div class="chip-bar" data-testid="chip-bar">
    <FilterCombinatorToggle :model-value="combinator" @update:model-value="setCombinator" />

    <template v-if="!hasNested">
      <FilterChip
        v-for="(c, i) in flatConds"
        :key="'c' + i"
        :label="condLabel(c)"
        data-testid="bar-filter-chip"
        @click="openAt({ kind: 'cond', index: i }, $event)"
        @remove="onCondRemove(i)"
      />
    </template>
    <button v-else class="agg-chip" data-testid="bar-agg" @click="emit('open-advanced')">
      {{ condCount }} rules
    </button>

    <button class="add-btn" data-testid="bar-add-filter" @click="openAt({ kind: 'fieldMenu' }, $event)">
      + Filter
    </button>

    <SortChip
      v-for="(s, i) in sorts"
      :key="'s' + i"
      :rule="s"
      :label="sortLabel(s.field)"
      data-testid="bar-sort-chip"
      @open="openAt({ kind: 'sortEdit', index: i }, $event)"
      @remove="onSortRemove(i)"
    />
    <button class="add-btn" data-testid="bar-add-sort" @click="addSort()">+ Sort</button>

    <GroupChip
      v-if="groupBy"
      :label="sortLabel(groupBy)"
      data-testid="bar-group-chip"
      @open="openAt({ kind: 'group' }, $event)"
      @remove="onGroupUpdate(null)"
    />
    <button v-else class="add-btn" data-testid="bar-add-group" @click="openAt({ kind: 'group' }, $event)">
      + Group
    </button>

    <button class="adv-btn" data-testid="bar-advanced" @click="emit('open-advanced')">高级筛选</button>

    <FieldSelectMenu
      v-if="active?.kind === 'fieldMenu'"
      :fields="fields"
      :position="anchor"
      @select="addFilter"
      @advanced="onAdvancedFromMenu"
      @close="close"
    />
    <ConditionPopover
      v-if="condTarget && condTargetField"
      :field="condTargetField"
      :condition="condTarget"
      :fields="fields"
      :position="anchor"
      @update:condition="onCondUpdate(condIndex, $event)"
      @remove="onCondRemove(condIndex)"
      @close="close"
    />
    <SortMenu
      v-if="sortTarget"
      :rule="sortTarget"
      :fields="fields"
      :position="anchor"
      @update:rule="onSortUpdate(sortIndex, $event)"
      @add="onSortAdd"
      @remove="onSortRemove(sortIndex)"
      @close="close"
    />
    <GroupMenu
      v-if="active?.kind === 'group'"
      :group-by="groupBy"
      :fields="fields"
      :position="anchor"
      @update:group-by="onGroupUpdate"
      @close="close"
    />
  </div>
</template>

<style scoped>
.chip-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-base2);
}
.add-btn,
.adv-btn {
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 3px 8px;
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
}
.add-btn:hover,
.adv-btn:hover {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
}
.adv-btn {
  margin-left: auto;
  border-style: solid;
}
.agg-chip {
  border: 1px solid var(--border);
  background: var(--bg-base);
  color: var(--text-secondary);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
}
.agg-chip:hover {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
}
</style>
