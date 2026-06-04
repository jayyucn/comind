# comind 文档索引

> 更新日期：2026-06-04
> 本文档是 docs/ 目录的唯一入口点。Agent 只需加载 `active/` 目录即可获得完整项目上下文。

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
| 斜杠命令 | `features.md` | §2 斜杠命令 |
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
| development.md | v4.2 | 2026-06-03 | 新增 useRightSidebar + 概念图谱面板系统 |
| product-vision.md | v1.4 | 2026-05-20 | 从 comind/docs/ 迁入 |
| block-editor-spec.md | v0.4 | 2026-05-29 | Embed Block 章节 |
| ui-ux-spec.md | **v1.0** | **2026-06-04** | **新增关系类型菜单 + 带类型链接渲染** |
| link-spec.md | **v0.3** | **2026-06-04** | **新增关系类型链接 + 同步系统** |
| concept-graph-spec.md | **v0.6** | **2026-06-04** | **已实现 Phase 1 + Phase 2 功能** |

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

*本文档于 2026-05-21 创建，作为文档体系重整的一部分。最新更新于 2026-06-04（v0.6）。*
