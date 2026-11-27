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
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

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
import { chipAliasForView, chipMetaTitleOf, findWebLinkChip, webLinkChipMarkdown } from '../../../../utils/web-link-chip'

const { target, hide, cancelHide, scheduleHide, setPinned, viewMenuOpen } = useWebLinkChipToolbar()

const editing = ref(false)
const draftTitle = ref('')
const draftUrl = ref('')
const titleInputEl = ref<HTMLInputElement | null>(null)
const urlInputEl = ref<HTMLInputElement | null>(null)

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

/** 链接视图下标题 = URL 无信息量，编辑弹层隐藏标题行（标题不可改，ADR-0067） */
const hideTitleRow = computed(() => {
  const t = target.value
  return !!t && isChip.value && chipViewOf(t) === 'link'
})

async function run(action: () => unknown | Promise<unknown>): Promise<void> {
  await action()
  hide()
}

/** 指针停在悬浮条上：冻结目标，宿主的离场定时器不得把面板抽走 */
function onToolbarEnter(): void {
  cancelHide()
  setPinned(true)
}

function onToolbarLeave(): void {
  // 编辑态是「焦点态」：输入到一半指针飘出边界（手抖、够到窗口边）不得把表单连同内容抽走。
  // 关闭只走三条显式出口 —— 确认提交、Esc、点击弹窗外。
  if (editing.value) return
  setPinned(false)
  scheduleHide()
}

async function openEdit(): Promise<void> {
  if (!isChip.value || !target.value) return
  editing.value = true
  setPinned(true)
  // 两行都带值：链接视图下标题就等于 URL，留空会让「文本」行看起来没内容可改
  draftTitle.value = target.value.title
  draftUrl.value = target.value.url
  await nextTick()
  // 链接视图下标题行隐藏，焦点落到链接输入框
  ;(titleInputEl.value ?? urlInputEl.value)?.focus()
  ;(titleInputEl.value ?? urlInputEl.value)?.select()
}

/** 取消编辑并整块收起（Esc / 点击弹窗外）：不回浏览态菜单，避免「关了又冒出来」 */
function cancelEdit(): void {
  editing.value = false
  hide()
}

const anchorEl = ref<HTMLElement | null>(null)

function onDocMouseDown(e: MouseEvent): void {
  if (!editing.value) return
  const el = anchorEl.value
  if (el && e.target instanceof Node && el.contains(e.target)) return
  cancelEdit()
}

watch(editing, (on) => {
  if (on) document.addEventListener('mousedown', onDocMouseDown, true)
  else document.removeEventListener('mousedown', onDocMouseDown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMouseDown, true)
  // 编辑态钉住的是模块级 pinned 状态：组件卸载（切页 / 关 pane）不收拾，后续悬浮条会被永久冻结
  if (!editing.value) return
  editing.value = false
  hide()
})

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
    await editChipLink(t.blockId, { url: t.url, title: t.title }, title, url)
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
  const chip = findWebLinkChip(content, { url: t.url, title: t.title })
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
    // chip 的「链接视图/标题视图」就是别名字面本身：编辑态必须就地改文档，
    // 否则 store 的改写会被编辑器的防抖回写覆盖，看起来「点了没反应」。
    if (isChip.value && (view === 'link' || view === 'title')) {
      const metaTitle = chipMetaTitleOf(useBlockStore().getBlock(t.blockId)?.format, t.url)
      const alias = chipAliasForView(t.url, view, metaTitle)
      if (alias === t.title) return
      if (replaceActiveChip(t.blockId, { url: t.url, title: t.title }, webLinkChipMarkdown(alias, t.url))) {
        await flushActiveChipBlock(t.blockId)
        return
      }
      await switchWebLinkView(t.blockId, view, 'chip', { url: t.url, title: t.title })
      return
    }
    // 切卡片/预览会拆旧建新，必须先让编辑器的在途正文落库
    await flushActiveChipBlock(t.blockId)
    await switchWebLinkView(t.blockId, view, t.kind, { url: t.url, title: t.title })
  })
}
</script>

<template>
  <Teleport to="body">
    <!--
      外层 anchor 只负责定位与命中判定：底边对齐宿主上沿，视觉盒靠 `padding-bottom`
      抬起 8px，这段 padding 是透明桥。指针从 chip/卡片升上来时全程落在 anchor 内，
      宿主不会先收到 mouseleave 把面板排队抽走。
    -->
    <div
      v-if="target"
      ref="anchorEl"
      class="wl-toolbar-anchor"
      :style="{ left: `${Math.max(8, target.left)}px`, top: `${Math.max(8, target.top)}px` }"
      @mouseenter="onToolbarEnter"
      @mouseleave="onToolbarLeave"
      @mousedown.stop
      @click.stop
    >
      <div
        class="wl-toolbar"
        :class="{ 'is-editing': editing }"
      >
        <div
          v-if="editing"
          class="wl-edit"
        >
          <template v-if="!hideTitleRow">
            <label class="wl-edit-row">
              <span class="wl-edit-label">标题</span>
              <input
                ref="titleInputEl"
                v-model="draftTitle"
                class="wl-edit-input"
                placeholder="https://…"
                @keydown.enter="commitEdit"
                @keydown.esc.prevent.stop="cancelEdit"
              >
            </label>
            <!-- 占位：保证第一行的输入框只占中间一列，与第二行等宽（右侧留给按钮槽位） -->
            <span aria-hidden="true" />
          </template>
          <label class="wl-edit-row">
            <span class="wl-edit-label">链接</span>
            <input
              ref="urlInputEl"
              v-model="draftUrl"
              class="wl-edit-input"
              placeholder="https://…"
              @keydown.enter="commitEdit"
              @keydown.esc.prevent.stop="cancelEdit"
            >
          </label>
          <button
            type="button"
            class="wl-edit-confirm"
            @click="commitEdit"
          >
            确认
          </button>
        </div>

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
    </div>
  </Teleport>
</template>

<style scoped>
/*
 * 定位 + 命中层。锚点底边严格对齐宿主上沿（`translateY(-100%)`），
 * 视觉盒再靠 `padding-bottom: 8px` 抬起 —— 那 8px 是透明桥，指针从宿主升上来
 * 一路都在锚点内，宿主不会先收到 mouseleave 把面板排队抽走。
 */
.wl-toolbar-anchor {
  position: fixed;
  z-index: var(--z-popover, 100);
  /* 编辑态是定宽表单，靠上取 8px 的定位 + 这条上限保证右侧不出视口 */
  max-width: calc(100vw - 16px);
  padding-bottom: 8px;
  transform: translateY(-100%);
}

.wl-toolbar {
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

/* 编辑态是两行表单，交给 .wl-edit 的 grid 排布 */
.wl-toolbar.is-editing {
  display: block;
  padding: 0;
}

.wl-edit {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 10px;
  row-gap: 10px;
  box-sizing: border-box;
  width: 440px;
  max-width: 100%;
  padding: 12px 14px;
  font-size: 13px;
  white-space: normal;
}

/* label 只做「点文字聚焦输入框」的隐式关联，`display: contents` 让它不占格子，
   两个子元素直接成为 grid item —— 否则首列宽度会被整行撑开。 */
.wl-edit-row {
  display: contents;
}

.wl-edit-label {
  color: var(--text-secondary);
  justify-self: start;
  line-height: 1.4;
}

.wl-edit-input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm, 4px);
  background: var(--bg-base);
  color: var(--text-primary);
  font: inherit;
  outline: none;
}

.wl-edit-input:focus {
  border-color: var(--accent);
}

.wl-edit-confirm {
  height: 30px;
  padding: 0 20px;
  border: 0;
  border-radius: var(--radius-sm, 4px);
  background: var(--accent);
  color: var(--color-white);
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}

.wl-edit-confirm:hover {
  background: var(--accent-hover, var(--accent));
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
