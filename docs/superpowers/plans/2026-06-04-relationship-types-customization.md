# 关系类型自定义 实施方案
> **面向智能体执行者：必须使用子技能**：通过 subagent-driven-development（推荐）或 executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
**目标**：将硬编码在 `src/types/relationship.ts` 的 6 组关系类型迁移到 IndexedDB 新表 `relationshipTypes`，提供设置页 UI 支持增/改/删/排序/软删
**架构**：Dexie v8 新表 + 单例 composable（`useRelationshipTypes`）作为运行时唯一数据源；`src/types/relationship.ts` 的查找函数从查表改为查 composable；设置页新增 `RelationshipTypesPanel` 组件做行内编辑
**技术栈**：Vue 3 Composition API + Dexie 4 + nanoid + Vitest + Vue Test Utils
---

## 任务结构总览

| 任务 | 内容 | 文件 |
|---|---|---|
| 1 | Dexie v8 升 schema + 关系类型记录类型 | `src/storage/db.ts` |
| 2 | 种子数据 | `src/config/relationship-types-seed.ts` |
| 3 | `useRelationshipTypes` composable + 测试 | `src/composables/useRelationshipTypes.ts` + `.test.ts` |
| 4 | `relationship.ts` 改造为查 composable | `src/types/relationship.ts` + `.test.ts` |
| 5 | `useRelationshipMenu` 改用 composable | `src/composables/useRelationshipMenu.ts` + `.test.ts` |
| 6 | `App.vue` 启动时加载 | `src/App.vue` |
| 7 | `RelationshipTypesPanel` 组件 | `src/components/Settings/RelationshipTypesPanel.vue` + `.test.ts` |
| 8 | `SettingsModal` 集成 | `src/components/Settings/SettingsModal.vue` |
| 9 | 编译检查 | — |

---

### 任务1：Dexie v8 升 schema
**涉及文件：**
- 修改：`d:\comind\comind\src\storage\db.ts`
- 测试：现有 `d:\comind\comind\src\storage\indexedDB.test.ts`（schema 升级后旧测试应仍通过；不需要新增）

- [ ] **步骤1：修改 db.ts 升 v8 + 加表**
```ts
// d:\comind\comind\src\storage\db.ts
import Dexie, { type Table } from 'dexie'
import type { BlockRecord } from '../types/block'
import type { LinkRecord } from '../types/link'
import type { PageRecord } from '../types/page'
import type { PropertyRecord } from '../types/property'
import type { Asset } from '../types/asset'

/** 关系类型记录（成对组） */
export interface RelationshipTypeRecord {
  /** 稳定主键；种子用 `rt_seed_<type>`，用户新建用 `rt_user_<nanoid>` */
  id: string
  /** 正向英文标识 */
  type: string
  /** 反向英文标识；自反为 null */
  inverse: string | null
  /** 正向中文标签 */
  label: string
  /** 反向中文标签 */
  inverseLabel: string
  /** 颜色，hex 格式 */
  color: string
  /** 排序权重，越小越靠前 */
  order: number
  /** 软删除标记 */
  deleted: boolean
  /** 是否内置默认（防止用户硬删后迁移重新插入） */
  builtin: boolean
}

export class ComindDB extends Dexie {
  blocks!: Table<BlockRecord, string>
  links!: Table<LinkRecord, string>
  pages!: Table<PageRecord, string>
  properties!: Table<PropertyRecord, string>
  assets!: Table<Asset, string>
  relationshipTypes!: Table<RelationshipTypeRecord, string>

  constructor() {
    super('comind')
    // 保留 version 7 兼容性（不破坏现有用户数据）
    this.version(7).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, relationshipType, createdAt',
      pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]',
      assets: 'id'
    })
    // version 8 新增 relationshipTypes 表
    this.version(8).stores({
      blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId, displayText, relationshipType, createdAt',
      pages: 'id, blockId, title, type, deleted, createdAt, updatedAt',
      properties: 'id, blockId, [blockId+key]',
      assets: 'id',
      relationshipTypes: 'id, type, deleted, builtin, order'
    })
  }
}

export const db = new ComindDB()
```

- [ ] **步骤2：运行现有测试确认无回归**
执行命令：`npx vitest run src/storage/`
预期结果：所有现有测试通过；不报错 "schema 升级失败"

- [ ] **步骤3：提交代码**
```bash
git add comind/src/storage/db.ts
git commit -m "feat(storage): add relationshipTypes table to Dexie v8"
```

---

### 任务2：种子数据
**涉及文件：**
- 新建：`d:\comind\comind\src\config\relationship-types-seed.ts`

- [ ] **步骤1：创建种子文件**
```ts
// d:\comind\comind\src\config\relationship-types-seed.ts
import type { RelationshipTypeRecord } from '../storage/db'

/**
 * 内置关系类型种子（首启写入 IndexedDB；用户修改后不会被覆盖）。
 * id 命名规则：`rt_seed_<type>`。
 */
export const RELATIONSHIP_TYPES_SEED: Omit<RelationshipTypeRecord, 'id' | 'order'>[] = [
  { type: 'parent',      inverse: 'child',         label: '父级', inverseLabel: '子级',     color: '#1890ff', deleted: false, builtin: true },
  { type: 'depends-on',  inverse: 'required-by',   label: '依赖', inverseLabel: '被依赖',   color: '#faad14', deleted: false, builtin: true },
  { type: 'references',  inverse: 'referenced-by', label: '引用', inverseLabel: '被引用',   color: '#52c41a', deleted: false, builtin: true },
  { type: 'example-of',  inverse: 'has-example',   label: '示例', inverseLabel: '有示例',   color: '#eb2f96', deleted: false, builtin: true },
  { type: 'related',     inverse: null,            label: '相关', inverseLabel: '相关',     color: '#8c8c8c', deleted: false, builtin: true },
  { type: 'similar',     inverse: null,            label: '相似', inverseLabel: '相似',     color: '#722ed1', deleted: false, builtin: true },
]
```

- [ ] **步骤2：提交代码**
```bash
git add comind/src/config/relationship-types-seed.ts
git commit -m "feat(config): add relationship types seed data"
```

---

### 任务3：useRelationshipTypes composable
**涉及文件：**
- 新建：`d:\comind\comind\src\composables\useRelationshipTypes.ts`
- 新建：`d:\comind\comind\src\composables\useRelationshipTypes.test.ts`

- [ ] **步骤1：编写失败测试用例**
```ts
// d:\comind\comind\src\composables\useRelationshipTypes.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import 'fake-indexeddb/auto'
import { db } from '../storage/db'
import { useRelationshipTypes, validateRelationshipTypeInput } from './useRelationshipTypes'
import { RELATIONSHIP_TYPES_SEED } from '../config/relationship-types-seed'

describe('useRelationshipTypes', () => {
  beforeEach(async () => {
    await db.relationshipTypes.clear()
    // 清除模块级 state
    const { _resetForTest } = useRelationshipTypes()
    _resetForTest()
  })

  afterEach(async () => {
    await db.relationshipTypes.clear()
  })

  describe('load', () => {
    it('空表时种入 6 条种子记录', async () => {
      const { load, all } = useRelationshipTypes()
      await load()
      expect(all.value).toHaveLength(6)
      expect(all.value[0].type).toBe('parent')
      expect(all.value[0].id).toBe('rt_seed_parent')
      expect(all.value[0].order).toBe(0)
      expect(all.value[0].builtin).toBe(true)
    })

    it('非空时不覆盖已有记录', async () => {
      // 预置一条用户修改过的种子
      await db.relationshipTypes.put({
        id: 'rt_seed_parent',
        type: 'parent',
        inverse: 'child',
        label: '上级（已修改）',
        inverseLabel: '下级（已修改）',
        color: '#000000',
        order: 0,
        deleted: false,
        builtin: true
      })
      const { load, all } = useRelationshipTypes()
      await load()
      const parent = all.value.find(r => r.type === 'parent')
      expect(parent?.label).toBe('上级（已修改）')
      // 其余 5 条种子应该被补齐
      expect(all.value).toHaveLength(6)
    })

    it('非空时为缺失的种子补齐', async () => {
      // 预置前 2 条种子
      await db.relationshipTypes.put({ id: 'rt_seed_parent', type: 'parent', inverse: 'child', label: '父级', inverseLabel: '子级', color: '#1890ff', order: 0, deleted: false, builtin: true })
      await db.relationshipTypes.put({ id: 'rt_seed_depends-on', type: 'depends-on', inverse: 'required-by', label: '依赖', inverseLabel: '被依赖', color: '#faad14', order: 1, deleted: false, builtin: true })
      const { load, all } = useRelationshipTypes()
      await load()
      expect(all.value).toHaveLength(6)
    })

    it('load 后 loaded 变为 true', async () => {
      const { load, loaded } = useRelationshipTypes()
      expect(loaded.value).toBe(false)
      await load()
      expect(loaded.value).toBe(true)
    })
  })

  describe('items（菜单用）', () => {
    it('过滤掉已软删的', async () => {
      const { load, create, softDelete, items } = useRelationshipTypes()
      await load()
      const custom = await create({ type: 'custom', inverse: null, label: '自定义', inverseLabel: '自定义', color: '#111111' })
      expect(items.value.find(r => r.type === 'custom')).toBeTruthy()
      await softDelete(custom.id)
      expect(items.value.find(r => r.type === 'custom')).toBeUndefined()
      // all 仍能看到
      const { all } = useRelationshipTypes()
      expect(all.value.find(r => r.type === 'custom')).toBeTruthy()
    })

    it('按 order 升序排列', async () => {
      const { load, items } = useRelationshipTypes()
      await load()
      const orders = items.value.map(r => r.order)
      expect(orders).toEqual([...orders].sort((a, b) => a - b))
    })
  })

  describe('create', () => {
    it('成功路径：写入 Dexie + 更新 state', async () => {
      const { load, create, all } = useRelationshipTypes()
      await load()
      const created = await create({ type: 'blocker', inverse: 'blocked-by', label: '阻塞', inverseLabel: '被阻塞', color: '#ff0000' })
      expect(created.id).toMatch(/^rt_user_/)
      expect(created.order).toBe(6)  // 6 种子后
      expect(created.builtin).toBe(false)
      expect(all.value.find(r => r.id === created.id)).toBeTruthy()
    })

    it('type 重复时抛出错误', async () => {
      const { load, create } = useRelationshipTypes()
      await load()
      await expect(create({ type: 'parent', inverse: null, label: 'X', inverseLabel: 'X', color: '#000' })).rejects.toThrow(/已存在/)
    })

    it('type 与已软删记录冲突时允许创建', async () => {
      const { load, create, softDelete } = useRelationshipTypes()
      await load()
      const c1 = await create({ type: 'tmp', inverse: null, label: 'A', inverseLabel: 'A', color: '#000' })
      await softDelete(c1.id)
      const c2 = await create({ type: 'tmp', inverse: null, label: 'B', inverseLabel: 'B', color: '#000' })
      expect(c2.id).not.toBe(c1.id)
    })

    it('label 为空时抛出错误', async () => {
      const { load, create } = useRelationshipTypes()
      await load()
      await expect(create({ type: 'x', inverse: null, label: '', inverseLabel: 'x', color: '#000' })).rejects.toThrow(/label/i)
    })

    it('color 格式错时抛出错误', async () => {
      const { load, create } = useRelationshipTypes()
      await load()
      await expect(create({ type: 'x', inverse: null, label: 'x', inverseLabel: 'x', color: 'red' })).rejects.toThrow(/color/i)
    })

    it('type 不符合正则时抛出错误', async () => {
      const { load, create } = useRelationshipTypes()
      await load()
      await expect(create({ type: 'Has-Cap', inverse: null, label: 'x', inverseLabel: 'x', color: '#000' })).rejects.toThrow(/type/i)
    })
  })

  describe('update', () => {
    it('成功路径：局部更新', async () => {
      const { load, update, all } = useRelationshipTypes()
      await load()
      const parent = all.value.find(r => r.type === 'parent')!
      await update(parent.id, { label: '上级' })
      const updated = all.value.find(r => r.id === parent.id)!
      expect(updated.label).toBe('上级')
    })

    it('type 改为与其他记录冲突时抛出错误', async () => {
      const { load, update, all } = useRelationshipTypes()
      await load()
      const parent = all.value.find(r => r.type === 'parent')!
      await expect(update(parent.id, { type: 'related' })).rejects.toThrow(/已存在/)
    })
  })

  describe('softDelete + restore', () => {
    it('softDelete 设置 deleted=true', async () => {
      const { load, softDelete, all } = useRelationshipTypes()
      await load()
      const parent = all.value.find(r => r.type === 'parent')!
      await softDelete(parent.id)
      expect(all.value.find(r => r.id === parent.id)?.deleted).toBe(true)
    })

    it('restore 恢复 deleted=false', async () => {
      const { load, softDelete, restore, all } = useRelationshipTypes()
      await load()
      const parent = all.value.find(r => r.type === 'parent')!
      await softDelete(parent.id)
      await restore(parent.id)
      expect(all.value.find(r => r.id === parent.id)?.deleted).toBe(false)
    })
  })

  describe('reorder', () => {
    it('按传入 id 顺序重写 order 字段', async () => {
      const { load, reorder, all } = useRelationshipTypes()
      await load()
      const ids = all.value.map(r => r.id)
      // 逆序
      const reversed = [...ids].reverse()
      await reorder(reversed)
      const after = all.value.map(r => r.id)
      expect(after).toEqual(reversed)
      const orders = all.value.map(r => r.order)
      expect(orders).toEqual([...orders].sort((a, b) => a - b))
    })
  })
})

describe('validateRelationshipTypeInput', () => {
  const existing = [
    { type: 'parent', inverse: 'child', label: '父级', inverseLabel: '子级', color: '#1890ff' }
  ]

  it('合法输入返回 null', () => {
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: '新', inverseLabel: '新', color: '#fff' }, existing)).toBeNull()
  })

  it('type 重复返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'parent', inverse: null, label: 'x', inverseLabel: 'x', color: '#000' }, existing)).toMatch(/已存在/)
  })

  it('label 空返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: '', inverseLabel: 'x', color: '#000' }, existing)).toMatch(/label/i)
  })

  it('inverseLabel 空返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: 'x', inverseLabel: '', color: '#000' }, existing)).toMatch(/label/i)
  })

  it('color 格式错返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'new', inverse: null, label: 'x', inverseLabel: 'x', color: 'red' }, existing)).toMatch(/color/i)
  })

  it('type 非法字符返回错误', () => {
    expect(validateRelationshipTypeInput({ type: 'Has_Cap', inverse: null, label: 'x', inverseLabel: 'x', color: '#000' }, existing)).toMatch(/type/i)
  })
})
```

- [ ] **步骤2：运行测试，验证执行失败**
执行命令：`npx vitest run src/composables/useRelationshipTypes.test.ts`
预期结果：执行失败，提示 `useRelationshipTypes is not defined` 或 `validateRelationshipTypeInput is not defined`

- [ ] **步骤3：编写实现代码**
```ts
// d:\comind\comind\src\composables\useRelationshipTypes.ts
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
const COLOR_REGEX = /^#[0-9a-fA-F]{6}$/

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
    }
  }
}

/** 仅供测试使用：重置模块级 state */
export function _resetForTest(): void {
  state.value = { items: [], loaded: false }
}
```

- [ ] **步骤4：安装 nanoid（如果尚未安装）**
执行命令：`cd d:\comind\comind && npm ls nanoid`
预期结果：若输出 `nanoid@x.x.x` 则已安装；否则执行 `npm install nanoid`

- [ ] **步骤5：运行测试，验证执行通过**
执行命令：`npx vitest run src/composables/useRelationshipTypes.test.ts`
预期结果：所有测试通过

- [ ] **步骤6：提交代码**
```bash
git add comind/src/composables/useRelationshipTypes.ts comind/src/composables/useRelationshipTypes.test.ts
git commit -m "feat(composables): add useRelationshipTypes with CRUD + load migration"
```

---

### 任务4：relationship.ts 改造为查 composable
**涉及文件：**
- 修改：`d:\comind\comind\src\types\relationship.ts`
- 修改：`d:\comind\comind\src\types\relationship.test.ts`

- [ ] **步骤1：重写 relationship.ts**
```ts
// d:\comind\comind\src\types\relationship.ts
import { useRelationshipTypes } from '../composables/useRelationshipTypes'

/** 关系组（菜单用；正反两条共享一条记录；自反 inverse 为 null） */
export interface RelationshipGroup {
  type: string
  inverse: string | null
  label: string
  inverseLabel: string
  color: string
}

/**
 * 兼容旧 API：返回 type 对应的展示信息。
 * 注：旧 PREDEFINED_RELATIONSHIPS 接口不再导出，因为新数据模型是"成对组"而非"单条记录"。
 */
export interface PredefinedRelationship {
  type: string
  inverse: string | null
  label: string
  inverseLabel: string
  color: string
}

function findByType(type: string): PredefinedRelationship | undefined {
  const all = useRelationshipTypes().all.value
  // 正向/反向都匹配
  const found = all.find(r => r.type === type || r.inverse === type)
  if (!found) return undefined
  const isForward = found.type === type
  return {
    type: found.type,
    inverse: found.inverse,
    label: isForward ? found.label : found.inverseLabel,
    inverseLabel: isForward ? found.inverseLabel : found.label,
    color: found.color
  }
}

export function getPredefinedRelationship(type: string): PredefinedRelationship | undefined {
  return findByType(type)
}

export function getInverseRelationshipType(type: string): string | null {
  return findByType(type)?.inverse ?? null
}

export function getRelationshipLabel(type: string): string {
  const all = useRelationshipTypes().all.value
  const found = all.find(r => r.type === type || r.inverse === type)
  if (!found) return type
  const isForward = found.type === type
  if (found.deleted) return `${isForward ? found.label : found.inverseLabel} (已删除)`
  return isForward ? found.label : found.inverseLabel
}

export function getRelationshipColor(type: string): string {
  const all = useRelationshipTypes().all.value
  const found = all.find(r => r.type === type || r.inverse === type)
  if (!found) return '#8c8c8c'
  if (found.deleted) return '#bfbfbf'
  return found.color
}

/** 根据 type 反查所属组 */
export function getGroupByType(type: string): RelationshipGroup | undefined {
  const items = useRelationshipTypes().items.value
  return items.find(g => g.type === type || g.inverse === type)
}

/** 判断 type 在组里是 forward 还是 inverse；自反为 forward；不存在为 null */
export function getDirectionInGroup(type: string): 'forward' | 'inverse' | null {
  const group = getGroupByType(type)
  if (!group) return null
  if (type === group.type) return 'forward'
  return 'inverse'
}
```

- [ ] **步骤2：更新 relationship.test.ts**
```ts
// d:\comind\comind\src\types\relationship.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import {
  getPredefinedRelationship,
  getGroupByType,
  getDirectionInGroup,
  getInverseRelationshipType,
  getRelationshipLabel,
  getRelationshipColor
} from './relationship'
import { useRelationshipTypes } from '../composables/useRelationshipTypes'

describe('relationship（运行时配置）', () => {
  beforeEach(async () => {
    const { _resetForTest, load } = useRelationshipTypes()
    _resetForTest()
    await load()
  })

  describe('getPredefinedRelationship', () => {
    it('正向 type 返回组信息', () => {
      const r = getPredefinedRelationship('parent')
      expect(r).toEqual({
        type: 'parent',
        inverse: 'child',
        label: '父级',
        inverseLabel: '子级',
        color: '#1890ff'
      })
    })

    it('反向 type 返回反向后的 label/inverseLabel', () => {
      const r = getPredefinedRelationship('child')
      expect(r).toEqual({
        type: 'parent',
        inverse: 'child',
        label: '子级',
        inverseLabel: '父级',
        color: '#1890ff'
      })
    })

    it('自反 type 返回自身', () => {
      const r = getPredefinedRelationship('related')
      expect(r?.type).toBe('related')
      expect(r?.inverse).toBeNull()
    })

    it('不存在返回 undefined', () => {
      expect(getPredefinedRelationship('not-exist')).toBeUndefined()
    })
  })

  describe('getGroupByType', () => {
    it('正向 type 找到组', () => {
      const g = getGroupByType('parent')
      expect(g?.type).toBe('parent')
    })

    it('反向 type 找到组', () => {
      const g = getGroupByType('child')
      expect(g?.type).toBe('parent')
    })

    it('自反 type 找到自身组', () => {
      const g = getGroupByType('related')
      expect(g?.type).toBe('related')
    })

    it('不存在返回 undefined', () => {
      expect(getGroupByType('not-exist')).toBeUndefined()
    })

    it('软删后不再被找到（items 不含已删）', async () => {
      const { softDelete, _resetForTest, load } = useRelationshipTypes()
      _resetForTest()
      await load()
      await softDelete('rt_seed_parent')
      expect(getGroupByType('parent')).toBeUndefined()
    })
  })

  describe('getDirectionInGroup', () => {
    it('正向 → forward', () => {
      expect(getDirectionInGroup('parent')).toBe('forward')
    })

    it('反向 → inverse', () => {
      expect(getDirectionInGroup('child')).toBe('inverse')
    })

    it('自反 → forward', () => {
      expect(getDirectionInGroup('related')).toBe('forward')
    })

    it('不存在 → null', () => {
      expect(getDirectionInGroup('not-exist')).toBeNull()
    })
  })

  describe('getInverseRelationshipType', () => {
    it('parent → child', () => {
      expect(getInverseRelationshipType('parent')).toBe('child')
    })

    it('child → parent', () => {
      expect(getInverseRelationshipType('child')).toBe('parent')
    })

    it('自反 → 自身', () => {
      expect(getInverseRelationshipType('related')).toBe('related')
    })

    it('不存在 → null', () => {
      expect(getInverseRelationshipType('not-exist')).toBeNull()
    })
  })

  describe('getRelationshipLabel', () => {
    it('返回正向中文标签', () => {
      expect(getRelationshipLabel('parent')).toBe('父级')
    })

    it('返回反向中文标签', () => {
      expect(getRelationshipLabel('child')).toBe('子级')
    })

    it('不存在返回 type 字符串', () => {
      expect(getRelationshipLabel('not-exist')).toBe('not-exist')
    })

    it('软删的 type 返回 "<label> (已删除)"', async () => {
      const { softDelete, _resetForTest, load } = useRelationshipTypes()
      _resetForTest()
      await load()
      await softDelete('rt_seed_parent')
      expect(getRelationshipLabel('parent')).toBe('父级 (已删除)')
    })
  })

  describe('getRelationshipColor', () => {
    it('返回预定义颜色', () => {
      expect(getRelationshipColor('parent')).toBe('#1890ff')
    })

    it('反向 type 同色', () => {
      expect(getRelationshipColor('child')).toBe('#1890ff')
    })

    it('不存在返回默认灰', () => {
      expect(getRelationshipColor('not-exist')).toBe('#8c8c8c')
    })

    it('软删的 type 返回灰色 #bfbfbf', async () => {
      const { softDelete, _resetForTest, load } = useRelationshipTypes()
      _resetForTest()
      await load()
      await softDelete('rt_seed_parent')
      expect(getRelationshipColor('parent')).toBe('#bfbfbf')
    })
  })
})
```

- [ ] **步骤3：运行测试，验证执行通过**
执行命令：`npx vitest run src/types/relationship.test.ts`
预期结果：所有测试通过

- [ ] **步骤4：提交代码**
```bash
git add comind/src/types/relationship.ts comind/src/types/relationship.test.ts
git commit -m "refactor(types): make relationship lookup functions runtime-driven"
```

---

### 任务5：useRelationshipMenu 改用 composable
**涉及文件：**
- 修改：`d:\comind\comind\src\composables\useRelationshipMenu.ts`
- 修改：`d:\comind\comind\src\composables\useRelationshipMenu.test.ts`

- [ ] **步骤1：替换 items 和查找来源为 composable**
修改 `d:\comind\comind\src\composables\useRelationshipMenu.ts`：

将顶部的 import 改为：
```ts
import { ref, computed } from 'vue'
import { useRelationshipTypes } from './useRelationshipTypes'
import { getGroupByType, getDirectionInGroup, type RelationshipGroup } from '../types/relationship'
```

将 `items` computed 改为：
```ts
const items = computed<RelationshipGroup[]>(() => {
  const all = useRelationshipTypes().items.value
  if (!state.value.query) return all
  const q = state.value.query.toLowerCase()
  return all.filter(g => {
    if (g.type.toLowerCase().includes(q)) return true
    if (g.inverse && g.inverse.toLowerCase().includes(q)) return true
    if (g.label.includes(q)) return true
    if (g.inverseLabel.includes(q)) return true
    return false
  })
})
```

将 `open()` 中 `getGroupByType(currentType)` 和 `findIndex(g => g === group)` 改为：
```ts
if (currentType) {
  const group = getGroupByType(currentType)
  const dir = getDirectionInGroup(currentType)
  if (group && dir) {
    const all = useRelationshipTypes().items.value
    const idx = all.findIndex(g => g.type === group.type)
    if (idx >= 0) {
      selectedGroupIndex = idx
      selectedDirection = dir
    }
  }
}
```

- [ ] **步骤2：更新 useRelationshipMenu.test.ts 适配新 import**
修改 `d:\comind\comind\src\composables\useRelationshipMenu.test.ts`：

将顶部 import 改为：
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { useRelationshipMenu } from './useRelationshipMenu'
import { useRelationshipTypes } from './useRelationshipTypes'
import { getGroupByType } from '../types/relationship'
```

在文件顶部、`describe` 之前加 `beforeEach`：
```ts
beforeEach(async () => {
  const { _resetForTest, load } = useRelationshipTypes()
  _resetForTest()
  await load()
})
```

将 `it('open 带 currentType 会预选到对应组和方向', ...)` 中 `RELATIONSHIP_GROUPS.findIndex(g => g === group)` 改为：
```ts
const items = useRelationshipTypes().items.value
const idx = items.findIndex(g => g.type === group!.type)
```

并在文件末尾追加以下测试：
```ts
describe('useRelationshipMenu 与 useRelationshipTypes 联动', () => {
  it('创建新类型后菜单 items 立即出现', async () => {
    const menu = useRelationshipMenu()
    menu.close()
    const { create } = useRelationshipTypes()
    await create({ type: 'blocker', inverse: 'blocked-by', label: '阻塞', inverseLabel: '被阻塞', color: '#ff0000' })
    expect(menu.items.value.find(g => g.type === 'blocker')).toBeTruthy()
  })

  it('软删后菜单 items 不再包含', async () => {
    const menu = useRelationshipMenu()
    menu.close()
    const { softDelete } = useRelationshipTypes()
    await softDelete('rt_seed_parent')
    expect(menu.items.value.find(g => g.type === 'parent')).toBeUndefined()
  })

  it('恢复后菜单 items 重新包含', async () => {
    const menu = useRelationshipMenu()
    menu.close()
    const { softDelete, restore } = useRelationshipTypes()
    await softDelete('rt_seed_parent')
    await restore('rt_seed_parent')
    expect(menu.items.value.find(g => g.type === 'parent')).toBeTruthy()
  })
})
```

- [ ] **步骤3：运行测试，验证执行通过**
执行命令：`npx vitest run src/composables/useRelationshipMenu.test.ts`
预期结果：所有测试通过

- [ ] **步骤4：提交代码**
```bash
git add comind/src/composables/useRelationshipMenu.ts comind/src/composables/useRelationshipMenu.test.ts
git commit -m "refactor(menu): useRelationshipMenu reads from useRelationshipTypes"
```

---

### 任务6：App.vue 启动时加载
**涉及文件：**
- 修改：`d:\comind\comind\src\App.vue`

- [ ] **步骤1：在 App.vue 中添加 load() 调用**
在 `d:\comind\comind\src\App.vue` 顶部 import 区追加：
```ts
import { useRelationshipTypes } from './composables/useRelationshipTypes'
```

在 `script setup` 区域、`const { isCollapsed, toggle } = useSidebar()` 之后追加：
```ts
onMounted(async () => {
  await useRelationshipTypes().load()
})
```

确认已 import 了 `onMounted`（现有 import 是 `import { ref, computed, watch } from 'vue'`，需改为 `import { ref, computed, watch, onMounted } from 'vue'`）。

- [ ] **步骤2：编译检查**
执行命令：`cd d:\comind\comind && npx vue-tsc -b`
预期结果：无类型错误

- [ ] **步骤3：提交代码**
```bash
git add comind/src/App.vue
git commit -m "feat(app): load relationship types on startup"
```

---

### 任务7：RelationshipTypesPanel 组件
**涉及文件：**
- 新建：`d:\comind\comind\src\components\Settings\RelationshipTypesPanel.vue`
- 新建：`d:\comind\comind\src\components\Settings\RelationshipTypesPanel.test.ts`

- [ ] **步骤1：编写组件**
```vue
<!-- d:\comind\comind\src\components\Settings\RelationshipTypesPanel.vue -->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { ArrowUp, ArrowDown, Pencil, Trash2, Plus, ChevronDown, ChevronRight, Undo2, X, Check } from 'lucide-vue-next'
import { useRelationshipTypes, validateRelationshipTypeInput, type RelationshipTypeInput } from '../../composables/useRelationshipTypes'

const { all, create, update, softDelete, restore, reorder } = useRelationshipTypes()

interface EditState {
  /** 列表渲染 key；新建时为临时字符串 */
  rowKey: string
  type: string
  /** 编辑态下始终是 string（v-model 需要），空串代表 null */
  inverse: string
  label: string
  inverseLabel: string
  color: string
  /** null 表示新增；string 表示编辑的记录 id */
  originalId: string | null
  isNew: boolean
}

const editingKey = ref<string | null>(null)
const editState = ref<EditState | null>(null)

const showDeleted = ref(false)
const deletedItems = computed(() => all.value.filter(r => r.deleted))
const activeItems = computed(() => all.value.filter(r => !r.deleted))

interface Toast {
  id: string
  recordId: string
}
const toasts = ref<Toast[]>([])

function startEdit(id: string): void {
  const r = all.value.find(x => x.id === id)
  if (!r) return
  editingKey.value = id
  editState.value = {
    rowKey: id,
    type: r.type,
    inverse: r.inverse ?? '',
    label: r.label,
    inverseLabel: r.inverseLabel,
    color: r.color,
    originalId: id,
    isNew: false
  }
}

function startNew(): void {
  const tempKey = `temp_new_${Date.now()}`
  editingKey.value = tempKey
  editState.value = {
    rowKey: tempKey,
    type: '',
    inverse: '',
    label: '',
    inverseLabel: '',
    color: '#1890ff',
    originalId: null,
    isNew: true
  }
}

function cancelEdit(): void {
  editingKey.value = null
  editState.value = null
}

const validateResult = computed<string | null>(() => {
  if (!editState.value) return null
  return validateRelationshipTypeInput(
    {
      type: editState.value.type,
      inverse: editState.value.inverse.trim() || null,
      label: editState.value.label,
      inverseLabel: editState.value.inverseLabel,
      color: editState.value.color
    },
    all.value
      .filter(r => r.id !== editState.value?.originalId)
      .map(r => ({ type: r.type, deleted: r.deleted }))
  )
})

const canSave = computed(() => validateResult.value === null)

async function saveEdit(): Promise<void> {
  if (!editState.value || !canSave.value) return
  const s = editState.value
  const input: RelationshipTypeInput = {
    type: s.type,
    inverse: s.inverse.trim() || null,
    label: s.label.trim(),
    inverseLabel: s.inverseLabel.trim(),
    color: s.color
  }
  if (s.isNew) {
    await create(input)
  } else {
    await update(s.originalId!, input)
  }
  cancelEdit()
}

function onDelete(id: string): void {
  const toast: Toast = { id: `t_${Date.now()}_${Math.random()}`, recordId: id }
  toasts.value = [...toasts.value, toast]
  softDelete(id)
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== toast.id)
  }, 5000)
}

function onUndo(recordId: string): void {
  restore(recordId)
  toasts.value = toasts.value.filter(t => t.recordId !== recordId)
}

function moveUp(id: string): void {
  const list = activeItems.value
  const idx = list.findIndex(r => r.id === id)
  if (idx <= 0) return
  const newOrder = [...list]
  ;[newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]]
  reorder(newOrder.map(r => r.id))
}

function moveDown(id: string): void {
  const list = activeItems.value
  const idx = list.findIndex(r => r.id === id)
  if (idx < 0 || idx >= list.length - 1) return
  const newOrder = [...list]
  ;[newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]]
  reorder(newOrder.map(r => r.id))
}
</script>

<template>
  <div class="rel-types-panel">
    <div class="rel-list">
      <div
        v-for="(r, idx) in activeItems"
        :key="r.id"
        class="rel-row"
        :class="{ 'rel-row--editing': editingKey === r.id }"
      >
        <template v-if="editingKey === r.id && editState && !editState.isNew">
          <div class="rel-edit-grid">
            <input v-model="editState.type" class="rel-input" placeholder="type (英文)" />
            <input v-model="editState.inverse" class="rel-input" placeholder="inverse (可空)" />
            <input v-model="editState.label" class="rel-input" placeholder="正向中文标签" />
            <input v-model="editState.inverseLabel" class="rel-input" placeholder="反向中文标签" />
            <input v-model="editState.color" class="rel-input rel-input--color" placeholder="#hex" />
            <div class="rel-edit-actions">
              <button class="rel-btn rel-btn--primary" :disabled="!canSave" @click="saveEdit">
                <Check :size="12" :stroke-width="2" /> 保存
              </button>
              <button class="rel-btn" @click="cancelEdit">
                <X :size="12" :stroke-width="2" /> 取消
              </button>
            </div>
          </div>
          <div v-if="!canSave" class="rel-error">{{ validateResult }}</div>
        </template>

        <template v-else>
          <div class="rel-sort">
            <button class="rel-icon-btn" :disabled="idx === 0" title="上移" @click="moveUp(r.id)">
              <ArrowUp :size="12" :stroke-width="1.75" />
            </button>
            <button class="rel-icon-btn" :disabled="idx === activeItems.length - 1" title="下移" @click="moveDown(r.id)">
              <ArrowDown :size="12" :stroke-width="1.75" />
            </button>
          </div>
          <div class="rel-labels">
            <span class="rel-label">{{ r.label }}</span>
            <span class="rel-sep">/</span>
            <span class="rel-label">{{ r.inverseLabel }}</span>
          </div>
          <div class="rel-color-block" :style="{ background: r.color }" :title="r.color"></div>
          <div class="rel-actions">
            <button class="rel-icon-btn" title="编辑" @click="startEdit(r.id)">
              <Pencil :size="12" :stroke-width="1.75" />
            </button>
            <button class="rel-icon-btn" title="删除" @click="onDelete(r.id)">
              <Trash2 :size="12" :stroke-width="1.75" />
            </button>
          </div>
        </template>
      </div>

      <!-- 新增行（编辑态） -->
      <div v-if="editState?.isNew" class="rel-row rel-row--editing rel-row--new">
        <div class="rel-edit-grid">
          <input v-model="editState.type" class="rel-input" placeholder="type (英文)" />
          <input v-model="editState.inverse" class="rel-input" placeholder="inverse (可空)" />
          <input v-model="editState.label" class="rel-input" placeholder="正向中文标签" />
          <input v-model="editState.inverseLabel" class="rel-input" placeholder="反向中文标签" />
          <input v-model="editState.color" class="rel-input rel-input--color" placeholder="#hex" />
          <div class="rel-edit-actions">
            <button class="rel-btn rel-btn--primary" :disabled="!canSave" @click="saveEdit">
              <Check :size="12" :stroke-width="2" /> 保存
            </button>
            <button class="rel-btn" @click="cancelEdit">
              <X :size="12" :stroke-width="2" /> 取消
            </button>
          </div>
        </div>
        <div v-if="!canSave" class="rel-error">{{ validateResult }}</div>
      </div>

      <button class="rel-add-btn" @click="startNew">
        <Plus :size="12" :stroke-width="2" />
        新增关系类型
      </button>
    </div>

    <div v-if="deletedItems.length > 0" class="rel-deleted-section">
      <button class="rel-deleted-toggle" @click="showDeleted = !showDeleted">
        <ChevronDown v-if="showDeleted" :size="12" :stroke-width="1.75" />
        <ChevronRight v-else :size="12" :stroke-width="1.75" />
        已删除（{{ deletedItems.length }}）
      </button>
      <div v-if="showDeleted" class="rel-deleted-list">
        <div v-for="r in deletedItems" :key="r.id" class="rel-row rel-row--deleted">
          <div class="rel-labels">
            <span class="rel-label">{{ r.label }}</span>
            <span class="rel-sep">/</span>
            <span class="rel-label">{{ r.inverseLabel }}</span>
          </div>
          <div class="rel-color-block" :style="{ background: r.color }"></div>
          <div class="rel-actions">
            <button class="rel-btn" @click="restore(r.id)">
              <Undo2 :size="12" :stroke-width="1.75" /> 恢复
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="toasts.length > 0" class="rel-toast-area">
      <div v-for="t in toasts" :key="t.id" class="rel-toast">
        已删除
        <button class="rel-toast-undo" @click="onUndo(t.recordId)">撤销</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rel-types-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.rel-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.rel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
  transition: opacity 150ms ease;
}

.rel-row--editing {
  flex-direction: column;
  align-items: stretch;
}

.rel-row--deleted {
  opacity: 0.5;
}

.rel-row--new {
  background: var(--bg-hover);
}

.rel-sort {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.rel-icon-btn {
  width: 22px;
  height: 18px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text-secondary);
  border-radius: 3px;
  cursor: pointer;
  font-family: inherit;
}

.rel-icon-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.rel-icon-btn:not(:disabled):hover {
  background: var(--bg-active);
  color: var(--text-primary);
}

.rel-labels {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.rel-label {
  color: var(--text-primary);
}

.rel-sep {
  color: var(--text-tertiary);
}

.rel-color-block {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.rel-actions {
  display: flex;
  gap: 4px;
}

.rel-edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr 90px auto;
  gap: 6px;
  align-items: center;
}

.rel-input {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-base);
  color: var(--text-primary);
  font-size: 12px;
  font-family: inherit;
}

.rel-input:focus {
  outline: none;
  border-color: var(--accent);
}

.rel-input--color {
  font-family: monospace;
}

.rel-edit-actions {
  display: flex;
  gap: 4px;
}

.rel-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-secondary);
  font-family: inherit;
}

.rel-btn--primary {
  background: var(--accent);
  color: var(--color-paper);
  border-color: var(--accent);
}

.rel-btn--primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.rel-btn:not(:disabled):hover {
  background: var(--bg-active);
}

.rel-error {
  margin-top: 4px;
  font-size: 11px;
  color: #ff4d4f;
}

.rel-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: transparent;
  border: 1px dashed var(--border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  font-family: inherit;
  align-self: flex-start;
}

.rel-add-btn:hover {
  background: var(--bg-hover);
  border-color: var(--text-tertiary);
}

.rel-deleted-section {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.rel-deleted-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 11px;
  color: var(--text-tertiary);
  font-family: inherit;
}

.rel-deleted-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.rel-toast-area {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0 0;
}

.rel-toast {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: var(--bg-active);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
  align-self: flex-start;
}

.rel-toast-undo {
  background: transparent;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  padding: 0;
  text-decoration: underline;
}
</style>
```

- [ ] **步骤2：抽出常量到独立文件**
新建 `d:\comind\comind\src\composables\relationship-type-constants.ts`：
```ts
export const TYPE_REGEX = /^[a-z][a-z0-9-]*$/
export const COLOR_REGEX = /^#[0-9a-fA-F]{6}$/
```

修改 `d:\comind\comind\src\composables\useRelationshipTypes.ts`：删除顶部 `const TYPE_REGEX`/`COLOR_REGEX`，改为：
```ts
import { TYPE_REGEX, COLOR_REGEX } from './relationship-type-constants'
```

- [ ] **步骤3：编写组件测试**
```ts
// d:\comind\comind\src\components\Settings\RelationshipTypesPanel.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import 'fake-indexeddb/auto'
import RelationshipTypesPanel from './RelationshipTypesPanel.vue'
import { useRelationshipTypes } from '../../composables/useRelationshipTypes'

function mountPanel() {
  return mount(RelationshipTypesPanel, {
    global: {
      stubs: {
        ArrowUp: true,
        ArrowDown: true,
        Pencil: true,
        Trash2: true,
        Plus: true,
        ChevronDown: true,
        ChevronRight: true,
        Undo2: true,
        X: true,
        Check: true
      }
    }
  })
}

describe('RelationshipTypesPanel', () => {
  beforeEach(async () => {
    const { _resetForTest, load } = useRelationshipTypes()
    _resetForTest()
    await load()
  })

  it('渲染 6 个内置关系类型', () => {
    const wrapper = mountPanel()
    const rows = wrapper.findAll('.rel-row')
    expect(rows.length).toBeGreaterThanOrEqual(6)
    expect(wrapper.text()).toContain('父级')
    expect(wrapper.text()).toContain('依赖')
  })

  it('点编辑切换为编辑态', async () => {
    const wrapper = mountPanel()
    const editButtons = wrapper.findAll('[title="编辑"]')
    expect(editButtons.length).toBeGreaterThan(0)
    await editButtons[0].trigger('click')
    expect(wrapper.find('.rel-row--editing').exists()).toBe(true)
    expect(wrapper.find('input[placeholder*="type"]').exists()).toBe(true)
  })

  it('点删除出现 toast', async () => {
    const wrapper = mountPanel()
    const deleteButtons = wrapper.findAll('[title="删除"]')
    expect(deleteButtons.length).toBeGreaterThan(0)
    await deleteButtons[0].trigger('click')
    expect(wrapper.find('.rel-toast').exists()).toBe(true)
  })

  it('点 + 新增关系类型出现空编辑行', async () => {
    const wrapper = mountPanel()
    const addBtn = wrapper.find('.rel-add-btn')
    expect(addBtn.exists()).toBe(true)
    await addBtn.trigger('click')
    expect(wrapper.find('.rel-row--new').exists()).toBe(true)
  })

  it('软删的 type 不出现在主列表，但出现在"已删除"分组', async () => {
    const wrapper = mountPanel()
    const { softDelete } = useRelationshipTypes()
    await softDelete('rt_seed_parent')
    await wrapper.vm.$nextTick()
    // 列表不再含 parent（标签 "父级"）
    const rows = wrapper.findAll('.rel-row:not(.rel-row--deleted)')
    const text = rows.map(r => r.text()).join('')
    expect(text).not.toContain('父级')
    // 已删除分组有
    const deletedToggle = wrapper.find('.rel-deleted-toggle')
    expect(deletedToggle.exists()).toBe(true)
    expect(deletedToggle.text()).toContain('已删除（1）')
  })
})
```

- [ ] **步骤4：运行测试，验证执行通过**
执行命令：`npx vitest run src/components/Settings/RelationshipTypesPanel.test.ts`
预期结果：所有测试通过

- [ ] **步骤5：编译检查**
执行命令：`npx vue-tsc -b`
预期结果：无类型错误

- [ ] **步骤6：提交代码**
```bash
git add comind/src/components/Settings/RelationshipTypesPanel.vue comind/src/components/Settings/RelationshipTypesPanel.test.ts comind/src/composables/relationship-type-constants.ts comind/src/composables/useRelationshipTypes.ts
git commit -m "feat(settings): add RelationshipTypesPanel component"
```

---

### 任务8：SettingsModal 集成
**涉及文件：**
- 修改：`d:\comind\comind\src\components\Settings\SettingsModal.vue`

- [ ] **步骤1：在 SettingsModal 中添加"关系类型"section**
修改 `d:\comind\comind\src\components\Settings\SettingsModal.vue`：

将 `import { useTheme } from '../../composables/useTheme'` 改为：
```ts
import { useTheme } from '../../composables/useTheme'
import RelationshipTypesPanel from './RelationshipTypesPanel.vue'
```

将 `type Section = 'appearance' | 'editor' | 'data' | 'about'` 改为：
```ts
type Section = 'appearance' | 'editor' | 'relationships' | 'data' | 'about'
```

将 `sections` 数组改为：
```ts
const sections: { key: Section; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'editor', label: '编辑器' },
  { key: 'relationships', label: '关系类型' },
  { key: 'data', label: '数据管理' },
  { key: 'about', label: '关于' },
]
```

在 `<template v-if="activeSection === 'editor'">` 之后插入：
```vue
<template v-if="activeSection === 'relationships'">
  <div class="setting-item setting-item--column">
    <div class="setting-info">
      <span class="setting-label">关系类型</span>
      <span class="setting-desc">管理编辑时 <code>^</code> 触发的关系菜单中显示的关系类型</span>
    </div>
    <RelationshipTypesPanel />
  </div>
</template>
```

在 `<style scoped>` 中追加（如果 `.setting-item--column` 不存在）：
```scss
.setting-item--column {
  flex-direction: column;
  align-items: stretch;
  gap: 12px;
}
```

- [ ] **步骤2：编译检查**
执行命令：`npx vue-tsc -b`
预期结果：无类型错误

- [ ] **步骤3：提交代码**
```bash
git add comind/src/components/Settings/SettingsModal.vue
git commit -m "feat(settings): integrate RelationshipTypesPanel into settings modal"
```

---

### 任务9：完整编译与测试
**涉及文件：** —

- [ ] **步骤1：全量类型检查**
执行命令：`cd d:\comind\comind && npx vue-tsc -b`
预期结果：无类型错误

- [ ] **步骤2：全量单元测试**
执行命令：`npx vitest run`
预期结果：所有测试通过

- [ ] **步骤3：构建**
执行命令：`npm run build`
预期结果：构建成功

- [ ] **步骤4：lint**
执行命令：`npm run lint`
预期结果：无错误

- [ ] **步骤5：E2E（手动/可选）**
执行命令：`npx playwright test`
预期结果：现有 E2E 通过；新功能通过

- [ ] **步骤6：最终提交（如有未提交修改）**
```bash
git status
# 如有未提交：
git add -A
git commit -m "chore: finalize relationship types customization"
```

---

## 验收对照

- [ ] `relationshipTypes` 表存在且首启时自动种入 6 条
- [ ] 设置页可增/改/删任意关系类型
- [ ] 增/改/删后，关系菜单立即响应
- [ ] 软删的 type 不出现在菜单，但 link 渲染兜底"已删除"
- [ ] 全部现有 E2E 测试通过（rel-type-label 切换、菜单、wiki-link 等）
- [ ] 全部现有单元测试通过
- [ ] `npm run build` 成功
- [ ] 新增 ≥ 3 个单元测试用例覆盖关键逻辑（实际新增 12+ 个 useRelationshipTypes 测试 + 6+ 个 relationship.test.ts 测试 + 5 个面板测试）
