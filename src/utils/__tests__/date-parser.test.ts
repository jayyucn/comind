import { describe, it, expect } from 'vitest'
import {
  parseRelativeDate,
  relativeDateShortcuts,
  formatRelativeExpr,
  isRelativeToken,
  resolveRelativeExpr,
} from '../date-parser'

/**
 * 锁住本地时区的固定锚点：2026-09-06 周日 12:00（任意时间都行，关键是日历日）。
 * 用 `new Date(y, m-1, d)` 构造本地午夜，避免 UTC 漂移。
 */
const SUN = new Date(2026, 8, 6, 12) // 2026-09-06 = Sunday
const ISO = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

describe('parseRelativeDate', () => {
  describe('today / tomorrow / yesterday', () => {
    it('today', () => expect(parseRelativeDate('today', SUN)).toBe(ISO(2026, 9, 6)))
    it('今天', () => expect(parseRelativeDate('今天', SUN)).toBe(ISO(2026, 9, 6)))
    it('tomorrow', () => expect(parseRelativeDate('tomorrow', SUN)).toBe(ISO(2026, 9, 7)))
    it('明天', () => expect(parseRelativeDate('明天', SUN)).toBe(ISO(2026, 9, 7)))
    it('yesterday', () => expect(parseRelativeDate('yesterday', SUN)).toBe(ISO(2026, 9, 5)))
    it('昨天', () => expect(parseRelativeDate('昨天', SUN)).toBe(ISO(2026, 9, 5)))
    it('Today 大小写不敏感', () =>
      expect(parseRelativeDate('Today', SUN)).toBe(ISO(2026, 9, 6)))
    it('Today 前后空格', () =>
      expect(parseRelativeDate('  today  ', SUN)).toBe(ISO(2026, 9, 6)))
  })

  describe('relative +N / -N days', () => {
    it('+3', () => expect(parseRelativeDate('+3', SUN)).toBe(ISO(2026, 9, 9)))
    it('-1d', () => expect(parseRelativeDate('-1d', SUN)).toBe(ISO(2026, 9, 5)))
    it('+7 days', () => expect(parseRelativeDate('+7 days', SUN)).toBe(ISO(2026, 9, 13)))
    it('-30', () => expect(parseRelativeDate('-30', SUN)).toBe(ISO(2026, 8, 7)))
  })

  describe('YYYY-MM-DD', () => {
    it('合法', () =>
      expect(parseRelativeDate('2026-08-01', SUN)).toBe(ISO(2026, 8, 1)))
    it('年份越界（<2000）', () =>
      expect(parseRelativeDate('1999-12-31', SUN)).toBeNull())
    it('月份越界', () =>
      expect(parseRelativeDate('2026-13-01', SUN)).toBeNull())
    it('2月30日规范化拒绝', () =>
      expect(parseRelativeDate('2026-02-30', SUN)).toBeNull())
  })

  describe('MM-DD', () => {
    it('本月未来', () =>
      expect(parseRelativeDate('09-15', SUN)).toBe(ISO(2026, 9, 15)))
    it('本月已过 → 明年', () =>
      expect(parseRelativeDate('03-01', SUN)).toBe(ISO(2027, 3, 1)))
    it('今日（不算过去）→ 今年而非明年', () =>
      expect(parseRelativeDate('09-06', SUN)).toBe(ISO(2026, 9, 6)))
    it('非法月', () => expect(parseRelativeDate('13-01', SUN)).toBeNull())
    it('非法日', () => expect(parseRelativeDate('02-30', SUN)).toBeNull())
  })

  describe('中文周X（today=周日 2026-09-06）', () => {
    // target 周一 = 本周已是过完 → 推到下周
    it('周一 → 下周一', () =>
      expect(parseRelativeDate('周一', SUN)).toBe(ISO(2026, 9, 7)))
    // target 周日 = 本周日（今天），已过/即今天 → 推到下周
    it('周日 → 下周日', () =>
      expect(parseRelativeDate('周日', SUN)).toBe(ISO(2026, 9, 13)))
    // target 周三 = 本周三，已过 → 推到下周三
    it('周三 → 下周三', () =>
      expect(parseRelativeDate('周三', SUN)).toBe(ISO(2026, 9, 9)))
    // 显式下周：与 `周一` 同值（Rust is_next_week = thisWeek+7 而非 thisWeek+14）
    it('下周一 ≡ 周一（即下一个周一，today=周日时=下一天）', () =>
      expect(parseRelativeDate('下周一', SUN)).toBe(ISO(2026, 9, 7)))
    // 星期 X 同义词
    it('星期三 ≡ 周三', () =>
      expect(parseRelativeDate('星期三', SUN)).toBe(ISO(2026, 9, 9)))
    // 天 ≡ 日（周日另一种说法）
    it('周天 ≡ 周日', () =>
      expect(parseRelativeDate('周天', SUN)).toBe(ISO(2026, 9, 13)))
  })

  describe('fallback', () => {
    it('空字符串 → null', () => expect(parseRelativeDate('', SUN)).toBeNull())
    it('空白 → null', () => expect(parseRelativeDate('   ', SUN)).toBeNull())
    it('乱码 → null', () => expect(parseRelativeDate('blah', SUN)).toBeNull())
    it('孤立符号 → null', () => expect(parseRelativeDate('+', SUN)).toBeNull())
    it('未支持语法 → null', () => expect(parseRelativeDate('last week', SUN)).toBeNull())
  })
})

describe('relativeDateShortcuts', () => {
  it('2026-09-06 周日：today/昨天/明日 正确', () => {
    const s = relativeDateShortcuts(SUN)
    expect(s.today).toBe(ISO(2026, 9, 6))
    expect(s.yesterday).toBe(ISO(2026, 9, 5))
    expect(s.tomorrow).toBe(ISO(2026, 9, 7))
  })
  it('2026-09-06 周日：本周起=ISO 周的周一（8-31）/ 本周末=今天（9-6）', () => {
    // 与 Rust 端语义对齐：用 today 的「从周一起算」差值作为本周起点，
    // today=周日时本周一起=上周一 8-31，周末日=今天 9-6。
    // 这样"晚于本周起始"包含今天（a "本周内" 范围的预期行为）。
    const s = relativeDateShortcuts(SUN)
    expect(s.weekStart).toBe(ISO(2026, 8, 31))
    expect(s.weekEnd).toBe(ISO(2026, 9, 6))
  })
  it('本月初 / 本月末（2026-09）', () => {
    const s = relativeDateShortcuts(SUN)
    expect(s.monthStart).toBe(ISO(2026, 9, 1))
    expect(s.monthEnd).toBe(ISO(2026, 9, 30))
  })
  it('跨年 2 月：本月末=2 月最后一天（2024 闰年=29）', () => {
    const leap = new Date(2024, 1, 15, 12)
    const s = relativeDateShortcuts(leap)
    expect(s.monthEnd).toBe(ISO(2024, 2, 29))
  })
})

describe('formatRelativeExpr / isRelativeToken', () => {
  it('7 个快捷 token → 中文', () => {
    expect(formatRelativeExpr('today')).toBe('今日')
    expect(formatRelativeExpr('yesterday')).toBe('昨日')
    expect(formatRelativeExpr('tomorrow')).toBe('明日')
    expect(formatRelativeExpr('weekStart')).toBe('本周起始')
    expect(formatRelativeExpr('weekEnd')).toBe('本周末')
    expect(formatRelativeExpr('monthStart')).toBe('本月初')
    expect(formatRelativeExpr('monthEnd')).toBe('本月末')
  })
  it('键入的自由语法回显原文（不是快捷词）', () => {
    expect(formatRelativeExpr('+3')).toBe('+3')
    expect(formatRelativeExpr('下周一')).toBe('下周一')
    expect(formatRelativeExpr('2026-09-06')).toBe('2026-09-06')
  })
  it('isRelativeToken 判定', () => {
    expect(isRelativeToken('today')).toBe(true)
    expect(isRelativeToken('monthEnd')).toBe(true)
    expect(isRelativeToken('+3')).toBe(false)
    expect(isRelativeToken('2026-09-06')).toBe(false)
  })
})

describe('resolveRelativeExpr', () => {
  it('快捷 token → 与 relativeDateShortcuts 同值', () => {
    const s = relativeDateShortcuts(SUN)
    expect(resolveRelativeExpr('today', SUN)).toBe(s.today)
    expect(resolveRelativeExpr('weekStart', SUN)).toBe(s.weekStart)
    expect(resolveRelativeExpr('monthEnd', SUN)).toBe(s.monthEnd)
  })
  it('自由语法委托 parseRelativeDate', () => {
    expect(resolveRelativeExpr('+3', SUN)).toBe(ISO(2026, 9, 9))
    expect(resolveRelativeExpr('今天', SUN)).toBe(ISO(2026, 9, 6))
    expect(resolveRelativeExpr('下周一', SUN)).toBe(ISO(2026, 9, 7))
    expect(resolveRelativeExpr('2026-08-01', SUN)).toBe(ISO(2026, 8, 1))
  })
  it('无效表达式 → null', () => {
    expect(resolveRelativeExpr('garbage', SUN)).toBeNull()
    expect(resolveRelativeExpr('', SUN)).toBeNull()
  })
})
