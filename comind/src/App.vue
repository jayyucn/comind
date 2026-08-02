<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from './components/Sidebar/index.vue'
import PageMenuButton from './components/PageMenuButton.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import SettingsModal from './components/Settings/SettingsModal.vue'
import Toast from './components/Toast.vue'
import DateTimePickerPanel from './components/DateTimePickerPanel.vue'
import NotificationBell from './components/NotificationBell.vue'
import { useEditorStore } from './stores/editor'
import { useDateTimePickerPanel } from './composables/useDateTimePickerPanel'
import { useBlockStore } from './stores/blocks'
import { usePageStore } from './stores/pages'
import { useSidebar } from './composables/useSidebar'
import { useRightSidebar } from './composables/useRightSidebar'
import { useRelationshipTypes } from './composables/useRelationshipTypes'
import { useIdeas } from './composables/useIdeas'
import { useNotificationScheduler } from './composables/useNotificationScheduler'
import { useSyncStatus } from './composables/useSyncStatus'
import Icon from './components/Icons/Icon.vue'
import RightSidebar from './components/RightSidebar/index.vue'
import { registerPanel } from './components/RightSidebar/panels'
import BlockVersionPanel from './components/RightSidebar/BlockVersionPanel.vue'
import GraphPanel from './components/RightSidebar/GraphPanel.vue'
import SearchPanel from './components/SearchPanel.vue'
import { isTauriEnvironment, tauriMinimizeWindow, tauriToggleMaximizeWindow, tauriCloseWindow, tauriIsMaximized, tauriAutoReconnect } from './wasm/tauri-client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isAndroidPlatformSync } from './wasm/tauri-client'

registerPanel({
  id: 'block-version',
  label: '版本历史',
  icon: '??',
  component: BlockVersionPanel
})

registerPanel({
  id: 'graph',
  label: '图谱',
  icon: '???',
  component: GraphPanel
})

const { toggle } = useSidebar()
const rightSidebar = useRightSidebar()

const isGraphPanelOpen = computed(() =>
  rightSidebar.visible.value && rightSidebar.activePanelId.value === 'graph'
)
function handleGraphSidebarToggle() {
  if (!rightSidebar.visible.value) {
    rightSidebar.setVisible(true)
    rightSidebar.setActivePanel('graph')
  } else if (rightSidebar.activePanelId.value !== 'graph') {
    rightSidebar.setActivePanel('graph')
  } else {
    rightSidebar.setVisible(false)
  }
}

const editorStore = useEditorStore()
const route = useRoute()
const blockStore = useBlockStore()
const pageStore = usePageStore()

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

useNotificationScheduler()

// PC 端：设备连入时显示 toast
const { status: syncStatus } = useSyncStatus()
const prevPeerCount = ref(0)
watch(() => syncStatus.value?.peers.length, (newCount) => {
  if (newCount !== undefined && newCount > prevPeerCount.value) {
    editorStore.showToast('Android 设备已连接', 'info')
  }
  prevPeerCount.value = newCount ?? 0
})

const isFullWidthPage = computed(() => route.meta.fullWidth === true)
const showRightSidebarToggle = computed(() => route.meta.hideRightSidebarToggle !== true)

function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    showSearchPanel.value = !showSearchPanel.value
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault()
    toggle()
  }
}

type HistoryItem = {
  path: string
  pageId?: string
}

const historyStack = ref<HistoryItem[]>([{ path: '' }])
const historyIndex = ref(0)

const showTrashedPageWarning = ref(false)
const trashedPageToRestore = ref<string | null>(null)
const showSearchPanel = ref(false)
const isMaximized = ref(false)

async function handleHeaderMouseDown(e: MouseEvent) {
  if (!isTauriEnvironment()) return
  const target = e.target as HTMLElement
  if (target.closest('button') || target.closest('.top-right-controls')) return
  const window = getCurrentWindow()
  await window.startDragging()
}

async function handleMinimize() {
  if (!isTauriEnvironment()) return
  await tauriMinimizeWindow()
}

async function handleMaximize() {
  if (!isTauriEnvironment()) return
  await tauriToggleMaximizeWindow()
  isMaximized.value = await tauriIsMaximized()
}

async function handleClose() {
  if (!isTauriEnvironment()) {
    window.close()
    return
  }
  await tauriCloseWindow()
}

async function updateMaximizedState() {
  if (isTauriEnvironment()) {
    isMaximized.value = await tauriIsMaximized()
  }
}

onMounted(async () => {
  await useRelationshipTypes().load()
  await pageStore.loadAllPages()
  await useIdeas().checkAndEnsureTodayIdeas()
  document.addEventListener('keydown', handleGlobalKeydown)
  await updateMaximizedState()

  if (isTauriEnvironment()) {
    const window = getCurrentWindow()
    window.listen('tauri://resize', async () => {
      isMaximized.value = await tauriIsMaximized()
    })

    // Android: 启动时自动重连已配对的 PC
    if (isAndroidPlatformSync()) {
      tauriAutoReconnect().then((found) => {
        if (found) console.log('[auto-reconnect] Paired device found, connecting...')
        else console.log('[auto-reconnect] No paired device')
      }).catch((e) => {
        console.warn('[auto-reconnect] Failed:', e)
      })
    }

    // 网络恢复时触发重连（Android + 桌面端）
    globalThis.addEventListener('online', () => {
      console.log('[network] Online event fired')
      if (isAndroidPlatformSync()) {
        tauriAutoReconnect().catch((e) => {
          console.warn('[auto-reconnect] Online reconnect failed:', e)
        })
      }
    })
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalKeydown)
})

watch(() => route.fullPath, async (newPath) => {
  if (newPath === historyStack.value[historyIndex.value]?.path) return

  if (historyIndex.value < historyStack.value.length - 1) {
    historyStack.value = historyStack.value.slice(0, historyIndex.value + 1)
  }

  // 尝试获取当前页面 ID
  let pageId: string | undefined
  if (route.params.pageId || route.params.date) {
    const idOrTitle = (route.params.pageId || route.params.date) as string
    const page = pageStore.getPage(idOrTitle) ?? pageStore.getPageByTitle(idOrTitle)
    if (page) {
      pageId = page.id
    }
  }

  historyStack.value.push({ path: newPath, pageId })
  historyIndex.value = historyStack.value.length - 1
})

watch(() => route.meta.hideRightSidebarToggle, (hide) => {
  if (hide) {
    rightSidebar.setVisible(false)
  }
})

watch(() => blockStore.trashedPageWarnings, async (warnings) => {
  if (warnings && warnings.length > 0) {
    trashedPageToRestore.value = warnings[0]
    showTrashedPageWarning.value = true
  }
})

async function confirmRestoreTrashedPage() {
  if (trashedPageToRestore.value) {
    const trashedPage = pageStore.pages.find(p => p.title === trashedPageToRestore.value && p.deleted)
    if (trashedPage) {
      await pageStore.restorePage(trashedPage.id)
    }
  }
  showTrashedPageWarning.value = false
  blockStore.clearTrashedPageWarnings()
}

function cancelRestoreTrashedPage() {
  showTrashedPageWarning.value = false
  blockStore.clearTrashedPageWarnings()
}

const canGoBack = computed(() => historyIndex.value > 0)
const canGoForward = computed(() => historyIndex.value < historyStack.value.length - 1)

function handleGoBack() {
  if (!canGoBack.value) return
  historyIndex.value--
  window.history.go(-1)
}

function handleGoForward() {
  if (!canGoForward.value) return
  historyIndex.value++
  window.history.go(1)
}

function removePageFromHistory(pageId: string) {
  // 过滤掉包含该页面 ID 的历史记录
  const newStack = historyStack.value.filter(item => item.pageId !== pageId)

  // 如果当前指向的页面被删除了，需要调整索引
  if (historyIndex.value >= newStack.length) {
    historyIndex.value = Math.max(0, newStack.length - 1)
  }

  // 如果新栈长度为 0，添加默认路径
  if (newStack.length === 0) {
    historyStack.value = [{ path: '' }]
    historyIndex.value = 0
  } else {
    historyStack.value = newStack
  }
}

// 注册移除历史记录的回调
pageStore.onRemovePageFromHistory(removePageFromHistory)

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
  <div class="app-layout">
    <Sidebar :canGoBack="canGoBack" :canGoForward="canGoForward" @goBack="handleGoBack" @goForward="handleGoForward" @open-search="showSearchPanel = true" />

    <div class="page-scroll-wrapper" @click="handleMainClick">
      <div class="sticky-header" @mousedown="handleHeaderMouseDown">
        <div class="top-right-controls">
          <NotificationBell />
          <PageMenuButton />
          <button
            v-if="showRightSidebarToggle"
            class="right-sidebar-toggle"
            :title="isGraphPanelOpen ? '关闭概念图谱' : '打开概念图谱'"
            @click="handleGraphSidebarToggle"
          >
            <Icon :name="isGraphPanelOpen ? 'icon-panel-right-close' : 'icon-panel-right-open'" :size="16"/>
          </button>
          <div class="window-controls" v-if="isTauriEnvironment()">
            <button class="window-control-btn minimize-btn" title="最小化" @click="handleMinimize">
              <Icon name="icon-minimize" :size="14" />
            </button>
            <button class="window-control-btn maximize-btn" :title="isMaximized ? '还原' : '最大化'" @click="handleMaximize">
              <Icon :name="isMaximized ? 'icon-square' : 'icon-maximize'" :size="14"/>
            </button>
            <button class="window-control-btn close-btn" title="关闭" @click="handleClose">
              <Icon name="icon-close" :size="14" />
            </button>
          </div>
        </div>
      </div>

      <div class="page-content-wrapper">
        <div class="content-body">
          <main class="main-content" :class="{ 'is-fullwidth-content': isFullWidthPage }">
            <RouterView />
          </main>
        </div>

        <RightSidebar />
      </div>
    </div>

    <ConfirmDialog :visible="showTrashedPageWarning" title="页面已在回收站中"
      :message="`页面「${trashedPageToRestore || ''}」曾在回收站中。是否要恢复该页面？`" confirm-text="恢复页面" cancel-text="忽略"
      @confirm="confirmRestoreTrashedPage" @cancel="cancelRestoreTrashedPage" />

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
}

.sticky-header {
  position: sticky;
  top: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: var(--nav-height);
  z-index: 10;
  background: var(--bg-base);
}

.page-scroll-wrapper::-webkit-scrollbar {
  display: none;
}

.content-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
  scrollbar-width: none;
}

.content-body::-webkit-scrollbar {
  display: none;
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
