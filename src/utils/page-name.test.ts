import { describe, expect, it } from 'vitest'

import { pageNameRejectionHint, suggestPageName, validatePageName } from './page-name'

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

describe('validatePageName — 违规字符清单', () => {
  it('chars 去重、保序、换行归一为 \\n', () => {
    const result = validatePageName('a[b|c]d\ne')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.chars).toEqual(['[', '|', ']', '\n'])
  })

  it('只含空白时 chars 为空（提示走「只有空白」分支）', () => {
    const result = validatePageName('  ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.chars).toEqual([])
  })

  it('message 点名第一个违规字符，不含「非法字符」这种笼统说法', () => {
    const result = validatePageName('[页面')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('「[」')
      expect(result.message).not.toContain('非法字符')
    }
  })
})

/**
 * 置灰 tooltip 的文案来源：用户诉求是「说清具体问题」。
 * 反例（曾经的实现）：一律回「含 | [ ] 或换行，或只有空白」，
 * 选中 `[页面` 时用户得在这 6 个字符里逐个试。
 */
describe('pageNameRejectionHint — 置灰时说清具体问题', () => {
  it('合法返回 null（调用方据此判断可点）', () => {
    expect(pageNameRejectionHint('项目A')).toBeNull()
    expect(pageNameRejectionHint('  项目A  ')).toBeNull()
  })

  it('含 [ → 直接点名「[」', () => {
    expect(pageNameRejectionHint('[页面')).toBe('选区不能作为页面名，不能包含「[」')
  })

  it('含 | 与 ] → 一次列全，不让用户逐个试', () => {
    expect(pageNameRejectionHint('a|b]c')).toBe('选区不能作为页面名，不能包含「|」「]」')
  })

  it('换行写成「换行」，不写成转义符', () => {
    expect(pageNameRejectionHint('a\nb')).toBe('选区不能作为页面名，不能包含换行')
  })

  it('只有空白 → 说明原因不是字符，而是选区为空', () => {
    expect(pageNameRejectionHint('   ')).toBe('选区不能作为页面名，选区只有空白')
  })

  it('超过 3 个违规字符 → 收成「等」，不让 tooltip 无限变长', () => {
    expect(pageNameRejectionHint('a[b|c]d\ne')).toBe(
      '选区不能作为页面名，不能包含「[」「|」「]」等',
    )
  })

  it('不给替换建议（包裹场景建议全角括号会把人引远）', () => {
    expect(pageNameRejectionHint('[页面')).not.toContain('（')
  })

  it('不写「不支持」「不可用」这类等于没说的措辞', () => {
    const hint = pageNameRejectionHint('[页面') ?? ''
    expect(hint).not.toContain('不支持')
    expect(hint).not.toContain('不可用')
  })
})
