import { describe, it, expect } from 'vitest'
import { SYSTEM_TAGS, getFieldTag, isSystemField } from './tag'
import { BUILT_IN_PROPERTIES, getPropertyDefinition, getAllPropertyDefinitions } from './property'

describe('SYSTEM_TAGS（系统内置 Tag 单一来源）', () => {
  it('分两个分组：#系统任务 / #系统书笔记', () => {
    expect(SYSTEM_TAGS.map((t) => t.key)).toEqual(['system-task', 'system-book-note'])
    expect(SYSTEM_TAGS.every((t) => t.isSystem === true)).toBe(true)
  })

  it('#系统任务含 status/priority/project/area', () => {
    const task = SYSTEM_TAGS.find((t) => t.key === 'system-task')!
    expect(task.fields.map((f) => f.key)).toEqual(['status', 'priority', 'project', 'area'])
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
  it('展平为 12 个内置字段', () => {
    expect(BUILT_IN_PROPERTIES.length).toBe(12)
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

  it('getAllPropertyDefinitions 返回全部 12 字段', () => {
    expect(getAllPropertyDefinitions()).toHaveLength(12)
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
