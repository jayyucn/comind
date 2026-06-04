<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Sidebar from './components/Sidebar/index.vue'
import PageMenuButton from './components/PageMenuButton.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import SettingsModal from './components/Settings/SettingsModal.vue'
import { useEditorStore } from './stores/editor'
import { useBlockStore } from './stores/blocks'
import { usePageStore } from './stores/pages'
import { storage } from './storage/indexedDB'
import { useSidebar } from './composables/useSidebar'
import { useRightSidebar } from './composables/useRightSidebar'
import { useRelationshipTypes } from './composables/useRelationshipTypes'
import { ArrowLeft, ArrowRight, PanelLeftClose, PanelLeftOpen, PanelRightOpen, PanelRightClose } from 'lucide-vue-next'
import RightSidebar from './components/RightSidebar/index.vue'
import { registerPanel } from './components/RightSidebar/panels'
import ConceptGraphPanel from './components/ConceptGraph/Panel.vue'

registerPanel({
  id: 'concept-graph',
  label: '概念图谱',
  icon: '🧠',
  component: ConceptGraphPanel
})

const { isCollapsed, toggle } = useSidebar()
const rightSidebar = useRightSidebar()

const editorStore = useEditorStore()
const route = useRoute()
const blockStore = useBlockStore()
const pageStore = usePageStore()

onMounted(async () => {
  await useRelationshipTypes().load()
})

type HistoryItem = {
  path: string
  pageId?: string
}

const historyStack = ref<HistoryItem[]>([{ path: '' }])
const historyIndex = ref(0)

const showTrashedPageWarning = ref(false)
const trashedPageToRestore = ref<string | null>(null)

watch(() => route.fullPath, async (newPath) => {
  if (newPath === historyStack.value[historyIndex.value]?.path) return

  if (historyIndex.value < historyStack.value.length - 1) {
    historyStack.value = historyStack.value.slice(0, historyIndex.value + 1)
  }

  // 尝试获取当前页面ID
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

watch(() => blockStore.trashedPageWarnings, async (warnings) => {
  if (warnings && warnings.length > 0) {
    trashedPageToRestore.value = warnings[0]
    showTrashedPageWarning.value = true
  }
})

async function confirmRestoreTrashedPage() {
  if (trashedPageToRestore.value) {
    const trashedPage = await storage.getTrashedPageByTitle(trashedPageToRestore.value)
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
  // 过滤掉包含该页面ID的历史记录
  const newStack = historyStack.value.filter(item => item.pageId !== pageId)

  // 如果当前指向的页面被删除了，需要调整索引
  if (historyIndex.value >= newStack.length) {
    historyIndex.value = Math.max(0, newStack.length - 1)
  }

  // 如果新栈长度为0，添加默认路径
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
  if (target.closest('.block')) return
  editorStore.deactivateBlock()
}
</script>

<template>
  <div class="app-layout">
    <Sidebar />

    <div class="page-scroll-wrapper" @click="handleMainClick">
      <div class="nav-controls">
        <button class="collapse-btn" :title="isCollapsed ? '展开侧边栏' : '折叠侧边栏'" @click="toggle">
          <PanelLeftClose v-if="!isCollapsed" />
          <PanelLeftOpen v-else />
        </button>
        <template v-if="!isCollapsed">
          <button class="nav-btn" :class="{ disabled: !canGoBack }" :disabled="!canGoBack" title="后退"
            @click="handleGoBack">
            <span class="nav-icon left-icon">
              <ArrowLeft :size="16" :stroke-width="1.75" />
            </span>
          </button>
          <button class="nav-btn" :class="{ disabled: !canGoForward }" :disabled="!canGoForward" title="前进"
            @click="handleGoForward">
            <span class="nav-icon right-icon">
              <ArrowRight :size="16" :stroke-width="1.75" />
            </span>
          </button>
        </template>
      </div>

      <div class="top-right-controls">
        <PageMenuButton />
        <button
          class="right-sidebar-toggle"
          :title="rightSidebar.visible.value ? '关闭右侧面板' : '打开概念图谱'"
          @click="rightSidebar.toggleVisible()"
        >
          <PanelRightClose v-if="rightSidebar.visible.value" :size="16" :stroke-width="1.75" />
          <PanelRightOpen v-else :size="16" :stroke-width="1.75" />
        </button>
      </div>

      <div class="page-body">
        <main class="main-content">
          <RouterView />
        </main>
      </div>
    </div>

    <RightSidebar />

    <ConfirmDialog :visible="showTrashedPageWarning" title="页面已在回收站中"
      :message="`页面「${trashedPageToRestore || ''}」曾在回收站中。是否要恢复该页面？`" confirm-text="恢复页面" cancel-text="忽略"
      @confirm="confirmRestoreTrashedPage" @cancel="cancelRestoreTrashedPage" />

    <SettingsModal />
  </div>
</template>

<style scoped>
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
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
  scrollbar-width: none;
  position: relative;
}

.collapse-btn {
  width: 36px;
  height: 36px;
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

.collapse-btn:hover {
  color: var(--text-secondary);
}

.collapse-btn:active {
  transform: scale(0.95);
}

.nav-controls {
  position: sticky;
  top: 12px;
  left: 12px;
  display: flex;
  gap: 4px;
  z-index: 10;
  width: fit-content;
}

.nav-btn {
  width: 30px;
  height: 30px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-tertiary);
  transition: all 100ms ease;
}

.nav-btn:hover:not(.disabled) {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.nav-btn:active:not(.disabled) {
  background: var(--bg-active);
  transform: scale(0.95);
}

.nav-btn.disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
}

.page-scroll-wrapper::-webkit-scrollbar {
  display: none;
}

.page-body {
  max-width: 800px;
  min-width: 0;
  margin: 0 auto;
  padding: 0 24px;
}

.main-content {
  padding: 48px 0;
}

.top-right-controls {
  position: sticky;
  top: 12px;
  display: flex;
  align-items: center;
  gap: 2px;
  z-index: 10;
  justify-content: flex-end;
  padding-right: 12px;
  margin-top: -48px;
  pointer-events: none;
}

.top-right-controls > * {
  pointer-events: auto;
}

.right-sidebar-toggle {
  width: 32px;
  height: 32px;
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
</style>
