import type { Node } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { ReplaceStep } from '@tiptap/pm/transform'
import type { EditorView } from '@tiptap/pm/view'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

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
 * - **选择闸门（appendTransaction）**：纯选区事务（点击/拖拽/双击词选/Shift 与
 *   Ctrl+方向键/程序化 setSelection）的端点不得落在单元内部 —— 光标钳到近端边界，
 *   选区扩展的 head 吸附到行进方向远端边界（吸近端会让 shift+→ 卡死在左缘）。
 *   改文档的事务中只钳「纯删除」（选区 Backspace/Delete/剪切）：删 pad 空格会让
 *   贪婪单元（tag 正则吸字母数字）与后续文本黏连扩展，删除落点坠入扩展后的
 *   单元内部。纯插入（打字/IME/粘贴，step.from === step.to）与替换（slice 非空：
 *   IME 确认、选区打字替换）放行：单元「建造中」需要内部光标（tag 打字中
 *   `#ab` 即匹配单元、`[[]]` 手工填充光标停在闭括号前）。
 *   IME 组合中及确认事务落定前（compositionend 之后 PM 才派生确认事务）全放行。
 * - **放行条件**：isBlocked() 为真（补全菜单打开中）/ IME 组合中。
 */
export function createInlineUnitKeyboardPlugin(options: InlineUnitKeyboardOptions): Plugin {
  const { key, findRanges, isBlocked } = options

  // IME 组合护栏：>0 表示组合中或确认事务尚未落定。compositionend 之后 PM 才
  // 派生确认事务（替换组合范围），立即复位会钳掉建造光标；延迟到宏任务复位。
  // epoch 比对防竞态：上一次 end 的延迟复位不得清掉新一次 start 的计数。
  let composingEpoch = 0

  return new Plugin({
    key: new PluginKey(key),

    props: {
      handleDOMEvents: {
        compositionstart: () => {
          composingEpoch++
          return false
        },
        compositionend: () => {
          const epoch = composingEpoch
          setTimeout(() => {
            if (composingEpoch === epoch) composingEpoch = 0
          }, 0)
          return false
        },
      },

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

      // 块尾光标锚点：单元右缘恰为所在文本块内容末尾（无尾随字符）时，浏览器
      // 的 contentEditable 会把块尾光标吸进最后一个 inline 元素（chip 内部，
      // 视觉穿帮 —— 拖拽/shift+← 选中尾部 pad 空格删除后即触发）。放一个零宽
      // widget 在 to 处，给光标一个 chip 外的 DOM 锚点。非块尾（有尾随字符）
      // 光标自然锚定在字符间，无需干预。
      decorations(state: EditorState) {
        const widgets: Decoration[] = []
        for (const range of findRanges(state.doc)) {
          const $to = state.doc.resolve(range.to)
          if ($to.parentOffset === $to.parent.content.size) {
            widgets.push(
              Decoration.widget(
                range.to,
                () => {
                  const anchor = document.createElement('span')
                  anchor.textContent = '\u200b'
                  return anchor
                },
                { side: 1, ignoreSelection: true },
              ),
            )
          }
        }
        if (widgets.length === 0) return DecorationSet.empty
        return DecorationSet.create(state.doc, widgets)
      },
    },

    // 选择闸门：纯选区事务与「纯删除」事务的端点不得落在单元内部
    // （光标/选区永不入 chip）。覆盖入口：点击（配合各扩展 handleClick 的选区
    // 还原，此处兜底）、按住拖拽、双击原生词选（经 selectionchange 同步回 PM）、
    // Shift/Ctrl+方向键、Up/Down 跨行几何落点、程序化 setTextSelection、
    // 选中 pad 空格删除（贪婪单元黏连扩展，见 appendTransaction 内注释）。
    // 打字/IME/粘贴/补全插入属单元建造，光标合法地在单元文本内生长
    // （tag 打字中 `#ab` 即匹配完整单元正则、`[[]]` 手工填充停在闭括号前），
    // 钳掉会直接打断输入。
    // ⚠️ appendTransaction 是 PluginSpec 顶层字段，放进 props 会被静默忽略。
    appendTransaction(trs: readonly Transaction[], _oldState: EditorState, newState: EditorState) {
      if (isBlocked?.()) return null
      if (composingEpoch > 0) return null

      const docChanged = trs.some(tr => tr.docChanged)
      if (docChanged) {
        // 删除性事务（选区 Backspace/Delete/剪切、redo 删除）落点钳制 ——
        // 删 pad 空格会让贪婪单元（tag 正则吸字母数字）与后续文本黏连扩展，
        // 删除落点坠入扩展后的单元内部。纯插入（打字/粘贴）与替换（slice
        // 非空：IME 确认、选区打字替换）放行 —— 单元建造需要内部光标。
        const hasDeletion = trs.some(tr =>
          tr.steps.some(
            step =>
              step instanceof ReplaceStep &&
              step.from < step.to &&
              step.slice.size === 0,
          ))
        if (!hasDeletion) return null
      }

      const sel = newState.selection
      if (!(sel instanceof TextSelection)) return null

      const ranges = findRanges(newState.doc)
      if (ranges.length === 0) return null

      const hit = (pos: number) => ranges.find(r => pos > r.from && pos < r.to)
      // 等距平局取右缘：删除右 pad 场景光标语义来自单元右缘带，贴右缘更自然
      const nearest = (pos: number, r: InlineUnitRange) =>
        pos - r.from < r.to - pos ? r.from : r.to

      const anchorHit = hit(sel.anchor)
      const anchor = anchorHit ? nearest(sel.anchor, anchorHit) : sel.anchor

      // head 方向感知：选区扩展（shift+方向键/拖拽）穿过单元时吸附到行进方向的
      // 远端边界 —— 吸近端会让 shift+→ 卡死在单元左缘（from+1 恒被钳回 from），
      // 原子语义应表现为「选区整体吞掉单元」。空选区（光标）取近端即可。
      const headHit = hit(sel.head)
      let head = sel.head
      if (headHit) {
        head =
          sel.head === sel.anchor
            ? nearest(sel.head, headHit)
            : sel.head > sel.anchor
              ? headHit.to
              : headHit.from
      }

      if (anchor === sel.anchor && head === sel.head) return null
      return newState.tr.setSelection(TextSelection.create(newState.doc, anchor, head))
    },
  })
}
