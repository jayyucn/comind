import type { ComputedRef, Ref } from 'vue'
import { computed, getCurrentScope, inject, nextTick, onScopeDispose } from 'vue'

import type { useBlockRelationshipCleanup } from '../../../composables/useBlockRelationshipCleanup'
import { parseParagraphStyle } from '../../../composables/useContentRenderer'
import type { CrossBlockSelection } from '../../../composables/useCrossBlockSelection'
import {
  computeDatePickerPosition,
  useDateRefClickListener,
  useDateTimePickerPanel
} from '../../../composables/useDateTimePickerPanel'
import { useNavigateToPage } from '../../../composables/useNavigateToPage'
import { useNavigateToTag } from '../../../composables/useNavigateToTag'
import { useOpenPageInOtherPane } from '../../../composables/useOpenPageInOtherPane'
import { useRelationshipMenu } from '../../../composables/useRelationshipMenu'
import { renderedOffsetToEncodedOffset } from '../../../services/render-text'
import { blockOffsetFromPoint, caretBlockOffsetFromDomSelection, SELECTION_IGNORE_SELECTOR } from '../../../services/selection-geometry'
import type { useBlockStore } from '../../../stores/blocks'
import type { useEditorStore } from '../../../stores/editor'
import type { usePageStore } from '../../../stores/pages'
import { useTagsStore } from '../../../stores/tags'
import type { BlockTypeEditorExposed } from '../../../types/block-type'
import { calloutToneOf } from '../../../utils/callout'
import { DATE_REF_AT_REGEX, type DateRefKind, normalizeRecurrence, type RecurrenceRule, serializeDateRef } from '../../../utils/date-ref'
import { openExternalUrl } from '../../../utils/external-link'
import type { InlineMarkRange } from '../../../utils/inline-marks'
import { mapInlineMarkOffsets, readInlineMarks } from '../../../utils/inline-marks'
import {
  encodeRelationshipContentWithMeta,
  takeRelationshipSnapshot,
} from '../../../utils/relationship-content'

/**
 * Tab / Shift+Tab 的方向。
 */
type IndentDirection = 'indent' | 'outdent'

/**
 * 缩进请求队列 —— **模块级**（跨组件实例共享），这是关键。
 *
 * 缩进要把块换到新父节点下 ⇒ Block 组件重挂载 ⇒ composable 也重建。若把队列放在实例内，
 * 旧实例带着队列一起销毁，新实例另起一轮：既不知道「上一轮还没跑完」，也接不到已经
 * 排进去的按键。放模块级后，重挂载期间旧闭包仍在把队列排空，新实例只负责往里 push。
 */
const indentQueues = new Map<string, IndentDirection[]>()
/** 正在把某个块的队列排空的灯（同一块同时只允许一条缩进流水线） */
const indentRunning = new Set<string>()
/**
 * blockId → 「把停放着的队列重新跑起来」的启动器。
 *
 * 捕获器可能把按键塞进**已经排空的**队列（最后一格缩进完、焦点还没落回编辑器的
 * 那一两帧），此时没有任何流水线在等它 ⇒ 需要有人重新起一轮。启动器由组件实例登记
 * （按实例身份注销，与 `useBlockEntryMenuExtra` 同一套），块重挂载后新实例重新登记。
 */
const indentDrainStarters = new Map<string, () => void>()

/**
 * 缩进窗口期（编辑器被卸下 → 重新挂上，约 30–50ms）的 Tab 捕获器。
 *
 * 这段窗口里没有任何元素接收 PM 快捷键，Tab 落到 body 上就没了 —— 连按 3 次的第 2、3 次
 * 就是这么丢的。只在有块正在缩进时挂上，命中非输入控件才收：编辑器已回来时 target 是
 * `.tiptap[contenteditable]`，交给 PM 自己处理，不抢。
 */
let indentTabCapture: ((e: KeyboardEvent) => void) | null = null
let indentTabDetachTimer: ReturnType<typeof setTimeout> | null = null
/** 缩进窗口期归属的块：drain 开始设、宽限期结束清（捕获器靠它判断「这键该归谁」） */
let indentOwner: string | null = null

function attachIndentTabCapture(owner: string): void {
  indentOwner = owner
  if (indentTabDetachTimer !== null) {
    clearTimeout(indentTabDetachTimer)
    indentTabDetachTimer = null
  }
  if (indentTabCapture) return
  indentTabCapture = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.defaultPrevented) return
    const target = e.target as HTMLElement | null
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
    const blockId = indentOwner
    if (!blockId) return
    e.preventDefault()
    const queue = indentQueues.get(blockId) ?? []
    if (!indentQueues.has(blockId)) indentQueues.set(blockId, queue)
    queue.push(e.shiftKey ? 'outdent' : 'indent')
    if (!indentRunning.has(blockId)) indentDrainStarters.get(blockId)?.()
  }
  document.addEventListener('keydown', indentTabCapture, true)
}

/**
 * 队列排空后不要立刻摘监听：`activateBlock` 只是把编辑器挂上去，焦点要等下一个
 * nextTick + 一帧才落回编辑器。这个空档（~1–2 帧）里的 Tab 仍会落到 body，留着监听才不会丢。
 */
function scheduleIndentTabCaptureDetach(): void {
  if (!indentTabCapture || indentTabDetachTimer !== null) return
  indentTabDetachTimer = setTimeout(() => {
    indentTabDetachTimer = null
    if (indentRunning.size > 0) return
    indentOwner = null
    if (indentTabCapture) document.removeEventListener('keydown', indentTabCapture, true)
    indentTabCapture = null
  }, 200)
}

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
 * - `useNavigateToTag` — inline `#tag` chip 导航到标签聚合页（ADR-0050 D7）
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
  /** 所属 pane id（由 ViewHost provide 下发）。双 pane 同页靠它区分活动块。无则退化为全局口径。 */
  paneId?: string | null
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
    paneId = null,
  } = options

  // 子树编辑器根块标记（仅 BlockModal 通过 provide 下发；主编辑器无此注入）。
  // 用于约束：根块 Enter 建 child 而非页面级兄弟、根块 Outdent 不逃出子树（ADR-0039）。
  const blockModalRootId = inject<Ref<string | null> | null>('blockModalRootId', null)

  // ── 内部依赖的 composables ──
  const { navigateToPage } = useNavigateToPage()
  const { navigateToTag } = useNavigateToTag()
  const { openPageInOtherPane } = useOpenPageInOtherPane()
  const relMenu = useRelationshipMenu()
  const { open: openDateRefPanel } = useDateTimePickerPanel()
  const tagsStore = useTagsStore()

  /**
   * 兜底渲染的 tag chip 只有标题（无 data-tag-id）：按标题反查 id。
   * 标签树未加载或查无此 tag → 空串（调用方保持「无行为」），不做任何页面跳转兜底。
   */
  function tagIdByTitle(title?: string): string {
    if (!title) return ''
    return tagsStore.allTags.find(t => t.title === title)?.id ?? ''
  }

  // 注册全局 date-ref 点击监听（onMounted/onBeforeUnmount 内部处理）
  useDateRefClickListener((payload, position) => {
    openDateRefPanel({ ...payload, position })
  })

  // ── 计算属性 ──
  /**
   * 本块是否处于激活（编辑）态。
   * 双 pane 同页时必须按 pane 作用域化：两个 pane 渲染同一页、块 id 完全相同，
   * 若只看 `activeBlockId` 两边都会 isActive 并抢焦点（焦点落到后挂载 pane）。
   * 退化口径：本块不在 pane 内（弹窗 / 测试）或当前无 pane 归属时，回退为只看 activeBlockId。
   */
  const isActive: ComputedRef<boolean> = computed(() => {
    if (editorStore.activeBlockId !== blockId.value) return false
    if (paneId == null || editorStore.activeBlockPaneId == null) return true
    return editorStore.activeBlockPaneId === paneId
  })

  // ── 保存 / 同步 ──
  /**
   * 保存内容到 store 并立即 flush 到后端，确保 renderSegments 已写回。
   *
   * `commitTags`（默认 true = 提交动作）透传给建签门：Editor 的防抖打字保存传 false，
   * `#f`、`#fo` 这类中间前缀不落标签表；blur / 拆分 / 缩进等 withContentSync 操作走 true。
   */
  async function handleSave(
    content: string,
    commitTags = true,
    flush = true,
    marks?: InlineMarkRange[],
  ) {
    // 编辑态显示中文 label → 存储英文 type（encode）
    // 快照保证改名后未编辑的 label 也能还原为原始 type
    const snapshot = takeRelationshipSnapshot(blockId.value)
    const { text: stored, spans } = encodeRelationshipContentWithMeta(content, snapshot)
    const encodedMarks = marks === undefined
      ? undefined
      : mapInlineMarkOffsets(marks, spans, 'toNew', stored.length)
    await blockStore.updateBlockContent(blockId.value, stored, { commitTags, inlineMarks: encodedMarks })
    // 方案 A: 立即 flush，确保 renderSegments 已写回，
    // 避免后续 deactivateBlock 时渲染组件因 renderSegments=undefined 闪现纯文本。
    // flush=false 时不阻塞等待落库（落库改由防抖后台调度），用于拆分等需低延迟的场景。
    if (flush) await blockStore.flushSave(blockId.value)
  }

  async function handleLanguageChange(lang: string) {
    await blockStore.updateBlockFieldValues(blockId.value, { language: lang })
  }

  /** 同步 block 未保存内容到 store */
  async function syncBlockContent(flush = true) {
    if (editorRef.value) {
      editorRef.value.markSaved()
      const editorComponent = editorRef.value
      if (editorComponent.cancelDebouncedSave) {
        editorComponent.cancelDebouncedSave()
      }
      const payload = editorRef.value.getContent?.()
      await handleSave(payload?.text ?? editorRef.value.getText(), true, flush, payload?.marks)
    }
  }

  /** 高阶函数：统一处理内容同步
   * @param opts.flush 是否 await 强制落库（默认 true）。false 时仅做内存 encode 同步 +
   *   防抖后台调度保存，不阻塞后续结构操作；由调用方在确有需要时（如中部分拆 renderSegments
   *   被清空）自行 await flushSave。 */
  function withContentSync<T extends (...args: never[]) => Promise<void>>(fn: T, opts: { flush?: boolean } = {}): T {
    return (async (...args: Parameters<T>) => {
      await syncBlockContent(opts.flush ?? true)
      return fn(...args)
    }) as T
  }

  /**
   * 失活前的「非必要不落库」判据（跨块方向键热路径用）。
   *
   * `withContentSync(fn, { flush: false })` 只做内存 encode 同步：内容真变了才会把
   * `renderSegments` 清空（`updateBlockContent` 见 content 变化即置 undefined），此时
   * 必须等落库回写 —— 否则失活瞬间渲染态退回纯文本（与 runSplit 同一判据、同一理由）。
   * 内容没变（只是按方向键离开）则**跳过**：`flushSave` 无 pending 也会补跑一次
   * `saveBlockTree`（WASM 落库 ~34–386ms，见 87d78ac），把它留在方向键热路径上
   * 就是「按方向键卡顿」。空白新块本无 segments 且无内容，同样无需等。
   */
  async function awaitSegmentsIfStale(): Promise<void> {
    const block = blockStore.getBlock(blockId.value)
    if (!block?.renderSegments && (block?.content.length ?? 0) > 0) {
      await blockStore.flushSave(blockId.value)
    }
  }

  // ── 编辑操作 ──
  /**
   * 连按/长按 Enter 的重入守卫。
   *
   * `runSplit` 体内含真实 await（可选 flush、位置重编号），期间 DOM 焦点仍在旧编辑器上，
   * 下一次 Enter 会在窗口内携带同一 pos 再次触发。若并发执行，同一原块被拆两次、偏移基准
   * 过期、激活落点由完成顺序决定 —— 表现为连按回车「漏一次 / 光标跳错块」。
   *
   * 守卫语义：不丢弃输入（避免真的漏回车）。重入的 Enter 只计次，待当前拆分落定后，
   * 在新激活的空块行尾逐一补建，保持「N 次 Enter ⇒ N 个新块、光标停在最后一个」，全程串行。
   */
  let splitInFlight = false
  let pendingSplitCount = 0

  /**
   * 列表续行的前缀：
   * - 非列表项 → `null`（不干预：普通段落 / 标题按原逻辑拆分，标题不续行是既定行为）
   * - 空列表项（`- ` 后面没有正文）→ `''`：退出列表，源块去掉标记、新块不带标记
   * - 有正文的列表项 → 下一个标记。**有序的号向父调度器要**（推导值 + 1，含锚点影响），
   *   而不是「字面 + 1」—— 正在打字的块字面可能落后于推导（手写跳号 / 前面刚删过项）。
   */
  function listContinuationPrefix(targetBlockId: string): string | null {
    const content = blockStore.getBlock(targetBlockId)?.content ?? ''
    const paragraph = parseParagraphStyle(content)
    if (paragraph.style !== 'ul' && paragraph.style !== 'ol') return null
    if (paragraph.title.trim() === '') return ''
    return paragraph.style === 'ul' ? '- ' : `${blockStore.nextOrderedListIndex(targetBlockId)}. `
  }

  /** 连按 Enter 的续号：`2. ` → `3. `；无序标记原样返回 */
  function nextListPrefix(prefix: string): string {
    const ordered = prefix.match(/^(\d+)\.\s$/)
    return ordered ? `${Number(ordered[1]) + 1}. ` : prefix
  }

  /**
   * 给刚拆出来的块补上列表标记（在激活之前调用 —— 激活后再改 store，编辑器里还是旧正文）。
   * 行内格式随前缀右移：不传 marks 会被 `updateBlockContent` 清掉（正文变了又没给 marks
   * 时的既定行为），拆出来的半截粗体会无声消失。
   */
  async function prefixNewListItem(targetId: string, prefix: string): Promise<void> {
    const created = blockStore.getBlock(targetId)
    if (!created) return
    const marks = readInlineMarks(created.format, created.content.length)
    const shifted = marks.map((mark) => ({
      ...mark,
      start: mark.start + prefix.length,
      end: mark.end + prefix.length,
    }))
    await blockStore.updateBlockContent(targetId, prefix + created.content, { inlineMarks: shifted })
  }

  function handleSplit(cursorPosArg: number): Promise<void> {
    if (splitInFlight) {
      pendingSplitCount++
      return Promise.resolve()
    }
    return runSplit(cursorPosArg)
  }

  async function runSplit(cursorPosArg: number) {
    splitInFlight = true
    try {
      // 等价于 withContentSync(fn, { flush: false })：只做 encode 内存同步 + 取消编辑器防抖，不阻塞落库。
      await syncBlockContent(false)

      // 仅在「内容非空却缺 renderSegments」时 await 落库回写 —— 即 store 落后于编辑器、
      // encode 同步改写了 content，导致 segments 被判过期清空的情形。此时落库是必需的：
      //   1) 不失活回写的话，失活后会因 renderSegments=undefined 闪现纯文本；
      //   2) 中部分拆的 decoded→encoded 偏移换算依赖有效 segments 才能正确吸附标记。
      // 内容已同步时（纯文本、或 markup 往返编码后不变）segments 仍有效、偏移换算可用，
      // 无需落库 —— 该判据对「内容变更」的块恒成立，而非对一切块恒成立。
      // 空白新块（Enter 建链的产物）本无 segments 且无内容 —— 旧判据 `!renderSegments` 对它恒真，
      // 会把真实 WASM 写拉回热路径（~34–386ms），反而让下一次 Enter 在 flush 窗口内重入。
      const block = blockStore.getBlock(blockId.value)
      if (!block?.renderSegments && (block?.content.length ?? 0) > 0) {
        await blockStore.flushSave(blockId.value)
      }

      // ── 坐标转换：ProseMirror 坐标基于编辑器显示的 decoded 文本，
      //    但 block.content 是 encoded 文本。type/label 长度不同时偏移不匹配。
      //    将 decoded 偏移转换为 encoded 偏移，确保拆分位置正确。
      let effectivePos = cursorPosArg
      if (editorRef.value) {
        const decodedText = editorRef.value.getText()
        const decodedOffset = cursorPosArg > 0 ? cursorPosArg - 1 : 0  // pmPosToTextOffset
        const encodedContent = blockStore.getBlock(blockId.value)?.content ?? ''
        if (decodedOffset >= decodedText.length) {
          // 行尾：直接设为 encoded content 的行尾
          effectivePos = encodedContent.length + 1
        } else if (decodedOffset === 0) {
          // 行首：无需转换
          effectivePos = 1
        } else {
          // 中间：decoded 文本即界面渲染文本（textContent），经 render-text.ts 单一 seam 换算为 encoded 偏移
          const segments = blockStore.getBlock(blockId.value)?.renderSegments
          const encodedOffset = renderedOffsetToEncodedOffset(encodedContent, segments, decodedOffset)
          effectivePos = encodedOffset + 1  // 转回 ProseMirror 坐标
        }
      }

      editorStore.deactivateBlock()
      // 子树根块：强制新块成为根的子块，避免 Enter 在页面级建兄弟而逃出可见子树（ADR-0039）
      const isSubtreeRoot = blockModalRootId?.value === blockId.value
      // 列表续行：必须在**拆分之前**取源正文（拆完只剩前半截，序号应以原项为准）
      const continuation = listContinuationPrefix(blockId.value)
      // 高亮续行：新块继承同一语义（连写几段警示不必逐块重设）。
      // 与列表同一条时机约束 —— 拆分之后源块可能已被改写，判定要在拆之前取。
      const calloutInherit = calloutToneOf(blockStore.getBlock(blockId.value)?.format)
      const newBlock = await blockStore.insertBlockAtCursor(
        blockId.value,
        effectivePos,
        collapsed.value,
        calloutInherit ? { callout: calloutInherit } : undefined,
        isSubtreeRoot ? { forceParentId: blockId.value } : undefined
      )
      if (newBlock) {
        // 空列表项 + Enter = 退出列表（Notion 口径）：源块去掉标记，新块也不带标记
        if (continuation === '') {
          await blockStore.updateBlockContent(blockId.value, '')
        }
        let anchorPos = 1
        if (continuation) {
          await prefixNewListItem(newBlock.id, continuation)
          anchorPos = continuation.length + 1
        }
        editorStore.activateBlock(newBlock.id, anchorPos)
        // 消化 in-flight 期间累积的连按 Enter：在新激活块行尾逐一补建，光标停最后一个（串行、不漏）
        let anchorId = newBlock.id
        let nextPrefix = continuation ? nextListPrefix(continuation) : null
        while (pendingSplitCount > 0) {
          pendingSplitCount--
          // 行尾（而不是 1）：带 `- ` 前缀的块里 pos=1 是「行首」，会走到「上方插入」分支，
          // 连按 Enter 建出来的块就反了序
          const extra = await blockStore.insertBlockAtCursor(
            anchorId,
            anchorPos,
            false,
            calloutInherit ? { callout: calloutInherit } : undefined,
          )
          if (!extra) break
          if (nextPrefix) {
            await prefixNewListItem(extra.id, nextPrefix)
            anchorPos = nextPrefix.length + 1
          } else {
            anchorPos = 1
          }
          anchorId = extra.id
          editorStore.activateBlock(extra.id, anchorPos)
          nextPrefix = nextPrefix ? nextListPrefix(nextPrefix) : null
        }
      }
    } finally {
      splitInFlight = false
      // 计次统一在此清零：drain 正常跑完本就把计数递减到 0；若拆分根本没兑现
      // （`insertBlockAtCursor` 返 null = 源块已不存在），则无锚点可续建，剩余计次只能丢弃。
      // 不能留着 —— 悬挂的计次会让下一次 Enter 在 drain 里多建块。
      pendingSplitCount = 0
    }
  }

  const handleMerge = withContentSync(async () => {
    editorStore.deactivateBlock()
    const result = await blockStore.mergeWithPrevious(blockId.value)
    if (result) {
      editorStore.activateBlock(result.id, result.cursorPos)
    }
  })

  async function handleDelete() {
    const prevBlock = blockStore.findPreviousVisibleBlock(blockId.value)
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

  /**
   * Tab / Shift+Tab（缩进 / 反缩进）。三件事，都是为了「按下去就有反应」：
   *
   * 1. **不 await 落库**（与跨块方向键同一条热路径规则）：默认 `withContentSync` 会
   *    `flushSave`（`save_block_tree` + 通知 payload 同步 + 动态 import，长页面上百毫秒），
   *    一次按键就把这段压在缩进前面。只保留必要的那一次等待（`awaitSegmentsIfStale`）：
   *    内容刚改过、renderSegments 已被置空时才落库，否则失活瞬间渲染态退回纯文本。
   *    缩进自身的位置改写走 `_scheduleSave` 防抖后台落库，不占热路径。
   *
   * 2. **带光标位重激活**：块换了父节点 ⇒ Block 组件重挂载 ⇒ 编辑器重建，不回填光标位
   *    就会落到行尾（`focusActiveEditor` 的 `cursorPos` 缺省分支是 `focus('end')`）。
   *    用户按 Tab 是为了「把这块挪进去」，不是为了把插入点甩到行尾。
   *
   * 3. **重入排队**（`indentQueues`，模块级）：
   *    缩进窗口里编辑器不在 DOM 里，落在这几十毫秒里的 Tab 既不是编辑器快捷键
   *    （PM 收不到），也不在块选区里（BlockList 的 Tab 分支只管无编辑态块）⇒ 直接丢掉。
   *    实测极速连按 4 次只有 3 次进到缩进流水线，落进窗口的那一颗无声消失。
   *    队列 + 窗口期的 document 捕获监听把按键收下来，等编辑器回来再逐个补上
   *    （与 Enter 的 `splitInFlight`/`pendingSplitCount` 同一套语义）。
   */
  function requestIndent(direction: IndentDirection): void {
    const id = blockId.value
    const queue = indentQueues.get(id) ?? []
    if (!indentQueues.has(id)) indentQueues.set(id, queue)
    queue.push(direction)
    if (!indentRunning.has(id)) void drainIndents()
  }

  /** 当前编辑器里的光标位（ProseMirror position）；读不到返回 undefined（沿用旧行为） */
  function currentCaretPos(): number | undefined {
    const selection = editorRef.value?.getEditor()?.state?.selection
    return selection ? selection.from : undefined
  }

  async function drainIndents(): Promise<void> {
    const id = blockId.value
    indentRunning.add(id)
    attachIndentTabCapture(id)
    // 光标只记一次：缩进不改正文，后面补的每一格都落在同一个插入点
    const caret = currentCaretPos()
    try {
      // 先把打字留下的未落库正文同步进 store（打字走 300ms 防抖）；只写内存不落库
      await syncBlockContent(false)
      const queue = indentQueues.get(id) ?? []
      while (queue.length > 0) {
        const direction = queue.shift() as IndentDirection
        // 子树根块不可 outdent：outdent 会使其成为页面级兄弟，逃出弹窗可见子树（ADR-0039）
        if (direction === 'outdent' && blockModalRootId?.value === id) continue
        await awaitSegmentsIfStale()
        editorStore.deactivateBlock()
        if (direction === 'indent') await blockStore.indent(id)
        else await blockStore.outdent(id)
        editorStore.activateBlock(id, caret)
      }
    } finally {
      indentQueues.delete(id)
      indentRunning.delete(id)
      scheduleIndentTabCaptureDetach()
    }
  }

  const handleIndent = () => requestIndent('indent')

  const handleOutdent = () => requestIndent('outdent')

  /**
   * 登记「把停放着的队列重新跑起来」的启动器。
   *
   * 捕获器可能把 Tab 塞进**已经排空**的队列（最后一格缩进完、焦点还没落回编辑器的那一两帧），
   * 这时没有任何流水线在等它。按实例身份登记/注销：块缩进时组件重挂载，新实例登记，
   * 旧实例的注销靠身份比对让位（否则会把新实例的登记删掉）。
   */
  const restartDrain = () => {
    if (!indentRunning.has(blockId.value)) void drainIndents()
  }
  indentDrainStarters.set(blockId.value, restartDrain)
  // 单测里这个 composable 不在组件 setup 中调用（没有 effect scope），注册前先判空
  if (getCurrentScope()) {
    onScopeDispose(() => {
      if (indentDrainStarters.get(blockId.value) === restartDrain) {
        indentDrainStarters.delete(blockId.value)
      }
    })
  }

  /**
   * 跨块方向键：落点只依赖块的文档序，与 segments 无关 ⇒ 不阻塞落库（否则每次按方向键
   * 都要吃一次 saveBlockTree，~34–386ms，长按方向键会连续排队 = 卡顿）。仅在内容刚改过、
   * segments 已失效时才等一次（`awaitSegmentsIfStale`）。
   */
  const handleMoveUp = withContentSync(async (x?: number) => {
    const prevBlock = blockStore.findPreviousVisibleBlock(blockId.value)
    if (prevBlock) {
      await awaitSegmentsIfStale()
      // 上移落到上一块的末行，保持源块水平列位置（短块由 posAtCoords 钳制）
      if (x !== undefined) editorStore.setArrowFocus(x, 'last')
      editorStore.deactivateBlock()
      editorStore.activateBlock(prevBlock.id)
    }
  }, { flush: false })

  const handleMoveDown = withContentSync(async (x?: number) => {
    const nextBlock = blockStore.findNextVisibleBlock(blockId.value)
    if (nextBlock) {
      await awaitSegmentsIfStale()
      // 下移落到下一块的首行，保持源块水平列位置（短块由 posAtCoords 钳制）
      if (x !== undefined) editorStore.setArrowFocus(x, 'first')
      editorStore.deactivateBlock()
      editorStore.activateBlock(nextBlock.id)
    }
  }, { flush: false })

  /**
   * 块首左移 → 上一块末行行尾（不保持列，emit 的 x 有意忽略）。
   *
   * 「是否在块首」由扩展 `EnterAsBlockExtension` 的 `endOfTextblock('left')` 单点判定
   * （LTR 文本等价于 `parentOffset === 0`；选区非空时它直接返回 false，交原生折叠），
   * 此处**不重复设门**。原先的门 `cursorPos.value !== 0` 恒真 —— `cursorPos` 由正文变更时的
   * `cursor-change` 上报，值是 ProseMirror 坐标（内容起点为 1，永不为 0），纯方向键移动
   * 压根不上报 ⇒ 一旦事件接通就必然「左键没反应」。
   */
  const handleMoveLeft = withContentSync(async () => {
    const prevBlock = blockStore.findPreviousVisibleBlock(blockId.value)
    if (prevBlock) {
      await awaitSegmentsIfStale()
      editorStore.setArrowFocus(null, 'last')
      editorStore.deactivateBlock()
      editorStore.activateBlock(prevBlock.id)
    }
  }, { flush: false })

  /** 块尾右移 → 下一块首行行首（不保持列，emit 的 x 有意忽略）；在块尾的判定同 handleMoveLeft。 */
  const handleMoveRight = withContentSync(async () => {
    const nextBlock = blockStore.findNextVisibleBlock(blockId.value)
    if (nextBlock) {
      await awaitSegmentsIfStale()
      editorStore.setArrowFocus(null, 'first')
      editorStore.deactivateBlock()
      editorStore.activateBlock(nextBlock.id)
    }
  }, { flush: false })

  const handleExitEdit = withContentSync(async () => {
    editorStore.deactivateBlock()
  })

  /** 空代码块 Backspace：转为 text 并重激活聚焦（Notion 惯例）。
   *  deactivate→nextTick→activate 确保编辑器组件随类型切换重挂载、
   *  watch(isActive) 触发 focusActiveEditor。 */
  const handleBackspaceEmpty = withContentSync(async () => {
    await blockStore.updateBlockType(blockId.value, 'text')
    editorStore.deactivateBlock()
    await nextTick()
    editorStore.activateBlock(blockId.value)
  })

  async function handleClear() {
    if (editorRef.value) editorRef.value.markSaved()
    await blockStore.updateBlockContent(blockId.value, '')
  }

  function handleCursorChange(pos: number) {
    cursorPos.value = pos
  }

  // ── 鼠标交互 ──
  /**
   * 外链 chip 的按下记录（ADR-0069 D4）。URL 必须在 mousedown 就定住：读态一激活块，
   * `BulletRender` 就被换成 `Editor`，之后 click 的 target 会退到公共祖先，那时已经
   * 找不到 chip 了。落在隐藏语法格（`.pm-prefix-hidden`）不算点链接——视觉上那是链接外。
   */
  let linkPress: { url: string; x: number; y: number } | null = null

  /** mousedown：捕获点击坐标，在 tiptap 挂载前通知 editor store */
  function handleContentMousedown(e: MouseEvent) {
    const target = e.target as HTMLElement
    // 仅响应左键（右键/中键留给上下文菜单等，避免误启动选区/激活）
    if (e.button !== 0) return
    // 交互 chrome（代码块 header：折叠 / 语言 / 自动换行 / 复制）不是内容区：
    // 不起文本选区，也不记录光标坐标——否则下拉/复制按钮会把块拉进编辑态，
    // 且 clickCoords 之后被 posAtCoords 换算成 header 处的错误光标位。
    if (target.closest(SELECTION_IGNORE_SELECTOR)) return
    {
      const chipEl = target.closest('.web-link-chip') as HTMLElement | null
      const url = chipEl?.dataset.chipUrl
      linkPress = chipEl && url && !target.closest('.pm-prefix-hidden')
        ? { url, x: e.clientX, y: e.clientY }
        : null
    }
    // 表格块自带格选区（TableBlock 内实现）：内部拖拽不得进入跨块文本选区。
    // 表格的字符偏移是「所有单元格按行优先拼接」，跨格没有语义——从 A 格往下拖到
    // A 下方的格，在偏移坐标里已经越过整行后面的 B 格，于是 B 凭空入选；
    // 且两套选区并存会互相覆盖，表格内还会退化成「能高亮、复制为空」。
    const blockType = blockStore.getBlock(blockId.value)?.type
    const isTableBlock = blockType === 'table'
    const isQueryBlock = blockType === 'query'
    // 查询块同理：块内是完整的查询视图（表格 / 看板 / 日历），拖拽与点击归视图自身，
    // 与跨块文本选区并存会互相覆盖（表格块的既有理由逐条适用）。
    const ownsInnerDrag = isTableBlock || isQueryBlock
    // .block-link 与 .rel-type-label 与 .date-ref 与 .block-tag 都由 handleContentClick 处理点击，
    // 不要让 mousedown 触发激活导致 BulletRender 被替换、
    // 进而让后续 click 事件落在新挂载的 Editor 上。
    // 本守卫只在**渲染态**生效：块激活后编辑器（.ProseMirror）在场，inline tag /
    // date-ref / wiki link 的编辑态装饰同样挂着这些类名 —— 此时提前 return 会跳过
    // 下方的 startTextTracking，从装饰字符内起拖将无法跨块选区（ADR-0035 老 bug 形态）。
    // 外链 chip 是例外（ADR-0069 D4）：读态点击同样要落光标（激活块）+ 抬起时打开，
    // 因此 `linkPress` 命中时放行到下面的激活路径；wiki link 等其余 chip 仍走原来的一步跳转。
    if (!target.closest('.ProseMirror') && !linkPress) {
      if (target.closest('.block-link')) return
      if (target.closest('.rel-type-label')) return
      if (target.closest('.date-ref')) return
      if (target.closest('.block-tag')) return
    }

    if (e.ctrlKey || e.metaKey) {
      // 「页面」列的 Ctrl/Cmd+Click = 在另一栏打开该页（ADR-0059），是**单元格手势**，
      // 不该顺带切整块选中（ADR-0035 D6）：否则点一下页面列就把整块染进蓝色选区。
      // 让位范围只限这一处——查询块其余区域（表头空白、其它列）的 ctrl 仍按原语义切块多选。
      if (isQueryBlock && target.closest('.source-page-cell')) return
      if (selection) {
        selection.toggleBlock(blockId.value, pageStore.currentPageId)
        e.preventDefault()
      }
      return
    }

    // shift+click（ADR-0035 D10）三分支：① 有文本选区 → 延伸（head 无效时仍 return，
    // mouseup 侧对 shift 豁免清除，保住既有选区）；② 无选区但有光标 → 从光标起选；
    // ③ 都没有 → 落到下方普通点击路径。preventDefault 屏蔽 PM 原生 shift+click 的
    // 双高亮；拖拽/固化复用既有循环（isTextDragging，mousemove 免阈值、mouseup 固化），
    // 不设 clickCoords。PM 的 mousedown 处理先于本分支运行（冒泡序），② 读到的
    // DOM selection 往往已被 PM 从原光标延伸到点击处——caretBlockOffsetFromDomSelection
    // 取 anchor（= 原光标位）即为此设计；起选后立即失活编辑器，维持「PM 挂载与
    // comind 文本选区不并存」不变量。
    if (e.shiftKey && selection && !ownsInnerDrag) {
      const head = blockOffsetFromPoint(e.clientX, e.clientY)
      if (selection.textRange.value) {
        if (head) {
          e.preventDefault()
          selection.startTextExtend(head, { x: e.clientX, y: e.clientY })
        }
        return
      }
      if (head) {
        const anchor = caretBlockOffsetFromDomSelection()
        if (anchor) {
          e.preventDefault()
          selection.startTextExtend(head, { x: e.clientX, y: e.clientY }, anchor)
          editorStore.deactivateBlock()
          return
        }
      }
    }

    // 未激活的块：保存鼠标坐标，Editor 挂载后用 posAtCoords 精确定位光标。
    // 已激活的块不设坐标 —— 光标由 ProseMirror 原生 mousedown 定位（此处不 preventDefault，
    // 也不阻断事件），故单击语义保持原样。
    if (editorStore.activeBlockId !== blockId.value) {
      editorStore.setClickCoords(e.clientX, e.clientY)
    }

    if (selection && !ownsInnerDrag) {
      // 内容区 mousedown 启动文本选区拖拽（ADR-0035 D1）：定位起始字符偏移。
      //
      // 已激活块同样走这里（旧实现提前 return）：否则起始于激活块内时 ProseMirror
      // 独占拖拽、comind 无从接管，选区被钳在编辑器自己的 doc 内 —— 拖不出本块。
      // 拖拽超过阈值后由 BlockList.handleDocMouseMove 失活编辑器统一接管，
      // 与非激活块起点完全同构；未拖时（单击/双击）不干预，光标仍归 ProseMirror。
      const anchor = blockOffsetFromPoint(e.clientX, e.clientY)
      if (anchor) {
        selection.startTextTracking(anchor, { x: e.clientX, y: e.clientY })
      }
    }
  }

  /**
   * 外链 chip 的抬起语义（ADR-0069 D4）：按下时登记的 chip 在抬起时才决定要不要打开。
   * 四道门全过才开：左键、位移 ≤ 4px（起手拖选/跨块选区）、抬起时无选区（选词/拖选）、
   * 按下落在可见别名上（隐藏语法格在 mousedown 时已排除）。
   */
  function handleContentMouseup(e: MouseEvent) {
    const press = linkPress
    linkPress = null
    if (!press || e.button !== 0) return
    // 双击的第二下（以及三击）：这一下是选词手势，不再重复打开
    if (e.detail > 1) return
    if (Math.abs(e.clientX - press.x) > 4 || Math.abs(e.clientY - press.y) > 4) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    // 系统浏览器会拿走前台：登记一下，窗口回来时把插入符还回本块（ADR-0069 D4）
    editorStore.requestCaretRestore()
    void openExternalUrl(press.url)
  }

  function handleContentClick(e: MouseEvent) {
    const target = e.target as HTMLElement

    const relLabel = target.closest('.rel-type-label') as HTMLElement | null
    if (relLabel) {
      const relType = relLabel.dataset.relType
      const targetBlockId = relLabel.dataset.blockId
      const labelFrom = Number(relLabel.dataset.typedFrom)
      const labelTo = Number(relLabel.dataset.typedTo)
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
          const content = latest.content
          const newContent = content.replace(new RegExp(`\\(${relType}\\)`), `(${newType})`)
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

      // 段范围含 pad 空格时 data-raw 带首/尾空格（键盘语义：pad 属单元一部分，
      // 渲染态 date-ref span 连右 pad 一起盖），而 serializeDateRef 序列化口径
      // 永不带空白 —— 直接比对恒不匹配，点击曾因此静默失效。trim 后比对。
      const rawUnit = raw.trim()

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
      const searchPattern = new RegExp(DATE_REF_AT_REGEX.source, 'g')
      let m: RegExpExecArray | null
      while ((m = searchPattern.exec(content)) !== null) {
        // DATE_REF_AT_REGEX groups: m[1]=iso, m[2]=emoji(📅/⏰), m[3]=recurrence, m[4]=leadMinutes
        const emoji = m[2]
        const kind = emoji === '📅' ? 'schedule' : emoji === '⏰' ? 'deadline' : 'ref'
        const matchedRaw = serializeDateRef({
          kind,
          iso: m[1],
          recurrence: normalizeRecurrence(m[3]),
          leadMinutes: m[4] ? parseInt(m[4], 10) || 0 : 0,
        })
        if (matchedRaw === rawUnit && matchCount === occurrence) {
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
          // 用匹配到的单元长度（不含 pad）——替换区间须与序列化口径一致
          to: idx + rawUnit.length,
          kind: kind as DateRefKind,
          iso,
          recurrence: recurrence as RecurrenceRule,
          leadMinutes,
          position: computeDatePickerPosition(dateRefSpan),
        },
        'content'
      )
      return
    }

    // ADR-0050 D7：inline `#tag` chip 点击 → 该 tag 的聚合页。
    // **必须先于 `.block-link` 判定**：兜底渲染（renderSegments 未就绪 / 旧数据）产出的
    // tag chip 同时带 `block-link` 类，让 link 分支先行会拿标签名当页面名去
    // navigateToPage —— `/page/<标签名>` 守卫查无此页就隐式建页（表现为点标签跳进新建空页）。
    const tagChip = target.closest('.block-tag') as HTMLElement | null
    if (tagChip) {
      // 结构化 Tag 段带 data-tag-id，直接用；兜底段只有 data-tag-title → 按标题反查。
      // 反查需要标签树：未加载时按需拉一次（ensureLoaded 幂等），查无此 tag → 不导航，
      // 绝不回落到页面导航（那正是「点标签建出空页」的成因）。
      if (tagChip.dataset.tagId) {
        navigateToTag(tagChip.dataset.tagId).catch(err => {
          console.error('标签导航失败:', err)
        })
        return
      }
      const chipTitle = tagChip.dataset.tagTitle
      if (chipTitle) {
        void (async () => {
          await tagsStore.ensureLoaded()
          const tagId = tagIdByTitle(chipTitle)
          if (tagId) await navigateToTag(tagId)
        })().catch(err => {
          console.error('标签导航失败:', err)
        })
      }
      return
    }

    const link = target.closest('.block-link') as HTMLElement | null
    if (!link) return

    // 外链 chip 的打开已上移到 mouseup（ADR-0069 D4）：这里再开一次会变成双开。
    // wiki link 的导航仍在 click 处理。
    const pageName = link.dataset.page
    if (pageName) {
      // 对称 pane（ADR-0059）：Ctrl+Click（Mac ⌘+Click）→ 目标页在另一栏打开；
      // 普通点击行为不变，走原有页面导航。
      if (e.ctrlKey || e.metaKey) {
        openPageInOtherPane(pageName).catch(err => {
          console.error('另一栏打开失败:', err)
        })
        return
      }
      navigateToPage(pageName).catch(err => {
        console.error('导航失败:', err)
      })
    }
  }

  return {
    isActive,
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
    handleMoveLeft,
    handleMoveRight,
    handleExitEdit,
    handleBackspaceEmpty,
    handleClear,
    handleCursorChange,
    handleContentMousedown,
    handleContentMouseup,
    handleContentClick,
  }
}
