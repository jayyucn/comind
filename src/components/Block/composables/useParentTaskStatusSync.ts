import { onScopeDispose, watch } from 'vue'
import { useBlockStore } from '../../../stores/blocks'
import { useFieldValueStore } from '../../../stores/fieldValue'
import { decodeFieldValueData } from '../../../utils/field-value-codec'
import { DATE_REF_AT_REGEX } from '../../../utils/date-ref'
import { computeChildTaskProgress, TASK_STATUS } from '../../../utils/task-progress'

/**
 * useParentTaskStatusSync —— 父任务状态随子任务完成度自动推进
 *
 * 规则（仅作用于「本 block 也是任务 block」）：
 * - 本 block 有 status（任务项）且当前状态非 Canceled；
 * - 存在 ≥1 个有效子任务（非 Canceled 的任务子项）时：
 *   - 全部 Done → 本 block 自动置为 Done（「当所有子任务全部完成时」）；
 *   - 否则 → 自动置为 Doing（含「全部完成后又新建子任务」→ 改回进行中）；
 * - 无有效子任务 / 本 block 无 status / 本 block 为 Canceled → 不自动调整。
 *
 * 死循环防线（T11 日期推进机制）：本 block 内容含周期 dateRef（daily/weekly/
 * monthly/yearly）时跳过「置 Done」——置 Done 会触发 advanceDateRefInBlock 推进
 * 日期并重置 status=Todo，若持续强制 Done 会与日期机制互踢（每轮推进一次日期）。
 * 周期任务的状态归日期机制管；Doing 推进不触发日期机制，仍正常执行。
 *
 * 触发：结构（建/删/移/改父）与字段值（status 变更）任一变化 → 防抖后整页重算。
 * 收敛：仅在与目标不一致时 setFieldValue；set 后字段值变化再次触发重算，
 * 一致即停止，天然收敛；级联（孙任务 → 父 → 祖父）随防抖轮次逐层收敛。
 */
const RECONCILE_DEBOUNCE_MS = 120

export function useParentTaskStatusSync(pageId: () => string) {
  const blockStore = useBlockStore()
  const fieldValueStore = useFieldValueStore()

  let timer: ReturnType<typeof setTimeout> | null = null

  function schedule() {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      void reconcile()
    }, RECONCILE_DEBOUNCE_MS)
  }

  async function reconcile(): Promise<void> {
    const pid = pageId()
    const blocks = blockStore.getBlocksByPage(pid)
    if (blocks.length === 0) return

    const childrenOf = new Map<string, string[]>()
    for (const b of blocks) {
      if (!b.parentId) continue
      const list = childrenOf.get(b.parentId)
      if (list) list.push(b.id)
      else childrenOf.set(b.parentId, [b.id])
    }

    const statusOf = (id: string): string | undefined => {
      const fv = fieldValueStore.getBlockFieldValue(id, 'status')
      if (!fv) return undefined
      const v = decodeFieldValueData(fv.value_json, fv.value_type)
      return typeof v === 'string' ? v : undefined
    }

    for (const block of blocks) {
      const self = statusOf(block.id)
      if (self === undefined || self === TASK_STATUS.CANCELED) continue
      const progress = computeChildTaskProgress(
        (childrenOf.get(block.id) ?? []).map((id) => ({ id })),
        statusOf,
      )
      if (!progress) continue // 无有效子任务 → 不自动调整
      const target = progress.done >= progress.total ? TASK_STATUS.DONE : 'Doing'
      if (self === target) continue
      // 周期 dateRef 的块：Done 推进会触发日期机制互踢，跳过（见文件头）
      if (target === TASK_STATUS.DONE && hasRecurringDateRef(block.content)) continue
      await fieldValueStore.setFieldValue(block.id, 'status', target, 'string')
    }
  }

  watch(
    () => [
      blockStore.blocks.map((b) => `${b.id}:${b.parentId}:${b.pos}:${b.pageId}`),
      fieldValueStore.fieldValuesByBlock,
    ],
    () => schedule(),
  )

  onScopeDispose(() => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  })

  return { schedule }
}

/** 内容是否含周期 dateRef（daily/weekly/monthly/yearly）——同步检测，无需 wasm */
function hasRecurringDateRef(content: string): boolean {
  if (!content) return false
  const re = new RegExp(DATE_REF_AT_REGEX.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    // 分组：1=日期, 2=📅/⏰, 3=周期, 4=提前分钟
    const rec = m[3]
    if (rec && rec !== 'none') return true
  }
  return false
}
