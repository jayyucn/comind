import { computed, nextTick } from 'vue'

import { linkCrossPageMove } from '../../../composables/useUndoRestore'
import { COMIND_BLOCK_MIME, serializeBlocks, writeClipboardPayload } from '../../../services/block-clipboard'
import { resolveClipboardPayload } from '../../../services/external-paste-parse'
import { useBlockStore } from '../../../stores/blocks'
import { useEditorStore } from '../../../stores/editor'
import { useFieldValueStore } from '../../../stores/fieldValue'
import { usePageStore } from '../../../stores/pages'
import type { Block } from '../../../types/block'
import { getPrevSibling } from '../../../utils/block-helpers'
import { decodeFieldValueData } from '../../../utils/field-value-codec'

/**
 * 块入口菜单的**动作层**：上下插入 / 缩进 / 复制 / 剪切 / 粘贴 / 重置为文本 / 删除，一份实现。
 *
 * 边界（本文件存在的理由）：
 * - 这几个动作对任何块类型都成立，语义是「对整块」，与块内部状态无关。table 块改造前
 *   把复制/剪切/粘贴实现成了**整表单元格范围**（写 TSV 到系统剪贴板 + 单例 table-clipboard），
 *   于是同一个菜单项在两种块上同名不同义。这次统一到块剪贴板：单元格的复制/粘贴仍由
 *   表格自己的格选区工具条承担（`copyRange` / `pasteRange`），入口菜单只管块。
 * - 唯一的类型专属副作用是 query 块粘贴后要克隆命名视图（配置不在剪贴板上）。它通过
 *   `afterPaste` 钩子外挂 —— 本文件不认识任何块类型，`type === 'query'` 的判断留在类型侧。
 * - 依赖 store，所以放 Block/composables/ 而不是 common/（common 是零依赖基础件）。
 *
 * 菜单是否「先关再执行」不在这里：那是视图层的事（BlockMenuCommon 统一 emit close）。
 */

export interface BlockMenuActionHooks {
  /**
   * 粘贴完成后的类型专属收尾。
   * @param created 新建的块（按粘贴顺序）
   * @param sourceIds 载荷里的顶层源块 id（顺序与 created 对应）
   */
  afterPaste?: (created: Block[], sourceIds: string[]) => void | Promise<void>
}

export function useBlockMenuActions(
  getBlockId: () => string | undefined,
  hooks: BlockMenuActionHooks = {}
) {
  const blockStore = useBlockStore()
  const editorStore = useEditorStore()
  const pageStore = usePageStore()
  const fieldValueStore = useFieldValueStore()

  const currentBlock = computed(() => {
    const id = getBlockId()
    return id ? blockStore.getBlock(id) : undefined
  })

  /** 有前一个兄弟才能缩进：直接借用 store.indent 的同一守卫，免得两套兄弟序判据漂移 */
  const canIndent = computed(() => {
    const block = currentBlock.value
    return !!block && !!getPrevSibling(blockStore.blocks, block)
  })

  /** 顶级块没有「减少缩进」可言 */
  const canOutdent = computed(() => !!currentBlock.value?.parentId)

  /** 字段值随行（与块复制同口径）：fieldValueStore 实时缓存优先，回退块上的快照 */
  function blockPropsRecord(block: Block): Record<string, { value: string; type: string }> | null {
    let props = fieldValueStore.getBlockFieldValues(block.id)
    if (props.length === 0 && block.properties && block.properties.length > 0) {
      props = block.properties
    }
    if (props.length === 0) return null
    const record: Record<string, { value: string; type: string }> = {}
    for (const p of props) {
      const value = decodeFieldValueData(p.value_json, p.value_type)
      record[p.key] = {
        value: typeof value === 'string' ? value : JSON.stringify(value),
        type: p.value_type,
      }
    }
    return record
  }

  function indentBlock(): void {
    const id = getBlockId()
    if (id) void blockStore.indent(id)
  }

  function outdentBlock(): void {
    const id = getBlockId()
    if (id) void blockStore.outdent(id)
  }

  /**
   * 复制整块进块级剪贴板：子树 + 字段值随行（视图配置不在这里搬，见 afterPaste）。
   * `op` 是载荷意图：只有 `'cut'` 才允许粘贴时把源块搬走（ADR-0025 D4b）。
   */
  async function writeBlockPayload(op: 'cut' | 'copy'): Promise<void> {
    const block = currentBlock.value
    if (!block) return
    const payload = serializeBlocks(
      [block],
      {
        resolveChildren: (b) => blockStore.getChildren(b.id),
        resolveProperties: blockPropsRecord,
      },
      op,
    )
    await writeClipboardPayload(payload)
  }

  async function copyBlock(): Promise<void> {
    await writeBlockPayload('copy')
  }

  async function deleteBlock(): Promise<void> {
    const id = getBlockId()
    if (!id) return
    editorStore.deactivateBlock()
    await blockStore.deleteBlock(id)
  }

  /**
   * 在本块**紧邻上方**插入一个空白兄弟块，光标落到新块。
   *
   * 同层级（parentId 不变）才符合「在上方插入」的直觉：插到父块的子节点里会跑到
   * 上一层的末尾去。格式刻意传 `{}` 而不是继承本块的 format —— format 里住着表格的
   * `table`、查询块的视图配置，继承等于复制一张表。
   */
  async function insertBlockAbove(): Promise<void> {
    const block = currentBlock.value
    if (!block) return
    const created = await blockStore.insertSiblingAbove(block, {})
    editorStore.activateBlock(created.id, 1)
  }

  /**
   * 在本块**紧邻下方**插入一个空白兄弟块（与 Ctrl+V 同一落点语义：锚点之后）。
   * 本块有子块时新块落在整棵子树之后 —— 「下方」是视觉上的下一行，不是「第一个子块」。
   */
  async function insertBlockBelow(): Promise<void> {
    const block = currentBlock.value
    if (!block) return
    const created = await blockStore.insertAtPosition(
      block.pageId,
      block.parentId,
      '',
      block,
      [],
      false,
      {}
    )
    editorStore.activateBlock(created.id, 1)
  }

  /**
   * 重置为空白文本块（删块 + 同位置新建，语义与撤销口径见 `blockStore.resetBlockToText`）。
   *
   * 必须先失活再动手：本块正在编辑时（表格的格编辑器、查询块的表单）组件卸载前会
   * flush 一次 save，晚于删除执行就会把旧内容写回去。`nextTick` 等卸载真正落地 ——
   * store 侧改的是块数组，编辑器里的 PM / textarea 状态不会自己跟。
   */
  async function resetToTextBlock(): Promise<void> {
    const id = getBlockId()
    if (!id) return
    editorStore.deactivateBlock()
    await nextTick()
    const created = await blockStore.resetBlockToText(id)
    if (created) editorStore.activateBlock(created.id, 1)
  }

  /**
   * 剪切 = 写「剪切」载荷 + 删块；先等剪贴板写完再删，写失败时块还在。
   *
   * 载荷带 `op: 'cut'`，所以粘贴时若这些块仍软删（本库、没被恢复），会被**搬走**
   * 而不是再建一份副本 —— 引用不断、配置不丢（ADR-0025 D4b）。
   */
  async function cutBlock(): Promise<void> {
    await writeBlockPayload('cut')
    if (!currentBlock.value) return
    await deleteBlock()
  }

  /**
   * 读取系统剪贴板里可供块粘贴的数据。只取三种类型（内部 MIME / html / plain），
   * 其余（图片等）不参与 —— 判断与解析全交给 `resolveClipboardForest`。
   * 读权限被拒（Tauri WebView 常见）时退化为纯文本读取，至少还能粘文本。
   */
  async function readClipboardData(): Promise<Record<string, string>> {
    const data: Record<string, string> = {}
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        for (const type of item.types) {
          if (type === COMIND_BLOCK_MIME || type === 'text/plain' || type === 'text/html') {
            data[type] = await (await item.getType(type)).text()
          }
        }
      }
      return data
    } catch {
      /* 退化到 readText */
    }
    try {
      data['text/plain'] = await navigator.clipboard.readText()
    } catch {
      /* 彻底不可读：当作空剪贴板 */
    }
    return data
  }

  /**
   * 粘贴到本块**下方**（与普通块 Ctrl+V 同一落点语义）。
   * 剪贴板内容在点击前不可知（异步读），所以这一项恒可点；空剪贴板就是 no-op。
   *
   * 载荷是「剪切」且源块仍在本库软删时，这里会**搬走**它们（id 不变）—— 那时
   * 不该再跑 `afterPaste`：查询块的命名视图本来就挂在这个 id 上。
   */
  async function pasteBlock(): Promise<void> {
    const block = currentBlock.value
    if (!block) return
    const data = await readClipboardData()
    const payload = resolveClipboardPayload((mime) => data[mime] ?? '')
    if (!payload || payload.blocks.length === 0) return
    const outcome = await blockStore.pasteBlocksWithOp(
      payload.blocks,
      {
        pageId: block.pageId,
        anchorBlockId: block.id,
        fallbackParentId: null,
      },
      payload.op,
      payload.fromPageId,
    )
    if (outcome.moved) {
      // 搬移要给一句回馈：块从源页消失了，用户得知道它去了哪（降级新建时不提示）。
      const title = pageStore.getPage(block.pageId)?.title
      const count = outcome.blocks.length
      editorStore.showToast(title ? `已移动 ${count} 个块到「${title}」` : `已移动 ${count} 个块`)
      // 两页撤销配成一步（同页搬移内部会 no-op）
      linkCrossPageMove(outcome.movedFromPageId, block.pageId)
    }
    if (!outcome.moved && hooks.afterPaste && outcome.blocks.length > 0) {
      await hooks.afterPaste(outcome.blocks, payload.blocks.map((node) => node.id ?? ''))
    }
  }

  return {
    canIndent,
    canOutdent,
    insertBlockAbove,
    insertBlockBelow,
    indentBlock,
    outdentBlock,
    copyBlock,
    cutBlock,
    pasteBlock,
    resetToTextBlock,
    deleteBlock,
  }
}
