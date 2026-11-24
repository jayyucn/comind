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
import { useFieldValueStore } from '../stores/fieldValue'
import { DATE_REF_CLICK_EVENT } from '../extensions/DateRefExtension'
import { serializeDateRef, DATE_REF_AT_REGEX } from '../utils/date-ref'
import { padUnitForDoc, padInlineUnit } from '../utils/inline-unit-pad'
import type { DateRefKind, RecurrenceRule } from '../utils/date-ref'
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
  const re = new RegExp(DATE_REF_AT_REGEX.source, 'g')
  const parts: string[] = []
  let lastIndex = 0
  let count = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const emoji = m[2]
    const mKind = emoji ? (emoji === '📅' ? 'schedule' : emoji === '⏰' ? 'deadline' : 'ref') : 'ref'
    if (mKind === kind) {
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

/**
 * editor 模式的补空已泛化为 utils/inline-unit-pad 的 padUnitForDoc
 * （@date-ref / #tag / [[wiki link]] 三家插入路径共用）。
 */

/** 暴露给外部的状态和回调 */
export function useDateTimePickerPanel() {
  const editorStore = useEditorStore()

  const visible = computed(() => editorStore.dateRefEditor?.visible ?? false)
  const position = computed(() => editorStore.dateRefEditor?.position ?? { x: 0, y: 0 })
  const kind = computed(() => editorStore.dateRefEditor?.kind ?? 'schedule')
  const initialIso = computed(() => editorStore.dateRefEditor?.iso ?? '')
  const initialRecurrence = computed(() => editorStore.dateRefEditor?.recurrence ?? 'none')
  const initialLeadMinutes = computed(() => editorStore.dateRefEditor?.leadMinutes ?? 0)

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
      leadMinutes: payload.leadMinutes,
      position: payload.position,
    })
  }

  /** 关闭面板 */
  function close() {
    editorStore.closeDateRefEditor()
  }

  /**
   * 确认回调：执行 T8 闭环
   * 1. editor 模式：删除 from..to 范围的旧文本，插入新 dateRef 文本
   *    content 模式：替换 block.content 字符串中对应区间
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

      const doc = editor.state.doc
      const docSize = doc.content.size
      const cursor = editor.state.selection.from

      // 主路径：from..to 是有效范围且在文档内
      if (from >= 0 && to <= docSize && from < to) {
        const text = padUnitForDoc(doc, from, to, newText)
        // 插入位置显式钉死在 from：deleteRange 用显式范围删除，而 insertContent
        // 默认插在当前 selection —— 两者不对称。面板操作期间 selection 可能漂移
        // （编辑器失焦恢复 / 点击面板按钮 / IME / 跨块选区残留），曾致删除生效
        // 但新文本被写到文档尾，内容顺序错乱。
        editor.chain().deleteRange({ from, to }).insertContentAt(from, text).run()
        inserted = true
      } else if (from >= 0 && from < docSize) {
        // from 有效但 to 无效（如触发器只记录了起始位置）
        // 删除 from 到 cursor 的内容
        const endPos = Math.min(cursor, docSize)
        if (from < endPos) {
          const text = padUnitForDoc(doc, from, endPos, newText)
          editor.chain().deleteRange({ from, to: endPos }).insertContent(text).run()
        } else {
          const text = padUnitForDoc(doc, from, from, newText)
          editor.chain().insertContentAt(from, text).run()
        }
        inserted = true
      }

      // Fallback：在 cursor 附近搜索 dateRef 并替换
      if (!inserted) {
        const searchWindow = 30
        let found = false
        let resolvedFrom = cursor
        let resolvedTo = cursor

        doc.descendants((node, pos) => {
          if (!node.isText || found) return
          const text = node.text || ''
          const re = new RegExp(DATE_REF_AT_REGEX.source, 'g')
          let m: RegExpExecArray | null
          while ((m = re.exec(text)) !== null) {
            const absFrom = pos + m.index
            const absTo = pos + m.index + m[0].length
            if (Math.abs(absFrom - cursor) <= searchWindow) {
              resolvedFrom = absFrom
              resolvedTo = absTo
              found = true
              return false
            }
          }
        })

        if (found) {
          const text = padUnitForDoc(doc, resolvedFrom, resolvedTo, newText)
          // 同主路径：插入位置显式钉死，不依赖当前 selection
          editor.chain().deleteRange({ from: resolvedFrom, to: resolvedTo }).insertContentAt(resolvedFrom, text).run()
        } else {
          const text = padUnitForDoc(doc, cursor, cursor, newText)
          editor.chain().insertContentAt(cursor, text).run()
        }
        inserted = true
      }
    } else {
      // T9: 替换阅读态 block content 字符串，并去重
      const blockStore = useBlockStore()
      if (blockId) {
        const block = blockStore.blocks.find(b => b.id === blockId)
        if (block) {
          const content = block.content
          const left = from > 0 ? content[from - 1] : null
          const right = to < content.length ? content[to] : null
          const text = padInlineUnit(left, right, newText)
          let newContent = content.slice(0, from) + text + content.slice(to)
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
    // ref 类型不触发此行为（纯日期引用，不是任务标记）。
    if (inserted && blockId && (value.kind === 'schedule' || value.kind === 'deadline')) {
      const fieldValueStore = useFieldValueStore()
      await fieldValueStore.ensureTodo(blockId)
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
    initialLeadMinutes,
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
