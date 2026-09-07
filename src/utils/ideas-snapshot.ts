// utils/ideas-snapshot.ts
// Ideas 页快照读取守卫 + 内容映射（ADR-0042，issue #70 T5）
//
// - 守卫：仅「type=ideas 且标题为严格 yyyy-MM-dd 且日期 < 今天」的历史页走快照渲染，
//   今日页/未来页/非日期标题一律走活数据 —— 与 Rust 物化判定（SnapshotService，
//   NaiveDate::parse_from_str("%Y-%m-%d") + < today）严格镜像。
// - 内容：page_snapshots.content_json 是库内 snake_case 直序列化的
//   `{ blocks, properties }`，此处映射为前端 camelCase Block[] + 属性 map，
//   渲染端复用 buildTree 与只读渲染通路。

import type { Block } from '../types/block'
import type { Page } from '../types/page'
import type { Property } from '../types/property'
import type { Block as RustBlock, Property as RustProperty } from '../wasm/types'

/** 严格日期标题（与 Rust %Y-%m-%d 一致，前端本地时区） */
const STRICT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 本地时区 yyyy-MM-dd（与双端物化/今日判定同源） */
export function todayDateStr(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 标题是否为严格日期（yyyy-MM-dd） */
export function isStrictIdeasDateTitle(title: string): boolean {
  return STRICT_DATE_RE.test(title.trim())
}

/**
 * 快照读取守卫：页面是否应走快照只读渲染。
 * 与 Rust 物化判定镜像：type=ideas && 严格日期标题 && 标题日期 < 今天。
 * 今日/未来/非严格日期 → false（走活数据）。
 */
export function isStaleIdeasPage(page: Pick<Page, 'type' | 'title'>, today = todayDateStr()): boolean {
  if (page.type !== 'ideas') return false
  const title = page.title.trim()
  if (!STRICT_DATE_RE.test(title)) return false
  return title < today
}

/** content_json 顶层信封（snake_case 直通库内存储） */
export interface IdeasSnapshotContentRaw {
  blocks: RustBlock[]
  /** block_id → 该块未删除属性 */
  properties: Record<string, RustProperty[]>
}

/** 映射后的快照数据（camelCase，供 buildTree / 只读渲染消费） */
export interface IdeasSnapshotData {
  blocks: Block[]
  /** blockId → 该块属性（当日值） */
  properties: Record<string, Property[]>
}

function mapRawProperty(raw: RustProperty): Property {
  return {
    id: raw.id,
    blockId: raw.block_id,
    key: raw.key,
    value: raw.value as Property['value'],
    type: raw.type as Property['type'],
    sortOrder: raw.sort_order,
    isHidden: raw.is_hidden === 1,
    isDeleted: raw.is_deleted === 1,
    schemaVersion: raw.schema_version,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

function mapRawBlock(raw: RustBlock): Block {
  let format: Record<string, any> = {}
  try {
    format = JSON.parse(raw.format || '{}')
  } catch {
    format = {}
  }
  return {
    id: raw.id,
    pageId: raw.page_id,
    parentId: raw.parent_id,
    pos: raw.pos,
    content: raw.content,
    format,
    type: raw.type as Block['type'],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  }
}

/**
 * 解析快照 content_json 文本 → 前端渲染数据。
 * 结构版本不符或解析失败返回 null（渲染方按「无快照」兜底）。
 */
export function parseIdeasSnapshotContent(contentJson: string): IdeasSnapshotData | null {
  let raw: IdeasSnapshotContentRaw
  try {
    raw = JSON.parse(contentJson) as IdeasSnapshotContentRaw
  } catch {
    return null
  }
  if (!Array.isArray(raw?.blocks)) return null
  const properties: Record<string, Property[]> = {}
  for (const [blockId, list] of Object.entries(raw.properties ?? {})) {
    properties[blockId] = list.map(mapRawProperty)
  }
  return {
    blocks: raw.blocks.map(mapRawBlock),
    properties,
  }
}
