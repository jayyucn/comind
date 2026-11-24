import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { useBlockFieldValueSync } from './useBlockFieldValueSync'
import { useFieldValueStore } from '../../../stores/fieldValue'
import { useBlockStore } from '../../../stores/blocks'
import type { FieldValue } from '../../../types/field-value'

function makeFieldValue(blockId: string, key: string, value: string, id = `f-${key}`): FieldValue {
  return {
    id,
    block_id: blockId,
    field_definition_id: `fd-${key}`,
    value_json: value,
    value_type: 'string',
    seq: 0,
    created_at: 0,
    updated_at: 0,
    version: 0,
    deleted_at: null,
    key,
  }
}

describe('useBlockFieldValueSync', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('getFieldValue returns field value by key', () => {
    const blockId = ref('b1')
    const fieldValueStore = useFieldValueStore()
    fieldValueStore.fieldValuesByBlock.set('b1', [
      makeFieldValue('b1', 'priority', 'HIGH'),
    ])
    const { getFieldValue } = useBlockFieldValueSync(blockId)
    expect(getFieldValue('priority')).toBe('HIGH')
  })

  it('getFieldValuesMap returns all field values as key-value object', () => {
    const blockId = ref('b1')
    const fieldValueStore = useFieldValueStore()
    fieldValueStore.fieldValuesByBlock.set('b1', [
      makeFieldValue('b1', 'priority', 'HIGH'),
      makeFieldValue('b1', 'language', 'typescript'),
    ])
    const { getFieldValuesMap } = useBlockFieldValueSync(blockId)
    expect(getFieldValuesMap()).toEqual({ priority: 'HIGH', language: 'typescript' })
  })

  it('setFieldValue calls blockStore.updateBlockFieldValues', async () => {
    const blockId = ref('b1')
    const blockStore = useBlockStore()
    const spy = vi.spyOn(blockStore, 'updateBlockFieldValues').mockResolvedValue(undefined)
    const { setFieldValue } = useBlockFieldValueSync(blockId)
    await setFieldValue('language', 'python')
    expect(spy).toHaveBeenCalledWith('b1', { language: 'python' })
  })

  it('blockPriority returns priority value', () => {
    const blockId = ref('b1')
    const fieldValueStore = useFieldValueStore()
    fieldValueStore.fieldValuesByBlock.set('b1', [
      makeFieldValue('b1', 'priority', 'HIGH'),
    ])
    const { blockPriority } = useBlockFieldValueSync(blockId)
    expect(blockPriority.value).toBe('HIGH')
  })

  it('priorityClass returns lowercase priority class', () => {
    const blockId = ref('b1')
    const fieldValueStore = useFieldValueStore()
    fieldValueStore.fieldValuesByBlock.set('b1', [
      makeFieldValue('b1', 'priority', 'HIGH'),
    ])
    const { priorityClass } = useBlockFieldValueSync(blockId)
    expect(priorityClass.value).toBe('priority-high')
  })

  it('priorityClass returns empty string when no priority', () => {
    const blockId = ref('b1')
    const { priorityClass } = useBlockFieldValueSync(blockId)
    expect(priorityClass.value).toBe('')
  })

  it('reactivity: priorityClass updates when field value store changes', async () => {
    const blockId = ref('b1')
    const fieldValueStore = useFieldValueStore()
    const { priorityClass } = useBlockFieldValueSync(blockId)
    expect(priorityClass.value).toBe('')
    fieldValueStore.fieldValuesByBlock.set('b1', [
      makeFieldValue('b1', 'priority', 'Urgent'),
    ])
    expect(priorityClass.value).toBe('priority-urgent')
  })

  it('loads block field values when blockId changes', async () => {
    const blockId = ref('b1')
    const fieldValueStore = useFieldValueStore()
    const loadSpy = vi.spyOn(fieldValueStore, 'loadBlockFieldValues').mockResolvedValue([])
    useBlockFieldValueSync(blockId)
    // watch 不在初始化时触发；改变 blockId 后应触发加载
    blockId.value = 'b2'
    await flushPromises()
    expect(loadSpy).toHaveBeenCalledWith('b2')
  })
})
