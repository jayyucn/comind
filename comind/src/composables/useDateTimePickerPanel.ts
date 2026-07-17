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
import { usePropertyStore } from '../stores/property'
import { DATE_REF_CLICK_EVENT } from '../extensions/DateRefExtension'
import { serializeDateRef } from '../utils/date-ref'
import type { DateRefKind, RecurrenceRule, DateRef } from '../utils/date-ref'
import type { DateRefClickPayload } from '../extensions/DateRefExtension'
import { closeDateRefMenu } from '../extensions/DateRefTriggerExtension'

export interface DateTimePickerConfirm {
  kind: DateRefKind
  iso: string
  recurrence: RecurrenceRule
  leadMinutes: number
}

/** 面板顶部与 block 底部的垂直间距(px)，避免遮住 block 内容 */
export const DATE_PICKER_BOTTOM_OFFSET = 8

/**
 * 计算面板坐标：
 * - 水平对齐 date-ref 文字左缘
 * - 垂直落在 block 底部下方（间距由 DATE_PICKER_BOTTOM_OFFSET 决定）
 */
export function computeDatePickerPosition(dateRefEl: HTMLElement): { x: number; y: number } {
  const blockEl = dateRefEl.closest('.block')
  const blockRect = blockEl ? blockEl.getBoundingClientRect() : dateRefEl.getBoundingClientRect()
  const refRect = dateRefEl.getBoundingClientRect()
  return { x: refRect.left, y: blockRect.bottom + DATE_PICKER_BOTTOM_OFFSET }
}

/** 去掉 content 中多余的 kind 类型 date-ref，仅保留第一个 */
export function deduplicateDateRef(content: string, kind: string): string {
  const re = /\{\{([^:]+):([^\|]+)(?:\|([^\}]+))?\}\}/g
  const parts: string[] = []
  let lastIndex = 0
  let count = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (m[1] === kind) {
      count++
      if (count > 1) {
        parts.push(content.slice(lastIndex, m.index))
        lastIndex = m.index + m[0].length
      }
    }
  }
  parts.push(content.slice(lastIndex))
  return parts.join('')
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
   * 1. 用 editor.chain().insertContentAt 替换 PM 文档中的旧 dateRef（editor 模式）
   *    或写入 block.content 字符串（content 模式）
   * 2. content 模式：切换 kind 时去重
   * 3. 关闭面板
   */
  async function handleConfirm(value: DateTimePickerConfirm) {
    const state = editorStore.dateRefEditor
    if (!state) {
      close()
      closeDateRefMenu()
      return
    }

    const { from, to, source, blockId } = state
    const newText = serializeDateRef({
      kind: value.kind,
      iso: value.iso,
      recurrence: value.recurrence,
      leadMinutes: value.leadMinutes,
    })

    let inserted = false

    if (source === 'editor') {
      const editor = editorStore.activeEditor
      if (!editor || !editor.state?.doc?.content) {
        close()
        closeDateRefMenu()
        return
      }

      const docSize = editor.state.doc.content.size
      const cursor = editor.state.selection.from

      // 核心验证：只有当 textBetween(from, to) 真的等于 {{
      // 才能用 saved range。这样既验证了边界，也验证了内容正确性
      if (from >= 0 && from < docSize && to > from) {
        const sliced = editor.state.doc.textBetween(from, to, ' ')
        if (sliced === '{{') {
          editor.chain().deleteRange({ from, to }).insertContent(newText).run()
          inserted = true
        }
      }

      if (!inserted) {
        // saved range 不可用，在光标附近搜索最近的 {{
        const searchWindow = 30
        let found = false
        let resolvedFrom = cursor
        let resolvedTo = cursor

        editor.state.doc.descendants((node: any, pos: number) => {
          if (!node.isText || found) return
          const text = node.text || ''
          for (let i = 0; i < text.length; i++) {
            if (text[i] === '{' && i + 1 < text.length && text[i + 1] === '{') {
              const absFrom = pos + i
              const absTo = pos + i + 2
              if (Math.abs(absFrom - cursor) <= searchWindow) {
                resolvedFrom = absFrom
                resolvedTo = absTo
                found = true
                return false
              }
            }
          }
        })

        if (found) {
          editor.chain().deleteRange({ from: resolvedFrom, to: resolvedTo }).insertContent(newText).run()
        } else {
          editor.chain().insertContentAt(cursor, newText).run()
        }
        inserted = true
      }
    } else {
      // T9: 替换阅读态 block content 字符串，并去重
      const blockStore = useBlockStore()
      if (blockId) {
        const block = blockStore.blocks.find(b => b.id === blockId)
        if (block) {
          let newContent = block.content.slice(0, from) + newText + block.content.slice(to)
          // 切换 kind 时去重：确保同种 ref 仅剩当前这条
          newContent = deduplicateDateRef(newContent, value.kind)
          blockStore.updateBlockContent(blockId, newContent)
          inserted = true
        }
      }
    }

    // 自动将 block 标记为 Todo 任务：
    // 添加 /schedule 或 /deadline（即插入 schedule/deadline 类型的 dateRef）时，
    // 若 block 尚未有任何 status（Todo/Doing/Done/Canceled），则补一个 Todo。
    // 注意：删除 dateRef 时不会反向清除 status（保持任务状态），见需求约束。
    if (inserted && blockId && (value.kind === 'schedule' || value.kind === 'deadline')) {
      const propertyStore = usePropertyStore()
      await propertyStore.ensureTodo(blockId)
    }

    close()
    closeDateRefMenu()
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
    onClick(payload, computeDatePickerPosition(e.target as HTMLElement))
  }

  onMounted(() => document.addEventListener(DATE_REF_CLICK_EVENT, handler as EventListener))
  onBeforeUnmount(() =>
    document.removeEventListener(DATE_REF_CLICK_EVENT, handler as EventListener)
  )
}
