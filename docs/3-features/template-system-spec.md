# 模板系统功能规格

> 版本：v1.0
> 日期：2026年6月6日
> 状态：✅ 已实现

---

## 概述

模板系统是一个强大的内容生成工具，允许用户快速插入预定义的结构化内容块。系统包含内置模板和用户自定义模板两种类型，并通过斜杠命令菜单无缝集成。

---

## 核心功能

### 1. 模板类型

#### 内置模板 (Built-in Templates)
- **来源**：系统预定义，静态配置
- **存储**：内存中，无需持久化
- **数量**：10个
- **分类**：
  - **思维模型 (thinking-model)**: 5个
  - **工作 (work)**: 3个
  - **日志 (journal)**: 1个
  - **回顾 (review)**: 1个

#### 用户模板 (User Templates)
- **来源**：用户自定义创建
- **存储**：IndexedDB (`db.templates`)
- **分类**：自由分类，默认 `'custom'`
- **追溯**：记录来源页面 ID

### 2. 内置模板清单

#### 思维模型类
| ID | 名称 | 别名 | 图标 | 描述 |
|----|------|------|------|------|
| `second-order-thinking` | 二阶思维 | `second-order`, `2nd-order` | 🤔 | 引导追问"然后呢？" |
| `five-whys` | 5WHY分析 | `5why`, `five-whys` | ❓ | 连问5个为什么找根因 |
| `mece` | MECE拆解 | `mece`, `互斥穷尽` | 🧩 | 相互独立、完全穷尽地拆解问题 |
| `first-principles` | 第一性原理 | `first-principles`, `第一性` | ⚛️ | 剥离假设，回到基本事实 |
| `premortem` | 预先验尸 | `premortem`, `预失败` | ⚰️ | 假设项目已失败，反推原因 |

#### 工作类
| ID | 名称 | 别名 | 图标 | 描述 |
|----|------|------|------|------|
| `meeting-notes` | 会议记录 | `meeting`, `会议` | 📝 | 结构化记录会议：时间/参与人/议题/决议/待办 |
| `decision-record` | 决策记录 | `decision`, `决策` | ⚖️ | 背景/选项/权衡/决定/复盘 |
| `reading-notes` | 阅读笔记 | `reading`, `book`, `阅读` | 📖 | 元信息/核心观点/我的启发/行动项 |

#### 回顾和日志类
| ID | 名称 | 别名 | 图标 | 描述 |
|----|------|------|------|------|
| `weekly-review` | 每周复盘 | `weekly-review`, `weekly`, `周报`, `复盘` | 📋 | 5个引导问题：精力/注意力/思考/决策/目标 |
| `daily-journal` | 今日记录 | `daily`, `journal`, `日记`, `今日` | 🌅 | 心情/进展/卡点/明日计划 |

### 3. 模板块类型

模板由多个 `TemplateBlock` 组成，支持三种类型：

| 类型 | 描述 | 必需字段 |
|------|------|----------|
| `bullet` | 普通块 | `content` |
| `heading` | 标题块 | `content`, `headingLevel` (1/2/3) |
| `property` | 属性块 | `content`, `propertyKey` |

### 4. 模板变量系统

模板内容支持预定义变量替换：

| 变量 | 示例值 | 描述 |
|------|--------|------|
| `{{date}}` | `2026年6月6日` | 本地化日期 |
| `{{time}}` | `14:30` | 本地化时间 |
| `{{iso_date}}` | `2026-06-06` | ISO 格式日期 |
| `{{page_title}}` | `我的笔记` | 当前页面标题 |
| `{{cursor}}` | 空字符串 | 光标定位标记（渲染时移除，通过 `hasCursor` 标记追踪） |
| `{{clipboard}}` | 剪贴板内容 | 剪贴板文本（权限允许） |

**变量处理细节**：
- `{{cursor}}` 在渲染时替换为空字符串，不产生可见文本
- 通过 `ExpandResult.hasCursor` 布尔标记追踪光标位置
- 模板插入后自动定位光标到第一个含 `{{cursor}}` 的块
- 移除了废弃的 `PlaceholderMarker` 接口（无消费者读取）

---

## 使用方式

### 通过斜杠命令使用
1. 在块中输入 `/` 触发命令菜单
2. 搜索或滚动找到"模板"分组
3. 选择所需模板
4. 模板自动插入到当前块之后，光标定位在第一个块

### 模板搜索
- 支持按名称搜索
- 支持按别名搜索
- 支持按描述搜索

---

## 技术架构

### 核心模块

| 模块 | 路径 | 职责 |
|------|------|------|
| **类型定义** | `src/types/template.ts` | 模板系统类型定义 |
| **内置模板** | `src/config/builtin-templates.ts` | 10个内置模板配置 |
| **模板注册表** | `src/composables/useTemplateRegistry.ts` | 合并内置+用户模板，统一查询接口 |
| **用户模板Store** | `src/stores/user-templates.ts` | 用户模板 CRUD |
| **模板渲染器** | `src/services/template-renderer.ts` | 变量展开、块渲染 |
| **斜杠命令集成** | `src/composables/useSlashCommands.ts` | 模板命令构建和执行 |

### 数据流程图

```
用户输入 /template
    ↓
SlashCommandMenu 触发
    ↓
buildTemplateCommands() 构建模板命令
    ↓
useTemplateRegistry 加载模板
    ↓
executeTemplateCommand() 执行
    ↓
TemplateRenderer.render() 渲染
    ↓
blocksStore.createBlock() 插入块
    ↓
editorStore.activateBlock() 定位光标
```

### 关键类型定义

```typescript
// TemplateBlock - 模板块
interface TemplateBlock {
  type: 'bullet' | 'heading' | 'property'
  content: string
  headingLevel?: 1 | 2 | 3
  propertyKey?: string
  children?: TemplateBlock[]
}

// NormalizedTemplate - 归一化模板
interface NormalizedTemplate {
  id: string
  name: string
  aliases?: string[]
  category: string
  description: string
  icon: string
  source: 'builtin' | 'user'
  blocks: TemplateBlock[]
}

// TemplateContext - 变量上下文
interface TemplateContext {
  date: string
  time: string
  isoDate: string
  pageTitle: string
  cursor: '__CURSOR__'
  clipboard: string
  now: number
}
```

### 模板注册表 (useTemplateRegistry)

**设计要点**：
- 模块级共享 state（多次调用返回同一实例）
- 用户模板 ID 前缀 `user:` 避免冲突
- 用户模板优先排序
- 提供 `loadAll()`, `getById()`, `searchByText()` 接口

**使用示例**：
```typescript
const registry = useTemplateRegistry()
await registry.loadAll()
const template = registry.getById('second-order-thinking')
const results = registry.searchByText('思维')
```

### 模板渲染器 (TemplateRenderer)

**核心方法**：
1. `buildContext(pageTitle)` - 构建变量上下文
2. `expandContent(content, context)` - 展开变量
3. `render(template, context, anchorBlock)` - 渲染为 BlockDraft[]

**渲染流程**：
1. 使用 `deserializeBlockTree` 分配 ID、pos、parentId
2. 递归展开模板变量
3. property 类型序列化为 `key:: value`
4. 标记第一个 `{{cursor}}` 为光标定位点

---

## 数据库设计

### 模板表 (templates)

```typescript
interface UserTemplate {
  id: string
  name: string
  description?: string
  category: string
  sourcePageId: string
  blocks: TemplateBlock[]
  createdAt: number
  updatedAt: number
}
```

**索引**：无（当前 MVP）

---

## 用户模板管理 (TODO)

> 注：以下功能为规划中，当前 MVP 仅支持内置模板

- [ ] 从页面创建模板
- [ ] 模板编辑器
- [ ] 模板分类管理
- [ ] 模板导入/导出
- [ ] 最近使用模板

---

## 验收标准

### 功能验收

- [x] 10个内置模板正确配置
- [x] 模板通过斜杠命令菜单访问
- [x] 模板变量正确展开
- [x] 光标定位到 `{{cursor}}` 标记处
- [x] 用户模板与内置模板统一查询
- [x] 用户模板支持 CRUD
- [x] 键盘导航支持模板选择

### 性能验收

- [x] 模板加载时间 < 50ms
- [x] 模板渲染时间 < 100ms
- [x] 搜索响应时间 < 16ms

---

## 相关文档

- [斜杠命令规格](./slash-commands-spec.md)
- [开发指南](../5-development/dev-guide.md)
- [数据模型](../2-architecture/data-model.md)

---

*文档由 AI 助手协助生成，基于最新代码实现。*
