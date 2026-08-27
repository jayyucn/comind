<script setup lang="ts">
/**
 * ImageRender - Image Block 的统一渲染层（ADR-0037）
 *
 * 作为 image 类型的 editorComponent 与 renderComponent 共用：
 * Image Block 无编辑态，始终以此组件呈现。
 *
 * 能力：
 * - 解析 content（![alt](asset://id) | ![alt](url)）渲染图片
 * - 对齐（block.format.align）+ 行内尺寸（block.format.width/height）
 * - hover 工具栏：放大查看 / 复制图片 / 裁剪 / 替换 / 删除 / 左中右对齐
 * - 选中（块选区）后显示包围边框 + 四角圆点，可拖拽缩放行内尺寸
 * - 放大查看打开 ImageLightbox（全屏，临时视图变换）
 * - 裁剪：图片上直接出现裁剪框（拖拽移动 / 四角缩放），工具栏换成 取消 / 确认
 */
import { AlignCenter, AlignLeft, AlignRight, Check, Copy, Crop, Fullscreen, SquarePen, Trash, X } from 'lucide-vue-next'
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import type { CrossBlockSelection } from '../../../../composables/useCrossBlockSelection'
import { useIdeasFreeze } from '../../../../composables/useIdeasFreeze'
import { useBlockStore } from '../../../../stores/blocks'
import { useEditorStore } from '../../../../stores/editor'
import { assetStorage } from '../../../../utils/asset'
import { openImageFileDialog } from '../../../../utils/imagePicker'
import ImageLightbox from './ImageLightbox.vue'

const props = withDefaults(
  defineProps<{
    blockId: string
    content: string
    showPlaceholder?: boolean
    showFullPlaceholder?: boolean
    properties?: Record<string, unknown>
    language?: string
    readonly?: boolean
  }>(),
  {
    showPlaceholder: false,
    showFullPlaceholder: false,
    properties: () => ({}),
    language: undefined,
    readonly: false,
  },
)

const blockStore = useBlockStore()
const editorStore = useEditorStore()
const selection = inject<CrossBlockSelection>('crossBlockSelection')

const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/
function parseImage(content: string): { alt: string; url: string } | null {
  const m = content.match(IMAGE_REGEX)
  if (!m) return null
  return { alt: m[1] || '', url: m[2] || '' }
}

const parsed = ref<{ alt: string; url: string } | null>(null)
const imgSrc = ref('')
const imgEl = ref<HTMLImageElement | null>(null)
const hovered = ref(false)
// 隐藏延迟：鼠标离开图片/工具栏后不立即收起，留 200ms 宽限期，
// 彻底消除「图片与浮层之间的死区」——即使光标在穿越间隙的瞬间触发 mouseleave，
// 只要在宽限期内回到块内即可取消隐藏。进入时立即清除计时器并显示。
const TOOLBAR_HIDE_DELAY = 200
let hideTimer: number | undefined
function onEnter() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = undefined
  }
  hovered.value = true
}
function onLeave() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => (hovered.value = false), TOOLBAR_HIDE_DELAY)
}
onBeforeUnmount(() => {
  if (hideTimer) clearTimeout(hideTimer)
})
const lightboxOpen = ref(false)
const cropOpen = ref(false)
const cropRect = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const flashMsg = ref('')

watch(
  () => props.content,
  async (content) => {
    const r = parseImage(content)
    parsed.value = r
    if (!r) {
      imgSrc.value = ''
      return
    }
    if (r.url.startsWith('asset://')) {
      const id = r.url.slice(8)
      try {
        imgSrc.value = await assetStorage.loadUrl(id)
      } catch {
        imgSrc.value = ''
      }
    } else {
      imgSrc.value = r.url
    }
  },
  { immediate: true },
)

// ── 选区 / 冻结 ──
const isSelected = computed(() => selection?.isBlockSelected(props.blockId) ?? false)
const pageId = computed(() => blockStore.getBlock(props.blockId)?.pageId ?? '')
// 冻结态 = 页面真实只读（ideas 非今日）。render 槽位 props.readonly 恒为 true，
// 不能作为冻结依据；D10 需以 useIdeasFreeze 为准。
const { isFrozen } = useIdeasFreeze(pageId)

// ── 对齐 / 尺寸 ──
const align = computed<'left' | 'center' | 'right'>(() => {
  const f = blockStore.getBlock(props.blockId)?.format
  return (f?.align as 'left' | 'center' | 'right') ?? 'left'
})
const displayW = computed(() => blockStore.getBlock(props.blockId)?.format?.width ?? null)
const displayH = computed(() => blockStore.getBlock(props.blockId)?.format?.height ?? null)

const justify = computed(() =>
  align.value === 'center' ? 'center' : align.value === 'right' ? 'flex-end' : 'flex-start',
)
const imgStyle = computed(() => {
  if (displayW.value && displayH.value) {
    return { width: `${displayW.value}px`, height: `${displayH.value}px`, maxWidth: 'none', maxHeight: 'none' }
  }
  return { maxWidth: '100%', maxHeight: '400px', width: 'auto', height: 'auto' }
})

const showToolbar = computed(() => hovered.value || isSelected.value)

// ── 短暂提示 ──
let flashTimer: number | undefined
function flash(msg: string) {
  flashMsg.value = msg
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => (flashMsg.value = ''), 1400)
}
onBeforeUnmount(() => flashTimer && clearTimeout(flashTimer))

// ── 操作 ──
async function copyImage() {
  if (!parsed.value) return
  const url = parsed.value.url
  try {
    if (url.startsWith('asset://')) {
      const id = url.slice(8)
      const asset = await assetStorage.get(id)
      if (!asset) return
      await navigator.clipboard.write([new ClipboardItem({ [asset.mimeType]: asset.blob })])
    } else {
      const blob = await (await fetch(url)).blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })])
    }
    flash('已复制图片')
  } catch {
    flash('复制失败')
  }
}

async function replaceImage() {
  if (isFrozen.value) return
  const file = await openImageFileDialog()
  if (!file) return
  const asset = await assetStorage.save(file)
  await blockStore.updateBlockContent(props.blockId, `![${asset.name}](asset://${asset.id})`)
}

async function deleteImage() {
  if (isFrozen.value) return
  // 删除图片：将 block 转为 bullet 类型的空 block，并把光标插入其中
  await blockStore.updateBlockType(props.blockId, 'bullet')
  await blockStore.updateBlockContent(props.blockId, '')
  editorStore.deactivateBlock()
  editorStore.activateBlock(props.blockId, 1)
}

async function setAlign(a: 'left' | 'center' | 'right') {
  await blockStore.updateBlockFormat(props.blockId, { align: a })
}

function onImageClick() {
  if (isFrozen.value || !pageId.value || !selection) return
  // 幂等选中：未选 → 清空其它选区后选中；已选 → 保持。
  // 单纯 toggle 会与 BlockList 既有「点击区外清空」语义叠加，
  // 改成 clear+add 后无论从哪种状态点击都只选本块，符合 Q8A。
  if (!selection.isBlockSelected(props.blockId)) {
    selection.clearSelection()
    selection.toggleBlock(props.blockId, pageId.value)
  }
}

// ── 行内缩放（D11）──
const RESIZE_MIN = 40
let rs: { corner: string; startX: number; startY: number; startW: number; startH: number; aspect: number } | null = null

function startResize(corner: string, e: MouseEvent) {
  if (isFrozen.value) return
  e.preventDefault()
  e.stopPropagation()
  const img = imgEl.value
  if (!img) return
  const rect = img.getBoundingClientRect()
  rs = {
    corner,
    startX: e.clientX,
    startY: e.clientY,
    startW: rect.width || 1,
    startH: rect.height || 1,
    aspect: rect.width / rect.height || 1,
  }
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeUp)
}

function onResizeMove(e: MouseEvent) {
  if (!rs) return
  const dx = e.clientX - rs.startX
  const dy = e.clientY - rs.startY
  const lock = !e.shiftKey
  let dw = 0
  let dh = 0
  if (rs.corner.includes('e')) dw = dx
  if (rs.corner.includes('w')) dw = -dx
  if (rs.corner.includes('s')) dh = dy
  if (rs.corner.includes('n')) dh = -dy

  let newW = Math.max(RESIZE_MIN, rs.startW + dw)
  let newH = lock ? newW / rs.aspect : Math.max(RESIZE_MIN, rs.startH + dh)
  if (lock && newH < RESIZE_MIN) {
    newH = RESIZE_MIN
    newW = newH * rs.aspect
  }
  blockStore.updateBlockFormat(props.blockId, { width: Math.round(newW), height: Math.round(newH) })
}

function onResizeUp() {
  rs = null
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeUp)
}

onBeforeUnmount(onResizeUp)
onBeforeUnmount(cropUp)

function openLightbox() {
  if (imgSrc.value) lightboxOpen.value = true
}

// ── 行内裁剪 ──
// 裁剪框直接覆盖在图片上（display px，相对 .image-frame 左上角 = 图片左上角）。
// 工具栏在裁剪态切换为 取消 / 确认。
const CROP_MIN = 40
let cropDrag:
  | { mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; startX: number; startY: number; rect: { x: number; y: number; w: number; h: number } }
  | null = null

function cropImage() {
  if (isFrozen.value || !imgSrc.value || !imgEl.value) return
  const w = imgEl.value.clientWidth
  const h = imgEl.value.clientHeight
  if (!w || !h) return
  const cw = Math.round(w * 0.8)
  const ch = Math.round(h * 0.8)
  cropRect.value = { x: Math.round((w - cw) / 2), y: Math.round((h - ch) / 2), w: cw, h: ch }
  cropOpen.value = true
}

function cropStart(mode: 'move' | 'nw' | 'ne' | 'sw' | 'se', e: MouseEvent) {
  if (!cropRect.value || !imgEl.value) return
  e.preventDefault()
  e.stopPropagation()
  cropDrag = { mode, startX: e.clientX, startY: e.clientY, rect: { ...cropRect.value } }
  window.addEventListener('mousemove', cropMove)
  window.addEventListener('mouseup', cropUp)
}

function cropMove(e: MouseEvent) {
  if (!cropDrag || !cropRect.value || !imgEl.value) return
  const dx = e.clientX - cropDrag.startX
  const dy = e.clientY - cropDrag.startY
  const maxW = imgEl.value.clientWidth
  const maxH = imgEl.value.clientHeight
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  if (cropDrag.mode === 'move') {
    cropRect.value = {
      x: clamp(cropDrag.rect.x + dx, 0, maxW - cropDrag.rect.w),
      y: clamp(cropDrag.rect.y + dy, 0, maxH - cropDrag.rect.h),
      w: cropDrag.rect.w,
      h: cropDrag.rect.h,
    }
    return
  }
  const r = cropDrag.rect
  let x = r.x
  let y = r.y
  let w = r.w
  let h = r.h
  const right = r.x + r.w
  const bottom = r.y + r.h
  if (cropDrag.mode.includes('w')) {
    x = clamp(r.x + dx, 0, right - CROP_MIN)
    w = right - x
  } else if (cropDrag.mode.includes('e')) {
    w = clamp(r.w + dx, CROP_MIN, maxW - r.x)
  }
  if (cropDrag.mode.includes('n')) {
    y = clamp(r.y + dy, 0, bottom - CROP_MIN)
    h = bottom - y
  } else if (cropDrag.mode.includes('s')) {
    h = clamp(r.h + dy, CROP_MIN, maxH - r.y)
  }
  cropRect.value = { x, y, w, h }
}

function cropUp() {
  cropDrag = null
  window.removeEventListener('mousemove', cropMove)
  window.removeEventListener('mouseup', cropUp)
}

function cancelCrop() {
  cropOpen.value = false
  cropRect.value = null
}

const cropBoxStyle = computed(() =>
  cropRect.value
    ? { left: `${cropRect.value.x}px`, top: `${cropRect.value.y}px`, width: `${cropRect.value.w}px`, height: `${cropRect.value.h}px` }
    : null,
)

async function confirmCrop() {
  if (!cropRect.value || !imgEl.value) return
  const img = imgEl.value
  const dispW = img.clientWidth
  const dispH = img.clientHeight
  if (!dispW || !dispH) return
  const sx = Math.round((cropRect.value.x * img.naturalWidth) / dispW)
  const sy = Math.round((cropRect.value.y * img.naturalHeight) / dispH)
  const sw = Math.round((cropRect.value.w * img.naturalWidth) / dispW)
  const sh = Math.round((cropRect.value.h * img.naturalHeight) / dispH)
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  try {
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
    if (!blob) {
      flash('裁剪失败')
      return
    }
    const name = `${parsed.value?.alt || 'image'}-cropped`
    const asset = await assetStorage.save(new File([blob], name, { type: 'image/png' }))
    await blockStore.updateBlockContent(props.blockId, `![${asset.name}](asset://${asset.id})`)
    // 清空既有行内尺寸（D11），使裁剪结果按其自身比例自然显示，不被旧 width/height 拉伸
    await blockStore.updateBlockFormat(props.blockId, { width: null, height: null })
    cancelCrop()
    flash('已裁剪')
  } catch {
    // 跨域图片无 CORS 头时 canvas 被污染，toBlob 抛 SecurityError
    flash('裁剪失败：图片受限')
  }
}

// 作为 editorComponent 时，满足 BlockTypeEditorExposed 契约（image 无编辑态，均为 no-op）
defineExpose({
  syncContent() {},
  focus() {},
  getText: () => props.content,
  markSaved() {},
  getEditor: () => null,
  cancelDebouncedSave() {},
  focusAtCoords() {},
})
</script>

<template>
  <div
    class="image-block"
    :class="{ 'is-selected': isSelected, 'is-readonly': isFrozen }"
    :style="{ justifyContent: justify }"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <div class="image-flash" v-if="flashMsg">{{ flashMsg }}</div>

    <div class="image-frame" :class="{ selected: isSelected }" @click.stop="onImageClick">
      <!-- hover / 选中 工具栏：置于 frame 内，使其水平位置始终跟随图片（左/中/右对齐均居中于图片） -->
      <div v-if="cropOpen" class="image-toolbar crop-toolbar" @click.stop>
        <button class="tb-btn" title="取消" @click.stop="cancelCrop"><X :size="14" /></button>
        <button class="tb-btn confirm" title="确认裁剪" @click.stop="confirmCrop"><Check :size="14" /></button>
      </div>
      <div v-else-if="showToolbar && imgSrc" class="image-toolbar" @click.stop>
        <button class="tb-btn" title="放大查看" @click.stop="openLightbox"><Fullscreen :size="14" /></button>
        <button v-if="!isFrozen" class="tb-btn" title="复制图片" @click.stop="copyImage"><Copy :size="14" /></button>
        <button v-if="!isFrozen" class="tb-btn" title="裁剪" @click.stop="cropImage"><Crop :size="14" /></button>
        <button v-if="!isFrozen" class="tb-btn" title="替换图片" @click.stop="replaceImage"><SquarePen :size="14" /></button>
        <button v-if="!isFrozen" class="tb-btn danger" title="删除图片" @click.stop="deleteImage"><Trash :size="14" /></button>
        <span class="tb-sep"></span>
        <button class="tb-btn align" :class="{ active: align === 'left' }" title="左对齐" @click.stop="setAlign('left')">
          <AlignLeft :size="14" />
        </button>
        <button class="tb-btn align" :class="{ active: align === 'center' }" title="居中对齐" @click.stop="setAlign('center')">
          <AlignCenter :size="14" />
        </button>
        <button class="tb-btn align" :class="{ active: align === 'right' }" title="右对齐" @click.stop="setAlign('right')">
          <AlignRight :size="14" />
        </button>
      </div>

      <img
        v-if="imgSrc"
        ref="imgEl"
        class="image-img"
        :src="imgSrc"
        :alt="parsed?.alt ?? ''"
        :style="imgStyle"
        draggable="false"
      />
      <div v-else class="image-empty">
        <div class="image-empty-text">{{ parsed ? '图片加载失败' : '图片已清空' }}</div>
        <button v-if="!isFrozen" class="image-empty-btn" @click.stop="replaceImage">替换图片</button>
      </div>

      <!-- 行内裁剪框：直接覆盖在图片上（裁剪态） -->
      <div v-if="cropOpen && cropRect" class="crop-layer" @mousedown.stop="cropStart('move', $event)" @click.stop>
        <div class="crop-box" :style="cropBoxStyle" @mousedown.stop>
          <span class="crop-handle nw" @mousedown.stop="cropStart('nw', $event)"></span>
          <span class="crop-handle ne" @mousedown.stop="cropStart('ne', $event)"></span>
          <span class="crop-handle sw" @mousedown.stop="cropStart('sw', $event)"></span>
          <span class="crop-handle se" @mousedown.stop="cropStart('se', $event)"></span>
        </div>
      </div>

      <!-- 选中态：四角圆点手柄 -->
      <template v-if="isSelected && !isFrozen && !cropOpen">
        <span class="resize-handle nw" @mousedown.stop.prevent="startResize('nw', $event)" @click.stop></span>
        <span class="resize-handle ne" @mousedown.stop.prevent="startResize('ne', $event)" @click.stop></span>
        <span class="resize-handle sw" @mousedown.stop.prevent="startResize('sw', $event)" @click.stop></span>
        <span class="resize-handle se" @mousedown.stop.prevent="startResize('se', $event)" @click.stop></span>
      </template>
    </div>

    <ImageLightbox v-if="lightboxOpen" :src="imgSrc" :alt="parsed?.alt" @close="lightboxOpen = false" />
  </div>
</template>

<style scoped>
.image-block {
  position: relative;
  width: 100%;
  display: flex;
}

.image-frame {
  position: relative;
  display: inline-block;
  max-width: 100%;
  border-radius: var(--radius-sm, 6px);
  line-height: 0;
}

.image-img {
  display: block;
  border-radius: var(--radius-sm, 6px);
  cursor: pointer;
}

.image-frame.selected {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.image-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 160px;
  padding: 20px;
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-base2);
  color: var(--text-secondary);
  line-height: 1.4;
}
.image-empty-btn {
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
}
.image-empty-btn:hover {
  background: var(--bg-hover);
}

/* ── 工具栏 ── */
.image-toolbar {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 4px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  z-index: var(--z-popover);
}
/* 透明桥接：填补工具栏与图片之间的 6px 间隙，避免光标从图片移向菜单的瞬间
   经过死区触发 .image-block 的 mouseleave 令菜单消失。::before 属本组件子树，
   光标经过间隙仍算「悬停」，菜单不会被移除。 */
.image-toolbar::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: -6px;
  height: 6px;
}
.tb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 5px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.12s ease;
}
.tb-btn:hover {
  background: var(--bg-hover);
}
.tb-btn.active {
  background: var(--accent-bg, var(--bg-hover));
  color: var(--accent);
}
.tb-btn.danger:hover {
  background: var(--error);
  color: #fff;
}
.tb-btn.confirm {
  background: var(--accent-bg, var(--bg-hover));
  color: var(--accent);
}

/* ── 行内裁剪框 ── */
.crop-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: move;
  z-index: 1;
}
.crop-box {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid var(--accent);
  /* 框外区域变暗：巨大 box-shadow 被 .crop-layer 的 overflow:hidden 裁切在图片范围内 */
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.5);
  cursor: move;
}
.crop-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--bg-base);
  border: 2px solid var(--accent);
  border-radius: 50%;
}
.crop-handle.nw { top: -6px; left: -6px; cursor: nwse-resize; }
.crop-handle.ne { top: -6px; right: -6px; cursor: nesw-resize; }
.crop-handle.sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
.crop-handle.se { bottom: -6px; right: -6px; cursor: nwse-resize; }
.tb-sep {
  width: 1px;
  height: 18px;
  margin: 0 3px;
  background: var(--border);
}

.image-flash {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 38px;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--bg-base2);
  border: 1px solid var(--border);
  color: var(--text-primary);
  font-size: var(--text-xs, 11px);
  white-space: nowrap;
  z-index: var(--z-popover);
  pointer-events: none;
}

/* ── 缩放手柄 ── */
.resize-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--bg-base);
  border: 2px solid var(--accent);
  border-radius: 50%;
  z-index: var(--z-popover);
}
.resize-handle.nw { top: -6px; left: -6px; cursor: nwse-resize; }
.resize-handle.ne { top: -6px; right: -6px; cursor: nesw-resize; }
.resize-handle.sw { bottom: -6px; left: -6px; cursor: nesw-resize; }
.resize-handle.se { bottom: -6px; right: -6px; cursor: nwse-resize; }
</style>
