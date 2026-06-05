import type { Block } from '../types/block'
import type {
  NormalizedTemplate,
  TemplateContext,
  TemplateBlock,
  BlockDraft,
} from '../types/template'
import { deserializeBlockTree } from './serialize-block-tree'

/** 占位符标记（用于 cursor 定位） */
export interface PlaceholderMarker {
  type: 'cursor'
  start: number
  end: number
}

/** 变量展开结果 */
export interface ExpandResult {
  text: string
  placeholders: PlaceholderMarker[]
}

const VAR_REGEX = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g

/**
 * 预定义变量名 → TemplateContext 字段的别名映射。
 * 未列出的 {{var}}（例如 {{name}}、{{user_name}}）保留为可见文本。
 */
const VAR_ALIAS: Record<string, keyof TemplateContext> = {
  date: 'date',
  time: 'time',
  iso_date: 'isoDate',
  page_title: 'pageTitle',
  clipboard: 'clipboard',
}

export class TemplateRenderer {
  /**
   * 构建预定义变量上下文。
   * clipboard 读取失败时返回空字符串（不抛出）。
   */
  static async buildContext(pageTitle: string): Promise<TemplateContext> {
    const now = new Date()
    const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const isoDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

    let clipboard = ''
    try {
      if (navigator?.clipboard?.readText) {
        clipboard = await navigator.clipboard.readText()
      }
    } catch {
      clipboard = ''
    }

    return {
      date,
      time,
      isoDate,
      pageTitle,
      cursor: '__CURSOR__',
      clipboard,
      now: now.getTime(),
    }
  }

  /**
   * 展开 content 中的 {{var}}。
   * - 预定义变量：替换
   * - {{cursor}}：替换为 context.cursor 字面量，并在 placeholders 中记录位置
   * - 其他 {{xxx}}（如 {{name}}）：保留为可见文本
   */
  static expandContent(content: string, context: TemplateContext): ExpandResult {
    const placeholders: PlaceholderMarker[] = []
    const text = content.replace(VAR_REGEX, (match, varName: string, offset: number) => {
      if (varName === 'cursor') {
        const start = offset
        const end = offset + match.length - 1
        placeholders.push({ type: 'cursor', start, end })
        return context.cursor
      }
      const key = VAR_ALIAS[varName]
      if (key !== undefined) {
        const value = context[key]
        return typeof value === 'string' ? value : match
      }
      return match
    })
    return { text, placeholders }
  }

  /**
   * 渲染模板为 BlockDraft 列表（DFS 顺序，pos 连续递增）。
   *
   * 不写库，仅生成待插入数据。由调用方负责调用 blocksStore 写入。
   *
   * 注意：`id` / `createdAt` / `updatedAt` 由 `deserializeBlockTree` 在调用时即时生成，
   * 因此相同输入下 `render()` 输出不保证完全一致（非纯函数）；结构、pos、content 确定。
   */
  static render(
    template: NormalizedTemplate,
    context: TemplateContext,
    anchorBlock: Block
  ): BlockDraft[] {
    return this.expandTemplateBlocks(template.blocks, context, anchorBlock)
  }

  /**
   * 内部：递归展开 TemplateBlock[] → BlockDraft[]
   */
  private static expandTemplateBlocks(
    tmplBlocks: TemplateBlock[],
    context: TemplateContext,
    anchorBlock: Block
  ): BlockDraft[] {
    // 使用 deserializeBlockTree 做"骨架展开"（分配 id/pos/parentId/format）
    const skeletons = deserializeBlockTree(tmplBlocks, {
      pageId: anchorBlock.pageId,
      parentId: anchorBlock.parentId,
      basePos: anchorBlock.pos + 1000,
    })

    const drafts: BlockDraft[] = []
    let cursor = 0

    const walk = (tmpl: TemplateBlock[]) => {
      for (const t of tmpl) {
        const skeleton = skeletons[cursor]
        const { text, placeholders } = this.expandContent(t.content, context)
        const hasCursor = placeholders.length > 0
        const finalContent = t.type === 'property' && t.propertyKey
          ? `${t.propertyKey}:: ${text}`
          : text

        const draft: BlockDraft = {
          id: skeleton.id,
          pageId: skeleton.pageId,
          parentId: skeleton.parentId,
          pos: skeleton.pos,
          content: finalContent,
          format: skeleton.format as BlockDraft['format'],
          type: skeleton.type as BlockDraft['type'],
          properties: skeleton.properties,
          cursorMarker: hasCursor ? '__CURSOR__' : null,
        }
        drafts.push(draft)
        cursor += 1

        if (t.children && t.children.length > 0) {
          walk(t.children)
        }
      }
    }

    walk(tmplBlocks)
    return drafts
  }
}
