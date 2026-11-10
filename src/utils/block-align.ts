import { AlignCenter, AlignLeft, AlignRight } from 'lucide-vue-next'

/**
 * 块级文本对齐的单一来源（类型 / 选项 / 读取）。
 *
 * 存 `block.format.align`，与图片块（`handlers/image`）**同一个键、同一套取值**：
 * 图片用它对 flex 容器做 justify，文本块用它给 `.block-content` 出 `text-align`。
 * 表格的逐格对齐（`TableData.aligns`）是另一套数据，但取值口径与此处一致，
 * 因此菜单选项也共用这一份 —— 三处「左/中/右」的文案与图标不会再长歪。
 */
export type BlockAlign = 'left' | 'center' | 'right'

export const BLOCK_ALIGN_OPTIONS: ReadonlyArray<{
  value: BlockAlign
  label: string
  icon: unknown
}> = [
  { value: 'left', label: '左对齐', icon: AlignLeft },
  { value: 'center', label: '居中对齐', icon: AlignCenter },
  { value: 'right', label: '右对齐', icon: AlignRight },
]

/** 未存 / 存了脏值都按默认左对齐（与 CSS 缺省一致） */
export function blockAlignOf(format: Record<string, unknown> | null | undefined): BlockAlign {
  const value = format?.align
  return value === 'center' || value === 'right' ? value : 'left'
}
