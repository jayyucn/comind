export type Strength = 'strong' | 'medium' | 'weak'

export interface RelationshipType {
  id: string
  type: string
  inverse: string | null
  label: string
  inverseLabel: string
  description: string | null
  color: string
  group: 'family' | 'work' | 'concept' | 'action' | 'custom'
  strength: Strength
  order: number
  deleted: boolean
  builtin: boolean
  createdAt: number
  updatedAt: number
}

export interface RelationshipTypeCreateOptions {
  id?: string
  type: string
  inverse: string | null
  label: string
  inverseLabel: string
  description?: string | null
  color?: string
  group?: 'family' | 'work' | 'concept' | 'action' | 'custom'
  strength?: Strength
  order?: number
  builtin?: boolean
}

export interface RelationshipTypeUpdateOptions {
  label?: string
  inverseLabel?: string
  description?: string | null
  color?: string
  group?: 'family' | 'work' | 'concept' | 'action' | 'custom'
  strength?: Strength
  order?: number
  deleted?: boolean
}