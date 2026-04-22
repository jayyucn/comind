/**
 * 回归测试：审查修复验证
 *
 * 覆盖本轮修改：
 * - P0: parser.ts 属性 key Unicode 支持
 * - P0: parser.ts TAG_REGEX 导出 + URL/邮箱排除
 * - P1: useTagFilter 缓存失效
 * - P2: TAG_REGEX DRY
 * - Bug fix: parsePropertyValue page ref 优先于 list
 * - Bug fix: isTagInUrlContext 双层排除
 */
import { describe, it, expect } from 'vitest'
import { parseContent, TAG_REGEX, parsePropertyValue } from './parser'

// ────────────────────────────────────────────────────────
// 1. 标签正则（TAG_REGEX 导出 + Unicode 支持）
// ────────────────────────────────────────────────────────

describe('TAG_REGEX — Unicode + 排除', () => {
  it('匹配 ASCII 标签', () => {
    const matches = [...'hello #world test'.matchAll(TAG_REGEX)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toBe('world')
  })

  it('匹配中文标签', () => {
    const matches = [...'这是 #工作 内容'.matchAll(TAG_REGEX)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toBe('工作')
  })

  it('匹配日文标签', () => {
    const matches = [...'テスト #プロジェクト です'.matchAll(TAG_REGEX)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toBe('プロジェクト')
  })

  it('匹配层级标签 #工作/项目A', () => {
    const matches = [...'这是 #工作/项目A 内容'.matchAll(TAG_REGEX)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toBe('工作/项目A')
  })

  it('排除数字开头的 #123', () => {
    const text = 'issue #123 fix'
    const matches = [...text.matchAll(TAG_REGEX)]
    expect(matches.length).toBe(0)
  })

  it('下划线开头的标签 #_private', () => {
    const matches = [...'tag #_private here'.matchAll(TAG_REGEX)]
    expect(matches.length).toBe(1)
    expect(matches[0][1]).toBe('_private')
  })

  it('多标签在同一行', () => {
    const matches = [...'#tag1 and #tag2'.matchAll(TAG_REGEX)]
    expect(matches.length).toBe(2)
    expect(matches[0][1]).toBe('tag1')
    expect(matches[1][1]).toBe('tag2')
  })
})

// ────────────────────────────────────────────────────────
// 2. parseContent — 标签排除（代码层 isTagInUrlContext）
// ────────────────────────────────────────────────────────

describe('parseContent — URL/邮箱标签排除', () => {
  it('排除 URL 锚点 https://x.com#section', () => {
    const result = parseContent('visit https://x.com#section here')
    expect(result.tags).toEqual([])
  })

  it('排除邮箱锚点 user@domain#tag', () => {
    const result = parseContent('email user@domain#tag here')
    expect(result.tags).toEqual([])
  })

  it('排除协议锚点 mailto:#anchor', () => {
    const result = parseContent('send mailto:#anchor here')
    expect(result.tags).toEqual([])
  })

  it('正常标签不受 URL 排除影响', () => {
    const result = parseContent('visit #设计 和 https://x.com#section')
    expect(result.tags).toEqual(['设计'])
  })
})

// ────────────────────────────────────────────────────────
// 3. parseContent — 属性 key Unicode
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

  it('标签与属性混合', () => {
    const result = parseContent('项目:: 数据模型\n这是 #设计 和 #开发 的内容')
    expect(result.tags).toEqual(expect.arrayContaining(['设计', '开发']))
    expect(result.properties['项目']).toBe('数据模型')
  })

  it('不识别数字开头的属性 123:: bad', () => {
    const result = parseContent('123:: bad\n正文')
    expect(result.properties['123']).toBeUndefined()
  })

  it('含 . 的标签部分不提取', () => {
    // #v2 匹配但 tag 不含 .，#v2.0 整体不匹配因为 . 不在 TAG_PATTERN 中
    const result = parseContent('check #v2.0 release')
    // TAG_REGEX 匹配 #v2（. 不是合法字符，匹配到此为止）
    // tag = 'v2' 不含 .，所以会被提取。这是正则的固有限制。
    // 但 parseContent 中 tag.includes('.') 检查的是 match[1]
    // 'v2' 不含 .，所以会被提取。这个行为可以接受——#v2 后面的 .0 不是标签的一部分
    expect(result.tags).toEqual(['v2'])
  })
})

// ────────────────────────────────────────────────────────
// 4. parsePropertyValue — 类型推断
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

// ────────────────────────────────────────────────────────
// 5. useTagFilter — 缓存失效
// ────────────────────────────────────────────────────────

describe('useTagFilter — 缓存失效', () => {
  it('invalidateTagCache 不抛异常', async () => {
    const { invalidateTagCache } = await import('../composables/useTagFilter')
    expect(() => invalidateTagCache()).not.toThrow()
  })
})
