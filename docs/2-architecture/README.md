# 架构设计

> 更新日期：2026-08-09\
> 覆盖变更：2026-08-08 ~ 2026-08-09\
> 架构演进：**TS Core Layer → Rust/WASM Core Layer（Phase 3 Tauri 迁移进行中）**

系统的技术架构设计文档。

## 文档列表

| 文件 | 说明 |
| --- | --- |
| [data-model.md](data-model.md) | 数据模型 - Page、Block、Link 的定义与关系（2026-08-09 更新：新增 NotificationConfig / BlockCard / TaskView / SavedFilter / BlockSaveResult 类型） |
| [routing-design.md](routing-design.md) | 路由设计 - 页面路由、Journal 路由 |
| [storage-spec.md](storage-spec.md) | 存储规格 - SQLite / SQL.js 表结构（2026-08-09 更新：新增 notification_config / block_cards / task_views / saved_filters 表；同步表扩展至 Notification） |
| [core-layer.md](core-layer.md) | Core Layer 架构（2026-08-09 重大更新：Rust/WASM 实现；新增 6 个 Service + 3 个 Utils 模块） |
| [phase-3.5-spec.md](phase-3.5-spec.md) | Phase 3.5 TS-Rust 分离规格 — 与本次重构直接相关 |

## 架构变更速览（2026-08-08 ~ 08-09）

### Rust Core Layer 新增模块

**目录：** `comind/crates/comind-core/src/`

| 模块 | 文件 | 职责 |
| --- | --- | --- |
| **Services** | `services/content_parse_service.rs` | 内容解析：从 Block.content 提取 WikiLink / 外部链接 / TypedLink / Property Draft |
| | `services/render_segment_service.rs` | 渲染段结构化：将 content 拆分为 text / link / property 段，供 UI 层渲染 |
| | `services/block_projection_service.rs` | BlockCard 投影：聚合 Block + Property + DateRef + Page 元数据 → 查询卡片 |
| | `services/filter_service.rs` | 过滤服务：按 Property key/value / DateRef 条件过滤 Block |
| | `services/notification_service.rs` | 通知引擎：schedule/deadline/overdue 三类提醒触发 + 静默时间判断 |
| | `services/block_service.rs` | Block 写入主路径：快照内联 + 排序/树操作统一入口 |
| **Utils** | `utils/date_parser.rs` | 日期解析：自然语言 → ISO 日期（替换 TS `date-ref.ts`） |
| | `utils/journal_detect.rs` | 日记检测：判断字符串是否为日记格式日期（替换 TS `journal-detect.ts`） |
| | `utils/recurrence.rs` | 重复规则：RRule 解析与下次触发时间计算（替换 TS `recurrence.ts`） |
| **Types** | `types/notification_config.rs` | 通知配置（单行表 id=1） |
| | `types/block_card.rs` | BlockCard 查询投影 |
| | `types/task_view.rs` | TaskHub 视图方案（table/board/calendar） |
| | `types/saved_filter.rs` | 保存的过滤器预设 |
| | `types/block_save_result.rs` | 保存返回结果（Block + snapshot） |
| | `types/page_with_blocks.rs` | Page + 其 Block 树结构（渲染段结构化输出） |

### TS→Rust 迁移已完成项

- ❌ 删除 `comind/src/utils/parser.ts` + 测试 → ✅ Rust `content_parse_service.rs`
- ❌ 删除 `comind/src/utils/quiet-hours.ts` + 测试 → ✅ Rust `notification_service.rs`
- 🔄 精简 `comind/src/utils/date-ref.ts` → Rust `date_parser.rs` 承担主逻辑
- 🔄 重构 `comind/src/composables/useContentRenderer.ts` → Rust `render_segment_service.rs`

## 快速链接

- [Rust Core 实现（comind-core）](file:///D:/comind/comind/crates/comind-core/src/)
- [Tauri 命令入口（commands.rs）](file:///D:/comind/comind/src-tauri/src/commands.rs)
- [WASM 客户端（client.ts）](file:///D:/comind/comind/src/wasm/client.ts)
- [TS→Rust 分离设计文档](file:///D:/comind/comind/docs/refactor-design-ts-rust-separation.md)
- [ADR-0001: Ideas 页面创建迁移至 Rust](file:///D:/comind/docs/adr/0001-ideas-page-creation-in-rust.md)
