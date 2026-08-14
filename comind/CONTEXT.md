# CONTEXT.md — comind 领域术语表

> 持续演进的领域语言。新增概念、修改语义时同步更新。
> 最后更新：2026-08-14

---

## 一、核心概念

### Page（页面）
笔记容器。类似文件系统中的文件，但不是物理文件——是数据库中的一行。

| 术语 | 定义 |
|------|------|
| **normal page** | 普通笔记页。`type = "normal"` |
| **journal page** | 日记页。标题为 `YYYY-MM-DD` 格式。`type = "journal"`，router 自动路由到 `/ideas/` |
| **alias** | 页面别名。`aliases` 字段存 JSON 数组，`[[alias]]` 链接可解析到同一 page |
| **ideas** | 日记页的 UI 命名。前端路径 `/ideas/YYYY-MM-DD`，项目早期曾叫 "ideas page" |

### Block（块）
最小内容单元。类 Logseq 的大纲节点。

| 术语 | 定义 |
|------|------|
| **bullet** | 默认 block type。普通段落节点 |
| **heading** | 标题 block。type 为 `h1`~`h6` |
| **parent_id / pos** | 树结构字段。`parent_id=null` 为根节点，`pos` 越大越靠下 |
| **children** | 子 block。由 `parent_id` 关系隐式定义 |
| **sibling** | 同一 `parent_id` 下的兄弟 block，按 `pos` 排序 |
| **indent / outdent** | 缩进/反缩进。移动 block 到兄弟的 children 或上移一级 |
| **mergeWithPrevious** | 合并到前一个兄弟 block。content 拼接，后续兄弟 pos 重编号 |
| **splitBlock** | 拆分 block。光标位置切 content，后半段新建兄弟 |
| **document order** | Block 的 BFS 遍历序。`renumber_blocks` 按此序重分配 `pos`（gap=1000） |
| **GAP_SIZE** | pos 间距常量 = 1000。耗尽时触发 `renumber_blocks` |
| **structureVersion** | 前端响应式计数器。缩进/删除等结构性操作 +1，触发树重建 |

### Content（内容）
Block 的核心文本。使用自定义 WikiText 语法。

| 术语 | 语法 | 示例 |
|------|------|------|
| **wiki link** | `[[target]]` 或 `[[target\|alias]]` | `[[API 设计\|API]]` |
| **typed link** | `((type))[[target\|alias]]` | `((depends-on))[[接口文档]]` |
| **external link** | `[[https://...]]` | `[[https://example.com]]` |
| **date ref** | `@ISO [📅/⏰][\|recurrence\|leadMinutes]` | `@2026-08-05 ⏰\|weekly\|30` |
| **property** | `key:: value` 换行分隔 | `status:: doing` |
| **tag** | `#tagName` 或 `#ns/subtag` | `#bug`, `#project/backend` |
| **inline code** | `` `code` `` | `` `useBlockStore()` `` |

### DateRef（日期引用）
从 block.content 正则提取的**派生数据**，存储在 `date_refs` 表。

| 术语 | 定义 |
|------|------|
| **kind** | `schedule`(📅 计划日) / `deadline`(⏰ 截止日) / `ref`(纯引用) |
| **iso** | 本地 ISO 时间字符串。`YYYY-MM-DD`(全天) 或 `YYYY-MM-DDTHH:mm`(带时间) |
| **date_day** | 截断到天的 `YYYY-MM-DD`，用于范围查询索引 |
| **recurrence** | 重复规则。`none` / `daily` / `weekly` / `monthly` / `yearly` |
| **lead_minutes** | 提前提醒分钟数。0 = 准时 |
| **event_ts** | 预计算的事件 UTC 毫秒时间戳。用于 SQL `event_ts - lead*60000 <= now` 一条查询命中到期记录 |
| **overdue** | deadline 已过期。判定：`kind == "deadline" && iso_date < today` |

### Property（属性）
Block 的键值元数据。存储在 `properties` 表。

| 术语 | 定义 |
|------|------|
| **built-in property** | 系统预定义属性。`status`(Todo/Doing/Done)、`priority`(high/medium/low) |
| **user property** | 用户自定义属性。如 `assignee:: 张三` |
| **T11** | 属性自动推进规则编号。status=Done 时推进 recurrence date + 重置 status=Todo |

### Link（链接）
Block 之间的**关系数据**。存储在 `links` 表。

| 术语 | 定义 |
|------|------|
| **source_block_id** | 链接出处（哪个 block 写了 `[[X]]`） |
| **target_page_id** | 链接目标（解析到哪个 page） |
| **display_text** | 别名文本。`[[target\|别名]]` 中的 "别名" 部分 |
| **outlink** | 当前 page 的出链（源在当前 page 的 blocks） |
| **backlink** | 当前 page 的反链（目标是当前 page 的 links） |
| **typed link** | 带关系类型的链接。`((depends-on))[[X]]`，Link 表存 `relationship_type` 字段 |

### RelationshipType（关系类型）
用户定义的链接类型，用于 typed link 语义标注。

| 术语 | 定义 |
|------|------|
| **type** | 关系标识符。如 `depends-on`、`blocks` |
| **inverse** | 反向关系。如 `depends-on` 的 inverse 是 `required-by` |
| **双向语法** | `depends-on<->required-by` 同时设置正向+反向 |
| **自动反推** | `depends-on!` 后缀触发自动 inverse 解析 |

### RenderSegment（渲染段）
Block content 的**预计算渲染指令**。由 Rust `build_segments()` 生成。

| 术语 | 定义 |
|------|------|
| **segment** | content[start..end] 的一个语义区间。5 种 type：text/link/typed_link/external_link/date_ref |
| **覆盖全范围** | segments 必须覆盖 content 全部字符，无间隙。空白区域用 text segment |
| **文本回退** | block.renderSegments 为 undefined 时，BulletRender 回退纯文本渲染（#tag 高亮除外） |
| **stale segments** | 编辑 content 后未重新 loadPageBlocks，旧 segments 的 start/end 指向错误位置 → 必须 clear |

### Notification（通知）
从 DateRef 派生的事件提醒。

| 术语 | 定义 |
|------|------|
| **pending** | 未触发。`status = "pending"` |
| **fired** | 已触发。`status = "fired"`，写入 `fired_at` 时间戳 |
| **read / unread** | 前端已读/未读状态。通过 `status` 或独立字段管理 |
| **snooze** | 暂缓提醒。设置 `snooze_until` 时间戳 |
| **reschedule** | 非 recurring 通知原地改期。block content 改时间后，通知随 dateRef 挪动而非新建+留孤儿 |
| **quiet hours** | 静音时段。在此期间 scheduled 通知不触发通知 UI |

### BlockVersion（块版本快照）
Block 的历史版本，用于 undo 和同步。

| 术语 | 定义 |
|------|------|
| **snapshot** | 某个时间点 block 的 JSON 快照。`build_snapshot()` 在 `save_block_tree` 事务内生成 |
| **scheduleVersion** | 前端触发自动快照。`_doSave` 成功后调用 `blockVersionStore.scheduleVersion(id, snapshot, 'auto')` |

### Sync（同步）
PC ↔ Android 设备间同步。

| 术语 | 定义 |
|------|------|
| **LWW** | Last-Write-Wins。所有实体有 `version`(单调递增) + `deleted_at`(软删除)，冲突时取 version 大者 |
| **SyncTable** | 同步表枚举。共 9 张表：Block/Page/Link/Property/DateRef/RelationshipType/Template/Notification/NotificationConfig |
| **RowPayload** | 单行同步载荷。含 id/data/version/updated_at/deleted_at |
| **FullSync** | 全量同步。遍历 `SyncTable::all()`，每表分批复 `FullSyncResponse` |
| **Pairing** | 设备配对。token 一次性交换 |
| **SyncChanges** | 事务内收集的变更记录（HashMap<SyncTable, Vec<id>>），事务提交后推送到同步引擎 |

---

## 二、架构术语

| 术语 | 定义 |
|------|------|
| **Tauri** | 桌面框架。Rust 后端 + WebView 前端 |
| **commands.rs** | Tauri IPC 入口。所有 `#[tauri::command]` 函数 |
| **execute_with_adapter(db, f)** | 读路径包装。获取 StorageAdapter 锁后执行闭包，自动错误转换 |
| **execute_with_transaction_adapter(db, f)** | 写路径包装。在 SQLite 事务内执行闭包，失败自动回滚 |
| **Service 层** | `comind-core/src/services/`。业务逻辑，每个实体对应一个 Service |
| **Repository 层** | `StorageAdapter` trait 的方法组。数据库访问抽象，SQLite/WASM 双实现 |
| **StorageAdapter** | 存储适配器 trait。聚合所有 Repository trait，提供 `transaction()` 事务支持 |
| **WASM** | 浏览器端存储实现。`sqljs.rs` 通过 `SqlJsAdapter` 实现 StorageAdapter |
| **纯计算命令** | 不访问 DB 的 Tauri 命令。如 `parse_date_input`、`calculate_next_recurrence`、`apply_relationship_type_to_block_content` |
| **IPC** | 前端 ↔ Rust 通信。Tauri 用 `invoke()`，WASM 用 wasm-bindgen |
| **CoreClient** | 前端抽象接口。TauriClient(桌面) 和 WasmClient(浏览器) 双实现 |

### 通用查询引擎（generic query system）

业务无关的无头筛选/排序/分组引擎。实体通过声明 `FieldDescriptor` 接入，引擎对实体本身一无所知。详见 `docs/adr/0008-field-reference-value.md`。

| 术语 | 定义 |
|------|------|
| **FieldDescriptor** | 字段描述符。实体接入引擎的唯一契约：`key` / `label` / `type` / `get(item)`（同步取值器，支持派生字段）/ `ops?` / `options?`。 |
| **Registry** | 字段注册表。按 `entityType` 命名空间登记 `FieldDescriptor`，`get` / `list` / `subscribe` 驱动 UI 与求值。 |
| **ViewQuery** | 可序列化视图查询：`version:1` + `filter`(根条件组) + `sort[]`(多键) + `groupBy`(单字段)。 |
| **Condition** | 单个筛选条件：`field` + `op` + `value?`(`ConditionValue`)。 |
| **ConditionGroup** | 条件组：可嵌套的 AND/OR 组合树；空 children = 无筛选。含 `negate?`(组级取反，v1 通用 UI 不暴露)。 |
| **ConditionValue** | 条件值的判别联合：`literal`(字面量) / `field`(同记录字段引用) / `recordRef`(跨记录字段引用，业务无关)。取代旧版裸 `value`。 |
| **field（字段引用）** | 同记录字段引用 `{ kind:'field', field }`：求值时取当前记录另一字段值，实现字段间比较（如「字数 > 子页面数」）。 |
| **recordRef（记录字段引用）** | 跨记录字段引用（业务无关）`{ kind:'recordRef', entityType, recordId, field }`：经 `QueryContext.getById` 取目标实体再取其字段值。 |
| **QueryContext.getById** | 按 `entityType + id` 取实体对象的可选能力；跨记录引用解析的唯一把手。不提供时 `recordRef` 一律非匹配。 |
| **evaluate** | 求值入口：对 items 全量过滤 + 多键排序，返回子集（不修改入参）；`context?` 透传解析引用。 |
| **matchCondition / evalGroup** | 单条件匹配 / 条件组递归求值；均透传 `context`。 |
| **normalizeValue** | 反序列化边界的向前兼容处理：把旧版裸字面量包裹为 `{ kind:'literal' }`。 |
| **FilterBuilder** | 引擎唯一的通用 UI 交付物。注册表驱动：字段下拉 + 类型派生操作符 + 类型分派值编辑器；`ValueEditor` 支持「固定值 / 字段」分段与 `+` 引用菜单。**在页面库筛选芯片 UX（ADR-0009）中作为「高级筛选」逃逸舱**，经 "Add advanced filter" 进入，承载嵌套条件组与字段引用值。 |

### 页面库筛选芯片 UX（filter chip UX，ADR-0009）

复刻 Notion 表格视图的「芯片 + 弹出层」轻模式，是 `ViewQuery` 在页面库交互层的**投影**（不改引擎类型）。详见 `docs/adr/0009-notion-filter-chip-ux.md`。

| 术语 | 定义 |
|------|------|
| **Filter Chip Bar（芯片行）** | Header 与 Table 之间的横条，承载筛选/排序/分组 chip + `all/any` 切换。出现条件 = 筛选条件>0 OR 排序键>0 OR 已分组。 |
| **Filter Chip（筛选芯片）** | 芯片行中代表单个 `Condition` 的可点击元素，点开 `ConditionPopover` 编辑 `[字段][操作符][值]`。 |
| **Sort Chip（排序芯片）** | 每个排序键一个 chip（`↑ 标题` / `↓ 更新时间`），多键并列；点开 `SortMenu` 改字段/方向。 |
| **Group Chip（分组芯片）** | 单字段分组 chip（`分组：类型`）；`groupBy=null` 时不渲染。 |
| **Condition Popover（条件弹出层）** | 编辑单个 `Condition` 的浮层：`[字段名▾] [操作符▾] [ChipValueEditor]`。 |
| **Field Select Menu（字段选择菜单）** | `+ Filter` 触发的下拉：搜索框 + 字段列表 + 底部 "Add advanced filter"。 |
| **all/any toggle** | 顶层 AND/OR 切换，投影到根 `ConditionGroup.combinator`（`'and'`/`'or'`）；仅绑筛选，不绑排序/分组。 |
| **BasePopover** | 通用弹层原语（新增）。封装 Teleport+overlay+`position:{x,y}`+Escape+`@click.self` 关闭，复用 `--bg-base`/`--border`/`--shadow-modal` 令牌；所有新弹层包一层它。 |
| **ChipValueEditor** | 芯片内 literal 值编辑器（新增，仅 literal）：按 `FieldType` 分派——text/number/date/select/multiSelect/boolean 各自 UI；`isEmpty`/`isNotEmpty` 无值区。跨记录引用仍走 `FilterBuilder`/`ValueEditor`。 |
| **Advanced Filter（高级筛选）** | 经 "Add advanced filter" 进入的 `FilterBuilder` 面板，支持嵌套条件组与字段引用值；在芯片行退化为单个不可内联编辑的「N rules」聚合 chip。 |
| **聚合 chip（aggregated chip）** | 当根 `ConditionGroup` 含嵌套子组（非纯 `Condition` 列表）时，芯片行只渲染此 chip 提示存在高级筛选，点它重开面板。 |

---

## 三、数据流术语

| 术语 | 定义 |
|------|------|
| **save_block_tree** | 单 block 保存路径。事务内完成 block update + dateRef sync + link sync + property sync + snapshot + notification reschedule + SyncChanges 收集 |
| **execute_batch** | 批量操作路径。支持 block/page/link 的 create/update/delete + "sync_by_block" action |
| **loadPageBlocks** | 前端加载页面 blocks。调用 `get_page_with_blocks`，获取 blocks + renderSegments + properties + children |
| **build_page_with_blocks** | Rust 组装 PageWithBlocks DTO。串联 block query + link/property/dateRef 解析 + RenderSegment 拼接 |
| **_doSave** | 前端 debounced 保存。每 block 独立防抖(SAVE_DEBOUNCE_MS)，调用 save_block_tree |
| **_triggerSyncDebounced** | 保存后 5 秒触发设备同步。仅 Tauri 环境 |
| **record_and_notify** | 通知触发入口。S2 已迁移到 Rust |
| **checkAndFire** | 定时扫描到期 dateRef → 创建/触发 notification。批量化：`query_due_non_recurring` + `query_all_recurring` + 批量 get_by_ids |

---

## 四、重构路线图术语

| 术语 | 定义 |
|------|------|
| **S1–S10** | TS→Rust 重构的 10 步路线图。源自 `docs/refactor-design-ts-rust-separation.md` |
| **4.2** | 内容解析器迁移（S3）。`parseDateRefs` → Rust DateRefService |
| **4.3** | 关系类型同步迁移（S7）。`parseBlockLinks` → Rust ContentParseService |
| **4.4** | Block 排序与树操作（S5）。reorder/renumber/is_descendant_of |
| **4.5** | BlockVersion 快照内联（S4）。build_snapshot |
| **4.6** | 日期/recurrence/journal 迁移（S6）。date-parser/recurrence/journal-detect |
| **5.2** | 同步通知扩展。save_block_tree + execute_batch 收集 Notification SyncChanges |
| **5.3** | 统一写入路径。execute_batch page/link 切到 Service 层 |
| **5.4** | 回滚策略（S9）。saveErrors + retrySave + deleteBlocks 快照回滚 |
| **第 7 节** | 渲染层结构化数据（S10）。RenderInput 接口 + getPageWithBlocks 全链路 |

---

## 五、前端命名约定

| 术语 | 路径 | 说明 |
|------|------|------|
| **BulletRender** | `components/Block/handlers/bullet/` | bullet 类型 block 的渲染态组件 |
| **Editor.vue** | `components/Block/` | TipTap 编辑器组件（编辑态） |
| **index.vue** | `components/Block/` | block 容器。v-if 切换 Editor / BulletRender |
| **blockStore** | `stores/blocks.ts` | Pinia store。blocks 缓存 + 树操作 + 保存调度 |
| **propertyStore** | `stores/property.ts` | Pinia store。属性 CRUD + T11 自动推进 |
| **editorStore** | `stores/editor.ts` | Pinia store。activeEditor + toast |
| **blockCardStore** | `stores/blockCard.ts` | Block 卡片缓存，invalidate 清缓存 |
| **blockVersionStore** | `stores/blockVersion.ts` | 版本快照管理 |
| **useContentRenderer** | `composables/useContentRenderer.ts` | 渲染引擎。RenderInput → HTML |
| **useRelationshipSync** | `composables/useRelationshipSync.ts` | typed link 实时同步 |
| **useBlockRelationshipCleanup** | `composables/useBlockRelationshipCleanup.ts` | block 删除后 typed link 清理 |

---

## 六、项目路径约定

| 路径 | 说明 |
|------|------|
| `D:\comind\comind\` | 项目根（Monorepo 内层） |
| `crates/comind-core/src/` | Rust 核心库 |
| `src-tauri/src/` | Tauri 桌面端 |
| `src/` | Vue3 前端 |
| `src/wasm/` | WASM 客户端桥接层 |
