import type { Ref } from 'vue'
import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { getRelationshipLabel } from '../../types/relationship'
import {
  notifyRelationshipMenuSelect,
  closeRelationshipMenuByEditor,
} from '../../extensions/RelationshipTriggerExtension'
import { DATE_REF_CLICK_EVENT, type DateRefClickPayload } from '../../extensions/DateRefExtension'
import type { DateRefKindSelectEvent } from '../../extensions/DateRefTriggerExtension'

export interface RelationshipMenuApi {
  open: (opts: {
    view: any
    position: { x: number; y: number }
    range: { from: number; to: number }
    initialQuery?: string
    onSelect: (type: string) => void
  }) => void
  close: () => void
}

export interface EditorEventCtx {
  emit: (event: string, ...args: unknown[]) => void
  getEditor: () => Editor | undefined
  props: { blockId: string }
  menuVisible: Ref<boolean>
  menuPosition: Ref<{ x: number; y: number }>
  menuRange: Ref<{ from: number; to: number }>
  menuQuery: Ref<string>
  menuRef: Ref<any>
  /** wiki-link 菜单锚点（光标所在 DOM 元素），供 PageLinkMenu 内的 BasePopover 避让/翻转（ADR-0038）。 */
  menuAnchorEl: Ref<HTMLElement | null>
  kindSelectorVisible: Ref<boolean>
  kindSelectorPosition: Ref<{ left: number; top: number; bottom: number }>
  kindSelectorRange: Ref<{ from: number; to: number }>
  kindSelectorView: Ref<any>
  relMenu: RelationshipMenuApi
  openDateRefPanel: (cfg: any, source: string) => void
  closeWikiLinkMenuByEditor: () => void
}

/**
 * 声明式事件表：把 Editor 内 14 个手抄的 DOM CustomEvent handler 收敛到一处。
 * 调用方用 `useDomEvents(view.dom, createEditorEvents(ctx))` 统一注册/清理。
 *
 * 保留 DOM CustomEvent 传输通道（TipTap 扩展够不到父 Vue 组件实例，
 * 且载荷是 ProseMirror 运行时引用需按引用直达）——见 docs/adr/0016。
 * 本函数本身不依赖任何 Vue 组件实例，因此可在测试中以 stub ctx 直接驱动。
 */
export function createEditorEvents(ctx: EditorEventCtx): Record<string, (e: Event) => void> {
  function handleRelationshipTrigger(event: Event) {
    const customEvent = event as CustomEvent<{
      view: any
      position: number
      range: { from: number; to: number }
      relationshipType: string
    }>
    const { view, position, range } = customEvent.detail
    const coords = view.coordsAtPos(position)

    ctx.relMenu.open({
      view,
      position: { x: coords.left, y: coords.bottom + 6 },
      range,
      initialQuery: '',
      onSelect: (newType) => {
        const editor = ctx.getEditor()
        if (!editor) return
        const { state, view: edView } = editor
        const tr = state.tr

        // 检查光标后面是否有自动补全的 ))
        const docSize = state.doc.content.size
        let endPos = range.to
        if (endPos + 2 <= docSize) {
          const afterText = state.doc.textBetween(endPos, endPos + 2)
          if (afterText === '))' || afterText === '））') {
            endPos += 2
          }
        }

        // 替换从 range.from 到 endPos 的内容为 ((label))（编辑态显示中文；保存时 encode 转回 type）
        const label = getRelationshipLabel(newType)
        tr.insertText(`((${label}))`, range.from, endPos)

        // 设置光标到末尾
        const newCursorPos = range.from + label.length + 4 // (( + label + ))
        tr.setSelection(TextSelection.create(tr.doc, newCursorPos))

        edView.dispatch(tr)
        notifyRelationshipMenuSelect()
        closeRelationshipMenuByEditor()
      },
    })
  }

  function handleRelationshipClose(_event: Event) {
    // 扩展在 '(( ' 模式被破坏时（Backspace / 输入字符 / 转义）
    // 派发此事件，关闭关系菜单 UI。
    ctx.relMenu.close()
  }

  function handleDateRefTrigger(event: Event) {
    const customEvent = event as CustomEvent<{
      view: any
      position: number
      range: { from: number; to: number }
      kind: 'schedule' | 'deadline'
    }>
    const { view, position, range, kind } = customEvent.detail
    const coords = view.coordsAtPos(position)

    // PM 节点不携带 blockId，需借助 .block[data-block-id] 包裹层从 DOM 解析
    let blockId: string | null = null
    try {
      const domAt = view.domAtPos(position)
      let domEl: any = domAt.node
      if (domEl && domEl.nodeType === 3) domEl = domEl.parentElement
      const blockEl = domEl?.closest?.('[data-block-id]') as HTMLElement | null
      blockId = blockEl?.dataset?.blockId ?? null
    } catch {
      blockId = null
    }

    ctx.openDateRefPanel(
      {
        blockId: blockId || '',
        from: range.from,
        to: range.to,
        kind,
        iso: new Date().toISOString().slice(0, 10),
        recurrence: 'none',
        leadMinutes: 0,
        position: { x: coords.left, y: coords.bottom + 6 },
      },
      'editor',
    )
  }

  function handleDateRefClick(event: Event) {
    const customEvent = event as CustomEvent<DateRefClickPayload>
    const { from, to, kind, iso, recurrence, leadMinutes } = customEvent.detail

    const target = event.target as HTMLElement
    const rect = target.getBoundingClientRect()

    ctx.openDateRefPanel(
      {
        blockId: ctx.props.blockId || '',
        from,
        to,
        kind,
        iso,
        recurrence,
        leadMinutes,
        position: { x: rect.left, y: rect.bottom + 6 },
      },
      'editor',
    )
  }

  function handleDateRefKindSelect(event: Event) {
    const customEvent = event as CustomEvent<DateRefKindSelectEvent>
    const { view, range, coords } = customEvent.detail
    ctx.kindSelectorView.value = view
    ctx.kindSelectorRange.value = range
    ctx.kindSelectorPosition.value = { left: coords.left, top: coords.top, bottom: coords.bottom }
    ctx.kindSelectorVisible.value = true
  }

  function handleDateRefKindSelectClose(_event: Event) {
    ctx.kindSelectorVisible.value = false
  }

  function handleWikiLinkTrigger(event: Event) {
    const customEvent = event as CustomEvent<{
      view: any
      position: number
      range: { from: number; to: number }
      query: string
    }>

    const { view, position, range, query } = customEvent.detail
    const coords = view.coordsAtPos(position)

    // 由 ProseMirror 文本位置反查光标所在 DOM 元素作为 BasePopover 避让锚点（ADR-0038）。
    // 文本节点取其父元素；反查失败则置 null，PageLinkMenu 回退到 position 模式。
    try {
      const node = view.domAtPos(position).node
      ctx.menuAnchorEl.value =
        node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)
    } catch {
      ctx.menuAnchorEl.value = null
    }

    ctx.menuPosition.value = { x: coords.left, y: coords.bottom + 8 }
    ctx.menuRange.value = range
    ctx.menuQuery.value = query
    ctx.menuVisible.value = true
  }

  function handleWikiLinkUpdate(event: Event) {
    const customEvent = event as CustomEvent<{
      query: string
    }>

    ctx.menuQuery.value = customEvent.detail.query
  }

  function handleWikiLinkClose() {
    ctx.menuVisible.value = false
    ctx.closeWikiLinkMenuByEditor()
  }

  function handleWikiLinkMenuEnter() {
    ctx.menuRef.value?.confirmSelect()
  }

  function handleWikiLinkMenuEscape() {
    ctx.menuRef.value?.close()
  }

  function handleWikiLinkMenuArrowDown() {
    ctx.menuRef.value?.selectNext()
  }

  function handleWikiLinkMenuArrowUp() {
    ctx.menuRef.value?.selectPrev()
  }

  function handleEnterAsBlock(event: Event) {
    const customEvent = event as CustomEvent<{ type: string; pos?: number }>
    switch (customEvent.detail.type) {
      case 'split':
        ctx.emit('split', customEvent.detail.pos ?? 0)
        break
      case 'delete':
        ctx.emit('delete')
        break
      case 'merge':
        ctx.emit('merge')
        break
      case 'indent':
        ctx.emit('indent')
        break
      case 'outdent':
        ctx.emit('outdent')
        break
      case 'moveUp':
        ctx.emit('moveUp')
        break
      case 'moveDown':
        ctx.emit('moveDown')
        break
      case 'exitEdit':
        ctx.emit('exitEdit')
        break
      case 'save': {
        const editor = ctx.getEditor()
        if (editor) {
          ctx.emit('save', editor.getText())
        }
        break
      }
    }
  }

  return {
    'wiki-link-trigger': handleWikiLinkTrigger,
    'wiki-link-update': handleWikiLinkUpdate,
    'wiki-link-close': handleWikiLinkClose,
    'wiki-link-menu-enter': handleWikiLinkMenuEnter,
    'wiki-link-menu-escape': handleWikiLinkMenuEscape,
    'wiki-link-menu-arrowdown': handleWikiLinkMenuArrowDown,
    'wiki-link-menu-arrowup': handleWikiLinkMenuArrowUp,
    'enter-as-block': handleEnterAsBlock,
    'relationship-trigger': handleRelationshipTrigger,
    'relationship-close': handleRelationshipClose,
    'dateRefTrigger': handleDateRefTrigger,
    [DATE_REF_CLICK_EVENT]: handleDateRefClick,
    'dateRefKindSelect': handleDateRefKindSelect,
    'dateRefKindSelectClose': handleDateRefKindSelectClose,
  }
}
