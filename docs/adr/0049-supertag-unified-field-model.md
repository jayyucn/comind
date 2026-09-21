# ADR-0049: Tag 统一字段模型——系统内置 Tag + FieldDefinition 改名 + FieldValue 值层

- Status: proposed（草案，待 grilling 评审）
- Date: 2026-09-21
- Supersedes: 历史 `feat-supertag-131-132-135` 分支上的旧「超级标签分类层」方向（标签=page + Link relationshipType 扩展；对应旧 ADR-0049 已于 main 上删除）。**本 ADR 改为 Tag 一等实体 + 系统内置建模，不沿用旧「以现有原语扩展、不新建子系统」路线。**
- Related: ADR-0008（字段引用值）、ADR-0023（查询页外壳 / 字段描述符协议）、ADR-0040（书笔记属性）、ADR-0048（batch 分派单源）
- Tracking: —

## Context

### 现状

comind 的属性/字段系统分三层，目前靠硬编码与扁平数组粘合：

1. **定义层**：`src/types/property.ts` 的 `BUILT_IN_PROPERTIES: PropertyDefinition[]` 扁平数组（12 个内置字段：status / priority / project / area / book / part / chapter / cfi / quote / sourceBlockId / sourcePageId / language），用 `isBuiltIn: true` 标记；`getPropertyDefinition` / `getAllPropertyDefinitions` 从数组线性查找。
2. **注册层**：`useBlockQueryRegistry.ts` 的 `registerBlockBuiltinFields` **手工逐字段**注册 Field Descriptor；`BUILTIN_KEYS` 是硬编码 `Set`（14 个 key）；用户自定义字段由 `syncBlockCustomProperties` 从 `blockCardStore.cards` 数据**动态派生**注册。
3. **渲染层**：`PropertyDisplay.vue` 用 `def?.displayPosition === 'bottom-of-block' || !def?.isBuiltIn` 过滤系统属性，`isBuiltIn(key)` 查回 `PropertyDefinition.isBuiltIn`。
4. **存储层**：`Property` 表（`block_id` / `key` / `value` / `type`）把值存成扁平 `value:TEXT` + 内联 `type:TEXT`，所有类型（select / number / date / page_ref / list）都序列化成字符串；宿主写死 `block_id`。

### 问题

- **三处不同步**：新增一个内置字段要同时改 `BUILT_IN_PROPERTIES` 数组、`registerBlockBuiltinFields` 注册函数、`BUILTIN_KEYS` 集合（或 `PropertyDisplay` 过滤），三处遗漏一处即静默漂移——与 ADR-0048 指出的"两份分派表漂移"同构。
- **内置/自定义两套逻辑**：内置字段硬编码注册、自定义字段动态派生注册，无法共享模板复用/继承能力；若引入 Tag，两套会继续分裂。
- **命名分层不清**：`PropertyDefinition` 描述"字段定义"（key / title / type / closedValues），`Property` 是块上的值；引入 Tag（字段模板）后，"模板（Tag）→ 字段定义（FieldDefinition）→ 属性值（Property）"三层需要清晰命名，`PropertyDefinition` 名不副实。
- **术语冲突**：Rust 侧已有 `types/tag.rs`（`TagParse`）与 `services/tag_service.rs`（`extract_tags` 正则提取内容 `#tag`），是**文本 `#tag` 语法解析**。新引入的 `Tag`（字段模板实体）与之**共享 `tag` 一词**——需在 D7 明确两者关系，避免语义与命名打架。
- **值层扁平**：`Property` 的 `value` 是扁平字符串，类型靠内联 `type` 兜底，查询 / 排序 / 渲染都要反序列化；值的宿主写死 block，无法承载文档级属性。

### 目标

把内置契约字段建模为"系统内置 Tag"，与用户自定义 Tag 走**同一套"定义 → 注册 → 查询 / 渲染"管线**，消除三处不同步；同时理顺命名（`PropertyDefinition` → `FieldDefinition`），并把值层从扁平 `Property` 升格为结构化 `FieldValue`（typed 取值 + 外键引用定义）。

## Decision

| # | 决策点 | 裁定（草案） |
|---|---|---|
| D1 | 统一类型 | 新增 `Tag`：`{ key, title, fields, isSystem?: boolean, extends?: string[] }`。TS 于 `src/types/tag.ts`，Rust 于 `crates/comind-core/src/types/tag.rs`（serde 序列化，`is_system` / `extends` snake_case）。系统 Tag 编译期内嵌 `fields: FieldDefinition[]`（完整定义），用户 Tag 落库后引用 `fieldIds: string[]`（字段独立成表，见 D6/D9） |
| D2 | 改名 | `PropertyDefinition` → **`FieldDefinition`**（定义层 / 注册层 / 渲染层全量替换）；`property.ts` 保留一行 `export type PropertyDefinition = FieldDefinition` deprecated 别名过渡，避免存量调用点一次性爆炸；`getPropertyDefinition` / `getAllPropertyDefinitions` 函数名不变（返回 `FieldDefinition[]`） |
| D3 | 系统内置分组 | 新增 `SYSTEM_TAGS: Tag[]` 常量：#系统任务（status / priority / project / area）、#系统书笔记（book / part / chapter / cfi / quote / sourceBlockId / sourcePageId / language）。`BUILT_IN_PROPERTIES` **保留导出名**，内部改为 `SYSTEM_TAGS.flatMap(s => s.fields)` 展平，存量读取零改动。落地后系统字段 seed 进 `FieldDefinition` 表（seed 行不可删），`SYSTEM_TAGS` 引用改走 fieldId |
| D4 | 注册层遍历 | `registerBlockBuiltinFields` 改为遍历 `SYSTEM_TAGS` 的字段注册；`BUILTIN_KEYS` 改为由 `SYSTEM_TAGS` 派生（`new Set(SYSTEM_TAGS.flatMap(s => s.fields.map(f => f.key)))`）。**不改 Registry 接口**（仍按 entityType + key 注册，不引入实体维度） |
| D5 | 渲染过滤统一 | `PropertyDisplay` 过滤依据从"`displayPosition` + `isBuiltIn`"统一为"所属 tag 的 `isSystem`"；`isBuiltIn(key)` helper 改为查所属 tag。`displayPosition` 保留为纯渲染语义，不再承担"是否系统字段"职责 |
| D6 | 用户 tag 持久化 | 用户 tag 落 SQLite 新表 `tag`（id / title **全局唯一** / fieldIds / extends / created_at / updated_at，**无 key、无 is_system**）；字段独立成表 `FieldDefinition`（key **全局唯一** / title / type / closedValues / is_system，系统 12 字段 seed 进表、seed 行不可删）；block↔tag 用 **block 的 `tags` 字段**（tag id 数组，无独立关联表）。CRUD 扩展既有 `TagService`（`extract_tags` 保持纯函数，CRUD 走 Repository 注入）+ `SyncTable` 同步 |
| D7 | 术语统一 | 统一用 `Tag` 一词：新实体 `Tag`（字段模板）与既有文本 `#tag` 语法解析**同属 Tag 概念**。既有 `tag_parse.rs`（原 `tag.rs`，含 `TagParse`）定位为"文本 `#tag` → Tag 实体"的**解析层**，**保留不动**（纯函数、无 UI 依赖）；新实体类型用 `tag.rs`（Rust）/ `tag.ts`（TS）。存储表用 `tag`（不再用 `block_tag` 关联表） |
| D8 | 继承 | `extends: string[]` **多继承**；**物化继承**——创建 / 更新 tag 时把父 tag 的字段 id 展开合并进 `fieldIds`；多父冲突 = 后父覆盖前父、子覆盖所有父；DFS 环检测拒绝。**本次实现**（不再预留） |
| D9 | 值层升格 FieldValue | `Property` 表重构为 `FieldValue`：`{ id, block_id（MVP 单宿主）, field_definition_id（外键引用）, value（按类型存储 typed）, 多值序号, 时间戳 }`，取代扁平 `value:TEXT` + 内联 `type`。**强 schema**：值必须引用现存定义，无孤儿 / 游离值；删 FieldDefinition → 该字段值**级联清除**（不可逆，删除前告知受影响条目数）；删选项 → 停用、已填值保留标「未知选项」 |
| D10 | MVP 范围 | 本 ADR 裁定「内置字段 = 系统 Tag + 统一类型 + 改名 + 用户 tag 落库 + FieldValue 值层 + 继承」。自动化 / AI 绑定、打标 UI 交互、Page 级属性另立 ADR；FieldValue 宿主 MVP 只 Block |

## Consequences

- 新增内置字段：只改 `SYSTEM_TAGS` 对应分组一处，注册 / key 集合 / 过滤自动跟随；落地后系统字段 seed 进 `FieldDefinition` 表。
- 系统与用户 Tag 同管线：查询 / 渲染无分支，字段注册统一走 Field Descriptor。
- 改名迁移：TS 侧全量替换 + 别名过渡；Rust 侧 `property.rs` 类型名不动，Tag 实体新增。
- 值层重构：`Property` → `FieldValue`（typed 取值 + 外键引用定义），存量 `value:TEXT` 需按字段 type 反序列化迁移；强 schema 下删定义级联清值（不可逆，需告知）。
- 兼容性：`BUILT_IN_PROPERTIES`、`getPropertyDefinition`、`getAllPropertyDefinitions` 导出签名不变，存量调用点零改动。

## 迁移路径（TS/Rust 双栈改动清单）

### TS

1. `src/types/property.ts`：`PropertyDefinition` → `FieldDefinition` 全量替换 + deprecated 别名；`BUILT_IN_PROPERTIES` 改从 `SYSTEM_TAGS` 展平。
2. `src/types/tag.ts`（新）：`Tag` 类型 + `SYSTEM_TAGS` 常量（#系统任务 / #系统书笔记）。
3. `src/composables/useBlockQueryRegistry.ts`：`registerBlockBuiltinFields` 遍历注册；`BUILTIN_KEYS` 派生；`buildBlockFieldDescriptor` 参数类型改 `FieldDefinition`。
4. `src/components/Block/PropertyDisplay.vue`：过滤依据改为所属 tag `isSystem`；`isBuiltIn` helper 改查 tag。
5. 测试：`PropertyDisplay.test.ts` / `property.test.ts` / `useBlockQueryRegistry.test.ts` 更新断言（字段来源改为 tag 分组）。

### Rust

6. `crates/comind-core/src/types/tag.rs`（新）：`Tag` 结构体（serde，`extends: Vec<String>`，字段引用 `fieldIds`）。
7. `TagService` 扩展：既有 `services/tag_service.rs` 增加 tag CRUD（走 Repository 注入），`extract_tags` 纯函数保留。
8. `crates/comind-core/src/storage/`：SQLite / SQL.js 双实现加 `tag` 表 + `FieldDefinition` 表 + `FieldValue` 表（Property 重构为 FieldValue），block 增加 `tags` 字段。
9. `crates/comind-core/src/services/batch.rs`：新增 tag / field_definition / field_value 的 create / update / delete op（沿用 ADR-0048 单源分派）。

## 落地补充：Property 表冻结与 sync 登记语义（2026-09-21 grill-up 锚定）

**本质需求（锚点）**：**FieldValue 是唯一事实源，任何代码路径不得再读写 Property 表**——不变量落在代码层（登记语义 / 收敛审查），Property 表本体的 DROP 是次要的，留待 `block_version`（唯一残留读写方，已裁定待删模块）删除后一并处理。

**sync 登记语义**：凡登记派生属性行的 sync 变更，目标表一律为 `(SyncTable::FieldValue, id)`，其中 `id` 必须是 **FieldValue 行 id**（即 `PropertyService` 适配层返回的合成 id）；`(SyncTable::FieldDefinition, fd_id)` 仅在 FieldDefinition 实际发生写动的路径（property op 的 `save_shape` 返回）登记。冻结的 `SyncTable::Property` variant 本轮保留（已同步设备的存量 payload 兼容），但**不得再产生新登记**。

**已修复的五处错位**（此前把 FieldValue 的 id 登记成 Property 表，或 delete 路径直连冻结表，导致 FieldValue 变更的 sync 登记丢失）：

1. `batch.rs` block create 派生收集 → `(FieldValue, id)`
2. `batch.rs` block update 派生收集 → `(FieldValue, id)`
3. `batch.rs` block delete 派生收集（原直连 `storage.properties()`）→ `PropertyService::get_by_block_id` + `(FieldValue, id)`
4. `block_write.rs` save-block-tree 派生收集 → `(FieldValue, id)`
5. `block_write.rs` delete cascade 派生收集 → `(FieldValue, id)`

**待办（勿直接实施，需先裁口径）**：`block_version` 模块删除后 → 删 `SyncTable::Property` variant（`all()` 同步移除）、删 `PropertyRepository` trait 及三适配器 impl、DROP `Property` 表（双端 DDL + 迁移）。

## 非目标

- 既有 `tag.rs` / `TagParse` / `tag_service.rs`（文本 `#tag` 解析）定位为 Tag 的**解析层**，本 ADR 不动它们（见 D7）；不实现自动化 / AI 绑定、打标 UI 交互、Page 级属性（另立 ADR）。
- 不重设计 Registry / FieldDescriptor / ViewQuery 协议（ADR-0007 / 0023 语义不变）。

## 后续方向锚定：tag 本位，属性概念退役（2026-09-21 初稿 → 2026-09-22 用户纠正后重写；正式方案另立 ADR）

> **⚠️ 撤回声明（2026-09-22）**：本段 2026-09-21 初版锚定的是「tag 挂载驱动字段 + 禁止裸属性 + **写值自动补 tag**」——其中「写值自动补 tag」是**属性本位思维的补丁**（把属性写入当主体、tag 当附属），与「Tag 跟属性是两个东西，属性是要移除的东西」的用户裁定相悖，三项表述全部作废。否决理由存档：任何「写属性时顺手补 tag」的设计都在延续属性概念的独立性，而非移除它；正确的主从关系是 tag 本位（tag 是唯一入口，字段值因 tag 挂载而存在）。下文为重写后的锚点。

**终态模型（锚点）**：**属性概念退役，tag 本位**——

- 概念层：块上只有 **tag（分类）+ tag 携带的字段（值）**，不存在独立的「属性」入口。
- 交互层：打 `#task` → 块上出现该 tag 的字段编辑区（**挂载即显示**，无值字段以空占位可填）→ 填值。值的写入天然发生在字段编辑器里；**没有「写值自动补 tag」的补丁逻辑**。
- 程序化写值（TaskHub `ensureTodo` 等）：形态为「**确保 `#task` 在 content + 写字段值**」的原子操作——tag 本位的挂载前置，而非属性补丁；行为上与被否决的「自动补 tag」等效，语义归属不同（主体是挂载，不是写值）。
- 数据层：`FieldValue` / `FieldDefinition` 保留为实现载体并**最终改名去属性化**（`TagFieldValue` / `TagFieldDefinition` 方向，具体名待定）；`PropertyService` 的 Property 形状适配层为过渡期兼容而存在，**最终删除**；`Property` 表已冻结，随 `block_version` 删除一并清理（见上方「落地补充」段）。

**反证**：属性面板保留（属性概念未退役）、content inline 属性语法（Logseq 式，与 block 模型冲突）、隐式容器 tag（心智仍是两套）、写值自动补 tag（属性本位补丁，见撤回声明）均无法达成「属性概念彻底退役、tag 是唯一结构化数据入口」。

**待 grilling 的落地方案清单（勿直接实施，正式方案另立 ADR-0050）**：① 存量无 tag 属性值的迁移口径；② TaskHub 过滤源切换（`status` 值存在 → `tags` 含 `#task`）；③ tag chip 点击行为（是否翻转 D6 决策 #4「本轮无点击行为」→ 点击编辑该 tag 字段）；④ `ensureTodo` 原子操作的撤销栈边界（属性编辑现状不入 ADR-0046 撤销栈）；⑤ 数据层改名与适配层删除的分阶段路线。
