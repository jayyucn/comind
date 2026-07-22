import { useBlockRegistry } from '../../../../composables/useBlockRegistry'
import Editor from '../../../Editor.vue'
import ImageRender from './ImageRender.vue'
import type { BlockTypeHandler } from '../../../../types/block-type'

const { register } = useBlockRegistry()

const imageHandler: BlockTypeHandler = {
  type: 'image',
  label: 'Image',
  editorComponent: Editor,
  renderComponent: ImageRender,
  setupBlock(ctx) {
    return {
      onDragOver(e: DragEvent) {
        if (!e.dataTransfer?.types.includes('Files')) return false
        const file = e.dataTransfer.items[0]
        if (!file || !file.type.startsWith('image/')) return false
        e.preventDefault()
        e.stopPropagation()
        return true
      },
      async onDrop(e: DragEvent) {
        const file = e.dataTransfer?.files?.[0]
        if (!file || !file.type.startsWith('image/')) return false
        e.preventDefault()
        e.stopPropagation()
        const { assetStorage } = await import('../../../../utils/asset')
        const asset = await assetStorage.save(file)
        const content = `![${asset.name}](asset://${asset.id})`
        await ctx.blockStore.updateBlockContent(ctx.blockId.value, content)
        return true
      },
      async onPaste(e: ClipboardEvent) {
        const items = e.clipboardData?.items
        if (!items) return false
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.startsWith('image/')) {
            e.preventDefault()
            e.stopPropagation()
            const file = items[i].getAsFile()
            if (!file) continue
            const { assetStorage } = await import('../../../../utils/asset')
            const asset = await assetStorage.save(file)
            const content = `![${asset.name}](asset://${asset.id})`
            await ctx.blockStore.updateBlockContent(ctx.blockId.value, content)
            return true
          }
        }
        return false
      }
    }
  }
}

register(imageHandler)
