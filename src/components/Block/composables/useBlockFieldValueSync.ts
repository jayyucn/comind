import type { Ref } from 'vue'
import { computed, onMounted, watch } from 'vue'
import { useBlockStore } from '../../../stores/blocks'
import { useFieldValueStore } from '../../../stores/fieldValue'
import type { FieldValueData } from '../../../types/field-definition'
import type { FieldValue } from '../../../types/field-value'
import { decodeFieldValueData } from '../../../utils/field-value-codec'

/**
 * Block 字段值同步 composable
 *
 * 职责：
 * - 从后端加载 block 字段值（priority, language, sourceBlockId 等）
 * - 读取 block 字段值
 * - 提供 priority → CSS class 的映射
 */
export function useBlockFieldValueSync(blockId: Ref<string>) {
  const fieldValueStore = useFieldValueStore()
  const blockStore = useBlockStore()

  // 挂载时加载字段值；blockId 变化时重新加载
  onMounted(async () => {
    await fieldValueStore.loadBlockFieldValues(blockId.value)
  })

  watch(blockId, async (newBlockId) => {
    if (newBlockId) {
      await fieldValueStore.loadBlockFieldValues(newBlockId)
    }
  })

  /** 字段值行 → 内存值（解码 value_json） */
  function dataOf(fv: FieldValue): unknown {
    return decodeFieldValueData(fv.value_json, fv.value_type)
  }

  function getFieldValue(key: string): string | undefined {
    const fv = fieldValueStore.getBlockFieldValue(blockId.value, key)
    return fv === undefined ? undefined : (dataOf(fv) as string | undefined)
  }

  function getFieldValuesMap(): Record<string, unknown> {
    const rows = fieldValueStore.getBlockFieldValues(blockId.value)
    const result: Record<string, unknown> = {}
    for (const fv of rows) {
      result[fv.key] = dataOf(fv)
    }
    return result
  }

  async function setFieldValue(key: string, value: unknown): Promise<void> {
    await blockStore.updateBlockFieldValues(blockId.value, { [key]: value as FieldValueData })
  }

  const blockPriority = computed(() => {
    const fv = fieldValueStore.getBlockFieldValue(blockId.value, 'priority')
    return fv === undefined ? undefined : (dataOf(fv) as string | undefined)
  })

  const priorityClass = computed(() => {
    if (!blockPriority.value) return ''
    return `priority-${blockPriority.value.toLowerCase()}`
  })

  const blockStatus = computed(() => {
    const fv = fieldValueStore.getBlockFieldValue(blockId.value, 'status')
    return fv === undefined ? undefined : (dataOf(fv) as string | undefined)
  })

  // 已完成 / 已取消 block 加删除线：Done 中性弱化，Canceled 红色弱化区分
  const statusClass = computed(() => {
    if (blockStatus.value === 'Done') return 'status-done'
    if (blockStatus.value === 'Canceled') return 'status-canceled'
    return ''
  })

  return {
    getFieldValue,
    getFieldValuesMap,
    setFieldValue,
    blockPriority,
    priorityClass,
    blockStatus,
    statusClass,
  }
}
