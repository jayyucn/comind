import { ref, computed } from 'vue'
import { initCoreClient } from '../wasm/client'
import type { RelationshipType as CoreRelationshipType } from '../wasm/types'
import { RELATIONSHIP_TYPES_SEED } from '../config/relationship-types-seed'
import { TYPE_REGEX, COLOR_REGEX } from './relationship-type-constants'
import type { RelationshipType, Strength } from '../types/relationship-type'

export interface RelationshipTypeInput {
  type: string
  inverse: string | null
  label: string
  inverseLabel: string
  description: string | null
  color: string
  group: 'family' | 'work' | 'concept' | 'action' | 'custom'
  strength: Strength
}

const VALID_STRENGTHS: readonly Strength[] = ['strong', 'medium', 'weak']

export function validateRelationshipTypeInput(
  input: RelationshipTypeInput,
  existing: Pick<RelationshipType, 'type' | 'deleted'>[]
): string | null {
  if (!TYPE_REGEX.test(input.type)) return 'type 格式不符：仅小写字母、数字、`-`，且首字符为字母'
  if (!input.label.trim()) return 'label 必填'
  if (!input.inverseLabel.trim()) return 'inverseLabel 必填'
  if (!COLOR_REGEX.test(input.color)) return 'color 格式不符：hex 颜色如 #1890ff'
  if (!VALID_STRENGTHS.includes(input.strength)) return 'strength 必须为 strong/medium/weak'
  if (existing.some(r => !r.deleted && r.type === input.type)) return '该 type 已存在'
  return null
}

function makeId(type: string): string {
  return `rt_seed_${type}`
}

function convertCoreToFrontend(coreType: CoreRelationshipType): RelationshipType {
  return {
    id: coreType.id,
    type: coreType.type,
    inverse: coreType.inverse,
    label: coreType.label,
    inverseLabel: coreType.inverse_label,
    description: null,
    color: coreType.color,
    group: 'custom',
    strength: coreType.strength,
    order: coreType.order,
    deleted: coreType.deleted === 1,
    builtin: coreType.builtin === 1,
    createdAt: coreType.created_at,
    updatedAt: coreType.updated_at
  }
}

const state = ref<{ items: RelationshipType[]; loaded: boolean }>({
  items: [],
  loaded: false
})

let clientPromise: ReturnType<typeof initCoreClient> | null = null

async function getClient() {
  if (!clientPromise) {
    clientPromise = initCoreClient()
  }
  return clientPromise
}

export function useRelationshipTypes() {
  return {
    items: computed(() =>
      state.value.items
        .filter(r => !r.deleted)
        .sort((a, b) => a.order - b.order)
    ),
    all: computed(() =>
      [...state.value.items].sort((a, b) => a.order - b.order)
    ),
    loaded: computed(() => state.value.loaded),

    async load(): Promise<void> {
      const client = await getClient()
      const coreTypes = await client.getRelationshipTypes()
      const existing = coreTypes.map(convertCoreToFrontend)
      const existingIds = new Set(existing.map(r => r.id))

      let order = existing.length > 0
        ? Math.max(...existing.map(r => r.order), -1) + 1
        : 0
      for (const seed of RELATIONSHIP_TYPES_SEED) {
        const id = makeId(seed.type)
        if (!existingIds.has(id)) {
          await client.executeBatch([{
            entity: 'relationship_type',
            action: 'create',
            params: {
              id,
              type: seed.type,
              inverse: seed.inverse,
              label: seed.label,
              inverse_label: seed.inverseLabel,
              description: seed.description ?? null,
              color: seed.color,
              group: seed.group,
              strength: seed.strength,
              order: order++,
              builtin: 1,
            }
          }])
          existing.push({
            id,
            type: seed.type,
            inverse: seed.inverse,
            label: seed.label,
            inverseLabel: seed.inverseLabel,
            description: seed.description ?? null,
            color: seed.color,
            group: seed.group,
            strength: seed.strength,
            order: order - 1,
            deleted: false,
            builtin: true,
            createdAt: Date.now(),
            updatedAt: Date.now()
          })
        }
      }

      state.value.items = existing
      state.value.loaded = true
    },

    async create(input: RelationshipTypeInput): Promise<RelationshipType> {
      const err = validateRelationshipTypeInput(
        input,
        state.value.items.map(r => ({ type: r.type, deleted: r.deleted }))
      )
      if (err) throw new Error(err)

      const client = await getClient()
      const maxOrder = state.value.items.length > 0
        ? Math.max(...state.value.items.map(r => r.order))
        : -1

      const record: RelationshipType = {
        id: `rt_${Date.now()}`,
        type: input.type,
        inverse: input.inverse,
        label: input.label.trim(),
        inverseLabel: input.inverseLabel.trim(),
        description: input.description,
        color: input.color,
        group: input.group,
        strength: input.strength,
        order: maxOrder + 1,
        deleted: false,
        builtin: false,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }

      await client.executeBatch([{
        entity: 'relationship_type',
        action: 'create',
        params: {
          id: record.id,
          type: record.type,
          inverse: record.inverse,
          label: record.label,
          inverse_label: record.inverseLabel,
          description: record.description,
          color: record.color,
          group: record.group,
          strength: record.strength,
          order: record.order,
          builtin: 0,
        }
      }])

      state.value.items = [...state.value.items, record]
      return record
    },

    async update(id: string, patch: Partial<RelationshipTypeInput>): Promise<void> {
      const existing = state.value.items.find(r => r.id === id)
      if (!existing) throw new Error('记录不存在')

      const merged: RelationshipTypeInput = {
        type: patch.type ?? existing.type,
        inverse: patch.inverse === undefined ? existing.inverse : patch.inverse,
        label: patch.label ?? existing.label,
        inverseLabel: patch.inverseLabel ?? existing.inverseLabel,
        description: patch.description ?? existing.description,
        color: patch.color ?? existing.color,
        group: patch.group ?? existing.group,
        strength: patch.strength ?? existing.strength
      }
      const err = validateRelationshipTypeInput(
        merged,
        state.value.items
          .filter(r => r.id !== id)
          .map(r => ({ type: r.type, deleted: r.deleted }))
      )
      if (err) throw new Error(err)

      const client = await getClient()
      await client.executeBatch([{
        entity: 'relationship_type',
        action: 'update',
        params: {
          id,
          label: merged.label.trim(),
          inverse_label: merged.inverseLabel.trim(),
          description: merged.description,
          color: merged.color,
          group: merged.group,
          strength: merged.strength,
        }
      }])

      state.value.items = state.value.items.map(r =>
        r.id === id
          ? {
              ...r,
              label: merged.label.trim(),
              inverseLabel: merged.inverseLabel.trim(),
              description: merged.description,
              color: merged.color,
              group: merged.group,
              strength: merged.strength,
              updatedAt: Date.now()
            }
          : r
      )
    },

    async softDelete(id: string): Promise<void> {
      const client = await getClient()
      await client.executeBatch([{
        entity: 'relationship_type',
        action: 'update',
        params: { id, deleted: 1 }
      }])
      state.value.items = state.value.items.map(r =>
        r.id === id ? { ...r, deleted: true, updatedAt: Date.now() } : r
      )
    },

    async restore(id: string): Promise<void> {
      const client = await getClient()
      await client.executeBatch([{
        entity: 'relationship_type',
        action: 'update',
        params: { id, deleted: 0 }
      }])
      state.value.items = state.value.items.map(r =>
        r.id === id ? { ...r, deleted: false, updatedAt: Date.now() } : r
      )
    },

    async reorder(orderedIds: string[]): Promise<void> {
      const client = await getClient()
      const operations = orderedIds.map((id, index) => ({
        entity: 'relationship_type' as const,
        action: 'update' as const,
        params: { id, order: index }
      }))
      await client.executeBatch(operations)

      const map = new Map(state.value.items.map(r => [r.id, r]))
      for (let i = 0; i < orderedIds.length; i++) {
        const r = map.get(orderedIds[i])
        if (r) {
          r.order = i
        }
      }
      state.value.items = Array.from(map.values())
    },

    _resetForTest(): void {
      state.value = { items: [], loaded: false }
    }
  }
}