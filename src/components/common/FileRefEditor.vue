<script setup lang="ts">
/**
 * 附件字段编辑/渲染载体（issue T9）。
 *
 * 职责（file 类型字段的值区，BlockFieldZone / FieldValueEditor 共用）：
 * - 无值：28px 基线的「上传附件」按钮（虚线 ghost 风格），点击唤起文件选择；
 * - 有值：图片 mime 渲染缩略图（object-fit: cover），其余渲染附件 chip
 *   （Paperclip 图标 + 文件名）；点击 chip/缩略图打开最小 lightbox 预览；
 *   hover 出 × 清除（emit undefined = 未填 = 删行契约，与 date/number 同口径）。
 *
 * 存储（AC4）：复用既有资产通道 `assetStorage`（src/utils/asset.ts）——
 * Tauri 下走 save_asset_file 命令写入 workspace/assets/（与 sqlite/、markdown/
 * 并列 + assets.json 登记），Web/wasm 下写 Dexie（comind-assets 库）。
 * 落库的是引用路径 `asset://<id>`，markdown 导出导入已有 asset:// 联动。
 * Web 环境预览/缩略图用会话内 blob URL（IndexedDB 资产，无全局文件路径）。
 *
 * 悬空降级：挂载/值变化时经 assetStorage.get 探测资产存在性（两端实现都以
 * 「Asset not found」类错误表达缺失），失败 → chip 弱化样式仍显示文件名。
 */
import { Paperclip, X } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import type { FileRefValue } from '../../types/field-definition'
import { assetStorage } from '../../utils/asset'
import { assetIdFromPath, fileRefDisplayKind } from '../../utils/file-ref'

const props = defineProps<{
  modelValue?: FileRefValue | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: FileRefValue | undefined]
}>()

const picking = ref(false)
const probing = ref(false)
/** 资产缺失（悬空引用）：chip 弱化样式降级 */
const missing = ref(false)
/** 会话内 blob URL（缩略图与预览共用；Web 与 Tauri 都走 loadUrl） */
const objectUrl = ref<string | null>(null)

const value = computed(() => props.modelValue ?? null)
const displayKind = computed(() => fileRefDisplayKind(value.value?.mime))

const fileInput = ref<HTMLInputElement | null>(null)

function pick() {
  fileInput.value?.click()
}

async function onPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (!file) return
  picking.value = true
  try {
    const asset = await assetStorage.save(file)
    emit('update:modelValue', {
      path: `asset://${asset.id}`,
      name: asset.name,
      mime: asset.mimeType || undefined,
    })
  } finally {
    picking.value = false
  }
}

function clear(event: MouseEvent) {
  event.stopPropagation()
  emit('update:modelValue', undefined)
}

/** 探测资产存在性 + 预取图片缩略图 URL；悬空 → missing（chip 弱化）。 */
async function probe() {
  missing.value = false
  objectUrl.value = null
  const id = value.value ? assetIdFromPath(value.value.path) : null
  if (!id) {
    // 非 asset:// 形态（外部写入等）：无法探测，按悬空弱化处理
    if (value.value) missing.value = true
    return
  }
  probing.value = true
  try {
    const asset = await assetStorage.get(id)
    if (!asset) {
      missing.value = true
      return
    }
    if (fileRefDisplayKind(asset.mimeType) === 'image') {
      objectUrl.value = await assetStorage.loadUrl(id)
    }
  } catch {
    missing.value = true
  } finally {
    probing.value = false
  }
}

onMounted(probe)
watch(() => value.value?.path, probe)

// ── 预览（最小 lightbox：Teleport + overlay，ESC / 点遮罩 / 关闭按钮退出）──

const previewOpen = ref(false)
const previewUrl = ref<string | null>(null)

async function openPreview() {
  const v = value.value
  if (!v) return
  const id = assetIdFromPath(v.path)
  if (!id) return
  try {
    previewUrl.value = objectUrl.value ?? (await assetStorage.loadUrl(id))
    previewOpen.value = true
  } catch {
    missing.value = true
  }
}

function closePreview() {
  previewOpen.value = false
  previewUrl.value = null
}
</script>

<template>
  <span
    class="file-ref"
    :data-testid="picking ? 'file-ref-picking' : undefined"
  >
    <!-- 无值：虚线 ghost 按钮（28px 基线），点击即上传 -->
    <button
      v-if="!value"
      type="button"
      class="file-ref-add"
      :disabled="picking"
      @click.stop="pick"
    >
      {{ picking ? '上传中…' : '上传附件' }}
    </button>
    <input
      ref="fileInput"
      type="file"
      class="file-ref-input"
      @change="onPicked"
    >

    <!-- 有值：图片缩略图 / 附件 chip；悬空弱化。
         （T2 代理最小修复：input 元素隔断了 v-if/v-else 相邻性导致整文件无法编译，
         改为等价 v-if="value"，未改动其余任何标记。） -->
    <span
      v-if="value"
      class="file-ref-chip"
      :class="{
        'file-ref-chip--image': displayKind === 'image' && objectUrl,
        'file-ref-chip--missing': missing,
      }"
      :title="missing ? `${value.name}（文件缺失）` : value.name"
      role="button"
      tabindex="0"
      @click.stop="openPreview"
      @keydown.enter.stop="openPreview"
    >
      <img
        v-if="displayKind === 'image' && objectUrl"
        :src="objectUrl"
        class="file-ref-thumb"
        :alt="value.name"
      >
      <Paperclip
        v-else
        :size="13"
        class="file-ref-icon"
      />
      <span class="file-ref-name">{{ value.name }}</span>
      <button
        type="button"
        class="file-ref-clear"
        title="移除附件"
        aria-label="移除附件"
        @click.stop="clear"
      >
        <X :size="12" />
      </button>
    </span>

    <!-- lightbox 预览：图片直接展示，其余（如 PDF）iframe 内嵌 -->
    <Teleport to="body">
      <div
        v-if="previewOpen"
        class="file-ref-lightbox"
        @click.self="closePreview"
        @keydown.esc="closePreview"
      >
        <div class="file-ref-lightbox-body">
          <img
            v-if="displayKind === 'image'"
            :src="previewUrl ?? ''"
            :alt="value?.name"
          >
          <iframe
            v-else
            :src="previewUrl ?? ''"
            :title="value?.name"
          />
          <span
            v-if="displayKind !== 'image'"
            class="file-ref-lightbox-hint"
          >若内嵌预览空白，可右键复制链接在新窗口打开（{{ value?.name }}）</span>
        </div>
        <button
          type="button"
          class="file-ref-lightbox-close"
          aria-label="关闭预览"
          @click="closePreview"
        >
          <X :size="16" />
        </button>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
/* 无值上传按钮：28px 高度基线（与 DatePicker / NumberInput / EnumSelect 对齐） */
.file-ref-add {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  background: transparent;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}

.file-ref-add:hover {
  background: var(--surface-subtle);
  border-color: var(--border-strong);
}

.file-ref-add:disabled {
  opacity: 0.6;
  cursor: default;
}

.file-ref-input {
  display: none;
}

/* 有值 chip：描边幽灵款（与 block-field-zone-chip 同族） */
.file-ref-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: 0 7px;
  font-size: var(--text-sm);
  line-height: calc(var(--leading-normal) * var(--text-sm));
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.file-ref-chip:hover {
  background: var(--surface-subtle);
  border-color: var(--border-strong);
}

.file-ref-chip--missing {
  border-style: dashed;
  color: var(--text-tertiary);
}

.file-ref-chip--missing .file-ref-name {
  color: var(--text-tertiary);
}

.file-ref-icon {
  flex: none;
  color: var(--text-tertiary);
}

.file-ref-name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-primary);
}

.file-ref-clear {
  flex: none;
  display: inline-flex;
  align-items: center;
  background: none;
  border: none;
  padding: 0 2px;
  color: var(--text-tertiary);
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition:
    opacity var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    visibility var(--dur-fast) var(--ease-out);

  .file-ref-chip:hover &,
  .file-ref-chip:focus-within & {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
  }
}

.file-ref-clear:hover {
  color: var(--text-primary);
}

/* 图片缩略图：小尺寸、object-fit cover 裁切（chip 内联形态） */
.file-ref-thumb {
  width: 20px;
  height: 20px;
  object-fit: cover;
  border-radius: 3px;
  flex: none;
  display: block;
}

/* ── lightbox（Teleport 到 body；z-index 只用 token） ── */
.file-ref-lightbox {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
}

.file-ref-lightbox-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 90vw;
  max-height: 90vh;
}

.file-ref-lightbox-body img {
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
}

.file-ref-lightbox-body iframe {
  width: min(80vw, 900px);
  height: 85vh;
  border: none;
  background: var(--bg-base);
  border-radius: var(--radius-sm);
}

.file-ref-lightbox-hint {
  color: rgba(255, 255, 255, 0.75);
  font-size: var(--text-sm);
}

.file-ref-lightbox-close {
  position: fixed;
  top: 16px;
  right: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
}

.file-ref-lightbox-close:hover {
  background: rgba(255, 255, 255, 0.15);
  color: var(--color-white);
}
</style>
