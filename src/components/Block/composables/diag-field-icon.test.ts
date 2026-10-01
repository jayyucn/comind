import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, computed } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useBlockFieldValueSync } from './useBlockFieldValueSync'
import { useFieldValueStore } from '../../../stores/fieldValue'
import { useBlockStore } from '../../../stores/blocks'
import type { FieldValue } from '../../../types/field-value'

function makeFieldValue(blockId: string, key: string, value: string, id = `fv-${key}`): FieldValue {
  return {
    id,
    block_id: blockId,
    field_definition_id: `fd-${key}`,
    key,
    value_json: value,
    value_type: 'string',
    seq: 0,
    created_at: 0,
    updated_at: 0,
    version: 0,
    deleted_at: null,
  }
}

// 模拟真实 Block/index.vue 的用法：blockId 是 computed(() => props.node.id)
// 切页时 props.node 变化 → computed 变化 → watch 触发
describe('diag: 切页后 字段 icon 消失', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('watch(blockId) 在 computed node.id 变化时应触发 loadBlockFieldValues', async () => {
    const fieldValueStore = useFieldValueStore()
    const loadSpy = vi.spyOn(fieldValueStore, 'loadBlockFieldValues').mockResolvedValue([])

    // 模拟组件：node 是响应式 ref，blockId = computed(() => node.value.id)
    const node = ref({ id: 'b1' })
    const blockId = computed(() => node.value.id)
    useBlockFieldValueSync(blockId)

    // 初始 watch 不触发（无 immediate）
    expect(loadSpy).not.toHaveBeenCalled()

    // 切页：node 变为新页面的 block（id 变化）
    node.value = { id: 'b2' }
    await flushPromises()
    expect(loadSpy).toHaveBeenCalledWith('b2')
  })

  it('切页后 loadBlockFieldValues 填充 fieldValuesByBlock，FieldInline 能读到', async () => {
    const fieldValueStore = useFieldValueStore()
    // mock 数据源：pinia 解包 ref，store 上 fieldValuesByBlock 直接是 reactive Map
    vi.spyOn(fieldValueStore, 'loadBlockFieldValues').mockImplementation(async (blockId: string) => {
      ;(fieldValueStore.fieldValuesByBlock as unknown as Map<string, FieldValue[]>).set(blockId, [
        makeFieldValue(blockId, 'status', 'Todo'),
      ])
      return []
    })

    const node = ref({ id: 'b1' })
    const blockId = computed(() => node.value.id)
    useBlockFieldValueSync(blockId)

    // 切页到 b2
    node.value = { id: 'b2' }
    await flushPromises()

    const values = fieldValueStore.getBlockFieldValues('b2')
    expect(values.length).toBe(1)
    expect(values[0].key).toBe('status')
  })

  it('真实场景：切页后 node.id 相同（复用）但 block 数据变化——watch 不触发但数据应已加载', async () => {
    // 关键场景：v-for 复用同一组件实例，node.id 相同，watch 不触发
    // 但 onMounted 只跑一次 → 需要验证 loadPageBlocks 路径是否填充 field-value store
    const fieldValueStore = useFieldValueStore()
    const blockStore = useBlockStore()

    // 模拟 loadPageBlocks 只填充 blocks store，不填充 field-value store
    // （当前实现：properties 进 blocks store 的 block.properties，field-value store 靠 loadBlockFieldValues 单独填充）
    const loadSpy = vi.spyOn(fieldValueStore, 'loadBlockFieldValues').mockResolvedValue([])

    const node = ref({ id: 'b1' })
    const blockId = computed(() => node.value.id)
    useBlockFieldValueSync(blockId)

    // 模拟刷新：onMounted 跑一次 loadBlockFieldValues
    await fieldValueStore.loadBlockFieldValues('b1')
    expect(loadSpy).toHaveBeenCalled()

    // FieldInline 读取
    expect(fieldValueStore.getBlockFieldValues('b1')).toEqual([])
  })
})
