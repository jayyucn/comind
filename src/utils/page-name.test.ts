import { describe, expect, it } from 'vitest'

import { PAGE_NAME_RULE_HINT, suggestPageName, validatePageName } from './page-name'

/**
 * 页名约束（建链准入）的判据锁。
 *
 * 规则本身很短，但它是三个入口（新建页 / 重命名 / 选区转页面引用）共用的同一份
 * 判断，一旦漂移就会出现「手输能用、按钮不让」的不一致 —— 所以逐条钉住。
 */
describe('validatePageName — 合法页名', () => {
  it('普通中文通过，并给出 trim 后的名字', () => {
    expect(validatePageName('  项目A  ')).toEqual({ ok: true, name: '项目A' })
  })

  it('允许 #（[[页面#块ID]] 的 # 属于目标）', () => {
    expect(validatePageName('项目A#设计')).toEqual({ ok: true, name: '项目A#设计' })
  })

  it('允许空格、标点与 emoji', () => {
    expect(validatePageName('Weekly Review 🚀')).toEqual({ ok: true, name: 'Weekly Review 🚀' })
  })
})

describe('validatePageName — 拒绝与建议', () => {
  it('空串与纯空白被拒', () => {
    const result = validatePageName('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('不能为空')
      expect(result.suggestion).toBeNull()
    }
  })

  it('含 | 被拒，并建议换成 ·', () => {
    const result = validatePageName('项目A|旧名')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('别名分隔符')
      expect(result.suggestion).toBe('项目A·旧名')
    }
  })

  it('含 [ 与 ] 被拒，并建议换成全角括号', () => {
    const left = validatePageName('项目[A')
    const right = validatePageName('项目A]')
    expect(left.ok).toBe(false)
    expect(right.ok).toBe(false)
    if (!left.ok) expect(left.suggestion).toBe('项目（A')
    if (!right.ok) expect(right.suggestion).toBe('项目A）')
  })

  it('含换行被拒，并建议换成空格', () => {
    const result = validatePageName('项目A\n旧名')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('换行')
      expect(result.suggestion).toBe('项目A 旧名')
    }
  })

  it('建议名本身必须重新通过校验（建议不能是新的非法名）', () => {
    const result = validatePageName('a|b[c]d')
    expect(result.ok).toBe(false)
    if (!result.ok && result.suggestion) {
      expect(validatePageName(result.suggestion).ok).toBe(true)
    }
  })
})

describe('suggestPageName', () => {
  it('按替换表清洗并 trim', () => {
    expect(suggestPageName('  a|b\nc  ')).toBe('a·b c')
  })
})

describe('PAGE_NAME_RULE_HINT', () => {
  it('置灰提示只写判据，不写「不支持」', () => {
    expect(PAGE_NAME_RULE_HINT).toContain('|')
    expect(PAGE_NAME_RULE_HINT).toContain('换行')
    expect(PAGE_NAME_RULE_HINT).not.toContain('不支持')
  })
})
