/**
 * 字段类型图标单源（ADR-0057 D1）：FieldType → lucide 图标组件。
 *
 * 唯一消费方是 FieldLabel 入口组件与 FieldSettingsModal 弹窗头部——两处必须
 * 同图标（用户在入口看到的类型标识与弹窗里看到的一致）。新增字段类型时往
 * 本表追加键；未知类型回落 Type（与 field-type-registry 的保守回落同风格）。
 *
 * 特化图标（FIELD_SPEC_ICONS）由 FieldSettingsModal 头部消费：选中特化后
 * 头部图标跟随特化语义（货币/评分/负责人…），未特化时回落本表类型图标。
 */
import {
  Banknote,
  Braces,
  Calendar,
  CalendarClock,
  CalendarRange,
  ExternalLink,
  FileText,
  Hash,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Mail,
  MapPin,
  Palette,
  Paperclip,
  Percent,
  Phone,
  Sigma,
  Star,
  Tags,
  ToggleLeft,
  Type,
  User,
} from 'lucide-vue-next'
import type { Component } from 'vue'

export const FIELD_TYPE_ICONS: Readonly<Record<string, Component>> = {
  string: Type,
  number: Hash,
  boolean: ToggleLeft,
  date: Calendar,
  datetime: CalendarClock,
  daterange: CalendarRange,
  select: List,
  multiSelect: ListChecks,
  array: Tags,
  page: FileText,
  file: Paperclip,
  relation: Link2,
  formula: Sigma,
  json: Braces,
  color: Palette,
  autonumber: ListOrdered,
  geo: MapPin,
}

/** 未知类型保守回落（与 field-type-registry 的 fallback 同风格）。 */
export function fieldTypeIcon(type: string): Component {
  return FIELD_TYPE_ICONS[type] ?? Type
}

/**
 * 字段特化图标（ADR-0057 ② + T6/T7/T10）：spec 首段 → lucide 图标组件。
 * 消费方是 FieldSettingsModal 弹窗头部——选中特化后头部图标跟随特化语义。
 * 未知 / 空特化由 fieldSpecIcon 返回 null，调用方回落底层类型图标。
 */
export const FIELD_SPEC_ICONS: Readonly<Record<string, Component>> = {
  // string 特化（issue T6）
  email: Mail,
  phone: Phone,
  url: ExternalLink,
  richtext: FileText,
  // number 特化（issue T7）
  currency: Banknote,
  percent: Percent,
  rating: Star,
  // page 特化（issue T10）
  person: User,
}

/** 特化首段 → 图标；无特化 / 未知特化返回 null（由调用方回落类型图标）。 */
export function fieldSpecIcon(specHead: string): Component | null {
  return FIELD_SPEC_ICONS[specHead] ?? null
}

/**
 * 展示用类型 token（ADR-0057）：`select` 是 type string + closed_values 派生的伪类型，
 * `multiSelect` 同走 closed_values；relation 的 closed_values 是关系类型配置位（issue T5），
 * 不参与派生、保持自身。图标分派与类型徽章文案共用本口径，两处不得漂移。
 */
export function displayFieldType(def: { type: string; closed_values?: string[] | null }): string {
  if (def.type === 'multiSelect') return 'multiSelect'
  if (def.type === 'relation') return 'relation'
  return def.closed_values?.length ? 'select' : def.type
}
