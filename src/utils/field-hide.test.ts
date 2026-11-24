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
  isDefaultValue,
  isFieldHiddenByRule,
  normalizeHideWhen,
  valuesEqual,
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
  it('never：永不隐藏', () => {
    expect(isFieldHiddenByRule('never', false, null, null, 'string')).toBe(false)
    expect(isFieldHiddenByRule('never', true, '进行中', null, 'string')).toBe(false)
  })

  it('always：恒隐藏（无论值有无）', () => {
    expect(isFieldHiddenByRule('always', true, '进行中', null, 'string')).toBe(true)
    expect(isFieldHiddenByRule('always', false, null, null, 'string')).toBe(true)
  })

  it('when_empty：只在未填时隐藏', () => {
    expect(isFieldHiddenByRule('when_empty', false, null, null, 'string')).toBe(true)
    expect(isFieldHiddenByRule('when_empty', true, '进行中', null, 'string')).toBe(false)
  })

  it('when_not_empty：只在已填时隐藏', () => {
    expect(isFieldHiddenByRule('when_not_empty', true, '进行中', null, 'string')).toBe(true)
    expect(isFieldHiddenByRule('when_not_empty', false, null, null, 'string')).toBe(false)
  })

  it('when_default：确有值且等于默认才隐藏', () => {
    expect(isFieldHiddenByRule('when_default', true, '低', '"低"', 'string')).toBe(true)
    expect(isFieldHiddenByRule('when_default', true, '高', '"低"', 'string')).toBe(false)
    // 没填值不算「等于默认」——否则带默认值的字段未填写时整行消失，占位提示丢失
    expect(isFieldHiddenByRule('when_default', false, null, '"低"', 'string')).toBe(false)
    // 无默认的定义恒不命中
    expect(isFieldHiddenByRule('when_default', true, '进行中', null, 'string')).toBe(false)
  })

  it('when_unset_or_default：未填或等于默认都隐藏（只在有非默认真值时显示）', () => {
    expect(isFieldHiddenByRule('when_unset_or_default', false, null, '"低"', 'string')).toBe(true)
    expect(isFieldHiddenByRule('when_unset_or_default', true, '低', '"低"', 'string')).toBe(true)
    expect(isFieldHiddenByRule('when_unset_or_default', true, '高', '"低"', 'string')).toBe(false)
    // 无默认：退化为「未填时隐藏」，非空值照常显示
    expect(isFieldHiddenByRule('when_unset_or_default', true, '进行中', null, 'string')).toBe(false)
    expect(isFieldHiddenByRule('when_unset_or_default', false, null, null, 'string')).toBe(true)
  })

  it('脏规则值归一为 never（与 Rust 同判据），不误隐藏', () => {
    expect(isFieldHiddenByRule('bogus', true, '进行中', null, 'string')).toBe(false)
  })
})

describe('valuesEqual（类型驱动的语义比较）', () => {
  it('array / multiSelect：忽略顺序按集合比', () => {
    expect(valuesEqual(['b', 'a'], ['a', 'b'], 'array')).toBe(true)
    expect(valuesEqual(['a'], ['a', 'b'], 'array')).toBe(false)
    expect(valuesEqual(['b', 'a'], ['a', 'b'], 'multiSelect')).toBe(true)
  })

  it('number：数值比（"8.0" == 8）', () => {
    expect(valuesEqual('8.0', 8, 'number')).toBe(true)
    expect(valuesEqual(8, 9, 'number')).toBe(false)
  })

  it('boolean：布尔归一（"true" == true）', () => {
    expect(valuesEqual('true', true, 'boolean')).toBe(true)
    expect(valuesEqual('false', false, 'boolean')).toBe(true)
    expect(valuesEqual(true, false, 'boolean')).toBe(false)
  })

  it('date / datetime：解析成时间戳比（空格形与 T 形等价）', () => {
    expect(valuesEqual('2026-10-22 10:00', '2026-10-22T10:00', 'datetime')).toBe(true)
    expect(valuesEqual('2026-10-22 10:00', '2026-10-22T11:00', 'datetime')).toBe(false)
  })

  it('relation：比 targetId', () => {
    expect(valuesEqual({ targetId: 'b1' }, { targetId: 'b1' }, 'relation')).toBe(true)
    expect(valuesEqual({ targetId: 'b1' }, { targetId: 'b2' }, 'relation')).toBe(false)
  })

  it('其余类型：字符串严格比', () => {
    expect(valuesEqual('甲', '甲', 'string')).toBe(true)
    expect(valuesEqual('甲', '乙', 'string')).toBe(false)
  })
})

describe('isDefaultValue（默认值语义比较）', () => {
  it('无默认 / 非法 JSON / null 默认 → 恒 false', () => {
    expect(isDefaultValue('x', null, 'string')).toBe(false)
    expect(isDefaultValue('x', '', 'string')).toBe(false)
    expect(isDefaultValue('x', 'not-json', 'string')).toBe(false)
    expect(isDefaultValue('x', 'null', 'string')).toBe(false)
  })

  it('类型驱动比较：number 默认 8 → 值 "8.0" 命中', () => {
    expect(isDefaultValue('8.0', '8', 'number')).toBe(true)
    expect(isDefaultValue(3, '8', 'number')).toBe(false)
  })

  it('字符串默认（落库带引号）→ 解出后比', () => {
    expect(isDefaultValue('低', '"低"', 'string')).toBe(true)
    expect(isDefaultValue('高', '"低"', 'string')).toBe(false)
  })
})

describe('FIELD_HIDE_LABELS（下拉显示名）', () => {
  it('每个取值都有显示名，六档齐全', () => {
    expect(Object.keys(FIELD_HIDE_LABELS).sort()).toEqual([...FIELD_HIDE_VALUES].sort())
    expect(FIELD_HIDE_LABELS.never).toBe('从不')
    expect(FIELD_HIDE_LABELS.always).toBe('总是')
  })
})
