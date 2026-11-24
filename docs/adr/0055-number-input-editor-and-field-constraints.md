# ADR-0055: 通用数值编辑器 NumberInput 与字段数值约束（min/max/step）

> **状态：accepted（2026-10-10）**。经 grill-with-docs 烤定并已完成首期落地；Rust 持久化列按 `comind-core-add-column` 全 8 触点接入并已 wasm 真编验证。

## Context

块字段区里 `number` 字段当前以 **chip 徽章**渲染，点击才弹通用快速编辑器 `FieldValueEditor`（其 number 分支是一个裸 `<input type="number">`）；查询侧 `query/ValueEditor.vue` 的 number 描述符同样用裸 `<input type="number">`。全仓**没有**一个与 `DatePicker` 平行、可复用、带步进与约束的数值录入控件。

与之对照，`date` 字段已有通用 `DatePicker`（`src/components/common/DatePicker.vue`），并以「值区直接挂组件」的方式内联进 `BlockFieldZone.list` 变体（见该组件 `def.type === 'date'` 分支）。`number` 缺这一环。

同时，字段定义类型 `FieldDefinition` / `PersistedFieldDefinition` 目前**没有任何数值约束槽**，min/max/step 无处承载——即便编辑器想做边界/步进也读不到来源。

### 缺陷

1. **没有与 DatePicker 同构的数值控件**：date 有通用组件、number 没有，录入体验与代码组织不一致；裸 `<input type=number>` 散落多处，步进/边界/占位各自为政。
2. **数值约束无来源**：`FieldDefinition` 只声明 `type: 'number'`，无法表达「0–100」「步进 5」这类语义，编辑器与面板都读不到。

### 本质需求

> **提供一个与 DatePicker 同构（common/ 下、v-model 契约、类型感知）的通用数值编辑器 NumberInput，首批落到块字段区 number 行（替换 chip），并让字段定义可携带可选的 min/max/step 约束、由管理面板配置。**

## 决策

### D1：组件名与位置

新建 `src/components/common/NumberInput.vue`，与 `DatePicker` 平行。命名避开本仓块内容编辑器惯用的 `Editor`（避免歧义），语义为「选数控件」，为未来步进/范围扩展留名。

### D2：交互形态 —— 内联控件 + ± 步进器，无弹层

控件形态为**数字输入框 + 两侧 ± 步进按钮**，直接内联在字段行值区。**不照搬** DatePicker 的「触发钮 → 弹层（日历/滑块）」结构：数值不需要日历式面板，弹层偏重。结构比 DatePicker 简单（无 Teleport、无视口收边）。

### D3：字段区集成 —— 替换 chip，始终显示输入框

`BlockFieldZone.list` 变体的 number 行值区，把 chip 徽章**替换**为 `<NumberInput>`（镜像 date 的 `def.type === 'date'` 分支处理）。展示态**始终显示**输入框（镜像 date），空值（`undefined`）显 ghost 占位，而非只在聚焦时变输入。

### D4：接口契约 —— 镜像 DatePicker 的 v-model

- `v-model`：`modelValue: number | undefined` / `update:modelValue: [value: number | undefined]`。
- `placeholder?: string`。
- 约束 props：`min?: number`、`max?: number`、`step?: number`（可选；缺省 = 自由数值）。
- 未填 = `undefined`（与 DatePicker 一致，且与 `deleteFieldValue` 的「无行即空」语义一致）。

### D5：约束来源 —— 扩展 FieldDefinition 与 PersistedFieldDefinition 两处

在 `FieldDefinition`（编译期，`SYSTEM_TAGS` 派生）与 `PersistedFieldDefinition`（持久化）两处各加可选 `min?` / `max?` / `step?` 字段，作为约束的**单一来源**。系统字段可在 seed 里带约束；用户字段经管理面板配置后持久化。

> **实施提醒（见实施影响面）**：`PersistedFieldDefinition` 是 Rust `FieldDefinition` 实体 + DB 表的映射，新增持久化列按技能 `comind-core-add-column` 需触达 8 处（含 `sqljs.rs` 两份 SELECT/INSERT/UPDATE/CREATE TABLE/迁移），并在 wasm 侧真编验证。此成本由 D6 的「首批即做配置 UI」决定，不是纯前端改动。

### D6：约束配置 UI —— 首批即做，不 defer

字段定义属性编辑面板（**`TagsLibrary.vue` 的字段模板表**，即字段定义属性编辑处；注意 `FieldManagerPanel` 是 per-tab 列管理，不是字段属性编辑）为 number 字段加 **min / max / step 三个输入项**，经既有 `updateFieldDefinition` 路径持久化。**首批即包含该 UI**，使约束真正可配置，而非只埋类型槽。

> 落地形态：number 字段行下方多出一条「数值约束」子行（`tag-field-constraints`），含 最小/最大/步进 三个 `type=number` 输入框，仅 number 型且可编辑字段出现；空串 = 无约束（落 `null`）。与 `onChangeHide` / `onChangeForm` 同构：仅值真变化时落库。

### D7：越界处理 —— 失焦夹边界 + step 就近取整

- 输入超出 `[min, max]` 时，**失焦（blur）夹回最近边界**。
- 若配置 `step`，blur 时把值就近取整到以 `min` 为基准的 step 倍数。
- 自由键入允许小数；**未配置 step** 时 ± 步进增量为 **1**，且自由输入的小数不做夹取。

### D8：空值 / 清除 —— 清空即删值行

清空输入框 → emit `undefined` → `BlockFieldZone` 调 `deleteFieldValue`（镜像 date 的 `onDateChange`）。配套：
- `numberValue(def)` 返回 `number | undefined`（取 `dataOf(fv)`，number 类型解码回 `number`）；
- `onNumberChange(def, val)` → `val` 有值则 `setFieldValue(blockId, key, val, 'number')`，`undefined` 则 `deleteFieldValue`。

### D9：落库形态 —— 完全复用既有通道

复用 `setFieldValue(blockId, key, value, 'number')`；`value` 为 `number`，`field-value-codec`（#117）按 `type` 忠实 JSON 编码（`42` → `"42"`），`dataOf` 解码回 `number`。**不改存储层编解码**。

## 已否决替代方案

- **触发钮 + 弹层（滑块）**：照搬 DatePicker 结构，但数值场景不需要日历式面板，结构偏重、且字段区多数值字段时弹层交互啰嗦。否决（选 D2 内联步进器）。
- **仅样式化原生输入**：无自定义步进按钮，交互弱于 ± 步进，且原生上下箭头在字段区语境下可发现性差。否决（选 D2）。
- **约束仅由 props 硬编码、不入存储**：用户字段无法配置约束，单一来源不成立，与 D5 矛盾。否决（选 D5 扩两处定义）。
- **配置 UI 推迟到后续**：类型槽与编辑器消费可先就位，但用户裁定首批即做配置入口（D6），使约束真正可配置，避免「埋了槽却配不上」的半成品。
- **modelValue 用字符串 / `number | null`**：字符串丢失类型保真（codec 按 type 忠实编码 number）；`null` 与 `deleteFieldValue` 的 `undefined` 语义不一致。否决（选 D4 的 `number | undefined`）。
- **字段区 number 行用「徽章静息 + 点击转编辑」两态**：字段多时更轻，但需维护两套渲染态，且与 date 已定的「始终显示控件」不一致。否决（选 D3 始终显示）。

## 实施影响面（待核对）

| 触点 | 说明 | 性质 |
|---|---|---|
| `src/components/common/NumberInput.vue` | 新组件（D1–D4、D7–D8） | 前端新增 |
| `src/types/field-definition.ts` | `FieldDefinition` 加可选 `min/max/step`（D5） | 前端类型 |
| `src/types/tag-persisted.ts` | `PersistedFieldDefinition` 加可选 `min/max/step`（D5） | 前端类型 |
| `crates/comind-core/src/storage/entity/field_definition.rs` | 新列 SELECT/INSERT/UPDATE/CREATE TABLE/迁移（D5，**native 路径**） | Rust 存储 |
| `crates/comind-core/src/storage/sqljs.rs` | 同上 5 处（`#[cfg(wasm32)]` 全量，D5，**wasm 路径**） | Rust 存储 |
| `npm run wasm:build` | 改 Rust 后必跑，产物落 `crates/pkg/` | 构建 |
| `src/components/Block/BlockFieldZone.vue` | number 行值区替换 chip 为 NumberInput；新增 `numberValue` / `onNumberChange`（D3、D8） | 前端集成 |
| `src/components/Tags/TagsLibrary.vue` | 字段模板表为 number 字段加「数值约束」子行（min/max/step 输入项）+ `onChangeConstraint` 持久化（D6） | 前端 UI |
| `src/types/tag-persisted.ts` | `CreateFieldDefinitionParams` / `UpdateFieldDefinitionParams` 加 `min/max/step`（D5 前端参数面） | 前端类型 |
| （后续可选，不在首批 scope）`FieldValueEditor.vue` / `query/ValueEditor.vue` | 替换裸 `<input type=number>` 为 NumberInput | 前端重构 |

**数据迁移**：新增列均为可选，存量字段 `min/max/step` 为 `null`/缺省即自由数值，**无迁移**。

**验证门槛（已全部达成，2026-10-10）**：
- Rust：`cargo check -p comind-core --target wasm32-unknown-unknown` 真编通过；`cargo test -p comind-core --lib` 仍为基线 4 红（#79），未新增；`npm run wasm:build` 真编 34s 落地 `crates/pkg/`。
- 前端：`vue-tsc --build --force` 干净；`eslint` 仅样式 warning 无 error；`NumberInput.test.ts` 9/9、`BlockFieldZone.test.ts` 全绿（含 blur 夹边界、清空删值行）、`TagsLibrary.test.ts` 90/94（4 例为 tag-color 既有红基线，与本次无关）。

## 关联

- ADR-0050 D21（块字段区展示形态、挂载即显示；number 默认 `chip` → 本 ADR 改为 NumberInput 内联）
- `DatePicker`（`src/components/common/DatePicker.vue`）—— 同构组件先例：common/ 下、v-model 契约、字段区 `list` 变体内联接入
- `field-value-codec`（#117）—— number 按 `type` JSON 编码，`dataOf` 解码回 number（D9 复用，不改）
- 技能 `comind-core-add-column` —— `PersistedFieldDefinition` 加持久化列的 8 触点清单（D5 实施门槛）
