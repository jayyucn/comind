import { useEditorStore } from '../stores/editor'
import { useBlockStore } from '../stores/blocks'

/**
 * 全局 BlockSelector 选择源 block 后：一次性转 embed 类型 + 写 sourceBlockId/sourcePageId 属性。
 */
export function useEmbedSelector() {
  const editorStore = useEditorStore()
  const blockStore = useBlockStore()

  async function handleSelect(sourceBlockId: string, sourcePageId: string) {
    const targetBlockId = editorStore.blockSelector?.blockId
    editorStore.closeBlockSelector()
    if (!targetBlockId) return
    await blockStore.updateBlockType(targetBlockId, 'embed')
    await blockStore.updateBlockProperties(targetBlockId, { sourceBlockId, sourcePageId })
  }

  return { handleSelect }
}
