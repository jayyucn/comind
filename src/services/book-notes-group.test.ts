// groupBookNotesByChapter 纯函数单测（B 方案：书 Page 笔记按章/节投影大纲）。
import { describe, expect, it } from 'vitest'
import { groupBookNotesByChapter, type BookNoteMeta } from './book-notes-group'

function note(blockId: string, part: string, chapter: string, cfi: string | null = `cfi-${blockId}`): BookNoteMeta {
  return { blockId, part, chapter, cfi }
}

describe('groupBookNotesByChapter', () => {
  it('空输入返回空数组', () => {
    expect(groupBookNotesByChapter([])).toEqual([])
  })

  it('单层（无 part）：每章独立成组，保持流序，无二级', () => {
    const groups = groupBookNotesByChapter([
      note('a', '', '第一章'),
      note('b', '', '第二章'),
      note('c', '', '第一章'),
    ])
    expect(groups.map(g => g.title)).toEqual(['第一章', '第二章'])
    expect(groups[0].count).toBe(2)
    expect(groups[0].first).toEqual({ blockId: 'a', cfi: 'cfi-a' })
    expect(groups[0].sections).toEqual([])
    expect(groups[1].count).toBe(1)
    expect(groups[1].first.blockId).toBe('b')
  })

  it('双层（有 part）：同章多节归一章，章 count 汇总各节', () => {
    const groups = groupBookNotesByChapter([
      note('a', '第一部', '1.1'),
      note('b', '第一部', '1.2'),
      note('c', '第一部', '1.1'),
      note('d', '第二部', '2.1'),
    ])
    expect(groups.map(g => g.title)).toEqual(['第一部', '第二部'])

    const ch1 = groups[0]
    expect(ch1.count).toBe(3)
    // 章 first = 流中最早笔记
    expect(ch1.first.blockId).toBe('a')
    expect(ch1.sections.map(s => s.title)).toEqual(['1.1', '1.2'])
    expect(ch1.sections[0].count).toBe(2)
    expect(ch1.sections[0].first.blockId).toBe('a')
    expect(ch1.sections[1].count).toBe(1)
    expect(ch1.sections[1].first.blockId).toBe('b')

    const ch2 = groups[1]
    expect(ch2.count).toBe(1)
    expect(ch2.sections.map(s => s.title)).toEqual(['2.1'])
  })

  it('part 与 chapter 均空的笔记被丢弃', () => {
    const groups = groupBookNotesByChapter([
      note('a', '', '第一章'),
      note('orphan', '', ''),
      note('b', '第一部', '1.1'),
    ])
    expect(groups.map(g => g.title)).toEqual(['第一章', '第一部'])
    expect(groups.flatMap(g => [g, ...g.sections]).length).toBeGreaterThan(0)
  })

  it('cfi 为空不阻断分组（锚点 cfi 为 null）', () => {
    const groups = groupBookNotesByChapter([note('a', '第一部', '1.1', null)])
    expect(groups[0].first.cfi).toBeNull()
    expect(groups[0].sections[0].first.cfi).toBeNull()
  })

  it('首现分组的锚点是组内第一条笔记，重复归属不重复建组', () => {
    const groups = groupBookNotesByChapter([
      note('a', '第三部', '3.2'),
      note('b', '第一部', '1.1'),
      note('c', '第三部', '3.1'),
    ])
    expect(groups.map(g => g.title)).toEqual(['第三部', '第一部'])
    // 第三部先出现在 a（3.2），first 锚定 a 而非 c
    expect(groups[0].first.blockId).toBe('a')
    expect(groups[0].sections.map(s => s.title)).toEqual(['3.2', '3.1'])
  })
})
