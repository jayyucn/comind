/**
 * computeChildTaskProgress 单测 —— 子任务进度口径
 *
 * 规格锚点（需求 1-4）：
 * 1. 子 block 含任务项（status 字段值）→ 返回 done/total；
 * 2. Canceled 不参与（不计 total，也不计 done）；
 * 3. 无任务项 / 全部 Canceled / 空子列表 → null（不渲染进度条）；
 * 4. done = status === 'Done' 的数量。
 */
import { describe, it, expect } from 'vitest'
import { computeChildTaskProgress, TASK_STATUS } from './task-progress'

/** 构造 getStatus 闭包：statusByBlock.get(id) 未命中 → undefined（非任务项） */
function statusLookup(statusByBlock: Record<string, string>) {
  return (id: string): string | undefined => statusByBlock[id]
}

const CHILDREN = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

describe('computeChildTaskProgress', () => {
  it('空子列表 → null', () => {
    expect(computeChildTaskProgress([], statusLookup({}))).toBeNull()
  })

  it('子 block 全无 status → null（非任务项不参与）', () => {
    expect(computeChildTaskProgress(CHILDREN, statusLookup({}))).toBeNull()
  })

  it('全为 Canceled → null（已取消任务不参与）', () => {
    const lookup = statusLookup({ a: 'Canceled', b: TASK_STATUS.CANCELED })
    expect(computeChildTaskProgress(CHILDREN, lookup)).toBeNull()
  })

  it('混排：Done + Doing + Todo + Canceled → { done: 1, total: 3 }', () => {
    const lookup = statusLookup({ a: 'Done', b: 'Doing', c: 'Todo', d: 'Canceled' })
    expect(computeChildTaskProgress(CHILDREN, lookup)).toEqual({ done: 1, total: 3 })
  })

  it('全 Done → { done: 2, total: 2 }（100%）', () => {
    const lookup = statusLookup({ a: 'Done', b: TASK_STATUS.DONE })
    expect(computeChildTaskProgress(CHILDREN, lookup)).toEqual({ done: 2, total: 2 })
  })

  it('未知 status 值（非候选值）→ 计入 total、不计 done（防御式）', () => {
    const lookup = statusLookup({ a: 'Blocked' })
    expect(computeChildTaskProgress([{ id: 'a' }], lookup)).toEqual({ done: 0, total: 1 })
  })

  it('Canceled 不挤占 done：Done + Canceled → { done: 1, total: 1 }', () => {
    const lookup = statusLookup({ a: 'Done', b: 'Canceled' })
    expect(computeChildTaskProgress([{ id: 'a' }, { id: 'b' }], lookup)).toEqual({ done: 1, total: 1 })
  })
})
