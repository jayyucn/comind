import { describe, expect, it } from 'vitest'

import {
  isOrderedListItem,
  isTransparentForNumbering,
  nextOrderedListIndexAfter,
  orderedListContentAtIndex,
  orderedListIndexAt,
  orderedListIndexForNewItem,
  planOrderedListNumbering,
  type OrderedListSibling,
} from '../ordered-list-index'

function sibling(id: string, content: string, extra: Partial<OrderedListSibling> = {}): OrderedListSibling {
  return { id, content, format: {}, ...extra }
}

/** 透明块：非文本块（代码 / 图片 / 表格 / 查询 / embed） */
function opaque(id: string, type = 'code'): OrderedListSibling {
  return { id, content: `// ${id}`, type, format: {} }
}

/** 只取「需要写回」的那些，形状压成 id → 序号，断言可读 */
function desiredMap(plan: ReturnType<typeof planOrderedListNumbering>) {
  return Object.fromEntries(plan.filter(e => e.desired !== null).map(e => [e.id, e.desired]))
}

function changedMap(plan: ReturnType<typeof planOrderedListNumbering>) {
  return Object.fromEntries(plan.filter(e => e.changed).map(e => [e.id, e.content]))
}

describe('isTransparentForNumbering', () => {
  it('文本块不透明；非文本块透明', () => {
    expect(isTransparentForNumbering(sibling('a', '正文'))).toBe(false)
    expect(isTransparentForNumbering(sibling('a', '1. A'))).toBe(false)
    expect(isTransparentForNumbering(opaque('c', 'code'))).toBe(true)
    expect(isTransparentForNumbering(opaque('q', 'query'))).toBe(true)
    expect(isTransparentForNumbering(opaque('t', 'table'))).toBe(true)
  })

  it('高亮块透明（format.callout），脏值不算', () => {
    expect(isTransparentForNumbering(sibling('a', '注意', { format: { callout: 'warn' } }))).toBe(true)
    expect(isTransparentForNumbering(sibling('a', '注意', { format: { callout: 'nope' } }))).toBe(false)
    expect(isTransparentForNumbering(sibling('a', '注意', { format: {} }))).toBe(false)
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

  it('段首恒 1：存量 5,6,7 归一到 1,2,3', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '5. A'),
      sibling('b', '6. B'),
      sibling('c', '7. C'),
    ])
    expect(desiredMap(plan)).toEqual({ a: 1, b: 2, c: 3 })
    expect(changedMap(plan)).toEqual({ a: '1. A', b: '2. B', c: '3. C' })
  })

  it('段中跳号抹平：1,10,11 → 1,2,3', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '1. A'),
      sibling('b', '10. B'),
      sibling('c', '11. C'),
    ])
    expect(changedMap(plan)).toEqual({ b: '2. B', c: '3. C' })
  })

  it('遇正文 / 标题 / 无序列表即断（新段从 1 起算）', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '1. A'),
      sibling('b', '2. B'),
      sibling('c', '普通正文'),
      sibling('d', '7. D'),
      sibling('e', '8. E'),
      sibling('h', '## 标题'),
      sibling('u', '- 无序'),
    ])
    expect(desiredMap(plan)).toEqual({ a: 1, b: 2, d: 1, e: 2 })
    expect(changedMap(plan)).toEqual({ d: '1. D', e: '2. E' })
    expect(plan.filter(e => e.desired === null).map(e => e.id)).toEqual(['c', 'h', 'u'])
  })

  it('空文本块也算断点：新段回 1', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '1. A'),
      sibling('blank', ''),
      sibling('b', '2. B'),
    ])
    expect(desiredMap(plan)).toEqual({ a: 1, b: 1 })
    expect(changedMap(plan)).toEqual({ b: '1. B' })
  })

  it('非文本块透明：段跨过代码块/图片继续，也不占号', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '1. A'),
      opaque('code', 'code'),
      opaque('img', 'image'),
      sibling('b', '2. B'),
    ])
    expect(desiredMap(plan)).toEqual({ a: 1, b: 2 })
    expect(changedMap(plan)).toEqual({})
  })

  it('非文本块断掉之后的下半段：仍从 1 起（透明只跨块，不跨正文）', () => {
    const plan = planOrderedListNumbering([
      sibling('a', '1. A'),
      opaque('code', 'code'),
      sibling('t', '正文'),
      sibling('b', '5. B'),
    ])
    expect(changedMap(plan)).toEqual({ b: '1. B' })
  })

  it('高亮块透明：不打断段、不占号，其字面原样保留', () => {
    const callout = sibling('n', '3. 注意这里', { format: { callout: 'warn' } })
    const plan = planOrderedListNumbering([
      sibling('a', '1. A'),
      callout,
      sibling('b', '5. B'),
    ])
    expect(desiredMap(plan)).toEqual({ a: 1, b: 2 })
    expect(plan[1]).toEqual({ id: 'n', literal: null, desired: null, content: '3. 注意这里', changed: false })
    expect(changedMap(plan)).toEqual({ b: '2. B' })
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
    expect(orderedListIndexAt(siblings, 'a')).toBe(1)
    expect(orderedListIndexAt(siblings, 'b')).toBe(2)
    expect(orderedListIndexAt(siblings, 't')).toBeNull()
  })

  it('Enter 续行 = 推导值 + 1，非列表项从 1 起', () => {
    expect(nextOrderedListIndexAfter(siblings, 'a')).toBe(2)
    expect(nextOrderedListIndexAfter(siblings, 'b')).toBe(3)
    expect(nextOrderedListIndexAfter(siblings, 't')).toBe(1)
  })
})

describe('orderedListIndexForNewItem（菜单转有序列表）', () => {
  it('前面是列表 ⇒ 接上', () => {
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

  it('前面只有透明块 ⇒ 跨过去接更前面的段', () => {
    expect(orderedListIndexForNewItem(
      [sibling('a', '1. A'), opaque('code', 'code'), sibling('x', '随便')],
      'x',
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
