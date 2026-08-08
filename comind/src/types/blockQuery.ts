/** Field kinds that can be filtered on */
export type BlockField =
  | { kind: 'property'; key: string }
  | { kind: 'content' }
  | { kind: 'dateRef'; ref: 'kind' | 'date' }

export type FilterOp = 'is' | 'isNot' | 'before' | 'after' | 'contains' | 'hasAny' | 'isEmpty'

export interface FilterCondition {
  field: BlockField
  op: FilterOp
  value: any
}

export interface SortRule {
  field: BlockField
  dir: 'asc' | 'desc'
}

export type GroupBy = 'status' | 'priority' | 'project' | 'area' | 'dateRefDate' | null

export type ViewType = 'table' | 'board' | 'calendar'

export interface BlockQuery {
  filters: FilterCondition[]
  sort: SortRule[]
  groupBy: GroupBy
}

export interface SavedFilter {
  id: string
  name: string
  query: BlockQuery
}

export interface TaskView {
  id: string
  name: string
  query: BlockQuery
  viewType: ViewType
  groupBy: GroupBy
  isDefault: boolean
}
