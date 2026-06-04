# 关系类型自定义设计

## 背景

当前 6 个关系组（父级/子级、依赖/被依赖、引用/被引用、示例/有示例、相关、相似）硬编码在 `src/types/relationship.ts` 中。`useRelationshipMenu` 通过 `RELATIONSHIP_GROUPS` 常量获取菜单项，渲染侧通过 `getRelationshipLabel`/`getRelationshipColor` 查表。

需求：
- 用户在设置页增/改/删任意关系类型
- 把硬编码配置迁出代码主体，作为"种子"独立存放
- 数据持久化到 IndexedDB，跨会话保留

## 方案选择

### 存储：Dexie v8 新表 `relationshipTypes`

**理由**：
- 与现有 5 张表（blocks/links/pages/properties/assets）数据模型一致
- 关系类型被 link 表通过 `relationshipType` 字段外键引用，存在 IndexedDB 便于后续做"删除前检查引用计数"等查询
- 配置数据量小（< 100 条），不存在性能问题

**不选 localStorage 的理由**：和项目主数据分离，不利于"清空所有数据"等操作；与现有数据模型不一致。

**不选静态 JSON 配置文件手动编辑的理由**：用户要求"完整：可增/改/删所有"，明显期望 UI 交互式编辑；JSON 手动编辑模式无法满足 UI 增删改需求。

### 删除处理：软删除（`deleted: boolean`）

**理由**：
- 已有 link 数据中可能存了被删除类型的 `relationshipType` 字符串
- 软删除保证不破坏 link 数据完整性
- 渲染时通过 `getRelationshipLabel` 兜底返回原 type 字符串 + 灰色"未知/已删除"提示

**不选级联删除/重映射的理由**：丢失语义，用户删除时本意是"不再使用这个标签"，不是"删除所有 link"。

### 数据模型：成对组

**理由**：与现有 `RELATIONSHIP_GROUPS` 设计一致（正反两条共享一条记录）。自反关系用 `inverse: null` 表示。

### UI 形态：设置页内行内编辑

**理由**：用户明确要求"在设置界面内部建立列表编辑"。列表显示所有关系组，点编辑后字段变可输入，保存写回 IndexedDB。

## 数据层

### 新表 schema

```ts
// src/storage/db.ts 升级到 version 8
this.version(8).stores({
  // ... 原有 5 表
  relationshipTypes: 'id, type, deleted, builtin, order'
})
```

### 记录结构

```ts
interface RelationshipTypeRecord {
  /** 主键：稳定 ID，与 type 解耦（type 改名不重生成 id） */
  id: string
  /** 正向英文标识，全局唯一（除已软删） */
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
```

**id 命名规则**：
- 种子：`id = 'rt_seed_' + type`（如 `rt_seed_parent`）
- 用户新建：`id = 'rt_user_' + nanoid()`（如 `rt_user_VnMxKx`）

如此可一眼区分种子和用户数据，且 `rt_seed_<type>` 的 id 规则允许迁移逻辑按 type 查询。

### 种子数据

新文件 `src/config/relationship-types-seed.ts`：

```ts
import type { RelationshipTypeRecord } from '../storage/db'

export const RELATIONSHIP_TYPES_SEED: Omit<RelationshipTypeRecord, 'id' | 'order'>[] = [
  { type: 'parent',      inverse: 'child',         label: '父级', inverseLabel: '子级',     color: '#1890ff', deleted: false, builtin: true },
  { type: 'depends-on',  inverse: 'required-by',   label: '依赖', inverseLabel: '被依赖',   color: '#faad14', deleted: false, builtin: true },
  { type: 'references',  inverse: 'referenced-by', label: '引用', inverseLabel: '被引用',   color: '#52c41a', deleted: false, builtin: true },
  { type: 'example-of',  inverse: 'has-example',   label: '示例', inverseLabel: '有示例',   color: '#eb2f96', deleted: false, builtin: true },
  { type: 'related',     inverse: null,            label: '相关', inverseLabel: '相关',     color: '#8c8c8c', deleted: false, builtin: true },
  { type: 'similar',     inverse: null,            label: '相似', inverseLabel: '相似',     color: '#722ed1', deleted: false, builtin: true },
]
```

### 迁移逻辑

首次启动（`onAppStart`）：

1. 查询 `relationshipTypes` 表全部记录
2. 如果为空 → 把 `RELATIONSHIP_TYPES_SEED` 全部插入，每条 `id = 'rt_' + seed.type`，`order` 按数组下标
3. 如果非空 → 对每个 seed，查询 `id = 'rt_' + seed.type` 是否存在；不存在则插入（用于版本演进时补充新默认）

迁移时机：App.vue `onMounted` 中 `await useRelationshipTypes().load()`，完成后才渲染。

## 状态层

### `useRelationshipTypes` composable

新文件 `src/composables/useRelationshipTypes.ts`：

```ts
const state = ref<{
  items: RelationshipTypeRecord[]
  loaded: boolean
}>({ items: [], loaded: false })

export function useRelationshipTypes() {
  return {
    /** 菜单用：仅未软删 */
    items: computed(() =>
      state.value.items
        .filter(r => !r.deleted)
        .sort((a, b) => a.order - b.order)
    ),
    /** 设置页用：全部（含已软删），按 order 排序 */
    all: computed(() =>
      [...state.value.items].sort((a, b) => a.order - b.order)
    ),
    loaded: computed(() => state.value.loaded),
    load,        // 启动时调用：检查 + 种子迁移 + 加载到 state
    create,      // 新增：客户端校验 + Dexie put + 更新 state
    update,      // 编辑：客户端校验 + Dexie put + 更新 state
    softDelete,  // 软删
    restore,     // 恢复
    reorder,     // 调整顺序（批量更新 order 字段）
  }
}
```

`load()` 内部：
1. `await db.relationshipTypes.toArray()`
2. 若数组为空，循环 `db.relationshipTypes.put(seed)` 写入种子（每条 `id = 'rt_seed_' + seed.type`，`order` 按数组下标）
3. 若非空，对每个 seed 查 `id = 'rt_seed_' + seed.type` 是否存在；不存在则 put（用于版本演进时补充新默认）
4. 完成后 `state.value.items = toArray()`，`loaded = true`

`create(input)`：
1. 校验：`type` 唯一（除 `deleted=true` 的）、`label` 非空
2. `id = 'rt_user_' + nanoid()`，`order = max(existing.order) + 1`
3. `db.relationshipTypes.put(record)` + 更新 state

`update(id, patch)`：
1. 校验同 create
2. `db.relationshipTypes.put({ ...existing, ...patch })` + 更新 state

`softDelete(id)`：设置 `deleted=true` + put + 更新 state

`restore(id)`：设置 `deleted=false` + put + 更新 state

`reorder(orderedIds)`：用 `db.transaction('rw', db.relationshipTypes, ...)` 事务内按传入顺序遍历，每条 `put` 新的 `order = index`，最后刷新 state。

## 消费侧迁移

### `src/types/relationship.ts` 改造

**移除**：
- `PREDEFINED_RELATIONSHIPS` 常量
- `RELATIONSHIP_GROUPS` 常量
- `RELATIONSHIP_COLORS` 常量

**保留并改造**：
- `PredefinedRelationship` 接口（保持向后兼容的字段，但标注 deprecated）
- `getPredefinedRelationship(type)`：改为查 `useRelationshipTypes().items`
- `getInverseRelationshipType(type)`：同上
- `getRelationshipLabel(type)`：同上 + 软删兜底（返回 `type + ' (已删除)'`）
- `getRelationshipColor(type)`：同上 + 软删兜底（灰色 `#bfbfbf`）

**新增**：
- `getGroupByType`、`getDirectionInGroup`：从 `useRelationshipMenu` 抽到此处，内部查 `useRelationshipTypes().items`

### `useRelationshipMenu.ts` 改造

`items` computed 来源从 `RELATIONSHIP_GROUPS` 改为 `useRelationshipTypes().items.value`。

`open()` 中 `getGroupByType`/`getDirectionInGroup`/`findIndex` 的查找目标从常量改为 `useRelationshipTypes().items.value`。

### 启动时序

`App.vue`：

```vue
<script setup>
import { onMounted } from 'vue'
import { useRelationshipTypes } from './composables/useRelationshipTypes'

onMounted(async () => {
  await useRelationshipTypes().load()
})
</script>
```

模板加 `v-if="!loaded"` 的加载占位符？**否**：保持现状让组件自然渲染，初次 `items` 为空时菜单为空列表即可（用户感知是"未配置"），等 IndexedDB 返回后自动 reactive 更新。

## UI 层（设置页）

### `SettingsModal.vue` 新增 section

在"编辑器"和"数据管理"之间插入"关系类型" section。

```vue
<section class="settings-section">
  <h3>关系类型</h3>
  <p class="settings-section-desc">
    管理编辑时 <code>^</code> 触发的关系菜单中显示的关系类型。
  </p>
  <RelationshipTypesPanel />
</section>
```

### `RelationshipTypesPanel.vue` 组件结构

新文件 `src/components/Settings/RelationshipTypesPanel.vue`：

```
┌─────────────────────────────────────────────────────┐
│ [↑] [↓] 父级  /  子级   [█#1890ff]    [编辑]  [删除] │
│ [↑] [↓] 依赖  /  被依赖 [█#faad14]    [编辑]  [删除] │
│ [↑] [↓] 引用  /  被引用 [█#52c41a]    [编辑]  [删除] │
│ [↑] [↓] 示例  /  有示例 [█#eb2f96]    [编辑]  [删除] │
│ [↑] [↓] 相关  /  相关   [█#8c8c8c]    [编辑]  [删除] │
│ [↑] [↓] 相似  /  相似   [█#722ed1]    [编辑]  [删除] │
│                                                     │
│ [+ 新增关系类型]                                   │
│                                                     │
│ ──────────────────────────────────────────────────  │
│ 已删除（1）  [展开 ▾]                               │
│   自定义类型 / 反向  [█#000000]  [恢复]            │
└─────────────────────────────────────────────────────┘
```

第一行 `[↑]` 禁用，最后一行 `[↓]` 禁用。

### 行内编辑模式

点"编辑"→ 当前行字段变 `<input>`：

```
┌─────────────────────────────────────────────────────┐
│ ⠿ [parent       ] / [child       ] [输入颜色]      │
│    [父级         ] / [子级         ]                │
│    [保存]  [取消]                                    │
└─────────────────────────────────────────────────────┘
```

校验：
- `type` 必填，英文小写 + `-`（正则 `^[a-z][a-z0-9-]*$`）
- `label`、`inverseLabel` 必填，非空
- `type` 全局唯一（`useRelationshipTypes().all` 中除自身外不重复）
- `color` hex 格式（`#[0-9a-fA-F]{6}`）

校验失败时保存按钮禁用 + 字段下方红字提示。

### 新增

点"+ 新增关系类型"→ 列表底部插入编辑态行（`type/inverse/label/inverseLabel/color` 全空，`builtin=false`，`id='rt_user_'+nanoid()`）。

### 软删除 + 撤销

点"删除"→ 该行变灰（`opacity: 0.5`），**在 RelationshipTypesPanel 内部底部** 出现 toast "已删除 [撤销]"，5 秒后消失。toast 生命周期由面板内部状态管理，与全局 toast 系统解耦。

撤销 → 调用 `restore(id)`。

"已删除"分组默认折叠，点"展开"才显示已软删条目。已软删条目可"恢复"或"永久删除"（永久删除超出本期范围，UI 不展示）。

### 排序

用上下箭头按钮（不引入拖拽库）。按钮位于每行"编辑"按钮左侧。点 `[↓]` → 与下一行交换 `order` 字段（调用 `reorder(newOrderedIds)`）。第一行 `[↑]` 禁用，最后一行 `[↓]` 禁用。

### 受影响消费方

`useRelationshipMenu` 和 `getRelationshipLabel`/`getRelationshipColor` 改为响应式（computed 包 state），设置页增删改后菜单和渲染自动更新。

## 错误处理

| 场景 | 处理 |
|------|------|
| `type` 重复 | 保存按钮禁用 + 字段下方红字"该 type 已存在" |
| `type` 不符合正则 | 保存按钮禁用 + 红字"仅小写字母、数字、`-`" |
| `label` 为空 | 保存按钮禁用 + 红字"标签必填" |
| `color` 格式错 | 保存按钮禁用 + 红字"请输入 hex 颜色如 #1890ff" |
| 启动时 IndexedDB 加载失败 | `console.warn` + state 保持空，UI 显示"加载失败，刷新页面重试" + 菜单回退到种子数据（useRelationshipMenu 内部兜底） |
| 软删的 type 被 link 引用 | `getRelationshipLabel` 兜底返回 `type + ' (已删除)'`，`getRelationshipColor` 兜底 `#bfbfbf`，UI 渲染显示灰色提示 |
| 用户编辑时 type 被外部 link 新引用 | 不影响（type 在 link 中只是字符串） |

## 测试策略

### 单元（Vitest）

`src/composables/__tests__/useRelationshipTypes.spec.ts`：
- `load()`：空表 → 写入种子；非空 → 不覆盖已有
- `create()`：成功路径 + type 重复 + label 为空 失败路径
- `update()`：成功路径 + 校验失败
- `softDelete()` + `restore()`：状态切换正确
- `reorder()`：order 字段批量更新

`src/types/__tests__/relationship.spec.ts`：
- `getRelationshipLabel`：正常 type + 软删 type 兜底
- `getRelationshipColor`：正常 + 兜底
- `getGroupByType`：双向查找

### 集成

`src/composables/__tests__/useRelationshipMenu.spec.ts`（已有则扩展）：
- 软删一个组后，菜单 items 不再包含
- 恢复后，菜单 items 重新包含
- 新增一个组后，菜单 items 立即出现（响应式）

### E2E（Playwright）

- 打开设置页 → 关系类型 section 显示 6 个内置
- 点"+ 新增关系类型" → 填写 → 保存 → 列表新增
- 输入 `[[某页面]]^` → 菜单出现新类型
- 点"编辑" → 修改 label → 保存 → 菜单 label 立即变化
- 点"删除" → 5 秒内"撤销" → 状态恢复
- 点"删除" → 等 5 秒后"已删除"分组可展开查看

## 迁移/兼容性

- 旧 `PREDEFINED_RELATIONSHIPS`/`RELATIONSHIP_GROUPS`/`RELATIONSHIP_COLORS` 完全移除（编译期保证）
- 旧 `useRelationshipMenu.ts` 内的 `import { RELATIONSHIP_GROUPS }` 改为从 `useRelationshipTypes` 拿
- 旧 link 数据的 `relationshipType` 字段不受影响（仍为字符串）

## 范围外（本期不做）

- 关系类型分组/分类（如"层级"vs"依赖"两 sub-group）
- 关系类型导入/导出 JSON
- 关系类型图标/emoji
- 关系类型拖拽排序（用箭头按钮代替）
- 永久删除已软删类型（仅支持"恢复"）
- 关系类型的批量编辑
- 关系类型的权限/共享

## 验收标准

- [ ] `relationshipTypes` 表存在且首启时自动种入 6 条
- [ ] 设置页可增/改/删任意关系类型
- [ ] 增/改/删后，关系菜单立即响应
- [ ] 软删的 type 不出现在菜单，但 link 渲染兜底"已删除"
- [ ] 全部现有 E2E 测试通过（rel-type-label 切换、菜单、wiki-link 等）
- [ ] 全部现有单元测试通过
- [ ] `npm run build` 成功
- [ ] 新增 ≥ 3 个单元测试用例覆盖关键逻辑
