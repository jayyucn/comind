<script setup lang="ts">
/**
 * 网页链接悬浮条（ADR-0067 D2/D4）：紧贴 chip 或卡片块浮出。
 *
 * 菜单按宿主分集：
 * - chip（text 块里的 `[标题](url)`）：编辑链接 | 移除链接 | 视图切换 | 复制原始链接；
 * - block（卡片/预览的 web-link 块）：视图切换 | 复制原始链接。
 *
 * 视图切换在本条内展开（不套第二层浮层），避免二级 Teleport 的定位抖动。
 */
import { Check, ChevronDown, Copy, Link2Off, PencilLine } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'

import { useWebLinkChipToolbar } from '../../../../composables/useWebLinkChipToolbar'
import {
  copyWebLinkUrl,
  editChipLink,
  removeChipLink,
  switchWebLinkView,
} from '../../../../services/web-link-actions'
import {
  flushActiveChipBlock,
  replaceActiveChip,
} from '../../../../services/web-link-editor-actions'
import { useBlockStore } from '../../../../stores/blocks'
import {
  WEB_LINK_VIEW_LABELS,
  WEB_LINK_VIEWS,
  type WebLinkView,
} from '../../../../utils/web-link'
import { findWebLinkChips, webLinkChipMarkdown } from '../../../../utils/web-link-chip'

const { target, hide, cancelHide, scheduleHide, viewMenuOpen } = useWebLinkChipToolbar()

const editing = ref(false)
const draftTitle = ref('')
const draftUrl = ref('')

watch(target, (t) => {
  editing.value = false
  draftTitle.value = t?.title ?? ''
  draftUrl.value = t?.url ?? ''
})

const isChip = computed(() => target.value?.kind === 'chip')

/** chip 的「链接视图/标题视图」由显示文字决定：文字=URL 即链接视图，否则标题视图 */
function chipViewOf(t: { title: string; url: string }): WebLinkView {
  return t.title === t.url ? 'link' : 'title'
}

async function run(action: () => unknown | Promise<unknown>): Promise<void> {
  await action()
  hide()
}

function openEdit(): void {
  if (!isChip.value || !target.value) return
  editing.value = true
  draftTitle.value = target.value.title === target.value.url ? '' : target.value.title
  draftUrl.value = target.value.url
}

async function commitEdit(): Promise<void> {
  const t = target.value
  if (!t || !isChip.value) return
  const url = draftUrl.value.trim()
  if (!/^https?:\/\//.test(url)) return
  const title = draftTitle.value.trim() || url
  await run(async () => {
    if (replaceActiveChip(t.blockId, { url: t.url, title: t.title }, webLinkChipMarkdown(title, url))) {
      await flushActiveChipBlock(t.blockId)
      return
    }
    await editChipLink(t.blockId, title, url)
  })
}

async function removeLink(): Promise<void> {
  const t = target.value
  if (!t || !isChip.value) return
  const spanFromDom = document.querySelector(
    `[data-block-id="${t.blockId}"] .web-link-chip[data-chip-url="${CSS.escape(t.url)}"]`,
  ) as HTMLElement | null
  // chip 的 start/end 由 DOM 无法反推，按字面查找（content 单 chip 场景）
  const content = useBlockStore().getBlock(t.blockId)?.content ?? ''
  const chip = findWebLinkChips(content).find(c => c.url === t.url)
  if (!chip) return
  await run(async () => {
    if (replaceActiveChip(t.blockId, { url: t.url, title: t.title }, t.title)) {
      await flushActiveChipBlock(t.blockId)
      return
    }
    if (!spanFromDom) return
    await removeChipLink(t.blockId, chip.start, chip.end, t.title)
  })
}

async function switchTo(view: WebLinkView): Promise<void> {
  const t = target.value
  if (!t) return
  await run(async () => {
    // 切卡片/预览会拆旧建新，必须先让编辑器的在途正文落库
    await flushActiveChipBlock(t.blockId)
    await switchWebLinkView(t.blockId, view, t.kind)
  })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="target"
      class="wl-toolbar"
      :style="{ left: `${Math.max(8, target.left)}px`, top: `${Math.max(8, target.top - 40)}px` }"
      @mouseenter="cancelHide"
      @mouseleave="scheduleHide()"
      @mousedown.stop
      @click.stop
    >
      <template v-if="editing">
        <input
          v-model="draftTitle"
          class="wl-toolbar-input"
          placeholder="显示文字"
          @keydown.enter="commitEdit"
        >
        <input
          v-model="draftUrl"
          class="wl-toolbar-input wl-toolbar-input--url"
          placeholder="https://…"
          @keydown.enter="commitEdit"
        >
        <button
          type="button"
          class="wl-toolbar-btn wl-toolbar-btn--confirm"
          @click="commitEdit"
        >
          确认
        </button>
      </template>

      <template v-else>
        <button
          v-if="isChip"
          type="button"
          class="wl-toolbar-btn"
          title="编辑链接"
          @click="openEdit"
        >
          <PencilLine :size="13" />
          <span>编辑链接</span>
        </button>
        <button
          v-if="isChip"
          type="button"
          class="wl-toolbar-btn"
          title="移除链接（保留文字）"
          @click="removeLink"
        >
          <Link2Off :size="13" />
          <span>移除链接</span>
        </button>

        <div class="wl-toolbar-view">
          <button
            type="button"
            class="wl-toolbar-btn"
            @click="viewMenuOpen = !viewMenuOpen"
          >
            <span>{{ WEB_LINK_VIEW_LABELS[isChip ? chipViewOf(target) : (target.view as WebLinkView)] }}</span>
            <ChevronDown :size="12" />
          </button>
          <div
            v-if="viewMenuOpen"
            class="wl-toolbar-menu"
          >
            <button
              v-for="v in WEB_LINK_VIEWS"
              :key="v"
              type="button"
              class="wl-toolbar-menu-item"
              @click="switchTo(v)"
            >
              <span>{{ WEB_LINK_VIEW_LABELS[v] }}</span>
              <Check
                v-if="v === (isChip ? chipViewOf(target) : target.view)"
                :size="12"
              />
            </button>
          </div>
        </div>

        <button
          type="button"
          class="wl-toolbar-btn"
          title="复制原始链接"
          @click="run(() => copyWebLinkUrl(target!.url))"
        >
          <Copy :size="13" />
          <span>复制链接</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.wl-toolbar {
  position: fixed;
  z-index: var(--z-popover, 100);
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 4px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 6px);
  background: var(--bg-base2, var(--bg-base));
  box-shadow: var(--shadow-floating);
  font-size: 12px;
  white-space: nowrap;
}

.wl-toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border: 0;
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.wl-toolbar-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.wl-toolbar-btn--confirm {
  background: var(--accent);
  color: var(--bg-base);
}

.wl-toolbar-input {
  width: 120px;
  padding: 4px 6px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-base);
  color: var(--text-primary);
  font: inherit;
}

.wl-toolbar-input--url {
  width: 200px;
}

.wl-toolbar-view {
  position: relative;
}

.wl-toolbar-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 92px;
  padding: 3px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 6px);
  background: var(--bg-base2, var(--bg-base));
  box-shadow: var(--shadow-floating);
}

.wl-toolbar-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 7px;
  border: 0;
  border-radius: var(--radius-sm, 4px);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.wl-toolbar-menu-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
