<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount } from 'vue'

/** 通用弹层原语（ADR-0009 D8）。
 *
 * 封装现有多个弹层重复的样板：Teleport to body + fixed overlay（点击空白关闭）
 * + 面板 @click.stop（阻止冒泡关闭）+ Escape 关闭 + position{x,y} 定位 + fade 过渡。
 * 所有新弹层（筛选/排序/分组芯片、字段选择菜单等）包一层它，不再各自重复。
 *
 * 样式复用项目令牌：--bg-base / --border / --radius-md / --shadow-modal / --transition-base。
 */
const props = withDefaults(
  defineProps<{
    /** 是否显示弹层。 */
    visible: boolean
    /** 面板锚点（来自触发元素 getBoundingClientRect 的 x/y）。 */
    position?: { x: number; y: number }
    /** 点击 overlay 空白是否关闭，默认 true。 */
    closeOnOverlay?: boolean
  }>(),
  {
    closeOnOverlay: true,
  },
)

const emit = defineEmits<{
  /** 用户通过 overlay 点击 / Escape 请求关闭。 */
  close: []
}>()

/** 仅当调用方提供锚点时，才以内联 fixed 定位面板；否则交回 CSS（如相对包裹元素定位）。 */
const panelStyle = computed(() =>
  props.position
    ? { left: `${props.position.x}px`, top: `${props.position.y}px` }
    : undefined,
)

function onOverlayClick() {
  if (props.closeOnOverlay) emit('close')
}

function onKeyDown(e: KeyboardEvent) {
  if (props.visible && e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

onMounted(() => document.addEventListener('keydown', onKeyDown, true))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeyDown, true))
</script>

<template>
  <Teleport to="body">
    <Transition name="base-popover-fade">
      <div
        v-if="visible"
        class="base-popover-overlay"
        data-testid="base-popover-overlay"
        @click.self="onOverlayClick"
      >
        <div
          class="base-popover"
          role="dialog"
          data-testid="base-popover"
          :style="panelStyle"
          @click.stop
        >
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.base-popover-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
}

.base-popover {
  position: fixed;
  z-index: 1101;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-modal);
  font-family: inherit;
  max-width: 90vw;
  max-height: 80vh;
  overflow: auto;
}

.base-popover-fade-enter-active,
.base-popover-fade-leave-active {
  transition: opacity var(--transition-base), transform var(--transition-base);
}

.base-popover-fade-enter-from,
.base-popover-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
