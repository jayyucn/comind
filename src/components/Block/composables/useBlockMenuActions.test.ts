import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBlockStore } from '../../../stores/blocks'
import { useEditorStore } from '../../../stores/editor'
import { useFieldValueStore } from '../../../stores/fieldValue'
import type { Block } from '../../../types/block'
import { useBlockMenuActions } from './useBlockMenuActions'

/** 只打真实剪贴板写入口，序列化仍走真实实现（要验子树/字段值有没有随行） */
vi.mock('../../../services/block-clipboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/block-clipboard')>()
  return { ...actual, writeClipboardPayload: vi.fn(async () => {}) }
})

vi.mock('../../../services/external-paste-parse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/external-paste-parse')>()
  return { ...actual, resolveClipboardPayload: vi.fn() }
})

const { writeClipboardPayload } = await import('../../../services/block-clipboard')
const { resolveClipboardPayload } = await import('../../../services/external-paste-parse')

function mkBlock(over: Partial<Block> = {}): Block {
  return {
    id: 'b1',
    pageId: 'p1',
    parentId: null,
    pos: 1000,
    content: '内容',
    format: {},
    type: 'table',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('useBlockMenuActions — 块入口菜单的通用动作', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('可用性判据', () => {
    it('canIndent 要求有前一个兄弟（与 store.indent 同一守卫）', () => {
      const blockStore = useBlockStore()
      blockStore.blocks = [mkBlock({ id: 'a', pos: 1000 }), mkBlock({ id: 'b', pos: 2000 })]

      expect(useBlockMenuActions(() => 'a').canIndent.value).toBe(false)
      expect(useBlockMenuActions(() => 'b').canIndent.value).toBe(true)
    })

    it('canOutdent 只看 parentId：顶级块不可减少缩进', () => {
      const blockStore = useBlockStore()
      blockStore.blocks = [
        mkBlock({ id: 'top', parentId: null }),
        mkBlock({ id: 'child', parentId: 'top', pos: 1000 }),
      ]

      expect(useBlockMenuActions(() => 'top').canOutdent.value).toBe(false)
      expect(useBlockMenuActions(() => 'child').canOutdent.value).toBe(true)
    })

    it('blockId 为空时两项都不可用（脱离外壳的渲染态）', () => {
      const actions = useBlockMenuActions(() => undefined)
      expect(actions.canIndent.value).toBe(false)
      expect(actions.canOutdent.value).toBe(false)
    })
  })

  describe('复制', () => {
    it('子树与字段值随行写进块级剪贴板', async () => {
      const blockStore = useBlockStore()
      const fieldValueStore = useFieldValueStore()
      const parent = mkBlock({
        id: 'b1',
        properties: [{ key: 'status', value_json: 'Todo', value_type: 'select' } as never],
      })
      const child = mkBlock({ id: 'b2', parentId: 'b1', pos: 1000, content: '子块' })
      blockStore.blocks = [parent, child]
      // 按 id 返回，否则序列化子块时又拿到同一个子块 → 递归爆栈
      vi.spyOn(blockStore, 'getChildren').mockImplementation((id: string) =>
        id === 'b1' ? [child] : []
      )
      vi.spyOn(fieldValueStore, 'getBlockFieldValues').mockReturnValue([])

      await useBlockMenuActions(() => 'b1').copyBlock()

      const payload = vi.mocked(writeClipboardPayload).mock.calls[0][0]
      expect(payload.blocks).toHaveLength(1)
      expect(payload.blocks[0].content).toBe('内容')
      expect(payload.blocks[0].children.map((c) => c.content)).toEqual(['子块'])
      // 字段值取自块上快照（缓存为空时回退），类型一并带上
      expect(payload.blocks[0].properties?.status).toEqual({ value: 'Todo', type: 'select' })
    })
  })

  describe('剪切', () => {
    it('先写剪贴板再删块', async () => {
      const blockStore = useBlockStore()
      const editorStore = useEditorStore()
      blockStore.blocks = [mkBlock({ id: 'b1' })]
      const del = vi.spyOn(blockStore, 'deleteBlock').mockResolvedValue(undefined)

      await useBlockMenuActions(() => 'b1').cutBlock()

      expect(writeClipboardPayload).toHaveBeenCalledTimes(1)
      expect(del).toHaveBeenCalledWith('b1')
    })

    it('剪贴板写入失败时不删块（避免两头落空）', async () => {
      const blockStore = useBlockStore()
      blockStore.blocks = [mkBlock({ id: 'b1' })]
      const del = vi.spyOn(blockStore, 'deleteBlock').mockResolvedValue(undefined)
      vi.mocked(writeClipboardPayload).mockRejectedValueOnce(new Error('denied'))

      await expect(useBlockMenuActions(() => 'b1').cutBlock()).rejects.toThrow('denied')
      expect(del).not.toHaveBeenCalled()
    })
  })

  describe('删除', () => {
    it('先失活再删块（删活动块会留下幽灵编辑器）', async () => {
      const blockStore = useBlockStore()
      const editorStore = useEditorStore()
      blockStore.blocks = [mkBlock({ id: 'b1' })]
      const order: string[] = []
      vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {
        order.push('deactivate')
      })
      vi.spyOn(blockStore, 'deleteBlock').mockImplementation(async () => {
        order.push('delete')
      })

      await useBlockMenuActions(() => 'b1').deleteBlock()

      expect(order).toEqual(['deactivate', 'delete'])
    })
  })

  describe('在上方 / 在下方插入', () => {
    it('上方插入用 insertSiblingAbove：不继承本块 format（否则复制一张表）', async () => {
      const blockStore = useBlockStore()
      const editorStore = useEditorStore()
      const block = mkBlock({ id: 'b1', format: { table: { rows: [['a']] } } })
      blockStore.blocks = [block]
      const above = vi.spyOn(blockStore, 'insertSiblingAbove').mockResolvedValue(mkBlock({ id: 'new' }))
      const activate = vi.spyOn(editorStore, 'activateBlock').mockResolvedValue(undefined)

      await useBlockMenuActions(() => 'b1').insertBlockAbove()

      expect(above).toHaveBeenCalledWith(block, {})
      // 新块直接进编辑态：用户点「插入」就是要马上打字
      expect(activate).toHaveBeenCalledWith('new', 1)
    })

    it('下方插入用 insertAtPosition：同级、锚点之后（跳过整棵子树）', async () => {
      const blockStore = useBlockStore()
      const editorStore = useEditorStore()
      const block = mkBlock({ id: 'b1', pageId: 'p9', parentId: 'parent' })
      blockStore.blocks = [block]
      const below = vi.spyOn(blockStore, 'insertAtPosition').mockResolvedValue(mkBlock({ id: 'new' }))
      const activate = vi.spyOn(editorStore, 'activateBlock').mockResolvedValue(undefined)

      await useBlockMenuActions(() => 'b1').insertBlockBelow()

      expect(below).toHaveBeenCalledWith('p9', 'parent', '', block, [], false, {})
      expect(activate).toHaveBeenCalledWith('new', 1)
    })

    it('块不存在时两个插入都不动 store', async () => {
      const blockStore = useBlockStore()
      const above = vi.spyOn(blockStore, 'insertSiblingAbove')
      const below = vi.spyOn(blockStore, 'insertAtPosition')

      const actions = useBlockMenuActions(() => undefined)
      await actions.insertBlockAbove()
      await actions.insertBlockBelow()

      expect(above).not.toHaveBeenCalled()
      expect(below).not.toHaveBeenCalled()
    })
  })

  describe('重置为文本块', () => {
    it('先失活再重置，重置出来的空块接管编辑态', async () => {
      const blockStore = useBlockStore()
      const editorStore = useEditorStore()
      blockStore.blocks = [mkBlock({ id: 'b1' })]
      const order: string[] = []
      vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {
        order.push('deactivate')
      })
      const reset = vi
        .spyOn(blockStore, 'resetBlockToText')
        .mockImplementation(async () => {
          order.push('reset')
          return mkBlock({ id: 'fresh', content: '', type: 'text' })
        })
      vi.spyOn(editorStore, 'activateBlock').mockImplementation(async (id: string) => {
        order.push(`activate:${id}`)
      })

      await useBlockMenuActions(() => 'b1').resetToTextBlock()

      // 失活必须早于删块：活动块卸载时 flush 的 save 晚于删除会把旧正文写回去
      expect(order).toEqual(['deactivate', 'reset', 'activate:fresh'])
      expect(reset).toHaveBeenCalledWith('b1')
    })

    it('重置失败（块已不存在）时不激活任何东西', async () => {
      const blockStore = useBlockStore()
      const editorStore = useEditorStore()
      blockStore.blocks = [mkBlock({ id: 'b1' })]
      vi.spyOn(editorStore, 'deactivateBlock').mockImplementation(() => {})
      vi.spyOn(blockStore, 'resetBlockToText').mockResolvedValue(null)
      const activate = vi.spyOn(editorStore, 'activateBlock').mockResolvedValue(undefined)

      await useBlockMenuActions(() => 'b1').resetToTextBlock()

      expect(activate).not.toHaveBeenCalled()
    })
  })

  describe('粘贴', () => {
    beforeEach(() => {
      // 读权限被拒是 Tauri WebView 的常态：走 readText 退化分支
      vi.stubGlobal('navigator', {
        clipboard: {
          read: vi.fn(async () => {
            throw new Error('denied')
          }),
          readText: vi.fn(async () => '纯文本'),
        },
      })
    })

    it('粘到本块下方，并把新建块与源 id 交给类型侧收尾', async () => {
      const blockStore = useBlockStore()
      blockStore.blocks = [mkBlock({ id: 'b1', pageId: 'p1' })]
      const forest = [{ id: 'src', content: '源' } as never]
      vi.mocked(resolveClipboardPayload).mockReturnValue({ blocks: forest, op: 'copy', fromPageId: null })
      const created = mkBlock({ id: 'new', pageId: 'p1' })
      const paste = vi
        .spyOn(blockStore, 'pasteBlocksWithOp')
        .mockResolvedValue({ blocks: [created], moved: false })
      const afterPaste = vi.fn()

      await useBlockMenuActions(() => 'b1', { afterPaste }).pasteBlock()

      // 意图标记原样透传：'copy' 永远新建
      expect(paste).toHaveBeenCalledWith(forest, {
        pageId: 'p1',
        anchorBlockId: 'b1',
        fallbackParentId: null,
      }, 'copy', null)
      expect(afterPaste).toHaveBeenCalledWith([created], ['src'])
    })

    it('剪切载荷被搬走时不再跑类型收尾（配置就挂在同一个 id 上）', async () => {
      const blockStore = useBlockStore()
      blockStore.blocks = [mkBlock({ id: 'b1', pageId: 'p1' })]
      const moved = mkBlock({ id: 'src', pageId: 'p1' })
      vi.mocked(resolveClipboardPayload).mockReturnValue({
        blocks: [{ id: 'src', content: '' } as never],
        op: 'cut',
        fromPageId: 'p-src',
      })
      vi.spyOn(blockStore, 'pasteBlocksWithOp').mockResolvedValue({ blocks: [moved], moved: true })
      const afterPaste = vi.fn()

      await useBlockMenuActions(() => 'b1', { afterPaste }).pasteBlock()

      expect(afterPaste).not.toHaveBeenCalled()
    })

    it('剪贴板里没有可用载荷时不粘贴、也不调收尾', async () => {
      const blockStore = useBlockStore()
      blockStore.blocks = [mkBlock({ id: 'b1' })]
      vi.mocked(resolveClipboardPayload).mockReturnValue(null)
      const paste = vi.spyOn(blockStore, 'pasteBlocksWithOp')
      const afterPaste = vi.fn()

      await useBlockMenuActions(() => 'b1', { afterPaste }).pasteBlock()

      expect(paste).not.toHaveBeenCalled()
      expect(afterPaste).not.toHaveBeenCalled()
    })
  })
})
