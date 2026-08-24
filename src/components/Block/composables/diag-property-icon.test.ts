import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, computed } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useBlockPropertySync } from './useBlockPropertySync'
import { usePropertyStore } from '../../../stores/property'
import { useBlockStore } from '../../../stores/blocks'
import type { Property } from '../../../types/property'

function makeProp(blockId: string, key: string, value: string, id = `p-${key}`): Property {
  return {
    id,
    blockId,
    key,
    value,
    type: 'string',
    sortOrder: 0,
    isHidden: false,
    isDeleted: false,
    schemaVersion: 1,
    createdAt: 0,
    updatedAt: 0,
  }
}

// 模拟真实 Block/index.vue 的用法：blockId 是 computed(() => props.node.id)
// 切页时 props.node 变化 → computed 变化 → watch 触发
describe('diag: 切页后 property icon 消失', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('watch(blockId) 在 computed node.id 变化时应触发 loadBlockProperties', async () => {
    const propertyStore = usePropertyStore()
    const loadSpy = vi.spyOn(propertyStore, 'loadBlockProperties').mockResolvedValue([])

    // 模拟组件：node 是响应式 ref，blockId = computed(() => node.value.id)
    const node = ref({ id: 'b1' })
    const blockId = computed(() => node.value.id)
    useBlockPropertySync(blockId)

    // 初始 watch 不触发（无 immediate）
    expect(loadSpy).not.toHaveBeenCalled()

    // 切页：node 变为新页面的 block（id 变化）
    node.value = { id: 'b2' }
    await flushPromises()
    expect(loadSpy).toHaveBeenCalledWith('b2')
  })

  it('切页后 loadBlockProperties 填充 propertiesByBlock，PropertyInline 能读到', async () => {
    const propertyStore = usePropertyStore()
    // mock getClient 返回的数据
    vi.spyOn(propertyStore, 'loadBlockProperties').mockImplementation(async (blockId: string) => {
      ;(propertyStore as any).propertiesByBlock.value = new Map(
        (propertyStore as any).propertiesByBlock.value.set(blockId, [
          makeProp(blockId, 'status', 'Todo'),
        ])
      )
      return []
    })

    const node = ref({ id: 'b1' })
    const blockId = computed(() => node.value.id)
    useBlockPropertySync(blockId)

    // 切页到 b2
    node.value = { id: 'b2' }
    await flushPromises()

    const props = propertyStore.getBlockProperties('b2')
    expect(props.length).toBe(1)
    expect(props[0].key).toBe('status')
  })

  it('真实场景：切页后 node.id 相同（复用）但 block 数据变化——watch 不触发但数据应已加载', async () => {
    // 关键场景：v-for 复用同一组件实例，node.id 相同，watch 不触发
    // 但 onMounted 只跑一次 → 需要验证 loadPageBlocks 路径是否填充 property store
    const propertyStore = usePropertyStore()
    const blockStore = useBlockStore()

    // 模拟 loadPageBlocks 只填充 blocks store，不填充 property store
    // （当前实现：properties 进 blocks store 的 block.properties，property store 靠 loadBlockProperties 单独填充）
    const loadSpy = vi.spyOn(propertyStore, 'loadBlockProperties').mockResolvedValue([])

    const node = ref({ id: 'b1' })
    const blockId = computed(() => node.value.id)
    useBlockPropertySync(blockId)

    // 模拟刷新：onMounted 跑一次 loadBlockProperties
    await propertyStore.loadBlockProperties('b1')
    expect(loadSpy).toHaveBeenCalled()

    // PropertyInline 读取
    expect(propertyStore.getBlockProperties('b1')).toEqual([])
  })
})
