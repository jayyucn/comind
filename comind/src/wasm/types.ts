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
  type: 'normal' | 'ideas'
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

export interface DateRefRecord {
  id: string
  block_id: string
  kind: string
  iso: string
  date_day: string
  recurrence: string
  lead_minutes: number
  event_ts: number
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

export interface BlockSaveResult {
  block: Block
  snapshot: string
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
  type: 'normal' | 'ideas'
  icon?: string | null
  cover?: string | null
  aliases?: string[]
}

export interface BatchOperation {
  entity: 'block' | 'page' | 'link' | 'property' | 'relationship_type' | 'template'
  action: 'create' | 'update' | 'delete' | 'get' | 'sync_by_block'
  params: Record<string, any>
}

export interface BatchResult {
  success: boolean
  entity: string
  action: string
  id?: string
  error?: string
}

export interface ExportResult {
  pages_exported: number
  blocks_exported: number
  properties_exported: number
  relationship_types_exported: number
  templates_exported: number
  directory: string
}

export interface ImportResult {
  pages_imported: number
  blocks_imported: number
  properties_imported: number
  links_created: number
  relationship_types_imported: number
  templates_imported: number
  strategy: string
}

export interface SyncConfig {
  sync_enabled: boolean
  sync_interval_secs: number
}

export interface BlockVersion {
  id: string
  block_id: string
  snapshot: string
  hash: string
  version: number
  source: string
  message: string | null
  restored_from_version_id: string | null
  created_at: number
}

export interface Notification {
  id: string
  block_id: string
  page_id: string
  /** 'schedule' | 'deadline' | 'overdue' */
  kind: string
  /** 触发此通知的事件 ISO（date-ref 中的 iso） */
  event_iso: string
  /** 实际触发时间戳（ms） */
  fired_at: number
  /** 'pending' | 'unread' | 'read' | 'dismissed' */
  status: string
  /** 非 null 表示 snooze 中 */
  snooze_until: number | null
  /** JSON 序列化的 NotificationPayload */
  payload: string
  created_at: number
  updated_at: number
}

export interface NotificationSettings {
  enabled: boolean
  schedule_enabled: boolean
  deadline_enabled: boolean
  overdue_enabled: boolean
  /** "22:00" 或 null */
  quiet_hours_start: string | null
  /** "08:00" 或 null */
  quiet_hours_end: string | null
  /** Web 浏览器通知授权状态（仅 Web 用） */
  web_browser_notifications_enabled: boolean
}

export interface DateRefLite {
  kind: string          // "deadline" | "schedule"
  iso: string
  date_day: string      // YYYY-MM-DD
  recurrence: string
  event_ts: number
}

export interface BlockCard {
  block_id: string
  page_id: string
  parent_id: string
  content_preview: string
  properties: Record<string, any>   // HashMap<String, Value> → Record
  date_refs: DateRefLite[]
  updated_at: number
}

export interface SavedFilterRust {
  id: string
  name: string
  query_json: string
  created_at: number
  updated_at: number
}

export interface TaskViewRust {
  id: string
  name: string
  query_json: string
  view_type: string
  group_by: string
  is_default: number
  sort_order: number
  created_at: number
  updated_at: number
}

/** 未完成任务：block 数据 + page_title + page_type */
export interface IncompleteTask {
  id: string
  page_id: string
  parent_id: string | null
  pos: number
  content: string
  format: string
  type: string
  created_at: number
  updated_at: number
  version: number
  deleted_at: number | null
  page_title: string
  page_type: string
}

// ─── S10: Render segments (get_page_with_blocks response) ───

export interface PageWithBlocks {
  page: Page
  blocks: BlockRenderData[]
}

export interface BlockRenderData {
  block: Block
  children: string[]
  render_segments: RenderSegment[]
}

export type RenderSegment =
  | { type: 'text'; start: number; end: number }
  | { type: 'link'; start: number; end: number; target_page_title: string; display_text: string }
  | { type: 'typed_link'; start: number; end: number; target_page_title: string; display_text: string; relationship_type: string; rel_label: string; rel_color: string }
  | { type: 'external_link'; start: number; end: number; url: string }
  | { type: 'date_ref'; start: number; end: number; kind: string; iso: string; recurrence: string; lead_minutes: number; is_overdue: boolean }