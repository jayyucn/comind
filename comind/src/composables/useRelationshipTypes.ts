import { ref, computed } from 'vue'
import { nanoid } from 'nanoid'
import { db, type RelationshipTypeRecord } from '../storage/db'
import { RELATIONSHIP_TYPES_SEED } from '../config/relationship-types-seed'

/** 用户编辑/新建时的输入（不含 id/order/builtin/deleted） */
export interface RelationshipTypeInput {
  type: string
  inverse: string | null
  label: string
  inverseLabel: string
  color: string
}

const TYPE_REGEX = /^[a-z][a-z0-9-]*$/
const COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** 校验输入；返回 null 表示通过，否则返回错误信息 */
export function validateRelationshipTypeInput(
  input: RelationshipTypeInput,
  existing: Pick<RelationshipTypeRecord, 'type' | 'deleted'>[]
): string | null {
  if (!TYPE_REGEX.test(input.type)) return 'type 格式不符：仅小写字母、数字、`-`，且首字符为字母'
  if (!input.label.trim()) return 'label 必填'
  if (!input.inverseLabel.trim()) return 'inverseLabel 必填'
  if (!COLOR_REGEX.test(input.color)) return 'color 格式不符：hex 颜色如 #1890ff'
  if (existing.some(r => !r.deleted && r.type === input.type)) return '该 type 已存在'
  return null
}

const state = ref<{ items: RelationshipTypeRecord[]; loaded: boolean }>({
  items: [],
  loaded: false
})

function makeId(type: string): string {
  return `rt_seed_${type}`
}

function makeUserId(): string {
  return `rt_user_${nanoid(10)}`
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
      const existing = await db.relationshipTypes.toArray()
      const existingIds = new Set(existing.map(r => r.id))

      // 缺失的种子补齐
      let order = existing.length > 0
        ? Math.max(...existing.map(r => r.order), -1) + 1
        : 0
      for (const seed of RELATIONSHIP_TYPES_SEED) {
        const id = makeId(seed.type)
        if (!existingIds.has(id)) {
          const record: RelationshipTypeRecord = {
            id,
            type: seed.type,
            inverse: seed.inverse,
            label: seed.label,
            inverseLabel: seed.inverseLabel,
            color: seed.color,
            order: order++,
            deleted: seed.deleted,
            builtin: seed.builtin
          }
          await db.relationshipTypes.put(record)
          existing.push(record)
        }
      }

      state.value.items = await db.relationshipTypes.toArray()
      state.value.loaded = true
    },

    async create(input: RelationshipTypeInput): Promise<RelationshipTypeRecord> {
      const err = validateRelationshipTypeInput(
        input,
        state.value.items.map(r => ({ type: r.type, deleted: r.deleted }))
      )
      if (err) throw new Error(err)

      const maxOrder = state.value.items.reduce((m, r) => Math.max(m, r.order), -1)
      const record: RelationshipTypeRecord = {
        id: makeUserId(),
        type: input.type,
        inverse: input.inverse,
        label: input.label.trim(),
        inverseLabel: input.inverseLabel.trim(),
        color: input.color,
        order: maxOrder + 1,
        deleted: false,
        builtin: false
      }
      await db.relationshipTypes.put(record)
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
        color: patch.color ?? existing.color
      }
      // 唯一性校验：除自己外不重复
      const err = validateRelationshipTypeInput(
        merged,
        state.value.items
          .filter(r => r.id !== id)
          .map(r => ({ type: r.type, deleted: r.deleted }))
      )
      if (err) throw new Error(err)

      const updated: RelationshipTypeRecord = {
        ...existing,
        type: merged.type,
        inverse: merged.inverse,
        label: merged.label.trim(),
        inverseLabel: merged.inverseLabel.trim(),
        color: merged.color
      }
      await db.relationshipTypes.put(updated)
      state.value.items = state.value.items.map(r => r.id === id ? updated : r)
    },

    async softDelete(id: string): Promise<void> {
      const existing = state.value.items.find(r => r.id === id)
      if (!existing) return
      const updated: RelationshipTypeRecord = { ...existing, deleted: true }
      await db.relationshipTypes.put(updated)
      state.value.items = state.value.items.map(r => r.id === id ? updated : r)
    },

    async restore(id: string): Promise<void> {
      const existing = state.value.items.find(r => r.id === id)
      if (!existing) return
      const updated: RelationshipTypeRecord = { ...existing, deleted: false }
      await db.relationshipTypes.put(updated)
      state.value.items = state.value.items.map(r => r.id === id ? updated : r)
    },

    async reorder(orderedIds: string[]): Promise<void> {
      await db.transaction('rw', db.relationshipTypes, async () => {
        const map = new Map(state.value.items.map(r => [r.id, r]))
        for (let i = 0; i < orderedIds.length; i++) {
          const id = orderedIds[i]
          const r = map.get(id)
          if (r) {
            const updated: RelationshipTypeRecord = { ...r, order: i }
            await db.relationshipTypes.put(updated)
            map.set(id, updated)
          }
        }
        state.value.items = Array.from(map.values())
      })
    },

    /** 仅供测试使用：重置模块级 state */
    _resetForTest(): void {
      state.value = { items: [], loaded: false }
    }
  }
}
