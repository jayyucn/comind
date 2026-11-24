<script setup lang="ts">
import { computed, type CSSProperties,nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { onLayoutChange } from '../../services/layout-change'

/**
 * 锚点式二级浮层（对齐下拉 / 取色面板共用）。
 *
 * 为什么不用 `BasePopover` 嵌套：内层 overlay 的层级比外层面板低（`--z-popover` vs `+1`），
 * 而且两份 document 级 Esc 监听会让按一次 Esc 同时关掉两级。所以二级一律 Teleport 到 body
 * 的独立 fixed 浮层，Esc 在 **window 捕获阶段**截住并 `stopPropagation`，只关自己这一层。
 *
 * 本组件只管「面皮 + 定位 + 生命周期」，内容交给插槽：对齐下拉与取色面板外形差得远，
 * 但「挂在哪个按钮上、什么时候收起」必须同源。
 *
 * 方向：优先挂在锚点**上方**（与选区浮层同向 —— 浮层都在目标上方，二级再往上叠）。
 * 上方放不下才翻到下方，两侧都不行就贴视口边。
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    /** 触发按钮；`null` 时不定位（首帧） */
    anchor: HTMLElement | null
    /** 与锚点的间隙 */
    gap?: number
    /**
     * 归属句柄（写进 `data-table-menu`）：外层浮层判「点二级算不算点外面」时靠它豁免。
     * 与选区浮层同一个属性名、同一个值，一个选择器就能盖住本块的全部浮层。
     */
    menuId?: string
  }>(),
  { gap: 4, menuId: '' },
)

const emit = defineEmits<{
  (e: 'close'): void
}>()

const EDGE = 8

const el = ref<HTMLElement | null>(null)
const anchorRect = ref<DOMRect | null>(null)
const size = ref({ w: 0, h: 0 })

function measure() {
  const node = el.value
  if (!node) return
  size.value = { w: node.offsetWidth, h: node.offsetHeight }
}

/** 宽度/高度要等首帧渲染后才知道；量到真实尺寸立即重算（同在浏览器绘制前完成，看不到跳位） */
const style = computed<CSSProperties>(() => {
  const box = anchorRect.value
  if (!box || typeof window === 'undefined') return { left: '0px', top: '0px', visibility: 'hidden' }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const { w, h } = size.value

  let top = box.top - h - props.gap
  if (h && top < EDGE) {
    const below = box.bottom + props.gap
    top = below + h <= vh - EDGE ? below : Math.max(EDGE, vh - h - EDGE)
  }

  let left = box.left
  if (w && left + w > vw - EDGE) left = Math.max(EDGE, vw - w - EDGE)

  return { left: `${left}px`, top: `${top}px` }
})

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !props.open) return
  e.preventDefault()
  e.stopPropagation()
  emit('close')
}

/**
 * 二级浮层是 fixed 定位、不跟随任何滚动祖先：视口一滚就脱节，
 * 直接收起比追着算更符合预期（触发按钮还在，随时可重开）。
 */
function dismiss() {
  emit('close')
}

let offLayoutChange: (() => void) | null = null

function attach() {
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('scroll', dismiss, true)
  window.addEventListener('resize', dismiss)
  // 折叠侧栏 / 开合右栏 → 外层浮层跟着锚点平移，二级存的是绝对矩形，跟着走要重算锚点；
  // 直接收起更省事，也与 scroll/resize 的口径一致。
  offLayoutChange = onLayoutChange(dismiss)
}

function detach() {
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('scroll', dismiss, true)
  window.removeEventListener('resize', dismiss)
  offLayoutChange?.()
  offLayoutChange = null
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      detach()
      anchorRect.value = null
      return
    }
    anchorRect.value = props.anchor?.getBoundingClientRect() ?? null
    attach()
    await nextTick()
    measure()
  },
  { immediate: true },
)

onBeforeUnmount(detach)
</script>

<template>
  <Teleport to="body">
    <Transition name="floating-submenu-fade">
      <div
        v-if="open"
        ref="el"
        class="floating-submenu"
        :style="style"
        :data-table-menu="menuId || undefined"
        @mousedown.prevent
      >
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 面皮与 BasePopover 同款三层渐变（token 全局，scoped 不影响）；
   z 用 --z-popover-nested（= --z-popover + 20），盖住选区浮层面板（+1）。 */
.floating-submenu {
  position: fixed;
  z-index: var(--z-popover-nested);
  box-sizing: border-box;
  width: max-content;
  background:
    var(--corner-glow) padding-box,
    var(--grad-surface) padding-box,
    var(--grad-border) border-box;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-floating);
}

/* 轻弹层编排（ADR-0053）：base 入 / fast 出 */
.floating-submenu-fade-enter-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}

.floating-submenu-fade-leave-active {
  transition: opacity var(--dur-fast) var(--ease-in), transform var(--dur-fast) var(--ease-in);
}

.floating-submenu-fade-enter-from,
.floating-submenu-fade-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.98);
}
</style>
