import { describe, it, expect } from 'vitest'
import { SYSTEM_TAGS, getFieldTag, isSystemField } from './tag'
import { BUILT_IN_PROPERTIES, getPropertyDefinition, getAllPropertyDefinitions } from './property'
import seedJson from './systemFieldSeed.json'

describe('SYSTEM_TAGS（系统内置 Tag 单一来源）', () => {
  it('分两个分组：#系统任务 / #系统书笔记', () => {
    expect(SYSTEM_TAGS.map((t) => t.key)).toEqual(['system-task', 'system-book-note'])
    expect(SYSTEM_TAGS.every((t) => t.isSystem === true)).toBe(true)
  })

  it('#系统任务含 status/priority', () => {
    const task = SYSTEM_TAGS.find((t) => t.key === 'system-task')!
    expect(task.fields.map((f) => f.key)).toEqual(['status', 'priority'])
  })

  it('#系统书笔记含 book/part/chapter/cfi/quote/sourceBlockId/sourcePageId/language', () => {
    const bookNote = SYSTEM_TAGS.find((t) => t.key === 'system-book-note')!
    expect(bookNote.fields.map((f) => f.key)).toEqual([
      'book', 'part', 'chapter', 'cfi', 'quote', 'sourceBlockId', 'sourcePageId', 'language',
    ])
  })

  it('系统字段不再携带 isBuiltIn（系统语义上移到 Tag.isSystem）', () => {
    for (const field of SYSTEM_TAGS.flatMap((t) => t.fields)) {
      expect('isBuiltIn' in field).toBe(false)
    }
  })
})

describe('BUILT_IN_PROPERTIES（由 SYSTEM_TAGS 展平）', () => {
  it('展平为 10 个内置字段', () => {
    expect(BUILT_IN_PROPERTIES.length).toBe(10)
  })

  it('与 SYSTEM_TAGS.flatMap 完全一致（单一来源）', () => {
    expect(BUILT_IN_PROPERTIES).toEqual(SYSTEM_TAGS.flatMap((t) => t.fields))
  })

  it('status 保留 closedValues 与 displayPosition', () => {
    const status = getPropertyDefinition('status')!
    expect(status.title).toBe('状态')
    expect(status.closedValues).toHaveLength(4)
    expect(status.displayPosition).toBe('between-bullet-content')
  })

  it('getPropertyDefinition 未命中返回 undefined', () => {
    expect(getPropertyDefinition('non-existent')).toBeUndefined()
  })

  it('getAllPropertyDefinitions 返回全部 10 字段', () => {
    expect(getAllPropertyDefinitions()).toHaveLength(10)
  })
})

describe('getFieldTag / isSystemField', () => {
  it('book 归属 #系统书笔记', () => {
    expect(getFieldTag('book')?.key).toBe('system-book-note')
  })

  it('status 归属 #系统任务', () => {
    expect(getFieldTag('status')?.key).toBe('system-task')
  })

  it('自定义字段无所属 tag', () => {
    expect(getFieldTag('custom-key')).toBeUndefined()
  })

  it('isSystemField 区分系统与自定义', () => {
    expect(isSystemField('status')).toBe(true)
    expect(isSystemField('book')).toBe(true)
    expect(isSystemField('language')).toBe(true)
    expect(isSystemField('custom-key')).toBe(false)
  })
})

describe('SYSTEM_TAGS ↔ systemFieldSeed.json（字段数据单源守卫）', () => {
  const seed = seedJson as {
    fields: { key: string; title: string; type: string }[]
    tags: { fieldIds: string[] }[]
  }
  const seedFields = seed.fields

  it('JSON 展平为 10 个字段（project/area 已主动取消）', () => {
    expect(seedFields).toHaveLength(10)
  })

  it('SYSTEM_TAGS 与 JSON 的 key 集合一致', () => {
    const sysKeys = SYSTEM_TAGS.flatMap((t) => t.fields).map((f) => f.key).sort()
    const seedKeys = seedFields.map((f) => f.key).sort()
    expect(sysKeys).toEqual(seedKeys)
  })

  it('每个字段的 title/type 与 JSON 单一来源一致（防手改 SYSTEM_TAGS）', () => {
    const sysByKey = new Map(SYSTEM_TAGS.flatMap((t) => t.fields).map((f) => [f.key, f]))
    for (const f of seedFields) {
      const sys = sysByKey.get(f.key)!
      expect(sys.title).toBe(f.title)
      expect(sys.type).toBe(f.type)
    }
  })
})
