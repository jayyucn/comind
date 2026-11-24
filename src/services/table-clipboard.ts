/**
 * 表格范围剪贴板（模块级单例）。
 *
 * 为什么不能挂在 `TableBlock` 组件里：表格菜单的「剪切」= 复制 + 删除块，
 * 块一删组件就卸载，实例内的剪贴板跟着消失，剪切出来的内容等于死数据。
 * 放到模块级后，同一个会话内可以跨表格块复制粘贴。
 *
 * 只承载**矩形单元格内容**（行优先二维数组），不承载表头标记与对齐：
 * 粘贴是「左上角对齐覆盖内容」，表结构由目标表自己决定。
 * 也不进撤销栈——刷新即失效。
 */
import { shallowRef } from 'vue'

const clipboard = shallowRef<string[][] | null>(null)

/** 写入剪贴板（深拷贝，避免调用方后续改动数组污染剪贴板） */
export function setTableClipboard(rows: string[][]): void {
  clipboard.value = rows.map(row => [...row])
}

/** 读取剪贴板内容；空剪贴板返回 null */
export function getTableClipboard(): string[][] | null {
  return clipboard.value
}

export function hasTableClipboard(): boolean {
  return clipboard.value !== null && clipboard.value.length > 0
}

/** 清空：测试隔离用（生产路径没有「粘贴即失效」策略） */
export function clearTableClipboard(): void {
  clipboard.value = null
}
