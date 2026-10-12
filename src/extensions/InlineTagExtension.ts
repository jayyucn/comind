import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node } from '@tiptap/pm/model'
import { TAG_TRIGGER_SOURCE } from '../composables/useContentRenderer'
import { tagChipStyle } from '../utils/tag-color'
import { createInlineUnitKeyboardPlugin } from './inline-unit-keyboard'
import { isTagMenuOpen } from './InlineTagTriggerExtension'

/** 装饰 `#tag` 所需的标签信息（标签色 + 系统标记）。 */
export interface InlineTagInfo {
  color: string
  is_system: boolean
}

export interface InlineTagOptions {
  /**
   * `#tag` 标题 → 标签信息。由宿主（`Editor.vue`）注入闭包 —— 扩展不碰 Pinia。
   * 每次重建装饰都重新求值 ⇒ 天然吃最新标签色；返回 undefined（查无此 tag）
   * 时按「无色、非系统」渲染，与渲染态缺 tag 行时的兜底一致。
   */
  resolve: ((title: string) => InlineTagInfo | undefined) | null
}

/** 一次扫描出的 inline `#tag` 匹配 */
interface InlineTagMatch {
  from: number
  to: number
  /** tag 名（不含 #） */
  title: string
}

/**
 * 全 doc 扫描 `#tag`（装饰与键盘原语共用同一扫描，保证「视觉单元」与
 * 「交互单元」永远同源）。独立正则实例防 lastIndex 互踩。
 */
function scanInlineTags(doc: Node): InlineTagMatch[] {
  const matches: InlineTagMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    const text = node.text || ''
    const tagRegex = new RegExp(TAG_TRIGGER_SOURCE, 'gu')
    let match: RegExpExecArray | null
    while ((match = tagRegex.exec(text)) !== null) {
      // match[0] = '#tag'（装饰整段）、match[1] = tag 名（查色用）
      matches.push({
        from: pos + match.index,
        to: pos + match.index + match[0].length,
        title: match[1],
      })
    }
  })
  return matches
}

/**
 * tiptap 扩展：编辑态把 inline `#tag` **整体**装饰成 `.block-tag` 胶囊，
 * 并挂键盘原子语义（Backspace 整删 / 方向键跨越，共享原语 inline-unit-keyboard）。
 *
 * **与渲染态同形**（ADR-0050 D11）：类名、内联色、`#` 的字面字符全部一致 ——
 * 两态产出同一份 DOM（`<span class="block-tag">#tag</span>`），切进切出零抖动。
 *
 * 形态为何是「一层装饰盖住整个 `#tag`」，而不是「`#` 换图标 + 胶囊只包名字」：
 * ProseMirror 的 inline decoration 内部是**扁平区间**，没有树 —— 渲染前必跑
 * `removeOverlap`，同起点的两层会被截断成相邻两段。`#` 与胶囊恰好同起点，于是
 * 「图标落在胶囊内」物理不可达（实测会挤成 `class="tag-hash block-tag"` 同一元素，
 * mask 与底色抢同一个 `background`）。故取一层装饰，`#` 保持字面字符。
 *
 * 装饰只加 class/style 不改文档内容，`#` 仍是文本节点里的字符 ——
 * 光标/选区偏移不变（与 `WikiLinkExtension` 的 `[[` / `]]` 装饰同一手法）。
 */
export const InlineTagExtension = Extension.create<InlineTagOptions>({
  name: 'inlineTag',

  addOptions() {
    return { resolve: null }
  },

  addProseMirrorPlugins() {
    const resolve = this.options.resolve

    return [
      new Plugin({
        key: new PluginKey('inlineTag'),
        props: {
          decorations(state) {
            const decorations: Decoration[] = []

            for (const match of scanInlineTags(state.doc)) {
              const info = resolve ? resolve(match.title) : undefined
              const classes = ['block-tag']
              if (info?.is_system) classes.push('block-tag--system')
              const attrs: Record<string, string> = { class: classes.join(' ') }
              // 与渲染态共用同一份样式原语（白名单在 tagChipStyle 内：色值须过名单才进 DOM）
              const style = tagChipStyle(info?.color)
              if (style) {
                attrs.style = Object.entries(style)
                  .map(([prop, value]) => `${prop}:${value}`)
                  .join(';')
              }
              decorations.push(
                Decoration.inline(match.from, match.to, attrs)
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
          },
        },
      }),

      // 键盘原子语义（Backspace 右缘整删 / Delete 左缘镜像 / ←→ 缘带跨越）
      // 走共享原语 inline-unit-keyboard，口径与 date-ref / wiki link 一致。
      // 补全菜单打开中整体放行（isTagMenuOpen）：用户正在编辑 tag 本身，
      // 逐字符删除与菜单导航优先，整删规则不抢（菜单不抢焦点，故必须显式避开）。
      createInlineUnitKeyboardPlugin({
        key: 'inlineTagKeyboard',
        findRanges: doc => scanInlineTags(doc).map(m => ({ from: m.from, to: m.to })),
        isBlocked: isTagMenuOpen,
      }),
    ]
  },
})
