/**
 * useDateTimePickerPanel — dateRef 编辑面板的组合函数
 *
 * 负责：
 * - 监听 dateRefClick 事件，打开面板
 * - 将面板状态同步到 editorStore.dateRefEditor
 * - confirm 回调：执行 PM 文档内容替换（T8 闭环）
 */
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { useEditorStore } from '../stores/editor'
import { useBlockStore } from '../stores/blocks'
import { DATE_REF_CLICK_EVENT } from '../extensions/DateRefExtension'
import { serializeDateRef } from '../utils/date-ref'
import type { DateRefKind, RecurrenceRule, DateRef } from '../utils/date-ref'
import type { DateRefClickPayload } from '../extensions/DateRefExtension'

export interface DateTimePickerConfirm {
  kind: DateRefKind
  iso: string
  recurrence: RecurrenceRule
}

/** 暴露给外部的状态和回调 */
export function useDateTimePickerPanel() {
  const editorStore = useEditorStore()

  const visible = computed(() => editorStore.dateRefEditor?.visible ?? false)
  const position = computed(() => editorStore.dateRefEditor?.position ?? { x: 0, y: 0 })
  const kind = computed(() => editorStore.dateRefEditor?.kind ?? 'schedule')
  const initialIso = computed(() => editorStore.dateRefEditor?.iso ?? '')
  const initialRecurrence = computed(() => editorStore.dateRefEditor?.recurrence ?? 'none')

  /** 打开面板（填充 editorStore.dateRefEditor）
   * @param source — 'editor'（默认，PM 坐标）| 'content'（字符串索引）
   */
  function open(
    payload: DateRefClickPayload & { position: { x: number; y: number } },
    source: 'editor' | 'content' = 'editor'
  ) {
    editorStore.openDateRefEditor({
      blockId: payload.blockId || null,
      from: payload.from,
      to: payload.to,
      source,
      kind: payload.kind,
      iso: payload.iso,
      recurrence: payload.recurrence,
      position: payload.position,
    })
  }

  /** 关闭面板 */
  function close() {
    editorStore.closeDateRefEditor()
  }

  /**
   * 确认回调：执行 T8 闭环
   * 1. 用 editor.chain().insertContentAt 替换 PM 文档中的旧 dateRef
   * 2. 关闭面板
   * 3. 触发 syncContent（由 Block.vue 处理）
   */
  function handleConfirm(value: DateTimePickerConfirm) {
    const state = editorStore.dateRefEditor
    if (!state) {
      close()
      return
    }

    const { from, to, source, blockId } = state
    const newText = serializeDateRef({
      kind: value.kind,
      iso: value.iso,
      recurrence: value.recurrence,
    })

    if (source === 'editor') {
      const editor = editorStore.activeEditor
      if (!editor) {
        close()
        return
      }
      // T8: 替换 PM 文档中的 [from, to] 区间
      editor.chain().insertContentAt({ from, to }, newText).run()
    } else {
      // T9: 替换阅读态 block content 字符串
      const blockStore = useBlockStore()
      if (blockId) {
        const block = blockStore.blocks.find(b => b.id === blockId)
        if (block) {
          const newContent =
            block.content.slice(0, from) + newText + block.content.slice(to)
          blockStore.updateBlockContent(blockId, newContent)
        }
      }
    }

    close()
  }

  return {
    visible,
    position,
    kind,
    initialIso,
    initialRecurrence,
    open,
    close,
    handleConfirm,
  }
}

/** 注册全局 dateRefClick 事件监听 */
export function useDateRefClickListener(
  onClick: (payload: DateRefClickPayload, position: { x: number; y: number }) => void
) {
  function handler(event: Event) {
    const e = event as CustomEvent<DateRefClickPayload> & { target: HTMLElement }
    const payload = e.detail
    if (!payload) return
    const rect = e.target.getBoundingClientRect()
    onClick(payload, { x: rect.left, y: rect.bottom + 6 })
  }

  onMounted(() => document.addEventListener(DATE_REF_CLICK_EVENT, handler as EventListener))
  onBeforeUnmount(() =>
    document.removeEventListener(DATE_REF_CLICK_EVENT, handler as EventListener)
  )
}
