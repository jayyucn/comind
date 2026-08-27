<script setup lang="ts">
/**
 * ImageLightbox - 全屏放大查看层（ADR-0037 D5）
 *
 * - 初始 fit-to-screen（scale 由容器与图片尺寸计算）
 * - 滚轮缩放（10% ~ 500%）
 * - 拖拽平移
 * - 双击复位
 * - 底部按钮 − / 1:1 / + / 关闭
 * - 点击遮罩 / Esc 关闭
 *
 * 仅视图变换，不持久化。
 */
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'

const props = defineProps<{
  src: string
  alt?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const MIN_SCALE = 0.1
const MAX_SCALE = 5

const stage = ref<HTMLElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const fitScale = ref(1)

function computeFit() {
  const s = stage.value
  const img = imgEl.value
  if (!s || !img) return
  const sw = s.clientWidth - 80
  const sh = s.clientHeight - 140
  const iw = img.naturalWidth || img.clientWidth
  const ih = img.naturalHeight || img.clientHeight
  if (!iw || !ih) return
  fitScale.value = Math.min(1, sw / iw, sh / ih)
  resetView()
}

function resetView() {
  scale.value = fitScale.value
  tx.value = 0
  ty.value = 0
}

function clampScale(v: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  const delta = -e.deltaY * 0.0015
  scale.value = clampScale(scale.value * (1 + delta))
}

function zoomBy(factor: number) {
  scale.value = clampScale(scale.value * factor)
}

// ── 拖拽平移 ──
let dragging = false
let startX = 0
let startY = 0
let startTx = 0
let startTy = 0

function onImgMouseDown(e: MouseEvent) {
  dragging = true
  startX = e.clientX
  startY = e.clientY
  startTx = tx.value
  startTy = ty.value
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}
function onMouseMove(e: MouseEvent) {
  if (!dragging) return
  tx.value = startTx + (e.clientX - startX)
  ty.value = startTy + (e.clientY - startY)
}
function onMouseUp() {
  dragging = false
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

function onImgDoubleClick() {
  resetView()
}

function onStageClick(e: MouseEvent) {
  // 点击遮罩（非图片/非控件）关闭
  if (e.target === stage.value) emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

const transform = computed(() => `translate(${tx.value}px, ${ty.value}px) scale(${scale.value})`)

onMounted(() => {
  window.addEventListener('keydown', onKey)
  // 图片 load 后再算 fit
  if (imgEl.value?.complete) computeFit()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  onMouseUp()
})
</script>

<template>
  <Teleport to="body">
    <div
      class="image-lightbox"
      ref="stage"
      @click="onStageClick"
      @wheel="onWheel"
    >
      <img
        ref="imgEl"
        class="image-lightbox-img"
        :src="src"
        :alt="alt ?? ''"
        :style="{ transform }"
        @load="computeFit"
        @mousedown.stop.prevent="onImgMouseDown"
        @dblclick.stop="onImgDoubleClick"
        draggable="false"
      />

      <div class="image-lightbox-bar" @click.stop>
        <button type="button" class="lb-btn" title="缩小" @click="zoomBy(1 / 1.2)">−</button>
        <button type="button" class="lb-btn" title="原始尺寸" @click="resetView">1:1</button>
        <button type="button" class="lb-btn" title="放大" @click="zoomBy(1.2)">+</button>
        <span class="lb-zoom">{{ Math.round(scale * 100) }}%</span>
        <button type="button" class="lb-btn lb-close" title="关闭 (Esc)" @click="emit('close')">✕</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.image-lightbox {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  background: rgba(0, 0, 0, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  overflow: hidden;
}

.image-lightbox-img {
  max-width: 92vw;
  max-height: 88vh;
  transform-origin: center center;
  cursor: grab;
  border-radius: 4px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
}
.image-lightbox-img:active {
  cursor: grabbing;
}

.image-lightbox-bar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: rgba(28, 25, 23, 0.78);
  border-radius: 10px;
  backdrop-filter: blur(6px);
}

.lb-btn {
  min-width: 30px;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.lb-btn:hover {
  background: rgba(255, 255, 255, 0.24);
}
.lb-close {
  background: rgba(255, 80, 80, 0.5);
}
.lb-close:hover {
  background: rgba(255, 80, 80, 0.75);
}

.lb-zoom {
  color: #fff;
  font-size: 12px;
  min-width: 44px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
