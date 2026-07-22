import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import Editor from '../../../Editor.vue'
import EmbedRender from './EmbedRender.vue'
import type { BlockTypeHandler } from '../../../../types/block-type'

const { register } = useBlockRegistry()

const embedHandler: BlockTypeHandler = {
  type: 'embed',
  label: 'Embed',
  editorComponent: Editor,
  renderComponent: EmbedRender,
  setupBlock(ctx) {
    return {
      onContentMousedown(e: MouseEvent) {
        // embed 有 source 时不激活编辑器
        if (ctx.getProperty('sourceBlockId')) {
          e.preventDefault()
          return true
        }
        return false
      },
      onContentClick(e: MouseEvent) {
        const sourceBlockId = ctx.getProperty('sourceBlockId')
        if (!sourceBlockId) {
          // 让 EmbedRender 处理（显示 BlockSelector）
          return false
        }
        // 有 source → 导航到源页面
        const sourcePageId = ctx.getProperty('sourcePageId')
        if (sourcePageId) {
          const sourcePage = ctx.pageStore.pages.find((p: any) => p.id === sourcePageId)
          if (sourcePage) {
            ctx.navigateToPage(sourcePage.title)
            return true
          }
        }
        return false
      }
    }
  }
}

register(embedHandler)
