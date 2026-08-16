<script setup lang="ts">
import { ArrowUpDown, Layers } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import type {
  Condition,
  ConditionGroup,
  FieldDescriptor,
  ReferenceableRecord,
  Registry,
  SortRule,
  ViewQuery,
} from '../../core/query'
import BasePopover from '../common/BasePopover.vue'
import ConditionPopover from './ConditionPopover.vue'
import FieldSelectMenu from './FieldSelectMenu.vue'
import FilterBuilder from './FilterBuilder.vue'
import FilterChip from './FilterChip.vue'
import { defaultOpFor, summarizeCondition } from './filterMeta'
import GroupMenu from './GroupMenu.vue'
import SortMenu from './SortMenu.vue'

const props = defineProps<{
  /** 当前视图查询（投影源：筛选/排序/分组均派生自此）。 */
  modelValue: ViewQuery
  /** 可筛选/排序/分组的字段清单。 */
  fields: FieldDescriptor[]
  /** 字段注册表（高级筛选 popover 内 ConditionGroup/ConditionRow 需要）。 */
  registry: Registry
  /** 实体命名空间。 */
  entityType: string
  /** 跨记录引用候选记录列表（通用，业务无关），从业务层注入。 */
  crossRecordSources?: ReferenceableRecord[]
}>()

const emit = defineEmits<{
  /** 任意筛选/排序/分组变更，emit 完整的新 ViewQuery（父级持有真相）。 */
  'update:modelValue': [q: ViewQuery]
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
  | { kind: 'advanced' }
  | null
const active = ref<Active>(null)

const addFilterBtn = ref<HTMLButtonElement | null>(null)

function openAt(kind: Exclude<Active, null>, e: Event) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  anchor.value = { x: r.left, y: r.bottom + 4 }
  active.value = kind
}
function anchorTo(el?: HTMLElement | null) {
  if (!el) return
  const r = el.getBoundingClientRect()
  anchor.value = { x: r.left, y: r.bottom + 4 }
}
function close() {
  active.value = null
}

function patch(p: Partial<ViewQuery>) {
  emit('update:modelValue', { ...props.modelValue, ...p })
}

// ── 筛选 ──
/** 扁平条件（与嵌套组并列的兄弟节点）。 */
const flatConds = computed(() => props.modelValue.filter.children.filter(isCondition))
/**
 * 扁平条件 + 其在 `children` 中的真实索引。
 * 关键：模板里必须用真实索引（而非 flatConds 的过滤后序号）去取/删，
 * 否则嵌套组排在前时，扁平 chip 的 index 会错位（错删聚合 chip / 弹不出菜单）。
 */
const flatItems = computed(() => {
  const items: { cond: Condition; idx: number }[] = []
  props.modelValue.filter.children.forEach((c, idx) => {
    if (isCondition(c)) items.push({ cond: c, idx })
  })
  return items
})
const hasNested = computed(() => props.modelValue.filter.children.some((c) => !isCondition(c)))
/** 筛选区是否确有 chip（高级聚合或扁平条件）—用于决定 group→filters 分割线是否出现。 */
const hasFilterChips = computed(() => hasNested.value || flatConds.value.length > 0)
/** sort 之后有 group 或 filters 才画分割线（sort | group / sort | filters）。 */
const divAfterSort = computed(
  () => props.modelValue.sort.length > 0 && (!!props.modelValue.groupBy || hasFilterChips.value),
)
/** group 之后有 filters 才画分割线（group | filters）。 */
const divAfterGroup = computed(() => !!props.modelValue.groupBy && hasFilterChips.value)
/** 仅嵌套/高级子组内的条件总数（用于聚合 chip 标签）。 */
const nestedCount = computed(() =>
  props.modelValue.filter.children
    .filter((c) => !isCondition(c))
    .reduce((sum, g) => sum + countConditions(g as ConditionGroup), 0),
)
const nestedLabel = computed(() => `${nestedCount.value} rule${nestedCount.value > 1 ? 's' : ''}`)

// 高级/嵌套子组 = 聚合 chip 的编辑范围（仅嵌套组，扁平条件不入面板）
const advancedGroup = computed<ConditionGroup>(() => {
  const nested = props.modelValue.filter.children.filter((c) => !isCondition(c)) as ConditionGroup[]
  if (nested.length === 1) return nested[0]
  if (nested.length === 0) return { combinator: 'and', children: [] }
  return { combinator: props.modelValue.filter.combinator, children: nested }
})
const advancedModel = computed<ViewQuery>(() => ({
  version: 1,
  filter: advancedGroup.value,
  sort: [],
  groupBy: null,
}))

function fieldOf(key: string): FieldDescriptor | undefined {
  return props.fields.find((f) => f.key === key)
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

/** 将指定位置的扁平条件提升为嵌套组（高级筛选）。index 为 children 真实索引。 */
function onCondAdvanced(index: number) {
  const cond = props.modelValue.filter.children[index]
  if (!cond || !isCondition(cond)) return
  const nested: ConditionGroup = {
    combinator: 'and',
    children: [cond],
  }
  const children = [...props.modelValue.filter.children]
  // 从真实索引原位移除扁平条件，再追加嵌套组
  children.splice(index, 1)
  children.push(nested)
  patch({ filter: { ...props.modelValue.filter, children } })
  // 关闭当前 popover（条件已不在扁平列表中）
  active.value = null
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

// 打开高级筛选 popover：由聚合 chip 或 + Filter 菜单触发（ADR-0013 D5）
function openAdvanced(e: Event) {
  openAt({ kind: 'advanced' }, e)
}
function openAdvancedFromMenu() {
  close()
  active.value = { kind: 'advanced' }
  anchorTo(addFilterBtn.value)
}
// 聚合 chip 面板只编辑嵌套子组；扁平条件保持栏上独立 chip，不入面板（ADR-0013 D2 修订）
function onAdvancedUpdate(q: ViewQuery) {
  const children = [...props.modelValue.filter.children]
  const nestedIdxs = children
    .map((c, i) => (isCondition(c) ? -1 : i))
    .filter((i) => i >= 0)
  const advanced = q.filter
  if (countConditions(advanced) === 0) {
    // 高级组被清空 → 移除所有嵌套组（扁平条件保留）
    for (const i of nestedIdxs.slice().reverse()) children.splice(i, 1)
  } else if (nestedIdxs.length === 0) {
    children.push(advanced) // 此前无高级组 → 追加
  } else {
    children[nestedIdxs[0]] = advanced // 替换首个嵌套组
    for (const i of nestedIdxs.slice(1).reverse()) children.splice(i, 1) // 删除其余（并入首组）
  }
  patch({ filter: { ...props.modelValue.filter, children } })
}

// ── 排序 ──
const sorts = computed(() => props.modelValue.sort)
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
const groupLabel = computed(() => {
  const k = props.modelValue.groupBy
  if (!k) return ''
  return fieldOf(k)?.label ?? k
})
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

// ── 供 Header 按钮直接唤起菜单（锚定到按钮自身）──
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
    <!-- 排序：始终聚合成单个 chip（ADR-0013 D3），最左 -->
    <button
      v-if="sorts.length"
      class="agg-chip"
      data-testid="bar-sort-agg"
      @click="openSortMenu($event.currentTarget as HTMLElement)"
    >
      <ArrowUpDown :size="14" />{{ sorts.length }} sorts ▾
    </button>
    <!-- sort | (group|filters) 分割线 -->
    <span v-if="divAfterSort" class="bar-divider" aria-hidden="true"></span>

    <!-- 分组：激活时显示单个 chip（groupBy 经 GroupMenu 编辑） -->
    <button
      v-if="groupBy"
      class="agg-chip"
      data-testid="bar-group-chip"
      @click="openGroupMenu($event.currentTarget as HTMLElement)"
    >
    <Layers :size="14" />{{ groupLabel }} ▾
    </button>
    <!-- group | filters 分割线 -->
    <span v-if="divAfterGroup" class="bar-divider" aria-hidden="true"></span>

    <!-- 嵌套/高级条件：聚合成单个 chip，始终在扁平 chip 左侧（ADR-0013 D2 修订） -->
    <button
      v-if="hasNested"
      class="agg-chip"
      data-testid="bar-agg"
      :title="`${nestedCount} 条高级/嵌套筛选规则`"
      @click="openAdvanced($event)"
    >
      <span class="agg-ico">≡</span> {{ nestedLabel }} ▾
    </button>

    <!-- 扁平条件：始终以独立 chip 展示，按创建顺序从左到右（ADR-0013 D2 修订）。
         使用 flatItems 携带的 children 真实索引，避免与嵌套组并列时错位。 -->
    <FilterChip
      v-for="item in flatItems"
      :key="'c' + item.idx"
      :label="condLabel(item.cond)"
      data-testid="bar-filter-chip"
      @click="openAt({ kind: 'cond', index: item.idx }, $event)"
      @remove="onCondRemove(item.idx)"
    />

    <button ref="addFilterBtn" class="add-btn" data-testid="bar-add-filter" @click="openAt({ kind: 'fieldMenu' }, $event)">
      + Filter
    </button>

    <FieldSelectMenu
      v-if="active?.kind === 'fieldMenu'"
      :fields="fields"
      :position="anchor"
      @select="addFilter"
      @advanced="openAdvancedFromMenu"
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
      @advanced="onCondAdvanced(condIndex)"
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

    <!-- 高级筛选 = 聚合 chip（或 + Filter 菜单）触发的 popover，仅筛选条件（ADR-0013 D5） -->
    <BasePopover
      v-if="active?.kind === 'advanced'"
      :visible="true"
      :position="anchor"
      @close="close"
    >
      <FilterBuilder
        :registry="registry"
        :entity-type="entityType"
        :cross-record-sources="crossRecordSources"
        :model-value="advancedModel"
        :show-sort-group="false"
        @update:model-value="onAdvancedUpdate"
      />
    </BasePopover>
  </div>
</template>

<style scoped>
.chip-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 20px;
  /* border-bottom: 1px solid var(--border); */
  background: var(--bg-base2);
}
.add-btn {
  border: 1px dashed var(--border);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 3px 8px;
  font-size: var(--text-xs);
  font-family: inherit;
  cursor: pointer;
}
.add-btn:hover {
  border-color: var(--accent, #6366f1);
  color: var(--accent, #6366f1);
}
.bar-divider {
  width: 1px;
  height: 18px;
  flex: 0 0 1px;
  background: var(--border);
  margin: 0 2px;
}
.agg-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
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
.agg-ico {
  font-size: var(--text-sm);
  line-height: 1;
}
</style>
