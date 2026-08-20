<script setup lang="ts">
import { ArrowUp, Layers } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
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
  /** chipbar 显隐变化（父级用于 QueryToolbar 的描边态）。 */
  'visible-change': [visible: boolean]
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
  | { kind: 'sortEdit' }
  | { kind: 'group' }
  | { kind: 'advanced' }
  | null
const active = ref<Active>(null)

const addFilterBtn = ref<HTMLButtonElement | null>(null)

// ── chipbar 显隐（内聚于此：选中字段后由本组件自行显示，无需父级事件乒乓）──
const visible = ref(false)
watch(visible, (v) => emit('visible-change', v))

// 聚合 chip / 扁平 chip 的 DOM 引用，供「把 popover 重新锚定到对应 chip 下方」使用
const groupChipEl = ref<HTMLElement | null>(null)
const sortChipEl = ref<HTMLElement | null>(null)
const chipEls = new Map<number, HTMLElement>()
function setChipEl(idx: number, el: unknown) {
  if (el) chipEls.set(idx, el as HTMLElement)
  else chipEls.delete(idx)
}
// chipbar 显隐容器（grid 高度动画的包裹层），restingBottom 以它为定位基准
const wrapEl = ref<HTMLElement | null>(null)
/**
 * 返回芯片「静止高度」下的底边 Y（不受 grid 高度动画中间帧影响）。
 * 显隐用 grid-template-rows 0fr↔1fr 真实收展高度：动画过程中 chip 的 getBoundingClientRect
 * 会随帧变化，但芯片在 wrap 内的纵向偏移与自身高度恒定，故用 offsetTop 链 + wrap 顶部
 * 直接算出最终静止位置，避免 popover 锚到动画中途的（缩起）坐标而漂移。
 */
function restingBottom(el: HTMLElement): number {
  const wrap = wrapEl.value
  if (!wrap) return el.getBoundingClientRect().bottom
  let top = 0
  let node: HTMLElement | null = el
  while (node && node !== wrap) {
    top += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return wrap.getBoundingClientRect().top + top + el.offsetHeight
}
/** 把锚点设到指定芯片元素下方（用静止高度，动画中也不漂移）。 */
function anchorToEl(el?: HTMLElement | null) {
  if (el) anchor.value = { x: el.getBoundingClientRect().left, y: restingBottom(el) + 4 }
}
/** 扁平条件芯片按其在 children 中的真实索引取 DOM 并重定位。 */
function anchorToChip(idx: number) {
  anchorToEl(chipEls.get(idx))
}

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
// 三按钮「是否有内容」判定（供 openToolbarMenu 分态；与 PagesLibrary 给 QueryToolbar 的描边态同源）
const hasFilter = computed(() => props.modelValue.filter.children.length > 0)
const hasSort = computed(() => props.modelValue.sort.length > 0)
const hasGroup = computed(() => props.modelValue.groupBy !== null)
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
  const newIndex = children.length - 1
  // 选中字段后显示 chipbar，并在新扁平 chip 渲染后把编辑器重新锚定到该 chip 下方
  visible.value = true
  active.value = { kind: 'cond', index: newIndex }
  nextTick(() => anchorToChip(newIndex))
}

// 打开高级筛选 popover：由聚合 chip 或 + Filter 菜单触发（ADR-0013 D5）
function openAdvanced(e: Event) {
  openAt({ kind: 'advanced' }, e)
}
function openAdvancedFromMenu() {
  close()
  active.value = { kind: 'advanced' }
  // 展开 chipbar 并锚定到 + Filter 按钮，使高级筛选面板出现在 chipbar 区域内
  // （而非沿用工具栏按钮的旧坐标导致面板飞到页面顶部）
  visible.value = true
  nextTick(() => {
    const btn = addFilterBtn.value
    if (btn) anchorTo(btn)
  })
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
function onSortUpdate(sort: SortRule[]) {
  patch({ sort })
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
  // 选中分组字段后显示 chipbar（取消分组不强制显示）
  if (key !== null) visible.value = true
  nextTick(() => anchorToEl(groupChipEl.value))
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

// ── 供 Header 按钮直接唤起菜单（锚定到按钮自身）──
function openFieldMenu(el?: HTMLElement | null) {
  anchorTo(el)
  active.value = { kind: 'fieldMenu' }
  //
}
function openSortMenu(el?: HTMLElement | null) {
  if (props.modelValue.sort.length === 0) {
    const f = props.fields[0]
    if (!f) return
    patch({ sort: [{ field: f.key, dir: 'asc' }] })
    // 空态选中字段后显示 chipbar
    visible.value = true
  }
  active.value = { kind: 'sortEdit' }
  if (el) {
    anchorTo(el)
  } else {
    // Header 按钮等无触发元素时，待排序 chip 渲染后锚定到它下方
    nextTick(() => anchorToEl(sortChipEl.value))
  }
}
function openGroupMenu(el?: HTMLElement | null) {
  anchorTo(el)
  active.value = { kind: 'group' }
}

/**
 * Header 三按钮（筛选/排序/分组）的统一入口——把「toolbar 请求如何处理」的策略内聚于此，
 * 而不是让父级去读 isVisible()/toggleVisible()/openFieldMenu() 等原语再拼分支。
 * 规则（以 chipbar 当前显隐为准，不被「该类型是否有内容」绑架）：
 *  - 筛选：已展开→收起；已收起+有内容→展开（不弹菜单）；已收起+无内容→只弹字段菜单
 *  - 排序/分组：无内容→只弹菜单（选中字段后 chipbar 自行显示）；有内容→切换 chipbar + 额外展开菜单
 */
function openToolbarMenu(kind: 'filter' | 'sort' | 'group', el?: HTMLElement | null) {
  const barVisible = visible.value
  const has = kind === 'filter' ? hasFilter.value : kind === 'sort' ? hasSort.value : hasGroup.value
  if (kind === 'filter') {
    if (barVisible) {
      visible.value = false // 已展开 → 收起（即便筛选 chip 为空也折叠）
      return
    }
    if (has) {
      visible.value = true // 已收起且有内容 → 展开（不弹菜单）
      return
    }
    openFieldMenu(el) // 已收起且无内容 → 只弹字段菜单
    return
  }
  // 排序 / 分组
  if (!has) {
    if (kind === 'sort') openSortMenu()
    else openGroupMenu(el)
    return
  }
  visible.value = !visible.value
  if (!visible.value) return
  if (kind === 'sort') openSortMenu()
  else openGroupMenu(el)
}

defineExpose({
  openToolbarMenu,
})
</script>

<template>
  <div class="chipbar-wrap" :class="{ 'is-open': visible }" data-testid="chipbar-wrap" ref="wrapEl">
    <div class="chipbar-inner">
      <div class="chip-bar" data-testid="chip-bar">
    <!-- 排序：始终聚合成单个 chip（ADR-0013 D3），最左 -->
    <button
      v-if="sorts.length"
      ref="sortChipEl"
      class="agg-chip is-sort"
      :class="{ active: active?.kind === 'sortEdit' }"
      data-testid="bar-sort-agg"
      @click="openSortMenu($event.currentTarget as HTMLElement)"
    >
      <ArrowUp :size="14" />{{ sorts.length }} sorts ▾
    </button>
    <!-- sort | (group|filters) 分割线 -->
    <span v-if="divAfterSort" class="bar-divider" aria-hidden="true"></span>

    <!-- 分组：激活时显示单个 chip（groupBy 经 GroupMenu 编辑） -->
    <button
      v-if="groupBy"
      ref="groupChipEl"
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
         使用 flatItems 携带的 children 真实索引，避免与嵌套组并列时错位。
         包裹 span 仅用于测量芯片 DOM 矩形，以便把 popover 锚定到其下方。 -->
    <span
      v-for="item in flatItems"
      :key="'c' + item.idx"
      :ref="(el: unknown) => setChipEl(item.idx, el)"
      class="chip-slot"
    >
      <FilterChip
        :label="condLabel(item.cond)"
        data-testid="bar-filter-chip"
        @click="openAt({ kind: 'cond', index: item.idx }, $event)"
        @remove="onCondRemove(item.idx)"
      />
    </span>

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
      :entity-type="entityType"
      :registry="registry"
      @update:condition="onCondUpdate(condIndex, $event)"
      @remove="onCondRemove(condIndex)"
      @advanced="onCondAdvanced(condIndex)"
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

    <!-- 排序编辑器：弹窗形式（与 FilterBuilder 高级筛选一致，包一层 BasePopover） -->
    <BasePopover
      v-if="active?.kind === 'sortEdit'"
      :visible="true"
      :position="anchor"
      @close="close"
    >
      <SortMenu
        :sort="sorts"
        :fields="fields"
        @update:sort="onSortUpdate"
        @close="close"
      />
    </BasePopover>
    </div>
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
  opacity: 0;
  transition: opacity 160ms ease;
}
.chipbar-wrap.is-open .chip-bar {
  opacity: 1;
  border: 1px solid var(--border);
}
.add-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 3px 8px;
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
}
.add-btn:hover {
  color: var(--accent, #6366f1);
  background: var(--bg-hover);
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
.agg-chip.is-sort {
  background: var(--accent-bg, rgba(99, 102, 241, 0.12));
  border-color: transparent;
  color: var(--accent, #6366f1);
}
.agg-chip.is-sort:hover {
  background: var(--accent-bg, rgba(99, 102, 241, 0.18));
}
.agg-chip.is-sort.active {
  background: var(--accent, #6366f1);
  color: var(--text-on-accent, #fff);
}
.agg-ico {
  font-size: var(--text-sm);
  line-height: 1;
}
/* 扁平芯片包裹层：仅用于测量 DOM 矩形，不影响 flex 布局 */
.chip-slot {
  display: inline-flex;
}

/* ── 显隐过渡：用 grid-template-rows 0fr↔1fr 收展「真实高度」，
   使 flex 兄弟 lib-body 随 chipbar 平滑上下移动（不只是淡入淡出）。
   配合 restingBottom()（见脚本）：popover 锚到芯片静止高度，动画中不错位。 */
.chipbar-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 220ms ease;
  position: relative;
}
.chipbar-wrap.is-open {
  grid-template-rows: 1fr;
}
.chipbar-inner {
  overflow: hidden;
  min-height: 0;
}
</style>
