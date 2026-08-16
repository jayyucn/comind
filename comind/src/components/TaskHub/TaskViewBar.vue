<script setup lang="ts">
import { ref, computed } from 'vue'
import { useTaskViewStore, parseViewQuery } from '../../stores/taskView'
import {
  List, Columns, CalendarDays, Plus, Trash2, Star,
  ChevronDown, Pencil, Check
} from 'lucide-vue-next'

const props = defineProps<{
  currentViewType: string
  views: import('../../wasm/types').TaskViewRust[]
  currentViewId?: string
}>()

const emit = defineEmits<{
  refresh: []
}>()

const taskViewStore = useTaskViewStore()

const showViewDropdown = ref(false)
const isEditingName = ref(false)
const editName = ref('')

const viewTypes = [
  { key: 'table', label: '表格', icon: List },
  { key: 'board', label: '看板', icon: Columns },
  { key: 'calendar', label: '日历', icon: CalendarDays },
] as const

const currentView = computed(() =>
  taskViewStore.views.find(v => v.id === taskViewStore.currentViewId)
)

async function changeViewType(type: string) {
  const view = currentView.value
  if (!view) return
  await taskViewStore.update(
    view.id,
    view.name,
    view.query_json,
    type,
    view.group_by,
    view.is_default === 1,
    view.sort_order
  )
  emit('refresh')
}

async function selectView(viewId: string) {
  taskViewStore.currentViewId = viewId
  showViewDropdown.value = false
}

async function saveNewView() {
  const currentQuery = currentView.value
    ? parseViewQuery(currentView.value.query_json)
    : { version: 1, filter: { combinator: 'and', children: [] }, sort: [], groupBy: null }
  const nextIdx = taskViewStore.views.length + 1
  const saved = await taskViewStore.save(
    `新视图 ${nextIdx}`,
    JSON.stringify(currentQuery),
    props.currentViewType,
    currentView.value?.group_by ?? ''
  )
  taskViewStore.currentViewId = saved.id
  emit('refresh')
}

async function setAsDefault() {
  if (!taskViewStore.currentViewId) return
  await taskViewStore.setDefault(taskViewStore.currentViewId)
}

async function deleteView() {
  if (!taskViewStore.currentViewId) return
  const view = currentView.value
  if (view?.is_default === 1) return // can't delete default
  await taskViewStore.remove(taskViewStore.currentViewId)
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
  await taskViewStore.update(
    view.id,
    editName.value.trim(),
    view.query_json,
    view.view_type,
    view.group_by,
    view.is_default === 1,
    view.sort_order
  )
  isEditingName.value = false
}

function cancelRename() {
  isEditingName.value = false
  editName.value = ''
}

const canDelete = computed(() => {
  const view = currentView.value
  return view?.is_default !== 1 && taskViewStore.views.length > 1
})

const isDefaultView = computed(() => currentView.value?.is_default === 1)
</script>

<template>
  <div class="task-view-bar">
    <div class="bar-left">
      <!-- View name -->
      <div class="view-name-section">
        <template v-if="isEditingName">
          <input
            v-model="editName"
            class="view-name-input"
            @keyup.enter="confirmRename"
            @keyup.escape="cancelRename"
            @blur="confirmRename"
            ref="nameInput"
            autofocus
          />
          <button class="btn-icon-sm" @click="confirmRename" title="确认">
            <Check :size="14" />
          </button>
        </template>
        <template v-else>
          <span class="view-name" @dblclick="startRename">
            {{ currentView?.name ?? '任务' }}
          </span>
          <div class="view-dropdown" v-if="taskViewStore.views.length > 1">
            <button class="btn-icon-sm" @click="showViewDropdown = !showViewDropdown" title="切换视图">
              <ChevronDown :size="14" />
            </button>
            <div class="dropdown-menu" v-if="showViewDropdown" @click.stop>
              <div
                v-for="v in taskViewStore.views"
                :key="v.id"
                class="dropdown-item"
                :class="{ active: v.id === taskViewStore.currentViewId }"
                @click="selectView(v.id)"
              >
                <span>{{ v.name }}</span>
                <Star v-if="v.is_default === 1" :size="12" class="default-star" />
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- View type tabs -->
      <div class="view-type-tabs">
        <button
          v-for="vt in viewTypes"
          :key="vt.key"
          class="view-tab"
          :class="{ active: currentViewType === vt.key }"
          @click="changeViewType(vt.key)"
        >
          <component :is="vt.icon" :size="14" :stroke-width="1.75" />
          <span>{{ vt.label }}</span>
        </button>
      </div>
    </div>

    <div class="bar-right">
      <!-- Set as default -->
      <button
        v-if="!isDefaultView"
        class="bar-btn"
        @click="setAsDefault"
        title="设为默认"
      >
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
      <button
        v-if="canDelete"
        class="bar-btn danger"
        @click="deleteView"
        title="删除视图"
      >
        <Trash2 :size="16" :stroke-width="1.75" />
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
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
  position: relative;
}

.dropdown-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color, var(--app-split));
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  min-width: 180px;
  z-index: 100;
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
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
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
</style>
