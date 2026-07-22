import { computed, ref } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import { useNavigateToPage } from '../../../composables/useNavigateToPage'
import { useRelationshipMenu } from '../../../composables/useRelationshipMenu'
import {
  useDateTimePickerPanel,
  useDateRefClickListener,
  computeDatePickerPosition
} from '../../../composables/useDateTimePickerPanel'
import { DATE_REF_REGEX, serializeDateRef, normalizeRecurrence } from '../../../utils/date-ref'
import type { useBlockStore } from '../../../stores/blocks'
import type { useEditorStore } from '../../../stores/editor'
import type { usePageStore } from '../../../stores/pages'
import type { useBlockRelationshipCleanup } from '../../../composables/useBlockRelationshipCleanup'
import type { CrossBlockSelection } from '../../../composables/useCrossBlockSelection'
import type { BlockTypeEditorExposed, BlockTypeHandler } from '../../../types/block-type'

/**
 * useBlockEditorLifecycle — Block 编辑器生命周期 composable
 *
 * 从 Block/index.vue 抽取的编辑器生命周期逻辑：
 * - `isActive` 计算属性
 * - `handleSave` / `handleLanguageChange` / `handleClear`
 * - `syncBlockContent` / `withContentSync` 高阶函数
 * - `handleSplit` / `handleMerge` / `handleDelete`（B2 决策：handleDelete 合并到此）
 * - `handleIndent` / `handleOutdent` / `handleMoveUp` / `handleMoveDown` / `handleExitEdit`
 * - `handleCursorChange`
 * - `handleContentMousedown` / `handleContentClick`（含 rel-type-label / date-ref / wiki-link 处理）
 *
 * 保留在 index.vue 中：
 * - `watch(isActive, ...)` 观察器：涉及 nextTick / requestAnimationFrame / editorRef，
 *   属于渲染周期协调，留在组件内更合适。
 *
 * 内部调用：
 * - `useNavigateToPage` — wiki-link 导航
 * - `useRelationshipMenu` — rel-type-label 切换菜单
 * - `useDateTimePickerPanel` — date-ref 编辑面板
 * - `useDateRefClickListener` — 全局 date-ref 点击监听
 */
interface UseBlockEditorLifecycleOptions {
  blockId: Ref<string>
  pageId: string
  editorRef: Ref<BlockTypeEditorExposed | null>
  cursorPos: Ref<number>
  collapsed: Ref<boolean>
  blockStore: ReturnType<typeof useBlockStore>
  editorStore: ReturnType<typeof useEditorStore>
  pageStore: ReturnType<typeof usePageStore>
  relationshipCleanup: ReturnType<typeof useBlockRelationshipCleanup>
  selection?: CrossBlockSelection | null
  /** 当前 block 的类型 handler（由 index.vue 通过 useBlockRegistry 计算） */
  handler?: Ref<BlockTypeHandler | undefined>
  /** 读取 block 属性（由 index.vue 通过 useBlockPropertySync 提供） */
  getBlockProperty?: (key: string) => string | undefined
}

export function useBlockEditorLifecycle(options: UseBlockEditorLifecycleOptions) {
  const {
    blockId,
    pageId,
    editorRef,
    cursorPos,
    collapsed,
    blockStore,
    editorStore,
    pageStore,
    relationshipCleanup,
    selection = null,
    handler = ref(undefined) as Ref<BlockTypeHandler | undefined>,
    getBlockProperty = () => undefined,
  } = options

  // ── 内部依赖的 composables ──
  const { navigateToPage } = useNavigateToPage()
  const relMenu = useRelationshipMenu()
  const { open: openDateRefPanel } = useDateTimePickerPanel()

  // 注册全局 date-ref 点击监听（onMounted/onBeforeUnmount 内部处理）
  useDateRefClickListener((payload, position) => {
    openDateRefPanel({ ...payload, position })
  })

  // ── embed block 选择器状态（handleContentClick 设置 / handleEmbedSelect 清除）──
  const showBlockSelector = ref(false)

  // ── 计算属性 ──
  const isActive: ComputedRef<boolean> = computed(
    () => editorStore.activeBlockId === blockId.value
  )

  // ── 保存 / 同步 ──
  async function handleSave(content: string) {
    return await blockStore.updateBlockContent(blockId.value, content)
  }

  async function handleLanguageChange(lang: string) {
    await blockStore.updateBlockProperties(blockId.value, { language: lang })
  }

  /** 同步 block 未保存内容到 store */
  async function syncBlockContent() {
    if (editorRef.value) {
      editorRef.value.markSaved()
      const editorComponent = editorRef.value as any
      if (editorComponent.cancelDebouncedSave) {
        editorComponent.cancelDebouncedSave()
      }
      await handleSave(editorRef.value.getText())
    }
  }

  /** 高阶函数：统一处理内容同步 */
  function withContentSync<T extends (...args: any[]) => Promise<void>>(fn: T): T {
    return (async (...args: Parameters<T>) => {
      await syncBlockContent()
      return fn(...args)
    }) as T
  }

  // ── 编辑操作 ──
  const handleSplit = withContentSync(async (cursorPosArg: number) => {
    editorStore.deactivateBlock()
    const newBlock = await blockStore.insertBlockAtCursor(blockId.value, cursorPosArg, collapsed.value)
    if (newBlock) {
      editorStore.activateBlock(newBlock.id, 1)
    }
  })

  const handleMerge = withContentSync(async () => {
    editorStore.deactivateBlock()
    const result = await blockStore.mergeWithPrevious(blockId.value)
    if (result) {
      editorStore.activateBlock(result.id, result.cursorPos)
    }
  })

  async function handleDelete() {
    const prevBlock = blockStore.findPreviousBlockInTreeOrder(blockId.value)
    const prevId = prevBlock?.id

    if (!prevId) {
      if (editorRef.value) editorRef.value.markSaved()
      await blockStore.updateBlockContent(blockId.value, '')
      return
    }

    if (editorRef.value) editorRef.value.markSaved()
    editorStore.deactivateBlock()
    await relationshipCleanup.cleanupAfterDelete(pageId, [blockId.value])
    if (prevId) {
      editorStore.activateBlock(prevId)
    }
  }

  const handleIndent = withContentSync(async () => {
    editorStore.deactivateBlock()
    await blockStore.indent(blockId.value)
    editorStore.activateBlock(blockId.value)
  })

  const handleOutdent = withContentSync(async () => {
    editorStore.deactivateBlock()
    await blockStore.outdent(blockId.value)
    editorStore.activateBlock(blockId.value)
  })

  const handleMoveUp = withContentSync(async () => {
    const prevBlock = blockStore.findPreviousBlockInTreeOrder(blockId.value)
    if (prevBlock) {
      editorStore.deactivateBlock()
      editorStore.activateBlock(prevBlock.id)
    }
  })

  const handleMoveDown = withContentSync(async () => {
    const nextBlock = blockStore.findNextBlockInTreeOrder(blockId.value)
    if (nextBlock) {
      editorStore.deactivateBlock()
      editorStore.activateBlock(nextBlock.id)
    }
  })

  const handleExitEdit = withContentSync(async () => {
    editorStore.deactivateBlock()
  })

  async function handleClear() {
    if (editorRef.value) editorRef.value.markSaved()
    await blockStore.updateBlockContent(blockId.value, '')
  }

  function handleCursorChange(pos: number) {
    cursorPos.value = pos
  }

  // ── 鼠标交互 ──
  /** mousedown：捕获点击坐标，在 tiptap 挂载前通知 editor store */
  function handleContentMousedown(e: MouseEvent) {
    const target = e.target as HTMLElement
    // .block-link 与 .rel-type-label 与 .date-ref 都由 handleContentClick 处理点击，
    // 不要让 mousedown 触发激活导致 BulletRender 被替换、
    // 进而让后续 click 事件落在新挂载的 Editor 上。
    if (target.closest('.block-link')) return
    if (target.closest('.rel-type-label')) return
    if (target.closest('.date-ref')) return

    if (handler.value?.type === 'embed' && getBlockProperty('sourceBlockId')) {
      e.preventDefault()
      return
    }

    if (e.ctrlKey || e.metaKey) {
      if (selection) {
        selection.toggleBlock(blockId.value, pageStore.currentPageId)
        e.preventDefault()
      }
      return
    }

    // 已激活的 block 交给 ProseMirror 原生处理光标定位
    if (editorStore.activeBlockId === blockId.value) return

    // 保存鼠标坐标，Editor 挂载后用 posAtCoords 精确定位
    editorStore.setClickCoords(e.clientX, e.clientY)

    if (selection) {
      selection.startTracking(blockId.value)
    }
  }

  function handleContentClick(e: MouseEvent) {
    if (handler.value?.type === 'embed') {
      const sourceBlockId = getBlockProperty('sourceBlockId')
      if (sourceBlockId) {
        const sourcePage = pageStore.pages.find(p => p.id === getBlockProperty('sourcePageId'))
        if (sourcePage) {
          navigateToPage(sourcePage.title)
        }
      } else {
        showBlockSelector.value = true
      }
      return
    }

    const target = e.target as HTMLElement

    const relLabel = target.closest('.rel-type-label') as HTMLElement | null
    if (relLabel) {
      const relType = relLabel.dataset.relType
      const targetBlockId = relLabel.dataset.blockId
      const labelFrom = Number(relLabel.dataset.labelFrom)
      const labelTo = Number(relLabel.dataset.labelTo)
      if (!relType || !targetBlockId || Number.isNaN(labelFrom) || Number.isNaN(labelTo)) return

      if (!blockStore.blocks.find(b => b.id === targetBlockId)) return

      const rect = relLabel.getBoundingClientRect()
      e.preventDefault()
      e.stopPropagation()

      relMenu.openSwitch({
        view: { dom: { isConnected: true } },
        position: { x: rect.left, y: rect.bottom + 4 },
        range: { from: labelFrom, to: labelTo },
        currentType: relType,
        onSelect: (newType) => {
          const latest = blockStore.blocks.find(b => b.id === targetBlockId)
          if (!latest) return
          const newContent = latest.content.slice(0, labelFrom) + newType + latest.content.slice(labelTo)
          blockStore.updateBlockContent(targetBlockId, newContent)
        }
      })
      return
    }

    // ── dateRef 阅读态点击（非 PM 编辑器环境，span 由 useContentRenderer 渲染）──
    const dateRefSpan = target.closest('.date-ref') as HTMLElement | null
    if (dateRefSpan) {
      e.preventDefault()
      const raw = dateRefSpan.dataset.raw
      const kind = dateRefSpan.dataset.kind as string | undefined
      const iso = dateRefSpan.dataset.iso
      const recurrence = dateRefSpan.dataset.recurrence
      const leadMinutes = parseInt(dateRefSpan.dataset.leadMinutes || '0', 10) || 0
      if (!raw || !kind || !iso || !recurrence) return

      // 在 block.content 中查找该 span 对应的 {{...}} 位置
      // 先数一下该 span 在同级 .block-text 内是第几个 .date-ref（支持重复内容）
      const blockText = dateRefSpan.closest('.block-text')
      let occurrence = 0
      if (blockText) {
        const allDateRefs = blockText.querySelectorAll('.date-ref')
        for (let i = 0; i < allDateRefs.length; i++) {
          if (allDateRefs[i] === dateRefSpan) {
            occurrence = i
            break
          }
        }
      }

      const content = blockStore.blocks.find(b => b.id === blockId.value)?.content ?? ''
      let idx = -1
      let matchCount = 0
      const searchPattern = new RegExp(DATE_REF_REGEX.source, 'g')
      let m: RegExpExecArray | null
      while ((m = searchPattern.exec(content)) !== null) {
        const matchedRaw = serializeDateRef({
          kind: m[1] as any,
          iso: m[2],
          recurrence: normalizeRecurrence(m[3]),
          leadMinutes: m[4] ? parseInt(m[4], 10) || 0 : 0,
        })
        if (matchedRaw === raw && matchCount === occurrence) {
          idx = m.index
          break
        }
        matchCount++
      }
      if (idx === -1) return

      // 垂直用 block 底部，水平用 date-ref 文字左侧对齐
      openDateRefPanel(
        {
          blockId: blockId.value,
          from: idx,
          to: idx + raw.length,
          kind: kind as any,
          iso,
          recurrence: recurrence as any,
          leadMinutes,
          position: computeDatePickerPosition(dateRefSpan),
        },
        'content'
      )
      return
    }

    const link = target.closest('.block-link') as HTMLElement | null
    if (!link) return

    if (link.dataset.external) {
      window.open(link.dataset.external, '_blank', 'noopener,noreferrer')
      return
    }
    const pageName = link.dataset.page
    if (pageName) {
      navigateToPage(pageName).catch(err => {
        console.error('导航失败:', err)
      })
    }
  }

  return {
    isActive,
    showBlockSelector,
    handleSave,
    handleLanguageChange,
    syncBlockContent,
    withContentSync,
    handleSplit,
    handleMerge,
    handleDelete,
    handleIndent,
    handleOutdent,
    handleMoveUp,
    handleMoveDown,
    handleExitEdit,
    handleClear,
    handleCursorChange,
    handleContentMousedown,
    handleContentClick,
  }
}
