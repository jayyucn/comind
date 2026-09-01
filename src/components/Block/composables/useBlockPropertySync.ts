import type { Ref } from 'vue'
import { computed, onMounted, watch } from 'vue'
import { useBlockStore } from '../../../stores/blocks'
import { usePropertyStore } from '../../../stores/property'

/**
 * Block 属性同步 composable
 *
 * 职责：
 * - 从后端加载 block 属性（priority, language, sourceBlockId 等）
 * - 读取 block 属性
 * - 提供 priority → CSS class 的映射
 */
export function useBlockPropertySync(blockId: Ref<string>) {
  const propertyStore = usePropertyStore()
  const blockStore = useBlockStore()

  // 挂载时加载属性；blockId 变化时重新加载
  onMounted(async () => {
    await propertyStore.loadBlockProperties(blockId.value)
  })

  watch(blockId, async (newBlockId) => {
    if (newBlockId) {
      await propertyStore.loadBlockProperties(newBlockId)
    }
  })

  function getProperty(key: string): string | undefined {
    const prop = propertyStore.getBlockProperty(blockId.value, key)
    return prop?.value as string | undefined
  }

  function getPropertiesMap(): Record<string, any> {
    const props = propertyStore.getBlockProperties(blockId.value)
    const result: Record<string, any> = {}
    for (const prop of props) {
      result[prop.key] = prop.value
    }
    return result
  }

  async function setProperty(key: string, value: any): Promise<void> {
    await blockStore.updateBlockProperties(blockId.value, { [key]: value })
  }

  const blockPriority = computed(() => {
    const prop = propertyStore.getBlockProperty(blockId.value, 'priority')
    return prop?.value as string | undefined
  })

  const priorityClass = computed(() => {
    if (!blockPriority.value) return ''
    return `priority-${blockPriority.value.toLowerCase()}`
  })

  const blockStatus = computed(() => {
    const prop = propertyStore.getBlockProperty(blockId.value, 'status')
    return prop?.value as string | undefined
  })

  // 已完成 / 已取消 block 加删除线：Done 中性弱化，Canceled 红色弱化区分
  const statusClass = computed(() => {
    if (blockStatus.value === 'Done') return 'status-done'
    if (blockStatus.value === 'Canceled') return 'status-canceled'
    return ''
  })

  return {
    getProperty,
    getPropertiesMap,
    setProperty,
    blockPriority,
    priorityClass,
    blockStatus,
    statusClass,
  }
}
