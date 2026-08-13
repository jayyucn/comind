import type { Block } from '../types/block'
import type { TemplateBlock } from '../types/template'
import { generateUUID } from '../utils/id'

const UNSUPPORTED_TYPES = new Set(['query', 'embed', 'code', 'image'])

/**
 * 将 Block 树（以 rootBlockId 为根）序列化为 TemplateBlock 树。
 *
 * 行为契约：
 * - bullet Block → { type: 'bullet', content }
 * - bullet Block + format.type='heading' → { type: 'heading', content, headingLevel }
 * - property Block（content 含 `::`）→ { type: 'property', propertyKey, content }
 * - 不支持的类型（query/embed/code/image）→ 降级为 bullet，并 console.warn
 * - property 行 content 缺 `::` → 降级为 bullet
 * - 孤儿 Block（parentId 指向不存在的 ID）→ 跳过
 */
export function serializeBlockTree(blocks: Block[], rootBlockId: string): TemplateBlock[] {
  const blockMap = new Map(blocks.map(b => [b.id, b]))
  const root = blockMap.get(rootBlockId)
  if (!root) return []

  // 按 parentId + pos 排序，构建 child 列表
  const childrenOf = new Map<string | null, Block[]>()
  for (const b of blocks) {
    const key = b.parentId
    if (!childrenOf.has(key)) childrenOf.set(key, [])
    childrenOf.get(key)!.push(b)
  }
  for (const arr of childrenOf.values()) {
    arr.sort((a, b) => a.pos - b.pos)
  }

  const serialize = (block: Block): TemplateBlock => {
    if (UNSUPPORTED_TYPES.has(block.type)) {
      console.warn(`[serializeBlockTree] Block type "${block.type}" not supported in templates, downgrading to bullet`)
      return { type: 'bullet', content: block.content }
    }

    if (block.format?.type === 'heading') {
      const level = (block.format.level === 1 || block.format.level === 2 || block.format.level === 3)
        ? block.format.level
        : 2
      return {
        type: 'heading',
        content: block.content,
        headingLevel: level
      }
    }

    if (block.type === 'property') {
      const sepIdx = block.content.indexOf('::')
      if (sepIdx === -1) {
        return { type: 'bullet', content: block.content }
      }
      return {
        type: 'property',
        propertyKey: block.content.slice(0, sepIdx).trim(),
        content: block.content.slice(sepIdx + 2).trim()
      }
    }

    return { type: 'bullet', content: block.content }
  }

  const build = (block: Block): TemplateBlock => {
    const tmpl = serialize(block)

    const children = childrenOf.get(block.id) ?? []
    const childTmpls: TemplateBlock[] = []
    for (const child of children) {
      childTmpls.push(build(child))
    }
    if (childTmpls.length > 0) {
      tmpl.children = childTmpls
    }
    return tmpl
  }

  const tmpl = build(root)
  return tmpl ? [tmpl] : []
}

export interface DeserializeOptions {
  pageId: string
  parentId: string | null
  /** 起始 pos（默认 1000，gap 1000） */
  basePos?: number
}

export interface DeserializedBlock extends Block {
  children?: DeserializedBlock[]
}

/**
 * 将 TemplateBlock 树展开为 Block 树（DFS 顺序）。
 *
 * 行为契约：
 * - TemplateBlock.type='bullet' → Block.type='bullet'，content 保持
 * - TemplateBlock.type='heading' → Block.type='bullet'，format={type:'heading', level:headingLevel}
 * - TemplateBlock.type='property' → Block.type='property'，content 序列化为 `key:: value`
 * - 返回数组保持 DFS 顺序（父在前，子在后）
 * - pos 按 DFS 顺序递增（basePos, basePos+gap, basePos+2*gap, ...）
 */
export function deserializeBlockTree(
  tmplBlocks: TemplateBlock[],
  options: DeserializeOptions
): DeserializedBlock[] {
  const basePos = options.basePos ?? 1000
  const gap = 1000
  const result: DeserializedBlock[] = []

  const expand = (tmpl: TemplateBlock, parentId: string | null, pos: number): DeserializedBlock => {
    const id = generateUUID()
    const now2 = Date.now()
    const baseProps = {
      id,
      pageId: options.pageId,
      parentId,
      pos,
      content: '',
      format: {} as Record<string, any>,
      properties: [] as import('../wasm/types').Property[],
      createdAt: now2,
      updatedAt: now2,
    }

    if (tmpl.type === 'heading') {
      return {
        ...baseProps,
        type: 'bullet',
        content: tmpl.content,
        format: { type: 'heading', level: tmpl.headingLevel ?? 2 },
      }
    }

    if (tmpl.type === 'property') {
      const key = tmpl.propertyKey ?? ''
      return {
        ...baseProps,
        type: 'property',
        content: `${key}:: ${tmpl.content}`,
      }
    }

    return {
      ...baseProps,
      type: 'bullet',
      content: tmpl.content,
    }
  }

  let counter = 0
  const walk = (tmpls: TemplateBlock[], pId: string | null) => {
    for (const t of tmpls) {
      const block = expand(t, pId, basePos + counter * gap)
      result.push(block)
      counter += 1
      if (t.children && t.children.length > 0) {
        walk(t.children, block.id)
      }
    }
  }

  walk(tmplBlocks, options.parentId)
  return result
}
