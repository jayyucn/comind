# Comind Code Wiki

## 项目概述

### 项目定义
**comind** 是一个以 **Block（块）** 为核心的本地优先（local-first）大纲编辑系统，用于结构化思考，而非传统笔记工具。

### 核心理念
- 所有数据围绕 Block 构建，无文档级模型
- 强调层级结构（嵌套、折叠、拖拽排序）
- Page 等同于顶级 Block
- 双向链接是一等公民
- 本地优先，数据可读、可迁移

---

## 架构设计

### 技术架构图

```
┌─────────────────────────────────────────────────────────────┐
│                   Vue 3 + TypeScript                         │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐ │
│  │   Pinia      │   │   TipTap     │   │   Vue Router     │ │
│  │  (状态管理)  │   │  (编辑器)    │   │   (路由)         │ │
│  └──────────────┘   └──────────────┘   └──────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│                  Storage Interface                          │
│  ┌───────────────────────────────────────────────────────┐ │
│  │       IndexedDBAdapter (Phase 1 via Dexie.js)         │ │
│  │         → SQLiteAdapter (Phase 2/3)                   │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 核心架构原则

1. **单编辑器原则**
   - 任何时刻只有一个活跃的 TipTap 编辑器实例
   - 只有一个 Block 处于编辑状态
   - 编辑器随 Block 切换而销毁或复用

2. **状态分层**
   - Pinia: 运行态状态
   - IndexedDB: 持久化存储
   - TipTap: 单编辑器实例（文本编辑）

3. **数据流向**
   ```
   用户输入 → TipTap → Pinia（运行态）→ debounce → IndexedDB（持久化）
   IndexedDB → Pinia → Vue 响应式渲染 → Block 组件展示
   ```

---

## 项目结构

```
comind/
├── public/                    # 静态资源
├── src/
│   ├── assets/               # 资源文件
│   ├── components/           # Vue 组件
│   │   ├── Block/            # Block 组件
│   │   ├── Journal/          # 日记相关组件
│   │   ├── Page/             # Page 组件
│   │   ├── Sidebar/          # 侧边栏组件
│   │   ├── Backlinks.vue     # 反向链接组件
│   │   ├── BlockList.vue     # Block 列表组件
│   │   ├── Editor.vue        # TipTap 编辑器封装
│   │   └── MergeDialog.vue   # 合并对话框
│   ├── composables/          # 组合式函数
│   │   ├── useBlockTree.ts
│   │   ├── useContentRenderer.ts
│   │   ├── useFavorites.ts
│   │   ├── useJournal.ts
│   │   ├── useNavigateToPage.ts
│   │   ├── useRecent.ts
│   │   ├── useSidebar.ts
│   │   ├── useSlashCommands.ts
│   │   └── useTagFilter.ts
│   ├── extensions/           # TipTap 编辑器扩展
│   │   ├── BracketPairExtension.ts
│   │   ├── EnterAsBlockExtension.ts
│   │   ├── SlashCommandExtension.ts
│   │   └── WikiLinkExtension.ts
│   ├── router/               # 路由配置
│   │   ├── index.ts
│   │   └── routes.ts
│   ├── storage/              # 存储层
│   │   ├── db.ts             # Dexie 数据库定义
│   │   └── indexedDB.ts      # IndexedDB 适配器
│   ├── stores/               # Pinia 状态管理
│   │   ├── blocks.ts         # Block 状态
│   │   ├── editor.ts         # 编辑器状态
│   │   └── pages.ts          # Page 状态
│   ├── types/                # TypeScript 类型定义
│   │   ├── block.ts
│   │   ├── command.ts
│   │   ├── link.ts
│   │   └── page.ts
│   ├── utils/                # 工具函数
│   │   ├── block-helpers.ts  # Block 辅助函数
│   │   ├── debounce.ts       # 防抖工具
│   │   ├── id.ts             # ID 生成
│   │   ├── journal-detect.ts # 日记检测
│   │   ├── leftCalculator.ts # Gap 排序计算
│   │   └── parser.ts         # 内容解析器
│   ├── App.vue               # 根组件
│   ├── main.ts               # 应用入口
│   └── style.css             # 全局样式
├── docs/                     # 项目文档（根目录）
├── comind/docs/              # 应用内文档
├── package.json
├── vite.config.ts
├── tsconfig.json
└── vitest.config.ts
```

---

## 核心模块说明

### 1. 数据模型

#### Block（块）
Block 是系统的唯一数据单元。

**类型定义** ([`src/types/block.ts`](file:///d:/comind/comind/src/types/block.ts)):
```typescript
export interface Block {
  id: string
  pageId: string
  parentId: string | null
  pos: number  // Gap 排序位置
  content: string
  format: Record<string, any>
  type: 'bullet' | 'property' | 'query' | 'embed'
  properties: Record<string, any>
  createdAt: number
  updatedAt: number
}
```

**关键字段说明**：
- `pos`: Gap 排序，初始间隔 1000
- `format.collapsed`: 折叠状态
- `type`: 块类型，支持 bullet（默认）、property、query、embed

#### Page（页面）
Page 是顶级 Block 的容器。

**类型定义** ([`src/types/page.ts`](file:///d:/comind/comind/src/types/page.ts)):
```typescript
export interface Page {
  id: string
  blockId: string  // 关联根 Block
  title: string
  type: 'normal' | 'journal'
  icon: string | null
  cover: string | null
  aliases: string[]
  filePath: string | null
  childrenCount: number
  wordCount: number
  createdAt: number
  updatedAt: number
}
```

#### Link（链接）
双向链接系统。

**类型定义** ([`src/types/link.ts`](file:///d:/comind/comind/src/types/link.ts)):
```typescript
export interface LinkRecord {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  createdAt: number
}
```

### 2. 状态管理 (Pinia)

#### useBlockStore ([`src/stores/blocks.ts`](file:///d:/comind/comind/src/stores/blocks.ts))
核心 Block 状态管理。

**主要状态**：
- `blocks`: 所有 Block 数组
- `sortedBlocks`: 按 pos 排序的 Block 列表
- `blockTree`: 按 parentId 分组的树状结构
- `structureVersion`: 结构版本号，用于触发拖拽组件重建

**核心方法**：
| 方法 | 说明 |
|------|------|
| `createBlock()` | 创建新 Block |
| `insertBlockAtCursor()` | 在光标位置插入 Block |
| `mergeWithPrevious()` | 与上一个 Block 合并 |
| `indent()` / `outdent()` | 缩进/反缩进 |
| `moveBlock()` | 移动 Block |
| `deleteBlock()` | 级联删除 Block |
| `updateBlockContent()` | 更新 Block 内容 |
| `updateBlockFormat()` | 更新 Block 格式 |

**关键实现 - Gap 排序**：
```typescript
async function safeCalcInsertPos(
  prevPos: number | null,
  nextPos: number | null,
  blocksRef: Block[],
  storageRef: typeof storage,
  recalcPos?: () => { prevPos: number | null; nextPos: number | null }
): Promise<number>
```
- 自动处理 Gap 耗尽，触发 `renumberBlocks()` 重新编号
- 通过回调函数确保重编号后位置计算正确

#### usePageStore ([`src/stores/pages.ts`](file:///d:/comind/comind/src/stores/pages.ts))
Page 状态管理。

### 3. 存储层

#### IndexedDBAdapter ([`src/storage/indexedDB.ts`](file:///d:/comind/comind/src/storage/indexedDB.ts))
Phase 1 使用的 IndexedDB 存储适配器。

**主要方法**：
| 方法 | 说明 |
|------|------|
| `saveBlock()` | 保存 Block 并解析链接 |
| `getBlockTree()` | 获取页面的完整 Block 树 |
| `createPageWithRootBlock()` | 创建 Page 并关联根 Block |
| `deletePage()` | 级联删除 Page |
| `mergePage()` | 合并两个页面 |
| `getBacklinks()` | 获取反向链接 |

**数据库定义** ([`src/storage/db.ts`](file:///d:/comind/comind/src/storage/db.ts)):
- `blocks` 表: Block 记录
- `pages` 表: Page 记录
- `links` 表: 双向链接记录

### 4. 编辑器

#### Editor 组件 ([`src/components/Editor.vue`](file:///d:/comind/comind/src/components/Editor.vue))
TipTap 编辑器封装，用于 Block 内容编辑。

**TipTap 扩展**：
1. **StarterKit** - 基础编辑器功能
2. **WikiLinkExtension** - Wiki 链接 `[[页面名]]` 解析
3. **EnterAsBlockExtension** - Enter 键创建新 Block
4. **BracketPairExtension** - 括号自动补全
5. **SlashCommandExtension** - 斜杠命令

### 5. 内容解析

#### parser.ts ([`src/utils/parser.ts`](file:///d:/comind/comind/src/utils/parser.ts))
解析 Block 内容中的链接和标签。

**解析规则**：
- Wiki 链接: `[[页面名]]` 或 `[[页面名|别名]]`
- 标签: `#标签名`

### 6. 路由

#### router/index.ts ([`src/router/index.ts`](file:///d:/comind/comind/src/router/index.ts))
Vue Router 配置，包含全局前置守卫确保 Page 数据已加载。

---

## 主要组件

### Block 组件 ([`src/components/Block/index.vue`](file:///d:/comind/comind/src/components/Block/index.vue))
单个 Block 的展示和编辑组件。

### Page 组件 ([`src/components/Page/index.vue`](file:///d:/comind/comind/src/components/Page/index.vue))
页面主组件，展示和编辑 Page 的所有 Block。

### Sidebar 组件 ([`src/components/Sidebar/index.vue`](file:///d:/comind/comind/src/components/Sidebar/index.vue))
侧边栏组件，包含：
- SidebarHeader: 侧边栏头部
- SidebarFavorites: 收藏页面
- SidebarRecent: 最近访问
- SidebarJournal: 日记列表

### Backlinks 组件 ([`src/components/Backlinks.vue`](file:///d:/comind/comind/src/components/Backlinks.vue))
展示当前页面的反向链接。

---

## 核心功能实现

### 1. Block 创建与编辑
- 输入文字自动创建 Block
- Enter 键在光标位置拆分
- Backspace 键与上一个 Block 合并
- Tab/Shift+Tab 缩进/反缩进

### 2. 折叠/展开
通过 `block.format.collapsed` 控制，状态持久化。

### 3. 拖拽排序
使用 `vue-draggable-plus` 实现，通过 Gap 排序算法避免大规模更新。

### 4. 双向链接
- 输入 `[[页面名]]` 创建链接
- 保存时解析并存储到 Link 表
- 反向链接自动显示在 Page 底部
- 点击链接跳转至目标页面

### 5. Gap 排序机制
- 初始间隔: 1000
- 插入时取左右邻居平均值
- Gap 耗尽时触发局部重编号
- 位置计算通过 `safeCalcInsertPos()` 确保正确性

---

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Vue | 3.x | 前端框架 |
| TypeScript | 6.x | 类型安全 |
| Pinia | 3.x | 状态管理 |
| Vue Router | 5.x | 路由 |
| TipTap | 3.x | 编辑器内核 |
| Dexie.js | 4.x | IndexedDB 封装 |
| Vite | 8.x | 构建工具 |
| Vitest | 4.x | 单元测试 |
| Playwright | 1.x | E2E 测试 |

---

## 开发指南

### 环境设置

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建
npm run build

# 运行测试
npm run test
```

### 编译检查
根据项目规则，所有代码修改必须经过严格的编译检查：
```bash
npm run build
```

### 主要开发流程

1. **新增功能**
   - 先在 `docs/` 下更新设计文档
   - 实现功能代码
   - 运行 `npm run build` 确保编译通过
   - 运行测试

2. **修改数据模型**
   - 更新 `types/` 下的类型定义
   - 更新 `storage/db.ts` 的数据库 schema
   - 考虑迁移策略

3. **编辑器扩展**
   - 在 `extensions/` 目录新增 TipTap 扩展
   - 在 `Editor.vue` 中注册

---

## Phase 规划

### Phase 1 (当前) - MVP
- ✅ Block 基础操作（创建、编辑、删除）
- ✅ 嵌套、折叠、拖拽
- ✅ Page 系统
- ✅ 双向链接
- ✅ 本地持久化（IndexedDB）

### Phase 1.1 (下一阶段)
- 属性解析 `key:: value`
- 标签点击筛选
- 命令面板
- Journal（日记流）
- 窄屏响应式

### Phase 2
- Core 层抽离
- Storage Interface 抽象
- 全文搜索
- 单元测试覆盖

### Phase 3
- Tauri 桌面应用
- SQLite 存储
- Markdown 文件读写
- 原生性能优化

---

## 关键文件索引

| 文件 | 说明 |
|------|------|
| [`src/stores/blocks.ts`](file:///d:/comind/comind/src/stores/blocks.ts) | Block 状态管理核心 |
| [`src/storage/indexedDB.ts`](file:///d:/comind/comind/src/storage/indexedDB.ts) | IndexedDB 适配器 |
| [`src/types/block.ts`](file:///d:/comind/comind/src/types/block.ts) | Block 类型定义 |
| [`src/components/Editor.vue`](file:///d:/comind/comind/src/components/Editor.vue) | TipTap 编辑器封装 |
| [`docs/SPEC.md`](file:///d:/comind/docs/SPEC.md) | 项目总规范 |
| [`docs/data-model.md`](file:///d:/comind/docs/data-model.md) | 数据模型设计 |
| [`docs/tech-selection.md`](file:///d:/comind/docs/tech-selection.md) | 技术选型规范 |

---

*Code Wiki 最后更新: 2026-05-11*
