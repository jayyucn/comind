<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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

const panelEl = ref<HTMLElement | null>(null)
const panelW = ref(0)
const panelH = ref(0)
const EDGE_MARGIN = 8

let resizeObserver: ResizeObserver | null = null

function measure() {
  const el = panelEl.value
  if (!el) return
  panelW.value = el.offsetWidth
  panelH.value = el.offsetHeight
}

function disconnectRO() {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
}

// 内容异步加载（如通知列表）会改变弹层实际尺寸。仅按初次展开的尺寸收边，
// 内容变宽后会溢出视口被裁切。用 ResizeObserver 持续同步测量，保证收边始终生效。
function observe() {
  const el = panelEl.value
  if (!el) return
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    disconnectRO()
    resizeObserver = new ResizeObserver(() => measure())
    resizeObserver.observe(el)
  }
}

// 显示或锚点变化后（重新）测量并挂接 ResizeObserver，用于视口收边（避免超出右侧/底部）
watch(
  () => [props.visible, props.position],
  () => {
    if (props.visible) nextTick(observe)
    else disconnectRO()
  },
  { deep: true, immediate: true },
)

/** 仅当调用方提供锚点时，才以内联 fixed 定位面板；否则交回 CSS（如相对包裹元素定位）。
 *  同时按测量到的弹层尺寸收边，确保完整落在视口内（默认左/上对齐，溢出时反向贴边）。 */
const panelStyle = computed(() => {
  if (!props.position) return undefined
  const vw = typeof window !== 'undefined' ? window.innerWidth : Number.MAX_SAFE_INTEGER
  const vh = typeof window !== 'undefined' ? window.innerHeight : Number.MAX_SAFE_INTEGER
  const rawX = props.position.x
  const rawY = props.position.y
  // 收边：弹层右/下溢出视口时反向贴边，至少留 EDGE_MARGIN
  const x = panelW.value
    ? Math.min(rawX, Math.max(EDGE_MARGIN, vw - panelW.value - EDGE_MARGIN))
    : rawX
  const y = panelH.value
    ? Math.min(rawY, Math.max(EDGE_MARGIN, vh - panelH.value - EDGE_MARGIN))
    : rawY
  return { left: `${x}px`, top: `${y}px` }
})

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
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeyDown, true)
  disconnectRO()
})
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
          ref="panelEl"
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
  z-index: var(--z-popover);
}

.base-popover {
  position: fixed;
  z-index: calc(var(--z-popover) + 1);
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
