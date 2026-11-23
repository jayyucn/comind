/**
 * 高亮块（段落级视觉强调）：`format.callout`，一条字段、四个值。
 *
 * 与标题 / 列表不同源：标题与列表活在**正文前缀里**（`parseParagraphStyle`），
 * 高亮活在 `format` 里。因此它不会进 `content_preview`、不进导出文本、不影响
 * `renderSegments` 偏移 —— 代价是它与段落样式必须**互斥**（一个块只有一种样式声明），
 * 互斥的执行落在 `Block/index.vue` 的两个入口函数里。
 *
 * 不进查询体系：查询引擎只读 `FieldValue` 表并投影成 `BlockCard.properties`，
 * `BlockCard` 既无 `format` 也无 `type`，所以高亮在查询块 / 看板 / 卡片里不可见。
 */

import { AlertTriangle, Ban, CircleCheck, Info } from 'lucide-vue-next'
import type { Component } from 'vue'

/** 四种语义。顺序即菜单里的呈现顺序（提示 → 注意 → 完成 → 禁止） */
export const CALLOUT_TONES = ['info', 'warn', 'success', 'danger'] as const

export type CalloutTone = (typeof CALLOUT_TONES)[number]

/** 菜单点「高亮」时的默认语义：警示是最高频的强调场景 */
export const DEFAULT_CALLOUT_TONE: CalloutTone = 'warn'

/** 文案单源：菜单、图标 tooltip、投影面（若有）都读这一份 */
export const CALLOUT_TONE_LABELS: Record<CalloutTone, string> = {
  info: '提示',
  warn: '注意',
  success: '完成',
  danger: '禁止',
}

/**
 * 字形单源：语义与图标**一一固定**，不开放自定义。
 *
 * 开放换图标会让同一种语义出现四种样子，之后任何按语义扫视（或聚合）都不成立；
 * 语义的辨识成本必须由「固定的形状」承担，颜色只是辅助（暗色四色仍可分，但形状更快）。
 * 读方三处：入口胶囊字形、块内可点的语义图标、切换语义浮层的四个选项 —— 同一份映射，
 * 避免「选的图标」与「显示出来的图标」对不上。
 */
export const CALLOUT_TONE_ICONS: Record<CalloutTone, Component> = {
  info: Info,
  warn: AlertTriangle,
  success: CircleCheck,
  danger: Ban,
}

export function isCalloutTone(value: unknown): value is CalloutTone {
  return typeof value === 'string' && (CALLOUT_TONES as readonly string[]).includes(value)
}

/**
 * 从 `format` 读出语义。
 *
 * 缺省、历史脏值、被批量改写成别的东西 —— 一律 `null`（当作没有高亮），
 * 不兜底成默认色：凭空给一个块上色比什么都不显示更糟。
 */
export function calloutToneOf(
  format: Record<string, unknown> | null | undefined,
): CalloutTone | null {
  const raw = format?.callout
  return isCalloutTone(raw) ? raw : null
}

/**
 * 写入用的 patch：`null` 表示移除。
 *
 * `updateBlockFormat` 是浅合并（`{...block.format, ...patch}`），把键置 `undefined`
 * 后 JSON 序列化会丢掉它，等价于删除 —— 不必在 store 里加一套删键语义。
 */
export function calloutFormatPatch(tone: CalloutTone | null): Record<string, unknown> {
  return { callout: tone ?? undefined }
}
