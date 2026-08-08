import { describe, it, expect } from 'vitest'
import type { BlockCard, DateRefLite } from '../../wasm/types'
import type { BlockField, FilterCondition, SortRule, BlockQuery } from '../../types/blockQuery'
import { applyQuery, evaluateCondition } from '../useBlockQuery'

// --- Helpers ---

function makeCard(overrides: Partial<BlockCard> = {}): BlockCard {
  return {
    block_id: 'block-1',
    page_id: 'page-1',
    parent_id: 'page-1',
    content_preview: 'Test content',
    properties: {},
    date_refs: [],
    updated_at: 1000,
    ...overrides,
  }
}

function makeDateRef(overrides: Partial<DateRefLite> = {}): DateRefLite {
  return {
    kind: 'deadline',
    iso: '2026-08-01T00:00:00',
    date_day: '2026-08-01',
    recurrence: 'none',
    event_ts: 1756598400000,
    ...overrides,
  }
}

function field(kind: BlockField['kind'], keyOrRef?: string): BlockField {
  if (kind === 'property') return { kind, key: keyOrRef || 'status' }
  if (kind === 'dateRef') return { kind, ref: (keyOrRef || 'kind') as 'kind' | 'date' }
  return { kind: 'content' }
}

function cond(field: BlockField, op: FilterCondition['op'], value: any): FilterCondition {
  return { field, op, value }
}

function query(filters: FilterCondition[] = [], sort: SortRule[] = []): BlockQuery {
  return { filters, sort, groupBy: null }
}

function srule(field: BlockField, dir: 'asc' | 'desc' = 'asc'): SortRule {
  return { field, dir }
}

// ============================================================
// evaluateCondition – isolated condition tests
// ============================================================

describe('evaluateCondition', () => {
  // --- is ---

  it('is: property match', () => {
    const card = makeCard({ properties: { status: 'done' } })
    const c = cond(field('property', 'status'), 'is', 'done')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('is: property no-match', () => {
    const card = makeCard({ properties: { status: 'todo' } })
    const c = cond(field('property', 'status'), 'is', 'done')
    expect(evaluateCondition(card, c)).toBe(false)
  })

  it('is: content match', () => {
    const card = makeCard({ content_preview: 'Hello world' })
    const c = cond(field('content'), 'is', 'Hello world')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('is: dateRef.kind match', () => {
    const card = makeCard({ date_refs: [makeDateRef({ kind: 'deadline' })] })
    const c = cond(field('dateRef', 'kind'), 'is', 'deadline')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('is: dateRef.kind no-match', () => {
    const card = makeCard({ date_refs: [makeDateRef({ kind: 'deadline' })] })
    const c = cond(field('dateRef', 'kind'), 'is', 'schedule')
    expect(evaluateCondition(card, c)).toBe(false)
  })

  it('is: property array contains value', () => {
    const card = makeCard({ properties: { tags: ['urgent', 'important'] } })
    const c = cond(field('property', 'tags'), 'is', 'urgent')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  // --- isNot ---

  it('isNot: property no-match passes', () => {
    const card = makeCard({ properties: { status: 'todo' } })
    const c = cond(field('property', 'status'), 'isNot', 'done')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('isNot: property match fails', () => {
    const card = makeCard({ properties: { status: 'done' } })
    const c = cond(field('property', 'status'), 'isNot', 'done')
    expect(evaluateCondition(card, c)).toBe(false)
  })

  it('isNot: content does not match', () => {
    const card = makeCard({ content_preview: 'Hello world' })
    const c = cond(field('content'), 'isNot', 'goodbye')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  // --- contains ---

  it('contains: content substring match (case-insensitive)', () => {
    const card = makeCard({ content_preview: 'The Quick Brown Fox' })
    const c = cond(field('content'), 'contains', 'quick')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('contains: content no-match', () => {
    const card = makeCard({ content_preview: 'Hello world' })
    const c = cond(field('content'), 'contains', 'xyz')
    expect(evaluateCondition(card, c)).toBe(false)
  })

  it('contains: property string contains', () => {
    const card = makeCard({ properties: { title: 'Project Alpha' } })
    const c = cond(field('property', 'title'), 'contains', 'alpha')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('contains: property array element contains', () => {
    const card = makeCard({ properties: { tags: ['frontend', 'backend'] } })
    const c = cond(field('property', 'tags'), 'contains', 'front')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  // --- before ---

  it('before: dateRef.date before target', () => {
    const card = makeCard({ date_refs: [makeDateRef({ date_day: '2026-07-01' })] })
    const c = cond(field('dateRef', 'date'), 'before', '2026-08-01')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('before: dateRef.date equal (fails)', () => {
    const card = makeCard({ date_refs: [makeDateRef({ date_day: '2026-08-01' })] })
    const c = cond(field('dateRef', 'date'), 'before', '2026-08-01')
    expect(evaluateCondition(card, c)).toBe(false)
  })

  it('before: dateRef.date after (fails)', () => {
    const card = makeCard({ date_refs: [makeDateRef({ date_day: '2026-09-01' })] })
    const c = cond(field('dateRef', 'date'), 'before', '2026-08-01')
    expect(evaluateCondition(card, c)).toBe(false)
  })

  // --- after ---

  it('after: dateRef.date after target', () => {
    const card = makeCard({ date_refs: [makeDateRef({ date_day: '2026-09-01' })] })
    const c = cond(field('dateRef', 'date'), 'after', '2026-08-01')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('after: dateRef.date equal (fails)', () => {
    const card = makeCard({ date_refs: [makeDateRef({ date_day: '2026-08-01' })] })
    const c = cond(field('dateRef', 'date'), 'after', '2026-08-01')
    expect(evaluateCondition(card, c)).toBe(false)
  })

  it('after: dateRef.date before (fails)', () => {
    const card = makeCard({ date_refs: [makeDateRef({ date_day: '2026-07-01' })] })
    const c = cond(field('dateRef', 'date'), 'after', '2026-08-01')
    expect(evaluateCondition(card, c)).toBe(false)
  })

  // --- hasAny ---

  it('hasAny: property exists', () => {
    const card = makeCard({ properties: { status: 'todo' } })
    const c = cond(field('property', 'status'), 'hasAny', null)
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('hasAny: content non-empty', () => {
    const card = makeCard({ content_preview: 'Something here' })
    const c = cond(field('content'), 'hasAny', null)
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('hasAny: dateRef.kind exists', () => {
    const card = makeCard({ date_refs: [makeDateRef({ kind: 'schedule' })] })
    const c = cond(field('dateRef', 'kind'), 'hasAny', null)
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('hasAny: missing property', () => {
    const card = makeCard({ properties: {} })
    const c = cond(field('property', 'priority'), 'hasAny', null)
    expect(evaluateCondition(card, c)).toBe(false)
  })

  it('hasAny: empty property array', () => {
    const card = makeCard({ properties: { tags: [] } })
    const c = cond(field('property', 'tags'), 'hasAny', null)
    expect(evaluateCondition(card, c)).toBe(false)
  })

  it('hasAny: dateRef.date present', () => {
    const card = makeCard({ date_refs: [makeDateRef({ date_day: '2026-08-01' })] })
    const c = cond(field('dateRef', 'date'), 'hasAny', null)
    expect(evaluateCondition(card, c)).toBe(true)
  })

  // --- isEmpty ---

  it('isEmpty: missing property', () => {
    const card = makeCard({ properties: {} })
    const c = cond(field('property', 'priority'), 'isEmpty', null)
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('isEmpty: empty content', () => {
    const card = makeCard({ content_preview: '   ' })
    const c = cond(field('content'), 'isEmpty', null)
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('isEmpty: missing dateRef', () => {
    const card = makeCard({ date_refs: [] })
    const c = cond(field('dateRef', 'kind'), 'isEmpty', null)
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('isEmpty: non-empty property returns false', () => {
    const card = makeCard({ properties: { status: 'todo' } })
    const c = cond(field('property', 'status'), 'isEmpty', null)
    expect(evaluateCondition(card, c)).toBe(false)
  })

  it('isEmpty: dateRef with empty date_day', () => {
    const card = makeCard({ date_refs: [makeDateRef({ date_day: '' })] })
    const c = cond(field('dateRef', 'date'), 'isEmpty', null)
    // date_refs.some(dr => dr.date_day.length > 0) → false → fieldHasValue returns false → isEmpty is true
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('isEmpty: null property value', () => {
    const card = makeCard({ properties: { status: null } })
    const c = cond(field('property', 'status'), 'isEmpty', null)
    expect(evaluateCondition(card, c)).toBe(true)
  })
})

// ============================================================
// applyQuery – filter tests
// ============================================================

describe('applyQuery – filters', () => {
  it('empty filters returns all cards', () => {
    const cards = [
      makeCard({ block_id: 'a' }),
      makeCard({ block_id: 'b' }),
    ]
    const result = applyQuery(cards, query([]))
    expect(result).toHaveLength(2)
  })

  it('multi-filter AND: both pass → card included', () => {
    const card = makeCard({
      block_id: 'a',
      properties: { status: 'todo', priority: 'high' },
    })
    const q = query([
      cond(field('property', 'status'), 'is', 'todo'),
      cond(field('property', 'priority'), 'is', 'high'),
    ])
    const result = applyQuery([card], q)
    expect(result).toHaveLength(1)
  })

  it('multi-filter AND: one passes, one fails → card excluded', () => {
    const card = makeCard({
      block_id: 'a',
      properties: { status: 'todo', priority: 'low' },
    })
    const q = query([
      cond(field('property', 'status'), 'is', 'todo'),
      cond(field('property', 'priority'), 'is', 'high'),
    ])
    const result = applyQuery([card], q)
    expect(result).toHaveLength(0)
  })

  it('filters out cards that do not match single condition', () => {
    const cards = [
      makeCard({ block_id: 'a', properties: { status: 'done' } }),
      makeCard({ block_id: 'b', properties: { status: 'todo' } }),
      makeCard({ block_id: 'c', properties: { status: 'done' } }),
    ]
    const q = query([cond(field('property', 'status'), 'is', 'done')])
    const result = applyQuery(cards, q)
    expect(result.map(c => c.block_id)).toEqual(['a', 'c'])
  })
})

// ============================================================
// applyQuery – sort tests
// ============================================================

describe('applyQuery – sort', () => {
  it('default sort: updated_at desc when no sort rules', () => {
    const cards = [
      makeCard({ block_id: 'a', updated_at: 1000 }),
      makeCard({ block_id: 'b', updated_at: 3000 }),
      makeCard({ block_id: 'c', updated_at: 2000 }),
    ]
    const result = applyQuery(cards, query([]))
    expect(result.map(c => c.block_id)).toEqual(['b', 'c', 'a'])
  })

  it('default sort: tie-breaking by block_id when updated_at equal', () => {
    const cards = [
      makeCard({ block_id: 'z', updated_at: 1000 }),
      makeCard({ block_id: 'a', updated_at: 1000 }),
      makeCard({ block_id: 'm', updated_at: 1000 }),
    ]
    const result = applyQuery(cards, query([]))
    expect(result.map(c => c.block_id)).toEqual(['a', 'm', 'z'])
  })

  it('single sort asc by property', () => {
    const cards = [
      makeCard({ block_id: 'a', properties: { priority: 'C' } }),
      makeCard({ block_id: 'b', properties: { priority: 'A' } }),
      makeCard({ block_id: 'c', properties: { priority: 'B' } }),
    ]
    const q = query([], [srule(field('property', 'priority'), 'asc')])
    const result = applyQuery(cards, q)
    expect(result.map(c => c.properties.priority)).toEqual(['A', 'B', 'C'])
  })

  it('single sort desc by property', () => {
    const cards = [
      makeCard({ block_id: 'a', properties: { priority: 'A' } }),
      makeCard({ block_id: 'b', properties: { priority: 'C' } }),
      makeCard({ block_id: 'c', properties: { priority: 'B' } }),
    ]
    const q = query([], [srule(field('property', 'priority'), 'desc')])
    const result = applyQuery(cards, q)
    expect(result.map(c => c.properties.priority)).toEqual(['C', 'B', 'A'])
  })

  it('multi-sort chaining: second field used when first equal', () => {
    const cards = [
      makeCard({ block_id: 'a', properties: { status: 'done', priority: 'B' } }),
      makeCard({ block_id: 'b', properties: { status: 'todo', priority: 'A' } }),
      makeCard({ block_id: 'c', properties: { status: 'done', priority: 'A' } }),
    ]
    const q = query([], [
      srule(field('property', 'status'), 'asc'),
      srule(field('property', 'priority'), 'asc'),
    ])
    const result = applyQuery(cards, q)
    // done/A, done/B, todo/A
    expect(result.map(c => c.block_id)).toEqual(['c', 'a', 'b'])
  })

  it('null values sort last in asc', () => {
    const cards = [
      makeCard({ block_id: 'a', properties: {} }),
      makeCard({ block_id: 'b', properties: { priority: 'A' } }),
      makeCard({ block_id: 'c', properties: { priority: 'B' } }),
    ]
    const q = query([], [srule(field('property', 'priority'), 'asc')])
    const result = applyQuery(cards, q)
    expect(result.map(c => c.block_id)).toEqual(['b', 'c', 'a'])
  })

  it('null values sort last in desc', () => {
    const cards = [
      makeCard({ block_id: 'a', properties: {} }),
      makeCard({ block_id: 'b', properties: { priority: 'A' } }),
      makeCard({ block_id: 'c', properties: { priority: 'B' } }),
    ]
    const q = query([], [srule(field('property', 'priority'), 'desc')])
    const result = applyQuery(cards, q)
    expect(result.map(c => c.block_id)).toEqual(['c', 'b', 'a'])
  })

  it('tie-breaking by block_id after all sort rules exhausted', () => {
    const cards = [
      makeCard({ block_id: 'z', properties: { status: 'done' } }),
      makeCard({ block_id: 'a', properties: { status: 'done' } }),
      makeCard({ block_id: 'm', properties: { status: 'done' } }),
    ]
    const q = query([], [srule(field('property', 'status'), 'asc')])
    const result = applyQuery(cards, q)
    expect(result.map(c => c.block_id)).toEqual(['a', 'm', 'z'])
  })

  it('sort by dateRef.date asc', () => {
    const cards = [
      makeCard({ block_id: 'a', date_refs: [makeDateRef({ date_day: '2026-08-03' })] }),
      makeCard({ block_id: 'b', date_refs: [makeDateRef({ date_day: '2026-08-01' })] }),
      makeCard({ block_id: 'c', date_refs: [makeDateRef({ date_day: '2026-08-02' })] }),
    ]
    const q = query([], [srule(field('dateRef', 'date'), 'asc')])
    const result = applyQuery(cards, q)
    expect(result.map(c => c.block_id)).toEqual(['b', 'c', 'a'])
  })

  it('sort by dateRef.kind', () => {
    const cards = [
      makeCard({ block_id: 'a', date_refs: [makeDateRef({ kind: 'schedule' })] }),
      makeCard({ block_id: 'b', date_refs: [makeDateRef({ kind: 'deadline' })] }),
    ]
    const q = query([], [srule(field('dateRef', 'kind'), 'asc')])
    const result = applyQuery(cards, q)
    // 'deadline' < 'schedule' lexicographically
    expect(result.map(c => c.block_id)).toEqual(['b', 'a'])
  })
})

// ============================================================
// applyQuery – edge cases
// ============================================================

describe('applyQuery – edge cases', () => {
  it('empty cards array returns empty', () => {
    const result = applyQuery([], query([]))
    expect(result).toEqual([])
  })

  it('card with no properties and no date_refs is handled safely', () => {
    const card = makeCard({ properties: {}, date_refs: [] })
    const q = query([
      cond(field('property', 'status'), 'hasAny', null),
    ])
    const result = applyQuery([card], q)
    expect(result).toHaveLength(0)
  })

  it('card with no properties passes isEmpty filter', () => {
    const card = makeCard({ properties: {}, date_refs: [] })
    const q = query([
      cond(field('property', 'status'), 'isEmpty', null),
    ])
    const result = applyQuery([card], q)
    expect(result).toHaveLength(1)
  })

  it('multiple date_refs: any match satisfies the condition', () => {
    const card = makeCard({
      date_refs: [
        makeDateRef({ kind: 'schedule', date_day: '2026-08-01' }),
        makeDateRef({ kind: 'deadline', date_day: '2026-09-01' }),
      ],
    })
    const c = cond(field('dateRef', 'kind'), 'is', 'deadline')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('multiple date_refs: before checks first value', () => {
    // first date_ref is schedule 2026-08-01, before 2026-09-01 → true
    const card = makeCard({
      date_refs: [
        makeDateRef({ kind: 'schedule', date_day: '2026-08-01' }),
        makeDateRef({ kind: 'deadline', date_day: '2026-10-01' }),
      ],
    })
    const c = cond(field('dateRef', 'date'), 'before', '2026-09-01')
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('filter then sort: both applied in order', () => {
    const cards = [
      makeCard({ block_id: 'a', properties: { status: 'todo', priority: 'C' } }),
      makeCard({ block_id: 'b', properties: { status: 'done', priority: 'A' } }),
      makeCard({ block_id: 'c', properties: { status: 'todo', priority: 'A' } }),
      makeCard({ block_id: 'd', properties: { status: 'done', priority: 'B' } }),
    ]
    const q = query(
      [cond(field('property', 'status'), 'is', 'todo')],
      [srule(field('property', 'priority'), 'asc')],
    )
    const result = applyQuery(cards, q)
    // Only 'a' (C) and 'c' (A), sorted by priority asc → c, a
    expect(result.map(c => c.block_id)).toEqual(['c', 'a'])
  })

  it('original cards array is not mutated', () => {
    const cards = [
      makeCard({ block_id: 'a', updated_at: 1000 }),
      makeCard({ block_id: 'b', updated_at: 3000 }),
    ]
    const original = [...cards]
    applyQuery(cards, query([], [srule(field('content'), 'asc')]))
    expect(cards).toEqual(original)
  })

  it('default sort preserves filter results', () => {
    const cards = [
      makeCard({ block_id: 'a', properties: { status: 'done' }, updated_at: 1000 }),
      makeCard({ block_id: 'b', properties: { status: 'todo' }, updated_at: 3000 }),
      makeCard({ block_id: 'c', properties: { status: 'done' }, updated_at: 2000 }),
    ]
    const q = query([cond(field('property', 'status'), 'is', 'done')])
    const result = applyQuery(cards, q)
    expect(result.map(c => c.block_id)).toEqual(['c', 'a'])
  })

  it('before/after with numeric timestamp values', () => {
    // Use date strings consistent with the makDateRef default (date_day: '2026-08-01')
    // 1756512000000 = 2026-07-31 in some timezone; 1756684800000 = 2026-08-02
    // The date_day '2026-08-01' gets parsed as a Date by the function
    const card = makeCard({
      date_refs: [makeDateRef({ date_day: '2026-08-01' })],
    })
    // '2026-08-01' parsed as date should be < '2026-08-15' string
    expect(evaluateCondition(card, cond(field('dateRef', 'date'), 'before', '2026-08-15'))).toBe(true)
    expect(evaluateCondition(card, cond(field('dateRef', 'date'), 'after', '2026-07-15'))).toBe(true)
  })

  it('before/after with Date object values', () => {
    const card = makeCard({
      date_refs: [makeDateRef({ date_day: '2026-06-01' })],
    })
    expect(evaluateCondition(card, cond(field('dateRef', 'date'), 'before', new Date('2026-08-01')))).toBe(true)
  })

  it('before: no date_refs returns false (0 not less than 0)', () => {
    const card = makeCard({ date_refs: [] })
    // compareFieldTime returns 0 when no values, so before (< 0) fails
    expect(evaluateCondition(card, cond(field('dateRef', 'date'), 'before', '2026-08-01'))).toBe(false)
  })

  it('unknown op returns true (passthrough)', () => {
    const card = makeCard()
    const c = { field: field('content'), op: 'unknown' as any, value: 'x' }
    expect(evaluateCondition(card, c)).toBe(true)
  })

  it('hasAny: property with empty string value', () => {
    const card = makeCard({ properties: { status: '' } })
    const c = cond(field('property', 'status'), 'hasAny', null)
    expect(evaluateCondition(card, c)).toBe(false)
  })

  it('isEmpty: property with whitespace-only string (not empty)', () => {
    const card = makeCard({ properties: { status: '   ' } })
    // whitespace-only is still a non-empty string, so fieldHasValue returns true
    const c = cond(field('property', 'status'), 'isEmpty', null)
    expect(evaluateCondition(card, c)).toBe(false)
  })

  it('hasAny: content with only whitespace is empty', () => {
    const card = makeCard({ content_preview: '   ' })
    // content_preview.trim().length === 0 → fieldHasValue returns false
    const c = cond(field('content'), 'hasAny', null)
    expect(evaluateCondition(card, c)).toBe(false)
  })
})
