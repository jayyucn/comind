<script setup lang="ts">
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent,useEditor } from '@tiptap/vue-3'
import { computed, onBeforeUnmount, ref,shallowRef, watch } from 'vue'

import { useDateTimePickerPanel } from '../composables/useDateTimePickerPanel'
import { useDomEvents } from '../composables/useDomEvents'
import { useNavigateToPage } from '../composables/useNavigateToPage'
import { useNavigateToTag } from '../composables/useNavigateToTag'
import { useRelationshipMenu } from '../composables/useRelationshipMenu'
import BracketPairExtension from '../extensions/BracketPairExtension'
import type { DateRefClickPayload } from '../extensions/DateRefExtension'
import { DateRefExtension } from '../extensions/DateRefExtension'
import { DateRefTriggerExtension } from '../extensions/DateRefTriggerExtension'
import EnterAsBlockExtension from '../extensions/EnterAsBlockExtension'
import { HeadingPreviewExtension } from '../extensions/HeadingPreviewExtension'
import { InlineTagExtension } from '../extensions/InlineTagExtension'
import { closeTagMenuByEditor, findTagAtCursor,InlineTagTriggerExtension, notifyTagMenuSelect } from '../extensions/InlineTagTriggerExtension'
import { RelationshipTriggerExtension } from '../extensions/RelationshipTriggerExtension'
import { SlashCommandExtension } from '../extensions/SlashCommandExtension'
import { WikiLinkExtension } from '../extensions/WikiLinkExtension'
import { closeWikiLinkMenuByEditor, findWikiLinkAtCursor,notifyWikiLinkMenuSelect, WikiLinkTriggerExtension } from '../extensions/WikiLinkTriggerExtension'
import { usePageStore } from '../stores/pages'
import { useTagsStore } from '../stores/tags'
import type { DateRefKind } from '../utils/date-ref'
import { debounce } from '../utils/debounce'
import { padUnitForDoc } from '../utils/inline-unit-pad'
import { createEditorEvents } from './Block/editorEvents'
import DateRefKindSelector from './DateRefKindSelector.vue'
import PageLinkMenu from './PageLinkMenu.vue'
import TagMenu from './TagMenu.vue'

const props = defineProps<{
  blockId: string
  content: string
  showFullPlaceholder?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  /**
   * `commitTags`：本次保存是否为提交动作（blur/unmount = true，防抖打字 = false）。
   * 打字中间态（#f、#fo）不得建标签 —— 与 [[page]] 的创建语义对齐（ADR-0050）。
   */
  (e: 'save', content: string, commitTags?: boolean): void
  (e: 'split', cursorPos: number): void
  (e: 'merge'): void
  (e: 'delete'): void
  (e: 'indent'): void
  (e: 'outdent'): void
  (e: 'moveUp', x?: number): void
  (e: 'moveDown', x?: number): void
  /**
   * 块首 ←/块尾 → 的跨块移动。必须声明：`EnterAsBlockExtension` 在块边界派发
   * `moveLeft`/`moveRight`，本组件经 `editorEvents` 的 `emit` 中转给 `Block`。
   * 未声明时 Vue 既报「emitted event not declared」警告（每次按键打印一次调用栈，
   * 长按方向键会明显掉帧），又把事件拐去 `$attrs` —— `Block` 的 `@move-left`
   * 收不到，按键已被扩展 `return true` 吞掉 ⇒ 表现为「块首按左键没反应」。
   */
  (e: 'moveLeft', x?: number): void
  (e: 'moveRight', x?: number): void
  (e: 'exitEdit'): void
  (e: 'cursor-change', pos: number): void
  /**
   * 选区上报（撤销历史用）：`contentChanged` 区分「只是移动光标/选中」与「改了正文」——
   * 历史栈据此决定「这次选区变化属于改动前的快照」还是「属于即将入栈的新快照」。
   */
  (e: 'selection-change', payload: { from: number; to: number; contentChanged: boolean }): void
}>()

// ProseMirror 默认折叠空白，解析会丢弃段落行尾/连续空格（如 date-ref 单元后补的空格），
// 导致「内容进编辑器一次 → blur 保存后尾随空格永久消失」。所有解析入口都要开启保留：
// useEditor 初载 content + 两处 setContent（TipTap v3 的 setContent 快速路径不继承 editor.parseOptions，须逐点显式传）。
// 用 preserveWhitespace: true（非 'full'）即可保留段内空白，且 setContent 仍走快速路径（无 insertContentAt 的选择跳变）。
const PARSE_PRESERVE_WS = { preserveWhitespace: true }

let syncing = false
let savedFromOutside = false

// 读取「触发时刻」的编辑器正文：防抖期间若有外部写回（如斜杠命令 /priority → ensureTodo
// 挂载 `#任务` 后 Editor 的 watch(props.content) 重新同步 PM 文档），触发时以最新正文落库，
// 避免用 deleteRange 那一刻捕获的旧正文（无 `#任务`）把挂载结果覆盖掉，导致任务 tag 被摘、
// 四象限视图不显示（回归：输入 /midium 后 #任务 闪烁且任务不进象限）。
const debouncedEmitSave = debounce(() => {
  if (editor.value) emit('save', editor.value.getText(), false)
}, 300)

function cancelDebouncedSave() {
  debouncedEmitSave.cancel()
}

const hasContent = ref(!!props.content)
const menuVisible = ref(false)
const menuPosition = ref({ x: 0, y: 0 })
const menuRange = ref({ from: 0, to: 0 })
// wiki-link 菜单锚点（光标所在 DOM 元素），供 PageLinkMenu 内的 BasePopover 避让/翻转（ADR-0038）
const menuAnchorEl = ref<HTMLElement | null>(null)
const menuQuery = ref('')
const menuRef = ref<InstanceType<typeof PageLinkMenu> | null>(null)

// tag 菜单（#tag 选择，类比 wiki-link）
const tagMenuVisible = ref(false)
const tagMenuPosition = ref({ x: 0, y: 0 })
const tagMenuRange = ref({ from: 0, to: 0 })
const tagMenuAnchorEl = ref<HTMLElement | null>(null)
const tagMenuQuery = ref('')
const tagMenuRef = ref<InstanceType<typeof TagMenu> | null>(null)

// DateRef kind 选择器状态
const kindSelectorVisible = ref(false)
const kindSelectorPosition = ref({ left: 0, top: 0, bottom: 0 })
const kindSelectorRange = ref({ from: 0, to: 0 })
const kindSelectorView = ref<EditorView | null>(null)

const relMenu = useRelationshipMenu()
const { open: openDateRefPanel } = useDateTimePickerPanel()
// 编辑态 inline 单元点击导航（tag chip → 标签聚合页；wiki link → 页面），
// 由 editorEvents 的 inlineTagClick / wikiLinkClick handler 消费
const { navigateToTag } = useNavigateToTag()
const { navigateToPage } = useNavigateToPage()

const tagsStore = useTagsStore()

/** `title → tag` 索引：装饰重建时 O(1) 查表（`allTags` 变化才重算，不是每次打字都遍历）。 */
const tagsByTitle = computed(() => new Map(tagsStore.allTags.map((t) => [t.title, t])))

/**
 * 编辑态 `#tag` 的着色解析器（ADR-0050 D11）：`InlineTagExtension` 不碰 Pinia，
 * 由宿主注入闭包 —— 闭包每次重建装饰都求值，故标签改色后无需重启编辑器。
 *
 * 标签树的加载不在此处触发：`BlockFieldZone`（每个块都挂）已在 mounted 里
 * `ensureLoaded()`；本组件的 `tagsByTitle` watch 负责在它到位后补一次重绘。
 */
function resolveInlineTag(title: string) {
  const tag = tagsByTitle.value.get(title)
  // id 供编辑态 chip 点击导航（标签聚合页）——装饰只取 color/is_system
  return tag ? { color: tag.color, is_system: tag.is_system, id: tag.id } : undefined
}

const editor = shallowRef(useEditor({
  extensions: [
    StarterKit.configure({
      heading: false, codeBlock: false, blockquote: false, horizontalRule: false,
      // 内置撤销历史禁用（ADR-0046 D2：统一栈接管 Ctrl+Z）—— 与 BlockList 的键盘接管、
      // CodeMirrorEditor 去 history() 必须同票落地，否则两个栈互抢（D7 拒绝分阶段）
      undoRedo: false,
    }),
    SlashCommandExtension,
    EnterAsBlockExtension,
    WikiLinkExtension,
    // 编辑态 `#tag` 胶囊与渲染态同形（ADR-0050 D11），色由宿主解析后注入
    InlineTagExtension.configure({ resolve: resolveInlineTag }),
    WikiLinkTriggerExtension,
    // 编辑态 `#tag` 选择菜单触发（类比 wiki-link trigger，ADR-0050）
    InlineTagTriggerExtension,
    RelationshipTriggerExtension,
    BracketPairExtension,
    HeadingPreviewExtension,
    DateRefExtension,
    DateRefTriggerExtension,
  ],
  content: textToHtml(props.content),
  parseOptions: PARSE_PRESERVE_WS,
  autofocus: false,
  editable: !props.readonly,
  onBlur: () => {
    if (syncing) return
    if (savedFromOutside) {
      savedFromOutside = false
      return
    }
    if (props.readonly) return
    if (editor.value) {
      // wiki link 菜单仍打开时（用户未取消），失焦即创建对应页面
      if (menuVisible.value) {
        const { state } = editor.value
        const cursorPos = state.selection.from
        const result = findWikiLinkAtCursor(state.doc, cursorPos)
        if (result.found && result.query.trim()) {
          const pageStore = usePageStore()
          if (!pageStore.getPageByTitle(result.query.trim())) {
            pageStore.createPage(result.query.trim())
          }
        }
        menuVisible.value = false
        closeWikiLinkMenuByEditor()
      }
      // tag 菜单仍打开时（用户未取消），失焦即关闭；
      // 缺失标签由下方 emit('save', text, true) 的建签门（create_missing=true）补建，无需在此重复创建
      if (tagMenuVisible.value) {
        tagMenuVisible.value = false
        closeTagMenuByEditor()
      }
      try {
        // blur = 提交动作：允许把打字期间攒下的 #tag 建出来（ADR-0050 建签门）
        emit('save', editor.value.getText(), true)
      } catch {
        // schema 可能在卸载阶段已为 null，跳过保存
      }
    }
  },
  onUpdate: () => {
    if (props.readonly) return
    if (editor.value && !settingContent) {
      hasContent.value = !!editor.value.getText()
      const { from } = editor.value.state.selection
      emit('cursor-change', from)
      debouncedEmitSave()
    }
  },
  /**
   * 选区上报：一次事务一次，带 `docChanged` 让下游区分「移动光标」与「改正文」。
   * 程序性写回（syncContent / watch(props.content) 的 setContent）一律不发 —— 那不是用户在动光标。
   */
  onTransaction: ({ transaction }) => {
    if (props.readonly || syncing || settingContent) return
    const { from, to } = transaction.selection
    emit('selection-change', { from, to, contentChanged: transaction.docChanged })
  }
}))

let settingContent = false

// 模板驱动的 wiki link 选择（保留为组件方法，由 PageLinkMenu @select 触发）
async function handleWikiLinkSelect(pageName: string) {
  if (!editor.value) return

  notifyWikiLinkMenuSelect()

  // 先建目标页再插入链接：插入内容会触发块保存 → link 同步，
  // 若此时目标页尚不存在，该链接会被同步流程跳过且不再重试（link 表丢边、图谱断链）。
  const pageStore = usePageStore()
  if (!pageStore.getPageByTitle(pageName)) {
    await pageStore.createPage(pageName)
  }

  const { state } = editor.value
  const cursorPos = state.selection.from
  const result = findWikiLinkAtCursor(state.doc, cursorPos)
  const from = result.range?.from ?? cursorPos
  const to = result.range?.to ?? cursorPos

  // 与 @date-ref 同款补空（inline-unit-pad 单源）：插入的 [[page]] 两侧空格属于
  // 单元一部分——键盘原子语义的 pad 口径从创建时刻就成立，随后一次 Backspace
  // 在右缘带即可整删（含 pad）。块首/已有空白不补，左邻内容字符补一个。
  const unit = `[[${pageName}]]`
  const padded = padUnitForDoc(state.doc, from, to, unit)
  const leftPad = padded.startsWith(' ') ? 1 : 0

  editor.value.chain()
    .deleteRange({ from, to })
    .insertContent(padded)
    // 光标落 padded 末尾（右 pad 之后）——与 @date-ref 插入后默认光标位一致；
    // 停在 unit 末尾会把光标留在右 pad 空格之前，视觉上「空格没插入」。
    .setTextSelection(from + leftPad + padded.length)
    .focus()
    .run()

  menuVisible.value = false
  closeWikiLinkMenuByEditor()
}

// 模板驱动的 tag 选择（由 TagMenu @select 触发）：确保标签实体存在并把
// 光标处的 #partial 补全为该标签名（类比 handleWikiLinkSelect 的 [[page]] 补全）。
async function handleTagSelect(tagName: string) {
  if (!editor.value) return

  notifyTagMenuSelect()

  const tagsStore = useTagsStore()
  if (!tagsStore.allTags.some((t) => t.title.toLowerCase() === tagName.toLowerCase())) {
    await tagsStore.createTag({ title: tagName })
  }

  const { state } = editor.value
  const cursorPos = state.selection.from
  const result = findTagAtCursor(state.doc, cursorPos)
  const from = result.range?.from ?? cursorPos
  const to = result.range?.to ?? cursorPos

  // 与 @date-ref / [[wiki link]] 同款补空（inline-unit-pad 单源）：插入的 #tag
  // 两侧空格属于单元一部分——键盘原子语义的 pad 口径从创建时刻就成立，随后一次
  // Backspace 在右缘带即可整删（含 pad）。块首/已有空白不补，左邻内容字符补一个。
  const unit = `#${tagName}`
  const padded = padUnitForDoc(state.doc, from, to, unit)
  const leftPad = padded.startsWith(' ') ? 1 : 0

  editor.value.chain()
    .deleteRange({ from, to })
    .insertContent(padded)
    // 光标落 padded 末尾（右 pad 之后）——与 @date-ref 插入后默认光标位一致；
    // 停在 unit 末尾会把光标留在右 pad 空格之前，视觉上「空格没插入」。
    .setTextSelection(from + leftPad + padded.length)
    .focus()
    .run()

  tagMenuVisible.value = false
  closeTagMenuByEditor()
}

function closeTagMenu() {
  tagMenuVisible.value = false
  closeTagMenuByEditor()
}

function handleKindSelect(kind: DateRefKind) {
  kindSelectorVisible.value = false
  const view = kindSelectorView.value
  if (!view) return
  const range = kindSelectorRange.value
  const coords = view.coordsAtPos(range.to)

  openDateRefPanel(
    {
      blockId: props.blockId || '',
      from: range.from,
      to: range.to,
      kind,
      iso: new Date().toISOString().slice(0, 10),
      recurrence: 'none',
      leadMinutes: 0,
      position: { x: coords.left, y: coords.bottom + 6 },
    },
    'editor'
  )
}

function handleKindSelectCancel() {
  kindSelectorVisible.value = false
}

// PageLinkMenu 的 @close 语义与 DOM 'wiki-link-close' 一致
function closeWikiLinkMenu() {
  menuVisible.value = false
  closeWikiLinkMenuByEditor()
}

// 把分散的 DOM CustomEvent handler 收敛进声明式事件表（./Block/editorEvents.ts），
// 由 useDomEvents 在挂载时统一注册、卸载时自动清理（不再手写镜像 add/remove）。
// 保留 DOM CustomEvent 传输通道（见 docs/adr/0016-editor-dom-event-transport.md）。
const events = createEditorEvents({
  // Vue 的 emit / openDateRefPanel 类型比 EditorEventCtx 严格（字面量事件名 / 窄 source 联合），
  // 在此边界处适配，工厂内部仍保持 (event:string,...args:unknown[]) 的安全签名。
  emit: emit as unknown as (event: string, ...args: unknown[]) => void,
  getEditor: () => editor.value,
  props: { blockId: props.blockId },
  menuVisible,
  menuPosition,
  menuRange,
  menuQuery,
  menuRef,
  menuAnchorEl,
  tagMenuVisible,
  tagMenuPosition,
  tagMenuRange,
  tagMenuQuery,
  tagMenuRef,
  tagMenuAnchorEl,
  kindSelectorVisible,
  kindSelectorPosition,
  kindSelectorRange,
  kindSelectorView,
  relMenu,
  openDateRefPanel: openDateRefPanel as unknown as (
    cfg: DateRefClickPayload & { position: { x: number; y: number } },
    source: string
  ) => void,
  closeWikiLinkMenuByEditor,
  closeTagMenuByEditor,
  // 编辑态 inline 单元点击导航（与渲染态 handleContentClick 同口径）：
  // tag chip → 标签聚合页；wiki link → 页面。错误文案与渲染态分支保持一致。
  navigateToTag: (tagId: string) => {
    void navigateToTag(tagId).catch(err => {
      console.error('标签导航失败:', err)
    })
  },
  navigateToPage: (pageName: string) => {
    void navigateToPage(pageName).catch(err => {
      console.error('导航失败:', err)
    })
  },
})
useDomEvents(() => editor.value?.view?.dom ?? null, () => events)

// 响应 readonly 变化
watch(
  () => props.readonly,
  (readonly) => {
    if (editor.value) {
      editor.value.setEditable(!readonly)
    }
  }
)

// 标签树是**异步**加载的，而 store 变化不产生 ProseMirror transaction ⇒ 装饰不会自己重算。
// 不补这一枪，首次打开块时 `#tag` 会停在无色，直到用户敲下一个键才「回色」。
// 空 transaction 无 step ⇒ 不改文档、不进撤销栈，也不触发 onUpdate（TipTap 仅在
// docChanged 时才 emit update），只是逼一次 view update 重新求值 decorations。
watch(tagsByTitle, () => {
  const e = editor.value
  if (e) e.view.dispatch(e.state.tr)
})

watch(
  () => props.content,
  (newContent) => {
    if (!editor.value) return
    if (editor.value.getText() !== newContent) {
      syncing = true
      settingContent = true
      editor.value.commands.setContent(textToHtml(newContent), { parseOptions: PARSE_PRESERVE_WS })
      settingContent = false
      syncing = false
    }
  }
)

onBeforeUnmount(() => {
  // 1. 取消 pending 的防抖保存，避免 destroy 后异步触发 emit('save')
  cancelDebouncedSave()
  // 2. 如果有未保存内容，立即同步保存（卸载 = 提交动作，允许建签）
  if (editor.value && !savedFromOutside) {
    try {
      const text = editor.value.getText()
      if (text) {
        emit('save', text, true)
      }
    } catch {
      // schema 可能在卸载阶段已为 null，跳过保存
    }
  }
  // 3. 标记已保存，防止 destroy() 触发 onBlur 时保存空内容（Bug: 内容消失）
  savedFromOutside = true

  try {
    editor.value?.destroy()
  } catch (err) {
    console.warn('销毁编辑器失败:', err)
  }
})

function textToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

function syncContent(content: string, cursorPos?: number) {
  if (editor.value) {
    const state = editor.value.state
    const prevSel = state.selection
    syncing = true
    editor.value.commands.setContent(content, { parseOptions: PARSE_PRESERVE_WS })
    syncing = false
    const targetPos = (cursorPos !== undefined)
      ? Math.min(cursorPos, content.length + 1)
      : prevSel.from
    editor.value.commands.setTextSelection(targetPos)
  }
}

/**
 * 把位置钳进当前文档的合法区间：撤销/重做恢复的是**撤销前**的选区，而内容可能已被撤短
 * （撤销「刚输入的那几个字」），越界会让 TextSelection.create 抛 RangeError。
 * 合法落点 = [1, doc.content.size - 1]（首位之前 / 末位之后都不可插入）。
 */
function clampDocPos(pos: number): number {
  const size = editor.value?.state.doc.content.size ?? 1
  return Math.max(1, Math.min(pos, Math.max(1, size - 1)))
}

function focus(pos?: number | 'start' | 'end') {
  if (editor.value) {
    if (typeof pos === 'number') {
      editor.value.commands.focus()
      editor.value.commands.setTextSelection(clampDocPos(pos))
    } else {
      editor.value.commands.focus(pos)
    }
  }
}

/** 恢复一段选区（撤销/重做）：from === to 即为折叠光标。两端都钳进合法区间。 */
function focusRange(from: number, to: number) {
  if (!editor.value) return
  editor.value.commands.focus()
  const f = clampDocPos(from)
  const t = Math.max(f, clampDocPos(to))
  editor.value.commands.setTextSelection({ from: f, to: t })
}

function focusAtCoords(x: number, y: number) {
  if (!editor.value) return
  const view = editor.value.view

  // 标题补偿：编辑态文本含 "# " 前缀，渲染态不含，导致点击坐标在编辑态中偏前
  // 用 coordsAtPos 计算 # 前缀的 DOM 宽度，将 x 向右补偿
  const text = editor.value.state.doc.textContent
  const headingMatch = text.match(/^(#{1,6})\s+/)
  let adjustedX = x
  if (headingMatch) {
    const prefixEndPos = 1 + headingMatch[0].length // pos 1 = 首字符前
    const prefixEndCoords = view.coordsAtPos(prefixEndPos)
    const domRect = view.dom.getBoundingClientRect()
    const prefixWidth = prefixEndCoords.left - domRect.left
    adjustedX = x + prefixWidth
  }

  const pos = view.posAtCoords({ left: adjustedX, top: y })
  if (pos) {
    editor.value.commands.focus()
    editor.value.commands.setTextSelection(pos.pos)
  } else {
    focus('end')
  }
}

function markSaved() {
  savedFromOutside = true
}

function getEditor() {
  return editor.value
}

defineExpose({ syncContent, focus, focusRange, focusAtCoords, getText: () => editor.value?.getText() ?? '', markSaved, getEditor, cancelDebouncedSave })
</script>

<template>
  <div class="editor-wrapper">
    <div
      v-if="showFullPlaceholder && !hasContent"
      class="editor-placeholder"
    >
      写点什么…
    </div>
    <EditorContent :editor="editor" />
    <PageLinkMenu
      ref="menuRef"
      :visible="menuVisible"
      :position="menuPosition"
      :anchor-el="menuAnchorEl"
      :range="menuRange"
      :query="menuQuery"
      @select="handleWikiLinkSelect"
      @close="closeWikiLinkMenu"
    />
    <TagMenu
      ref="tagMenuRef"
      :visible="tagMenuVisible"
      :position="tagMenuPosition"
      :anchor-el="tagMenuAnchorEl"
      :range="tagMenuRange"
      :query="tagMenuQuery"
      @select="handleTagSelect"
      @close="closeTagMenu"
    />
    <DateRefKindSelector
      :visible="kindSelectorVisible"
      :position="kindSelectorPosition"
      @select="handleKindSelect"
      @cancel="handleKindSelectCancel"
    />
  </div>
</template>

<style scoped>
.editor-wrapper {
  flex: 1;
  outline: none;
  position: relative;
  font-size: var(--editor-font-size);
}

.editor-placeholder {
  position: absolute;
  top: 2px;
  left: 4px;
  pointer-events: none;
  user-select: none;
  color: var(--text-tertiary);
  font-style: normal;
  opacity: 0.55;
}

.editor-wrapper :deep(.tiptap) {
  outline: none;
  min-height: 1.3em;
  line-height: var(--leading-snug);
  padding: 0 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

.editor-wrapper :deep(.heading-preview) {
  font-weight: var(--font-semibold);
  line-height: var(--leading-snug);
  margin: 0;
  padding: 0;
  border: none;
  background: none;
}

.editor-wrapper :deep(.heading-preview-h1) {
  font-size: var(--heading-1);
  font-weight: var(--heading-1-weight);
}

.editor-wrapper :deep(.heading-preview-h2) {
  font-size: var(--heading-2);
  font-weight: var(--heading-2-weight);
}

.editor-wrapper :deep(.heading-preview-h3) {
  font-size: var(--heading-3);
  font-weight: var(--heading-3-weight);
}

.editor-wrapper :deep(.heading-preview-h4) {
  font-size: var(--heading-4);
  font-weight: var(--heading-4-weight);
}

.editor-wrapper :deep(.heading-preview-h5) {
  font-size: var(--heading-5);
  font-weight: var(--heading-5-weight);
  opacity: var(--heading-5-opacity);
}

.editor-wrapper :deep(.heading-preview-h6) {
  font-size: var(--heading-6);
  font-weight: var(--heading-6-weight);
  opacity: var(--heading-6-opacity);
}
</style>
