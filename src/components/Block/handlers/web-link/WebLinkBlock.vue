<script setup lang="ts">
/**
 * 网页链接块（ADR-0066）的统一渲染层。
 *
 * 四种视图共用同一份 `content`（URL 原文）与 `format.link`：
 * - 链接视图：显示 URL，点击可原地改址（不激活块编辑器，见 handler 的 mousedown 拦截）；
 * - 标题视图：显示网页标题，图标 16px 内联；
 * - 卡片视图：有封面出大图卡，无封面出窄卡（D6）；抓不到元数据时域名兜底 + 明确失败文案；
 * - 预览视图：iframe 内嵌（sandbox 无 allow-same-origin），可拖拽改高并持久化。
 *
 * 切换入口两处：块上悬停浮出的「显示为」面板（Teleport 到 body），以及块入口菜单的同组项。
 */
import { ExternalLink, Link2, RefreshCw } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useWebLinkChipToolbar } from '../../../../composables/useWebLinkChipToolbar'
import { useWebLinkPanelReveal, useWebLinkSettings } from '../../../../composables/useWebLinkSettings'
import { fetchWebLinkMeta } from '../../../../services/web-link-meta'
import { useBlockStore } from '../../../../stores/blocks'
import { assetStorage } from '../../../../utils/asset'
import {
  clampPreviewHeight,
  DEFAULT_PREVIEW_HEIGHT,
  domainOf,
  patchWebLink,
  readWebLink,
  WEB_LINK_ERROR_TEXT,
  webLinkSummary,
  webLinkTitle,
  webLinkUrlOf,
  type WebLinkView,
} from '../../../../utils/web-link'

const props = withDefaults(
  defineProps<{
    blockId: string
    content: string
    showPlaceholder?: boolean
    readonly?: boolean
  }>(),
  { showPlaceholder: false, readonly: false },
)

const blockStore = useBlockStore()
const { autoFetch } = useWebLinkSettings()
const { panelRevealFor } = useWebLinkPanelReveal()
const { show: showToolbar, hide: hideToolbar } = useWebLinkChipToolbar()

const block = computed(() => blockStore.getBlock(props.blockId))
const settings = computed(() => readWebLink(block.value?.format))
const view = computed<WebLinkView>(() => settings.value.view)
const meta = computed(() => settings.value.meta)
const url = computed(() => webLinkUrlOf(block.value?.content) ?? (block.value?.content ?? '').trim())
const domain = computed(() => meta.value?.domain || domainOf(url.value))
const title = computed(() => webLinkTitle(url.value, meta.value))
const summary = computed(() => webLinkSummary(meta.value))
const errorText = computed(() => (meta.value?.error ? WEB_LINK_ERROR_TEXT[meta.value.error] : ''))

/** 从未抓过的才会自动抓；已失败的留给「重试」（D6：不自动循环发请求） */
const needsFetch = computed(() => !!url.value && !meta.value)

// ── 资产 ──
const iconSrc = ref('')
const coverSrc = ref('')
watch(
  () => meta.value?.iconAssetId,
  async (id) => {
    iconSrc.value = id ? await assetStorage.loadUrl(id).catch(() => '') : ''
  },
  { immediate: true },
)
watch(
  () => meta.value?.coverAssetId,
  async (id) => {
    coverSrc.value = id ? await assetStorage.loadUrl(id).catch(() => '') : ''
  },
  { immediate: true },
)

// ── 抓取 ──
/** 同一块可能同时挂两个实例（双 pane），抓取按块去重，避免双发请求 */
const inFlight = new Set<string>()
const fetching = ref(false)

async function runFetch(): Promise<void> {
  const target = url.value
  if (!target || inFlight.has(props.blockId)) return
  inFlight.add(props.blockId)
  fetching.value = true
  try {
    const { meta: fetched, error } = await fetchWebLinkMeta(target)
    const latest = blockStore.getBlock(props.blockId)?.format
    const nextMeta = fetched ?? { domain: domainOf(target), error: error ?? 'network' }
    await blockStore.updateBlockFormat(props.blockId, patchWebLink(latest, { meta: nextMeta }))
  } finally {
    inFlight.delete(props.blockId)
    fetching.value = false
  }
}

onMounted(() => {
  if (needsFetch.value && autoFetch.value) void runFetch()
})

// ── 原地改址（链接/标题视图）──
const editing = ref(false)
const draft = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

async function startEdit(): Promise<void> {
  if (props.readonly) return
  draft.value = url.value
  editing.value = true
  await nextTick()
  inputEl.value?.focus()
  inputEl.value?.select()
}

async function commitEdit(): Promise<void> {
  if (!editing.value) return
  const next = webLinkUrlOf(draft.value)
  editing.value = false
  if (!next || next === url.value) return
  // 改址等于换了一个网页：旧元数据全部作废，重新抓
  await blockStore.updateBlockContent(props.blockId, next)
  await blockStore.updateBlockFormat(props.blockId, patchWebLink(blockStore.getBlock(props.blockId)?.format, { meta: null }))
  if (autoFetch.value) void runFetch()
}

// ── 预览高度（拖拽 + 持久化）──
const previewHeight = ref(settings.value.previewHeight || DEFAULT_PREVIEW_HEIGHT)
watch(
  () => settings.value.previewHeight,
  (h) => {
    if (!dragStart) previewHeight.value = h
  },
)
let dragStart: { y: number; height: number } | null = null

function onResizeDown(e: MouseEvent): void {
  e.preventDefault()
  e.stopPropagation()
  dragStart = { y: e.clientY, height: previewHeight.value }
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeUp)
}

function onResizeMove(e: MouseEvent): void {
  if (!dragStart) return
  previewHeight.value = clampPreviewHeight(dragStart.height + (e.clientY - dragStart.y))
}

function onResizeUp(): void {
  if (!dragStart) return
  dragStart = null
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeUp)
  void blockStore.updateBlockFormat(
    props.blockId,
    patchWebLink(blockStore.getBlock(props.blockId)?.format, { previewHeight: previewHeight.value }),
  )
}

onBeforeUnmount(onResizeUp)

// ── 悬停浮出的「显示为」面板（Teleport 到 body：祖先的 transform 会困住 z-index）──
const rootEl = ref<HTMLElement | null>(null)
const panelPos = ref({ left: 0, top: 0 })
let hideTimer: number | undefined

function measure(): void {
  const rect = rootEl.value?.getBoundingClientRect()
  if (!rect) return
  panelPos.value = { left: Math.round(rect.left), top: Math.round(rect.top) - 8 }
}

function onEnter(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = undefined
  }
  if (!url.value) return
  measure()
  showToolbar({
    blockId: props.blockId,
    kind: 'block',
    url: url.value,
    title: title.value,
    left: panelPos.value.left,
    top: panelPos.value.top + 8,
    view: view.value,
  })
}

function onLeave(): void {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = window.setTimeout(() => hideToolbar(), 200)
}

onBeforeUnmount(() => hideTimer && clearTimeout(hideTimer))

function openExternal(): void {
  // 与正文外链一致：交给系统/浏览器新窗口，不在应用内导航
  if (url.value) window.open(url.value, '_blank', 'noopener,noreferrer')
}

const showCard = computed(() => view.value === 'card')
const showWideCard = computed(() => showCard.value && !!coverSrc.value)

// 刚落地的链接块自动浮出一次悬浮条（ADR-0067 D5：悬浮条是唯一入口）
watch(
  panelRevealFor,
  async (id) => {
    if (id !== props.blockId || !url.value) return
    await nextTick()
    onEnter()
  },
  { immediate: true },
)

// 作为 editorComponent 时的契约（本块无块编辑器，全为 no-op）
defineExpose({
  syncContent() {},
  focus() {
    if (view.value === 'link' || view.value === 'title') void startEdit()
  },
  getText: () => props.content,
  markSaved() {},
  getEditor: () => null,
  cancelDebouncedSave() {},
  focusAtCoords() {},
})
</script>

<template>
  <div
    ref="rootEl"
    class="web-link"
    :class="[`is-${view}`, { 'is-empty': !url }]"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <div
      v-if="!url"
      class="wl-empty"
    >
      粘贴网页链接…
    </div>

    <!-- 链接视图 -->
    <div
      v-else-if="view === 'link'"
      class="wl-link-row"
    >
      <input
        v-if="editing"
        ref="inputEl"
        v-model="draft"
        class="wl-url-input"
        type="text"
        spellcheck="false"
        @keydown.enter.prevent="commitEdit"
        @keydown.esc.prevent="editing = false"
        @blur="commitEdit"
      >
      <a
        v-else
        class="wl-link"
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
        @click.stop
        @dblclick.stop.prevent="startEdit"
      >{{ url }}</a>
    </div>

    <!-- 标题视图 -->
    <div
      v-else-if="view === 'title'"
      class="wl-title-row"
    >
      <input
        v-if="editing"
        ref="inputEl"
        v-model="draft"
        class="wl-url-input"
        type="text"
        spellcheck="false"
        @keydown.enter.prevent="commitEdit"
        @keydown.esc.prevent="editing = false"
        @blur="commitEdit"
      >
      <a
        v-else
        class="wl-title"
        :href="url"
        target="_blank"
        rel="noopener noreferrer"
        :title="url"
        @click.stop
        @dblclick.stop.prevent="startEdit"
      >
        <img
          v-if="iconSrc"
          class="wl-favicon"
          :src="iconSrc"
          alt=""
          draggable="false"
        >
        <Link2
          v-else
          class="wl-favicon-fallback"
          :size="14"
        />
        <span class="wl-title-text">{{ title }}</span>
      </a>
    </div>

    <!-- 卡片视图 -->
    <div
      v-else-if="showCard"
      class="wl-card"
      :class="{ 'is-wide': showWideCard, 'is-error': !!meta?.error }"
      @click.stop="openExternal"
    >
      <img
        v-if="showWideCard"
        class="wl-card-cover"
        :src="coverSrc"
        alt=""
        draggable="false"
      >
      <div class="wl-card-body">
        <div class="wl-card-domain">
          <img
            v-if="iconSrc"
            class="wl-favicon"
            :src="iconSrc"
            alt=""
            draggable="false"
          >
          <Link2
            v-else
            class="wl-favicon-fallback"
            :size="14"
          />
          <span>{{ domain || url }}</span>
        </div>
        <div class="wl-card-title">
          {{ title }}
        </div>
        <div
          v-if="summary"
          class="wl-card-desc"
        >
          {{ summary }}
        </div>
        <div
          v-else-if="meta?.error"
          class="wl-card-error"
        >
          {{ errorText }}
        </div>
      </div>
      <button
        v-if="meta?.error"
        class="wl-retry"
        type="button"
        title="重新获取网页信息"
        @click.stop="runFetch"
      >
        <RefreshCw :size="13" />
      </button>
    </div>

    <!-- 预览视图 -->
    <div
      v-else
      class="wl-preview"
    >
      <iframe
        class="wl-preview-frame"
        :src="url"
        :style="{ height: `${previewHeight}px` }"
        sandbox="allow-scripts allow-popups allow-forms"
        referrerpolicy="no-referrer"
        loading="lazy"
        title="网页预览"
      />
      <!-- 跨源读不到 iframe 内容，白板无法自动识别 ⇒ 常驻出口，不做智能判断 -->
      <div class="wl-preview-bar">
        <span class="wl-preview-domain">{{ domain || url }}</span>
        <span class="wl-preview-hint">若页面未显示，请在新窗口打开</span>
        <button
          class="wl-preview-open"
          type="button"
          @click.stop="openExternal"
        >
          <ExternalLink :size="13" />
          新窗口打开
        </button>
      </div>
      <div
        class="wl-preview-resize"
        @mousedown="onResizeDown"
      />
    </div>
  </div>
</template>

<style scoped>
.web-link {
  position: relative;
  width: 100%;
  font-size: inherit;
  line-height: 1.6;
}

.wl-empty {
  color: var(--text-tertiary);
}

/* ── 链接视图 ── */
.wl-link {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
  cursor: pointer;
}
.wl-link:hover {
  text-decoration-thickness: 2px;
}
.wl-url-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  outline: none;
}

/* ── 标题视图 ── */
.wl-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  max-width: 100%;
}
.wl-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wl-favicon {
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  border-radius: 3px;
  object-fit: contain;
}
.wl-favicon-fallback {
  flex: 0 0 14px;
  color: var(--text-tertiary);
}

/* ── 卡片视图 ── */
.wl-card {
  position: relative;
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-base);
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.wl-card:hover {
  background: var(--bg-hover);
}
.wl-card.is-wide {
  flex-direction: column;
  padding: 0;
  gap: 0;
  overflow: hidden;
}
.wl-card-cover {
  display: block;
  width: 100%;
  max-height: 220px;
  object-fit: cover;
  border-bottom: 1px solid var(--border);
}
.wl-card.is-wide .wl-card-body {
  padding: 10px 12px;
}
.wl-card-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
}
.wl-card-domain {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-tertiary);
  font-size: var(--text-xs, 11px);
  line-height: 1.4;
}
.wl-card-domain span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wl-card-title {
  color: var(--text-primary);
  font-weight: 600;
  font-size: var(--text-md, 14px);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wl-card-desc,
.wl-card-error {
  color: var(--text-secondary);
  font-size: var(--text-sm, 13px);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wl-card-error {
  color: var(--text-tertiary);
}
.wl-retry {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-base);
  color: var(--text-secondary);
  cursor: pointer;
}
.wl-retry:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* ── 预览视图 ── */
.wl-preview {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  overflow: hidden;
  background: var(--bg-base);
}
.wl-preview-frame {
  display: block;
  width: 100%;
  border: none;
  background: var(--bg-base2);
}
.wl-preview-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-top: 1px solid var(--border);
  color: var(--text-tertiary);
  font-size: var(--text-xs, 11px);
}
.wl-preview-domain {
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wl-preview-hint {
  flex: 1 1 auto;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wl-preview-open {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs, 11px);
  cursor: pointer;
}
.wl-preview-open:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
/* 底部拖拽条：只吃掉自己那一带的指针事件，不挡 iframe 内的交互 */
.wl-preview-resize {
  position: absolute;
  left: 50%;
  bottom: 24px;
  width: 56px;
  height: 6px;
  margin-left: -28px;
  border-radius: 3px;
  background: var(--border);
  cursor: ns-resize;
  opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.wl-preview:hover .wl-preview-resize {
  opacity: 1;
}

/* ── 悬停面板（Teleport 到 body，样式不受 scoped 之外的祖先影响）── */
.wl-panel {
  position: fixed;
  z-index: var(--z-popover);
  transform: translateY(-100%);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-base);
  box-shadow: 0 4px 16px rgb(0 0 0 / 18%);
  font-size: var(--text-xs, 11px);
  color: var(--text-secondary);
  white-space: nowrap;
}
.wl-panel-label {
  padding: 0 4px;
  color: var(--text-tertiary);
}
.wl-panel-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-xs, 11px);
  cursor: pointer;
}
.wl-panel-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
.wl-panel-btn.active {
  background: var(--bg-base2);
  color: var(--text-primary);
  font-weight: 600;
}
.wl-panel-sep {
  width: 1px;
  height: 16px;
  margin: 0 3px;
  background: var(--border);
}
.spinning {
  animation: wl-spin 1s linear infinite;
}
@keyframes wl-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
