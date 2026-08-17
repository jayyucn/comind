import { describe, it, expect } from 'vitest'
import { canDeleteScreen, canDeleteTab, isDefaultScreen, defaultViewNameForEntity } from '../management'
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
})
