import { ref, computed } from 'vue'
import { getCore } from '../core'
import type { RelationshipType, Strength } from '../core/types'
import { RELATIONSHIP_TYPES_SEED } from '../config/relationship-types-seed'
import { TYPE_REGEX, COLOR_REGEX } from './relationship-type-constants'

/** 用户编辑/新建时的输入（不含 id/order/builtin/deleted） */
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

/** 校验输入；返回 null 表示通过，否则返回错误信息 */
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

const state = ref<{ items: RelationshipType[]; loaded: boolean }>({
  items: [],
  loaded: false
})

function makeId(type: string): string {
  return `rt_seed_${type}`
}

export function useRelationshipTypes() {
  return {
    /** 菜单用：仅未软删，按 order 升序 */
    items: computed(() =>
      state.value.items
        .filter(r => !r.deleted)
        .sort((a, b) => a.order - b.order)
    ),
    /** 设置页用：全部（含已软删），按 order 升序 */
    all: computed(() =>
      [...state.value.items].sort((a, b) => a.order - b.order)
    ),
    loaded: computed(() => state.value.loaded),

    async load(): Promise<void> {
      const core = getCore()
      const existing = await core.relationshipTypeService.getActive()
      const existingIds = new Set(existing.map(r => r.id))

      let order = existing.length > 0
        ? Math.max(...existing.map(r => r.order), -1) + 1
        : 0
      for (const seed of RELATIONSHIP_TYPES_SEED) {
        const id = makeId(seed.type)
        if (!existingIds.has(id)) {
          const record = await core.relationshipTypeService.create({
            id,
            type: seed.type,
            inverse: seed.inverse,
            label: seed.label,
            inverseLabel: seed.inverseLabel,
            description: seed.description ?? null,
            color: seed.color,
            group: seed.group,
            strength: seed.strength,
            order: order++,
            builtin: true,
          })
          existing.push(record)
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

      const core = getCore()
      const maxOrder = state.value.items.length > 0
        ? Math.max(...state.value.items.map(r => r.order))
        : -1
      const record = await core.relationshipTypeService.create({
        type: input.type,
        inverse: input.inverse,
        label: input.label.trim(),
        inverseLabel: input.inverseLabel.trim(),
        description: input.description,
        color: input.color,
        group: input.group,
        strength: input.strength,
        order: maxOrder + 1,
      })
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

      const core = getCore()
      const updated = await core.relationshipTypeService.update(id, {
        label: merged.label.trim(),
        inverseLabel: merged.inverseLabel.trim(),
        description: merged.description,
        color: merged.color,
        group: merged.group,
        strength: merged.strength,
      })
      state.value.items = state.value.items.map(r => r.id === id ? updated : r)
    },

    async softDelete(id: string): Promise<void> {
      const core = getCore()
      await core.relationshipTypeService.softDelete(id)
      state.value.items = state.value.items.map(r =>
        r.id === id ? { ...r, deleted: true, updatedAt: Date.now() } : r
      )
    },

    async restore(id: string): Promise<void> {
      const core = getCore()
      await core.relationshipTypeService.restore(id)
      state.value.items = state.value.items.map(r =>
        r.id === id ? { ...r, deleted: false, updatedAt: Date.now() } : r
      )
    },

    async reorder(orderedIds: string[]): Promise<void> {
      const core = getCore()
      await core.relationshipTypeService.updateOrder(orderedIds)
      const map = new Map(state.value.items.map(r => [r.id, r]))
      for (let i = 0; i < orderedIds.length; i++) {
        const r = map.get(orderedIds[i])
        if (r) {
          r.order = i
        }
      }
      state.value.items = Array.from(map.values())
    },

    /** 仅供测试使用：重置模块级 state */
    _resetForTest(): void {
      state.value = { items: [], loaded: false }
    }
  }
}
