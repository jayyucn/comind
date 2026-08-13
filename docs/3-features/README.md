# 功能规格

> 更新日期：2026-08-09\
> 覆盖变更：2026-08-08 ~ 2026-08-09

各功能模块的详细规格说明。

## 核心功能

| 文件 | 说明 |
| --- | --- |
| [block-editor-spec.md](block-editor-spec.md) | 块编辑器规格 - 块的基本操作（2026-08-09 更新：新增保存失败红点提示与重试功能） |
| [block-ordering-redesign.md](block-ordering-redesign.md) | 块排序重构 - Gap-based 排序机制 |
| [functional-design-spec.md](functional-design-spec.md) | 功能设计规格 - 核心功能总览 |
| [concept-block-spec.md](concept-block-spec.md) | ✨ 新概念块规格 - 四区结构概念深潜工具 |

## 任务与视图系统（2026-08-09 新增）

| 文件 | 说明 |
| --- | --- |
| — | ✨ **TaskHub 任务中心** - 多视图任务管理（表格/看板/日历），见 [useBlockQuery.ts](file:///D:/comind/comind/src/composables/useBlockQuery.ts)、[TaskHub.vue](file:///D:/comind/comind/src/components/TaskHub/TaskHub.vue) |
| — | ✨ **BlockCard 块投影模型** - 统一块查询卡片数据结构，支持属性/日期引用/内容预聚合 |
| — | ✨ **BlockQuery 查询引擎** - 声明式过滤（hasAny/isEmpty/is/isNot/contains/before/after）+ 链式排序 + 分组 |
| — | ✨ **TaskView 视图配置** - 可保存的视图方案（表格/看板/日历），持久化查询 JSON |
| — | ✨ **SavedFilter 保存过滤器** - 可复用的查询条件预设 |

## 通知系统（2026-08-09 重构）

| 文件 | 说明 |
| --- | --- |
| — | ✨ **通知配置引擎** - Rust 端实现，支持 schedule/deadline/overdue 三类提醒开关 |
| — | ✨ **静默时段（Quiet Hours）** - 可配置免打扰时间段（默认 22:00–08:00） |
| — | ✨ **浏览器通知开关** - Web Notification API 集成可选启用 |
| 参见 | [notification_config.rs](file:///D:/comind/comind/crates/comind-core/src/types/notification_config.rs)、[notification_service.rs](file:///D:/comind/comind/crates/comind-core/src/services/notification_service.rs) |

## 链接与引用

| 文件 | 说明 |
| --- | --- |
| [link-spec.md](link-spec.md) | 链接规格 - WikiLink、内部链接、外部链接（2026-08-09 更新：解析逻辑迁移至 Rust `content_parse_service.rs`） |
| [slash-commands-spec.md](slash-commands-spec.md) | 斜杠命令规格 - `/` 命令菜单（2026-08-09 更新：日期引用解析迁移至 Rust `date_parser.rs`） |
| [slash-commands-logseq-reference.md](slash-commands-logseq-reference.md) | Logseq 命令参考 |

## 内容组织

| 文件 | 说明 |
| --- | --- |
| [tag-spec.md](tag-spec.md) | ⚠️ 已废弃 - Tag 统一为 Page 链接（见 link-spec.md） |
| [property-spec.md](property-spec.md) | 属性规格 - `key:: value` 语法（2026-08-09 更新：属性解析迁移至 Rust `content_parse_service.rs`） |

## 高级功能

| 文件 | 说明 |
| --- | --- |
| [template-system-spec.md](template-system-spec.md) | ✨ 模板系统规格 - 内置10个模板 + 用户自定义 |
| [concept-graph-spec.md](concept-graph-spec.md) | 概念图谱规格 - 概念网络可视化 |

## 搜索功能

| 文件 | 说明 |
| --- | --- |
| [search-spec.md](search-spec.md) | ✨ 全局搜索规格 - 全文检索 + 中英文支持 + 增量索引（Phase 2 Sprint 3）|
