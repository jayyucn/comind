import { describe, expect, it } from 'vitest'
import {
  isStaleIdeasPage,
  isStrictIdeasDateTitle,
  parseIdeasSnapshotContent,
  todayDateStr,
} from './ideas-snapshot'

const TODAY = '2026-09-07'
const YESTERDAY = '2026-09-06'
const TOMORROW = '2026-09-08'

describe('ideas-snapshot 守卫（仅历史 ideas 页走快照）', () => {
  it('标题日期 < 今天的 ideas 页 → 快照模式', () => {
    expect(isStaleIdeasPage({ type: 'ideas', title: YESTERDAY }, TODAY)).toBe(true)
    expect(isStaleIdeasPage({ type: 'ideas', title: '2026-01-01' }, TODAY)).toBe(true)
  })

  it('今日 / 未来 ideas 页 → 活数据（不快照）', () => {
    expect(isStaleIdeasPage({ type: 'ideas', title: TODAY }, TODAY)).toBe(false)
    expect(isStaleIdeasPage({ type: 'ideas', title: TOMORROW }, TODAY)).toBe(false)
  })

  it('非 ideas 页即使标题是过去日期 → 活数据', () => {
    expect(isStaleIdeasPage({ type: 'normal', title: YESTERDAY }, TODAY)).toBe(false)
    expect(isStaleIdeasPage({ type: 'book', title: YESTERDAY }, TODAY)).toBe(false)
  })

  it('ideas 页非严格日期标题（无法判定日期）→ 活数据', () => {
    expect(isStaleIdeasPage({ type: 'ideas', title: '任务收集' }, TODAY)).toBe(false)
    expect(isStaleIdeasPage({ type: 'ideas', title: '2026/09/06' }, TODAY)).toBe(false)
    expect(isStaleIdeasPage({ type: 'ideas', title: '' }, TODAY)).toBe(false)
  })

  it('todayDateStr 为本地严格日期', () => {
    expect(isStrictIdeasDateTitle(todayDateStr())).toBe(true)
  })
})

describe('parseIdeasSnapshotContent（snake content_json → camel 渲染数据）', () => {
  const raw = JSON.stringify({
    blocks: [
      {
        id: 'b-top', page_id: 'p1', parent_id: null, pos: 1000,
        content: '写周报', format: '{}', type: 'bullet',
        created_at: 1, updated_at: 2, version: 0, deleted_at: null,
      },
      {
        id: 'b-child', page_id: 'p1', parent_id: 'b-top', pos: 2000,
        content: '- [ ] 子项', format: '{"align":"left"}', type: 'bullet',
        created_at: 1, updated_at: 2, version: 0, deleted_at: null,
      },
    ],
    properties: {
      'b-top': [
        {
          id: 'pr-1', block_id: 'b-top', key: 'status', value: 'Todo', type: 'string',
          sort_order: 0, is_hidden: 0, is_deleted: 0, schema_version: 1,
          created_at: 1, updated_at: 2, version: 0, deleted_at: null,
        },
      ],
    },
  })

  it('映射为 camelCase Block[] + 属性 map', () => {
    const data = parseIdeasSnapshotContent(raw)
    expect(data).not.toBeNull()
    expect(data!.blocks).toHaveLength(2)
    const top = data!.blocks[0]
    expect(top.id).toBe('b-top')
    expect(top.pageId).toBe('p1')
    expect(top.parentId).toBeNull()
    expect(top.type).toBe('bullet')
    expect(data!.blocks[1].parentId).toBe('b-top')
    expect(data!.blocks[1].format).toEqual({ align: 'left' })
    const props = data!.properties['b-top']
    expect(props).toHaveLength(1)
    expect(props[0].key).toBe('status')
    expect(props[0].value).toBe('Todo')
    expect(props[0].blockId).toBe('b-top')
    expect(props[0].isHidden).toBe(false)
  })

  it('非法 JSON / 缺 blocks → null', () => {
    expect(parseIdeasSnapshotContent('not-json')).toBeNull()
    expect(parseIdeasSnapshotContent('{"properties":{}}')).toBeNull()
  })
})
