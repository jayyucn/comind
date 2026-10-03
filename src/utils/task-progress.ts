/**
 * task-progress —— block 树的子任务进度计算（子任务进度条）。
 *
 * 任务项口径：子 block 中存在 status 字段值（FieldValue key='status'）即视为任务。
 * 进度口径：done = status === 'Done' 的数量；total = 非 Canceled 的任务数。
 * - Canceled 不参与（既不计 total，也不计 done）——需求「不包括已取消的任务」；
 * - 无 status 的子 block 不是任务项，不参与；
 * - 全部为 Canceled / 无任务项时返回 null（不渲染进度条）。
 *
 * 进度条按「直接子 block」聚合（含页面根 block：其子项即顶层 block），
 * 不递归进孙子代 —— 需要子树聚合时另行扩展。
 */

export interface TaskProgress {
  done: number
  total: number
}

export const TASK_STATUS = {
  DONE: 'Done',
  CANCELED: 'Canceled',
} as const

/**
 * 计算一组子 block 的任务进度。
 *
 * @param children 子 block 列表（只需 id）
 * @param getStatus 取某子 block 的 status 值；无 status 字段返回 undefined（非任务项）
 * @returns { done, total }；无有效任务项时返回 null
 */
export function computeChildTaskProgress(
  children: ReadonlyArray<{ id: string }>,
  getStatus: (blockId: string) => string | undefined,
): TaskProgress | null {
  let done = 0
  let total = 0
  for (const child of children) {
    const status = getStatus(child.id)
    if (status === undefined) continue // 非任务项
    if (status === TASK_STATUS.CANCELED) continue // 已取消不参与
    total += 1
    if (status === TASK_STATUS.DONE) done += 1
  }
  return total > 0 ? { done, total } : null
}
