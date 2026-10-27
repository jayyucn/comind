<script setup lang="ts">
import { ChevronRight, Plus } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
import { currentView, type Pane, type PaneTab, type PaneView, usePanesStore } from './stores/panes'
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
const { isCollapsed: isSidebarCollapsed } = useSidebar()
/** 点滴列表不在 PaneKind 中，保留独立列表路由；其余目的地都进入 pane。 */
const isIdeasListRoute = computed(() => route.name === 'ideas-list')

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

function activeTabFor(pane: Pane): PaneTab {
  return pane.tabs.find(tab => tab.id === pane.activeTabId) ?? pane.tabs[0]
}

function paneTitle(pane: Pane): string {
  return tabTitle(activeTabFor(pane))
}

/** 只有 page 标签显示历史面包屑；非页标签只显示固定标题。 */
function paneParentTitle(pane: Pane): string {
  const tab = activeTabFor(pane)
  if (currentView(tab).kind !== 'page') return ''
  const previous = panesStore.previousView(pane.id)
  return previous?.kind === 'page' ? (pageStore.getPage(previous.ref!)?.title ?? '') : ''
}

async function addPageTab(paneId: string): Promise<void> {
  let index = pageStore.pages.length + 1
  let title = `未命名页面 ${index}`
  while (pageStore.getPageByTitle(title)) {
    title = `未命名页面 ${++index}`
  }
  const page = await pageStore.createPage(title)
  panesStore.newTab(page.id, paneId)
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

/** 分隔条拖拽：实时写 splitRatio（夹取 0.1~0.9）；关闭 pane 走头部 ✕ 按钮 */
function onDividerMousedown(e: MouseEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  const container = contentBodyEl.value
  if (!container) return
  const rect = container.getBoundingClientRect()
  const onMove = (ev: MouseEvent) => {
    const ratio = (ev.clientX - rect.left) / rect.width
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

// 页面转场（ADR-0053 D8）：路由变化时对主内容区重放一次浮入动画（enter-only，200ms）。
// 旧页硬切（出场≈瞬时）、新页浮入——不用 <Transition> 包 RouterView 的原因见模板注释。
// 类常驻不移除：animation 默认 fill:none，播完无残留；remove + reflow + add 即可在下次导航重放。
const mainContentEl = ref<HTMLElement | null>(null)
watch(
  () => route.fullPath,
  async () => {
    await nextTick()
    const el = mainContentEl.value
    if (!el) return
    el.classList.remove('page-route-in')
    void el.offsetWidth // 强制 reflow，连续导航间也能重放动画
    el.classList.add('page-route-in')
  },
)

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
    <Sidebar @open-search="showSearchPanel = true" />

    <div
      class="page-scroll-wrapper"
      @click="handleMainClick"
    >
      <header
        class="sticky-header"
        :class="{ 'absolute': absolute }"
        @mousedown="startDragging"
      >
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
              :title="isMaximized ? '还原' : '最大化'"
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

      <div class="page-content-wrapper">
        <div
          ref="contentBodyEl"
          class="content-body"
        >
          <!-- 点滴列表：不在 PaneKind 中，独立渲染（列表为入口页，非可并排目的地）。 -->
          <main
            v-if="isIdeasListRoute"
            ref="mainContentEl"
            class="main-content"
            :class="{ 'is-fullwidth-content': isFullWidthPage }"
          >
            <RouterView v-slot="{ Component, route: currentRoute }">
              <KeepAlive include="IdeasList">
                <component
                  :is="Component"
                  :key="currentRoute.name === 'ideas-list' ? 'ideas-list' : currentRoute.fullPath"
                />
              </KeepAlive>
            </RouterView>
          </main>

          <!-- 对称 pane + 每 pane 多标签（ADR-0060）。
               pane-layout 整体下移 var(--nav-height)：顶部 48px 是 sticky-header
               窗口拖拽死区 + 右上角系统窗口控制，pane-tabstrip 必须避开两者。 -->
          <div
            v-else
            class="pane-layout"
            :class="{ 'sidebar-collapsed': isSidebarCollapsed }"
          >
            <template
              v-for="(pane, i) in panesStore.panes"
              :key="pane.id"
            >
              <div
                v-if="i > 0"
                class="pane-divider"
                title="拖拽调整宽度"
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
                <!-- 标签条在最上（Obsidian 式），工具栏（后退/前进/面包屑/关闭 pane）在其下 -->
                <header class="pane-tabstrip">
                  <div class="pane-tabs">
                    <div
                      v-for="tab in pane.tabs"
                      :key="tab.id"
                      class="pane-tab"
                      :class="{ 'is-active': tab.id === pane.activeTabId }"
                      :title="tabTitle(tab)"
                      role="tab"
                      @mousedown.stop
                      @click="panesStore.setActiveTab(pane.id, tab.id)"
                    >
                      <span class="pane-tab-title">{{ tabTitle(tab) }}</span>
                      <button
                        class="pane-tab-close"
                        :disabled="panesStore.panes.length <= 1 && pane.tabs.length <= 1"
                        :title="panesStore.panes.length <= 1 && pane.tabs.length <= 1 ? '至少保留一个标签页' : '关闭标签页'"
                        @mousedown.stop
                        @click.stop="panesStore.closeTab(pane.id, tab.id)"
                      >
                        <Icon
                          name="icon-close"
                          :size="12"
                        />
                      </button>
                    </div>
                    <button
                      class="pane-tab-add"
                      title="新建标签页"
                      @mousedown.stop
                      @click="addPageTab(pane.id)"
                    >
                      <Plus :size="14" />
                    </button>
                  </div>
                </header>
                <header class="pane-toolbar">
                  <button
                    class="pane-nav"
                    :disabled="!panesStore.canGoBack(pane.id)"
                    title="后退"
                    @mousedown.stop
                    @click="panesStore.goBack(pane.id)"
                  >
                    <Icon
                      name="icon-arrow-left"
                      :size="16"
                    />
                  </button>
                  <button
                    class="pane-nav"
                    :disabled="!panesStore.canGoForward(pane.id)"
                    title="前进"
                    @mousedown.stop
                    @click="panesStore.goForward(pane.id)"
                  >
                    <Icon
                      name="icon-arrow-right"
                      :size="16"
                    />
                  </button>
                  <nav
                    class="pane-crumb"
                    aria-label="面包屑"
                  >
                    <template v-if="paneParentTitle(pane)">
                      <span
                        class="pane-crumb-parent"
                        :title="paneParentTitle(pane)"
                      >{{ paneParentTitle(pane) }}</span>
                      <ChevronRight
                        :size="12"
                        class="pane-crumb-sep"
                      />
                    </template>
                    <span
                      class="pane-crumb-current"
                      :title="paneTitle(pane)"
                    >{{ paneTitle(pane) }}</span>
                  </nav>
                </header>
                <div class="pane-body">
                  <div
                    v-for="tab in pane.tabs"
                    v-show="tab.id === pane.activeTabId"
                    :key="tab.id"
                    class="pane-tab-view"
                  >
                    <ViewHost :view="currentView(tab)" />
                  </div>
                </div>
              </section>
            </template>
          </div>
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

    <SearchPanel
      :visible="showSearchPanel"
      @close="showSearchPanel = false"
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
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
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
// 标签条抬升到窗口最顶（Obsidian 式）：sticky-header（窗口拖拽死区 + 右上角系统控制，
// z: --z-sticky）仍覆盖顶部 48px，tabstrip/toolbar 以同 token 的 z-index 靠后于 DOM
// 的顺序压在其上；容器 pointer-events:none 让空白区继续透传给 sticky-header 拖拽，
// 仅标签/按钮可点，窗口控制按钮不受遮挡。
.pane-layout {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
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

// 标签条：位于 pane 最顶部（进入 sticky-header 死区），下方分割线。
// 高度与 SidebarHeader 的 32px 对齐（两侧分割线同一水平线）。
// 整条 pointer-events:none：空白区透传给 sticky-header 做窗口拖拽，
// 只有标签本体和「+」可点（click-through），不会遮住右上角系统按钮。
.pane-tabstrip {
  position: relative;
  z-index: var(--z-sticky);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 32px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: transparent;
  pointer-events: none;
  box-sizing: border-box;
}

.pane-tab,
.pane-tab-add {
  pointer-events: auto;
}

// 工具栏：后退/前进 + 面包屑 + 关闭 pane（原 pane-head 改名）
.pane-toolbar {
  position: relative;
  z-index: var(--z-sticky);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: transparent;
  pointer-events: none;
}

.pane-toolbar > * {
  pointer-events: auto;
}

// 侧栏折叠后，悬浮的侧栏开关（fixed, top≈3px, left 8px）落在第一个 pane 的
// 标签条上——给它预留出开关宽度，避免与第一个标签重叠。
.pane-layout.sidebar-collapsed .pane:first-child .pane-tabstrip {
  padding-left: 36px;
}

// 面包屑文本不可点，透传给窗口拖拽
.pane-crumb {
  pointer-events: none;
}

// 面包屑：上级页 → 当前页；两级均可截断，当前页在活动 pane 用主色
.pane-crumb {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--text-sm);
  white-space: nowrap;
  overflow: hidden;
}

.pane-crumb-parent {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-tertiary);
}

.pane-crumb-sep {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.pane-crumb-current {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: var(--font-medium);
  color: var(--text-tertiary);
}

// 活动 pane 用标题颜色深浅区分（非活动 tertiary 浅、活动 primary 深）
.pane.is-active .pane-crumb-current {
  color: var(--text-primary);
}

// 标签页行：只占标签自身宽度（不拉伸到整行，空白区留给窗口拖拽），过多时横向滚动
.pane-tabs {
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: thin;
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
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);

  &.is-active {
    background: var(--bg-active);
    color: var(--text-primary);
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

.pane-tab-add {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: var(--radius-sm);

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
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

.pane-body {
  flex: 1;
  min-height: 0;
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
  flex: 0 0 2px;
  cursor: col-resize;
  background: var(--border);
  transition: background var(--dur-fast) var(--ease-out);
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
