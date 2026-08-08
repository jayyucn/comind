import type { BlockCard, DateRefLite } from '../wasm/types'
import type { BlockField, BlockQuery, FilterCondition, FilterOp, SortRule } from '../types/blockQuery'

/**
 * Pure function: apply filter + sort rules to BlockCard array.
 * - All filters combined with AND
 * - Sort: chained comparison, TIE-BREAKING with block_id as last resort
 * - Default sort: updated_at desc when sort array is empty
 * - groupBy is NOT applied here (handled by view layer)
 */
export function applyQuery(cards: BlockCard[], query: BlockQuery): BlockCard[] {
  // Step 1: Filter
  let filtered = cards
  if (query.filters.length > 0) {
    filtered = cards.filter(card => {
      return query.filters.every(f => evaluateCondition(card, f))
    })
  }

  // Step 2: Sort
  const sorted = [...filtered]

  // If default sort (no user sort rules), sort by updated_at desc
  if (query.sort.length === 0) {
    sorted.sort((a, b) => b.updated_at - a.updated_at || a.block_id.localeCompare(b.block_id))
    return sorted
  }

  sorted.sort((a, b) => {
    for (const rule of query.sort) {
      const cmp = compareCards(a, b, rule)
      if (cmp !== 0) return cmp
    }
    // Final tie-breaker: block_id
    return a.block_id.localeCompare(b.block_id)
  })

  return sorted
}

/** Evaluate a single filter condition against a card */
export function evaluateCondition(card: BlockCard, filter: FilterCondition): boolean {
  const { field, op, value } = filter

  switch (op) {
    case 'hasAny':
      return fieldHasValue(card, field)
    case 'isEmpty':
      return !fieldHasValue(card, field)
    case 'is':
      return fieldMatches(card, field, value, (a, b) => a === b)
    case 'isNot':
      return !fieldMatches(card, field, value, (a, b) => a === b)
    case 'contains':
      return fieldMatches(card, field, value, (a, b) =>
        String(a).toLowerCase().includes(String(b).toLowerCase())
      )
    case 'before':
      return compareFieldTime(card, field, value) < 0
    case 'after':
      return compareFieldTime(card, field, value) > 0
    default:
      return true
  }
}

/** Check if a field has any value (non-empty/non-null) */
function fieldHasValue(card: BlockCard, field: BlockField): boolean {
  if (field.kind === 'content') {
    return card.content_preview.trim().length > 0
  }
  if (field.kind === 'property') {
    const val = card.properties[field.key]
    if (val === undefined || val === null) return false
    if (val === '') return false
    if (Array.isArray(val) && val.length === 0) return false
    return true
  }
  if (field.kind === 'dateRef') {
    if (field.ref === 'kind') return card.date_refs.length > 0
    if (field.ref === 'date') return card.date_refs.some(dr => dr.date_day.length > 0)
  }
  return false
}

/** Get field values from a card for a given field definition */
function getFieldValues(card: BlockCard, field: BlockField): any[] {
  if (field.kind === 'content') {
    return [card.content_preview]
  }
  if (field.kind === 'property') {
    const val = card.properties[field.key]
    if (val === undefined) return []
    if (Array.isArray(val)) return val
    return [val]
  }
  if (field.kind === 'dateRef') {
    if (field.ref === 'kind') return card.date_refs.map(dr => dr.kind)
    if (field.ref === 'date') return card.date_refs.map(dr => dr.date_day)
  }
  return []
}

/** Check if any field value matches the expected value using the given comparator */
function fieldMatches(
  card: BlockCard,
  field: BlockField,
  expected: any,
  comparator: (actual: any, expected: any) => boolean
): boolean {
  const values = getFieldValues(card, field)
  return values.some(v => comparator(v, expected))
}

/** Compare two cards by a sort rule. Returns negative if a < b, positive if a > b, 0 if equal. */
function compareCards(a: BlockCard, b: BlockCard, rule: SortRule): number {
  const { field, dir } = rule
  const multiplier = dir === 'desc' ? -1 : 1

  const aVals = getFieldValues(a, field)
  const bVals = getFieldValues(b, field)

  // For sorting, use the first/primary value
  const aVal = aVals.length > 0 ? aVals[0] : null
  const bVal = bVals.length > 0 ? bVals[0] : null

  // nulls always sort last regardless of sort direction
  if (aVal === null && bVal === null) return 0
  if (aVal === null) return 1
  if (bVal === null) return -1

  // Compare by type
  let cmp = 0
  if (typeof aVal === 'number' && typeof bVal === 'number') {
    cmp = aVal - bVal
  } else if (aVal instanceof Date && bVal instanceof Date) {
    cmp = aVal.getTime() - bVal.getTime()
  } else {
    cmp = String(aVal).localeCompare(String(bVal))
  }

  return cmp * multiplier
}

/** Compare time-based field value against a target value (for before/after) */
function compareFieldTime(card: BlockCard, field: BlockField, target: any): number {
  const values = getFieldValues(card, field)
  if (values.length === 0) return 0

  // Parse target as comparable value
  let targetVal: number
  if (typeof target === 'number') {
    targetVal = target
  } else if (target instanceof Date) {
    targetVal = target.getTime()
  } else {
    targetVal = new Date(String(target)).getTime()
    if (isNaN(targetVal)) return 0
  }

  // Compare first value
  const val = values[0]
  let actualVal: number
  if (typeof val === 'number') {
    actualVal = val
  } else if (val instanceof Date) {
    actualVal = val.getTime()
  } else {
    actualVal = new Date(String(val)).getTime()
    if (isNaN(actualVal)) return 0
  }

  return actualVal - targetVal
}
