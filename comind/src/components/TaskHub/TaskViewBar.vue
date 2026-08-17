<script setup lang="ts">
import {
  CalendarDays,
  Check,
  ChevronDown,
  Columns,
  List,
  Pencil,
  Plus,
  Star,
  Trash2
} from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { BLOCK_ENTITY, getBlockRegistry } from '../../composables/useBlockQueryRegistry'
import type { ViewQuery } from '../../core/query'
import { parseViewQuery, useScreenViewStore } from '../../stores/screenView'
import { defaultLayoutConfig, type ViewKind } from '../../core/view'
import BasePopover from '../common/BasePopover.vue'
import QueryChipBar from '../query/QueryChipBar.vue'
import QueryToolbar from '../query/QueryToolbar.vue'

const props = defineProps<{
  currentViewType: string
  views: import('../../wasm/types').ScreenViewRust[]
  currentViewId?: string
}>()

const emit = defineEmits<{
  refresh: []
  'update:search-query': [value: string]
  'update:view-query': [value: ViewQuery]
}>()

const screenViewStore = useScreenViewStore()

// 查询引擎注册表（与 TaskHub 同源的单例组合根，实体级字段 schema 只需取一次）
const registry = getBlockRegistry()
const blockRefFields = registry.list(BLOCK_ENTITY)

// ── 查询状态（自 TaskHub 的 lib-header 整体迁入，参考 PagesLibrary 的本地持有范式）──
const viewQuery = ref<ViewQuery>({
  version: 1,
  filter: { combinator: 'and', children: [] },
  sort: [],
  groupBy: null,
})
const searchQuery = ref('')

// 芯片行显隐（Filter 按钮切换展开/收起）
const chipBarVisible = ref(false)
const chipBarRef = ref<InstanceType<typeof QueryChipBar> | null>(null)

// Header 三按钮激活态（供 QueryToolbar 描边；与 PagesLibrary 同源）
const hasFilter = computed(() => viewQuery.value.filter.children.length > 0)
const hasSort = computed(() => viewQuery.value.sort.length > 0)
const hasGroup = computed(() => viewQuery.value.groupBy !== null)

// Header 三按钮处理：统一转发给 QueryChipBar.openToolbarMenu（芯片行显隐/菜单策略内聚其中）
function openChipMenu(kind: 'filter' | 'sort' | 'group', e: MouseEvent) {
  chipBarRef.value?.openToolbarMenu(kind, e.currentTarget as HTMLElement)
}

// 加载当前激活视图的查询（兼容存量旧 BlockQuery → ViewQuery 迁移）
function loadActiveView() {
  const view = screenViewStore.views.find((v) => v.id === screenViewStore.currentViewId)
  viewQuery.value = view ? parseViewQuery(view.query_json) : {
    version: 1,
    filter: { combinator: 'and', children: [] },
    sort: [],
    groupBy: null,
  }
  searchQuery.value = ''
}

// 芯片/搜索变更：更新本地 viewQuery 并持久化到当前激活视图
function onQueryUpdate(q: ViewQuery) {
  viewQuery.value = q
  const view = screenViewStore.views.find((v) => v.id === screenViewStore.currentViewId)
  if (!view) return
  void screenViewStore.update(
    view.id,
    view.name,
    JSON.stringify(q),
    view.view_type,
    '',
    view.is_default === 1,
    view.sort_order,
    configForView(view, view.view_type),
  )
}

// 激活视图 / views 就绪后载入查询；view 切换也重载。
// 用 immediate 解决「子组件 onMounted 早于父组件 screenViewStore.load()」的时序问题。
watch(
  () => [screenViewStore.currentViewId, screenViewStore.views],
  loadActiveView,
  { immediate: true },
)

// 向父级（TaskHub）同步查询状态，供卡片过滤/分组计算
watch(viewQuery, (q) => emit('update:view-query', q))
watch(searchQuery, (q) => emit('update:search-query', q))

// ── 视图管理（命名视图切换 / 类型切换 / 保存 / 重命名 / 删除 / 设为默认）──
const showViewDropdown = ref(false)
const viewDropdownBtn = ref<HTMLButtonElement | null>(null)
const viewDropdownPos = ref<{ x: number; y: number }>({ x: 0, y: 0 })
const isEditingName = ref(false)

// 切换视图下拉：打开前把 BasePopover 锚定到触发按钮下方（等价原 top:100%/left:0/margin-top:4px）
function toggleViewDropdown() {
  const el = viewDropdownBtn.value
  if (el) {
    const r = el.getBoundingClientRect()
    viewDropdownPos.value = { x: r.left, y: r.bottom + 4 }
  }
  showViewDropdown.value = !showViewDropdown.value
}
const editName = ref('')

const viewTypes = [
  { key: 'table', label: '表格', icon: List },
  { key: 'board', label: '看板', icon: Columns },
  { key: 'calendar', label: '日历', icon: CalendarDays },
] as const

const currentView = computed(() =>
  screenViewStore.views.find(v => v.id === screenViewStore.currentViewId)
)

/** 视图保存/更新时序列化的布局配置：已有 config 沿用，否则按 kind 取内建默认。 */
function configForView(view: import('../../wasm/types').ScreenViewRust | undefined, kind: string): string {
  if (view?.config) return view.config
  return JSON.stringify(defaultLayoutConfig(kind as ViewKind))
}

async function changeViewType(type: string) {
  const view = currentView.value
  if (!view) return
  await screenViewStore.update(
    view.id,
    view.name,
    view.query_json,
    type,
    view.group_by,
    view.is_default === 1,
    view.sort_order,
    JSON.stringify(defaultLayoutConfig(type as ViewKind)),
  )
  emit('refresh')
}

async function selectView(viewId: string) {
  screenViewStore.currentViewId = viewId
  showViewDropdown.value = false
}

async function saveNewView() {
  const currentQuery = currentView.value
    ? parseViewQuery(currentView.value.query_json)
    : { version: 1, filter: { combinator: 'and', children: [] }, sort: [], groupBy: null }
  const nextIdx = screenViewStore.views.length + 1
  const saved = await screenViewStore.save(
    `新视图 ${nextIdx}`,
    JSON.stringify(currentQuery),
    props.currentViewType,
    currentView.value?.group_by ?? '',
    JSON.stringify(defaultLayoutConfig(props.currentViewType as ViewKind)),
  )
  screenViewStore.currentViewId = saved.id
  emit('refresh')
}

async function setAsDefault() {
  if (!screenViewStore.currentViewId) return
  await screenViewStore.setDefault(screenViewStore.currentViewId)
}

async function deleteView() {
  if (!screenViewStore.currentViewId) return
  const view = currentView.value
  if (view?.is_default === 1) return // can't delete default
  await screenViewStore.remove(screenViewStore.currentViewId)
  emit('refresh')
}

function startRename() {
  const view = currentView.value
  if (!view) return
  editName.value = view.name
  isEditingName.value = true
}

async function confirmRename() {
  const view = currentView.value
  if (!view || !editName.value.trim()) return
  await screenViewStore.update(
    view.id,
    editName.value.trim(),
    view.query_json,
    view.view_type,
    view.group_by,
    view.is_default === 1,
    view.sort_order,
    configForView(view, view.view_type),
  )
  isEditingName.value = false
}

function cancelRename() {
  isEditingName.value = false
  editName.value = ''
}

const canDelete = computed(() => {
  const view = currentView.value
  return view?.is_default !== 1 && screenViewStore.views.length > 1
})

const isDefaultView = computed(() => currentView.value?.is_default === 1)
</script>

<template>
  <div class="task-view-bar-root">
    <!-- 视图管理：命名视图切换 / 类型切换 / 保存 / 重命名 / 删除 / 设为默认 -->
    <div class="task-view-bar">
      <div class="bar-left">
        <!-- View name -->
        <div class="view-name-section">
          <template v-if="isEditingName">
            <input v-model="editName" class="view-name-input" @keyup.enter="confirmRename" @keyup.escape="cancelRename"
              @blur="confirmRename" ref="nameInput" autofocus />
            <button class="btn-icon-sm" @click="confirmRename" title="确认">
              <Check :size="14" />
            </button>
          </template>
          <template v-else>
            <span class="view-name" @dblclick="startRename">
              {{ currentView?.name ?? '任务' }}
            </span>
            <div class="view-dropdown" v-if="screenViewStore.views.length > 1">
              <button class="btn-icon-sm" ref="viewDropdownBtn" @click="toggleViewDropdown" title="切换视图">
                <ChevronDown :size="14" />
              </button>
              <BasePopover :visible="showViewDropdown" :position="viewDropdownPos" @close="showViewDropdown = false">
                <div class="view-menu">
                  <div v-for="v in screenViewStore.views" :key="v.id" class="dropdown-item"
                    :class="{ active: v.id === screenViewStore.currentViewId }" @click="selectView(v.id)">
                    <span>{{ v.name }}</span>
                    <Star v-if="v.is_default === 1" :size="12" class="default-star" />
                  </div>
                </div>
              </BasePopover>
            </div>
          </template>
        </div>

        <!-- View type tabs -->
        <div class="view-type-tabs">
          <button v-for="vt in viewTypes" :key="vt.key" class="view-tab" :class="{ active: currentViewType === vt.key }"
            @click="changeViewType(vt.key)">
            <component :is="vt.icon" :size="14" :stroke-width="1.75" />
            <span>{{ vt.label }}</span>
          </button>
          <!-- Set as default -->
          <button v-if="!isDefaultView" class="bar-btn" @click="setAsDefault" title="设为默认">
            <Star :size="16" :stroke-width="1.75" />
          </button>

          <!-- Rename -->
          <button class="bar-btn" @click="startRename" title="重命名">
            <Pencil :size="16" :stroke-width="1.75" />
          </button>

          <!-- Save as new view -->
          <button class="bar-btn" @click="saveNewView" title="存为新视图">
            <Plus :size="16" :stroke-width="1.75" />
            新视图
          </button>

          <!-- Delete -->
          <button v-if="canDelete" class="bar-btn danger" @click="deleteView" title="删除视图">
            <Trash2 :size="16" :stroke-width="1.75" />
          </button>
        </div>
      </div>

      <div class="bar-right">
        <!-- 查询工具条：筛选 / 排序 / 分组 三按钮 + 搜索（与 PagesLibrary 一致，自 TaskHub 迁入） -->
        <header class="lib-header">
          <div class="header-actions">
            <QueryToolbar v-model="searchQuery" :has-filter="hasFilter" :has-sort="hasSort" :has-group="hasGroup"
              :chip-bar-visible="chipBarVisible" @filter="openChipMenu('filter', $event)"
              @sort="openChipMenu('sort', $event)" @group="openChipMenu('group', $event)" />
          </div>
        </header>
      </div>
    </div>



    <!-- 筛选芯片行（QueryToolbar 三按钮唤起；显隐/菜单策略内聚于 QueryChipBar） -->
    <QueryChipBar ref="chipBarRef" v-model="viewQuery" :fields="blockRefFields" :registry="registry"
      :entity-type="BLOCK_ENTITY" @visible-change="chipBarVisible = $event" @update:model-value="onQueryUpdate" />
  </div>
</template>

<style lang="scss" scoped>
.task-view-bar-root {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.task-view-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-color, var(--app-split));
  background: var(--bg-primary);
  position: relative;
}

.bar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.bar-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.view-name-section {
  display: flex;
  align-items: center;
  gap: 4px;
}

.view-name {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  color: var(--text-primary);
  cursor: default;
  user-select: none;
}

.view-name-input {
  font-size: var(--text-base);
  font-weight: var(--font-semibold);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 2px 6px;
  outline: none;
  background: var(--bg-primary);
  color: var(--text-primary);
  width: 150px;
}

.view-dropdown {
  display: inline-flex;
  align-items: center;
}

.view-menu {
  min-width: 180px;
  padding: 4px;
}

.dropdown-item {
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

  &.active {
    background: var(--accent-bg, rgba(99, 102, 241, 0.08));
    color: var(--text-primary);
    font-weight: var(--font-medium);
  }
}

.default-star {
  color: var(--accent);
}

.view-type-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--bg-base2);
  border-radius: 6px;
  padding: 2px;
}

.view-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--text-sm);
  transition: all 100ms ease;

  &:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  &.active {
    color: var(--text-primary);
    background: var(--bg-primary);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  }
}

.bar-btn {
  display: flex;
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

  &.active {
    color: var(--accent);
    background: var(--accent-bg, rgba(99, 102, 241, 0.08));
  }

  &.danger:hover {
    color: var(--error, #DC2626);
    background: rgba(220, 38, 38, 0.06);
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
}

/* ── 查询工具条（自 TaskHub 的 lib-header 迁入）── */
.lib-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 10px 0 4px;
  margin: 0 var(--space-4);
  gap: 16px;
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
</style>
