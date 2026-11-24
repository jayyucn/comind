# ADR-0051: 属性概念退役收尾——Tag 化改名 + block_version 与 Property 表删除

- Status: accepted（2026-09-30 经 grilling 逐条确认）
- Date: 2026-09-30
- 就地推翻的条款：ADR-0047 D1「**Rust 侧 `BlockVersionService` 与表保留**」；ADR-0049 D2「`property.ts` 保留一行 deprecated 别名过渡」「`getPropertyDefinition` / `getAllPropertyDefinitions` 函数名不变」与 D3「`BUILT_IN_PROPERTIES` 保留导出名」
- Related: ADR-0049（Tag 统一字段模型 / 属性概念退役方向）、ADR-0050（D8 数据层改名、D9 阶段 3、开放问题）、ADR-0047（block version 下架）、ADR-0046（撤销栈边界）、ADR-0048（batch 分派单源）
- Tracking: —

## Context

### 触发

用户提问：「property 不是已经废弃了吗？怎么还有 `src/types/property.ts` 这样的文件名」。核查结论：**废弃的是三样东西，不是这个文件名**——① 遗留 `Property` 表（已冻结）、② `PropertyService` 适配层（过渡用）、③ `Property*` UI 组件（ADR-0050 D9 阶段 3，待实施）。而 `Property` 的 **JSON 传输形状**仍是活的。文件名保留是 ADR-0049 D2 的明文决策，不是漏改；但其中两个导出确为死码。

### 核查事实

- `src/types/property.ts` 8 个导出中 7 个被 **29 个文件** import。
- 唯一带 `@deprecated` 的是 `property.ts:37` 的 `PropertyDefinition` 别名（ADR-0049 D2 明文保留）；实测 **0 消费点**。另有 `PropertyRecord`（`property.ts:74`）同样 **0 消费点**且未标废弃。
- `Property` 形状是**三处线上传输形状**，不是适配层内部细节：
  - 页面加载 —— `types/page_with_blocks.rs:24` `pub properties: Vec<Property>`，由 `services/render_segment_service.rs:112` 经 `PropertyService::get_by_block_ids` 填充；
  - 查询投影 —— `services/block_projection_service.rs:28` 调 `PropertyService::get_all`；
  - Ideas 物化快照 —— `services/snapshot_service.rs:16`（ADR-0042）。
- **`block_version_service.rs` 是 `Property` 表唯一残留读写方**（`:126` / `:133` / `:199`，全 Rust 侧 `.properties()` 仅此三处）。ADR-0049 落地补充把 DROP 挂在「block_version 模块删除」之后，而 ADR-0047 D1 又明文「Rust 侧 `BlockVersionService` 与表保留」——**两份 ADR 存在未消解的冲突**。
- `services/block_write.rs:97` **每次保存块都在事务内**调 `BlockVersionService::build_snapshot`（读 Property 表 + 块 + 链接），产出 `BlockSaveResult.snapshot`；而前端消费点已随 ADR-0047 的 UI 下架**全部移除**（`stores/blocks.ts` 已无 `scheduleVersion` / `saveResult.snapshot` 消费；`App.vue:47` 记录面板已下架）→ **热路径上的死重**。
- `SyncTable`（`types/sync_table.rs`）的 variant 名作为字符串随 `SyncMessage` 序列化过线（`sync/message.rs:7-25`）→ **表名改名 = 改线协议**。
- 00 侧 TS 定义归属是反的：`types/tag.ts:2` 反向 `import type { FieldDefinition } from './property'`，字段定义住在「属性」文件里。

### 前提（用户明示）

**本次不考虑旧数据兼容——库内均为测试数据。** 据此豁免：存量行迁移脚本（`ALTER` / 表重命名 / 回填）、破坏性操作告知（受影响条目数）、以及 `SyncTable` 线上串的兼容轮次。

## Decision

| # | 决策点 | 裁定 |
|---|---|---|
| D1 | 改名范围 | `FieldDefinition` → **`TagFieldDefinition`**、`FieldValue` → **`TagFieldValue`**（Rust struct + TS type + **表名** + **`SyncTable` 线上串**，三者同批；对齐 ADR-0050 D8 并终结其开放问题）。表名当前与类型名一致同名（`sqlite.rs:325/342`、`sqljs.rs` 双端 DDL），只改一半会永久打破该一致性；且本包已要动一次 sync 词汇表，合并为一次变更 |
| D2 | 定义归属 | `TagFieldDefinition` 定义**迁入 `src/types/tag.ts`**（Tag 与其字段同文件），消除 `tag.ts → property.ts` 反向依赖。Rust 文件随类型改名（`types/field_definition.rs` / `types/field_value.rs`） |
| D3 | 常量 / 函数去属性化 | `BUILT_IN_PROPERTIES` → `BUILT_IN_FIELDS`、`getPropertyDefinition` → `getFieldDefinition`、`getAllPropertyDefinitions` → `getAllFieldDefinitions`。ADR-0049 D2/D3「名字不变」的立论是「避免存量调用点一次性爆炸」，实测消费面仅 6 个文件，该立论已不成立 |
| D4 | 清死码 | 删除 `property.ts` 的 `PropertyDefinition` 死别名与 `PropertyRecord` 死接口 |
| D5 | **② 不切形状** | `PropertyService` → **`FieldValueService`**（文件同名跟随），**`Property` struct / TS interface 与 JSON 契约完全不动**。理由：① 形状直切会引入「`field_definition_id` 外键 → TS 每个消费端回查定义，解析责任归谁」这一未决设计，不应让 DROP 等它；② 形状是无类型 JSON，改动无编译期保护，与 DROP 同批会让失败无法定位。形状直切另立批次 |
| D6 | **③ UI 整体退役、职责全迁** | 四个 `Property*` 组件（`PropertyInline` / `PropertyDisplay` / `PropertyEditor` / `PropertyQuickEditor`）整体退役，渲染职责全迁 tag 本位载体——**含内联槽**（`status` 任务图标，`Block/index.vue:571/627`）与下方字段区（并入 `BlockTagFields.vue`）。D9 说的「退役」是命名，渲染职责必须保住 |
| D7 | **④ 删 block_version 全链 + DROP Property 表** | 删 `services/block_version_service.rs`（+ 测试）、`storage/entity/block_version.rs`、`types/block_version.rs`、**`block_versions` 表（含存量数据）**、wasm 6 个导出、`src-tauri` 6 个命令 + `lib.rs` 注册、前端孤儿（`stores/blockVersion.ts` / `types/blockVersion.ts` / `components/RightSidebar/BlockVersionPanel.vue`）；并删 `SyncTable::Property` variant（含 `all()`）、`PropertyRepository` trait + 三适配器 impl（`SQLiteAdapter` / `TxContext<'a>` / `SqlJsAdapter`）、`storage/entity/property.rs`、双端 `Property` 表 DDL（`sqlite.rs:138` / `sqljs.rs:172`）。ADR-0047 D1 保留它的唯一理由是 `restore` 的事务语义「将来可复用」，而该复用路径已被 ADR-0047 自己指向 `SnapshotService::materialize_page`（Checkpoint 形状），与 block_version 无关；且其 `cleanup` 本身是死代码（`delete_older_than(block_id="")` 永不命中）、版本行只增不减 |
| D8 | 摘热路径死重 | 摘掉 `block_write.rs:97` 的 per-save `build_snapshot` 及 `BlockSaveResult.snapshot` 字段里无人消费的产出。**独立成首批**，因为它可立即验证且立刻消掉「每次保存读冻结表」的开销 |

**落地不变量（本包完成后才成立）**：`FieldValue` 是唯一事实源，**任何代码路径不得再读写 `Property` 表**——ADR-0049 落地补充写下的该不变量，在此之前一直被 `block_version_service.rs` 违反。

## 执行批次与验证门禁

删表刻意排在改名之前：DROP 是本包唯一不可逆动作，先让它单独过验证；后续全为可回滚的机械改名。

| 批 | 内容 | 验证 |
|---|---|---|
| 1 止血 | D8（摘 per-save `build_snapshot`）+ 前端 blockVersion 孤儿清理 | `cargo test` + `npm run test` |
| 2 删除 | D7 全链删 + DROP `Property` 表 + DROP `block_versions` 表 | `cargo check --target wasm32` + `wasm:build` + 双端建库 |
| 3 改名 | D1 + D2 + D3 + D4 + D5（纯机械，编译期可兜） | `vue-tsc -b` + `cargo check` + `npm run test` |
| 4 UI | D6 职责全迁 | `vue-tsc -b` + `npm run test` + 前端功能验证 |

每批独立提交、独立验证（对齐 ADR-0050 D9 的「每阶段可独立提交、独立验证」纪律）。

## Consequences

- `Property` 表与 `block_versions` 表从双端 schema 中消失；`BlockVersionRepository` / `PropertyRepository` 及其适配器 impl 一并删除。已同步设备的存量 payload 中若含 `"Property"` 表名，新版本不再识别（**测试数据前提，接受**）。
- 表名与线上串同步改名后，`SyncTable` 词汇表一次到位，不留兼容轮次。
- `Property` 结构体与 `Property` JSON 形状**继续存在**（页面加载 / 查询投影 / Ideas 快照的传输契约），故 `src/types/property.ts` **文件名不变**——其内容清空至只剩真正属于 property 的成员（`PropertyType` / `PropertyValue` / `Property`）。
- `src/types/tag.ts` 成为 Tag 与其字段定义的单一归属，依赖方向从「Tag 依赖 property」翻正为「property 形状独立，Tag 自持字段定义」。
- 「属性」一词在活代码里基本退场；CONTEXT.md 的 `Property (属性) — RETIRING` 词条可收窄为「仅指遗留 JSON 传输形状」。

## 非目标

- **形状直切不做**（D5）：`Property` → `FieldValue` 形状切换、`Property` struct / interface 删除、`field_definition_id` 外键的 TS 解析归属，整体留作下一批独立立项。
- 不改 `Property` JSON 契约（`key` / `value` / `type` 字段语义不变），故 `stores/property.ts`、`useBlockPropertySync`、撤销栈（`useUndoHistory` / `useUndoRestore`）、`utils/property-codec.ts` 的行为均不变。
- 不动 `Tag` / `SYSTEM_TAGS` 的模型语义（ADR-0049 / ADR-0050 既有裁定不变，仅命名与归属随本 ADR 调整）。
- ADR-0047 的「跨会话回溯以 Checkpoint 形状重提」需求挂账状态不变。