<script setup lang="ts">
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { useDateTimePickerPanel } from '../composables/useDateTimePickerPanel'
import { useDomEvents } from '../composables/useDomEvents'
import { useNavigateToPage } from '../composables/useNavigateToPage'
import { useNavigateToTag } from '../composables/useNavigateToTag'
import { useOpenPageInOtherPane } from '../composables/useOpenPageInOtherPane'
import { useRelationshipMenu } from '../composables/useRelationshipMenu'
import BracketPairExtension from '../extensions/BracketPairExtension'
import type { DateRefClickPayload } from '../extensions/DateRefExtension'
import { DateRefExtension } from '../extensions/DateRefExtension'
import { DateRefTriggerExtension } from '../extensions/DateRefTriggerExtension'
import EnterAsBlockExtension from '../extensions/EnterAsBlockExtension'
import { InlineBackgroundColor, InlineTextColor } from '../extensions/InlineColorMarks'
import { InlineTagExtension } from '../extensions/InlineTagExtension'
import { closeTagMenuByEditor, findTagAtCursor, InlineTagTriggerExtension, notifyTagMenuSelect } from '../extensions/InlineTagTriggerExtension'
import { ParagraphStylePreviewExtension } from '../extensions/ParagraphStylePreviewExtension'
import { RelationshipTriggerExtension } from '../extensions/RelationshipTriggerExtension'
import { SlashCommandExtension } from '../extensions/SlashCommandExtension'
import { WikiLinkExtension } from '../extensions/WikiLinkExtension'
import { closeWikiLinkMenuByEditor, findWikiLinkAtCursor, notifyWikiLinkMenuSelect, WikiLinkTriggerExtension } from '../extensions/WikiLinkTriggerExtension'
import { useEditorStore } from '../stores/editor'
import { usePageStore } from '../stores/pages'
import { useTagsStore } from '../stores/tags'
import { type BlockAlign,blockAlignOf } from '../utils/block-align'
import type { DateRefKind } from '../utils/date-ref'
import { debounce } from '../utils/debounce'
import type { InlineMarkAttrs, InlineMarkRange } from '../utils/inline-marks'
import { inlineMarksToHtml, normalizeInlineMarks, sameInlineMarks } from '../utils/inline-marks'
import { padUnitForDoc } from '../utils/inline-unit-pad'
import { pageNameRejectionHint, validatePageName } from '../utils/page-name'
import { isTagColorToken } from '../utils/tag-color'
import { createEditorEvents } from './Block/editorEvents'
import DateRefKindSelector from './DateRefKindSelector.vue'
import InlineFormatToolbar from './InlineFormatToolbar.vue'
import PageLinkMenu from './PageLinkMenu.vue'
import TagMenu from './TagMenu.vue'

const props = defineProps<{
  blockId: string
  content: string
  /** 行内格式（加粗/斜体/下划线/删除线/文字色/背景色），偏移相对 content */
  inlineMarks?: InlineMarkRange[]
  /** 块格式：工具条按 `align` 显示对齐激活态（正文本身由 Block 的 `.block-content` 承载） */
  blockFormat?: Record<string, unknown>
  showFullPlaceholder?: boolean
  readonly?: boolean
}>()

const emit = defineEmits<{
  /**
   * `commitTags`：本次保存是否为提交动作（blur/unmount = true，防抖打字 = false）。
   * 打字中间态（#f、#fo）不得建标签 —— 与 [[page]] 的创建语义对齐（ADR-0050）。
   * `flush`：是否立即等待落库（默认 true）；与 Block 的 handleSave 形参顺序一致。
   * `marks`：编辑器当前的行内格式（偏移相对本次 content）。
   */
  (e: 'save', content: string, commitTags?: boolean, flush?: boolean, marks?: InlineMarkRange[]): void
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
  /**
   * 块级对齐（工具条的对齐下拉）。对齐不是行内 mark，作用对象是整块，
   * 因此向上抛给 `Block` 写 `format.align`，由它统一下发到 `.block-content`。
   */
  (e: 'align', value: BlockAlign): void
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
  if (editor.value) {
    const payload = getContentPayload()
    emit('save', payload.text, false, true, payload.marks)
  }
}, 300)

function cancelDebouncedSave() {
  debouncedEmitSave.cancel()
}

const hasContent = ref(!!props.content)
/** 选区/文档版本号：驱动浮出格式工具条重算激活态与位置（TipTap 状态非响应式） */
const selectionRevision = ref(0)
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
const { openPageInOtherPane } = useOpenPageInOtherPane()

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
      // 列表节点同样禁用：本库的列表是**正文前缀**（`- ` / `1. `，见 parseList），不是
      // ProseMirror 的 list 节点。留着内置 input rule 会在敲下 `- ` 的瞬间把标记吃成
      // 一个 list 节点，随后 `textToHtml` 往返又把标记抹掉 —— 表现为「- 敲了没反应」。
      bulletList: false, orderedList: false, listItem: false,
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
    // 编辑态段落样式预览：前缀（`# ` / `- ` / `1. `）藏起来换标记 + 标题放大
    ParagraphStylePreviewExtension,
    InlineTextColor,
    InlineBackgroundColor,
    DateRefExtension,
    DateRefTriggerExtension,
  ],
  content: textToHtml(props.content, props.inlineMarks),
  parseOptions: PARSE_PRESERVE_WS,
  autofocus: false,
  editable: !props.readonly,
  onBlur: () => {
    if (syncing) return
    // 失焦隐藏选区工具条；revision 变化让工具条重算 visible
    selectionRevision.value++
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
        const payload = getContentPayload()
        emit('save', payload.text, true, true, payload.marks)
      } catch {
        // schema 可能在卸载阶段已为 null，跳过保存
      }
    }
  },
  onUpdate: () => {
    if (props.readonly) return
    if (editor.value && !settingContent) {
      hasContent.value = !!editor.value.getText()
      selectionRevision.value++
      const { from } = editor.value.state.selection
      emit('cursor-change', from)
      debouncedEmitSave()
    }
  },
  onSelectionUpdate: () => {
    if (syncing || settingContent) return
    selectionRevision.value++
  },
  onFocus: () => {
    if (syncing || settingContent) return
    // 双击选词等场景的首次选区更新可能早于 focus 到达，工具条会按「未聚焦」算成不可见；
    // 聚焦后再补一次，保证选中文字时浮出
    selectionRevision.value++
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

  // 区间替换一次完成（insertContentAt），不拆成 deleteRange + insertContent：
  // 后者的插入目标取自删除后的 tr.selection 映射，而 Enter 确认路径（keydown 内派发
  // wiki-link-menu-enter）下该映射不落到删除后的位置 ⇒ insertContent 静默落空、只剩删除
  // 结果，整个块被清空（鼠标点击走同一条链却正常）。区间替换直接给出替换区间，不依赖
  // selection。回归：tests/wiki-link-menu-keyboard.spec.ts。
  editor.value.chain()
    .insertContentAt({ from, to }, padded)
    // 光标落 padded 末尾——padded 已含左 pad，故不再额外加 leftPad。
    .setTextSelection(from + padded.length)
    .focus()
    .run()

  menuVisible.value = false
  closeWikiLinkMenuByEditor()
}

/**
 * 编辑器模式的「转为页面引用」状态（与 range 模式同一判据、同一浮条位置）。
 *
 * 编辑态的 doc 存的是**原文**（`[[X]]` 就是方括号本身，chip 只是 decoration），
 * 所以这里不需要「是否覆盖已渲染单元」这一步：用户选中 chip 时 `textBetween`
 * 直接带出 `[[X]]`，字符判据会拦下。
 *
 * 但「不能包含「[」」对一个只看到 chip 的用户等于没说 —— 他眼里没有括号。
 * 因此先认 `[[`：命中就直说是引用语法，而不是让他去找一个看不见的字符。
 */
const wrapPageRefState = computed<{ enabled: boolean; hint?: string } | null>(() => {
  void selectionRevision.value
  const instance = editor.value
  if (!instance) return null
  const { from, to } = instance.state.selection
  if (from === to) return null
  const raw = instance.state.doc.textBetween(from, to)
  if (raw.includes('[[') || raw.includes(']]')) {
    return { enabled: false, hint: '选区包含引用语法 [[ ]]，不能作为页面名' }
  }
  const hint = pageNameRejectionHint(raw)
  return hint ? { enabled: false, hint } : { enabled: true }
})

/**
 * 把当前编辑器选区包裹为 `[[页名]]`（D4–D7，与 range 模式同口径）。
 *
 * 替换用 `insertContentAt({from,to})` 一次完成（理由见 handleWikiLinkSelect：
 * 拆成 delete + insert 时 Enter 路径的 `tr.selection` 映射会落空）。
 *
 * 页面创建**不阻塞插入**：真机上那是一次 SQLite 落库往返，放在前面会让用户点完
 * 按钮到看见结果之间空一段。插入后的提交保存里 Rust 会按 title 建页并补 link
 * （`create_missing_pages`），这次 get-or-create 只为让侧栏与 `[[` 搜索立刻可见。
 */
async function wrapSelectionAsPageRef() {
  const instance = editor.value
  if (!instance) return
  const { from, to } = instance.state.selection
  if (from === to) return

  const check = validatePageName(instance.state.doc.textBetween(from, to))
  if (!check.ok) {
    useEditorStore().showToast(check.message, 'error')
    return
  }
  const name = check.name

  // 与 `[[` 补全插页同源：补空后光标落 padded 末尾（`]]` 之后）
  const padded = padUnitForDoc(instance.state.doc, from, to, `[[${name}]]`)
  instance.chain()
    .insertContentAt({ from, to }, padded)
    .setTextSelection(from + padded.length)
    .focus()
    .run()

  void usePageStore()
    .getOrCreatePageByTitle(name)
    .catch((err: unknown) =>
      useEditorStore().showToast(`页面「${name}」未能创建：${(err as Error).message}`, 'error'),
    )
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

  // 同 handleWikiLinkSelect：区间替换一次完成，避免 Enter 确认路径下
  // deleteRange + insertContent 的插入步落空把整块清空。
  editor.value.chain()
    .insertContentAt({ from, to }, padded)
    // 光标落 padded 末尾——padded 已含左 pad，故不再额外加 leftPad。
    .setTextSelection(from + padded.length)
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
  getContentPayload,
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
  openPageInOtherPane: (pageName: string) => {
    void openPageInOtherPane(pageName).catch(err => {
      console.error('另一栏打开失败:', err)
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
      editor.value.commands.setContent(textToHtml(newContent, props.inlineMarks), { parseOptions: PARSE_PRESERVE_WS })
      settingContent = false
      syncing = false
    }
  }
)

/**
 * 外部格式变更（撤销/重做恢复 format、剪贴板粘贴等）时同步编辑态。
 * 仅当编辑器正文尚未偏离 props.content（即没有未落库的本地输入）才写回，
 * 避免用旧格式覆盖用户正在输入的内容；内容与格式都相同时跳过，避免 setContent 抖选区。
 */
watch(
  () => props.inlineMarks,
  (marks) => {
    if (!editor.value || syncing || settingContent) return
    const normalized = normalizeInlineMarks(marks, props.content.length)
    const current = getContentPayload()
    if (current.text !== props.content) return
    if (sameInlineMarks(current.marks, normalized)) return
    const { from, to } = editor.value.state.selection
    syncing = true
    settingContent = true
    editor.value.commands.setContent(inlineMarksToHtml(props.content, normalized), { parseOptions: PARSE_PRESERVE_WS })
    const f = clampDocPos(from)
    editor.value.commands.setTextSelection({ from: f, to: Math.max(f, clampDocPos(to)) })
    settingContent = false
    syncing = false
  },
  { deep: true }
)

onBeforeUnmount(() => {
  // 1. 取消 pending 的防抖保存，避免 destroy 后异步触发 emit('save')
  cancelDebouncedSave()
  // 2. 如果有未保存内容，立即同步保存（卸载 = 提交动作，允许建签）
  if (editor.value && !savedFromOutside) {
    try {
      const payload = getContentPayload()
      if (payload.text) {
        emit('save', payload.text, true, true, payload.marks)
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

function textToHtml(text: string, marks?: InlineMarkRange[]): string {
  return inlineMarksToHtml(text, marks ?? [])
}

/** 把 ProseMirror 全部文本节点上的 marks 序列化为相对正文的区间。 */
function serializeMarks(doc: PMNode): InlineMarkRange[] {
  let length = 0
  const raw: InlineMarkRange[] = []
  doc.descendants((node) => {
    if (!node.isText) return
    const text = node.text ?? ''
    const attrs: InlineMarkAttrs = {}
    for (const mark of node.marks) {
      switch (mark.type.name) {
        case 'bold':
          attrs.bold = true
          break
        case 'italic':
          attrs.italic = true
          break
        case 'underline':
          attrs.underline = true
          break
        case 'strike':
          attrs.strike = true
          break
        case 'inlineTextColor':
          if (isTagColorToken(mark.attrs.color)) attrs.color = mark.attrs.color
          break
        case 'inlineBackgroundColor':
          if (isTagColorToken(mark.attrs.color)) attrs.background = mark.attrs.color
          break
      }
    }
    if (Object.keys(attrs).length > 0) {
      raw.push({ start: length, end: length + text.length, ...attrs })
    }
    length += text.length
  })
  return normalizeInlineMarks(raw, length)
}

/** 读取编辑器正文 + 行内格式（硬换行不进入正文，与既有 getText 口径一致）。 */
function getContentPayload(): { text: string; marks: InlineMarkRange[] } {
  const instance = editor.value
  if (!instance) return { text: '', marks: [] }
  const marks = serializeMarks(instance.state.doc)
  const text = instance.state.doc.textBetween(0, instance.state.doc.content.size, '')
  return { text, marks: normalizeInlineMarks(marks, text.length) }
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

defineExpose({
  syncContent,
  focus,
  focusRange,
  focusAtCoords,
  getText: () => editor.value?.getText() ?? '',
  getContent: () => getContentPayload(),
  markSaved,
  getEditor,
  cancelDebouncedSave,
})
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
    <InlineFormatToolbar
      :editor="editor"
      :revision="selectionRevision"
      :block-align="blockAlignOf(props.blockFormat)"
      :wrap-page-ref="wrapPageRefState"
      @apply-align="emit('align', $event)"
      @wrap-page-ref="wrapSelectionAsPageRef"
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
  /* 块内换行的行间距：与渲染态一致（基准行高 +2px） */
  line-height: calc(var(--leading-snug) * 1em + 2px);
  padding: 0 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 编辑态正文前缀（`# ` / `- ` / `1. `）：字符藏起来；列表再摆一个 widget 标记代替
   （标题不出标记，渲染态的标题也没有标记列）。
   标记与渲染态 `.block-list-marker` 同宽（14px）同色（--text-tertiary）同间距（--space-2）
   —— 两态正文起点落在同一列，进出编辑时文字不会左右跳。

   藏法有两个硬约束，缺一个就出可见故障：

   1. **布局宽度必须是 0**（否则正文起点比渲染态右移十来像素）；
   2. **插入符必须有高度** —— `font-size: 0` 只满足第 1 条，第 2 条会一起归零
      （`Range.getClientRects()` 实测 h=0），光标一贴到前缀就整个消失。

   所以走 inline-block：宽度压成 0，字符横向溢出绘制但看不见，插入符站在块内。

   **`white-space: pre` 是必需的，别改 `nowrap`**：前缀末尾是空格（`# ` / `- ` / `1. `），
   `nowrap` 会把这枚尾随空格折叠成零 advance，浏览器的 caret 随即映射到空格**之前** ——
   接着敲的字不是追加而是**替换掉那个空格**（`1. ` + `a` 变成 `1.a`，列表当场不再是列表）。

   **`font-family: monospace` + `letter-spacing: -1ch` 也是必需的**：`width: 0` 只压住盒子，
   盒内字符仍按各自字宽排开，插入符/选区按字形位置画 —— 前缀末尾的插入符会落到正文右侧
   十几像素处（敲字时"光标跳一下"）。等宽字体下每个字符的 advance 恒为 `1ch`，`-1ch`
   把它精确抵消成 0：盒内所有插入点都落在盒子左缘（＝正文起点），选区宽度也是 0。
   字形本来透明，换字体没有视觉代价；`ch` 与 `em` 一样随字号缩放，标题前缀同样成立。

   **字号必须与所在段落一致**：插入符高度取所在文本的字号度量，同一块里两种字号就是
   两种高度的光标 —— 标题前缀若停在正文默认字号，行首光标 24px、标题正文 35px（h1）。
   标题前缀由扩展额外挂上 `heading-preview-hN` 拿字号，这里不必特判；宽度是 `width: 0`
   硬压的，字号变大不会撑开布局。

   字怎么变透明也有讲究：用 `-webkit-text-fill-color`，**不能** `color: transparent`。
   插入符颜色默认是 `currentColor`（即 `color`），`color` 一透明插入符也跟着透明 ——
   高度修好了光标照样看不见。`text-fill-color` 只改字形填充，`color` 保持正常，
   `caret-color: auto` 才能算出可见的插入符。

   **别加 `overflow: hidden`**：那会把溢出的插入符一起裁掉（实测 rect 仍报 h=21，
   但落在裁剪区里，视觉上还是看不见）。也别退回 `font-size: 0` / `display: none`
   —— 后者连字符位置都不参与渲染，Chrome 的退格会一次删掉整段前缀（`- 列表` 退格后
   直接变成 `列表`），Home 也永远到不了行首。 */
.editor-wrapper :deep(.pm-prefix-hidden) {
  display: inline-block;
  width: 0;
  white-space: pre;
  font-family: monospace;
  /* 等宽字体的上下高度只有 1.0em（正文字体约 1.5em）：同字号插入符会从 24 矮到 16。
     放大把度量补回来；`ch` 与字号同比例缩放，advance 仍精确归零，字形本就透明 */
  font-size: 1.5em;
  letter-spacing: -1ch;
  line-height: inherit;
  -webkit-text-fill-color: transparent;
  /* 第二道保险：万一有人把上面换回 `color: transparent`，插入符也不会跟着消失 */
  caret-color: var(--text-primary);
}

/* 标题前缀的字号是「标题字号 × 1.46」而不是继承来的 1.5em：插入符高度取的是字号度量，
   前缀必须自己放大到标题正文那颗插入符的高度（h1 35 / h2 30 / h3 26，实测），
   否则行首光标 24px、正文 35px —— 同一个块里两种高度的光标。1.46 是实测比例（正文字体
   上下高度 1.46–1.5em，等宽字体 1.0em）。宽度由 `width: 0` 硬压，字号放大不撑开布局。 */
.editor-wrapper :deep(.pm-prefix-hidden.heading-preview-h1) { font-size: calc(var(--heading-1) * 1.46); }
.editor-wrapper :deep(.pm-prefix-hidden.heading-preview-h2) { font-size: calc(var(--heading-2) * 1.46); }
.editor-wrapper :deep(.pm-prefix-hidden.heading-preview-h3) { font-size: calc(var(--heading-3) * 1.46); }
.editor-wrapper :deep(.pm-prefix-hidden.heading-preview-h4) { font-size: calc(var(--heading-4) * 1.46); }
.editor-wrapper :deep(.pm-prefix-hidden.heading-preview-h5) { font-size: calc(var(--heading-5) * 1.46); }
.editor-wrapper :deep(.pm-prefix-hidden.heading-preview-h6) { font-size: calc(var(--heading-6) * 1.46); }

/* `-1ch` 已经把 advance 精确压到 0（选区宽 0）；这条再兜一层：万一换字体后字宽超预期，
   前缀被选中时也不会画底色。选区只该属于正文。 */
.editor-wrapper :deep(.pm-prefix-hidden::selection) {
  background-color: transparent;
  -webkit-text-fill-color: transparent;
}

.editor-wrapper :deep(.pm-prefix-marker) {
  display: inline-block;
  min-width: 14px;
  margin-right: var(--space-2);
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  user-select: none;
  pointer-events: none;
}

/* 有序列表序号右对齐：`1.` 与 `10.` 的句点落在同一列（同渲染态） */
.editor-wrapper :deep(.pm-prefix-marker-ordered) {
  text-align: right;
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
