# comind 文档体系重整设计

> 日期：2026-05-21
> 状态：待审批
> 目的：系统性清理 docs/ 目录，减少 Agent 上下文污染，建立可持续维护的文档管理体系

---

## 1. 问题陈述

### 1.1 现状

项目存在 55+ 个 Markdown 文档，分布在以下位置：

| 位置 | 文档数量 | 说明 |
|------|---------|------|
| `docs/` | ~40 | 根级文档目录，8个子目录（1-overview ~ 7-sidebar, sort, superpowers） |
| `comind/docs/` | ~15 | 子项目文档目录，与根级 docs/ 重复且分散 |
| `comind/docs/superpowers/` | ~6 | superpowers 规格与计划，与 `docs/superpowers/` 重复 |
| `memory/` | 1 | 零散记忆文档 |

### 1.2 核心问题

**问题 1：双 docs/ 目录**
- 根级 `docs/` 与 `comind/docs/` 同时存在，Agent 无法判断哪个是权威来源
- 同一主题文档分散在两个位置（如 property system 在 `docs/superpowers/` 和 `comind/docs/superpowers/` 各有一套）

**问题 2：已完成功能文档未归档**
- `docs/superpowers/specs/` 和 `plans/` 中全部是已实现功能的 spec/plan，持续占用上下文
- `docs/sort/` 中 sortable-implementation、phase-1-1-plan、phase-1-1-dev 均为已完成内容
- `docs/7-sidebar/` 中 sidebar-implementation、sidebar-redesign 均为已完成内容
- `comind/docs/` 中 drag-fix、drag-style-fix、cross-container-drag-fix、nested-collapse-fix 均为已完成的 bug 修复记录

**问题 3：内容严重交叉重复**
- **数据模型**：`SPEC.md` §3（核心概念）、`data-model.md`（530行）、`storage-spec.md` §0（Record 类型）三者描述同一数据模型
- **架构约束**：`SPEC.md` §7（单编辑器原则）、`block-editor-spec.md`（C1-C4约束）、`dev-guide.md` §核心约束 三者重复描述同一架构规则
- **拖拽相关**：5+ 文件（drag-issue-analysis.md、drag-style-fix.md、cross-container-drag-fix.md、drag-drop-indicator-design.md、drag-drop-indicator-implementation.md）记录同一主题的演进过程
- **属性系统**：4+ 文件（property-spec.md、property-system.md、property-display-configurable-design.md、property-system-phase3.md）
- **开发指南**：`dev-guide.md` 已整合 `block-editor-spec.md` 的约束，但后者仍独立存在
- **tag-spec.md** 已标记"已废弃"，但仍在目录中

**问题 4：过时信息**
- `dev-guide.md` 中的 Block 接口定义（使用 `left` 字段）与 `data-model.md`（使用 `pos` 字段）不一致
- `dev-guide.md` 中的 Dexie schema（version 1）与 `storage-spec.md`（version 4）不一致
- `TODO.md` 中大部分条目已完成或已废弃，但未标记
- `routing-design.md` 是设计稿状态，但路由系统已实现

**问题 5：目录分类过细**
- 8个数字编号子目录 + sort + superpowers = 10个子目录
- 每个子目录包含 2-6 个文件，Agent 需遍历大量 README.md 才能定位目标

---

## 2. 目标文档结构

### 2.1 新结构

```
docs/
├── README.md                  # 唯一入口，完整索引 + 快速导航
├── active/                    # 活跃文档（Agent 日常参考）
│   ├── spec.md                # 项目总规范（合并 SPEC + TODO + 核心概念）
│   ├── architecture.md        # 架构设计（合并 data-model + storage + routing + block-editor-spec）
│   ├── features.md            # 功能规格（合并 link-spec + slash-commands + functional-design）
│   ├── interaction.md         # 交互规范（合并 interaction-spec + ui-ux-spec）
│   ├── development.md         # 开发指南（合并 dev-guide + page-block-crud + tech-selection）
│   └── product-vision.md      # 产品愿景（从 comind/docs/ 迁入）
├── archive/                   # 已实现/历史文档（按需查阅）
│   ├── drag-drop/             # 拖拽相关（5个文件）
│   ├── property-system/       # 属性系统相关（4个文件）
│   ├── sidebar/               # 侧边栏相关（2个文件）
│   ├── sort/                  # 排序功能相关（3个文件）
│   ├── superpowers/           # 能力增强相关（6个 specs + 4个 plans）
│   ├── routing/               # 路由设计（1个文件）
│   ├── reports/               # 验证报告（3个文件）
│   └── deprecated/            # 已废弃文档（tag-spec 等）
└── templates/                 # 文档模板
    └── spec-template.md       # 新规格文档模板
```

### 2.2 设计原则

| 原则 | 说明 |
|------|------|
| **单一入口** | Agent 只需读取 `docs/README.md` 即可了解完整文档体系 |
| **active/archive 分离** | `active/` 包含 Agent 日常需要的核心知识；`archive/` 保留历史但不在默认上下文中 |
| **按知识域组织** | active/ 下每个文件对应一个完整的知识域，避免碎片化 |
| **扁平化** | active/ 仅 6 个文件，无子目录；archive/ 按主题分子目录 |
| **保留完整性** | 不删除任何文档，已实现/历史文档全部移至 archive/ |

---

## 3. 文档合并映射

### 3.1 Active 文档合并计划

| 目标文件 | 来源文件 | 合并策略 |
|---------|---------|---------|
| `active/spec.md` | `1-overview/SPEC.md` | 主体内容保留 |
| | `1-overview/TODO.md` | 仅保留未完成条目 |
| | `1-overview/README.md` | 索引整合到根 README |
| `active/architecture.md` | `2-architecture/data-model.md` | 数据模型章节 |
| | `2-architecture/storage-spec.md` | 存储格式章节 |
| | `2-architecture/routing-design.md` | 路由设计章节 |
| | `3-features/block-editor-spec.md` | 架构约束章节（C1-C4） |
| | `3-features/property-spec.md` | 属性系统章节 |
| | `3-features/block-ordering-redesign.md` | 排序设计章节 |
| `active/features.md` | `3-features/link-spec.md` | 链接系统章节 |
| | `3-features/slash-commands-spec.md` | 斜杠命令章节 |
| | `3-features/slash-commands-logseq-reference.md` | 参考附录 |
| | `3-features/functional-design-spec.md` | 功能设计章节 |
| | `3-features/tag-spec.md` | 标记为已废弃，保留历史 |
| `active/interaction.md` | `4-ui/interaction-spec.md` | 交互规范主体 |
| | `4-ui/ui-ux-spec.md` | UI 视觉规范 |
| `active/development.md` | `5-development/dev-guide.md` | 开发指南主体（更新过时信息） |
| | `5-development/page-block-crud.md` | CRUD 操作章节 |
| | `1-overview/tech-selection.md` | 技术选型章节 |
| `active/product-vision.md` | `comind/docs/product-vision.md` | 迁入 |

### 3.2 Archive 归档计划

| Archive 子目录 | 来源 | 文件数 |
|---------------|------|-------|
| `archive/drag-drop/` | `comind/docs/drag-issue-analysis.md` | 5 |
| | `comind/docs/drag-style-fix.md` | |
| | `comind/docs/cross-container-drag-fix.md` | |
| | `docs/superpowers/specs/2026-05-10-drag-drop-indicator-design.md` | |
| | `docs/superpowers/plans/2026-05-10-drag-drop-indicator-implementation.md` | |
| `archive/property-system/` | `docs/superpowers/specs/2026-05-13-property-system.md` | 4 |
| | `comind/docs/superpowers/specs/2026-05-13-property-system.md` | |
| | `comind/docs/superpowers/specs/2026-05-16-property-display-configurable-design.md` | |
| | `comind/docs/superpowers/plans/2026-05-16-property-display-configurable.md` | |
| `archive/superpowers/` | `docs/superpowers/specs/` 剩余文件 | 10 |
| | `docs/superpowers/plans/` 全部文件 | |
| `archive/sort/` | `docs/sort/` 全部文件 | 3 |
| `archive/sidebar/` | `docs/7-sidebar/` 全部文件 | 2 |
| `archive/reports/` | `docs/6-reports/` 全部文件 | 3 |
| `archive/routing/` | `comind/docs/routing-test-plan.md` | 2 |
| | `comind/docs/routing-test-report.md` | |
| `archive/deprecated/` | `docs/3-features/tag-spec.md` | 2 |
| | `comind/docs/nested-collapse-fix.md` | |
| | `docs/superpowers/plans/2026-05-12-p0-p1-optimization.md` | |
| | `docs/superpowers/plans/2026-05-12-p2-code-quality-optimization.md` | |
| | `docs/superpowers/specs/2026-05-12-p0-p1-optimization-plan.md` | |
| | `docs/superpowers/specs/2026-05-12-p2-code-quality-optimization.md` | |

### 3.3 待删除文件

| 文件 | 理由 |
|------|------|
| `docs/1-overview/README.md` | 索引整合到根 README.md |
| `docs/2-architecture/README.md` | 索引整合到根 README.md |
| `docs/3-features/README.md` | 索引整合到根 README.md |
| `docs/4-ui/README.md` | 索引整合到根 README.md |
| `docs/5-development/README.md` | 索引整合到根 README.md |
| `docs/6-reports/README.md` | 索引整合到根 README.md |
| `docs/7-sidebar/README.md` | 索引整合到根 README.md |
| `docs/sort/README.md` | 索引整合到根 README.md |
| `docs/superpowers/README.md` | 索引整合到根 README.md |
| `comind/docs/` 整个目录 | 所有内容已归档到 docs/archive/ |
| `docs/README.md`（旧） | 重写为新索引 |

---

## 4. 文档分类标准与命名规范

### 4.1 分类标准

| 类别 | 定义 | 存放位置 |
|------|------|---------|
| **核心规格** | 项目定位、目标、核心概念、验收标准 | `active/spec.md` |
| **架构设计** | 数据模型、存储、路由、编辑器约束 | `active/architecture.md` |
| **功能规格** | 链接、命令、属性、标签等具体功能定义 | `active/features.md` |
| **交互规范** | 鼠标/键盘操作、状态机、边界情况 | `active/interaction.md` |
| **开发指南** | 环境搭建、项目结构、CRUD、测试 | `active/development.md` |
| **产品愿景** | 战略方向、用户旅程 | `active/product-vision.md` |
| **历史文档** | 已实现功能的 spec/plan/fix/report | `archive/<topic>/` |
| **废弃文档** | 已废弃的设计（如独立 Tag 系统） | `archive/deprecated/` |

### 4.2 命名规范

| 文档类型 | 命名规则 | 示例 |
|---------|---------|------|
| Active 文档 | 简短描述性名称 | `spec.md`、`architecture.md` |
| Archive 文档 | `YYYY-MM-DD-<topic>-<type>.md` | `2026-05-10-drag-drop-indicator-design.md` |
| Archive 子目录 | 主题短名称 | `drag-drop/`、`property-system/` |

### 4.3 文档头规范

每个文档必须包含元数据头：

```markdown
# 文档标题

> 版本：vX.X
> 日期：YYYY-MM-DD
> 状态：活跃 | 已实现 | 已废弃 | 历史
```

---

## 5. 版本控制与更新流程

### 5.1 版本规则

| 变更类型 | 版本递增 | 说明 |
|---------|---------|------|
| 新增功能规格 | minor（0.1 → 0.2） | 在对应 active 文档追加章节 |
| 架构变更 | major（0.x → 1.0） | 重写相关章节 |
| 修正错误 | patch（0.1.0 → 0.1.1） | 修正描述错误 |

### 5.2 更新流程

```
功能开发完成
    │
    ▼
1. 更新 active/ 中对应文档章节
    │
    ▼
2. 将本次开发的 spec/plan 移至 archive/<topic>/
    │
    ▼
3. 在文档头部更新版本号和日期
    │
    ▼
4. 在文档末尾添加更新日志
    │
    ▼
5. 提交时包含文档变更说明
```

### 5.3 定期审查机制

| 频率 | 审查内容 | 负责人 |
|------|---------|--------|
| 每次功能发布后 | 将相关 spec/plan 移至 archive/ | 开发者 |
| 每月 | 检查 active/ 文档是否与代码一致 | 开发者/AI Agent |
| 每季度 | 清理 archive/ 中不再需要的历史文档 | 开发者 |

---

## 6. 实施步骤

### Phase 1: 创建新结构（不影响现有文档）

1. 创建 `docs/active/`、`docs/archive/`、`docs/templates/` 目录
2. 编写 `docs/templates/spec-template.md` 模板
3. 创建新的 `docs/README.md`（新索引）

### Phase 2: 合并 Active 文档

4. 合并 `active/spec.md`（SPEC + TODO 未完成项）
5. 合并 `active/architecture.md`（data-model + storage + routing + block-editor + property + ordering）
6. 合并 `active/features.md`（link + slash-commands + functional-design）
7. 合并 `active/interaction.md`（interaction-spec + ui-ux-spec）
8. 合并 `active/development.md`（dev-guide + page-block-crud + tech-selection，**修正过时信息**）
9. 迁移 `active/product-vision.md`

### Phase 3: 归档历史文档

10. 移动所有已完成 spec/plan 到 `archive/` 对应子目录
11. 移动 `comind/docs/` 中所有文档到 `archive/`
12. 标记 `comind/docs/` 为废弃（添加 README 说明已迁移）

### Phase 4: 清理

13. 删除所有子目录的 README.md 索引文件
14. 删除 `comind/docs/` 目录
15. 验证所有链接可用

---

## 7. 预期效果

| 指标 | 清理前 | 清理后 |
|------|-------|-------|
| 文档总数 | 55+ | 6（active）+ ~30（archive） |
| Agent 默认上下文 | 55+ 文件 | 6 文件（active/） |
| 子目录数量 | 10 | 2（active/ + archive/） |
| 重复内容 | 严重（4组重复） | 无 |
| 过时信息 | 多处 | 修正 |
| 检索效率 | 需遍历 10 个子目录 | active/ 6 个文件即可 |

---

*设计文档 v1.0，待用户审批。*
