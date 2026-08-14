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
import { useNotificationScheduler } from './composables/useNotificationScheduler'
import { useBlockQueryRegistry } from './composables/useBlockQueryRegistry'
import { usePageQueryRegistry } from './composables/usePageQueryRegistry'
import { useSyncStatus } from './composables/useSyncStatus'
import Icon from './components/Icons/Icon.vue'
import RightSidebar from './components/RightSidebar/index.vue'
import { registerPanel } from './components/RightSidebar/panels'
import BlockVersionPanel from './components/RightSidebar/BlockVersionPanel.vue'
import GraphPanel from './components/RightSidebar/GraphPanel.vue'
import SearchPanel from './components/SearchPanel.vue'
import BlockSelector from './components/BlockSelector.vue'
import { isTauriEnvironment, tauriMinimizeWindow, tauriToggleMaximizeWindow, tauriCloseWindow, tauriIsMaximized, tauriAutoReconnect } from './wasm/tauri-client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isAndroidPlatformSync } from './wasm/tauri-client'
import router from './router'
import { prefetchGraphSnapshot } from './components/GraphView/graphSnapshotCache'

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

// 组合根注册：Block 字段描述符接入通用查询引擎，并随自定义 property 变化响应式同步
useBlockQueryRegistry()
// 组合根注册：Page 字段描述符接入通用查询引擎（静态注册表，无运行时增删）
usePageQueryRegistry()

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
const absolute = computed(() => route.meta.absolute === true)
const showRightSidebarToggle = computed(() => route.meta.hideRightSidebarToggle !== true)

function handleGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    showSearchPanel.value = !showSearchPanel.value
  }  else if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
    e.preventDefault()
    router.push('/graph')
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
    e.preventDefault()
    router.push('/ideas')
  }else if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
    e.preventDefault()
    toggle()
  } else if ((e.ctrlKey || e.metaKey) && e.key === 't') {
    e.preventDefault()
    router.push('/tasks')
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
  // 预取图谱全量边快照（进程级缓存），使导航到 /graph 时画布即时填充，
  // 避免「导航时才发 IPC」撞上并发 G6 渲染占用的主线程、导致数据晚 ~1~2.8s 才出现。
  prefetchGraphSnapshot()
  await useRelationshipTypes().load()
  await pageStore.loadAllPages()
  // checkAndEnsureTodayIdeas 已由 IdeasList.vue 的 onMounted 接管
  // 此处不再调用，避免 openPage → loadPageBlocks 替换语义覆盖历史列表 blocks
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

/** 全局 BlockSelector 选择源 block 后：一次性转 embed 类型 + 写 sourceBlockId/sourcePageId 属性 */
async function handleEmbedSelect(sourceBlockId: string, sourcePageId: string) {
  const targetBlockId = editorStore.blockSelector?.blockId
  editorStore.closeBlockSelector()
  if (!targetBlockId) return
  await blockStore.updateBlockType(targetBlockId, 'embed')
  await blockStore.updateBlockProperties(targetBlockId, { sourceBlockId, sourcePageId })
}
</script>

<template>
  <div class="app-layout">
    <Sidebar :canGoBack="canGoBack" :canGoForward="canGoForward" @goBack="handleGoBack" @goForward="handleGoForward" @open-search="showSearchPanel = true" />

    <div class="page-scroll-wrapper" @click="handleMainClick">
      <header class="sticky-header" @mousedown="handleHeaderMouseDown" :class="{'absolute':absolute}">
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
              <Icon name="icon-minimize" :size="18" />
            </button>
            <button class="window-control-btn maximize-btn" :title="isMaximized ? '还原' : '最大化'" @click="handleMaximize">
              <Icon :name="isMaximized ? 'icon-square' : 'icon-maximize'" :size="18"/>
            </button>
            <button class="window-control-btn close-btn" title="关闭" @click="handleClose">
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

    <BlockSelector
      :visible="!!editorStore.blockSelector?.visible"
      :exclude-block-id="editorStore.blockSelector?.blockId ?? undefined"
      @select="handleEmbedSelect"
      @close="editorStore.closeBlockSelector()"
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
  z-index: 10;
  background: color-mix(in srgb, var(--bg-base) 50%, transparent);
  backdrop-filter: blur(12px) saturate(1.2);
  -webkit-backdrop-filter: blur(12px) saturate(1.2);
  // pointer-events: none;
}

.sticky-header.absolute {
  position: sticky;
}

.page-scroll-wrapper::-webkit-scrollbar {
  display: none;
}

.content-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
  min-height: 0;
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
