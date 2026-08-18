import { describe, it, expect, vi, beforeEach } from 'vitest'

const editorStore = {
  blockSelector: null as { blockId: string; visible: boolean } | null,
  closeBlockSelector: vi.fn(),
}
const blockStore = {
  updateBlockType: vi.fn(() => Promise.resolve()),
  updateBlockProperties: vi.fn(() => Promise.resolve()),
}

vi.mock('../stores/editor', () => ({ useEditorStore: () => editorStore }))
vi.mock('../stores/blocks', () => ({ useBlockStore: () => blockStore }))

import { useEmbedSelector } from './useEmbedSelector'

beforeEach(() => {
  editorStore.blockSelector = null
  editorStore.closeBlockSelector.mockClear()
  blockStore.updateBlockType.mockClear()
  blockStore.updateBlockProperties.mockClear()
})

describe('useEmbedSelector', () => {
  it('无 target blockId → early return（不转 embed）', async () => {
    const { handleSelect } = useEmbedSelector()
    await handleSelect('s', 'p')
    expect(editorStore.closeBlockSelector).toHaveBeenCalled()
    expect(blockStore.updateBlockType).not.toHaveBeenCalled()
  })

  it('有 target → 转 embed + 写 source 属性', async () => {
    editorStore.blockSelector = { blockId: 't1', visible: true }
    const { handleSelect } = useEmbedSelector()
    await handleSelect('s', 'p')
    expect(blockStore.updateBlockType).toHaveBeenCalledWith('t1', 'embed')
    expect(blockStore.updateBlockProperties).toHaveBeenCalledWith('t1', {
      sourceBlockId: 's',
      sourcePageId: 'p',
    })
    expect(editorStore.closeBlockSelector).toHaveBeenCalled()
  })
})
