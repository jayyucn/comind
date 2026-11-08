import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearTableClipboard,
  getTableClipboard,
  hasTableClipboard,
  setTableClipboard,
} from './table-clipboard'

describe('table-clipboard - 模块级范围剪贴板', () => {
  beforeEach(() => clearTableClipboard())

  it('空剪贴板：读取为 null、判定为假', () => {
    expect(getTableClipboard()).toBeNull()
    expect(hasTableClipboard()).toBe(false)
  })

  it('写入后可读回矩形内容', () => {
    setTableClipboard([['a', 'b'], ['c', 'd']])
    expect(getTableClipboard()).toEqual([['a', 'b'], ['c', 'd']])
    expect(hasTableClipboard()).toBe(true)
  })

  it('深拷贝：写入后再改源数组不影响剪贴板', () => {
    const source = [['a']]
    setTableClipboard(source)
    source[0]![0] = 'changed'
    expect(getTableClipboard()).toEqual([['a']])
  })

  it('跨调用共享（模块级，不随调用方实例销毁）', () => {
    setTableClipboard([['x']])
    expect(getTableClipboard()).toEqual([['x']])
    clearTableClipboard()
    expect(getTableClipboard()).toBeNull()
  })
})
