import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { getRelationshipColor } from '../types/relationship'
import { useRelationshipTypes } from '../composables/useRelationshipTypes'

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

/**
 * tiptap 扩展：在编辑状态下渲染 [[page]] 链接
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
            const { doc } = state
            const linkOnlyRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g
            // 编辑态 typed link：((type))[[X]] 或 ((type))[[X|alias]]
            // 注意：编辑态中 ((...)) 内是 decode 后的中文 label，匹配时用通用模式
            const typedParenLinkRegex = /\(\(([^)]+)\)\)\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g

            // 第一遍：收集 typed-paren 类型段范围（((...)) 部分）
            // 注意：((label))[[X]] 的 [[X]] 部分**需要** block-link 装饰（渲染态同样有），
            // 所以只记录 ((label)) 类型段供第三遍装饰，不跳过 [[X]]。
            const typedParenTypeRanges: Array<{ start: number; end: number; raw: string }> = []
            doc.descendants((node, pos) => {
              if (!node.isText) return
              const text = node.text || ''
              let m: RegExpExecArray | null
              // 匹配 ((...))[[X]] 整段，只记录 ((...)) 类型段范围
              typedParenLinkRegex.lastIndex = 0
              while ((m = typedParenLinkRegex.exec(text)) !== null) {
                const fullStart = pos + m.index
                const relRaw = m[1]
                // 类型段：从 (( 到 ))（含括号）
                const parenEnd = fullStart + m[0].indexOf('))') + 2
                typedParenTypeRanges.push({ start: fullStart, end: parenEnd, raw: relRaw })
              }
            })

            // 第二遍：装饰普通 wiki link（包括 typed link 的 [[X]] 部分）
            // typed-paren 的 [[X]] 与普通链接同样处理：block-link + wiki-bracket
            doc.descendants((node, pos) => {
              if (!node.isText) return
              const text = node.text || ''
              let match: RegExpExecArray | null
              linkOnlyRegex.lastIndex = 0
              while ((match = linkOnlyRegex.exec(text)) !== null) {
                const start = pos + match.index
                const end = start + match[0].length
                const display = match[2] || match[1]

                // 创建装饰：外层 .block-link + 首尾 .wiki-bracket，与渲染态结构一致
                decorations.push(
                  Decoration.inline(start, end, {
                    class: 'block-link',
                    'data-page': match[1],
                    'data-display': display
                  }),
                  Decoration.inline(start, start + 2, { class: 'wiki-bracket' }),
                  Decoration.inline(end - 2, end, { class: 'wiki-bracket' })
                )
              }
            })

            // 第三遍：装饰 typed-paren 链接的类型段 ((label))
            // 结构：外层 .relationship-bracket 包 (( 和 ))（浅色），中间 .rel-type-label 用 --rel-color 着色
            for (const r of typedParenTypeRanges) {
              const bracketLen = 2
              const labelStart = r.start + bracketLen
              const labelEnd = r.end - bracketLen

              // 编辑态内是 decode 后的 label，需要 label→type 反查颜色
              const typeOfLabel = findTypeByLabel(r.raw)
              const color = typeOfLabel ? getRelationshipColor(typeOfLabel) : undefined

              decorations.push(
                Decoration.inline(r.start, r.end, { class: 'relationship-bracket' }),
                Decoration.inline(labelStart, labelEnd, {
                  class: 'rel-type-label',
                  ...(color ? { style: `--rel-color:${color}` } : {})
                })
              )
            }

            return DecorationSet.create(doc, decorations)
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
      })
    ]
  }
})
