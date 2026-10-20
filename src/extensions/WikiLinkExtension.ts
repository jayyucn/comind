import { Extension } from '@tiptap/core'
import type { Node } from '@tiptap/pm/model'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { useRelationshipTypes } from '../composables/useRelationshipTypes'
import { getRelationshipColor } from '../types/relationship'
import { createInlineUnitKeyboardPlugin } from './inline-unit-keyboard'
import { isWikiLinkMenuOpen } from './WikiLinkTriggerExtension'

/** 编辑态 wiki link 点击事件（与渲染态 block-link 导航同口径） */
export const WIKI_LINK_CLICK_EVENT = 'wikiLinkClick'

export interface WikiLinkClickPayload {
  /** 目标页名（装饰的 data-page） */
  page: string
}

/**
 * 从中文 label 逆查英文 type（支持双向和 auto-inverse）。
 * decode 后的文本是 label 或 label<->inverseLabel 或 label!，
 * 需要逆查才能知道 color。
 */
function findTypeByLabel(labelText: string): string | undefined {
  const all = useRelationshipTypes().all.value
  // 单方向：精确匹配 label
  const found = all.find(
    r =>
      (!r.deleted && (r.label === labelText || r.inverseLabel === labelText))
  )
  if (found) {
    return found.label === labelText ? found.type : found.inverse ?? found.type
  }
  // 双向 label<->inverseLabel
  if (labelText.includes('<->')) {
    const [l, i] = labelText.split('<->')
    const f = all.find(
      r => !r.deleted && r.label === l && r.inverseLabel === i && r.inverse != null
    )
    return f?.type
  }
  // auto-inverse label!
  if (labelText.endsWith('!')) {
    const base = labelText.slice(0, -1)
    const f = all.find(r => !r.deleted && r.label === base)
    return f?.type
  }
  return undefined
}

/** typed-paren 链接 `((label))[[X]]` 的一次扫描结果 */
interface TypedParenMatch {
  /** 整段范围（键盘原子单元 = 整段：只删 [[X]] 会留下悬挂的 ((label))） */
  from: number
  to: number
  /** 类型段 `((label))` 范围（装饰用） */
  parenFrom: number
  parenTo: number
  relRaw: string
}

/** 普通 wiki link `[[X]]` / `[[X|alias]]` 的一次扫描结果 */
interface PlainLinkMatch {
  from: number
  to: number
  page: string
  display: string
}

/** 单元区间（「新生成」判定用，PM 文档坐标 [from, to)） */
interface UnitRange {
  from: number
  to: number
}

/** 区间有交集即视为同一单元：单元内编辑导致位置平移时不误判为新建 */
function rangesOverlap(a: UnitRange, b: UnitRange): boolean {
  return a.from < b.to && b.from < a.to
}

/** 插件 state：`all` = 当前 doc 全部链接区间；`fresh` = 本次事务新生成的区间（chip-pop 门控） */
interface WikiLinkUnitState {
  all: UnitRange[]
  fresh: UnitRange[]
}

const WIKI_LINK_KEY = new PluginKey<WikiLinkUnitState>('wikiLink')

/**
 * 全 doc 扫描 wiki link（装饰与键盘原语共用同一扫描，保证「视觉单元」与
 * 「交互单元」永远同源）。plain 含 typed-paren 链接的 [[X]] 部分
 * （渲染态同样有 block-link 装饰，不跳过）。
 */
function scanWikiLinks(doc: Node): { typed: TypedParenMatch[]; plain: PlainLinkMatch[] } {
  const typed: TypedParenMatch[] = []
  const plain: PlainLinkMatch[] = []

  doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text || ''

    // 编辑态 typed link：((type))[[X]] 或 ((type))[[X|alias]]
    // 注意：编辑态中 ((...)) 内是 decode 后的中文 label，匹配时用通用模式
    let m: RegExpExecArray | null
    const typedParenLinkRegex = /\(\(([^)]+)\)\)\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
    while ((m = typedParenLinkRegex.exec(text)) !== null) {
      const fullStart = pos + m.index
      typed.push({
        from: fullStart,
        to: fullStart + m[0].length,
        // 类型段：从 (( 到 ))（含括号）
        parenFrom: fullStart,
        parenTo: fullStart + m[0].indexOf('))') + 2,
        relRaw: m[1],
      })
    }

    let match: RegExpExecArray | null
    const linkOnlyRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
    while ((match = linkOnlyRegex.exec(text)) !== null) {
      plain.push({
        from: pos + match.index,
        to: pos + match.index + match[0].length,
        page: match[1],
        display: match[2] || match[1],
      })
    }
  })

  return { typed, plain }
}

/** 键盘原子单元区间（供共享原语现场重建；不读插件 state —— getState 恒空） */
function findWikiLinkRanges(doc: Node): { from: number; to: number }[] {
  const scan = scanWikiLinks(doc)
  const ranges = scan.typed.map(t => ({ from: t.from, to: t.to }))
  for (const link of scan.plain) {
    // typed-paren 整段已覆盖其 [[X]] 部分，不重复入列
    if (ranges.some(r => link.from >= r.from && link.to <= r.to)) continue
    ranges.push({ from: link.from, to: link.to })
  }
  return ranges
}

/**
 * tiptap 扩展：在编辑状态下渲染 [[page]] 链接，
 * 并挂键盘原子语义（Backspace 整删 / 方向键跨越，共享原语 inline-unit-keyboard）。
 * 使用 ProseMirror Decoration 在不改变文档结构的情况下添加样式
 */
export const WikiLinkExtension = Extension.create({
  name: 'wikiLink',

  addProseMirrorPlugins() {
    // 点击 chip 前记录选区，handleClick 触发动作后还原，避免原生光标卡进 chip 内部。
    // 关键：mousedown 绝不能 preventDefault / return true —— PM 的 handleClick 由
    // mousedown 阶段创建的 LeftMouseDown 在 mouseup 触发，跳过它点击行为会整体失效。
    let preClickSel: { from: number; to: number } | null = null

    return [
      new Plugin<WikiLinkUnitState>({
        key: WIKI_LINK_KEY,
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const { typed, plain } = scanWikiLinks(state.doc)
            // chip-pop 门控（ADR-0052 闪入门控）：仅「本次事务新生成」的链接挂
            // .chip-pop 播入场动画；挂载 / 两态切换重建的既有 chip 不播，
            // 否则每次进编辑态全部 wikilink 重播 pop（闪一下）。
            const fresh = WIKI_LINK_KEY.getState(state)?.fresh ?? []

            // 普通 wiki link（包括 typed link 的 [[X]] 部分）：
            // 外层 .block-link + 首尾 .wiki-bracket，与渲染态结构一致
            for (const link of plain) {
              const isNew = fresh.some(f => f.from === link.from && f.to === link.to)
              decorations.push(
                Decoration.inline(link.from, link.to, {
                  class: isNew ? 'block-link chip-pop' : 'block-link',
                  'data-page': link.page,
                  'data-display': link.display
                }),
                Decoration.inline(link.from, link.from + 2, { class: 'wiki-bracket' }),
                Decoration.inline(link.to - 2, link.to, { class: 'wiki-bracket' })
              )
            }

            // typed-paren 链接的类型段 ((label))
            // 结构：外层 .relationship-bracket 包 (( 和 ))（浅色），中间 .rel-type-label 用 --rel-color 着色
            for (const t of typed) {
              const bracketLen = 2
              const labelStart = t.parenFrom + bracketLen
              const labelEnd = t.parenTo - bracketLen

              // 编辑态内是 decode 后的 label，需要 label→type 反查颜色
              const typeOfLabel = findTypeByLabel(t.relRaw)
              const color = typeOfLabel ? getRelationshipColor(typeOfLabel) : undefined

              decorations.push(
                Decoration.inline(t.parenFrom, t.parenTo, { class: 'relationship-bracket' }),
                Decoration.inline(labelStart, labelEnd, {
                  class: 'rel-type-label',
                  ...(color ? { style: `--rel-color:${color}` } : {})
                })
              )
            }

            return DecorationSet.create(state.doc, decorations)
          },

          // 仅记录点击前选区，不拦截 —— PM 正常走 mousedown→mouseup→handleClick，
          // 点击行为（页面导航）与渲染态一致。
          handleDOMEvents: {
            mousedown(view: EditorView, event: MouseEvent) {
              const target = event.target as HTMLElement | null
              if (target && target.closest && target.closest('.block-link')) {
                preClickSel = { from: view.state.selection.from, to: view.state.selection.to }
              }
              return false
            },
          },

          // 编辑态 wiki link 点击 → 页面导航（与渲染态 block-link data-page 同口径）。
          // 走 DOM CustomEvent 通道（ADR-0016）：editorEvents 消费后调 navigateToPage。
          // typed-paren 的 [[X]] 部分同挂 .block-link + data-page，点击同样导航
          // （渲染态 typed_link 段亦如此）；((label)) 类型段归 rel-type-label 分支，不在此列。
          handleClick(view: EditorView, pos: number, event: MouseEvent) {
            const target = event.target as HTMLElement
            const link = target.closest('.block-link') as HTMLElement | null
            const page = link?.dataset.page
            if (!page) return false

            link!.dispatchEvent(
              new CustomEvent(WIKI_LINK_CLICK_EVENT, {
                bubbles: true,
                composed: true,
                detail: { page } satisfies WikiLinkClickPayload,
              })
            )

            // 还原选区：点击 chip 不应把光标落进 chip 内部（优先点击前位置，
            // 否则退到单元右侧边界，保证光标在 chip 之外）。
            const scan = scanWikiLinks(view.state.doc)
            const match = [...scan.typed, ...scan.plain].find(
              m => pos >= m.from && pos <= m.to
            )
            const restore = preClickSel ?? { from: match?.to ?? pos, to: match?.to ?? pos }
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.create(view.state.doc, restore.from, restore.to)
              )
            )
            preClickSel = null
            return true
          },
        },
        state: {
          init(_, state) {
            // 初始 doc 的链接全部视为「已存在」：编辑器挂载（含渲染态→编辑态切换重建）
            // 不播 pop。与 CSS 侧「动画只挂 .chip-pop」共同构成闪入门控（ADR-0052）。
            return {
              all: scanWikiLinks(state.doc).plain.map(p => ({ from: p.from, to: p.to })),
              fresh: [],
            }
          },
          apply(tr, prev) {
            // 非文档事务（选区变化等）不重扫：保持 fresh，pop 动画 300ms 内的
            // setSelection 不会把 chip-pop 类抖掉。
            if (!tr.docChanged) return prev
            const mapped = prev.all.map(r => ({
              from: tr.mapping.map(r.from, -1),
              to: tr.mapping.map(r.to, 1),
            }))
            const all = scanWikiLinks(tr.doc).plain.map(p => ({ from: p.from, to: p.to }))
            return { all, fresh: all.filter(r => !mapped.some(m => rangesOverlap(m, r))) }
          }
        },
      }),

      // 键盘原子语义（Backspace 右缘整删 / Delete 左缘镜像 / ←→ 缘带跨越）
      // 走共享原语 inline-unit-keyboard，口径与 date-ref / #tag 一致。
      // 补全菜单打开中整体放行（isWikiLinkMenuOpen）：菜单不抢焦点，必须显式避开。
      createInlineUnitKeyboardPlugin({
        key: 'wikiLinkKeyboard',
        findRanges: findWikiLinkRanges,
        isBlocked: isWikiLinkMenuOpen,
      }),
    ]
  }
})
