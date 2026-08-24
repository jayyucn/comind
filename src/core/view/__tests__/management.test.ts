import { describe, it, expect } from 'vitest'
import { canDeleteScreen, canDeleteTab, diffQueryParts, isDefaultScreen, defaultViewNameForEntity } from '../management'
import type { ViewQuery } from '../../query'
import type { ScreenViewRust } from '../../wasm/types'

function screen(id: string, isDefault = 0): ScreenViewRust {
  return {
    id,
    entity: 'block',
    parent_id: '',
    name: id,
    query_json: '{}',
    view_type: 'table',
    group_by: '',
    is_default: isDefault,
    sort_order: 0,
    config: '{}',
    created_at: 0,
    updated_at: 0,
  }
}

function tab(id: string, parentId: string): ScreenViewRust {
  return {
    id,
    entity: 'block',
    parent_id: parentId,
    name: id,
    query_json: '{}',
    view_type: 'table',
    group_by: '',
    is_default: 0,
    sort_order: 0,
    config: '{}',
    created_at: 0,
    updated_at: 0,
  }
}

describe('view management rules', () => {
  describe('isDefaultScreen', () => {
    it('is_default===1 时为默认', () => {
      expect(isDefaultScreen(screen('s', 1))).toBe(true)
    })
    it('is_default!==1 时非默认', () => {
      expect(isDefaultScreen(screen('s', 0))).toBe(false)
    })
    it('undefined / null 安全', () => {
      expect(isDefaultScreen(undefined)).toBe(false)
      expect(isDefaultScreen(null)).toBe(false)
    })
  })

  describe('canDeleteScreen', () => {
    it('默认 Screen 不可删除', () => {
      const screens = [screen('s1', 1), screen('s2', 0)]
      expect(canDeleteScreen(screens, 's1')).toBe(false)
    })
    it('仅剩一个 Screen 时不可删除', () => {
      const screens = [screen('s1', 1)]
      expect(canDeleteScreen(screens, 's1')).toBe(false)
    })
    it('非默认且有多个 Screen 时可删除', () => {
      const screens = [screen('s1', 1), screen('s2', 0)]
      expect(canDeleteScreen(screens, 's2')).toBe(true)
    })
  })

  describe('canDeleteTab', () => {
    it('同 Screen 内多于一个 Tab 时可删除', () => {
      const tabs = [tab('t1', 's1'), tab('t2', 's1')]
      expect(canDeleteTab(tabs, 't1')).toBe(true)
    })
    it('仅剩一个 Tab 时不可删除', () => {
      const tabs = [tab('t1', 's1')]
      expect(canDeleteTab(tabs, 't1')).toBe(false)
    })
  })

  describe('defaultViewNameForEntity', () => {
    it('page 实体默认名为「全部页面」', () => {
      expect(defaultViewNameForEntity('page')).toBe('全部页面')
    })
    it('其他实体默认名为「全部任务」', () => {
      expect(defaultViewNameForEntity('block')).toBe('全部任务')
      expect(defaultViewNameForEntity('note')).toBe('全部任务')
    })
  })

  describe('diffQueryParts', () => {
    const base: ViewQuery = { version: 1, filter: { combinator: 'and', children: [] }, sort: [], groupBy: null }
    const withFilter: ViewQuery = {
      ...base,
      filter: { combinator: 'and', children: [{ field: 'status', op: 'eq', value: { kind: 'literal', value: 'done' } }] },
    }
    const withSort: ViewQuery = { ...base, sort: [{ field: 'due', dir: 'asc' }] }
    const withGroup: ViewQuery = { ...base, groupBy: 'status' }

    it('无改动 → 空数组', () => {
      expect(diffQueryParts(base, { ...base })).toEqual([])
    })
    it('仅筛选改动 → [filter]', () => {
      expect(diffQueryParts(base, withFilter)).toEqual(['filter'])
    })
    it('仅排序改动 → [sort]', () => {
      expect(diffQueryParts(base, withSort)).toEqual(['sort'])
    })
    it('仅分组改动 → [group]', () => {
      expect(diffQueryParts(base, withGroup)).toEqual(['group'])
    })
    it('筛选+分组 → 按优先级 [filter, group]', () => {
      expect(diffQueryParts(base, { ...withFilter, groupBy: 'status' })).toEqual(['filter', 'group'])
    })
    it('三者全变 → 按优先级 [filter, sort, group]', () => {
      expect(diffQueryParts(base, { version: 1, filter: withFilter.filter, sort: withSort.sort, groupBy: 'status' })).toEqual(['filter', 'sort', 'group'])
    })
    it('排序+分组 → [sort, group]', () => {
      expect(diffQueryParts(base, { ...withSort, groupBy: 'status' })).toEqual(['sort', 'group'])
    })
    it('groupBy null 与 undefined 等价 → 不算改动', () => {
      expect(diffQueryParts(base, { ...base, groupBy: undefined })).toEqual([])
    })
  })
})
