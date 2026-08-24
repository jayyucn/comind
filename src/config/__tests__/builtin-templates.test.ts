import { describe, test, expect } from 'vitest'
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from '../builtin-templates'

describe('BUILTIN_TEMPLATES', () => {
  test('应包含 10 个模板（5 思维模型 + 5 工作）', () => {
    expect(BUILTIN_TEMPLATES.length).toBe(10)
  })

  test('所有 ID 全局唯一', () => {
    const ids = BUILTIN_TEMPLATES.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('所有 name 非空、唯一', () => {
    const names = BUILTIN_TEMPLATES.map(t => t.name)
    expect(names.every(n => n.length > 0)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
  })

  test('所有 icon 非空', () => {
    expect(BUILTIN_TEMPLATES.every(t => t.icon.length > 0)).toBe(true)
  })

  test('所有 description 非空', () => {
    expect(BUILTIN_TEMPLATES.every(t => t.description.length > 0)).toBe(true)
  })

  test('所有 blocks 非空数组', () => {
    expect(BUILTIN_TEMPLATES.every(t => Array.isArray(t.blocks) && t.blocks.length > 0)).toBe(true)
  })

  test('分类分布：5 thinking-model + 5 work/ideas/review', () => {
    const thinking = BUILTIN_TEMPLATES.filter(t => t.category === 'thinking-model')
    expect(thinking.length).toBe(5)
    const others = BUILTIN_TEMPLATES.filter(t => t.category !== 'thinking-model')
    expect(others.length).toBe(5)
  })

  test('必须包含预期 ID', () => {
    const expectedIds = [
      'second-order-thinking', 'five-whys', 'mece', 'first-principles', 'premortem',
      'meeting-notes', 'weekly-review', 'daily-ideas', 'decision-record', 'reading-notes'
    ]
    for (const id of expectedIds) {
      expect(BUILTIN_TEMPLATES.some(t => t.id === id)).toBe(true)
    }
  })
})

describe('getBuiltinTemplate', () => {
  test('按 ID 查询', () => {
    const t = getBuiltinTemplate('meeting-notes')
    expect(t).toBeDefined()
    expect(t?.name).toBe('会议记录')
  })

  test('不存在的 ID 返回 undefined', () => {
    expect(getBuiltinTemplate('non-existent')).toBeUndefined()
  })
})
