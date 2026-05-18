/**
 * 回归测试：属性解析 + 链接解析
 *
 * Tag 相关测试已移除：
 * - #tag 现在作为 Page 链接处理，由渲染层负责
 * - 不再在 parser 层提取 tags
 */
import { describe, it, expect } from 'vitest'
import { parseContent, parsePropertyValue } from './parser'

// ────────────────────────────────────────────────────────
// 1. parseContent — 属性 key Unicode
// ────────────────────────────────────────────────────────

describe('parseContent — 属性解析', () => {
  it('中文属性 key 解析', () => {
    const result = parseContent('状态:: 进行中\n这是正文')
    expect(result.properties['状态']).toBe('进行中')
  })

  it('下划线开头的属性 key', () => {
    const result = parseContent('_internal:: yes\n正文')
    expect(result.properties['_internal']).toBe('yes')
  })

  it('中文属性 + 类型推断', () => {
    const result = parseContent('优先级:: P0\n截止:: 2026-04-20\n完成:: true')
    expect(result.properties['优先级']).toBe('P0')
    expect(result.properties['截止']).toBe('2026-04-20')
    expect(result.properties['完成']).toBe(true)
  })

  it('不识别数字开头的属性 123:: bad', () => {
    const result = parseContent('123:: bad\n正文')
    expect(result.properties['123']).toBeUndefined()
  })
})

// ────────────────────────────────────────────────────────
// 2. parseContent — 链接解析
// ────────────────────────────────────────────────────────

describe('parseContent — 链接解析', () => {
  it('内部链接 [[页面名]]', () => {
    const result = parseContent('这是 [[项目A]] 的笔记')
    expect(result.links.length).toBe(1)
    expect(result.links[0].targetTitle).toBe('项目A')
    expect(result.links[0].isExternal).toBe(false)
  })

  it('带别名的链接 [[页面名|显示名]]', () => {
    const result = parseContent('参考 [[项目A|A项目]]')
    expect(result.links.length).toBe(1)
    expect(result.links[0].targetTitle).toBe('项目A')
    expect(result.links[0].displayText).toBe('A项目')
  })

  it('外部链接 [[https://...]]', () => {
    const result = parseContent('访问 [[https://example.com]]')
    expect(result.links.length).toBe(1)
    expect(result.links[0].targetTitle).toBe('https://example.com')
    expect(result.links[0].isExternal).toBe(true)
  })

  it('多个链接', () => {
    const result = parseContent('[[A]] 和 [[B]] 和 [[C]]')
    expect(result.links.length).toBe(3)
    expect(result.links.map(l => l.targetTitle)).toEqual(['A', 'B', 'C'])
  })
})

// ────────────────────────────────────────────────────────
// 3. parsePropertyValue — 类型推断
// ────────────────────────────────────────────────────────

describe('parsePropertyValue — 类型推断', () => {
  it('boolean true', () => {
    expect(parsePropertyValue('true')).toBe(true)
  })

  it('boolean false', () => {
    expect(parsePropertyValue('false')).toBe(false)
  })

  it('date', () => {
    expect(parsePropertyValue('2026-04-20')).toBe('2026-04-20')
  })

  it('number integer', () => {
    expect(parsePropertyValue('42')).toBe(42)
  })

  it('number float', () => {
    expect(parsePropertyValue('3.14')).toBe(3.14)
  })

  it('page reference — 优先于 list', () => {
    // [[张三]] 同时满足 startsWith('[')，必须走 page 分支
    expect(parsePropertyValue('[[张三]]')).toBe('张三')
  })

  it('list', () => {
    expect(parsePropertyValue('[张三, 李四]')).toEqual(['张三', '李四'])
  })

  it('string fallback', () => {
    expect(parsePropertyValue('进行中')).toBe('进行中')
  })
})
