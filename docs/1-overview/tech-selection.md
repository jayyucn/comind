# Phase 1 技术选型规范

> 版本：v0.4
> 日期：2026-04-16
> 状态：Phase 1 MVP 技术选型，已确认

---

## 1. Phase 1 目标

**核心目标：验证大纲编辑体验**

- 用 Web 技术快速原型
- 验证 Block 嵌套、折叠、拖拽是否顺手
- 验证双向链接跳转是否流畅
- 跑自动化测试
- 不考虑性能优化、不考虑原生能力

**约束：**
- 纯 Web（无 Electron/Tauri）
- 纯本地存储（IndexedDB）
- 不引入后端

---

## 2. 选型原则

- **快速验证优先** — 选开发效率最高的方案
- **生态成熟** — Vue 生态足够成熟，问题容易搜到答案
- **可替换性** — 核心模块抽象接口，Phase 2 可平滑替换存储层
- **学习成本可控** — Vue 上手快，tiptap 文档完善

---

## 3. 技术栈总览

| 维度 | 选择 | 依据 |
|------|------|------|
| 前端框架 | **Vue 3 + TypeScript** | 组合式 API，开发效率高 |
| 状态管理 | **Pinia** | Vue 官方推荐，TypeScript 友好 |
| 构建工具 | **Vite** | 秒级启动，HMR 顺滑，Vue 出品 |
| 编辑器内核 | **tiptap (ProseMirror)** | ProseMirror 的 Vue 封装，开箱即用 |
| 本地存储 | **IndexedDB** | 容量大，异步 API，适合 Block 数据 |

---

## 4. 选型详细说明

### 4.1 前端框架：Vue 3 + TypeScript

**选项对比：**

| 选项 | 成熟度 | 生态 | 学习成本 | 适合场景 |
|------|--------|------|----------|----------|
| Vue 3 + TypeScript | ⭐⭐⭐⭐ | 成熟 | 较低 | 中等复杂度，快速开发 |
| React + TypeScript | ⭐⭐⭐⭐⭐ | 极其成熟 | 中等 | 复杂交互应用 |
| Svelte | ⭐⭐⭐ | 新兴 | 低 | 轻量快速开发 |

**选择理由：**
- 组合式 API + `<script setup>` 语法，代码简洁
- 响应式系统天然适合 Block 状态管理
- 单文件组件（SFC）方便 Block 组件封装
- 开发效率高，适合 MVP 快速验证
- Vue 3 性能优秀，Virtual DOM 优化到位

---

### 4.2 状态管理：Pinia

**选项对比：**

| 选项 | 特点 | 适合场景 |
|------|------|----------|
| Pinia | Vue 官方推荐，TS 友好，DevTools 集成 | Vue 3 首选 |
| Vuex 4 | 传统方案，样板代码多 | 旧项目迁移 |
| Vue Reactivity API | 极简，无额外依赖 | 简单场景 |

**选择理由：**
- Vue 官方推荐，长期维护有保障
- TypeScript 类型推断完美
- DevTools 集成好，调试方便
- API 简洁，无 mutations/actions 区分
- 支持 Composition API 风格

---

### 4.3 构建工具：Vite

**选项对比：**

| 选项 | 特点 |
|------|------|
| Vite | 快，开发体验好，Vue 出品 |
| Webpack | 成熟，但配置繁琐 |
| Rollup | 偏底层，库打包用 |

**选择理由：**
- 开发服务器启动快（秒级）
- Hot Module Replacement 体验顺滑
- Vue 生态首选，官方脚手架默认
- 对 TypeScript + Vue 支持完美

---

### 4.4 编辑器内核：tiptap (ProseMirror)

**选项对比：**

| 选项 | 特点 | 适合场景 |
|------|------|----------|
| tiptap | ProseMirror 的 Vue 封装 | 开箱即用，首选 |
| ProseMirror | 学术界工业级，Logseq 在用 | 需要底层控制 |
| CodeMirror 6 | 代码编辑器强，Markdown 支持一般 | 偏代码场景 |
| Slate | React 生态，API 较土 | React 项目 |

**选择理由：**
- 基于 ProseMirror，Logseq 验证过大纲体验
- 官方提供 Vue 3 绑定（`@tiptap/vue-3`）
- 支持树状文档结构（和 Block 数据模型天然匹配）
- 插件生态丰富（Collaboration、History、Placeholder 等）
- 需要时可直接访问底层 ProseMirror API

**tiptap 核心扩展：**

| 扩展 | 用途 |
|------|------|
| Document | 根节点 |
| Paragraph | 段落（Block 基础） |
| Text | 文本内容 |
| History | 撤销/重做 |
| Dropcursor | 拖拽指示器 |
| Gapcursor | 空区域光标 |
| Placeholder | 空内容提示 |

**自定义节点（Phase 1 需实现）：**

| 节点 | 说明 |
|------|------|
| BlockNode | Block 容器，支持嵌套 |
| PageNode | Page 标记（Block 的特殊形态） |
| LinkMark | 行内链接 `[[...]]` |
| PropertyNode | 属性块 `key:: value` |

---

### 4.5 本地存储：IndexedDB

**选项对比：**

| 选项 | 特点 | 适合场景 |
|------|------|----------|
| IndexedDB | 容量大（无明确限制），异步 API | Block 数据存储首选 |
| LocalStorage | 最简，同步 API，容量 ~5MB | 极简配置/设置项 |
| SQLite (sql.js) | SQL 能力，重量级 | Phase 3 |

**选择理由：**
- 容量无明确限制，适合 Block 数据增长
- 异步 API，不阻塞主线程，编辑体验更流畅
- 支持索引，Link/Tag 查询效率高
- 浏览器原生支持，无需额外依赖
- Phase 2/3 迁移到 SQLite 时数据模型一致

**IndexedDB 封装库选择：**

| 库 | 特点 |
|------|------|
| **Dexie.js** | Promise API，TypeScript 友好，推荐 |
| idb | 极简封装，轻量 |
| 原生 IndexedDB API | 学习成本高，代码冗长 |

**选择 Dexie.js 的理由：**
- Promise API，代码简洁
- TypeScript 支持完善
- 支持复杂查询、事务
- 活跃维护，文档完善
- 与 Vue/Pinia 集成容易

**数据库结构设计：**

```typescript
// src/storage/db.ts
import Dexie, { Table } from 'dexie'

export interface BlockRecord {
  id: string          // Block UUID
  pageId: string      // 所属页面 ID（必须，非空）
  parentId: string | null // 父 Block（null = 直接子节点）
  leftId: string | null   // 左侧兄弟（Gap 排序）
  content: string         // 纯文本
  format: string          // JSON 字符串
  type: string            // 'bullet' | 'property' | 'query' | 'embed'
  properties: string      // JSON 字符串
  createdAt: number       // IndexedDB 内部存 number 时间戳，adapter 负责与 ISO string 互转
  updatedAt: number       // 同上
}

export interface PageRecord {
  id: string
  blockId: string | null  // 根 Block ID
  title: string
  type: 'normal' | 'journal'
  icon: string | null
  cover: string | null
  aliases: string         // JSON 数组字符串
  filePath: string | null
  childrenCount: number   // 缓存
  wordCount: number       // 缓存
  createdAt: number       // number 时间戳
  updatedAt: number       // number 时间戳
}

export interface LinkRecord {
  id: string
  sourceBlockId: string
  targetPageId: string
  displayText: string
  createdAt: number
}

export class ComindDB extends Dexie {
  blocks!: Table<BlockRecord, string>
  pages!: Table<PageRecord, string>
  links!: Table<LinkRecord, string>

  constructor() {
    super('comind')
    this.version(1).stores({
      blocks: 'id, pageId, parentId, leftId, createdAt, updatedAt',
      pages: 'id, blockId, title, type, createdAt, updatedAt',
      links: 'id, sourceBlockId, targetPageId'
    })
  }
}

export const db = new ComindDB()
```

**存储接口抽象（为 Phase 2 准备）：**

```typescript
// src/storage/interface.ts
export interface StorageAdapter {
  getBlock(id: string): Promise<Block | null>
  getAllBlocks(): Promise<Block[]>
  saveBlock(block: Block): Promise<void>
  deleteBlock(id: string): Promise<void>
  
  getPage(id: string): Promise<Page | null>
  getAllPages(): Promise<Page[]>
  
  // Phase 2 可扩展
  query?(sql: string, params?: any[]): Promise<any[]>
}
```

Phase 1 实现 `IndexedDBAdapter`（基于 Dexie），Phase 2 可替换为 `SQLiteAdapter`。

---

## 5. 技术架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    Vue 3 + TypeScript                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐  │
│  │    Pinia    │   │   tiptap    │   │   Vue Router    │  │
│  │  (状态管理)  │   │  (编辑器)   │   │    (路由)       │  │
│  └─────────────┘   └─────────────┘   └─────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                   Storage Interface                         │
│  ┌─────────────────────────────────────────────────────┐  │
│  │           IndexedDBAdapter (Phase 1)                 │  │
│  │              via Dexie.js                            │  │
│  │         → SQLiteAdapter (Phase 2/3)                  │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 6. 依赖清单

```json
{
  "dependencies": {
    "vue": "^3.4",
    "pinia": "^2.1",
    "vue-router": "^4.2",
    "@tiptap/vue-3": "^2.1",
    "@tiptap/starter-kit": "^2.1",
    "@tiptap/extension-placeholder": "^2.1",
    "@tiptap/extension-history": "^2.1",
    "dexie": "^4.0"
  },
  "devDependencies": {
    "vite": "^5.0",
    "typescript": "^5.3",
    "@vitejs/plugin-vue": "^5.0",
    "vue-tsc": "^2.0"
  }
}
```

---

## 7. 项目结构

```
src/
├── main.ts                 # 应用入口
├── App.vue                 # 根组件
├── router/                 # 路由配置
│   └── index.ts
├── stores/                 # Pinia stores
│   ├── blocks.ts           # Block 状态管理
│   ├── pages.ts            # Page 状态管理
│   └── settings.ts         # 用户设置
├── components/             # Vue 组件
│   ├── Block.vue           # Block 组件
│   ├── BlockList.vue       # Block 列表
│   ├── Editor.vue          # tiptap 编辑器封装
│   └── Sidebar.vue         # 侧边栏
├── composables/            # 组合式函数
│   ├── useBlock.ts         # Block 操作逻辑
│   └── useLink.ts          # 链接跳转逻辑
├── storage/                # 存储层
│   ├── interface.ts        # 存储接口定义
│   ├── db.ts               # Dexie 数据库定义
│   └── indexedDB.ts        # IndexedDB 适配器实现
├── types/                  # TypeScript 类型定义
│   ├── block.ts            # Block 类型
│   ├── page.ts             # Page 类型
│   └── link.ts             # Link 类型
└── utils/                  # 工具函数
    ├── parser.ts           # 内容解析（Link、Tag）
    └── id.ts               # ID 生成
```

---

## 8. Phase 1 验收标准

| 功能 | 验收标准 |
|------|---------|
| Block 创建 | 输入文字自动创建 Block，Enter 创建新 Block |
| Block 嵌套 | Tab 缩进，Shift+Tab 取消缩进，支持多级嵌套 |
| Block 折叠 | 有子 Block 时可折叠/展开，折叠状态持久化 |
| Block 拖拽 | 拖拽调整顺序和层级，视觉反馈清晰 |
| 双向链接 | `[[页面名]]` 创建链接，点击跳转，反向链接显示 |
| 标签 | `#标签` 解析并高亮，点击筛选 |
| 本地存储 | 刷新页面数据不丢失，IndexedDB 正常读写 |
| 性能 | 100+ Block 操作流畅，无明显卡顿 |

---

## 9. Phase 1 不做的事

| 事项 | 原因 |
|------|------|
| 文件系统读写 | Phase 1 纯 Web，IndexedDB 足够 |
| SQLite | Phase 2/3 引入 |
| Electron/Tauri | Phase 3 引入 |
| 多设备同步 | 远期规划 |
| 协作编辑 | 远期规划 |
| 富文本（加粗、斜体等） | Phase 1 聚焦大纲，可后续扩展 |
| 图片/附件 | Phase 2 考虑 |
| 全文搜索 | Phase 2 考虑 |

---

## 10. 待确认事项

| 事项 | 说明 |
|------|------|
| tiptap 自定义节点 | BlockNode/PageNode/LinkMark 的具体实现方案 |
| 折叠状态存储 | 存在 Block 属性中 vs 单独状态 |
| Link 解析时机 | 输入时实时解析 vs 保存时解析 |

---

## 11. Phase 2/3 技术选型预览

### Phase 2：Core 层抽离

| 维度 | 变化 |
|------|------|
| 存储层 | 抽象 `StorageAdapter` 接口 |
| 编辑器状态 | 抽离为独立模块 |
| 测试 | Core 层单元测试覆盖 |

### Phase 3：Tauri 套壳

| 维度 | 变化 |
|------|------|
| 运行时 | Web → Tauri（Rust） |
| 存储层 | IndexedDB → SQLite (rusqlite) |
| 文件系统 | 引入 Markdown 文件读写 |
| 性能 | 原生性能，大文件支持 |
