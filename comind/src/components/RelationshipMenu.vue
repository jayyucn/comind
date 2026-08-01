<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, nextTick, ref, computed } from 'vue'
import type { useRelationshipMenu } from '../composables/useRelationshipMenu'
import { attachKeyboardListener, detachKeyboardListener } from '../composables/useRelationshipMenu'
import { useModalKeyboardRef } from '../composables/useModalKeyboard'

const props = defineProps<{
  menu: ReturnType<typeof useRelationshipMenu>
}>()

const { state, items, select, close } = props.menu

// 模态栈：与 Extension 的 menuIsOpen 协同（Extension 还会拦截 ProseMirror 默认行为）
useModalKeyboardRef('relationship-menu', computed(() => state.value.visible))

onMounted(() => {
  // 单例 attach，避免多组件实例叠加监听器
  attachKeyboardListener(props.menu)
})

onBeforeUnmount(() => {
  detachKeyboardListener()
})

// 打开时滚动到当前选中组
const listRef = ref<HTMLElement | null>(null)
async function scrollSelectedIntoView() {
  await nextTick()
  if (!listRef.value) return
  const rows = listRef.value.querySelectorAll('.rel-menu-item')
  const selected = rows[state.value.selectedGroupIndex] as HTMLElement | undefined
  // jsdom 等测试环境没有 scrollIntoView
  if (selected && typeof selected.scrollIntoView === 'function') {
    selected.scrollIntoView({ block: 'nearest' })
  }
}

watch(() => state.value.visible, (visible) => {
  if (visible) scrollSelectedIntoView()
})
watch(() => state.value.selectedGroupIndex, () => {
  if (state.value.visible) scrollSelectedIntoView()
})

function onItemMouseDown(event: MouseEvent, index: number) {
  // 防止编辑器失焦
  event.preventDefault()
  props.menu.setSelectedGroupIndex(index)
  select()
}

function onDirectionMouseDown(event: MouseEvent, index: number, direction: 'forward' | 'inverse') {
  // 防止编辑器失焦
  event.preventDefault()
  props.menu.setSelectedGroupIndex(index)
  props.menu.setDirection(direction)
  select()
}

// 兼容旧 API：select / close 暴露给外部按需触发
defineExpose({ select, close })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.visible"
      class="rel-menu-overlay"
      @click.self="close"
      @contextmenu.prevent
    >
      <div
        class="rel-menu"
        :style="{ left: (state.position?.x ?? 0) + 'px', top: (state.position?.y ?? 0) + 'px' }"
        @mousedown.stop
      >
        <ul
          v-if="items.length > 0"
          ref="listRef"
          class="rel-menu-list"
        >
          <li
            v-for="(item, index) in items"
            :key="item.type"
            class="rel-menu-item"
            :class="{
              selected: index === state.selectedGroupIndex,
              'has-inverse': item.inverse !== null
            }"
            :data-type="item.type"
            :style="{ '--rel-color': item.color }"
          >
            <template v-if="item.inverse">
              <button
                type="button"
                class="rel-menu-direction rel-menu-direction-forward"
                :class="{ active: index === state.selectedGroupIndex && state.selectedDirection === 'forward' }"
                :data-direction="item.type"
                @mousedown="onDirectionMouseDown($event, index, 'forward')"
              >
                <span class="rel-menu-type">{{ item.label }}</span>
              </button>
              <span
                class="rel-menu-sep"
                aria-hidden="true"
              >↔</span>
              <button
                type="button"
                class="rel-menu-direction rel-menu-direction-inverse"
                :class="{ active: index === state.selectedGroupIndex && state.selectedDirection === 'inverse' }"
                :data-direction="item.inverse"
                @mousedown="onDirectionMouseDown($event, index, 'inverse')"
              >
                <span class="rel-menu-type">{{ item.inverseLabel }}</span>
              </button>
            </template>
            <button
              v-else
              type="button"
              class="rel-menu-direction rel-menu-direction-forward rel-menu-direction-single"
              :class="{ active: index === state.selectedGroupIndex }"
              :data-direction="item.type"
              @mousedown="onItemMouseDown($event, index)"
            >
              <span class="rel-menu-type">{{ item.label }}</span>
            </button>
          </li>
        </ul>
        <div
          v-else
          class="rel-menu-empty"
        >
          No matches
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.rel-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.rel-menu {
  position: absolute;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow-elevation-2);
  min-width: 220px;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px 0;
}

.rel-menu-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.rel-menu-item {
  display: flex;
  align-items: stretch;
  font-size: var(--text-sm);
  border-left: 3px solid transparent;
}

.rel-menu-item.selected {
  border-left-color: var(--rel-color);
}

.rel-menu-direction {
  flex: 1;
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
  min-width: 0;
}

.rel-menu-direction-forward {
  justify-content: flex-start;
}

.rel-menu-direction-inverse {
  justify-content: flex-end;
}

.rel-menu-direction-single {
  width: 100%;
}

.rel-menu-direction:hover,
.rel-menu-direction.active {
  background: var(--bg-hover);
}

.rel-menu-sep {
  display: flex;
  align-items: center;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  padding: 0 2px;
  user-select: none;
}

.rel-menu-type {
  font-weight: var(--font-medium);
  color: var(--rel-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rel-menu-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--text-sm);
}
</style>
