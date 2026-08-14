/**
 * Page 适配器测试（issue #25）—— 验证「引擎与业务解耦」：仅通过注册 Page 字段描述符，
 * 页面列表即获得通用筛选/排序/分组能力，引擎核心零改动。
 *
 * 不加载 WASM：直接用 createRegistry() + registerPageBuiltinFields 隔离测试。
 */
import { describe, it, expect } from 'vitest'
import { createRegistry, type ViewQuery, type ConditionGroup } from '../../core/query'
import {
  registerPageBuiltinFields,
  getPageRegistry,
  PAGE_ENTITY,
} from '../usePageQueryRegistry'
import { filterSortPages, runPageQuery } from '../usePageQueryEngine'
import type { Page } from '../../types/page'

/** 构造最小 ViewQuery。 */
function vq(filter: ConditionGroup, sort: ViewQuery['sort'] = [], groupBy: string | null = null): ViewQuery {
  return { version: 1, filter, sort, groupBy }
}

function cond(field: string, op: string, value: unknown): ConditionGroup['children'][number] {
  return { field, op, value: { kind: 'literal', value } } as ConditionGroup['children'][number]
}

const DAY = 86_400_000

/** fixture 页面：覆盖 type/text/date/number/aliases 各字段 */
const pages: Page[] = [
  { id: 'p1', blockId: null, title: '项目Alpha', type: 'normal', icon: null, cover: null, aliases: ['alpha', 'pa'], filePath: null, childrenCount: 2, wordCount: 500, createdAt: Date.parse('2026-01-05T09:00:00'), updatedAt: Date.parse('2026-03-01T09:00:00'), deleted: false, deletedAt: null },
  { id: 'p2', blockId: null, title: '灵感Beta', type: 'ideas', icon: null, cover: null, aliases: ['beta'], filePath: null, childrenCount: 0, wordCount: 120, createdAt: Date.parse('2026-02-10T09:00:00'), updatedAt: Date.parse('2026-02-15T09:00:00'), deleted: false, deletedAt: null },
  { id: 'p3', blockId: null, title: '项目Gamma', type: 'normal', icon: null, cover: null, aliases: [], filePath: null, childrenCount: 5, wordCount: 800, createdAt: Date.parse('2026-01-20T09:00:00'), updatedAt: Date.parse('2026-04-10T09:00:00'), deleted: false, deletedAt: null },
  { id: 'p4', blockId: null, title: '灵感Delta', type: 'ideas', icon: null, cover: null, aliases: ['delta', 'pa'], filePath: null, childrenCount: 1, wordCount: 300, createdAt: Date.parse('2026-03-15T09:00:00'), updatedAt: Date.parse('2026-03-20T09:00:00'), deleted: false, deletedAt: null },
]

function ids(list: Page[]): string[] {
  return list.map((p) => p.id)
}

describe('Page 字段描述符注册表', () => {
  it('注册全部内置字段（title/type/createdAt/updatedAt/childrenCount/wordCount/aliases）', () => {
    const registry = createRegistry()
    registerPageBuiltinFields(registry)
    const keys = registry.list(PAGE_ENTITY).map((f) => f.key).sort()
    expect(keys).toEqual(
      ['aliases', 'childrenCount', 'createdAt', 'title', 'type', 'updatedAt', 'wordCount'].sort(),
    )
  })

  it('日期字段把 timestamp 转为本地 yyyy-MM-dd（Ideas 规范）', () => {
    const registry = createRegistry()
    registerPageBuiltinFields(registry)
    const createdAt = registry.get(PAGE_ENTITY, 'createdAt')!
    const d = createdAt.get(pages[0]) as string
    // 2026-01-05T09:00:00 本地 → 2026-01-05
    expect(d).toBe('2026-01-05')
  })

  it('type 字段为 select 且选项含 normal/ideas', () => {
    const registry = createRegistry()
    registerPageBuiltinFields(registry)
    const type = registry.get(PAGE_ENTITY, 'type')!
    expect(type.type).toBe('select')
    expect(type.options?.map((o) => o.id).sort()).toEqual(['ideas', 'normal'])
  })
})

describe('Page 列表按 ViewQuery 过滤（不改动引擎核心）', () => {
  function setup() {
    const registry = createRegistry()
    registerPageBuiltinFields(registry)
    return registry
  }

  it('按 type 过滤：仅 ideas', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [cond('type', 'is', 'ideas')] })
    const result = filterSortPages(pages, q, registry, PAGE_ENTITY)
    expect(ids(result).sort()).toEqual(['p2', 'p4'])
  })

  it('按 title 包含文字过滤', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [cond('title', 'contains', '项目')] })
    const result = filterSortPages(pages, q, registry, PAGE_ENTITY)
    expect(ids(result).sort()).toEqual(['p1', 'p3'])
  })

  it('按 createdAt 区间 between 过滤', () => {
    const registry = setup()
    const q = vq({
      combinator: 'and',
      children: [cond('createdAt', 'between', ['2026-02-01', '2026-03-31'])],
    })
    const result = filterSortPages(pages, q, registry, PAGE_ENTITY)
    expect(ids(result).sort()).toEqual(['p2', 'p4'])
  })

  it('按 updatedAt after 过滤', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [cond('updatedAt', 'after', '2026-03-31')] })
    const result = filterSortPages(pages, q, registry, PAGE_ENTITY)
    // p1(2026-03-01)、p2(2026-02-15)、p3(2026-04-10)、p4(2026-03-20) → 仅 p3 晚于 3-31
    expect(ids(result)).toEqual(['p3'])
  })

  it('多条件 and / or 组合', () => {
    const registry = setup()
    // (type is ideas) AND (wordCount gt 200) → p4(300)
    const andQ = vq({
      combinator: 'and',
      children: [cond('type', 'is', 'ideas'), cond('wordCount', 'gt', 200)],
    })
    expect(ids(filterSortPages(pages, andQ, registry, PAGE_ENTITY))).toEqual(['p4'])

    // (type is ideas) OR (wordCount gt 700) → p2,p3,p4
    const orQ = vq({
      combinator: 'or',
      children: [cond('type', 'is', 'ideas'), cond('wordCount', 'gt', 700)],
    })
    expect(ids(filterSortPages(pages, orQ, registry, PAGE_ENTITY)).sort()).toEqual(['p2', 'p3', 'p4'])
  })

  it('按 aliases 多值 hasAny 过滤', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [cond('aliases', 'hasAny', ['pa'])] })
    // p1(['alpha','pa']) 与 p4(['delta','pa']) 含 'pa'
    expect(ids(filterSortPages(pages, q, registry, PAGE_ENTITY)).sort()).toEqual(['p1', 'p4'])
  })

  it('排序：按 wordCount 降序', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [] }, [{ field: 'wordCount', dir: 'desc' }])
    expect(ids(filterSortPages(pages, q, registry, PAGE_ENTITY))).toEqual(['p3', 'p1', 'p4', 'p2'])
  })

  it('按 type 分组：返回 ideas / normal 两个桶', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [] }, [], 'type')
    const groups = runPageQuery(pages, q, registry, PAGE_ENTITY)
    const labels = groups.map((g) => g.label).sort()
    expect(labels).toEqual(['普通', '灵感'])
    const total = groups.reduce((n, g) => n + g.items.length, 0)
    expect(total).toBe(pages.length)
  })

  it('端到端 runPageQuery：过滤 + 排序 + 分组一体返回分组结构', () => {
    const registry = setup()
    const q = vq(
      { combinator: 'and', children: [cond('type', 'is', 'normal')] },
      [{ field: 'wordCount', dir: 'asc' }],
      null,
    )
    const groups = runPageQuery(pages, q, registry, PAGE_ENTITY)
    // 单一全量桶（groupBy null），内部按字数升序：p1(500) < p3(800)
    expect(groups).toHaveLength(1)
    expect(ids(groups[0].items)).toEqual(['p1', 'p3'])
  })

  it('单例 getPageRegistry 已注册内置字段（与 compose 根一致）', () => {
    const registry = getPageRegistry()
    expect(registry.list(PAGE_ENTITY).length).toBe(7)
  })
})
