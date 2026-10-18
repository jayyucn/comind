/**
 * 字段类型图标单源（ADR-0057 D1）：FieldType → lucide 图标组件。
 *
 * 唯一消费方是 FieldLabel 入口组件与 FieldSettingsModal 弹窗头部——两处必须
 * 同图标（用户在入口看到的类型标识与弹窗里看到的一致）。新增字段类型时往
 * 本表追加键；未知类型回落 Type（与 field-type-registry 的保守回落同风格）。
 */
import {
  Braces,
  Calendar,
  CalendarClock,
  CalendarRange,
  FileText,
  Hash,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MapPin,
  Palette,
  Paperclip,
  Sigma,
  Tags,
  ToggleLeft,
  Type,
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
 * 展示用类型 token（ADR-0057）：`select` 是 type string + closed_values 派生的伪类型，
 * `multiSelect` 同走 closed_values；relation 的 closed_values 是关系类型配置位（issue T5），
 * 不参与派生、保持自身。图标分派与类型徽章文案共用本口径，两处不得漂移。
 */
export function displayFieldType(def: { type: string; closed_values?: string[] | null }): string {
  if (def.type === 'multiSelect') return 'multiSelect'
  if (def.type === 'relation') return 'relation'
  return def.closed_values?.length ? 'select' : def.type
}
