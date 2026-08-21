/**
 * 自定义单元格渲染器（Cell Renderer）契约 —— ADR-0010。
 *
 * 渲染专属（Vue 层），与无头查询引擎解耦：core/ 不 import 任何组件类型。
 * 列的自定义渲染由 `TableColumnConfig.cell`（字符串 key）声明，运行时经注入的
 * `CellRegistry` 解析为 Vue 组件；组件本身不感知 itemId / fieldKey（由 TableView 闭包注入）。
 */
import type { Component } from 'vue'
import type { FieldDescriptor } from '../../core/query'
import type { TableColumnConfig } from '../../core/view'

/** 自定义单元格组件 props 契约。
 * - item / value：同 TableView 内置 valueOf 口径（优先 field.get，缺字段回退 item[col.key]）
 * - field / col：驱动渲染的元数据（field 可能为 undefined，当列 key 无对应字段描述符时）
 * - editable：是否允许编辑交互（决定组件内部是否渲染编辑控件）
 * 组件需 emit `change(value: unknown)`，由 TableView 包成既有 cellChange 契约。
 * 内部交互元素须 `@click.stop` 防止误触发 cellClick（与内置 checkbox / select 同规则）。 */
export interface CellRendererProps<T = unknown> {
  item: T
  value: unknown
  field?: FieldDescriptor<T>
  col: TableColumnConfig
  editable: boolean
}

/** 单元格渲染器注册表：cell key → Vue 组件。 */
export type CellRegistry = Record<string, Component>
