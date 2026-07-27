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
      onContentClick(_e: MouseEvent) {
        const sourceBlockId = ctx.getProperty('sourceBlockId')
        if (!sourceBlockId) {
          // 让 EmbedRender placeholder 处理（点击打开 BlockSelector）
          return true
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
