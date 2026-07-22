import { computed, onMounted, watch } from 'vue'
import type { Ref } from 'vue'
import { usePropertyStore } from '../../../stores/property'
import { useBlockStore } from '../../../stores/blocks'

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

  return {
    getProperty,
    getPropertiesMap,
    setProperty,
    blockPriority,
    priorityClass,
  }
}
