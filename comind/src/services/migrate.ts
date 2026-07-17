/**
 * T15 · 存量数据迁移
 *
 * 将旧 property 格式的 deadline/scheduled/recurrence 迁移为
 * content 内联的 `{{...}}` 格式。
 *
 * 迁移前：
 *   properties: { deadline: '2026-07-15', recurrence: 'weekly' }
 *   content: '买牛奶'
 *
 * 迁移后：
 *   properties: {}  // 已删除
 *   content: '{{deadline:2026-07-15|weekly}} 买牛奶'
 *
 * 幂等可重跑：已迁移的 block 不会再处理（通过检查 content 是否已含 dateRef 前缀）。
 */
import type { CoreClient } from '../wasm/client'
import { serializeDateRef } from '../utils/date-ref'
import type { Block, Property } from '../wasm/types'

export interface MigrationResult {
  totalScanned: number
  migratedBlocks: number
  deletedProperties: number
  errors: Array<{ blockId: string; error: string }>
}

/**
 * 日期属性的 date 值 → iso 格式
 */
function parsePropertyDate(value: string): string {
  // 旧格式可能是 'YYYY-MM-DD' 或 ISO 8601 时间戳
  const trimmed = value.trim().slice(0, 16) // 截断时间部分
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed
  }
  // 尝试用 Date 解析
  const d = new Date(value)
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return value
}

/**
 * 检查 block 中是否已含 dateRef
 */
function hasDateRefInContent(content: string): boolean {
  return /\{\{(?:schedule|deadline):\d{4}-\d{2}-\d{2}/.test(content)
}

/**
 * 执行迁移
 */
export async function migrateDateProperties(client: CoreClient): Promise<MigrationResult> {
  const result: MigrationResult = {
    totalScanned: 0,
    migratedBlocks: 0,
    deletedProperties: 0,
    errors: [],
  }

  try {
    // 1. 获取所有页面
    const pages = await client.getAllPages()
    if (!pages || pages.length === 0) {
      return result // 无数据
    }

    // 2. 遍历每个页面的所有 block
    for (const page of pages) {
      const blocks = await client.getBlocksByPage(page.id)
      if (!blocks || blocks.length === 0) continue

      for (const block of blocks) {
        result.totalScanned++

        try {
          // 获取该 block 的所有属性
          const props = await client.getProperties(block.id)
          if (!props || props.length === 0) continue

          // 查找日期属性和 recurrence
          const deadlineProp = props.find(p => p.key === 'deadline' && p.is_deleted !== 1)
          const scheduledProp = props.find(p => p.key === 'scheduled' && p.is_deleted !== 1)
          const recurrenceProp = props.find(p => p.key === 'recurrence' && p.is_deleted !== 1)

          const dateProp = deadlineProp || scheduledProp
          if (!dateProp || !dateProp.value) continue

          // 如果 content 已含 dateRef，跳过（幂等）
          if (hasDateRefInContent(block.content)) continue

          // 如果 content 为空，用 dateRef 作为全文
          const kind = deadlineProp ? 'deadline' : 'schedule'
          const iso = parsePropertyDate(dateProp.value)
          const recurrence = recurrenceProp?.value && recurrenceProp.value !== 'none'
            ? recurrenceProp.value
            : 'none'

          const dateRefText = serializeDateRef({
            kind,
            iso,
            recurrence: recurrence as any,
            leadMinutes: 0,
          })

          // 拼接 content（插在开头，与原有内容用空格隔开）
          const newContent = block.content
            ? `${dateRefText} ${block.content}`
            : dateRefText

          // 更新 block content
          await client.saveBlockTree([{
            id: block.id,
            page_id: block.page_id,
            parent_id: block.parent_id,
            pos: block.pos,
            content: newContent,
            format: block.format,
            type: block.type,
            updated_at: Date.now(),
          }])

          // 删除旧的属性
          await client.deleteProperty(block.id, dateProp.key)
          result.deletedProperties++

          if (recurrenceProp) {
            await client.deleteProperty(block.id, 'recurrence')
            result.deletedProperties++
          }

          result.migratedBlocks++
        } catch (err) {
          result.errors.push({
            blockId: block.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
  } catch (err) {
    result.errors.push({
      blockId: '__global__',
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return result
}

/**
 * 迁移的可读摘要
 */
export function formatMigrationReport(result: MigrationResult): string {
  const lines = [
    `📋 迁移报告`,
    `──────────────`,
    `扫描 block：${result.totalScanned}`,
    `迁移 block：${result.migratedBlocks}`,
    `删除属性数：${result.deletedProperties}`,
  ]

  if (result.errors.length > 0) {
    lines.push('')
    lines.push(`❌ 错误（${result.errors.length} 项）：`)
    for (const err of result.errors) {
      lines.push(`  • ${err.blockId}: ${err.error}`)
    }
  }

  return lines.join('\n')
}
