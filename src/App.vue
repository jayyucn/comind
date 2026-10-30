<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { useEmbedSelector } from './app/useEmbedSelector'
import { useGlobalHotkeys } from './app/useGlobalHotkeys'
import { useGraphSidebarToggle } from './app/useGraphSidebarToggle'
import { usePaneRouterSync } from './app/usePaneRouterSync'
import { useSyncPeerToast } from './app/useSyncPeerToast'
import { useTrashedPageRestore } from './app/useTrashedPageRestore'
import { useWindowControls } from './app/useWindowControls'
import BlockModal from './components/Block/BlockModal.vue'
import FieldValueEditor from './components/Block/FieldValueEditor.vue'
import FieldValueQuickEditor from './components/Block/FieldValueQuickEditor.vue'
import BlockSelector from './components/BlockSelector.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import DateTimePickerPanel from './components/DateTimePickerPanel.vue'
import { prefetchGraphSnapshot } from './components/GraphView/graphSnapshotCache'
import Icon from './components/Icons/Icon.vue'
import NotificationBell from './components/NotificationBell.vue'
import PageMenuButton from './components/PageMenuButton.vue'
import PageSearchModal from './components/PageSearchModal.vue'
import PaneMenuButton from './components/PaneMenuButton.vue'
import PaneTabs from './components/PaneTabs.vue'
import RelationshipMenu from './components/RelationshipMenu.vue'
import GraphPanel from './components/RightSidebar/GraphPanel.vue'
import RightSidebar from './components/RightSidebar/index.vue'
import { getRegisteredPanels, registerPanel } from './components/RightSidebar/panels'
import TocPanel from './components/RightSidebar/TocPanel.vue'
import SearchPanel from './components/SearchPanel.vue'
import SettingsModal from './components/Settings/SettingsModal.vue'
import Sidebar from './components/Sidebar/index.vue'
import SlashCommandMenu from './components/SlashCommandMenu.vue'
import FieldSettingsModal from './components/Tags/FieldSettingsModal.vue'
import Toast from './components/Toast.vue'
import ViewHost from './components/ViewHost.vue'
import { useBlockQueryRegistry } from './composables/useBlockQueryRegistry'
import { useDateTimePickerPanel } from './composables/useDateTimePickerPanel'
import { provideLayoutShell } from './composables/useLayoutShell'
import { useNotificationScheduler } from './composables/useNotificationScheduler'
import { usePageQueryRegistry } from './composables/usePageQueryRegistry'
import { useReaderDataChanged } from './composables/useReaderDataChanged'
import { useRelationshipMenu } from './composables/useRelationshipMenu'
import { useRelationshipTypes } from './composables/useRelationshipTypes'
import { reconcilePanels } from './composables/useRightSidebar'
import { useSidebar } from './composables/useSidebar'
import { runUndoOrRedo } from './composables/useUndoRestore'
import { useEditorStore } from './stores/editor'
import { usePageStore } from './stores/pages'
import { currentView, usePanesStore } from './stores/panes'
import { resolveUndoScopeBlockPage, takeOverUndoRedo } from './utils/undo-chord'
import { isTauriEnvironment } from './wasm/tauri-platform'

registerPanel({
  id: 'graph',
  label: '图谱',
  icon: 'icon-network',
  component: GraphPanel
})

registerPanel({
  id: 'toc',
  label: '大纲',
  icon: 'icon-list',
  component: TocPanel
})

// ADR-0047 D1：block-version 面板已下架，把持久化设置里指向它的引用回落到已注册面板。
reconcilePanels(getRegisteredPanels().map(p => p.id))

const route = useRoute()
const editorStore = useEditorStore()
const pageStore = usePageStore()

// ── Pane → PaneTab → PaneView（ADR-0060）──
const panesStore = usePanesStore()
const paneRouter = usePaneRouterSync()
const { isCollapsed: isSidebarCollapsed, toggle: toggleSidebar } = useSidebar()

// ── + 改为弹出页面搜索面板：选页面/新建页面 → 新 tab 打开 ──
const showPageSearch = ref(false)
const pageSearchPaneId = ref('')

function openPageSearch(paneId: string): void {
  pageSearchPaneId.value = paneId
  showPageSearch.value = true
}

/** 面板确认（选现有页或即时新建）→ 在目标 pane 的新 tab 打开。 */
function openPageInNewTab(pageId: string): void {
  panesStore.newTab(pageId, pageSearchPaneId.value)
  showPageSearch.value = false
}

/** pane 宽度：单 pane 撑满；双 pane 时左栏按 splitRatio、右栏 flex 自适应 */
function paneStyle(index: number): Record<string, string> {
  if (panesStore.panes.length <= 1) return { flexBasis: '100%', flexGrow: '1' }
  if (index === 0) {
    return { flexBasis: `${(panesStore.splitRatio * 100).toFixed(2)}%`, flexGrow: '0' }
  }
  return { flexGrow: '1' }
}

/** 点击 pane（capture 阶段）→ 设为活动：焦点跟随 + currentPageId 派生（flush sync 先于块处理） */
function activatePane(paneId: string): void {
  panesStore.activatePane(paneId)
}

// 全局关系菜单单例（原在 Page 内，pane 复用后上提到此，避免多实例）
const relMenu = useRelationshipMenu()

// 布局壳：向后代组件暴露布局元素 ref，取代 Toc 原先的 document.querySelector 全局抓取。
const sidebarEl = ref<HTMLElement | null>(null)
const contentBodyEl = ref<HTMLElement | null>(null)
const pageMainContentEl = ref<HTMLElement | null>(null)
provideLayoutShell({ sidebarEl, contentBodyEl, pageMainContentEl })

/** 分隔条拖拽：实时写 splitRatio（夹取 0.1~0.9）；按布局方向取对应轴；关闭 pane 走头部 ✕ 按钮 */
function onDividerMousedown(e: MouseEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  const container = contentBodyEl.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  const vertical = panesStore.layoutDirection === 'vertical'
  const onMove = (ev: MouseEvent) => {
    const ratio = vertical
      ? (ev.clientY - rect.top) / rect.height
      : (ev.clientX - rect.left) / rect.width
    panesStore.setSplitRatio(ratio)
  }
  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }
  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

/** Alt+←/→：作用于活动 pane 的导航栈（ADR-0059 D4，浏览器历史解耦） */
function handlePaneNavKeydown(e: KeyboardEvent) {
  if (!e.altKey) return
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    panesStore.goBack(panesStore.activePaneId)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    panesStore.goForward(panesStore.activePaneId)
  }
}

// 页面转场（ADR-0053 D8）：enter-only 浮入，挂在各视图根的 `.page-route-in` 上。

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
  // 票 06：阅读器窗口写 block 后的跨窗口刷新（reader:data-changed → 重载
  // 对应 page blocks；focus 时兜底刷新当前页）
  useReaderDataChanged()
}

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
  // 对称 pane：载入持久化布局并对齐 URL 页（reconcile），随后 currentPageId 派生
  panesStore.loadFromStorage()
  paneRouter.restore()
  // 全局 Ctrl+A 兜底：BlockList 区域由 BlockList 的捕获监听处理，
  // 可编辑输入区保留控件自身全选，其余区域一律屏蔽浏览器整页文本全选。
  document.addEventListener('keydown', handleGlobalKeydownCapture, true)
  // 全局撤销兜底（无 BlockList 表面里的 BlockModal，见函数注释）
  document.addEventListener('keydown', handleGlobalUndoRedoKeyDown, true)
  // Alt+←/→ 活动 pane 后退/前进
  document.addEventListener('keydown', handlePaneNavKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleGlobalKeydownCapture, true)
  document.removeEventListener('keydown', handleGlobalUndoRedoKeyDown, true)
  document.removeEventListener('keydown', handlePaneNavKeydown)
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

/**
 * 全局撤销兜底（capture 阶段，注册晚于 BlockList 的接管 → 捕获阶段 BlockList 先执行）：
 * 覆盖**无 BlockList 挂载**的表面（任务中心 / 查询页）里的 BlockModal —— 焦点落在某块内
 * 且该块所属页已有撤销栈时，复用该页栈撤销/重做（ADR-0046 D6 + #109 验收「任何焦点一致、
 * 无『无反应』落点」）。不落点（无块选区/滚动上下文）：恢复后弹窗经响应式自刷。
 *
 * 只认「块内焦点」：body / 列表空白 / 侧栏 / 输入框这些 BlockList 能处理或该豁免的场景
 * 一律不抢（避免与 BlockList 双接管）。让位机制（defaultPrevented + 注册顺序）的
 * 契约唯一文档点在 takeOverUndoRedo 的 JSDoc。
 */
function handleGlobalUndoRedoKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented) return // 让位：BlockList 已接管（契约见 takeOverUndoRedo JSDoc）
  const takeover = takeOverUndoRedo(e, resolveUndoScopeBlockPage)
  if (!takeover) return
  runUndoOrRedo(takeover.pageId, takeover.chord).catch((err) => console.error('[undo] 恢复失败:', err))
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
  <div
    v-else
    class="app-layout"
  >
    <!-- 统一顶栏：侧栏折叠开关 + 后退/前进（左）与右上角控件（右）合并为单条；
         独占布局第一行（全窗口宽度），其下为 侧栏 + 内容区 的横向行。 -->
    <header
      class="sticky-header"
      :class="{ 'absolute': absolute }"
      @mousedown="startDragging"
    >
      <div class="sidebar-topbar-left">
        <button
          class="sidebar-floating-toggle"
          :title="isSidebarCollapsed ? '展开侧边栏' : '折叠侧边栏'"
          :class="{ collapsed: isSidebarCollapsed }"
          @click="toggleSidebar"
        >
          <Icon
            :name="isSidebarCollapsed ? 'icon-panel-left-open' : 'icon-panel-left-close'"
            :size="16"
          />
        </button>
        <div class="pane-nav-group">
          <button
            class="pane-nav"
            :disabled="!panesStore.canGoBack(panesStore.activePaneId)"
            title="后退"
            @click="panesStore.goBack(panesStore.activePaneId)"
          >
            <Icon
              name="icon-arrow-left"
              :size="16"
            />
          </button>
          <button
            class="pane-nav"
            :disabled="!panesStore.canGoForward(panesStore.activePaneId)"
            title="前进"
            @click="panesStore.goForward(panesStore.activePaneId)"
          >
            <Icon
              name="icon-arrow-right"
              :size="16"
            />
          </button>
        </div>
      </div>

      <div class="top-right-controls">
        <NotificationBell />
        <PageMenuButton />
        <button
          v-if="showRightSidebarToggle"
          class="right-sidebar-toggle"
          :title="isGraphPanelOpen ? '关闭概念图谱' : '打开概念图谱'"
          @click="handleGraphSidebarToggle"
        >
          <Icon
            :name="isGraphPanelOpen ? 'icon-panel-right-close' : 'icon-panel-right-open'"
            :size="18"
          />
        </button>
        <div
          v-if="isTauriEnvironment()"
          class="window-controls"
        >
          <button
            class="window-control-btn minimize-btn"
            title="最小化"
            @click="minimize"
          >
            <Icon
              name="icon-minimize"
              :size="14"
            />
          </button>
          <button
            class="window-control-btn maximize-btn"
            title="isMaximized ? '还原' : '最大化'"
            @click="maximize"
          >
            <Icon
              :name="isMaximized ? 'icon-square' : 'icon-maximize'"
              :size="14"
            />
          </button>
          <button
            class="window-control-btn close-btn"
            title="关闭"
            @click="close"
          >
            <Icon
              name="icon-close"
              :size="14"
            />
          </button>
        </div>
      </div>
    </header>

    <div class="app-main">
      <Sidebar @open-search="showSearchPanel = true" />

      <div
        class="page-scroll-wrapper"
        @click="handleMainClick"
      >
        <div class="page-content-wrapper">
          <div
            ref="contentBodyEl"
            class="content-body"
          >
            <!-- 对称 pane + 每 pane 多标签（ADR-0060）：所有目的地（含点滴列表）均经 pane 渲染。 -->
            <div
              class="pane-layout"
              :class="{ 'sidebar-collapsed': isSidebarCollapsed, 'vertical': panesStore.layoutDirection === 'vertical' }"
            >
              <template
                v-for="(pane, i) in panesStore.panes"
                :key="pane.id"
              >
                <div
                  v-if="i > 0"
                  class="pane-divider"
                  :title="panesStore.layoutDirection === 'vertical' ? '拖拽调整高度' : '拖拽调整宽度'"
                  @mousedown="onDividerMousedown"
                />
                <section
                  class="pane"
                  :class="{ 'is-active': pane.id === panesStore.activePaneId }"
                  :style="paneStyle(i)"
                  :data-pane-id="pane.id"
                  :data-pane-page-id="panesStore.currentPageId ?? ''"
                  @mousedown.capture="activatePane(pane.id)"
                  @focusin.capture="activatePane(pane.id)"
                >
                  <!-- 标签条：标签 + 新建。后退/前进在 App.vue 统一顶栏，全 pane 共用 -->
                  <header class="pane-tabstrip">
                    <PaneMenuButton :pane-id="pane.id" />
                    <PaneTabs
                      :pane-id="pane.id"
                      :tabs="pane.tabs"
                      :active-tab-id="pane.activeTabId"
                      :close-disabled="panesStore.panes.length <= 1 && pane.tabs.length <= 1"
                      :pane-active="pane.id === panesStore.activePaneId"
                      @select="(id) => panesStore.setActiveTab(pane.id, id)"
                      @close="(id) => panesStore.closeTab(pane.id, id)"
                      @reorder="(ids) => panesStore.reorderTabs(pane.id, ids)"
                    />
                    <button
                      class="pane-tab-add"
                      title="搜索或新建页面"
                      @mousedown.stop
                      @click="openPageSearch(pane.id)"
                    >
                      <Plus :size="14" />
                    </button>
                  </header>
                  <div class="pane-body">
                    <div
                      v-for="tab in pane.tabs"
                      v-show="tab.id === pane.activeTabId"
                      :key="tab.id"
                      class="pane-tab-view"
                    >
                      <ViewHost
                        :view="currentView(tab)"
                        :pane-id="pane.id"
                      />
                    </div>
                  </div>
                </section>
              </template>
            </div>
          </div>

          <RightSidebar />
        </div>
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

    <SearchPanel
      :visible="showSearchPanel"
      @close="showSearchPanel = false"
    />

    <PageSearchModal
      :visible="showPageSearch"
      @select="openPageInNewTab"
      @close="showPageSearch = false"
    />

    <Toast
      :visible="true"
      :messages="editorStore.toasts"
      @remove="editorStore.removeToast"
    />

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

    <!-- 完整字段设置弹窗：全局常驻，响应 editorStore.fieldSettingsFieldId（ADR-0057 D1）。
         置于 BlockModal 之前——同 z-dialog 层内后渲染者在上，块详情需叠于字段设置之上 -->
    <FieldSettingsModal
      :field-id="editorStore.fieldSettingsFieldId"
      @close="editorStore.closeFieldSettings()"
    />

    <!-- 单块子树编辑弹窗：全局常驻，响应 editorStore.blockModalBlockId，
         供主编辑器 bullet / 任务中心卡片等多入口统一打开（ADR-0039） -->
    <BlockModal
      :block-id="editorStore.blockModalBlockId"
      @close="editorStore.closeBlockModal()"
    />

    <!-- 块内全局弹层单例（ADR-0058 D3）：原在 Page 内渲染，Page 需被 pane 复用，
         弹层若随 Page 多实例渲染会叠加，故统一上提到此（App 级单例）。 -->
    <SlashCommandMenu />
    <FieldValueQuickEditor />
    <FieldValueEditor />
    <RelationshipMenu :menu="relMenu" />
  </div>
</template>

<style lang="scss" scoped>


// 顶栏之下的主行：侧栏（左）+ 内容区（右）
.app-main {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
}

.page-scroll-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  position: relative;
  // 顶栏为文档流首行（31px），此处向上探回窗口顶，使首个 pane 的标签条能叠进顶栏
  // （Obsidian 式：标签浮在顶栏条上、两侧控件在左右），同时盒子满高避免底部被裁。
  margin-top: -31px;
  height: 100vh;
}

.page-content-wrapper {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-width: 0;
  position: relative;
}

// 页面转场（ADR-0053 D8）：enter-only 浮入。旧页硬切（出场≈瞬时），新页 200ms 浮入，
// 柔和感交给 ease-out 曲线。动画挂在 .main-content 上，对 fragment 根的路由组件天然免疫。
.main-content.page-route-in {
  animation: page-route-in var(--dur-base) var(--ease-out);
}

@keyframes page-route-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

.sticky-header {
  position: relative;
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  height: var(--nav-height);
  flex-shrink: 0;
  box-sizing: border-box;
  z-index: var(--z-sticky);
  background: transparent;
}

.sticky-header.absolute {
  position: sticky;
}

.content-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: row;
  min-width: 0;
  min-height: 0;
  // 曾是容器查询锚点：块属性列（.block-row-properties）据此用 100cqw 算右侧 gutter。
  // 该列已随行内 chips 渲染位下线移除（ADR-0050 D20），此处暂无消费者；
  // 保留而未删是因为移除 inline-size containment 会改变 abs/fixed 后代的包含块
  // 语义，需单独验证后再动。
  // 注意：该 containment 会把本元素变成 abs/fixed 后代的包含块——
  // 浮层一律 Teleport 到 body（ADR-0032），不受影响。
  container-type: inline-size;
}

// ── 对称 pane（ADR-0059/0060）：content-body 内并排 pane，各自独立滚动 ──
// Obsidian 式：首个 pane 的标签条向上叠进统一顶栏（顶部 31px 死区），透明容器让顶栏背景透出，
// 仅标签本体与「+」可点（click-through），不遮挡左右控件；侧栏折叠时左端控件压在标签区上方，
// 故首 pane 标签留白 92px 避让（折叠开关 26 + 导航 50 + 左侧留白 8 + 间隙 ≈ 92）。
.pane-layout {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

// 垂直布局（上下分屏）：pane 纵向排列，paneStyle 的 flexBasis 作用在主轴（高度）上无需改
.pane-layout.vertical {
  flex-direction: column;
}

.pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  flex-shrink: 0;
  position: relative;
}

// 标签条：位于 pane 最顶部（统一顶栏之下的第一行）。
// 高度 32px；整条 pointer-events:none：空白区透传给 sticky-header 做窗口拖拽，
// 只有标签本体和「+」可点（click-through），不会遮住右上角系统按钮。
.pane-tabstrip {
  position: relative;
  z-index: calc(var(--z-sticky));
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 8px;
  // background: var(--surface-subtle);
  pointer-events: none;
  box-sizing: border-box;
}


// 标签页行与标签外观已迁移至 components/PaneTabs.vue（含拖拽排序与三态）。

// 侧栏折叠后，首 pane 标签条叠进顶栏、左端控件压在标签区上方——预留宽度避让。
.pane-layout.sidebar-collapsed .pane:first-child .pane-tabstrip {
  padding-left: 92px;
}

.pane-tab-add {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  margin-left: 8px;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: calc(var(--radius-sm, 6px) - 2px);
  pointer-events: auto;

  &:hover {
    background: var(--bg-hover2);
    color: var(--text-primary);
  }
}

.pane-body {
  flex: 1;
  min-height: 0;
  background: var(--bg-base);
  border-radius: var(--radius-md);
  overflow-y: auto;
  overflow-x: hidden;
}

.pane-tab-view {
  height: 100%;
}

// 正文大标题上移：去掉 pane-head 分隔线后，页面自身 24px 顶部留白会让标题显得下坠
.pane-body :deep(.page-body) {
  padding-top: var(--space-2);
}

.pane-divider {
  flex: 0 0 1px;
  position: relative;
  cursor: col-resize;
  background: var(--border);
  transition: background var(--dur-fast) var(--ease-out);

  // 视觉 1px，热区 4px（伪元素左右各外扩 1.5px）
  &::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: -2px;
    right: -2px;
  }
}

// 垂直布局：分隔线为水平线（主轴尺寸 1px 即高度），热区改为上下外扩
.pane-layout.vertical .pane-divider {
  cursor: row-resize;

  &::before {
    top: -2px;
    bottom: -2px;
    left: 0;
    right: 0;
  }
}

.pane-divider:hover,
.pane-divider:active {
  background: var(--accent);
}

.top-right-controls {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  justify-content: flex-end;
  margin-left: auto;
  pointer-events: none;
}

.top-right-controls > * {
  pointer-events: auto;
}

// ── 统一顶栏左侧：侧栏折叠开关 + 后退/前进（原 SidebarContainer 的常驻 topbar）──
.sidebar-topbar-left {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 100%;
  padding-left: var(--space-2);
  box-sizing: border-box;
}

.sidebar-floating-toggle {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  &:active {
    transform: scale(0.95);
  }
}

// 后退/前进组：所有 pane 共用一个 UI，作用于活动 pane 的历史栈
.pane-nav-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.pane-nav {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.35;
    cursor: default;
  }
}

// 移动端：侧栏以浮层（--z-sidebar）覆盖内容，统一顶栏需抬至 --z-dropdown 之上，
// 否则折叠开关会被侧栏浮层压住（原 sidebar-topbar 即位于 --z-dropdown）。
@media (max-width: 900px) {
  .sticky-header {
    z-index: var(--z-dropdown);
  }
}

.right-sidebar-toggle {
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--space-7);
  height: var(--space-7);
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
}

.right-sidebar-toggle:hover,
.right-sidebar-toggle:active {
  transform: scale(1.1);
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
  border-bottom-left-radius: var(--radius-sm);
  overflow: hidden;
}

.window-control-btn {
  width: var(--space-11);
  height: var(--space-7);
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
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
  background: var(--bg-hover2);
}

.maximize-btn:hover {
  background: var(--bg-hover2);
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
