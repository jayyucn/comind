# 通用高级筛选系统设计

> 与业务解耦的通用查询系统。术语定义见根目录 `CONTEXT.md`（Field Descriptor / Condition / Condition Group / View Query / Query Engine）。
> 决策理由见 `docs/adr/0002-generic-query-engine-registry-decoupling.md`。

## 目标与边界

**做什么**：一个无头（headless）查询引擎 + 一套通用 FilterBuilder UI，业务实体（首批：Block、Page）通过注册 Field Descriptor 接入，获得筛选、排序、分组能力。

**不做什么**：

- 不做 SQL 下推（架构预留，见下文"预留口子"）
- 不做视图类型（table/board/calendar）等渲染概念——留在业务层
- 不做"已保存视图"工具栏 UI——TaskView 已有，留在业务层
- 不做多级分组、分组聚合、自定义字段类型、异步选项（v1 均显式排除）

## 与现有 BlockQuery 的关系

新系统按理想模型先行设计，**暂不迁移** `BlockQuery` / `TaskView` / `savedFilter`。并存期内：

- 冻结旧模型的新增操作符，新需求一律进新引擎
- 旧模型的扁平 `FilterCondition[]` 是新模型 Condition Group 的退化形态，未来迁移是无损的
- savedFilter 的 WASM 持久化 API 存的是不透明 JSON 字符串，新模型可直接复用，无需改动后端

## 目录结构与依赖规则

```
src/core/query/          # 无头核心：纯 TS，禁止 import Vue/Pinia（eslint 规则约束）
  types.ts               # 查询模型类型
  operators.ts           # 类型 → 操作符派生表
  registry.ts            # createRegistry()
  evaluate.ts            # 求值器
  serialize.ts           # 序列化 / 解析（含 version 字段）
src/components/query/    # 通用 Vue UI
  FilterBuilder.vue      # 字段选择器 + 操作符选择器 + 按类型分派的值编辑器 + 条件组嵌套
src/features/<feature>/  # 各业务的适配器：注册本实体的 Field Descriptors
```

核心为弱类型（string key）；适配器层可选包类型化 helper。强泛型核心的成本高于收益，已明确放弃。

## 查询模型

```ts
// --- 字段 ---
type FieldType = 'text' | 'number' | 'date' | 'select' | 'multiSelect' | 'boolean'
// FieldType 是开放联合（允许 string），为自定义类型留口子，但 v1 引擎只内置上述六种

interface Option { id: string; label: string }

interface FieldDescriptor<T = unknown> {
  key: string
  label: string
  type: FieldType
  get: (item: T) => unknown          // 同步 getter，支持派生计算字段
  ops?: FilterOp[]                    // 可选：覆盖类型派生的操作符集
  options?: Option[] | (() => Option[])  // select/multiSelect 专用，同步
  dateBucket?: 'day' | 'week' | 'month'  // date 字段参与分组时的分桶粒度
  path?: string                       // 可选：为未来 SQL 下推预留的属性路径
}

// --- 条件树 ---
type FilterOp =
  | 'is' | 'isNot' | 'contains' | 'notContains'
  | 'before' | 'after' | 'between'
  | 'eq' | 'neq' | 'gt' | 'lt'
  | 'hasAny' | 'hasAll'
  | 'isEmpty' | 'isNotEmpty'

interface Condition {
  field: string        // FieldDescriptor.key
  op: FilterOp
  value?: unknown      // isEmpty/isNotEmpty 无 value
}

interface ConditionGroup {
  combinator: 'and' | 'or'
  negate?: boolean     // 默认 false；参与序列化，v1 UI 不暴露
  children: (Condition | ConditionGroup)[]
}

// --- 视图查询 ---
interface SortRule { field: string; dir: 'asc' | 'desc' }  // 多键，按数组顺序

interface ViewQuery {
  version: 1
  filter: ConditionGroup      // 根组；空 children 表示无筛选
  sort: SortRule[]
  groupBy: string | null      // 单字段，值为 FieldDescriptor.key
}
```

## 操作符派生表（内置默认）

| 类型 | 操作符 |
|---|---|
| text | is / isNot / contains / notContains / isEmpty / isNotEmpty |
| number | eq / neq / gt / lt / isEmpty / isNotEmpty |
| date | before / after / between / isEmpty / isNotEmpty（日粒度，与 Ideas Page 规范一致） |
| select | is / isNot / isEmpty / isNotEmpty |
| multiSelect | hasAny / hasAll / isEmpty / isNotEmpty |
| boolean | is |

字段可通过 `ops` 覆盖或扩展。

## 空值语义（通行规则，非 SQL 三值逻辑）

- getter 返回 `undefined` / `null` 即视为空
- 所有比较类操作符遇空值一律返回 `false`
- 只有 `isEmpty` / `isNotEmpty` 关心空值
- select 选项被删除后，引用该选项 id 的条件降级为不匹配（同空值处理）
- 查询值存选项 id，不存 label（label 变化不影响已存查询）

## 注册表

```ts
const registry = createRegistry()
registry.register('block', fieldDescriptor)   // entityType 命名空间
registry.unregister('block', 'status')
registry.list('block')                        // UI 响应式订阅
```

- 显式实例，应用启动时在组合根完成注册；测试可自行实例化，无全局单例
- 必须支持运行时增删：Block 的用户自定义 property 会产生动态字段
- Vue 层用响应式包装订阅注册表变化，FilterBuilder 自动跟随

## 求值器

```ts
function evaluate<T>(query: ViewQuery, items: T[], registry: Registry, entityType: string): T[]
```

- 纯函数、全量求值；重算交给 Vue computed 缓存
- **量级假设：千级以下**（Q16 未确认）。若日后实测出现万级实体，触发重估：先加条件短路排序与结果缓存；十万级则回到 ADR-0002 重新讨论 SQL 下推
- 列表渲染性能由已有的 vue-virtual-scroller 负责，不属于本系统

## 序列化

- ViewQuery 整体序列化为 JSON，含 `version: 1`
- **迁移链暂缓实现**：框架保留版本位，首个 v2 出现时再写 migrate 函数
- 持久化复用现有 savedFilter WASM API（不透明字符串），后端零改动

## 通用 UI：FilterBuilder

- 输入：registry + entityType + v-model:ViewQuery
- 字段选择器（来自注册表）→ 操作符选择器（按类型派生）→ 值编辑器按类型分派（text 输入框 / number / 日期选择器 / 选项下拉 / 布尔开关）
- 条件组嵌套 UI，软限制 3 层；组级 negate 不暴露
- 排序、分组配置 UI 同属 FilterBuilder 范围；视图类型切换、已保存视图工具栏不在其中

## 预留口子（明确不做，但结构不挡路）

| 能力 | 预留方式 |
|---|---|
| SQL 下推 | ViewQuery 纯数据可序列化；FieldDescriptor.path 元数据；求值器接口与执行位置无关 |
| 自定义字段类型 | FieldType 开放联合；操作符派生表可按类型注册扩展 |
| 异步选项 | 业务方在数据就绪后再注册字段即可绕过 |
| 多级分组 / 聚合 | groupBy 升级为数组是非破坏性变更；聚合不进模型，由 UI 在分组结果上现算 |
