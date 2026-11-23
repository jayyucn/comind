import { describe, expect, it } from 'vitest'

import {
  isOrderedListItem,
  nextOrderedListIndexAfter,
  orderedListContentAtIndex,
  orderedListIndexAt,
  orderedListIndexForNewItem,
  planOrderedListNumbering,
  readOrderedListAnchor,
  withOrderedListAnchor,
  type OrderedListSibling,
} from '../ordered-list-index'

function sibling(id: string, content: string, anchor?: number | null): OrderedListSibling {
  return {
    id,
    content,
    format: anchor == null ? {} : withOrderedListAnchor({}, anchor),
  }
}

/** 只取「需要写回」的那些，形状压成 id → 序号，断言可读 */
function desiredMap(plan: ReturnType<typeof planOrderedListNumbering>) {
  return Object.fromEntries(plan.filter(e => e.desired !== null).map(e => [e.id, e.desired]))
}

function changedMap(plan: ReturnType<typeof planOrderedListNumbering>) {
  return Object.fromEntries(plan.filter(e => e.changed).map(e => [e.id, e.content]))
}

describe('readOrderedListAnchor / withOrderedListAnchor', () => {
  it('缺省与非法值一律 null', () => {
    expect(readOrderedListAnchor(undefined)).toBeNull()
    expect(readOrderedListAnchor({})).toBeNull()
    expect(readOrderedListAnchor({ olIndex: '3' })).toBeNull()
    expect(readOrderedListAnchor({ olIndex: Number.NaN })).toBeNull()
    expect(readOrderedListAnchor({ olIndex: -1 })).toBeNull()
  })

  it('写入 / 清除都是新对象，不改入参', () => {
    const source = { bold: true }
    const written = withOrderedListAnchor(source, 10)
    expect(written).toEqual({ bold: true, olIndex: 10 })
    expect(source).toEqual({ bold: true })
    expect(readOrderedListAnchor(written)).toBe(10)
    expect(withOrderedListAnchor(written, null)).toEqual({ bold: true })
  })
})

describe('planOrderedListNumbering', () => {
  it('顺排：无需改写时 changed 全为 false（零写回）', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '1. A'),
      sibling('b', '2. B'),
      sibling('c', '3. C'),
    ])
    expect(desiredMap(plan)).toEqual({ a: 1, b: 2, c: 3 })
    expect(changedMap(plan)).toEqual({})
  })

  it('删中间项后补号：1,3,4 → 1,2,3', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '1. A'),
      sibling('c', '3. C'),
      sibling('d', '4. D'),
    ])
    expect(changedMap(plan)).toEqual({ c: '2. C', d: '3. D' })
  })

  it('段首字面即起始值：存量 5,6,7 不被改写成 1,2,3', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '5. A'),
      sibling('b', '6. B'),
      sibling('c', '7. C'),
    ])
    expect(desiredMap(plan)).toEqual({ a: 5, b: 6, c: 7 })
    expect(changedMap(plan)).toEqual({})
  })

  it('段中锚点：手写跳号后后续跟着变，前面不动（允许断点 1, 10, 11）', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '1. A'),
      sibling('b', '10. B', 10),
      sibling('c', '3. C'),
      sibling('d', '4. D'),
    ])
    expect(desiredMap(plan)).toEqual({ a: 1, b: 10, c: 11, d: 12 })
    expect(changedMap(plan)).toEqual({ c: '11. C', d: '12. D' })
  })

  it('锚点与字面不一致时以锚点为准（写回对齐）', () => {
    const plan = planOrderedListNumbering([sibling('a', '2. A', 10)])
    expect(changedMap(plan)).toEqual({ a: '10. A' })
  })

  it('改小锚点同样带动后续（2 插在 5 之后）', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '4. A'),
      sibling('b', '5. B'),
      sibling('c', '6. C', 2),
      sibling('d', '7. D'),
    ])
    expect(desiredMap(plan)).toEqual({ a: 4, b: 5, c: 2, d: 3 })
  })

  it('段首锚点优先于字面（删段首后强制回 1）', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '2. A', 1),
      sibling('b', '3. B'),
    ])
    expect(changedMap(plan)).toEqual({ a: '1. A', b: '2. B' })
  })

  it('遇正文 / 标题 / 无序列表即断（各自成段，新段从字面起算）', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '1. A'),
      sibling('b', '2. B'),
      sibling('c', '普通正文'),
      sibling('d', '7. D'),
      sibling('e', '8. E'),
      sibling('h', '## 标题'),
      sibling('u', '- 无序'),
    ])
    expect(desiredMap(plan)).toEqual({ a: 1, b: 2, d: 7, e: 8 })
    expect(changedMap(plan)).toEqual({})
    expect(plan.filter(e => e.desired === null).map(e => e.id)).toEqual(['c', 'h', 'u'])
  })

  it('跨段不串号：中间夹无序列表即断段，后段以自身字面为段首（决策 3）', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '1. A'),
      sibling('u', '- 无序'),
      sibling('b', '9. B'),
      sibling('c', '10. C'),
    ])
    expect(desiredMap(plan)).toEqual({ a: 1, b: 9, c: 10 })
    expect(changedMap(plan)).toEqual({})
  })

  it('空列表项（`3. ` 只有标记）保持标记并参与编号', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '1. A'),
      sibling('b', '3. '),
    ])
    expect(changedMap(plan)).toEqual({ b: '2. ' })
    expect(plan[1].content).toBe('2. ')
  })

  it('非列表项原位返回，content 原样（不误伤正文）', () => {
    const plan = planOrderedListNumbering([sibling('a', '2.5 米 '), sibling('b', '1.5')])
    expect(plan).toEqual([
      { id: 'a', literal: null, desired: null, content: '2.5 米 ', changed: false },
      { id: 'b', literal: null, desired: null, content: '1.5', changed: false },
    ])
  })
})

describe('orderedListContentAtIndex', () => {
  it('只换序号，正文与行内标记字符一字不动', () => {
    expect(orderedListContentAtIndex('9. 前 [[页]] 后 #tag', 12)).toBe('12. 前 [[页]] 后 #tag')
    expect(orderedListContentAtIndex('- 无序', 3)).toBe('- 无序')
  })
})

describe('orderedListIndexAt / nextOrderedListIndexAfter', () => {
  const siblings = [sibling('a', '3. A'), sibling('b', '4. B'), sibling('t', '正文')]

  it('取推导值（而非字面）', () => {
    expect(orderedListIndexAt(siblings, 'a')).toBe(3)
    expect(orderedListIndexAt(siblings, 'b')).toBe(4)
    expect(orderedListIndexAt(siblings, 't')).toBeNull()
  })

  it('Enter 续行 = 推导值 + 1，非列表项从 1 起', () => {
    expect(nextOrderedListIndexAfter(siblings, 'a')).toBe(4)
    expect(nextOrderedListIndexAfter(siblings, 't')).toBe(1)
  })
})

describe('orderedListIndexForNewItem（菜单转有序列表）', () => {
  it('前面是列表 ⇒ 接上（决策 7）', () => {
    expect(orderedListIndexForNewItem(
      [sibling('a', '1. A'), sibling('b', '2. B'), sibling('x', '随便')],
      'x',
    )).toBe(3)
  })

  it('前面不是列表 ⇒ 从 1 起', () => {
    expect(orderedListIndexForNewItem([sibling('x', '随便'), sibling('y', '1. A')], 'x')).toBe(1)
    expect(orderedListIndexForNewItem([sibling('y', '1. A')], 'y')).toBe(1)
  })

  it('本块已在段内 ⇒ 取自身推导值（与写回值同源，不跳号）', () => {
    expect(orderedListIndexForNewItem(
      [sibling('a', '1. A'), sibling('b', '5. B'), sibling('c', '6. C')],
      'b',
    )).toBe(2)
  })
})

describe('isOrderedListItem', () => {
  it('只认 `N. `（小数不算）', () => {
    expect(isOrderedListItem('1. A')).toBe(true)
    expect(isOrderedListItem('1. ')).toBe(true)
    expect(isOrderedListItem('1.A')).toBe(false)
    expect(isOrderedListItem('1.5 米')).toBe(false)
    expect(isOrderedListItem('- A')).toBe(false)
    expect(isOrderedListItem('# A')).toBe(false)
  })
})
