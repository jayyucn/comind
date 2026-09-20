# ADR-0049: Tag 统一字段模型——系统内置 Tag + FieldDefinition 改名

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

### 问题

- **三处不同步**：新增一个内置字段要同时改 `BUILT_IN_PROPERTIES` 数组、`registerBlockBuiltinFields` 注册函数、`BUILTIN_KEYS` 集合（或 `PropertyDisplay` 过滤），三处遗漏一处即静默漂移——与 ADR-0048 指出的"两份分派表漂移"同构。
- **内置/自定义两套逻辑**：内置字段硬编码注册、自定义字段动态派生注册，无法共享模板复用/继承能力；若引入 Tag，两套会继续分裂。
- **命名分层不清**：`PropertyDefinition` 描述"字段定义"（key / title / type / closedValues），`Property` 是块上的值；引入 Tag（字段模板）后，"模板（Tag）→ 字段定义（FieldDefinition）→ 属性值（Property）"三层需要清晰命名，`PropertyDefinition` 名不副实。
- **术语冲突**：Rust 侧已有 `types/tag.rs`（`TagParse`）与 `services/tag_service.rs`（`extract_tags` 正则提取内容 `#tag`），是**文本 `#tag` 语法解析**。新引入的 `Tag`（字段模板实体）与之**共享 `tag` 一词**——需在 D7 明确两者关系，避免语义与命名打架。

### 目标

把内置契约字段建模为"系统内置 Tag"，与用户自定义 Tag 走**同一套"定义 → 注册 → 查询 / 渲染"管线**，消除三处不同步；同时理顺命名（`PropertyDefinition` → `FieldDefinition`）。

## Decision

| # | 决策点 | 裁定（草案） |
|---|---|---|
| D1 | 统一类型 | 新增 `Tag`：`{ key, title, fields: FieldDefinition[], isSystem?: boolean, extends?: string }`。TS 于 `src/types/tag.ts`，Rust 于 `crates/comind-core/src/types/tag.rs`（serde 序列化，`is_system` snake_case）。系统与用户 Tag 共用此类型 |
| D2 | 改名 | `PropertyDefinition` → **`FieldDefinition`**（定义层 / 注册层 / 渲染层全量替换）；`property.ts` 保留一行 `export type PropertyDefinition = FieldDefinition` deprecated 别名过渡，避免存量调用点一次性爆炸；`getPropertyDefinition` / `getAllPropertyDefinitions` 函数名不变（返回 `FieldDefinition[]`） |
| D3 | 系统内置分组 | 新增 `SYSTEM_TAGS: Tag[]` 常量：#系统任务（status / priority / project / area）、#系统书笔记（book / part / chapter / cfi / quote / sourceBlockId / sourcePageId / language）。`BUILT_IN_PROPERTIES` **保留导出名**，内部改为 `SYSTEM_TAGS.flatMap(s => s.fields)` 展平，存量读取零改动 |
| D4 | 注册层遍历 | `registerBlockBuiltinFields` 改为遍历 `SYSTEM_TAGS` 的字段注册；`BUILTIN_KEYS` 改为由 `SYSTEM_TAGS` 派生（`new Set(SYSTEM_TAGS.flatMap(s => s.fields.map(f => f.key)))`）。**不改 Registry 接口**（仍按 entityType + key 注册，不引入实体维度） |
| D5 | 渲染过滤统一 | `PropertyDisplay` 过滤依据从"`displayPosition` + `isBuiltIn`"统一为"所属 tag 的 `isSystem`"；`isBuiltIn(key)` helper 改为查所属 tag。`displayPosition` 保留为纯渲染语义，不再承担"是否系统字段"职责 |
| D6 | 用户 tag 持久化 | 系统 tag 为编译期常量**不落库**；用户 tag 落 SQLite 新表 `tag`（id / key / title / fields_json / is_system / extends / created_at / updated_at），经 Rust `TagDefinitionService` CRUD + `SyncTable` 同步；block 打标 MVP 先以 `block_tag` 关联表落地（待评审） |
| D7 | 术语统一 | 统一用 `Tag` 一词：新实体 `Tag`（字段模板）与既有文本 `#tag` 语法解析**同属 Tag 概念**。既有 `tag_parse.rs`（原 `tag.rs`，含 `TagParse`）定位为"文本 `#tag` → Tag 实体"的**解析层**，**保留不动**（纯函数、无 UI 依赖）；新实体类型用 `tag.rs`（Rust）/ `tag.ts`（TS）。存储表用 `tag` / `block_tag` |
| D8 | MVP 范围 | 本 ADR 仅裁定"内置字段 = 系统内置 Tag + 统一类型 + 改名"。`extends` 继承、自动化 / AI 绑定、打标 UI 交互另立 ADR；但 `extends?: string` 字段先预留 |

## Consequences

- 新增内置字段：只改 `SYSTEM_TAGS` 对应分组一处，注册 / key 集合 / 过滤自动跟随。
- 系统与用户 Tag 同管线：查询 / 渲染无分支，字段注册统一走 Field Descriptor。
- 改名迁移：TS 侧全量替换 + 别名过渡；Rust 侧 `property.rs` 类型名不动（存储层 Property 保留），Tag 实体新增。
- 兼容性：`BUILT_IN_PROPERTIES`、`getPropertyDefinition`、`getAllPropertyDefinitions` 导出签名不变，存量调用点零改动。

## 迁移路径（TS/Rust 双栈改动清单）

### TS

1. `src/types/property.ts`：`PropertyDefinition` → `FieldDefinition` 全量替换 + deprecated 别名；`BUILT_IN_PROPERTIES` 改从 `SYSTEM_TAGS` 展平。
2. `src/types/tag.ts`（新）：`Tag` 类型 + `SYSTEM_TAGS` 常量（#系统任务 / #系统书笔记）。
3. `src/composables/useBlockQueryRegistry.ts`：`registerBlockBuiltinFields` 遍历注册；`BUILTIN_KEYS` 派生；`buildBlockFieldDescriptor` 参数类型改 `FieldDefinition`。
4. `src/components/Block/PropertyDisplay.vue`：过滤依据改为所属 tag `isSystem`；`isBuiltIn` helper 改查 tag。
5. 测试：`PropertyDisplay.test.ts` / `property.test.ts` / `useBlockQueryRegistry.test.ts` 更新断言（字段来源改为 tag 分组）。

### Rust

6. `crates/comind-core/src/types/tag.rs`（新）：`Tag` 结构体（serde）。
7. 用户 tag CRUD 服务（新）：文件/结构名待定——既有 `services/tag_service.rs`（`TagService::extract_tags` 文本解析）仍占用 `tag_service`，新 CRUD 服务须避让（如 `tag_crud_service.rs` / `tag_entity_service.rs`，评审定）。
8. `crates/comind-core/src/storage/`：SQLite / SQL.js 双实现加 `tag` 表 + `block_tag` 关联表（D6 待评审项）。
9. `crates/comind-core/src/services/batch.rs`：新增 tag create / update / delete op（沿用 ADR-0048 单源分派）。

## 非目标

- 既有 `tag.rs` / `TagParse` / `tag_service.rs`（文本 `#tag` 解析）定位为 Tag 的**解析层**，本 ADR 不动它们（见 D7）；不实现 `extends` 继承、自动化 / AI 绑定、打标 UI 交互（另立 ADR）。
- 不重设计 Registry / FieldDescriptor / ViewQuery 协议（ADR-0007 / 0023 语义不变）。
