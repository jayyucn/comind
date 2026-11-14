import { describe, expect, it } from 'vitest'

import type { TableConfig } from '../../../../core/view'
import { normalizePageColumn } from './page-column'

function config(columns: TableConfig['columns']): TableConfig {
  return { viewKind: 'table', version: 1, columns }
}

describe('normalizePageColumn（旧查询块页面列兼容）', () => {
  it('把 role=link 的页面列升级为 source-page 单元格，保留宽度与其余列', () => {
    const input = config([
      { key: 'content', role: 'primary', cell: 'block-content', width: 220 },
      { key: 'page', role: 'link', width: 130 },
      { key: 'updatedAt', width: 130 },
    ])
    const out = normalizePageColumn(input)

    expect(out).not.toBe(input)
    expect(out.columns[1]).toMatchObject({ key: 'page', cell: 'source-page', width: 130 })
    expect(out.columns[1]!.role).toBeUndefined()
    // 其余列原样（对象引用不变，避免无谓重渲染）
    expect(out.columns[0]).toBe(input.columns[0])
    expect(out.columns[2]).toBe(input.columns[2])
  })

  it('已是 source-page 的页面列不再改写，且返回同一对象', () => {
    const input = config([
      { key: 'content', role: 'primary', cell: 'block-content', width: 220 },
      { key: 'page', cell: 'source-page', width: 130 },
    ])
    expect(normalizePageColumn(input)).toBe(input)
  })

  it('没有页面列时返回同一对象', () => {
    const input = config([{ key: 'content', role: 'primary', width: 400 }])
    expect(normalizePageColumn(input)).toBe(input)
  })

  it('页面列已有其它自定义 cell 时不覆盖', () => {
    const input = config([{ key: 'page', cell: 'custom-page', width: 90 }])
    const out = normalizePageColumn(input)
    expect(out).toBe(input)
    expect(out.columns[0]!.cell).toBe('custom-page')
  })
})
