# comind 文档索引

> 更新日期：2026-08-09\
> 覆盖变更：2026-08-08 ~ 2026-08-09\
> 本文档是 docs/ 目录的唯一入口点。Agent 只需加载 `active/` 目录即可获得完整项目上下文。

---

## Phase 3.5 TS→Rust 迁移 + TaskHub 新增（2026-08-09 更新摘要）

**文档版本：** 本次同步更新 docs/ 下 6 个子目录 README 及根目录 README.md，共 7 处文档变更。

### 一、TaskHub 任务中心（新增功能域）

| 项 | 说明 |
| --- | --- |
| **路由** | `/taskhub` 新增页面（TaskHub.vue） |
| **三视图** | TableView / BoardView / CalendarView，分别见对应组件 |
| **数据模型** | BlockCard（块投影）、TaskView（视图方案）、SavedFilter（过滤器预设） |
| **查询引擎** | `applyQuery(cards, query)` 纯函数 — 7 操作符 + 链式排序 + groupBy 声明式 |
| **新增 Store** | `useBlockCardStore` / `useTaskViewStore` / `useSavedFilterStore` |
| **Ideas 集成** | BlockTaskItem / BlockTaskList 组件嵌入 IdeasTodayPanel |

### 二、通知系统 Rust 端重构

- `notification_config` 表（单行 id=1）新增：enabled / schedule_enabled / deadline_enabled / overdue_enabled / quiet_hours_start / quiet_hours_end / web_browser_notifications_enabled
- `notification_service.rs` 承担三类提醒触发 + 静默时间判断
- TS 端 `notification-service.ts` 已删除（~253 行），逻辑迁入 Rust
- 同步表扩展至 Notification 数据

### 三、Core Layer TS→Rust 迁移进度（本时段完成 8 项）

| 模块 | Rust 文件 | 说明 |
| --- | --- | --- |
| 内容解析 | `services/content_parse_service.rs` (531 行新增) | WikiLink / 外部链接 / TypedLink / Property Draft 统一解析出口 |
| 渲染段 | `services/render_segment_service.rs` (241 行) | content → text/link/property 结构化段 |
| Block 投影 | `services/block_projection_service.rs` (133 行) | Block + Property + DateRef + Page → BlockCard |
| 过滤 | `services/filter_service.rs` (71 行) | Property/DateRef 条件过滤 |
| 通知引擎 | `services/notification_service.rs` (391 行) | 见上 |
| 块写入 | `services/block_service.rs` (+114 行变更) | BlockVersion 快照内联、排序/树操作统一入口 |
| 日期解析 | `utils/date_parser.rs` (332 行) | 替换 TS `date-ref.ts` 主逻辑 |
| 日记检测 | `utils/journal_detect.rs` (139 行) | 替换 TS `journal-detect.ts` |
| 重复规则 | `utils/recurrence.rs` (155 行) | 替换 TS `recurrence.ts` |

**已删除 TS 文件：** `utils/parser.ts`（213 行）、`utils/quiet-hours.ts`（45 行）及对应测试。

### 四、块组件优化

- **保存失败红点提示**：Block 左边缘 🔴 小圆点 + error-subtle 背景，悬停 Tooltip，点击触发重试
- **BulletRender 组件**：重构配合 render_segment_service 结构化输出

### 五、测试变更

- **新增 Vitest 约 325 用例**：blockCard / taskView / useBlockQuery / edit-render-timing / BoardView / TableView / BulletRender 等
- **删除约 55 用例**：parser.test.ts、quiet-hours.test.ts
- **Playwright 待补**：TaskHub 三视图 + 保存失败红点 spec

### 六、文档索引更新

| 文档 | 变更类型 |
| --- | --- |
| [3-features/README.md](3-features/README.md) | 新增「任务与视图系统」「通知系统（重构）」两节 |
| [2-architecture/README.md](2-architecture/README.md) | 新增 Rust Core Layer 9 模块速览 + TS→Rust 迁移清单 |
| [4-ui/README.md](4-ui/README.md) | 新增 TaskHub 组件交互表 + 块保存失败状态机 |
| [5-development/README.md](5-development/README.md) | 新增 Rust 开发规范 / CoreClient API / BlockQuery DSL / Store 表 |
| [6-reports/README.md](6-reports/README.md) | 新增测试覆盖表（Vitest 新增/删除项） |
| [../README.md](../README.md) | 项目结构、技术栈、核心功能、TS→Rust 迁移表全面更新 |

---

## 文档结构

```
docs/
├── README.md              ← 你在这里
└── active/                ← 活跃文档（Agent 日常参考）
    ├── spec.md            # 项目规范（定位 + 概念 + TODO）
    ├── architecture.md    # 架构设计（数据模型 + 存储 + 路由 + 编辑器）
    ├── features.md        # 功能规格（链接 + 命令 + Block 操作）
    ├── interaction.md     # 交互规范（视觉 + 状态机 + 鼠标/键盘操作）
    ├── development.md     # 开发指南（技术栈 + 项目结构 + CRUD + 检查清单）
    └── product-vision.md  # 产品愿景（定位 + 功能清单 + 界面规划）
```

---

## 快速导航

| 你需要了解... | 阅读文档 | 关键章节 |
|-------------|---------|---------|
| 项目是什么 | `spec.md` | §1 项目概述、§2 产品定位 |
| 核心概念 | `spec.md` | §3 核心概念（Block/Page/Link/Property） |
| 技术栈 | `development.md` | §1 技术栈 |
| 数据模型 | `architecture.md` | §1 数据模型 |
| 存储格式 | `architecture.md` | §2 存储格式 |
| 路由设计 | `architecture.md` | §3 路由设计 |
| 编辑器约束 | `architecture.md` | §4 编辑器架构（C1-C4 约束） |
| 属性系统 | `architecture.md` | §5 属性系统 |
| 排序机制 | `architecture.md` | §6 排序机制（Gap Pos） |
| 链接系统 | `features.md` | §1 链接系统 |
| 全局搜索 | `search-spec.md` | ✨ 完整功能规格（全文检索 + 中英文支持） |
| 关系类型链接 | `link-spec.md` | §2.2 关系类型链接 |
| 概念图谱 | `concept-graph-spec.md` | 完整功能规格 |
| 概念块 | `concept-block-spec.md` | ✨ 完整功能规格（四区结构概念深潜） |
| 斜杠命令 | `slash-commands-spec.md` | 完整功能规格 |
| 模板系统 | `template-system-spec.md` | 完整功能规格 |
| Block 操作 | `features.md` | §3 功能设计 |
| 视觉规范 | `interaction.md` | §1 视觉系统 |
| 关系类型 UI | `ui-ux-spec.md` | §关系类型系统 UI |
| Block 状态机 | `interaction.md` | §2 Block 状态机 |
| 鼠标操作 | `interaction.md` | §3 鼠标操作 |
| 键盘操作 | `interaction.md` | §4 键盘操作 |
| 项目结构 | `development.md` | §2 项目结构 |
| 核心约束 | `development.md` | §3 核心架构约束 |
| Core Layer | `development.md` | §1 Core Layer 架构（框架无关） |
| CRUD 操作 | `development.md` | §5 Page ↔ Block CRUD |
| 内容解析 | `development.md` | §6 内容解析 |
| 产品愿景 | `product-vision.md` | §1-§9 完整产品规划 |
| 功能 TODO | `spec.md` | §7 TODO |

---

## 文档版本记录

| 文档 | 版本 | 更新日期 | 来源 |
|------|------|---------|------|
| spec.md | v1.0 | 2026-05-21 | 合并自 SPEC.md + TODO.md |
| architecture.md | **v4.2** | **2026-07-24** | **新增 version 和 deleted_at 字段，支持 LWW 同步和软删除** |
| features.md | v1.0 | 2026-05-21 | 合并自 link-spec + slash-commands-spec + functional-design |
| interaction.md | v1.0 | 2026-05-21 | 合并自 interaction-spec + ui-ux-spec |
| development.md | **v6.0** | **2026-06-27** | **新增 Core Layer 架构章节** |
| product-vision.md | v1.4 | 2026-05-20 | 从 comind/docs/ 迁入 |
| block-editor-spec.md | **v0.5** | **2026-06-07** | **新增 Concept Block 章节** |
| ui-ux-spec.md | v1.1 | 2026-06-05 | 新增关系类型标签点击切换 |
| link-spec.md | v0.4 | 2026-06-05 | 新增关系类型自定义 + 清理系统 |
| concept-graph-spec.md | v0.6 | 2026-06-04 | 已实现 Phase 1 + Phase 2 功能 |
| storage-spec.md | **v0.9** | **2026-07-24** | **新增 version 和 deleted_at 字段** |
| slash-commands-spec.md | **v1.0** | **2026-06-06** | **新增模板系统集成** |
| template-system-spec.md | **v1.0** | **2026-06-06** | **新增模板系统完整规格** |
| concept-block-spec.md | **v1.0** | **2026-06-07** | **✨ 新概念块完整规格** |
| search-spec.md | **v1.0** | **2026-06-27** | **✨ 全局搜索完整规格** |
| core-layer.md | **v1.0** | **2026-06-27** | **✨ Core Layer 架构设计** |
| storage-adapter.md | **v1.0** | **2026-06-27** | **✨ Storage Adapter 接口规范** |
| sprint-1-plan.md | **v1.0** | **2026-06-27** | **✨ Phase 2 Sprint 1 计划** |

---

## Agent 使用指南

### 最小上下文加载
Agent 启动时只需加载 `docs/active/` 下的 6 个文件即可获得完整项目上下文。

### 按需加载
- 开发新功能 → 阅读 `spec.md` + `architecture.md` + `development.md`
- 修改交互 → 阅读 `interaction.md`
- 修改数据模型 → 阅读 `architecture.md`
- 开发存储层 → 阅读 `architecture.md` §2 + `development.md` §7
- 了解产品方向 → 阅读 `product-vision.md`

### 添加新文档
新功能规格文档应追加到对应的 `active/` 文件中（如新功能属于已有功能域），或创建新文件（如全新功能域）。

---

## Phase 2 Sprint 3 更新摘要（2026-06-27）

### 主要功能

#### Core Layer 架构重构完成
- **框架无关设计**：核心业务逻辑抽离到纯 TypeScript 层，不依赖 Vue/Pinia/tiptap
- **服务层抽象**：BlockService、LinkService、TagService、PropertyService、PageService、SearchService
- **存储适配器接口**：IndexedDBAdapter（生产）+ MemoryAdapter（测试）
- **依赖注入模式**：所有服务通过构造函数注入存储适配器
- **测试覆盖率**：159 个测试用例，95%+ 覆盖率

#### 全文搜索系统（Phase 2 Sprint 3）
- **LunrSearch 搜索引擎**：基于 Lunr.js 的全文搜索引擎
- **中英文支持**：英文标准分词 + 中文 bigram 字符二元切分
- **增量索引**：IndexManager 自动监听数据变化，300ms Debounce 延迟重建
- **SearchService API**：统一搜索接口，支持类型过滤（block/page/all）
- **SearchPanel 组件**：全局搜索弹窗，Ctrl+K/Cmd+K 快捷键唤起
- **键盘导航**：上下箭头选择结果，Enter 打开，Esc 关闭
- **结果高亮**：搜索结果中高亮显示匹配文本
- **20 个新增测试**：lunrSearch.test.ts + searchService.test.ts

### 架构文档新增
- **Core Layer 架构设计**（core-layer.md）- 完整架构总览、模块结构、核心原则
- **Storage Adapter 接口规范**（storage-adapter.md）- 适配器接口定义、实现要求、测试策略
- **Phase 2 Sprint 1 计划**（sprint-1-plan.md）- Sprint 交付物、任务分解、验收标准

### 相关文档更新
- `docs/1-overview/SPEC.md` - 更新 Phase 2 规划状态
- `docs/3-features/search-spec.md` - 新增全局搜索完整规格（v1.0）
- `docs/5-development/dev-guide.md` - 更新至 v6.0（新增 Core Layer 章节）
- `docs/6-reports/phase-2-sprint-3-verification-report.md` - Sprint 3 验证报告

---

## v0.10 更新摘要（2026-07-24）

### 主要功能

#### 数据同步基础能力完善
- **版本号字段**：为 Page/Block/Property/Link/DateRef 等核心数据结构新增 `version` 字段，单调递增，用于多端同步时的 LWW（Last Write Wins）冲突解决
- **软删除字段**：新增 `deleted_at` 字段替代旧 `deleted` 字段，支持软删除操作的同步传播
- **默认值初始化**：补充所有新增字段的默认值初始化逻辑（version=0, deleted_at=null）
- **同步模块调整**：优化 `src-tauri/src/sync.rs` 和命令层代码结构，提升可读性

#### 侧边栏结构调整
- **设置按钮迁移**：将设置按钮从侧边栏底部（SidebarFooter）迁移到侧边栏头部导航区域（SidebarHeader）
- **冗余代码清理**：移除 SidebarFooter 中与设置按钮相关的样式和逻辑代码

### 相关文档更新
- `docs/2-architecture/data-model.md` - 更新至 v0.6（新增 version 和 deleted_at 字段）
- `docs/2-architecture/storage-spec.md` - 更新至 v0.9（SQLite 表结构更新）
- `docs/active/architecture.md` - 更新至 v4.2（数据模型定义更新）
- `docs/4-ui/ui-ux-spec.md` - 更新设置按钮入口位置说明

---

## v0.9.1 更新摘要（2026-06-08）

### 主要修复

#### 模板系统稳定性修复
- **键盘选择修复**：`selectedIndex` 仅在查询文本实际变化时重置，避免 ProseMirror 编辑器更新导致选中状态意外重置
- **cursor 渲染修复**：`{{cursor}}` 变量渲染为空字符串，不再显示为可见的 `__CURSOR__` 文本
- **命令顺序一致性**：`flatCommands` 从 `groupedCommands` 派生，保证渲染顺序与选择顺序一致

#### 块关系清理时序修复
- **时序优化**：在删除块前先保存块快照并检查同页存活块的关联关系
- **逻辑重构**：将跨页清理准备、存活关联检查提前到删除操作之前
- **防止误判**：避免删除块后再检查导致的存活块判断错误

#### 样式修复
- **拖拽占位样式**：给拖拽占位选择器新增 `block-list-padding` 排除类，修复跨容器拖拽时 padding 占位元素被误隐藏的问题

### 测试增强
- **块关系清理测试**：为 `useBlockRelationshipCleanup` 添加 IndexedDB 初始化和依赖
- **斜杠命令菜单测试**：为 SlashCommandMenu 添加模板列表子视图的完整测试用例
- **模板命令测试**：重构 `useSlashCommands` 测试，适配模板命令相关功能

### 相关文档更新
- `docs/3-features/slash-commands-spec.md` - 更新键盘导航稳定性说明
- `docs/3-features/template-system-spec.md` - 更新 cursor 变量处理细节
- `docs/5-development/dev-guide.md` - 更新块关系清理时序和模板渲染器说明

---

## v0.9 更新摘要（2026-06-07）

### 主要功能

#### Concept Block（概念块）完成实现
- **数据模型重构**：Concept Block 从 Block 类型改为 Page 元数据存储（`page.format.concept`）
- **固定位置渲染**：Concept Block 固定在页面顶部（标题下方，BlockList 上方），不可拖拽
- **四区结构**：核心定义、边界范围、对标辨析、实例应用，每个区域可独立折叠
- **Tab 导航**：支持在输入字段间按 Tab 切换焦点
- **折叠状态同步**：编辑与展示模式间共享区域折叠状态
- **占位符显示**：空字段显示灰色斜体占位符文本
- **事件处理优化**：点击 Concept Block 不触发普通块的失活

### 技术变更
- `App.vue` 添加 `.concept-block` 检测，避免误触 `deactivateBlock`
- `Page/index.vue` 新增 `PageConceptBlock` 组件
- `useBlockTree.ts` 过滤 type: 'concept' 的 Block（向后兼容）
- `Block/index.vue` 移除 concept 特殊处理逻辑
- `useSlashCommands.ts` 简化 `/concept` 命令实现

### 相关文档
- `docs/3-features/concept-block-spec.md` - 新增概念块完整规格（v1.0）
- `docs/3-features/block-editor-spec.md` - 更新至 v0.5（新增 Concept Block 章节）
- `docs/3-features/README.md` - 更新功能索引
- `docs/superpowers/specs/2026-06-06-concept-block-design.md` - 概念块设计规范

---

## v0.8 更新摘要（2026-06-06）

### 主要功能

#### 模板系统（Phase 3 完成）
- **10个内置模板**：包含5个思维模型（二阶思维、5WHY、MECE、第一性原理、预先验尸）和5个工作/日志模板（会议记录、每周复盘、今日记录、决策记录、阅读笔记）
- **useTemplateRegistry**：模板注册表 composable，支持合并内置+用户模板、ID查询、文本搜索
- **useUserTemplatesStore**：用户模板 Pinia Store，支持 CRUD 操作
- **TemplateRenderer**：模板渲染器，支持变量展开（date/time/iso_date/page_title/clipboard/cursor）
- **斜杠命令集成**：模板命令已集成到 SlashCommandMenu，支持 `/template` 或直接输入模板名搜索
- **cursor 定位**：支持 `{{cursor}}` 变量，模板插入后自动定位光标
- **测试覆盖**：新增多项单元测试覆盖模板系统各组件

#### 块关系清理时序修复
- **useBlockRelationshipCleanup**：修复块关系清理的时序逻辑问题，确保删除操作安全执行
- **测试增强**：新增多项测试用例验证关系清理功能

#### UI/交互优化
- **SlashCommandMenu 子视图**：支持模板命令的子视图展示
- **键盘导航优化**：修复模板选择的键盘导航逻辑
- **样式微调**：拖拽占位符排除类、块选中遮罩圆角调整

### 相关文档
- `docs/3-features/template-system-spec.md` - 新增模板系统完整规格（v1.0）
- `docs/3-features/slash-commands-spec.md` - 更新至 v1.0（模板系统集成）
- `docs/5-development/dev-guide.md` - 更新至 v5.0（模板系统开发指南）
- `docs/superpowers/plans/2026-06-05-template-system-plan-*.md` - 模板系统多个备选方案
- `docs/superpowers/specs/2026-06-06-concept-block-design.md` - 概念块设计规范

---

## v0.7 更新摘要（2026-06-05）

### 按需加载
- 开发新功能 → 阅读 `spec.md` + `architecture.md` + `development.md`
- 修改交互 → 阅读 `interaction.md`
- 修改数据模型 → 阅读 `architecture.md`
- 开发存储层 → 阅读 `architecture.md` §2 + `development.md` §7
- 了解产品方向 → 阅读 `product-vision.md`

### 添加新文档
新功能规格文档应追加到对应的 `active/` 文件中（如新功能属于已有功能域），或创建新文件（如全新功能域）。

---

## v0.7 更新摘要（2026-06-05）

### 主要功能

#### 模板系统（新增）
- **TemplateRenderer**：支持变量展开和 DFS 块生成的模板渲染器
- **模板序列化器**：`serialize-block-tree.ts` 实现块树到模板块的转换
- **Dexie v9 升级**：数据库升级至 v9 版本，新增 `templates` 表
- **类型定义**：完整的模板系统类型定义

#### 关系类型自定义（Phase 3 进行中）
- **RelationshipTypesPanel**：新增设置面板组件，支持关系类型管理
- **useRelationshipTypes**：运行时 composable，提供 CRUD 和加载迁移功能
- **数据库存储层**：新增 `relationshipTypes` 表，支持关系类型持久化
- **初始化数据**：预置关系类型种子数据
- **Settings 集成**：关系类型管理面板已集成到设置模态框

#### 块删除关系清理
- **useBlockRelationshipCleanup**：跨页面类型链接降级 composable
- **单块删除集成**：块删除时自动清理关联的关系类型
- **多选删除集成**：批量删除时通过关系清理 composable 处理

#### UI/交互优化
- **Backspace 关闭菜单**：在 `^` 后按 Backspace 同时关闭关系菜单和 Wiki 链接菜单
- **关系类型标签点击**：点击 `^(type)` 标签打开关系类型切换菜单
- **样式优化**：带类型链接的视觉样式微调

### 相关文档
- `docs/2-architecture/storage-spec.md` - 更新至 v0.8（Dexie v9 + templates 表 + relationshipTypes 表）
- `docs/3-features/link-spec.md` - 更新至 v0.4（关系类型自定义）
- `docs/superpowers/plans/2026-06-05-relationship-types-test-report.md` - 关系类型测试报告
- `docs/superpowers/specs/2026-06-05-template-system-design.md` - 模板系统设计规范

---

## v0.6 更新摘要（2026-06-04）

### 主要功能
- **关系类型菜单系统**：新增 `RelationshipMenu` 组件，支持模糊搜索预定义关系类型
- **关系类型状态管理**：新增 `useRelationshipMenu` composable，管理菜单状态
- **带类型链接渲染**：优化 `useContentRenderer`，支持 `[[Page]]^(type)` 格式的渲染
- **关系类型同步系统**：新增 `useRelationshipSync` composable，页面内多 Block 关系类型自动同步
- **反向链接机制修复**：修复概念图谱边丢失和反向链接创建逻辑，增加多项测试
- **#Tag 渲染优化**：在分段文本上处理 #tag，避免误匹配 CSS 颜色值
- **概念图谱 PNG 导出**：新增导出功能，支持导出当前视图为 PNG 图片

### 相关文档
- `docs/3-features/concept-graph-spec.md` - 概念图谱功能规格（更新至 v0.6）
- `docs/3-features/link-spec.md` - 链接解析规范（更新至 v0.3）
- `docs/4-ui/ui-ux-spec.md` - 交互规格（更新至 v1.0）
- 新增 5 个自动反向链接相关测试用例

---

## v0.5 更新摘要（2026-06-03）

### 主要功能
- **概念图谱右侧边栏**：全新面板系统，支持 G6 力导向图可视化
- **右侧边栏宽度可调**：支持拖拽调节宽度，图形自适应适配
- **关系展示优化**：修复反向关系类型处理和样式显示
- **滚动条样式简化**：全局隐藏滚动条，简化样式代码

### 相关文档
- `docs/3-features/concept-graph-spec.md` - 概念图谱功能规格
- `docs/4-ui/ui-ux-spec.md` - 交互规格更新
- `docs/active/development.md` - 开发指南更新
- `docs/superpowers/specs/2026-06-02-concept-graph-right-sidebar-design.md` - 右侧边栏设计规范

---

## v0.4 更新摘要（2026-05-29）

### 主要功能
- **暗色主题**：支持浅色/暗色/跟随系统三种模式
- **设置模态框**：从路由页面迁移到模态窗口
- **嵌入块重构**：样式和交互优化
- **侧边栏 v0.9**：Indigo 色彩系统 + Lucide 图标

### 相关文档
- `docs/3-features/block-editor-spec.md` - Embed Block 章节
- `docs/4-ui/ui-ux-spec.md` - 暗色主题 + 设置模态框章节
- `docs/5-development/dev-guide.md` - useTheme + useSettingsModal
- `docs/6-reports/v0-4-feature-verification-report.md` - 验证报告

---

*本文档于 2026-05-21 创建，作为文档体系重整的一部分。最新更新于 2026-06-27（Phase 2 Sprint 3）。*
