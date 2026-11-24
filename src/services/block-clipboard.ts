/**
 * Block 剪贴板模块（ADR-0025）
 *
 * 内部剪贴板格式 `application/x-comind-block` 的唯一读写处：
 * 载荷森林序列化、text/plain 渲染、剪贴板落盘（含降级链）、内部 MIME 反序列化。
 *
 * 边界：
 * - 只负责「内部格式」；外部源（text/html、text/plain）解析属 External Paste Parser（ADR-0026）。
 * - 序列化依赖注入 children / properties 解析器 → 纯函数，无需挂载 store 即可单测。
 */
import type { Block, BlockClipboardOp, BlockClipboardPayload,BlockClipPayload } from '../types/block'
import { readTableData, serializeTableTsv } from './table-model'

/** 内部剪贴板格式 MIME（ADR-0025 D5）：唯一来源，其他模块从此转发。 */
export const COMIND_BLOCK_MIME = 'application/x-comind-block'

/** 序列化依赖：children（渲染序子树）与 properties（propertyStore 实时缓存优先，回退 on-block 快照） */
export interface BlockClipResolvers {
  resolveChildren: (block: Block) => Block[]
  resolveProperties: (block: Block) => Record<string, { value: string; type: string }> | null
}

/**
 * 块森林 → 顶层载荷。完整子树递归（无视 collapsed，ADR-0025 D8/D10）。
 *
 * `op` 是**意图标记**（D4b）：只有 `'cut'` 才允许粘贴时「搬走同一个块」。
 * 默认 `'copy'` —— 少传一处不会把块搬丢。
 */
export function serializeBlocks(
  roots: Block[],
  resolvers: BlockClipResolvers,
  op: BlockClipboardOp = 'copy',
): BlockClipboardPayload {
  return {
    version: 2,
    kind: 'blocks',
    op,
    fromPageId: resolveFromPageId(roots, op),
    blocks: roots.map(block => serializeNode(block, resolvers)),
  }
}

/**
 * 载荷的源页（仅剪切有意义）：跨页搬移后要把两页的撤销步配成一步，而**剪切已经把块从
 * 内存里摘掉了**，粘贴那一刻再回头找源页必然落空 —— 只能在写载荷时记下。
 * 根块跨页（理论不可达）或多页混杂 → null（调用方退回「两页各撤一步」）。
 */
function resolveFromPageId(roots: Block[], op: BlockClipboardOp): string | null {
  if (op !== 'cut' || roots.length === 0) return null
  const pageIds = new Set(roots.map(root => root.pageId))
  return pageIds.size === 1 ? [...pageIds][0] : null
}

function serializeNode(block: Block, resolvers: BlockClipResolvers): BlockClipPayload {
  return {
    id: block.id,
    content: block.content,
    type: block.type,
    format: block.format ? { ...block.format } : null,
    properties: resolvers.resolveProperties(block),
    children: resolvers.resolveChildren(block).map(child => serializeNode(child, resolvers)),
  }
}

/** text/plain 兜底：按深度 2 空格缩进的可读文本（外部 App 粘贴可用）。 */
export function payloadToPlainText(payload: BlockClipboardPayload): string {
  const parts: string[] = []
  const walk = (nodes: BlockClipPayload[], depth: number): void => {
    for (const node of nodes) {
      if (node.type === 'table') {
        // 表格块复制到外部 → TSV（保留尺寸与表头结构）
        parts.push('  '.repeat(depth) + serializeTableTsv(readTableData(node.format)))
        continue
      }
      parts.push('  '.repeat(depth) + node.content)
      walk(node.children, depth + 1)
    }
  }
  walk(payload.blocks, 0)
  return parts.join('\n')
}

/** execCommand 兜底（Tauri / 无剪贴板权限环境）：每个落盘路径的最后一级 */
function copyViaExecCommand(text: string): void {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

/** 落盘：自定义 MIME（JSON 载荷）+ text/plain 兜底，失败逐级降级。 */
export async function writeClipboardPayload(payload: BlockClipboardPayload): Promise<void> {
  const json = JSON.stringify(payload)
  const text = payloadToPlainText(payload)
  try {
    const item = new ClipboardItem({
      [COMIND_BLOCK_MIME]: new Blob([json], { type: COMIND_BLOCK_MIME }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })
    await navigator.clipboard.write([item])
    return
  } catch {
    // 降级 1：仅纯文本（内部粘贴不可用，外部可读）
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // 降级 2：execCommand 兜底
    }
  }
  copyViaExecCommand(text)
}

/** 纯文本落盘：navigator.clipboard 优先，失败降级 execCommand（Tauri / 无权限环境）。
 *  表格范围复制用它把 TSV 送到系统剪贴板，与块复制的降级链保持一致。 */
export async function writePlainTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // 降级：execCommand 兜底
  }
  copyViaExecCommand(text)
}

/**
 * 内部 MIME JSON → 完整载荷（含 `op`）；JSON 损坏或形状不符 → null。
 *
 * `op` 归一化在这里收口：v1 载荷（无该字段）与任何未知取值都当 `'copy'`，
 * 于是「旧剪贴板内容 / 别人写的载荷」永远不会被误当成剪切而把块搬走。
 */
export function deserializeClipboardPayload(json: string): BlockClipboardPayload | null {
  try {
    const payload = JSON.parse(json) as BlockClipboardPayload
    if (payload && payload.kind === 'blocks' && Array.isArray(payload.blocks)) {
      return {
        version: payload.version === 2 ? 2 : 1,
        kind: 'blocks',
        op: payload.op === 'cut' ? 'cut' : 'copy',
        fromPageId: typeof payload.fromPageId === 'string' ? payload.fromPageId : null,
        blocks: payload.blocks,
      }
    }
  } catch {
    // 损坏的内部载荷 → null
  }
  return null
}

/** 内部 MIME JSON → 载荷森林（丢弃意图标记）；JSON 损坏或形状不符 → null（调用方回退外部解析）。 */
export function deserializeClipboardBlocks(json: string): BlockClipPayload[] | null {
  return deserializeClipboardPayload(json)?.blocks ?? null
}
