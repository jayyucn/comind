<script setup lang="ts">
import Sortable from 'sortablejs'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { usePageStore } from '../stores/pages'
import { currentView, type PaneTab, type PaneView } from '../stores/panes'
import Icon from './Icons/Icon.vue'

const props = defineProps<{
  paneId: string
  tabs: PaneTab[]
  activeTabId: string
  closeDisabled: boolean
  /** 本 pane 是否为活动 pane——决定 tab 三态（激活/打开未激活/未激活）。 */
  paneActive: boolean
}>()

const emit = defineEmits<{
  select: [tabId: string]
  close: [tabId: string]
  reorder: [ids: string[]]
}>()

/**
 * tab 三态（取代原 pane-crumb-current 的活动 pane 区分职责）：
 * - is-active：活动 pane 的活动 tab（最亮，正文同底）
 * - is-open：非活动 pane 当前显示的 tab（次亮，正文同底但文字降档）
 * - 默认：后台 tab（最暗，透明底）
 */
function tabClass(tab: PaneTab): Record<string, boolean> {
  const isActiveTab = tab.id === props.activeTabId
  return {
    'is-active': isActiveTab && props.paneActive,
    'is-open': isActiveTab && !props.paneActive,
  }
}

const pageStore = usePageStore()

function tabTitle(tab: PaneTab): string {
  const view = currentView(tab)
  if (view.kind === 'page') return pageStore.getPage(view.ref!)?.title ?? ''
  const titles: Record<Exclude<PaneView['kind'], 'page'>, string> = {
    graph: '概念图谱',
    tasks: '任务中心',
    tags: '标签',
    pages: '页面库',
    trash: '回收站',
  }
  return titles[view.kind]
}

// ── 拖拽排序（对齐 NamedViewBar 的 ADR-0044 机制） ──
// 本地镜像：避免 Vue 响应式（props.tabs）与 Sortable 直接互搏 DOM；
// onEnd 后 reorderTabs 更新真相，watch 同步回 localTabs（顺序已一致，v-for patch 为 no-op）。
const localTabs = ref<PaneTab[]>([])
watch(
  () => props.tabs.map((t) => t.id).join('|'),
  () => {
    localTabs.value = [...props.tabs]
  },
  { immediate: true },
)

// 拖拽与点击的分界：用「拖拽结束时间戳」判定，而非常真布尔（ADR-0044）。
const DRAG_CLICK_SUPPRESS_MS = 200
let dragEndedAt = 0
/** 本次 click 是否属于刚结束的拖拽残留（拖拽结束后的抑制窗口内）。 */
function dragJustEnded(): boolean {
  return Date.now() - dragEndedAt < DRAG_CLICK_SUPPRESS_MS
}

const tabsEl = ref<HTMLElement | null>(null)
let sortable: Sortable | null = null

// 预览块（fallback 克隆）Y 轴锁：横向 tab 条上克隆体仅 X 跟随鼠标（与 NamedViewBar 同口径）。
let ghostYLock: ((e: Event) => void) | null = null

function clampGhostY() {
  const ghost = Sortable.ghost as HTMLElement | null
  const m = ghost?.style.transform.match(/matrix\(([^)]+)\)/)
  if (!ghost || !m) return
  const v = m[1].split(',').map((s) => parseFloat(s))
  if (v.length < 6 || v[5] === 0) return
  v[5] = 0
  const next = `matrix(${v.join(',')})`
  ghost.style.transform = next
  ghost.style.webkitTransform = next
}

function attachGhostYLock() {
  ghostYLock = () => clampGhostY()
  document.addEventListener('pointermove', ghostYLock)
  document.addEventListener('mousemove', ghostYLock)
}

function detachGhostYLock() {
  if (!ghostYLock) return
  document.removeEventListener('pointermove', ghostYLock)
  document.removeEventListener('mousemove', ghostYLock)
  ghostYLock = null
  clampGhostY()
}

// 从 DOM 读取拖拽后的真实顺序（Sortable 已移动节点，作为单一事实来源）。
function readTabOrder(): string[] {
  if (!tabsEl.value) return []
  return Array.from(tabsEl.value.querySelectorAll<HTMLElement>('.pane-tab'))
    .map((el) => el.dataset.id)
    .filter((id): id is string => !!id)
}

function handleDragEnd() {
  detachGhostYLock()
  dragEndedAt = Date.now()
  const ids = readTabOrder()
  if (ids.length) emit('reorder', ids)
}

onMounted(() => {
  if (!tabsEl.value) return
  sortable = new Sortable(tabsEl.value, {
    draggable: '.pane-tab',
    filter: '.pane-tab-close, input',
    preventOnFilter: false,
    forceFallback: true,
    delay: 60,
    animation: 300,
    dragClass: 'nvb-drag',
    ghostClass: 'nvb-ghost',
    chosenClass: 'nvb-chosen',
    onStart: () => {
      attachGhostYLock()
    },
    onEnd: handleDragEnd,
  })
})

onBeforeUnmount(() => {
  sortable?.destroy()
  sortable = null
})
</script>

<template>
  <div
    ref="tabsEl"
    class="pane-tabs"
  >
    <div
      v-for="tab in localTabs"
      :key="tab.id"
      :data-id="tab.id"
      class="pane-tab"
      :class="tabClass(tab)"
      :title="tabTitle(tab)"
      role="tab"
      @click="dragJustEnded() ? null : emit('select', tab.id)"
    >
      <span class="pane-tab-title">{{ tabTitle(tab) }}</span>
      <button
        class="pane-tab-close"
        :disabled="closeDisabled"
        :title="closeDisabled ? '至少保留一个标签页' : '关闭标签页'"
        @mousedown.stop
        @click.stop="dragJustEnded() ? null : emit('close', tab.id)"
      >
        <Icon
          name="icon-close"
          :size="12"
        />
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
// 标签页行：只占标签自身宽度（不拉伸到整行，空白区留给窗口拖拽），过多时横向滚动。
// 沿用现有「浏览器标签」外观（带边框、顶部圆角、激活标签与正文同底）；关闭按钮常驻显示。
.pane-tabs {
  --nvb-thumb: var(--bg-base);

  height: 30px;
  display: flex;
  align-items: center;
  gap: 0px;
  padding: 2px;
  flex: none;
  max-width: 55%;
  // border-radius: var(--radius-sm, 6px);
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--surface-subtle);
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
}

[data-theme='dark'] .pane-tabs {
  --nvb-thumb: var(--bg-active);
}

.pane-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 160px;
  padding: 2px 4px 2px 8px;
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: grab;
  user-select: none;
  pointer-events: auto;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &:active {
    cursor: grabbing;
  }

  &.is-active {
    background: var(--bg-base);
    color: var(--text-primary);
  }

  // 打开未激活：非活动 pane 当前显示的 tab——保持与正文同底（其视图正在渲染），
  // 文字降一档亮度（原 pane-crumb-current 在非活动 pane 用 tertiary 的承接者）。
  &.is-open {
    background: var(--bg-active);
    color: var(--text-secondary);
  }

  // ── 拖拽相关（对齐 ADR-0044） ──
  // 浮动克隆（force-fallback）：外观与激活标签一致、无阴影。
  &.nvb-drag {
    background: var(--bg-active);
    box-shadow: none;
  }

  // 落点占位：中性透明，隐藏内部内容，仅示落点。
  &.nvb-ghost {
    background: transparent !important;

    > * {
      visibility: hidden;
    }
  }

  // 拖拽起点（排除克隆体）。
  &.nvb-chosen:not(.nvb-drag) {
    background: var(--bg-hover);
  }
}

.pane-tab-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
}

.pane-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-xs);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.3;
    cursor: default;
  }
}
</style>
