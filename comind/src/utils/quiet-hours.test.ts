import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isQuietHours, parseTime, formatTime } from './quiet-hours'
import type { NotificationSettings } from '../wasm/types'
import { DEFAULT_NOTIFICATION_SETTINGS } from '../types/notification'

/**
 * 工具：构造一份只含 quiet_hours 字段的 settings。
 * 其他字段用默认值，类型上补齐。
 */
function settingsWithRange(start: string | null, end: string | null): NotificationSettings {
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    quiet_hours_start: start,
    quiet_hours_end: end,
  }
}

describe('parseTime', () => {
  it('解析标准 HH:MM', () => {
    expect(parseTime('09:30')).toEqual({ hours: 9, minutes: 30 })
    expect(parseTime('23:59')).toEqual({ hours: 23, minutes: 59 })
    expect(parseTime('00:00')).toEqual({ hours: 0, minutes: 0 })
  })

  it('解析单数字小时 H:MM', () => {
    expect(parseTime('9:30')).toEqual({ hours: 9, minutes: 30 })
  })

  it('拒绝非法格式', () => {
    expect(parseTime('')).toBeNull()
    expect(parseTime('abc')).toBeNull()
    expect(parseTime('12:60')).toBeNull()     // 分钟越界
    expect(parseTime('24:00')).toBeNull()     // 小时越界
    expect(parseTime('-1:00')).toBeNull()     // 负号
    expect(parseTime('12:')).toBeNull()       // 缺分钟
    expect(parseTime('123:00')).toBeNull()    // 小时三位
    expect(parseTime('12:5')).toBeNull()      // 分钟一位（正则要求 2 位）
    expect(parseTime('12:00:00')).toBeNull()  // 含秒
  })

  it('拒绝越界的小时/分钟', () => {
    expect(parseTime('25:00')).toBeNull()
    expect(parseTime('12:99')).toBeNull()
  })
})

describe('formatTime', () => {
  it('单数字补零', () => {
    expect(formatTime(0, 0)).toBe('00:00')
    expect(formatTime(9, 5)).toBe('09:05')
  })

  it('已经是两位数保持原样', () => {
    expect(formatTime(12, 30)).toBe('12:30')
    expect(formatTime(23, 59)).toBe('23:59')
  })

  it('与 parseTime 互逆', () => {
    const parsed = parseTime('07:08')!
    expect(formatTime(parsed.hours, parsed.minutes)).toBe('07:08')
  })
})

describe('isQuietHours', () => {
  beforeEach(() => {
    // 用固定的"2026-07-24 14:00"（下午 2 点）作为基准时间
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 24, 14, 0, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('start/end 均为 null → 不在静默时段', () => {
    expect(isQuietHours(settingsWithRange(null, null))).toBe(false)
  })

  it('仅 start 缺失 → 不在静默时段', () => {
    expect(isQuietHours(settingsWithRange('22:00', null))).toBe(false)
  })

  it('仅 end 缺失 → 不在静默时段', () => {
    expect(isQuietHours(settingsWithRange(null, '08:00'))).toBe(false)
  })

  it('非法时间字符串 → 不在静默时段（安全失败）', () => {
    expect(isQuietHours(settingsWithRange('99:99', '08:00'))).toBe(false)
    expect(isQuietHours(settingsWithRange('22:00', 'abc'))).toBe(false)
  })

  describe('同一天区间（start < end）', () => {
    it('区间内：在范围内', () => {
      // 22:00 ~ 08:00 是跨天，但 14:00 不在 22:00~23:59 区间内
      // 这里测真正的同日区间 12:00 ~ 18:00
      vi.setSystemTime(new Date(2026, 6, 24, 15, 0, 0, 0))
      expect(isQuietHours(settingsWithRange('12:00', '18:00'))).toBe(true)
    })

    it('区间外：在范围前', () => {
      vi.setSystemTime(new Date(2026, 6, 24, 10, 0, 0, 0))
      expect(isQuietHours(settingsWithRange('12:00', '18:00'))).toBe(false)
    })

    it('区间外：在范围后', () => {
      vi.setSystemTime(new Date(2026, 6, 24, 20, 0, 0, 0))
      expect(isQuietHours(settingsWithRange('12:00', '18:00'))).toBe(false)
    })

    it('左边界：恰好等于 start → 在区间（包含）', () => {
      vi.setSystemTime(new Date(2026, 6, 24, 12, 0, 0, 0))
      expect(isQuietHours(settingsWithRange('12:00', '18:00'))).toBe(true)
    })

    it('右边界：恰好等于 end → 不在区间（半开区间）', () => {
      vi.setSystemTime(new Date(2026, 6, 24, 18, 0, 0, 0))
      expect(isQuietHours(settingsWithRange('12:00', '18:00'))).toBe(false)
    })

    it('右边界前 1 分钟 → 在区间', () => {
      vi.setSystemTime(new Date(2026, 6, 24, 17, 59, 0, 0))
      expect(isQuietHours(settingsWithRange('12:00', '18:00'))).toBe(true)
    })
  })

  describe('跨天区间（start > end）', () => {
    it('深夜：在区间内（22:00 ~ 08:00，凌晨 2 点）', () => {
      vi.setSystemTime(new Date(2026, 6, 24, 2, 0, 0, 0))
      expect(isQuietHours(settingsWithRange('22:00', '08:00'))).toBe(true)
    })

    it('清晨：恰好等于 end → 不在区间（半开）', () => {
      vi.setSystemTime(new Date(2026, 6, 24, 8, 0, 0, 0))
      expect(isQuietHours(settingsWithRange('22:00', '08:00'))).toBe(false)
    })

    it('黄昏：恰好等于 start → 在区间（包含）', () => {
      vi.setSystemTime(new Date(2026, 6, 24, 22, 0, 0, 0))
      expect(isQuietHours(settingsWithRange('22:00', '08:00'))).toBe(true)
    })

    it('中午：不在区间', () => {
      // 默认系统时间是 14:00
      expect(isQuietHours(settingsWithRange('22:00', '08:00'))).toBe(false)
    })

    it('午夜 23:59：在区间', () => {
      vi.setSystemTime(new Date(2026, 6, 24, 23, 59, 0, 0))
      expect(isQuietHours(settingsWithRange('22:00', '08:00'))).toBe(true)
    })

    it('00:00：在区间', () => {
      vi.setSystemTime(new Date(2026, 6, 24, 0, 0, 0, 0))
      expect(isQuietHours(settingsWithRange('22:00', '08:00'))).toBe(true)
    })

    it('07:59：在区间（end 之前 1 分钟）', () => {
      vi.setSystemTime(new Date(2026, 6, 24, 7, 59, 0, 0))
      expect(isQuietHours(settingsWithRange('22:00', '08:00'))).toBe(true)
    })
  })

  describe('边界：start === end', () => {
    // 当 start === end 时进入 else 分支：
    //   nowMinutes >= startMinutes || nowMinutes < endMinutes
    // 等价于"全部时间都在静默"——这是定义上的退化（0 时长静默 = 全时静默）。
    // 这里锁定现状：所有时间点都返回 true。
    // 若未来产品决定禁用这种配置，测试需要更新。
    it('start === end → 所有时间点都判定为静默（退化配置）', () => {
      for (const h of [0, 6, 12, 18, 23]) {
        vi.setSystemTime(new Date(2026, 6, 24, h, 30, 0, 0))
        expect(isQuietHours(settingsWithRange('08:00', '08:00'))).toBe(true)
      }
    })
  })
})
