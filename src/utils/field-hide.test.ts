/**
 * 字段「隐藏」规则单源测试（ADR-0050 D18）。
 *
 * 判据必须与 Rust `normalize_hide_when` / `FIELD_HIDE_WHEN_VALUES` 同判据 ——
 * 这里的白名单外回落行为与取值表就是契约的 TS 侧钉子。
 */
import { describe, it, expect } from 'vitest'
import {
  FIELD_HIDE_LABELS,
  FIELD_HIDE_VALUES,
  decodeDefaultJson,
  isFieldHiddenByRule,
  normalizeHideWhen,
} from './field-hide'

describe('normalizeHideWhen（白名单归一）', () => {
  it('合法取值原样通过', () => {
    for (const v of FIELD_HIDE_VALUES) {
      expect(normalizeHideWhen(v)).toBe(v)
    }
  })

  it('缺失 / 空串 / 白名单外的脏值一律回落 never（不静默放行）', () => {
    expect(normalizeHideWhen(undefined)).toBe('never')
    expect(normalizeHideWhen(null)).toBe('never')
    expect(normalizeHideWhen('')).toBe('never')
    expect(normalizeHideWhen('bogus')).toBe('never')
    expect(normalizeHideWhen('NEVER')).toBe('never')
  })
})

describe('decodeDefaultJson（默认值 JSON 文本 → 比较用字符串）', () => {
  it('字符串 / 数值 / null / 非法 JSON 各归其位', () => {
    expect(decodeDefaultJson('"李四"')).toBe('李四')
    expect(decodeDefaultJson('8')).toBe('8')
    expect(decodeDefaultJson('null')).toBe('')
    expect(decodeDefaultJson(null)).toBe('')
    expect(decodeDefaultJson('not-json')).toBe('')
  })
})

describe('isFieldHiddenByRule（块属性展示的隐藏判定）', () => {
  const HAS = { hasValue: true, valueString: '进行中', defaultString: '' }

  it('never：永不隐藏', () => {
    expect(isFieldHiddenByRule('never', false, '', '')).toBe(false)
    expect(isFieldHiddenByRule('never', true, '进行中', '')).toBe(false)
  })

  it('always：恒隐藏（无论值有无）', () => {
    expect(isFieldHiddenByRule('always', true, '进行中', '')).toBe(true)
    expect(isFieldHiddenByRule('always', false, '', '')).toBe(true)
  })

  it('when_empty：只在未填时隐藏', () => {
    expect(isFieldHiddenByRule('when_empty', false, '', '')).toBe(true)
    expect(isFieldHiddenByRule('when_empty', true, '进行中', '')).toBe(false)
  })

  it('when_not_empty：只在已填时隐藏', () => {
    expect(isFieldHiddenByRule('when_not_empty', true, '进行中', '')).toBe(true)
    expect(isFieldHiddenByRule('when_not_empty', false, '', '')).toBe(false)
  })

  it('when_default：确有值且等于默认才隐藏', () => {
    expect(isFieldHiddenByRule('when_default', true, '低', '低')).toBe(true)
    expect(isFieldHiddenByRule('when_default', true, '高', '低')).toBe(false)
    // 没填值不算「等于默认」——否则带默认值的字段未填写时整行消失，占位提示丢失
    expect(isFieldHiddenByRule('when_default', false, '', '低')).toBe(false)
    // 无默认的定义恒不命中
    expect(isFieldHiddenByRule('when_default', true, '进行中', '')).toBe(false)
  })

  it('脏规则值归一为 never（与 Rust 同判据），不误隐藏', () => {
    expect(isFieldHiddenByRule('bogus', HAS.hasValue, HAS.valueString, HAS.defaultString)).toBe(false)
  })
})

describe('FIELD_HIDE_LABELS（下拉显示名）', () => {
  it('每个取值都有显示名，五档齐全', () => {
    expect(Object.keys(FIELD_HIDE_LABELS).sort()).toEqual([...FIELD_HIDE_VALUES].sort())
    expect(FIELD_HIDE_LABELS.never).toBe('从不')
    expect(FIELD_HIDE_LABELS.always).toBe('总是')
  })
})
