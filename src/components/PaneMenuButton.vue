<script setup lang="ts">
import { Columns2, Rows2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'

import { type PaneLayoutDirection, usePanesStore } from '../stores/panes'
import BasePopover from './common/BasePopover.vue'
import { Icon } from './Icons'

const props = defineProps<{ paneId: string }>()

const panesStore = usePanesStore()
const isOpen = ref(false)
const triggerRef = ref<HTMLButtonElement | null>(null)

const pane = computed(() => panesStore.panes.find(p => p.id === props.paneId) ?? null)
const canCloseOtherTabs = computed(() => (pane.value?.tabs.length ?? 0) > 1)
const canClosePane = computed(() => panesStore.panes.length > 1)

function toggle() {
  isOpen.value = !isOpen.value
}
function close() {
  isOpen.value = false
}
function handleCloseOther() {
  panesStore.closeOtherTabs(props.paneId)
  close()
}
function handleClosePane() {
  panesStore.closePane(props.paneId)
  close()
}
function handleSplit(direction: PaneLayoutDirection) {
  panesStore.splitView(direction, props.paneId)
  close()
}
</script>

<template>
  <div class="pane-menu-button">
    <button
      ref="triggerRef"
      class="pane-menu-trigger"
      title="本栏操作"
      @mousedown.stop
      @click.stop="toggle"
    >
      <Icon
        name="icon-menu"
        :size="16"
      />
    </button>

    <BasePopover
      :visible="isOpen"
      :anchor-el="() => triggerRef"
      @close="close"
    >
      <div class="pane-menu-dropdown">
        <button
          class="menu-item"
          :disabled="!canCloseOtherTabs"
          @click="handleCloseOther"
        >
          <Icon
            name="icon-close"
            :size="16"
          />
          <span>关闭其他标签</span>
        </button>
        <button
          class="menu-item"
          :disabled="!canClosePane"
          @click="handleClosePane"
        >
          <Icon
            name="icon-square"
            :size="16"
          />
          <span>关闭本栏</span>
        </button>

        <div class="menu-divider" />

        <button
          class="menu-item"
          @click="handleSplit('horizontal')"
        >
          <Columns2
            :size="16"
            :stroke-width="1.75"
          />
          <span>左右分屏</span>
        </button>
        <button
          class="menu-item"
          @click="handleSplit('vertical')"
        >
          <Rows2
            :size="16"
            :stroke-width="1.75"
          />
          <span>上下分屏</span>
        </button>
      </div>
    </BasePopover>
  </div>
</template>

<style lang="scss" scoped>
/* 标签条整条 pointer-events:none（透传窗口拖拽），按钮需显式恢复可点。 */
.pane-menu-button {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  pointer-events: auto;
}

.pane-menu-trigger {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: calc(var(--radius-sm, 6px) - 2px);
  pointer-events: auto;

  &:hover {
    background: var(--bg-hover2);
    color: var(--text-primary);
  }
}

/* 面板外观由 BasePopover 提供（Teleport 到 body，--z-popover 参与全局排序）。 */
.pane-menu-dropdown {
  min-width: 180px;
  padding: 4px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--color-ink);
  font-family: inherit;
  text-align: left;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: var(--color-hover);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.menu-divider {
  height: 1px;
  background: var(--color-border);
  margin: 4px 8px;
}
</style>
