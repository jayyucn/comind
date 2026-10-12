import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** 文档中的一个「键盘原子单元」区间 [from, to)（PM 坐标，含两端字符） */
export interface InlineUnitRange {
  from: number
  to: number
}

export interface InlineUnitKeyboardOptions {
  /** 插件 key（须与宿主扩展的装饰插件不同名，TipTap 会重写为 `<key>$`） */
  key: string
  /**
   * 现场扫描 doc，返回所有原子单元区间。
   *
   * ⚠️ 必须每次调用重新扫描：decorations prop 动态构建的装饰集从不写回插件
   * state，`getState()` 恒为空 —— DateRef 的整单元删除曾因此失效成死代码。
   */
  findRanges: (doc: Node) => InlineUnitRange[]
  /**
   * 返回 true 时本次按键整体放行（如补全菜单打开中：用户正在编辑单元本身，
   * 逐字符删除/菜单导航优先，整删规则不抢）。
   */
  isBlocked?: () => boolean
}

/**
 * inline 原子单元（date-ref / `#tag` / `[[wiki link]]`）的键盘语义共享原语。
 *
 * 口径（DateRefExtension 2026-09-09 起验证、30+ 单测钉住，现收编为唯一实现）：
 * - **pad 语义**：单元两侧紧邻空格属于整体区间 [L, R)（L = from - 左pad，
 *   R = to + 右pad）；装饰 span 仍只覆盖 [from, to)（视觉不含空格）。
 * - **Backspace**：光标在右缘带 [to, R]（含站在右 pad 上）→ 整单元删除；
 *   **Delete**：光标在左缘带 [L, from] → 整单元删除（镜像）。
 *   右 pad 随单元删；左 pad 仅在删后同块右侧无内容（行尾）时连带删，
 *   中间位置保留左 pad 作分隔。单元内部与其他位置保持逐字符删除。
 * - **方向键**：→ 在左缘带 [L, from] 整体跨到 R；← 在右缘带 [to, R] 跨回 L。
 *   仅拦截无修饰键的光标态；ctrl/meta/alt/shift 组合（整词/选区扩展）与
 *   非空选区一律放行。Up/Down 不归此原语管（跨块列保持归 EnterAsBlock）。
 * - **放行条件**：isBlocked() 为真（补全菜单打开中）/ IME 组合中。
 */
export function createInlineUnitKeyboardPlugin(options: InlineUnitKeyboardOptions): Plugin {
  const { key, findRanges, isBlocked } = options

  return new Plugin({
    key: new PluginKey(key),

    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        // IME 组合期间不拦截（候选词删除/确认走默认；tag 可为中文，必须防）
        if (event.isComposing || event.keyCode === 229) return false
        // 补全菜单打开中：用户正在编辑单元本身，整删/跨越规则不抢
        if (isBlocked?.()) return false

        const { state } = view
        // 有选区（非光标态）时不拦截，交给默认删除逻辑处理选区
        if (!state.selection.empty) return false

        const pos = state.selection.from

        // 现场重建单元区间（与装饰同源扫描；不读插件 state，见 findRanges 注释）
        const ranges = findRanges(state.doc)
        if (ranges.length === 0) return false

        const unitBounds = (from: number, to: number) => {
          const size = state.doc.content.size
          const leftPad = from > 0 && state.doc.textBetween(from - 1, from, '\n', ' ') === ' '
          const rightPad = to < size && state.doc.textBetween(to, to + 1, '\n', ' ') === ' '
          return { from, to, leftPad, rightPad, L: leftPad ? from - 1 : from, R: rightPad ? to + 1 : to }
        }

        const deleteUnit = (from: number, to: number) => {
          const u = unitBounds(from, to)
          const blockEnd = state.doc.resolve(u.R).end()
          const rest = u.R < blockEnd ? state.doc.textBetween(u.R, blockEnd, '\n', ' ') : ''
          const restHasContent = rest.trim().length > 0
          const delFrom = restHasContent ? u.from : u.leftPad ? u.L : u.from
          const delTo = restHasContent ? u.R : blockEnd
          let tr = state.tr.delete(delFrom, delTo)
          tr = tr.setSelection(TextSelection.create(tr.doc, delFrom))
          view.dispatch(tr)
        }

        // Backspace 右缘带 = [to, R]（含站在右 pad 空格上）；Delete 左缘带 = [L, from]
        if (event.key === 'Backspace' || event.key === 'Delete') {
          const deletingLeft = event.key === 'Backspace'
          for (const range of ranges) {
            const u = unitBounds(range.from, range.to)
            const inZone = deletingLeft
              ? pos >= range.to && pos <= u.R
              : pos >= u.L && pos <= range.from
            if (!inZone) continue
            event.preventDefault()
            deleteUnit(range.from, range.to)
            return true
          }
        }

        // 方向键: 光标在整体区间左缘带 [L, from] 按 → 整体跨到 R（右 pad 后）；
        // 在右缘带 [to, R] 按 ← 整体跨回 L（左 pad 前）——pad 空格随单元一起跨过，
        // 光标不进入单元与 pad 之间。仅拦截无修饰键的光标态。
        if (
          (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
          !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
        ) {
          for (const range of ranges) {
            const u = unitBounds(range.from, range.to)
            const inZone = event.key === 'ArrowLeft'
              ? pos >= range.to && pos <= u.R
              : pos >= u.L && pos <= range.from
            if (!inZone) continue
            event.preventDefault()
            const target = event.key === 'ArrowLeft' ? u.L : u.R
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, target)))
            return true
          }
        }

        return false
      },
    },
  })
}
