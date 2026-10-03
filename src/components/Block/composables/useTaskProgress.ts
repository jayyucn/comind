import type { Ref } from 'vue'
import { computed } from 'vue'
import { useFieldValueStore } from '../../../stores/fieldValue'
import { decodeFieldValueData } from '../../../utils/field-value-codec'
import { computeChildTaskProgress, type TaskProgress } from '../../../utils/task-progress'

/**
 * useChildTaskProgress —— 子 block 任务进度（任务进度条的数据源）。
 *
 * 输入：一组子 block（TreeNode[]，本 block 的 node.children 或根级 tree）。
 * 输出：progress = { done, total } | null；null = 无有效任务项（不渲染进度条）。
 *
 * 响应性：
 * - 树结构变化：children ref 更新（BlockList 树重建 / Block 的 node.children 变化）；
 * - 状态变化：fieldValueStore.fieldValuesByBlock 整体替换（loadBlockFieldValues /
 *   setFieldValue 路径）→ computed 重算；
 * - 删除最后一个 block：树重建后 children 为空 → progress 归 null → 进度条移除（需求 4）。
 */
export function useChildTaskProgress(children: Ref<ReadonlyArray<{ id: string }>>) {
  const fieldValueStore = useFieldValueStore()

  const progress = computed<TaskProgress | null>(() =>
    computeChildTaskProgress(children.value, (id) => {
      const fv = fieldValueStore.getBlockFieldValue(id, 'status')
      if (!fv) return undefined
      const v = decodeFieldValueData(fv.value_json, fv.value_type)
      return typeof v === 'string' ? v : undefined
    })
  )

  return { progress }
}
