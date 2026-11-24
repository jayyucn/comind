import { describe, expect, it } from 'vitest'

import { calloutFormatPatch, calloutToneOf, isCalloutTone } from './callout'

describe('callout — 语义值的读与写', () => {
  it('四种语义都能读回', () => {
    for (const tone of ['info', 'warn', 'success', 'danger'] as const) {
      expect(calloutToneOf({ callout: tone })).toBe(tone)
    }
  })

  it('缺省 / 脏值一律 null（不兜底成默认色）', () => {
    expect(calloutToneOf({})).toBeNull()
    expect(calloutToneOf(null)).toBeNull()
    expect(calloutToneOf(undefined)).toBeNull()
    expect(calloutToneOf({ callout: 'warning' })).toBeNull()
    expect(calloutToneOf({ callout: 1 })).toBeNull()
  })

  it('isCalloutTone 只认枚举内的字符串', () => {
    expect(isCalloutTone('warn')).toBe(true)
    expect(isCalloutTone('WARN')).toBe(false)
    expect(isCalloutTone(undefined)).toBe(false)
  })

  it('写入 patch：null 置 undefined（JSON 序列化时丢键 = 删除）', () => {
    expect(calloutFormatPatch('info')).toEqual({ callout: 'info' })
    expect(calloutFormatPatch(null)).toEqual({ callout: undefined })
    expect(JSON.stringify(calloutFormatPatch(null))).toBe('{}')
  })
})
