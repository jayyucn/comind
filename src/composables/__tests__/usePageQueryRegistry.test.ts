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
  pageDefaultConfig,
  pageViewKinds,
  PAGE_DEFAULT_TABLE_CONFIG,
  PAGE_DEFAULT_BOARD_CONFIG,
  PAGE_DEFAULT_CALENDAR_CONFIG,
  PAGE_DEFAULT_GALLERY_CONFIG,
  LIBRARY_TAB_QUERY,
} from '../usePageQueryRegistry'
import { createQueryEngine } from '../../core/query'
import { parseLayoutConfig } from '../../core/view'
import type { Page } from '../../types/page'
import type { TableConfig, CalendarConfig, GalleryConfig } from '../../core/view'

/** 构造最小 ViewQuery。 */
const pageEngine = createQueryEngine<Page>(PAGE_ENTITY)

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

  it('type 字段为 select 且选项含 normal/ideas/book（书 Page，票 08 书房查询用）', () => {
    const registry = createRegistry()
    registerPageBuiltinFields(registry)
    const type = registry.get(PAGE_ENTITY, 'type')!
    expect(type.type).toBe('select')
    expect(type.options?.map((o) => o.id).sort()).toEqual(['book', 'ideas', 'normal'])
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
    const result = pageEngine.filterSort(pages, q, registry)
    expect(ids(result).sort()).toEqual(['p2', 'p4'])
  })

  it('按 title 包含文字过滤', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [cond('title', 'contains', '项目')] })
    const result = pageEngine.filterSort(pages, q, registry)
    expect(ids(result).sort()).toEqual(['p1', 'p3'])
  })

  it('按 createdAt 区间 between 过滤', () => {
    const registry = setup()
    const q = vq({
      combinator: 'and',
      children: [cond('createdAt', 'between', ['2026-02-01', '2026-03-31'])],
    })
    const result = pageEngine.filterSort(pages, q, registry)
    expect(ids(result).sort()).toEqual(['p2', 'p4'])
  })

  it('按 updatedAt after 过滤', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [cond('updatedAt', 'after', '2026-03-31')] })
    const result = pageEngine.filterSort(pages, q, registry)
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
    expect(ids(pageEngine.filterSort(pages, andQ, registry))).toEqual(['p4'])

    // (type is ideas) OR (wordCount gt 700) → p2,p3,p4
    const orQ = vq({
      combinator: 'or',
      children: [cond('type', 'is', 'ideas'), cond('wordCount', 'gt', 700)],
    })
    expect(ids(pageEngine.filterSort(pages, orQ, registry)).sort()).toEqual(['p2', 'p3', 'p4'])
  })

  it('按 aliases 多值 hasAny 过滤', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [cond('aliases', 'hasAny', ['pa'])] })
    // p1(['alpha','pa']) 与 p4(['delta','pa']) 含 'pa'
    expect(ids(pageEngine.filterSort(pages, q, registry)).sort()).toEqual(['p1', 'p4'])
  })

  it('排序：按 wordCount 降序', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [] }, [{ field: 'wordCount', dir: 'desc' }])
    expect(ids(pageEngine.filterSort(pages, q, registry))).toEqual(['p3', 'p1', 'p4', 'p2'])
  })

  it('按 type 分组：返回 ideas / normal 两个桶', () => {
    const registry = setup()
    const q = vq({ combinator: 'and', children: [] }, [], 'type')
    const groups = pageEngine.run(pages, q, registry)
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
    const groups = pageEngine.run(pages, q, registry)
    // 单一全量桶（groupBy null），内部按字数升序：p1(500) < p3(800)
    expect(groups).toHaveLength(1)
    expect(ids(groups[0].items)).toEqual(['p1', 'p3'])
  })

  it('单例 getPageRegistry 已注册内置字段（与 compose 根一致）', () => {
    const registry = getPageRegistry()
    expect(registry.list(PAGE_ENTITY).length).toBe(7)
  })
})

/**
 * pageDefaultConfig(kind) —— f14a4d45 新增的「视图 kind → 实体默认布局」映射。
 * 视图未携带持久化 config 或解析失败时回退此值（store seed/create 经 options 注入），
 * 直接决定用户看到的列/落格字段。switch 各分支必须映射到正确的默认配置对象，
 * 一旦错配（如 table 误用 board 配置）无任何现有测试能发现，故在此集中断言。
 */
describe('pageDefaultConfig (视图 kind → 实体默认布局回退, f14a4d45)', () => {
  it('table → PAGE_DEFAULT_TABLE_CONFIG（6 列，标题为 primary）', () => {
    const cfg = pageDefaultConfig('table') as TableConfig
    expect(cfg).toBe(PAGE_DEFAULT_TABLE_CONFIG)
    expect(cfg.viewKind).toBe('table')
    expect(cfg.columns.map((c) => c.key)).toEqual([
      'title', 'type', 'createdAt', 'updatedAt', 'wordCount', 'childrenCount',
    ])
    expect(cfg.columns.find((c) => c.key === 'title')?.role).toBe('primary')
  })

  it('board → PAGE_DEFAULT_BOARD_CONFIG（viewKind 为 board）', () => {
    const cfg = pageDefaultConfig('board')
    expect(cfg).toBe(PAGE_DEFAULT_BOARD_CONFIG)
    expect(cfg.viewKind).toBe('board')
  })

  it('calendar → PAGE_DEFAULT_CALENDAR_CONFIG（按 updatedAt 落格）', () => {
    const cfg = pageDefaultConfig('calendar') as CalendarConfig
    expect(cfg).toBe(PAGE_DEFAULT_CALENDAR_CONFIG)
    expect(cfg.viewKind).toBe('calendar')
    expect(cfg.dateRefKind).toBe('updatedAt')
  })

  it('gallery → PAGE_DEFAULT_GALLERY_CONFIG（书房，票 08）', () => {
    const cfg = pageDefaultConfig('gallery') as GalleryConfig
    expect(cfg).toBe(PAGE_DEFAULT_GALLERY_CONFIG)
    expect(cfg.viewKind).toBe('gallery')
    expect(cfg.version).toBe(1)
  })
})

/**
 * 书房 gallery 视图注册（票 08 / ADR-0040 D9）：GalleryConfig 解析、书房 tab 种子查询
 * 与跨端视图类型过滤。pageViewKinds 决定书房 tab 是否出现在 Pages Library——
 * web/Android 无阅读器（ADR-0040 D2），gallery 不可用；一旦回归（web 端出现书房入口）
 * 无现有测试能发现，故在此集中断言。
 */
describe('书房 gallery 视图注册（票 08）', () => {
  it('parseLayoutConfig 接受合法 GalleryConfig，viewKind 不符回退 null', () => {
    expect(parseLayoutConfig('{"viewKind":"gallery","version":1}', 'gallery')).toEqual({
      viewKind: 'gallery',
      version: 1,
    })
    // 携带其他 viewKind 的 config 不能喂给 gallery 视图（错位渲染防护）
    expect(parseLayoutConfig('{"viewKind":"table","version":1,"columns":[]}', 'gallery')).toBeNull()
    expect(parseLayoutConfig(null, 'gallery')).toBeNull()
    expect(parseLayoutConfig('损坏 JSON', 'gallery')).toBeNull()
  })

  it('LIBRARY_TAB_QUERY 过滤后仅剩 type=book 的书 Page', () => {
    const registry = createRegistry()
    registerPageBuiltinFields(registry)
    const books: Page[] = [
      { ...pages[0], id: 'bk1', type: 'book' },
      { ...pages[1], id: 'bk2', type: 'book' },
    ]
    const mixed = [...books, ...pages]
    const result = pageEngine.filterSort(mixed, LIBRARY_TAB_QUERY, registry)
    expect(result.map((p) => p.id).sort()).toEqual(['bk1', 'bk2'])
  })

  it('pageViewKinds：桌面端含 gallery（书房），web/Android 不含（跨端过滤）', () => {
    expect(pageViewKinds(true)).toEqual(['table', 'calendar', 'gallery'])
    expect(pageViewKinds(false)).toEqual(['table', 'calendar'])
  })
})
