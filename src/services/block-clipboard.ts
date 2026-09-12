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
import type { Block, BlockClipPayload, BlockClipboardPayload } from '../types/block'

/** 内部剪贴板格式 MIME（ADR-0025 D5）：唯一来源，其他模块从此转发。 */
export const COMIND_BLOCK_MIME = 'application/x-comind-block'

/** 序列化依赖：children（渲染序子树）与 properties（propertyStore 实时缓存优先，回退 on-block 快照） */
export interface BlockClipResolvers {
  resolveChildren: (block: Block) => Block[]
  resolveProperties: (block: Block) => Record<string, { value: string; type: string }> | null
}

/** 块森林 → 顶层载荷。完整子树递归（无视 collapsed，ADR-0025 D8/D10）。 */
export function serializeBlocks(roots: Block[], resolvers: BlockClipResolvers): BlockClipboardPayload {
  return {
    version: 1,
    kind: 'blocks',
    blocks: roots.map(block => serializeNode(block, resolvers)),
  }
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
      parts.push('  '.repeat(depth) + node.content)
      walk(node.children, depth + 1)
    }
  }
  walk(payload.blocks, 0)
  return parts.join('\n')
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
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

/** 内部 MIME JSON → 载荷森林；JSON 损坏或形状不符 → null（调用方回退外部解析）。 */
export function deserializeClipboardBlocks(json: string): BlockClipPayload[] | null {
  try {
    const payload = JSON.parse(json) as BlockClipboardPayload
    if (payload && payload.kind === 'blocks' && Array.isArray(payload.blocks)) {
      return payload.blocks
    }
  } catch {
    // 损坏的内部载荷 → null
  }
  return null
}
