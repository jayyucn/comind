export interface Block {
  id: string
  page_id: string
  parent_id: string | null
  pos: number
  content: string
  format: string
  type: string
  created_at: number
  updated_at: number
}

export interface Page {
  id: string
  block_id: string | null
  title: string
  type: 'normal' | 'journal'
  icon: string | null
  cover: string | null
  aliases: string
  file_path: string | null
  children_count: number
  word_count: number
  deleted: number
  created_at: number
  updated_at: number
}

export interface Property {
  id: string
  block_id: string
  key: string
  value: string
  type: string
  sort_order: number
  is_hidden: number
  is_deleted: number
  schema_version: number
  created_at: number
  updated_at: number
}

export interface Link {
  id: string
  source_block_id: string
  target_page_id: string
  display_text: string
  relationship_type: string | null
  created_at: number
}

export interface RelationshipType {
  id: string
  type: string
  inverse: string | null
  label: string
  inverse_label: string
  color: string
  order: number
  strength: 'strong' | 'medium' | 'weak'
  deleted: number
  builtin: number
  created_at: number
  updated_at: number
}

export interface UserTemplate {
  id: string
  name: string
  category: string
  content: string
  created_at: number
  updated_at: number
}

export interface SearchResult {
  block_id: string
  page_id: string
  title: string
  content: string
  score: number
}

export interface BlockUpdate {
  id: string
  page_id: string
  parent_id: string | null
  pos: number
  content: string
  format: string
  type: string
  created_at?: number
  updated_at?: number
}

export interface PageUpdate {
  id?: string
  title: string
  type: 'normal' | 'journal'
  icon?: string | null
  cover?: string | null
  aliases?: string[]
}

export interface BatchOperation {
  entity: 'block' | 'page' | 'link' | 'property' | 'relationship_type' | 'template'
  action: 'create' | 'update' | 'delete' | 'get'
  params: Record<string, any>
}

export interface BatchResult {
  success: boolean
  entity: string
  action: string
  id?: string
  error?: string
}