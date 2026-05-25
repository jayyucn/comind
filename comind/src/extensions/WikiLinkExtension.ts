import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

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
            const linkRegex = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g

            doc.descendants((node, pos) => {
              if (!node.isText) return

              const text = node.text || ''
              let match
              while ((match = linkRegex.exec(text)) !== null) {
                const start = pos + match.index
                const end = start + match[0].length
                const display = match[2] || match[1]

                // 创建装饰：将 [[page]] 文本包裹在带有样式的 span 中
                decorations.push(
                  Decoration.inline(start, end, {
                    class: 'wiki-link',
                    'data-page': match[1],
                    'data-display': display
                  })
                )
              }
            })

            return DecorationSet.create(doc, decorations)
          },
          handleClick(view, _pos, event) {
            const target = event.target as HTMLElement
            const link = target.closest('.wiki-link')
            if (!link) return false

            // 检查点击是否发生在编辑器内部
            const editorContainer = view.dom.closest('[contenteditable="true"]')
            const isInEditor = editorContainer !== null

            // 如果在编辑器内部（编辑状态），不触发点击跳转
            if (isInEditor) {
              return false
            }

            // 阻止默认点击行为
            event.preventDefault()
            event.stopPropagation()

            // 触发自定义事件（由 Editor 组件监听）
            const pageName = link.getAttribute('data-page') || ''
            view.dom.dispatchEvent(new CustomEvent('wiki-link-click', {
              bubbles: true,
              detail: { pageName }
            }))

            return true
          }
        }
      })
    ]
  }
})
