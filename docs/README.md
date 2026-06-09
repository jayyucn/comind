# comind 文档索引

&gt; 更新日期：2026-06-07
&gt; 本文档是 docs/ 目录的唯一入口点。Agent 只需加载 `active/` 目录即可获得完整项目上下文。

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
| CRUD 操作 | `development.md` | §5 Page ↔ Block CRUD |
| 内容解析 | `development.md` | §6 内容解析 |
| 产品愿景 | `product-vision.md` | §1-§9 完整产品规划 |
| 功能 TODO | `spec.md` | §7 TODO |

---

## 文档版本记录

| 文档 | 版本 | 更新日期 | 来源 |
|------|------|---------|------|
| spec.md | v1.0 | 2026-05-21 | 合并自 SPEC.md + TODO.md |
| architecture.md | v4.0 | 2026-05-21 | 合并自 data-model + storage-spec + routing + block-editor-spec + property-spec + block-ordering-redesign |
| features.md | v1.0 | 2026-05-21 | 合并自 link-spec + slash-commands-spec + functional-design |
| interaction.md | v1.0 | 2026-05-21 | 合并自 interaction-spec + ui-ux-spec |
| development.md | **v5.0** | **2026-06-06** | **新增模板系统完整开发指南** |
| product-vision.md | v1.4 | 2026-05-20 | 从 comind/docs/ 迁入 |
| block-editor-spec.md | **v0.5** | **2026-06-07** | **新增 Concept Block 章节** |
| ui-ux-spec.md | v1.1 | 2026-06-05 | 新增关系类型标签点击切换 |
| link-spec.md | v0.4 | 2026-06-05 | 新增关系类型自定义 + 清理系统 |
| concept-graph-spec.md | v0.6 | 2026-06-04 | 已实现 Phase 1 + Phase 2 功能 |
| storage-spec.md | v0.8 | 2026-06-05 | Dexie v9 + templates 表 + relationshipTypes 表 |
| slash-commands-spec.md | **v1.0** | **2026-06-06** | **新增模板系统集成** |
| template-system-spec.md | **v1.0** | **2026-06-06** | **新增模板系统完整规格** |
| concept-block-spec.md | **v1.0** | **2026-06-07** | **✨ 新概念块完整规格** |

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

*本文档于 2026-05-21 创建，作为文档体系重整的一部分。最新更新于 2026-06-07（v0.9）。*
