<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, reactive, ref, toRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ExternalLink, FileText, X } from 'lucide-vue-next'
import Block from './index.vue'
import IdeasSnapshotNode from '../Ideas/IdeasSnapshotNode.vue'
import { useBlockStore } from '../../stores/blocks'
import { useBlockCardStore } from '../../stores/blockCard'
import { useEditorStore } from '../../stores/editor'
import { usePageStore } from '../../stores/pages'
import { hasModalOpen } from '../../composables/useModalKeyboard'
import { buildSubtree, buildTree } from '../../composables/useBlockTree'
import {
  SNAPSHOT_MODAL_KEY,
  SNAPSHOT_PROPS_KEY,
  SNAPSHOT_TREE_KEY,
  type SnapshotPropsMap,
  type SnapshotTreeState,
} from '../Ideas/snapshotContext'
import type { IdeasSnapshotData } from '../../utils/ideas-snapshot'
import type { TreeNode } from '../../types/block'

/**
 * 单 block 编辑弹窗（仿 PageDrawer）：列表（任务中心/看板/日历…）点卡片后，
 * 不整页跳转、也不内联编辑，改为居中弹窗内嵌完整 Block 编辑器（Block/index.vue）。
 * 以该 block 为根渲染其完整子树（子任务/备注/检查项均可见可编辑），详见 ADR-0039。
 * 复用 Block/index.vue 全部编辑能力（内容 / 属性 / 状态 / 键盘），与 PageDrawer 内嵌 Page 同理。
 * 受控组件：blockId 非空时显示，close 事件由父级清空；opened 在挂载完成时触发。
 *
 * 双态（ADR-0042 T6）：活上下文（blockModalSnapshotOf 为空）→ 完全可编辑；
 * 快照上下文（blockModalSnapshotOf = 历史 ideas 页 id，由 IdeasSnapshotNode dot 打开）
 * → 只读展示该页 page_snapshots 中的块子树（当日值，内容源 = 快照而非活 store）。
 */
const props = defineProps<{
  /** 打开的 block id；null/空串时弹窗关闭。 */
  blockId: string | null
}>()

const emit = defineEmits<{
  close: []
  opened: []
}>()

const router = useRouter()
const blockStore = useBlockStore()
const editorStore = useEditorStore()
const pageStore = usePageStore()

const visible = computed(() => !!props.blockId)

// 子树编辑器标记：下发给弹窗内所有 <Block>（含后代），
// 用于约束 dot 点击 no-op、根块 Enter 建 child、根块 Outdent no-op（ADR-0039）
provide('inBlockModal', true)
provide('blockModalRootId', toRef(props, 'blockId'))

// ── 双态（ADR-0042 T6）：快照上下文（只读）vs 活上下文（可编辑）──
const snapshotOf = computed(() => editorStore.blockModalSnapshotOf)
const isSnapshotMode = computed(() => !!props.blockId && !!snapshotOf.value)

// 快照上下文只读子树：内容源 = page_snapshots 当日值（非活 store），
// 复用 IdeasSnapshotNode 的只读渲染；折叠状态为弹窗局部（独立于页面）。
const snapshotData = ref<IdeasSnapshotData | null>(null)
const snapshotRoot = ref<TreeNode | null>(null)
const snapshotCollapsed = reactive(new Set<string>())
provide<SnapshotTreeState>(SNAPSHOT_TREE_KEY, {
  isCollapsed: (id) => snapshotCollapsed.has(id),
  toggle: (id) => {
    if (snapshotCollapsed.has(id)) snapshotCollapsed.delete(id)
    else snapshotCollapsed.add(id)
  },
})
provide<SnapshotPropsMap>(SNAPSHOT_PROPS_KEY, {
  propsByBlock: {},
  getBlockProps: (blockId) => snapshotData.value?.properties[blockId] ?? [],
})
/** 快照只读弹窗标记：弹窗内 IdeasSnapshotNode 的 dot 不再递归开弹窗 */
provide(SNAPSHOT_MODAL_KEY, true)

/** 在快照森林中按 id 定位块节点（子树含后代） */
function findNodeById(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = findNodeById(n.children, id)
    if (hit) return hit
  }
  return null
}

// 关闭：清掉弹窗子树内的激活态（根块或任意后代，例如先激活子块再点 X 关闭），
// 再通知父级。仅当激活块落在弹窗子树内才失活，避免误清底层页面的激活块。
// 弹窗内对内容 / 属性的编辑已写入 blockStore 并经 blockCardStore.invalidate 标记投影脏，
// 此处 flush 落库 + 刷脏投影，使四象限 / 看板 / 表格等视图反映最新任务内容
// （否则仅靠 onCellChange 的 refresh 才会重拉，弹窗内编辑不会触发，卡片内容/状态长期陈旧）。
// 关键点：落库与刷投影均为「即发即忘」（fire-and-forget），绝不在关闭路径上 await 任何
// wasm 调用——否则调用挂起会导致 emit('close') 永不触发、弹窗卡死、进而阻塞全部 block 编辑。
function close() {
  const id = props.blockId
  if (id && !isSnapshotMode.value) {
    const activeId = editorStore.activeBlockId
    if (activeId && (activeId === id || isInModalSubtree(activeId))) {
      editorStore.deactivateBlock()
    }
    // flush 落库：编辑器自身 @save 已防抖落库，这里兜底补刷；不 await，避免挂起阻塞关闭。
    // 用 Promise.resolve 包一层，确保 flushSave 缺省时也不会因 .catch 访问 undefined 而抛错。
    Promise.resolve(blockStore.flushSave?.(id)).catch(() => {})
    // 刷脏投影：后台异步重拉，关闭不依赖其结果。
    useBlockCardStore().refreshIfDirty().catch(() => {})
  }
  // 快照上下文无任何写入（只读），跳过 flush/刷投影
  emit('close')
}

/** 判断某 block 是否属于当前弹窗渲染的子树（根或任意后代） */
function isInModalSubtree(id: string): boolean {
  const root = node.value
  if (!root) return false
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    if (n.id === id) return true
    for (const child of n.children) stack.push(child)
  }
  return false
}

// 弹窗内 Block 由 <Block> 直接渲染，没有 BlockList 包裹。而"点击内容激活编辑器"
// 的激活逻辑由 BlockList 的 document 级 mouseup 监听负责（且限定同页 pageId），
// 弹窗场景不经过 BlockList，block 会永远停留在 isActive=false 的只读渲染态，内容无法编辑。
// 这里为弹窗 body 补全等价的点击激活：点击任意 block 即 activateBlock，
// 激活后 Block 渲染编辑组件进入可编辑态（ADR-0039；冻结已退役 ADR-0042 T6）。
function onBodyClick(e: MouseEvent) {
  // 快照上下文只读展示：不激活任何块（内容来自快照，无编辑通路）
  if (isSnapshotMode.value) return
  const target = e.target as HTMLElement
  const blockEl = target.closest('[data-block-id]') as HTMLElement | null
  const bid = blockEl?.dataset.blockId
  if (bid && blockStore.getBlock(bid)) {
    editorStore.activateBlock(bid)
  }
}

const block = computed(() => (props.blockId ? blockStore.getBlock(props.blockId) : null))
const pageId = computed(() => block.value?.pageId ?? null)
/** 弹窗上下文所属页面：快照模式 = 快照来源页；活模式 = 块所在页 */
const contextPageId = computed(() => (isSnapshotMode.value ? snapshotOf.value : pageId.value))
// 所在 Page 标题
const pageTitle = computed(() => {
  const pid = contextPageId.value
  if (!pid) return ''
  return pageStore.getPage(pid)?.title ?? ''
})
// 以目标 block 为根、含完整后代子树的单 TreeNode；<Block> 递归渲染 children，子树整体可见可编辑
const node = computed<TreeNode | null>(() =>
  props.blockId ? buildSubtree(blockStore.blocks, props.blockId) : null,
)

// block 可能尚未在 store（跨页引用 / 懒加载），打开时确保加载真实 block 以驱动编辑器；
// 加载后自动激活根块并聚焦光标，免去"先点一下才能编辑"（ADR-0039）。
// 快照上下文分支：从该页 page_snapshots 读当日块子树（只读），不加载活块、不激活编辑器。
watch(
  [() => props.blockId, () => editorStore.blockModalSnapshotOf],
  async ([id, snapshotPageId]) => {
    if (!id) return
    if (snapshotPageId) {
      snapshotRoot.value = null
      snapshotData.value = null
      try {
        const data = await pageStore.getIdeasSnapshot(snapshotPageId)
        snapshotData.value = data
        if (data) {
          snapshotRoot.value = findNodeById(buildTree(data.blocks, snapshotPageId, null), id)
        }
      } catch (err) {
        /* 读取失败由模板 loading 态兜底，不弹错 */
        console.error('[BlockModal] 读取快照失败:', err)
      }
      return
    }
    try {
      await blockStore.loadBlock(id)
    } catch {
      /* 加载失败（无权限/已删除）由模板 loading 态兜底，不弹错 */
    }
    editorStore.activateBlock(id, 1)
  },
  { immediate: true },
)

// 前往所属页面并定位到该 block（与 PageDrawer.openInPage 同理，但目标是单 block）
function openInPage() {
  const pid = contextPageId.value
  if (!pid || !props.blockId) return
  close()
  router.push({ name: 'page', params: { pageId: pid } })
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('navigate-to-block', { detail: { blockId: props.blockId } }))
  }, 0)
}

// Esc 关闭：若弹窗内有嵌套浮层（斜杠菜单 / 关系菜单 / 选择器等自身已注册模态），
// 先让它们消费 Esc，仅当无浮层打开时才关闭弹窗（ADR-0039 D5）
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && visible.value) {
    if (hasModalOpen()) return
    close()
  }
}
watch(
  visible,
  (v) => {
    if (v) document.addEventListener('keydown', onKeydown)
    else document.removeEventListener('keydown', onKeydown)
  },
  { immediate: true, flush: 'post' },
)

// 弹窗是临时「预览」浮层：任何路由跳转（含弹窗内 [[page]] 链接点击、侧边栏导航等）
// 都意味着底层页面上下文已改变，应一并关闭弹窗（与「前往所属页面」按钮语义一致）。
// 用 afterEach 在导航完成后统一关闭，覆盖所有导航来源且对 openInPage 等幂。
let removeRouteHook: (() => void) | null = null

onMounted(() => {
  if (props.blockId) emit('opened')
  removeRouteHook = router.afterEach(() => {
    if (props.blockId) close()
  })
})

onBeforeUnmount(() => {
  removeRouteHook?.()
  removeRouteHook = null
})
</script>

<template>
  <Teleport to="body">
    <Transition name="block-modal">
      <div
        v-if="blockId"
        class="block-modal-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="isSnapshotMode ? `浏览来自「${pageTitle}」的快照块（只读）` : (pageTitle ? `编辑来自「${pageTitle}」的块` : '编辑块')"
        @click.self="close"
      >
        <div class="block-modal">
          <header class="modal-header">
            <div class="modal-title" :title="pageTitle">
              <span class="modal-title-icon" aria-hidden="true">
                <FileText :size="16" />
              </span>
              <span v-if="pageTitle" class="modal-title-page">{{ pageTitle }}</span>
              <span v-else class="modal-title-placeholder">块详情</span>
              <span v-if="isSnapshotMode" class="modal-readonly-tag">快照只读</span>
            </div>
            <div class="modal-actions">
              <button
                class="modal-action"
                type="button"
                title="前往所属页面"
                data-testid="block-modal-open"
                @click="openInPage"
              >
                <ExternalLink :size="18" />
              </button>
              <span class="modal-esc-hint" aria-hidden="true">Esc</span>
              <button
                class="modal-action modal-action-close"
                type="button"
                title="关闭 (Esc)"
                data-testid="block-modal-close"
                @click="close"
              >
                <X :size="18" />
              </button>
            </div>
          </header>
          <div class="modal-body" @click="onBodyClick">
            <!-- 快照上下文（ADR-0042 T6）：只读展示当日快照子树，复用 IdeasSnapshotNode 只读渲染 -->
            <div v-if="isSnapshotMode" class="modal-content">
              <IdeasSnapshotNode
                v-if="snapshotRoot"
                :node="snapshotRoot"
                :page-id="contextPageId!"
                :depth="0"
              />
              <div v-else class="modal-loading">
                <span class="modal-spinner" aria-hidden="true"></span>
                {{ snapshotData ? '快照中无此块' : '加载中…' }}
              </div>
            </div>
            <!-- 活上下文：完整 Block 子树编辑器（冻结已退役，历史页活块同样可编辑） -->
            <div v-else-if="node" class="modal-content">
              <Block :node="node" :page-id="contextPageId!" :depth="0" />
            </div>
            <div v-else class="modal-loading">
              <span class="modal-spinner" aria-hidden="true"></span>
              加载中…
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style lang="scss" scoped>
.block-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-dialog);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6);
  background: var(--overlay);
  backdrop-filter: blur(6px);
}

.block-modal {
  width: min(94vw, 680px);
  min-height: 320px;
  max-height: min(90vh, 760px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-modal);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 10px 10px 10px var(--space-4);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  min-width: 0;
  background: var(--bg-base2);
}

.modal-title {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: var(--font-medium);
  color: var(--text-secondary);
}

.modal-title-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  color: var(--text-tertiary);
}

.modal-title-page {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.modal-title-placeholder {
  color: var(--text-tertiary);
}

.modal-readonly-tag {
  flex-shrink: 0;
  padding: 1px 8px;
  margin-left: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 999px;
  user-select: none;
}

.modal-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.modal-action {
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--text-tertiary);
  border-radius: var(--radius-sm);
  transition:
    background-color 0.12s ease,
    color 0.12s ease,
    transform 0.08s ease;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background-color: var(--bg-hover);
    color: var(--text-primary);
  }

  &:active {
    transform: scale(0.94);
  }

  &:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
}

.modal-action-close:hover {
  background-color: var(--accent-08);
  color: var(--accent);
}

.modal-esc-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 6px;
  font-size: 11px;
  font-family: var(--font-mono);
  line-height: 1;
  color: var(--text-tertiary);
  background: var(--bg-hover);
  border-radius: 4px;
  user-select: none;
}

.modal-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-2) 0 var(--space-4);
}

.modal-content {
  max-width: 640px;
  margin: 0 auto;
  padding: 0 var(--space-5);
}

.modal-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  color: var(--text-tertiary);
  font-size: var(--text-sm);
  padding: var(--space-8) var(--space-4);
}

.modal-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-light);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: block-modal-spin 0.7s linear infinite;
}

@keyframes block-modal-spin {
  to {
    transform: rotate(360deg);
  }
}

.block-modal-enter-active,
.block-modal-leave-active {
  transition: opacity 0.18s ease;
}

.block-modal-enter-active .block-modal,
.block-modal-leave-active .block-modal {
  transition:
    transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    opacity 0.18s ease;
}

.block-modal-enter-from,
.block-modal-leave-to {
  opacity: 0;
}

.block-modal-enter-from .block-modal,
.block-modal-leave-to .block-modal {
  transform: translateY(12px) scale(0.97);
  opacity: 0;
}

@media (max-width: 640px) {
  .block-modal-overlay {
    padding: 0;
  }

  .block-modal {
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
  }

  .modal-esc-hint {
    display: none;
  }
}
</style>
