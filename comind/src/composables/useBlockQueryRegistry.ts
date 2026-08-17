/**
 * Block 查询字段描述符注册表 —— 通用查询引擎的首个真实消费方（issue #24）。
 *
 * 把 Block 的可筛字段接入无头引擎的 {@link Registry}（entityType = 'block'）：
 * - 内置字段：status / priority（select）/ project / area（text）/ dateRefKind（multiSelect）/ dateRefDate（date）
 * - 用户自定义 property：从 blockCardStore.cards 派生非内置 property 键，运行时注册/注销，
 *   注册表 subscribe 暴露响应式订阅，FilterBuilder 自动跟随字段变化
 *
 * 与旧系统（useBlockQuery / BlockQuery / TaskFilterBar）完全解耦并存，本模块不依赖 Vue 组件。
 */
import { computed, watch } from 'vue'
import { createRegistry, type Registry, type FieldDescriptor, type FieldType, type Option } from '../core/query'
import type { BlockCard } from '../wasm/types'
import { BUILT_IN_PROPERTIES, type PropertyDefinition, type PropertyType } from '../types/property'
import { useBlockCardStore } from '../stores/blockCard'

/** 引擎命名空间：所有 Block 字段注册于此。 */
export const BLOCK_ENTITY = 'block'

/** 内置字段 key 集合，用于区分「内置」与「自定义」字段。 */
const BUILTIN_KEYS = new Set<string>([
  'status', 'priority', 'project', 'area', 'dateRefKind', 'dateRefDate',
  'content', 'page', 'done', 'deadline', 'schedule',
])

/** dateRef.kind 的合法取值（与 property.ts normalizeKind 对齐）。 */
const DATE_REF_KINDS: Option[] = [
  { id: 'schedule', label: '计划' },
  { id: 'deadline', label: '截止' },
  { id: 'ref', label: '参考' },
]

/** 优先级选项配色（上提为字段元数据，使通用表格无需写死 P0–P3 颜色；ADR-0007）。 */
const PRIORITY_COLORS: Record<string, string> = {
  Low: '#9CA3AF',
  Medium: '#3B82F6',
  High: '#F59E0B',
  Urgent: '#DC2626',
}

function asCard(item: unknown): BlockCard {
  return item as BlockCard
}

/** 注册 Block 全部内置字段描述符到注册表。 */
export function registerBlockBuiltinFields(registry: Registry): void {
  const statusDef = BUILT_IN_PROPERTIES.find((p) => p.key === 'status')
  const priorityDef = BUILT_IN_PROPERTIES.find((p) => p.key === 'priority')

  registry.register(BLOCK_ENTITY, {
    key: 'status',
    label: '状态',
    type: 'select',
    options: (statusDef?.closedValues ?? []).map((c) => ({ id: String(c.value), label: c.label })),
    get: (item) => asCard(item).properties?.['status'],
  })

  registry.register(BLOCK_ENTITY, {
    key: 'priority',
    label: '优先级',
    type: 'select',
    options: (priorityDef?.closedValues ?? []).map((c) => ({
      id: String(c.value),
      label: c.label,
      color: PRIORITY_COLORS[String(c.value)],
    })),
    get: (item) => asCard(item).properties?.['priority'],
  })

  registry.register(BLOCK_ENTITY, {
    key: 'project',
    label: '项目',
    type: 'text',
    get: (item) => asCard(item).properties?.['project'],
  })

  registry.register(BLOCK_ENTITY, {
    key: 'area',
    label: '领域',
    type: 'text',
    get: (item) => asCard(item).properties?.['area'],
  })

  // 一个 block 可有多个 date_ref，kind 取所有出现过的 kind 集合（multiSelect 语义）
  registry.register(BLOCK_ENTITY, {
    key: 'dateRefKind',
    label: '日期类型',
    type: 'multiSelect',
    options: DATE_REF_KINDS,
    get: (item) => asCard(item).date_refs?.map((dr) => dr.kind) ?? [],
  })

  // 取最早的一个 date_day 作为该 block 的代表日（用于 before/after/between/排序/分组）
  registry.register(BLOCK_ENTITY, {
    key: 'dateRefDate',
    label: '日期',
    type: 'date',
    dateBucket: 'day',
    get: (item) => {
      const refs = asCard(item).date_refs
      if (!refs || refs.length === 0) return undefined
      const days = refs.map((dr) => dr.date_day).filter((d): d is string => !!d).sort()
      return days[0]
    },
  })

  // ── 视图渲染专用字段（供通用 TableView 按字段类型渲染，组件零任务代码；ADR-0007） ──

  // 内容主文本（primary 角色：加粗省略号）
  registry.register(BLOCK_ENTITY, {
    key: 'content',
    label: '内容',
    type: 'text',
    get: (item) => asCard(item).content_preview,
  })

  // 所属页面（link 角色：导航按钮）
  registry.register(BLOCK_ENTITY, {
    key: 'page',
    label: '页面',
    type: 'text',
    get: (item) => asCard(item).page_id,
  })

  // 完成态（boolean 字段；done 角色驱动行置灰 + 可编辑勾选）
  registry.register(BLOCK_ENTITY, {
    key: 'done',
    label: '完成',
    type: 'boolean',
    get: (item) => asCard(item).properties?.['status'] === 'Done',
  })

  // 截止日（date 字段，取 date_refs 中 deadline kind；无 deadline 时回退 schedule，避免仅含计划日期的卡片在表格/看板丢失日期；overdue-date 角色：过去标红）
  registry.register(BLOCK_ENTITY, {
    key: 'deadline',
    label: '截止',
    type: 'date',
    dateBucket: 'day',
    get: (item) => {
      const refs = asCard(item).date_refs ?? []
      const ref = refs.find((dr) => dr.kind === 'deadline') ?? refs.find((dr) => dr.kind === 'schedule')
      return ref?.date_day ?? undefined
    },
  })

  // 计划日（date 字段，取 date_refs 中 schedule kind；供 CalendarView 按 dateRefKind='schedule' 入桶）
  registry.register(BLOCK_ENTITY, {
    key: 'schedule',
    label: '计划',
    type: 'date',
    dateBucket: 'day',
    get: (item) => {
      const ref = asCard(item).date_refs?.find((dr) => dr.kind === 'schedule')
      return ref?.date_day ?? undefined
    },
  })
}

/** PropertyDefinition.type → 引擎 FieldType 映射。 */
const TYPE_MAP: Record<PropertyType, FieldType> = {
  string: 'text',
  number: 'number',
  boolean: 'boolean',
  date: 'date',
  array: 'multiSelect',
  page: 'text',
}

/** 把 PropertyDefinition 转为引擎字段描述符（自定义 property 用）。 */
export function buildBlockFieldDescriptor(def: PropertyDefinition): FieldDescriptor {
  const fieldType = TYPE_MAP[def.type] ?? 'text'
  const descriptor: FieldDescriptor = {
    key: def.key,
    label: def.title,
    type: fieldType,
    get: (item) => asCard(item).properties?.[def.key],
  }
  if (def.closedValues && def.closedValues.length > 0) {
    descriptor.options = def.closedValues.map((c) => ({ id: String(c.value), label: c.label }))
  }
  return descriptor
}

/** 自定义 property 值 → 引擎类型推断（保守：数字/布尔/其余归 string，由 TYPE_MAP 映射到 text）。 */
function inferPropertyType(value: unknown): PropertyType {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'string'
}

/**
 * 按 diff 同步自定义 property 字段：defs 中新增的注册、消失的注销。
 * 只动非内置字段，内置字段不受影响。
 */
export function syncBlockCustomProperties(registry: Registry, defs: PropertyDefinition[]): void {
  const desired = new Map(defs.map((d) => [d.key, d]))

  // 注销已消失的自定义字段
  for (const field of registry.list(BLOCK_ENTITY)) {
    if (BUILTIN_KEYS.has(field.key)) continue
    if (!desired.has(field.key)) registry.unregister(BLOCK_ENTITY, field.key)
  }

  // 注册新增的自定义字段
  for (const def of defs) {
    if (BUILTIN_KEYS.has(def.key)) continue
    if (!registry.get(BLOCK_ENTITY, def.key)) {
      registry.register(BLOCK_ENTITY, buildBlockFieldDescriptor(def))
    }
  }
}

let singleton: Registry | null = null

/** 应用级单例注册表：首次调用创建并注册内置字段；测试应自行 createRegistry()。 */
export function getBlockRegistry(): Registry {
  if (!singleton) {
    singleton = createRegistry()
    registerBlockBuiltinFields(singleton)
  }
  return singleton
}

/**
 * 组合根注册 composable：
 * - 返回单例注册表与 entityType
 * - 从 blockCardStore.cards 派生非内置 property 定义，运行时注册/注销，
 *   FilterBuilder 经 registry.subscribe 自动跟随字段变化
 */
export function useBlockQueryRegistry() {
  const registry = getBlockRegistry()
  const blockCardStore = useBlockCardStore()

  const customDefs = computed<PropertyDefinition[]>(() => {
    const keys = new Map<string, PropertyType>()
    for (const card of blockCardStore.cards) {
      const props = (card.properties ?? {}) as Record<string, unknown>
      for (const [k, v] of Object.entries(props)) {
        if (BUILT_IN_PROPERTIES.some((b) => b.key === k)) continue
        if (!keys.has(k)) keys.set(k, inferPropertyType(v))
      }
    }
    return [...keys.entries()].map(([key, type]) => ({ key, title: key, type }))
  })

  watch(
    customDefs,
    (defs) => syncBlockCustomProperties(registry, defs),
    { immediate: true, deep: true },
  )

  return { registry, entityType: BLOCK_ENTITY, customDefs }
}
