<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useEmbedSelector } from './app/useEmbedSelector'
import { useGlobalHotkeys } from './app/useGlobalHotkeys'
import { useGraphSidebarToggle } from './app/useGraphSidebarToggle'
import { useNavigationHistory } from './app/useNavigationHistory'
import { useSyncPeerToast } from './app/useSyncPeerToast'
import { useTrashedPageRestore } from './app/useTrashedPageRestore'
import { useWindowControls } from './app/useWindowControls'
import BlockSelector from './components/BlockSelector.vue'
import BlockModal from './components/Block/BlockModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import DateTimePickerPanel from './components/DateTimePickerPanel.vue'
import { prefetchGraphSnapshot } from './components/GraphView/graphSnapshotCache'
import Icon from './components/Icons/Icon.vue'
import NotificationBell from './components/NotificationBell.vue'
import PageMenuButton from './components/PageMenuButton.vue'
import BlockVersionPanel from './components/RightSidebar/BlockVersionPanel.vue'
import GraphPanel from './components/RightSidebar/GraphPanel.vue'
import RightSidebar from './components/RightSidebar/index.vue'
import { registerPanel } from './components/RightSidebar/panels'
import SearchPanel from './components/SearchPanel.vue'
import SettingsModal from './components/Settings/SettingsModal.vue'
import Sidebar from './components/Sidebar/index.vue'
import Toast from './components/Toast.vue'
import { useBlockQueryRegistry } from './composables/useBlockQueryRegistry'
import { useDateTimePickerPanel } from './composables/useDateTimePickerPanel'
import { useNotificationScheduler } from './composables/useNotificationScheduler'
import { usePageQueryRegistry } from './composables/usePageQueryRegistry'
import { useRelationshipTypes } from './composables/useRelationshipTypes'
import { useEditorStore } from './stores/editor'
import { usePageStore } from './stores/pages'
import { isTauriEnvironment } from './wasm/tauri-platform'

registerPanel({
  id: 'block-version',
  label: '版本历史',
  icon: 'icon-history',
  component: BlockVersionPanel
})

registerPanel({
  id: 'graph',
  label: '图谱',
  icon: 'icon-network',
  component: GraphPanel
})

const route = useRoute()
const editorStore = useEditorStore()
const pageStore = usePageStore()

// 阅读器独立窗口（票 03 / ADR-0040 D4：Tauri WebviewWindow 直开 /reader/:bookId）：
// 不渲染主窗口壳（Sidebar/右侧栏/全局浮层），ReaderView 自带顶栏与窗口控制。
// 用 location.pathname 判定——首帧路由尚未 resolve，route.path 不可靠。
const isReaderWindow =
  typeof window !== 'undefined' && window.location.pathname.startsWith('/reader')

const {
  visible: dateRefPanelVisible,
  position: dateRefPanelPosition,
  kind: dateRefPanelKind,
  initialIso: dateRefPanelIso,
  initialRecurrence: dateRefPanelRecurrence,
  initialLeadMinutes: dateRefPanelLeadMinutes,
  close: closeDateRefPanel,
  handleConfirm: handleDateRefConfirm,
} = useDateTimePickerPanel()

// 主窗口专属的全局调度/注册（通知轮询、查询注册、同步 toast）：
// 阅读器窗口跳过，避免双窗口重复调度（阅读器窗口经 wasm client 共用同一 SQLite）
if (!isReaderWindow) {
  useNotificationScheduler()
  useBlockQueryRegistry()
  usePageQueryRegistry()
  useSyncPeerToast()
}

const { canGoBack, canGoForward, goBack, goForward } = useNavigationHistory()
const { isMaximized, startDragging, minimize, maximize, close } = useWindowControls()
const { isGraphPanelOpen, handleToggle: handleGraphSidebarToggle } = useGraphSidebarToggle()
const {
  visible: restoreVisible,
  pageTitle: restorePageTitle,
  confirm: confirmRestore,
  cancel: cancelRestore,
} = useTrashedPageRestore()
const { handleSelect: handleEmbedSelect } = useEmbedSelector()

const showSearchPanel = ref(false)
// 主窗口专属：全局路由/搜索快捷键（阅读器窗口不注册，ctrl+g/i/t 不劫持阅读器）
if (!isReaderWindow) {
  useGlobalHotkeys({ onToggleSearch: () => { showSearchPanel.value = !showSearchPanel.value } })
}

const isFullWidthPage = computed(() => route.meta.fullWidth === true)
const absolute = computed(() => route.meta.absolute === true)
const showRightSidebarToggle = computed(() => route.meta.hideRightSidebarToggle !== true)

onMounted(async () => {
  // 阅读器窗口不做主窗口初始化（页面预载/图谱预取/Ctrl+A 兜底：
  // 阅读器正文允许浏览器默认全选，为后续高亮选区铺路）
  if (isReaderWindow) return
  // 预取图谱全量边快照（进程级缓存），使导航到 /graph 时画布即时填充
  prefetchGraphSnapshot()
  await useRelationshipTypes().load()
  await pageStore.loadAllPages()
  // 全局 Ctrl+A 兜底：BlockList 区域由 BlockList 的捕获监听处理，
  // 可编辑输入区保留控件自身全选，其余区域一律屏蔽浏览器整页文本全选。
  document.addEventListener('keydown', handleGlobalKeydownCapture, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleGlobalKeydownCapture, true)
})

/**
 * 全局 Ctrl+A 兜底（document 捕获阶段，晚于 BlockList 的监听注册顺序执行）。
 * - 目标在 input/textarea/contenteditable（含 CodeMirror 编辑区）→ 放行，保留控件自身全选
 * - 目标在 .block-list 内 → 放行，由 BlockList 捕获监听决定全选/仅屏蔽
 * - 其余区域（页面空白、侧边栏、弹层、图谱画布等）→ 屏蔽浏览器默认，无操作
 */
function handleGlobalKeydownCapture(e: KeyboardEvent) {
  if ((e.key !== 'a' && e.key !== 'A') || !(e.ctrlKey || e.metaKey)) return
  const target = e.target as HTMLElement | null
  if (target && typeof target.closest === 'function') {
    if (target.closest('input, textarea, [contenteditable="true"]')) return
    if (target.closest('.block-list')) return
  }
  e.preventDefault()
  e.stopPropagation()
}

function handleMainClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!document.contains(target)) return
  if (target.closest('.block')) return
  // 点击右侧面板时保持当前 Block 激活状态（版本历史等面板需要依赖 activeBlockId）
  if (target.closest('.right-sidebar')) return
  editorStore.deactivateBlock()
}
</script>

<template>
  <!-- 阅读器独立窗口：无主窗口壳，ReaderView 全屏自绘 -->
  <RouterView v-if="isReaderWindow" />
  <div v-else class="app-layout">
    <Sidebar :canGoBack="canGoBack" :canGoForward="canGoForward" @goBack="goBack" @goForward="goForward" @open-search="showSearchPanel = true" />

    <div class="page-scroll-wrapper" @click="handleMainClick">
      <header class="sticky-header" @mousedown="startDragging" :class="{ 'absolute': absolute }">
        <div class="top-right-controls">
          <NotificationBell />
          <PageMenuButton />
          <button
            v-if="showRightSidebarToggle"
            class="right-sidebar-toggle"
            :title="isGraphPanelOpen ? '关闭概念图谱' : '打开概念图谱'"
            @click="handleGraphSidebarToggle"
          >
            <Icon :name="isGraphPanelOpen ? 'icon-panel-right-close' : 'icon-panel-right-open'" :size="16" />
          </button>
          <div class="window-controls" v-if="isTauriEnvironment()">
            <button class="window-control-btn minimize-btn" title="最小化" @click="minimize">
              <Icon name="icon-minimize" :size="18" />
            </button>
            <button class="window-control-btn maximize-btn" :title="isMaximized ? '还原' : '最大化'" @click="maximize">
              <Icon :name="isMaximized ? 'icon-square' : 'icon-maximize'" :size="18" />
            </button>
            <button class="window-control-btn close-btn" title="关闭" @click="close">
              <Icon name="icon-close" :size="18" />
            </button>
          </div>
        </div>
      </header>

      <div class="page-content-wrapper">
        <div class="content-body">
          <main class="main-content" :class="{ 'is-fullwidth-content': isFullWidthPage }">
            <RouterView v-slot="{ Component, route }">
              <KeepAlive include="IdeasList">
                <component
                  :is="Component"
                  :key="route.name === 'ideas-list' ? 'ideas-list' : route.fullPath"
                />
              </KeepAlive>
            </RouterView>
          </main>
        </div>

        <RightSidebar />
      </div>
    </div>

    <ConfirmDialog
      :visible="restoreVisible"
      title="页面已在回收站中"
      :message="`页面「${restorePageTitle || ''}」曾在回收站中。是否要恢复该页面？`"
      confirm-text="恢复页面"
      cancel-text="忽略"
      @confirm="confirmRestore"
      @cancel="cancelRestore"
    />

    <SettingsModal />

    <SearchPanel :visible="showSearchPanel" @close="showSearchPanel = false" />

    <Toast :visible="true" :messages="editorStore.toasts" @remove="editorStore.removeToast" />

    <DateTimePickerPanel
      :visible="dateRefPanelVisible"
      :position="dateRefPanelPosition"
      :kind="dateRefPanelKind"
      :initial-iso="dateRefPanelIso"
      :initial-recurrence="dateRefPanelRecurrence"
      :initial-lead-minutes="dateRefPanelLeadMinutes"
      @confirm="handleDateRefConfirm"
      @cancel="closeDateRefPanel"
    />

    <BlockSelector
      :visible="!!editorStore.blockSelector?.visible"
      :exclude-block-id="editorStore.blockSelector?.blockId ?? undefined"
      @select="handleEmbedSelect"
      @close="editorStore.closeBlockSelector()"
    />

    <!-- 单块子树编辑弹窗：全局常驻，响应 editorStore.blockModalBlockId，
         供主编辑器 bullet / 任务中心卡片等多入口统一打开（ADR-0039） -->
    <BlockModal
      :block-id="editorStore.blockModalBlockId"
      @close="editorStore.closeBlockModal()"
    />
  </div>
</template>

<style lang="scss" scoped>
@import './styles/tokens/_primitives.scss';

.app-layout {
  display: flex;
  flex-direction: row;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg-base);
}

.page-scroll-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  position: relative;
}

.page-content-wrapper {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-width: 0;
  position: relative;
}

.sticky-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: var(--nav-height);
  flex-shrink: 0;
  z-index: var(--z-sticky);
  background: transparent; // color-mix(in srgb, var(--bg-base) 50%, transparent);
  // backdrop-filter: blur(12px) saturate(1.2);
  // -webkit-backdrop-filter: blur(12px) saturate(1.2);
  // pointer-events: none;
}

.sticky-header.absolute {
  position: sticky;
}

.content-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
  min-height: 0;
}

.top-right-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  justify-content: flex-end;
  margin-left: auto;
  pointer-events: none;
}

.top-right-controls > * {
  pointer-events: auto;
}

.right-sidebar-toggle {
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  transition: all 100ms ease;
}

.right-sidebar-toggle:hover {
  color: var(--text-secondary);
}

.right-sidebar-toggle:active {
  transform: scale(0.95);
}

.main-content.is-fullwidth-content {
  max-width: none;
  margin: 0;
  padding: 0;
  // min-height: 0;
  height: 100%;
  overflow: hidden;
}

.window-controls {
  display: flex;
  align-items: center;
  gap: 0;
  margin-left: 8px;
  pointer-events: auto;
  border-radius: 4px;
  overflow: hidden;
}

.window-control-btn {
  width: 46px;
  height: var(--nav-height);
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  transition: all 100ms ease;
  flex-shrink: 0;
  position: relative;
}

.window-control-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.window-control-btn:active {
  background: rgba(255, 255, 255, 0.15);
}

.minimize-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.maximize-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.close-btn:hover {
  background: var(--danger-color, #e81123);
  color: white;
}

.close-btn:active {
  background: var(--danger-color, #e81123);
  opacity: 0.8;
}
</style>
