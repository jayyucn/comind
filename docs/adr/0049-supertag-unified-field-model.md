# ADR-0049: Tag 统一字段模型——系统内置 Tag + FieldDefinition 改名 + FieldValue 值层

- Status: accepted（已定稿并落地；实现进度见「落地补充」与 ADR-0050）
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

| # | 决策点 | 裁定 |
|---|---|---|
| D1 | 统一类型 | 新增 `Tag`：`{ key, title, fields, isSystem?: boolean, extends?: string[] }`。TS 于 `src/types/tag.ts`，Rust 于 `crates/comind-core/src/types/tag.rs`（serde 序列化，`is_system` / `extends` snake_case）。系统 Tag 编译期内嵌 `fields: FieldDefinition[]`（完整定义），用户 Tag 落库后引用 `fieldIds: string[]`（字段独立成表，见 D6/D9） |
| D2 | 改名 | `PropertyDefinition` → **`FieldDefinition`**（定义层 / 注册层 / 渲染层全量替换）；`property.ts` 保留一行 `export type PropertyDefinition = FieldDefinition` deprecated 别名过渡，避免存量调用点一次性爆炸；`getPropertyDefinition` / `getAllPropertyDefinitions` 函数名不变（返回 `FieldDefinition[]`）。**【已被 ADR-0051 D3/D4 推翻（2026-09-30）：deprecated 别名与 `PropertyRecord` 一并删除；两函数改名 `getFieldDefinition` / `getAllFieldDefinitions`】** |
| D3 | 系统内置分组 | 新增 `SYSTEM_TAGS: Tag[]` 常量：#系统任务（status / priority / project / area）、#系统书笔记（book / part / chapter / cfi / quote / sourceBlockId / sourcePageId / language）。`BUILT_IN_PROPERTIES` **保留导出名**，内部改为 `SYSTEM_TAGS.flatMap(s => s.fields)` 展平，存量读取零改动。**【导出名已被 ADR-0051 D3 推翻（2026-09-30）：改名 `BUILT_IN_FIELDS`】** **【已被 2026-09-30「系统标签双层模型」修订：SYSTEM_TAGS 不再整体为 is_system 系统标签；status/priority 保留为系统字段，task/booknote 降级为 is_system=0 可编辑预设，见文末专段】** 落地后系统字段 seed 进 `FieldDefinition` 表（seed 行不可删），`SYSTEM_TAGS` 引用改走 fieldId |**【已被 2026-09-30「系统标签三态模型」修订并纠正：容器 `#任务`/`#书笔记` 仍 `is_system=1` 系统级（不可删），仅其 10 个域字段降级为 `is_system=0, is_preset=1` 可编辑预设；见文末专段】** |
| D4 | 注册层遍历 | `registerBlockBuiltinFields` 改为遍历 `SYSTEM_TAGS` 的字段注册；`BUILTIN_KEYS` 改为由 `SYSTEM_TAGS` 派生（`new Set(SYSTEM_TAGS.flatMap(s => s.fields.map(f => f.key)))`）。**不改 Registry 接口**（仍按 entityType + key 注册，不引入实体维度） |
| D5 | 渲染过滤统一 | `PropertyDisplay` 过滤依据从"`displayPosition` + `isBuiltIn`"统一为"所属 tag 的 `isSystem`"；`isBuiltIn(key)` helper 改为查所属 tag。`displayPosition` 保留为纯渲染语义，不再承担"是否系统字段"职责 |
| D6 | 用户 tag 持久化 | 用户 tag 落 SQLite 新表 `tag`（id / title **全局唯一** / fieldIds / extends / created_at / updated_at，**无 key、无 is_system**）；字段独立成表 `FieldDefinition`（key **全局唯一** / title / type / closedValues / is_system，系统 12 字段 seed 进表、seed 行不可删）；block↔tag 用 **block 的 `tags` 字段**（tag id 数组，无独立关联表）。CRUD 扩展既有 `TagService`（`extract_tags` 保持纯函数，CRUD 走 Repository 注入）+ `SyncTable` 同步 |
| D7 | 术语统一 | 统一用 `Tag` 一词：新实体 `Tag`（字段模板）与既有文本 `#tag` 语法解析**同属 Tag 概念**。既有 `tag_parse.rs`（原 `tag.rs`，含 `TagParse`）定位为"文本 `#tag` → Tag 实体"的**解析层**，**保留不动**（纯函数、无 UI 依赖）；新实体类型用 `tag.rs`（Rust）/ `tag.ts`（TS）。存储表用 `tag`（不再用 `block_tag` 关联表） |
| D8 | 继承 | **多继承（已推翻 → ADR-0050 D10）**：原方案 `extends: string[]` 多继承 + 物化合并（创建/更新时把父字段 id 并入 `fieldIds`，多父冲突=后父覆盖前父、子覆盖所有父，DFS 环检测拒绝）。ADR-0050 D10 改为**单父树**（`Tag.parent_id` 一列）+ **惰性解析** `effective_field_ids(tag)=自身>直接父>更近祖先`，多继承与物化合并均取消。 |
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

## 落地补充：Property 表冻结与 sync 登记语义

**不变量**：**FieldValue 是唯一事实源，任何代码路径不得再读写 Property 表**——不变量落在代码层（登记语义 / 收敛审查），Property 表本体的 DROP 是次要的，留待 `block_version`（唯一残留读写方，待删除模块）删除后一并处理。

**sync 登记语义**：凡登记派生属性行的 sync 变更，目标表一律为 `(SyncTable::FieldValue, id)`，其中 `id` 必须是 **FieldValue 行 id**（即 `PropertyService` 适配层返回的合成 id）；`(SyncTable::FieldDefinition, fd_id)` 仅在 FieldDefinition 实际发生写动的路径（property op 的 `save_shape` 返回）登记。冻结的 `SyncTable::Property` variant 本轮保留（已同步设备的存量 payload 兼容），但**不得再产生新登记**。

**已修复的五处错位**（此前把 FieldValue 的 id 登记成 Property 表，或 delete 路径直连冻结表，导致 FieldValue 变更的 sync 登记丢失）：

1. `batch.rs` block create 派生收集 → `(FieldValue, id)`
2. `batch.rs` block update 派生收集 → `(FieldValue, id)`
3. `batch.rs` block delete 派生收集（原直连 `storage.properties()`）→ `PropertyService::get_by_block_id` + `(FieldValue, id)`
4. `block_write.rs` save-block-tree 派生收集 → `(FieldValue, id)`
5. `block_write.rs` delete cascade 派生收集 → `(FieldValue, id)`

**待办**：`block_version` 模块删除后 → 删 `SyncTable::Property` variant（`all()` 同步移除）、删 `PropertyRepository` trait 及三适配器 impl、DROP `Property` 表（双端 DDL + 迁移）。

## 非目标

- 既有 `tag.rs` / `TagParse` / `tag_service.rs`（文本 `#tag` 解析）定位为 Tag 的**解析层**，本 ADR 不动它们（见 D7）；不实现自动化 / AI 绑定、打标 UI 交互、Page 级属性（另立 ADR）。
- 不重设计 Registry / FieldDescriptor / ViewQuery 协议（ADR-0007 / 0023 语义不变）。

## 方向决议：tag 本位，属性概念退役（正式方案见 ADR-0050）

> **已否决提案存档**：本段曾一度提出「tag 挂载驱动字段 + 禁止裸属性 + **写值自动补 tag**」方向，后否决。否决理由：「写值自动补 tag」仍把属性写入当主体、tag 当附属，延续的是属性概念的独立性而非移除它；正确的主从关系是 tag 本位——tag 是唯一入口，字段值因 tag 挂载而存在。三项表述全部作废，以下方终态模型为准。

**终态模型**：**属性概念退役，tag 本位**——

- 概念层：块上只有 **tag（分类）+ tag 携带的字段（值）**，不存在独立的「属性」入口。
- 交互层：打 `#task` → 块上出现该 tag 的字段编辑区（**挂载即显示**，无值字段以空占位可填）→ 填值。值的写入天然发生在字段编辑器里；**没有「写值自动补 tag」的补丁逻辑**。
- 程序化写值（TaskHub `ensureTodo` 等）：形态为「**确保 `#task` 在 content + 写字段值**」的原子操作——tag 本位的挂载前置，而非属性补丁；行为上与被否决的「自动补 tag」等效，语义归属不同（主体是挂载，不是写值）。
- 数据层：`FieldValue` / `FieldDefinition` 保留为实现载体并**最终改名去属性化**（`TagFieldValue` / `TagFieldDefinition` 方向，具体名待定）；`PropertyService` 的 Property 形状适配层为过渡期兼容而存在，**最终删除**；`Property` 表已冻结，随 `block_version` 删除一并清理（见上方「落地补充」段）。

**已否决替代方案**：属性面板保留（属性概念未退役）、content inline 属性语法（Logseq 式，与 block 模型冲突）、隐式容器 tag（心智仍是两套）、写值自动补 tag（属性本位补丁，见上方否决记录）——均无法达成「属性概念彻底退役、tag 是唯一结构化数据入口」。

**落地方案**：①~⑤ 已全部在 ADR-0050 定稿——① 存量无 tag 属性值无需迁移（孤儿值保留、UI 不可见，手动打 tag 后恢复）；② TaskHub 过滤源切 `tags`；③ tag chip 点击 → 导航 tag 聚合页；④ 程序化写值不入撤销栈（维持 ADR-0046 边界）；⑤ 数据层改名 `TagFieldValue` / `TagFieldDefinition` + 适配层删除，三阶段实施。

## 系统标签三态模型（2026-09-30 grill-up 提出，grilling 锁定）

> 取代 D3 中"SYSTEM_TAGS 整体为 is_system 系统标签"的设定，并纠正本 ADR 早先「系统标签双层模型」段（该段误将 `#任务`/`#书笔记` 容器归为 `is_system=0` 预设）。本段为经 grill-up → grilling 两轮压力测试后的最终锁定结论。

### Context
临时 `SYSTEM_TAGS`（`#系统任务` / `#系统书笔记`）是 ADR-0049 落地时为复用旧 `BUILT_IN_PROPERTIES` 而做的机械搬运，把 12 个字段与 2 个标签整体标记为 `is_system`（不可变 + 种子）。但代码依赖核查显示：仅 `status`（`role:'status'`，看板分组 + 完成态判定，见 `useBlockQueryRegistry.ts:31/:97/:236`）与 `priority`（卡面字段 + 特殊描述符，`:33/:44/:139`）被应用代码硬依赖；`project`/`area` 仅是注册卡面字段，书摘 8 字段（`book`/`part`/`chapter`/`cfi`/`quote`/`sourceBlockId`/`sourcePageId`/`language`）在 `src` 中无任何硬编码引用。把域工作流整体不可变锁定，与"通用树形 PKM 不替用户做领域假设"的目标冲突，且 `is_system` 种子随发布落库即不可变（ADR-0049「seed 行不可删」），须在固化前修正。

### Decision
采用**三态模型**替换原单一 `is_system` 系统标签集合与早先的双层表述：

| 实体 | `is_system` | `is_preset` | 可删 | 删后可恢复 | 类别 |
|---|---|---|---|---|---|
| `#任务`、`#书笔记`（标签） | 1 | 0 | 否 | — | 系统级（不可删容器） |
| `status`、`priority`（字段） | 1 | 0 | 否 | — | 系统级（代码承重） |
| `project`/`area`/`book`/`part`/`chapter`/`cfi`/`quote`/`sourceBlockId`/`sourcePageId`/`language`（10 域字段） | 0 | 1 | 是 | 是 | 预设（系统铺好的模板） |
| 用户自建一切 | 0 | 0 | 是 | 否 | 用户 |

关键裁定：
1. **`#任务`/`#书笔记` 是 `is_system=1` 系统级标签（不可删），不是预设**。理由：auto-ensureTodo / status 图标逻辑（`blocks.ts:466`）靠 `t.is_system && 有效字段含 status` 识别"任务 tag"；保持其系统级使该识别**零改造**。早先「双层模型」段误将其归为 `is_system=0` 预设，本段纠正。
2. **"预设"概念仅落在 10 个域字段上**（`is_system=0, is_preset=1`）：系统帮用户铺好的字段模板，可改可删、删后可通过"恢复内置预设"恢复。
3. **预设 vs 用户自建的唯一区别**：两者皆可改可删；仅预设行删除后（软删 `deleted_at`）可恢复，用户行删除即永久消失。
4. 命名去"系统"前缀：`#系统任务` → `#任务`、`#系统书笔记` → `#书笔记`；系统/用户的区分由 `is_system`/`is_preset` 列表达，命名不必再携带。

### Rationale
- 系统级 = "不可变 + 代码/基础设施依赖"是 ADR-0049 硬约束；把无代码依赖的域字段锁死为不可变，违背 PKM 通用性且因种子不可变而不可逆 → 域字段降级为预设。
- 容器标签（`#任务`/`#书笔记`）保持系统级，既保住任务识别零改造，又避免"可删预设标签"与"系统承重识别"的耦合重构；域工作流的可塑性通过预设字段实现。

### Consequences（落地）
- **Schema**：`Tag` 与 `FieldDefinition` 两张表均新增 `is_preset INTEGER NOT NULL DEFAULT 0` 列（迁移双端对称；Tag 表当前无预设实例，保留列向前兼容未来真·预设标签）。
- **Seed 重构**：`FieldDefinition::seed()` 当前硬编码 `is_system=true`，须扩展为支持 `is_system=false`/`is_preset`（或新增 `seed_preset()` 分支）。`system_field_definitions()` 拆分为系统部分（status/priority，`is_system=1`）与预设部分（10 域字段，`is_system=0, is_preset=1`）。`seed_system_tags` 保持 `#任务`/`#书笔记` 为 `is_system=1`。
- **软隐藏 + 可恢复**：删除预设 = 软删（置 `deleted_at`），保留 block 上的打标与字段值；"恢复内置预设"仅对 `deleted_at` 非空的 `is_preset=1` 行清空 `deleted_at`，**绝不覆盖活跃（`deleted_at` 为空）的用户编辑**。Seed 幂等按 id/key 存在性跳过——软删行仍存在故不被复活。
- **恢复入口**：`/tags` 管理页顶部"恢复内置预设"全局按钮，仅当存在软删的预设行时显示。
- **字段独立**：删除/恢复一个预设字段不级联其所属标签；系统标签模板引用缺失字段时 UI 优雅降级（显示"字段已移除"），恢复后自动重新挂接。
- **TS 单一真相源（状态：暂缓，2026-09-30 复核）**：原定废弃 `src/types/tag.ts` 硬编码 `SYSTEM_TAGS` 常量、改从 store 派生（`isSystemField`/`getFieldTag` 读库）。复核结论：三态模型落地后 `SYSTEM_TAGS` 仅含 `is_system=1` 不可变 tag+字段（见上方决策表），其 DB 行由 seed 契约锁死，不存在运行时漂移；真正可漂的预设字段（`is_preset=1`）本就不在常量内、由 `tagsStore.getFieldDefinitions` 派生。因此"消除漂移"的移除前提已不成立——**保留 `SYSTEM_TAGS` 常量，移除暂缓，不执行 store 派生改造**。前置条件：若未来出现"不修改代码即需增删系统字段"的需求，再重开此条。
- **字段数据 JSON 单源（2026-09-30，标签分组 2026-09-30 收口，标签身份 2026-10-01 收口）**：上条暂缓的是「store 派生 / 移除 `SYSTEM_TAGS` 常量」，但未解决「TS 常量与 Rust `system_field_definitions()` 双写 12 字段数据」这一独立漂移点。现引入 `src/types/systemFieldSeed.json` 作为字段数据（key/title/type/分类/closed 裸值）、**标签→字段分组**、**标签身份三要素（title/description/color）** 的单一真相源：Rust 经 `include_str!`+serde 编译期嵌入，`system_field_definitions()` 展平字段、`system_tag_seeds()` 按 `tags[].fields[].key` 派生标签分组并透传 `description`/`color`（db id 经 `sys-tag-` 前缀推导、db title 等于 JSON title 无前缀、field_ids 查 uuid）；native/wasm 两后端 `seed_system_tags` 均消费此函数并向 `Tag::seed` 下发身份（`tag.rs` 的 `Tag::seed` 扩展 `description`/`color` 两参；sql.js 的 INSERT 列名已补齐 `description`/`color`，此前写死漏列会导致 wasm 路径身份落空），删除了原本两份 `&[(&str,&str,&[&str])]` 硬编码分组字面量；TS `SYSTEM_TAGS` 的 `fields` 与 `tags` 层级由同一 JSON + `FIELD_UI` 展示覆盖层（displayPosition/displayStyle/图标）重建。`SYSTEM_TAGS` 常量保留（仅承载 UI 展示层），不再重复任何数据本身；新增内置字段/调整标签分组/调整系统标签外观只改 JSON 一处。**约束：color 存调色板 token 名（`--tag-color-N`，ADR-0050 D11），禁止 hex——渲染层 `isTagColorToken` 白名单只收 token 名，hex 会被判非法而脱色。**
- **当前仅测试数据**：可自由重定义种子后重新 seed，无 legacy 行迁移；约束：须在首次真实发布前定稿（发布后 `is_system` 行不可变）。

### 已裁决（grilling 输入，原"待裁决"三项已闭合）
1. 预设交付机制 → **软隐藏 + 可恢复**（新增 `is_preset` 列 + `deleted_at` 软删 + 恢复按钮），而非"仅首次 init"或"接受复活"。
2. 预设范围 → v1 **仅 `#任务` + `#书笔记` 容器 + 10 域字段**，不扩张 `#项目`/`#页面`/`#人物`。
3. `priority` 锁定 → **锁定**（系统核心 = `{status, priority}`）；容器标签保持系统级（见裁定 1）。
4. 任务识别 → 靠 `#任务` 的 `is_system=1`，**零改造**（裁定 1 的推论）。
