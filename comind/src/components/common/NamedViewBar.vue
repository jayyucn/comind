<script setup lang="ts">
import {
  ChevronDown,
  Copy,
  Filter,
  MoreVertical,
  Pencil,
  Plus,
  Star,
  Table,
  Trash2
} from 'lucide-vue-next'
import type { Component } from 'vue'
import { computed, nextTick, ref } from 'vue'
import {
  canDeleteScreen,
  canDeleteTab,
  isDefaultScreen,
  type ViewTypeOption,
} from '../../core/view/management'
import { useScreenViewStore } from '../../stores/screenView'
import type { ScreenViewRust } from '../../wasm/types'
import BasePopover from './BasePopover.vue'

const props = defineProps<{
  entityKey: string
  viewTypes: ViewTypeOption[]
  defaultViewName?: string
  defaultViewType?: string
}>()

// 实体级两级（Screen→Tab）命名视图 store（按 entityKey 隔离，与后端 screen_view.entity 对齐）
const store = useScreenViewStore(props.entityKey, {
  defaultViewName: props.defaultViewName,
  defaultViewType: props.defaultViewType,
})

function viewTypeIcon(type: string): Component {
  return props.viewTypes.find((v) => v.key === type)?.icon ?? Table
}
function typeLabel(t: string): string {
  return props.viewTypes.find((v) => v.key === t)?.label ?? t
}
function tabName(t: ScreenViewRust): string {
  return t.name || typeLabel(t.view_type)
}

// ── Screen 下拉 ──
const showScreenPop = ref(false)
const screenPopPos = ref<{ x: number; y: number }>({ x: 0, y: 0 })
const screenTriggerRef = ref<HTMLButtonElement | null>(null)
const creatingScreen = ref(false)
const renamingScreenId = ref<string | null>(null)
const newScreenName = ref('')
let clickTimer: number | null = null

function toggleScreenPop() {
  const el = screenTriggerRef.value
  if (el) {
    const r = el.getBoundingClientRect()
    screenPopPos.value = { x: r.left, y: r.bottom + 4 }
  }
  showScreenPop.value = !showScreenPop.value
}

function startCreateScreen() {
  creatingScreen.value = true
  renamingScreenId.value = null
  newScreenName.value = ''
  nextTick(focusScreenInput)
}
function startRenameScreen(id: string) {
  renamingScreenId.value = id
  creatingScreen.value = false
  newScreenName.value = screenNameOf(id)
  nextTick(focusScreenInput)
}
function focusScreenInput() {
  const el = document.getElementById('screenNameInput') as HTMLInputElement | null
  el?.focus()
  el?.select()
}
function screenNameOf(id: string): string {
  return store.screens.find((s) => s.id === id)?.name ?? ''
}
function confirmScreenName() {
  const name = newScreenName.value.trim()
  if (creatingScreen.value) {
    if (name) void store.createScreen(name)
  } else if (renamingScreenId.value) {
    void store.renameScreen(renamingScreenId.value, name)
  }
  creatingScreen.value = false
  renamingScreenId.value = null
  newScreenName.value = ''
  showScreenPop.value = false
}

function onScreenRowClick(sid: string, e: MouseEvent) {
  const actBtn = (e.target as HTMLElement).closest('[data-act]')
  if (actBtn) {
    const act = (actBtn as HTMLElement).dataset.act
    if (act === 'rename') startRenameScreen(sid)
    else if (act === 'default') void store.setDefaultScreen(sid)
    else if (act === 'delete') {
      void store.deleteScreen(sid)
      showScreenPop.value = false
    }
    return
  }
  if ((e.target as HTMLElement).closest('.nm')) {
    if (clickTimer) {
      clearTimeout(clickTimer)
      clickTimer = null
      startRenameScreen(sid)
      return
    }
    clickTimer = window.setTimeout(() => {
      clickTimer = null
      if (renamingScreenId.value !== sid) void store.selectScreen(sid)
      showScreenPop.value = false
    }, 220)
    return
  }
  void store.selectScreen(sid)
  showScreenPop.value = false
}

function tabCountOf(screenId: string): number {
  return store.views.filter((v) => v.parent_id === screenId).length
}

// ── Tab 条 ──
const renamingTabId = ref<string | null>(null)
const tabRenameName = ref('')
function startRenameTab(id: string) {
  renamingTabId.value = id
  const t = store.views.find((v) => v.id === id)
  tabRenameName.value = t ? t.name : ''
  nextTick(() => {
    const el = document.getElementById('tabRenameInput') as HTMLInputElement | null
    el?.focus()
    el?.select()
  })
}
function confirmTabRename() {
  if (renamingTabId.value) void store.renameTab(renamingTabId.value, tabRenameName.value)
  renamingTabId.value = null
  tabRenameName.value = ''
}

// ── Tab ⋯ 菜单 ──
const showTabMenu = ref(false)
const tabMenuPos = ref<{ x: number; y: number }>({ x: 0, y: 0 })
const tabMenuId = ref<string | null>(null)
function openTabMenu(id: string, e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  tabMenuPos.value = { x: r.left, y: r.bottom + 4 }
  tabMenuId.value = id
  showTabMenu.value = true
}
function onDuplicateTab(id: string) {
  const t = store.views.find((v) => v.id === id)
  if (!t) return
  const base = t.name || typeLabel(t.view_type)
  void store.duplicateTab(id, `${base} 副本`)
  showTabMenu.value = false
}

// ── 新建 tab 弹窗 ──
const showNewTabModal = ref(false)
const newTabName = ref('')
const newTabType = ref<string>(props.viewTypes[0]?.key ?? 'table')
function openNewTabModal() {
  newTabType.value = props.viewTypes[0]?.key ?? 'table'
  newTabName.value = ''
  showNewTabModal.value = true
  nextTick(() => {
    const el = document.getElementById('newTabName') as HTMLInputElement | null
    el?.focus()
  })
}
function createTab() {
  void store.createTab(newTabName.value.trim() || undefined, newTabType.value)
  showNewTabModal.value = false
}

const currentScreen = computed(() => store.currentScreen)
const currentTabs = computed(() => store.currentTabs)
const dirty = computed(() => store.dirty)
</script>

<template>
  <div class="named-view-bar">
    <!-- Screen 下拉触发器 -->
    <button ref="screenTriggerRef" class="screen-trigger" :class="{ open: showScreenPop }" @click="toggleScreenPop">
      <Star v-if="isDefaultScreen(currentScreen)" :size="12" class="def-star" />
      <span class="cur-name">{{ currentScreen?.name ?? '视图' }}</span>
      <ChevronDown :size="14" class="chev" />
    </button>

    <!-- Tabs 条 -->
    <div class="tab-row">
      <div
        v-for="t in currentTabs"
        :key="t.id"
        class="tab"
        :class="{ active: t.id === store.currentTabId }"
        @click="renamingTabId ? null : store.selectTab(t.id)"
      >
        <component :is="viewTypeIcon(t.view_type)" :size="13" class="ico" />
        <input
          v-if="renamingTabId === t.id"
          id="tabRenameInput"
          v-model="tabRenameName"
          class="rename"
          @keyup.enter="confirmTabRename"
          @keyup.escape="renamingTabId = null"
          @blur="confirmTabRename"
          @click.stop
        />
        <template v-else>
          <span class="name">{{ tabName(t) }}</span>
          <template v-if="t.id === store.currentTabId && dirty && !renamingTabId">
            <span class="tab-hint"><Filter :size="12" />你调整了筛选</span>
            <button class="action" @click.stop="store.discardActiveTab()">清除</button>
            <button class="action" @click.stop="store.saveActiveTab()">保存</button>
          </template>
          <template v-else>
            <span v-if="store.dirtyByTab.has(t.id)" class="dot" title="有未保存的更改"></span>
            <span
              v-else
              class="kebab"
              :class="{ on: t.id === store.currentTabId }"
              @click.stop="openTabMenu(t.id, $event)"
            >
              <MoreVertical :size="14" />
            </span>
          </template>
        </template>
      </div>
    </div>

    <!-- 新建 tab -->
    <button class="add-tab" title="新建 tab" @click="openNewTabModal">
      <Plus :size="15" />
    </button>

    <!-- QueryToolbar 由消费方注入（保持现状） -->
    <div class="slot-area">
      <slot />
    </div>

    <!-- Screen 下拉 -->
    <BasePopover :visible="showScreenPop" :position="screenPopPos" @close="showScreenPop = false">
      <div class="screen-pop">
        <div class="hd">SCREENS</div>
        <input
          v-if="creatingScreen"
          id="screenNameInput"
          v-model="newScreenName"
          class="screen-input"
          placeholder="Screen 名称，回车创建"
          @keyup.enter="confirmScreenName"
          @keyup.escape="creatingScreen = false"
        />
        <template v-else>
          <button class="new-screen" @click="startCreateScreen">
            <Plus :size="13" /> 新建 Screen
          </button>
          <button class="new-screen rename-screen" @click="currentScreen && startRenameScreen(currentScreen.id)">
            <Pencil :size="13" /> 重命名
          </button>
        </template>
        <div class="sep"></div>
        <div
          v-for="s in store.screens"
          :key="s.id"
          class="screen-item"
          :class="{ current: s.id === store.currentScreenId }"
          @click="onScreenRowClick(s.id, $event)"
        >
          <input
            v-if="renamingScreenId === s.id"
            id="screenNameInput"
            v-model="newScreenName"
            class="screen-input"
            @keyup.enter="confirmScreenName"
            @keyup.escape="renamingScreenId = null"
            @blur="confirmScreenName"
            @click.stop
          />
          <template v-else>
            <button class="act" data-act="rename" title="重命名">
              <Pencil :size="12" />
            </button>
            <span class="nm" title="双击重命名">{{ s.name }}</span>
            <span class="tabs-cnt">{{ tabCountOf(s.id) }}</span>
            <button
              class="act"
              :class="{ starred: isDefaultScreen(s) }"
              data-act="default"
              title="设为默认"
            >
              <Star :size="12" />
            </button>
            <button
              class="act del"
              data-act="delete"
              title="删除"
              :disabled="!canDeleteScreen(store.screens, s.id)"
            >
              <Trash2 :size="12" />
            </button>
          </template>
        </div>
      </div>
    </BasePopover>

    <!-- Tab ⋯ 菜单 -->
    <BasePopover :visible="showTabMenu" :position="tabMenuPos" @close="showTabMenu = false">
      <div class="pop-menu">
        <button class="pop-item" @click="tabMenuId && startRenameTab(tabMenuId); showTabMenu = false">
          <Pencil :size="13" /> 重命名
        </button>
        <button class="pop-item" @click="tabMenuId && (onDuplicateTab(tabMenuId), showTabMenu = false)">
          <Copy :size="13" /> 复制 视图
        </button>
        <div class="sep"></div>
        <button
          class="pop-item danger"
          :disabled="!canDeleteTab(currentTabs)"
          @click="tabMenuId && (store.deleteTab(tabMenuId), showTabMenu = false)"
        >
          <Trash2 :size="13" /> 删除 tab
        </button>
      </div>
    </BasePopover>

    <!-- 新建 tab 弹窗 -->
    <div v-if="showNewTabModal" class="mask" @click.self="showNewTabModal = false">
      <div class="modal">
        <h3>新建 tab</h3>
        <p class="sub">在当前 Screen「{{ currentScreen?.name }}」内创建；类型创建后固定。</p>
        <div class="field">
          <label>名称（可选，默认为类型名）</label>
          <input id="newTabName" v-model="newTabName" type="text" placeholder="例如：高优先级" @keyup.enter="createTab" />
        </div>
        <div class="field">
          <label>类型</label>
          <div class="type-seg">
            <button
              v-for="vt in viewTypes"
              :key="vt.key"
              class="type-opt"
              :class="{ sel: newTabType === vt.key }"
              @click="newTabType = vt.key"
            >
              <component :is="vt.icon" :size="18" />
              <span>{{ vt.label }}</span>
            </button>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="showNewTabModal = false">取消</button>
          <button class="btn primary" @click="createTab">创建 tab</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.named-view-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 42px;
  padding: 0 10px;
  margin-top: var(--space-4);
  border: 1px solid var(--border);
  border-top-left-radius: var(--radius-md);
  border-top-right-radius: var(--radius-md);
  background: var(--bg-base);
  flex-shrink: 0;
}

.screen-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  height: 28px;
  padding: 0 9px;
  border-radius: var(--radius-sm, 6px);
  border: none;
  background: transparent;
  color: var(--text-primary);
  font: 600 var(--text-sm, 0.875rem)/1 var(--font-sans, sans-serif);
  cursor: pointer;
  transition: background 80ms ease;

  &:hover,
  &.open {
    background: var(--bg-hover);
  }

  .chev {
    color: var(--text-tertiary);
    transition: transform 80ms ease;
  }

  &.open .chev {
    transform: rotate(180deg);
  }

  .def-star {
    color: var(--accent);
  }
}

.tab-row {
  display: flex;
  align-items: center;
  flex: none;
  max-width: 55%;
  overflow-x: auto;
  align-self: stretch;
  overflow-y: hidden;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  padding: 0 10px;
  height: 100%;
  cursor: pointer;
  user-select: none;
  position: relative;
  color: var(--text-tertiary);
  font-size: var(--text-xs, 0.75rem);
  font-weight: 500;
  transition: color 80ms ease, background 80ms ease;

  &:hover {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  &.active {
    color: var(--text-primary);
  }

  &.active::after {
    content: '';
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: -1px;
    height: 2px;
    background: var(--accent);
    border-radius: 2px;
    box-shadow: 0 0 8px rgba(129, 140, 248, 0.55);
  }

  .ico {
    color: inherit;
    opacity: 0.9;
  }

  &.active .ico {
    color: var(--accent);
    opacity: 1;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .rename {
    font: 600 var(--text-xs, 0.75rem)/1.2 var(--font-sans, sans-serif);
    width: 96px;
    background: var(--bg-base2);
    border: 1px solid var(--accent);
    border-radius: 4px;
    color: var(--text-primary);
    padding: 3px 7px;
    outline: none;
    box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.15);
  }
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  flex: none;
  animation: nvb-pulse 1.8s ease-in-out infinite;
}

@keyframes nvb-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(129, 140, 248, 0.45);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(129, 140, 248, 0);
  }
}

.kebab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 18px;
  border-radius: 4px;
  color: var(--text-tertiary);
  opacity: 0;
  transition: all 80ms ease;

  &.on,
  .tab:hover & {
    opacity: 1;
  }

  &:hover {
    background: var(--bg-active, #3a3a3f);
    color: var(--text-primary);
  }
}

.tab-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-xs, 0.75rem);
  color: var(--text-tertiary);
  white-space: nowrap;
  margin-left: 3px;
}

.action {
  font: 400 var(--text-xs, 0.75rem)/1 var(--font-sans, sans-serif);
  cursor: pointer;
  color: var(--accent);
  background: none;
  border: none;
  padding: 0 2px;
  white-space: nowrap;
  transition: color 80ms ease;
  margin-left: 8px;

  &:hover {
    color: var(--accent-hover, #6366f1);
    text-decoration: underline;
  }
}

.add-tab {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm, 6px);
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 80ms ease;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.slot-area {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  padding-left: 8px;
}

/* ── Screen 下拉 ── */
.screen-pop {
  min-width: 260px;
  padding: 4px;
}

.hd {
  padding: 6px 10px 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  letter-spacing: 0.06em;
}

.screen-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
  transition: background 80ms ease;

  &:hover {
    background: var(--bg-hover);
  }

  &.current {
    background: var(--accent-subtle, rgba(129, 140, 248, 0.08));
  }

  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs, 0.75rem);
    font-weight: 500;
    color: var(--text-primary);
    cursor: text;
    user-select: none;
  }

  .tabs-cnt {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    color: var(--text-tertiary);
  }

  .act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    opacity: 0;
    transition: all 80ms ease;
    flex: none;

    .screen-item:hover & {
      opacity: 1;
    }

    &:hover {
      background: var(--bg-active, #3a3a3f);
      color: var(--text-primary);
    }

    &.starred {
      opacity: 1;
      color: var(--accent);
    }

    &.del:hover {
      color: var(--error, #f87171);
      background: rgba(248, 113, 113, 0.1);
    }

    &:disabled {
      opacity: 0.25;
      pointer-events: none;
    }
  }
}

.screen-input {
  flex: 1;
  min-width: 0;
  font: 500 var(--text-xs, 0.75rem)/1.2 var(--font-sans, sans-serif);
  background: var(--bg-base);
  border: 1px solid var(--accent);
  border-radius: 4px;
  color: var(--text-primary);
  padding: 4px 7px;
  outline: none;
  box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.15);
}

.new-screen {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font: 500 var(--text-xs, 0.75rem)/1 var(--font-sans, sans-serif);
  transition: background 80ms ease;

  &:hover {
    background: var(--accent-subtle, rgba(129, 140, 248, 0.08));
  }

  &.rename-screen {
    color: var(--text-secondary);

    &:hover {
      background: var(--bg-hover);
    }
  }
}

.sep {
  height: 1px;
  background: var(--border);
  margin: 4px 6px;
}

/* ── Tab 菜单 ── */
.pop-menu {
  min-width: 150px;
  padding: 4px;
}

.pop-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font: 500 var(--text-xs, 0.75rem)/1 var(--font-sans, sans-serif);
  text-align: left;
  transition: all 80ms ease;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.danger {
    color: var(--error, #f87171);

    &:hover:not(:disabled) {
      background: rgba(248, 113, 113, 0.1);
    }
  }

  &:disabled {
    opacity: 0.35;
    pointer-events: none;
  }
}

/* ── 新建 tab 弹窗 ── */
.mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 12, 0.55);
  backdrop-filter: blur(3px);
}

.modal {
  width: 380px;
  background: var(--bg-base);
  border: 1px solid var(--border-light, #3a3a3f);
  border-radius: var(--radius-lg, 14px);
  padding: 22px;
  box-shadow: var(--shadow-modal, 0 8px 32px rgba(0, 0, 0, 0.3));

  h3 {
    margin: 0 0 4px;
    font-size: 15px;
    font-weight: 600;
  }

  .sub {
    margin: 0 0 16px;
    font-size: var(--text-xs, 0.75rem);
    color: var(--text-tertiary);
  }
}

.field {
  margin-bottom: 16px;

  label {
    display: block;
    font-size: var(--text-xs, 0.75rem);
    color: var(--text-secondary);
    margin-bottom: 7px;
    font-weight: 500;
  }

  input[type='text'] {
    width: 100%;
    height: 34px;
    background: var(--bg-base2);
    border: 1px solid var(--border-light, #3a3a3f);
    border-radius: var(--radius-sm, 6px);
    color: var(--text-primary);
    padding: 0 11px;
    font: 400 var(--text-sm, 0.875rem)/1 var(--font-sans, sans-serif);
    outline: none;
    transition: all 80ms ease;

    &:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.15);
    }
  }
}

.type-seg {
  display: flex;
  gap: 8px;
}

.type-opt {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  padding: 13px 6px 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md, 10px);
  cursor: pointer;
  color: var(--text-tertiary);
  background: var(--bg-base2);
  transition: all 80ms ease;

  &:hover {
    border-color: var(--border-strong, #4a4a50);
    color: var(--text-secondary);
  }

  &.sel {
    border-color: var(--accent);
    background: var(--accent-subtle, rgba(129, 140, 248, 0.08));
    color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 14px;
  border-radius: var(--radius-sm, 6px);
  font: 500 var(--text-xs, 0.75rem)/1 var(--font-sans, sans-serif);
  cursor: pointer;
  border: 1px solid var(--border-light, #3a3a3f);
  background: transparent;
  color: var(--text-secondary);
  transition: all 80ms ease;
  white-space: nowrap;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    border-color: var(--border-strong, #4a4a50);
  }

  &.primary {
    background: var(--accent);
    border-color: transparent;
    color: #141417;
    font-weight: 600;
    box-shadow: 0 1px 8px rgba(129, 140, 248, 0.35);

    &:hover {
      background: #93a1fa;
    }
  }
}
</style>
