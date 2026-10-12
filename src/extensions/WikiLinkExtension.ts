import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'
import { getRelationshipColor } from '../types/relationship'
import { useRelationshipTypes } from '../composables/useRelationshipTypes'
import { createInlineUnitKeyboardPlugin } from './inline-unit-keyboard'
import { isWikiLinkMenuOpen } from './WikiLinkTriggerExtension'

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
    return [
      new Plugin({
        key: new PluginKey('wikiLink'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            const { typed, plain } = scanWikiLinks(state.doc)

            // 普通 wiki link（包括 typed link 的 [[X]] 部分）：
            // 外层 .block-link + 首尾 .wiki-bracket，与渲染态结构一致
            for (const link of plain) {
              decorations.push(
                Decoration.inline(link.from, link.to, {
                  class: 'block-link',
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
        },
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, prev) {
            return prev.map(tr.mapping, tr.doc)
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
