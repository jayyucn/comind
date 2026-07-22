import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref } from 'vue'
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

describe('useBlockPropertySync', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('getProperty returns property value by key', () => {
    const blockId = ref('b1')
    const propertyStore = usePropertyStore()
    propertyStore.propertiesByBlock.set('b1', [
      makeProp('b1', 'priority', 'HIGH'),
    ])
    const { getProperty } = useBlockPropertySync(blockId)
    expect(getProperty('priority')).toBe('HIGH')
  })

  it('getPropertiesMap returns all properties as key-value object', () => {
    const blockId = ref('b1')
    const propertyStore = usePropertyStore()
    propertyStore.propertiesByBlock.set('b1', [
      makeProp('b1', 'priority', 'HIGH'),
      makeProp('b1', 'language', 'typescript'),
    ])
    const { getPropertiesMap } = useBlockPropertySync(blockId)
    expect(getPropertiesMap()).toEqual({ priority: 'HIGH', language: 'typescript' })
  })

  it('setProperty calls blockStore.updateBlockProperties', async () => {
    const blockId = ref('b1')
    const blockStore = useBlockStore()
    const spy = vi.spyOn(blockStore, 'updateBlockProperties').mockResolvedValue(undefined)
    const { setProperty } = useBlockPropertySync(blockId)
    await setProperty('language', 'python')
    expect(spy).toHaveBeenCalledWith('b1', { language: 'python' })
  })

  it('blockPriority returns priority value', () => {
    const blockId = ref('b1')
    const propertyStore = usePropertyStore()
    propertyStore.propertiesByBlock.set('b1', [
      makeProp('b1', 'priority', 'HIGH'),
    ])
    const { blockPriority } = useBlockPropertySync(blockId)
    expect(blockPriority.value).toBe('HIGH')
  })

  it('priorityClass returns lowercase priority class', () => {
    const blockId = ref('b1')
    const propertyStore = usePropertyStore()
    propertyStore.propertiesByBlock.set('b1', [
      makeProp('b1', 'priority', 'HIGH'),
    ])
    const { priorityClass } = useBlockPropertySync(blockId)
    expect(priorityClass.value).toBe('priority-high')
  })

  it('priorityClass returns empty string when no priority', () => {
    const blockId = ref('b1')
    const { priorityClass } = useBlockPropertySync(blockId)
    expect(priorityClass.value).toBe('')
  })

  it('reactivity: priorityClass updates when property store changes', async () => {
    const blockId = ref('b1')
    const propertyStore = usePropertyStore()
    const { priorityClass } = useBlockPropertySync(blockId)
    expect(priorityClass.value).toBe('')
    propertyStore.propertiesByBlock.set('b1', [
      makeProp('b1', 'priority', 'Urgent'),
    ])
    expect(priorityClass.value).toBe('priority-urgent')
  })
})
