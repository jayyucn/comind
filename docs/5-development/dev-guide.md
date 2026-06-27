# 开发指南（Development Guide）

> 版本：v6.0
> 日期：2026-06-27
> 适用阶段：Phase 2 Sprint 3 已完成
> 技术栈：Vue 3 + TypeScript + Pinia + Vite + tiptap + IndexedDB + Lunr.js
> 状态：已整合 Core Layer、全文搜索、暗色主题、设置模态框、关系类型自定义、模板系统开发指南

***

> **📌 核心架构约束（来自 block-editor-spec.md，已整合入本文档）**
>
> 以下约束是 comind 的硬性架构规则，违反任一条均视为系统性错误：
>
> **约束 1：单编辑器原则（最重要）**
> - ❗任何时刻，系统只能存在 **1 个活跃的 tiptap 编辑器实例**
> - ❗任何时刻，只有 **1 个 Block 处于编辑状态**
> - ❗编辑器必须随 Block 切换而销毁或复用
>
> **约束 2：Block 是唯一数据单元**
> - 系统所有数据围绕 Block 构建：编辑、层级结构、存储、Page 组成
> - ❌禁止引入"文档级编辑模型"
>
> **约束 3：状态驱动，而非 DOM 驱动**
> - 所有行为通过状态机控制（`activeBlockId`、Block 树结构）
> - ❌禁止直接 DOM 操作控制业务逻辑
>
> **约束 4：Phase 1 不引入虚拟列表**
> - 100 个 Block ≈ 100 个 DOM 节点，浏览器性能完全可承受
> - 待数据量增长至 500+ 出现瓶颈时再按需引入（见 §6.2）
>
> **约束 5：Pinia 为状态中心，tiptap 为编辑内核，IndexedDB 为持久化层**
> - 三者职责严格分层，UI 状态不得反向污染数据结构

***

## 1. Core Layer 架构（Phase 2）

### 1.1 架构总览

comind 的核心业务逻辑已抽离到框架无关的 Core Layer，遵循以下分层架构：

```
┌─────────────────────────────────────────────────────┐
│                    UI Layer                         │
│  (Vue 3 Components, Pinia Stores, tiptap Editor)    │
├─────────────────────────────────────────────────────┤
│                    Core Layer                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Services │  │  Search  │  │  Storage Adapter │ │
│  └──────────┘  └──────────┘  └──────────────────┘ │
│  ┌──────────────────────────────────────────────┐  │
│  │               Types & Utils                  │  │
│  └──────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│              Infrastructure Layer                   │
│  (IndexedDB / SQLite / LocalStorage / FileSystem)   │
└─────────────────────────────────────────────────────┘
```

**Core Layer 核心原则：**
- **框架无关**：不依赖 Vue、Pinia、tiptap 等任何框架
- **纯 TypeScript**：仅使用 TypeScript 类型和原生 JavaScript API
- **依赖注入**：所有外部依赖通过构造函数参数注入
- **可测试**：纯逻辑代码，易于单元测试（当前覆盖率 95%+）
- **可复用**：可在 Web、桌面、移动等不同环境中复用

### 1.2 Core Layer 使用指南

**初始化 Core Layer：**

```typescript
import { initCore, getCore, isCoreInitialized } from '@/core'

// 应用启动时初始化（main.ts）
async function initializeApp() {
  // 初始化 Core Layer（使用 IndexedDB 存储）
  const core = await initCore('indexeddb')

  // Core 层包含以下服务
  console.log(core.blockService)      // Block 领域服务
  console.log(core.linkService)       // Link 领域服务
  console.log(core.tagService)        // Tag 领域服务
  console.log(core.propertyService)   // Property 领域服务
  console.log(core.pageService)       // Page 领域服务
  console.log(core.searchService)     // Search 搜索服务

  // 检查是否已初始化
  if (isCoreInitialized()) {
    console.log('Core Layer 已初始化')
  }
}
```

**在 Vue 组件中使用 Core Layer：**

```typescript
import { getCore } from '@/core'
import type { Block } from '@/core/types'

// 获取 Core 上下文
const core = getCore()

// 创建 Block
const newBlock: Block = await core.blockService.create({
  pageId: 'page-123',
  parentId: null,
  content: '新建 Block 内容',
  order: 100
})

// 搜索 Block
const searchResults = await core.searchService.search('关键词', {
  limit: 20,
  type: 'block'
})

// 更新 Block
await core.blockService.update(newBlock.id, {
  content: '更新后的内容'
})
```

**在 Pinia Store 中集成 Core Layer：**

```typescript
import { defineStore } from 'pinia'
import { getCore } from '@/core'

export const useBlocksStore = defineStore('blocks', () => {
  const blocks = ref<Block[]>([])

  // 使用 Core Layer 的 BlockService
  async function loadBlocks(pageId: string) {
    const core = getCore()
    blocks.value = await core.blockService.getByPageId(pageId)
  }

  async function createBlock(options: BlockCreateOptions) {
    const core = getCore()
    const block = await core.blockService.create(options)
    blocks.value.push(block)
    return block
  }

  return { blocks, loadBlocks, createBlock }
})
```

### 1.3 Core Layer 服务接口

**BlockService：**

```typescript
class BlockService {
  // CRUD 操作
  getById(id: string): Promise<Block | null>
  getByPageId(pageId: string): Promise<Block[]>
  getChildren(parentId: string): Promise<Block[]>
  create(options: BlockCreateOptions): Promise<Block>
  update(id: string, options: BlockUpdateOptions): Promise<Block>
  delete(id: string): Promise<void>

  // 树形结构操作
  buildTree(blocks: Block[]): TreeNode[]
  getBlockPath(id: string): Promise<BlockPath>

  // Block 移动
  move(id: string, newParentId: string | null): Promise<Block>
  indent(id: string): Promise<Block>
  outdent(id: string): Promise<Block>

  // Gap Sort 排序
  checkAndRebalance(parentId: string): Promise<void>
}
```

**LinkService：**

```typescript
class LinkService {
  getById(id: string): Promise<Link | null>
  getBySourceBlockId(blockId: string): Promise<Link[]>
  getBacklinks(pageId: string): Promise<Link[]>
  create(options: LinkCreateOptions): Promise<Link>
  syncBlockLinks(blockId: string, content: string): Promise<Link[]>
}
```

**PropertyService：**

```typescript
class PropertyService {
  getById(id: string): Promise<Property | null>
  getByBlockId(blockId: string): Promise<Property[]>
  create(options: PropertyCreateOptions): Promise<Property>
  update(id: string, options: PropertyUpdateOptions): Promise<Property>
  delete(id: string): Promise<void>
}
```

**PageService：**

```typescript
class PageService {
  getById(id: string): Promise<Page | null>
  getAll(): Promise<Page[]>
  create(options: PageCreateOptions): Promise<Page>
  update(id: string, options: PageUpdateOptions): Promise<Page>
  delete(id: string): Promise<void>
}
```

**SearchService：**

```typescript
class SearchService {
  async initialize(): Promise<void>
  async search(query: string, options?: SearchOptions): Promise<SearchResult[]>
  async indexBlock(block: Block): Promise<void>
  async indexPage(page: Page): Promise<void>
  async removeIndex(id: string): Promise<void>
}
```

### 1.4 存储适配器接口

Core Layer 通过 StorageAdapter 接口与底层存储通信：

```typescript
interface StorageAdapter {
  // Block 操作
  getBlockById(id: string): Promise<Block | null>
  getBlocksByPageId(pageId: string): Promise<Block[]>
  getBlockChildren(parentId: string): Promise<Block[]>
  createBlock(block: Block): Promise<Block>
  updateBlock(id: string, updates: Partial<Block>): Promise<Block>
  deleteBlock(id: string): Promise<void>

  // Page 操作
  getPageById(id: string): Promise<Page | null>
  getAllPages(): Promise<Page[]>
  createPage(page: Page): Promise<Page>
  updatePage(id: string, updates: Partial<Page>): Promise<Page>
  deletePage(id: string): Promise<void>

  // Link 操作
  getLinkById(id: string): Promise<Link | null>
  getLinksBySourceBlockId(blockId: string): Promise<Link[]>
  getBacklinks(pageId: string): Promise<Link[]>
  createLink(link: Link): Promise<Link>
  deleteLink(id: string): Promise<void>

  // Property 操作
  getPropertyById(id: string): Promise<Property | null>
  getPropertiesByBlockId(blockId: string): Promise<Property[]>
  createProperty(property: Property): Promise<Property>
  updateProperty(id: string, updates: Partial<Property>): Promise<Property>
  deleteProperty(id: string): Promise<void>

  // 通用操作
  close(): Promise<void>
}
```

**当前实现：**

| 适配器 | 适用场景 | 状态 |
|--------|---------|------|
| `IndexedDBAdapter` | 生产环境 | ✅ Phase 2 Sprint 2 完成 |
| `MemoryAdapter` | 单元测试 | ✅ Phase 2 Sprint 1 完成 |

### 1.5 测试策略

Core Layer 采用纯单元测试策略，使用 Vitest + MemoryAdapter：

```typescript
// 测试示例（blockService.test.ts）
import { describe, it, expect, beforeEach } from 'vitest'
import { BlockService } from '../services/blockService'
import { MemoryAdapter } from '../storage/memoryAdapter'

describe('BlockService', () => {
  let service: BlockService
  let storage: MemoryAdapter

  beforeEach(async () => {
    storage = new MemoryAdapter()
    service = new BlockService({ storage })
  })

  it('应该创建 Block', async () => {
    const block = await service.create({
      pageId: 'test-page',
      parentId: null,
      content: '测试内容',
      order: 100
    })

    expect(block.id).toBeDefined()
    expect(block.content).toBe('测试内容')
  })
})
```

**当前测试覆盖率：**
- BlockService: 95%+
- LinkService: 95%+
- PropertyService: 95%+
- SearchService: 95%+
- 总计：159 个测试用例通过

---

## 2. 快速开始

### 2.1 环境要求

| 工具                | 版本要求   | 说明          |
| ----------------- | ------ | ----------- |
| Node.js           | ≥ 18.x | LTS 版本推荐    |
| pnpm / npm / yarn | 最新版    | 推荐使用 pnpm   |
| VS Code           | 最新版    | 推荐 Volar 插件 |

### 1.2 项目初始化

```bash
# 创建项目
npm create vite@latest comind -- --template vue-ts

# 进入项目目录
cd comind

# 安装依赖
npm install vue vue-router pinia
npm install @tiptap/vue-3 @tiptap/starter-kit @tiptap/extension-placeholder @tiptap/extension-history
npm install dexie
npm install -D typescript @types/node vue-tsc @vitejs/plugin-vue
```

### 1.3 启动开发服务器

```bash
npm run dev
# 访问 http://localhost:5173
```

***

## 2. 项目结构

```
src/
├── main.ts                 # 应用入口
├── App.vue                 # 根组件
├── router/                 # 路由配置
│   └── index.ts
├── stores/                 # Pinia stores
│   ├── blocks.ts           # Block 状态管理
│   ├── pages.ts            # Page 状态管理
│   ├── editor.ts           # 编辑器状态（activeBlockId 等）
│   ├── settings.ts         # 用户设置
│   └── user-templates.ts   # 用户模板 Store（v5.0 新增）
├── components/             # Vue 组件
│   ├── Block.vue           # 单个 Block 组件
│   ├── BlockList.vue       # Block 列表（虚拟滚动）
│   ├── Editor.vue          # tiptap 编辑器封装
│   ├── Sidebar.vue         # 侧边栏
│   ├── LinkPopup.vue       # 链接弹出框
│   └── SlashCommandMenu.vue # 斜杠命令菜单（已集成模板）
├── composables/            # 组合式函数
│   ├── useBlock.ts         # Block 操作逻辑
│   ├── useLink.ts          # 链接跳转逻辑
│   ├── useKeyboard.ts      # 键盘快捷键
│   ├── useTheme.ts         # 主题状态管理
│   ├── useSettingsModal.ts # 设置模态框控制
│   ├── useRelationshipTypes.ts      # 关系类型 CRUD + 加载迁移（v0.7 新增）
│   ├── useRelationshipMenu.ts       # 关系类型菜单状态管理
│   ├── useRelationshipSync.ts        # 跨 Block 关系类型同步
│   ├── useBlockRelationshipCleanup.ts # 块删除关系清理（v0.7 新增）
│   ├── useCrossBlockSelection.ts     # 多块选择（v0.6 新增）
│   ├── useContentRenderer.ts         # 内容渲染（支持带类型链接）
│   ├── useTemplateRegistry.ts        # 模板注册表（v5.0 新增）
│   └── useSlashCommands.ts           # 斜杠命令（已集成模板）
├── config/                 # 配置文件
│   └── builtin-templates.ts # 内置模板配置（v5.0 新增）
├── services/               # 服务层
│   └── template-renderer.ts # 模板渲染服务（v5.0 新增）
├── storage/                # 存储层
│   ├── interface.ts        # StorageAdapter 接口定义
│   ├── db.ts               # Dexie 数据库定义（已扩展 templates 表）
│   └── indexedDB.ts        # IndexedDB 适配器实现
├── types/                  # TypeScript 类型定义
│   ├── block.ts            # Block 类型
│   ├── page.ts             # Page 类型
│   ├── link.ts             # Link 类型
│   └── template.ts         # 模板类型（v5.0 新增）
└── utils/                  # 工具函数
    ├── parser.ts           # 内容解析（Link、Tag、Property）
    ├── id.ts               # UUID 生成
    └── debounce.ts         # 防抖工具
```

***

## 3. 核心概念速查

### 3.1 数据模型

详细定义见 `docs/data-model.md`，核心实体：

**Block（唯一数据单元）：**

```typescript
interface Block {
  id: string              // UUID v4
  content: string         // 原始文本内容
  parentId: string | null // 父 Block ID，null = 顶级
  pageId: string          // 所属 Page ID
  left: number            // 同级排序位置（初始间隔 100）
  createdAt: string       // ISO 8601
  updatedAt: string       // ISO 8601
  isPage: boolean         // 是否为 Page Block
  title?: string          // 页面标题（仅 isPage=true）
  properties?: Record<string, any>  // 属性对象（存储层为 JSON 字符串）
}
```

**Page = Block 特殊形态：**

- `isPage = true`
- `parentId = null`
- `pageId = 自身 id`

**Link（双向链接）：**

```typescript
interface Link {
  id: string
  sourceBlockId: string   // 链接来源 Block
  targetPageId: string    // 链接目标 Page
  displayText?: string    // 链接显示文本
  position?: number       // 链接在 content 中的字符位置
  linkType: 'internal' | 'external'
  createdAt: string
}
```

### 3.2 编辑器状态机

**核心原则：单编辑器架构**

任何时刻只能存在 1 个活跃的 tiptap 编辑器实例。

```typescript
interface EditorState {
  activeBlockId: string | null  // 当前编辑中的 Block ID
  // 光标位置由 tiptap 内部 state.selection 管理，无需在 EditorState 中维护
  //（旧版本错误保留了 cursorOffset 字段，已移除）
}
```

**状态转换：**

| 事件         | 当前状态          | 目标状态          | 行为                      |
| ---------- | ------------- | ------------- | ----------------------- |
| 点击 Block   | display       | edit          | 挂载 tiptap，设置内容          |
| blur / ESC | edit          | display       | 保存内容，销毁 tiptap          |
| 切换 Block   | edit（Block A） | edit（Block B） | 保存 A → 销毁 editor → 挂载 B |

### 3.3 编辑行为规范

本文档上方"核心架构约束"章节已整合 Block 编辑行为规范，以下为快捷索引：

**Enter（拆分 Block）：**

- 当前 Block 按光标位置拆分
- 后半部分生成新 Block，作为兄弟节点

**Backspace（合并 Block）：**

- 光标在 Block 开头时，与上一个 Block 合并

**Tab（缩进）：**

- 当前 Block 变为前一个 Block 的子节点

**Shift + Tab（反缩进）：**

- 当前 Block 提升层级，成为同级

***

## 4. 开发优先级（Phase 1）

按以下顺序执行：

| 阶段     | 内容                | 验收标准                     |
| ------ | ----------------- | ------------------------ |
| **P0** | Block 渲染系统        | Block 树正确显示，层级清晰         |
| **P1** | 单 tiptap 编辑器      | 点击 Block 进入编辑，blur 退出并保存 |
| **P2** | Enter / Backspace | 拆分和合并 Block 正常工作         |
| **P3** | Tab / Shift+Tab   | 缩进和反缩进正确调整层级             |
| **P4** | 数据持久化             | IndexedDB 读写正常，刷新不丢数据    |
| **P5** | 虚拟列表优化            | 1000+ Block 流畅滚动         |

***

## 5. 关键实现指南

### 5.1 Block 渲染

**组件结构：**

```vue
<template>
  <div class="block" :class="{ active: isActive }">
    <!-- 缩进指示器 -->
    <div class="indent" :style="{ width: indentWidth }"></div>
    
    <!-- Bullet -->
    <span class="bullet" @click="toggleCollapse">•</span>
    
    <!-- 内容区：根据状态决定渲染编辑器或静态内容 -->
    <div class="content" v-if="isActive">
      <Editor :content="block.content" @save="handleSave" />
    </div>
    <div class="content" v-else v-html="renderedContent"></div>
    
    <!-- 子节点 -->
    <div class="children" v-if="hasChildren && !collapsed">
      <Block v-for="child in children" :key="child.id" :block="child" />
    </div>
  </div>
</template>
```

**关键点：**

- 使用 `activeBlockId` 判断当前 Block 是否为编辑态
- 非编辑态使用静态 HTML 渲染（性能优化）
- 子节点递归渲染

### 5.2 单编辑器管理

**核心逻辑（stores/editor.ts）：**

```typescript
export const useEditorStore = defineStore('editor', {
  state: () => ({
    activeBlockId: null as string | null
    // cursorOffset 不在 EditorState 中维护，由 tiptap 内部 state.selection 管理
  }),
  
  actions: {
    async activateBlock(blockId: string) {
      // 1. 如果已有活跃 Block，先保存并失活
      if (this.activeBlockId && this.activeBlockId !== blockId) {
        await this.deactivateBlock()
      }
      
      // 2. 设置新的活跃 Block
      this.activeBlockId = blockId
      // tiptap 实例由 Editor 组件管理（mount 时创建，unmount 时销毁）
    },
    
    async deactivateBlock() {
      if (!this.activeBlockId) return
      
      // 1. 触发内容保存（通过事件或直接调用 blockStore.saveBlock）
      // 2. 清除状态
      this.activeBlockId = null
    }
  }
})
```

**Editor 组件职责：**

- 组件挂载时创建 tiptap 实例
- 组件卸载时销毁 tiptap 实例
- 监听 blur 事件触发保存

### 5.3 键盘快捷键

**composables/useKeyboard.ts：**

```typescript
export function useKeyboard() {
  const editorStore = useEditorStore()
  const blockStore = useBlockStore()
  
  onMounted(() => {
    document.addEventListener('keydown', handleKeyDown)
  })
  
  onUnmounted(() => {
    document.removeEventListener('keydown', handleKeyDown)
  })
  
  function handleKeyDown(e: KeyboardEvent) {
    const { activeBlockId } = editorStore
    
    if (!activeBlockId) return
    
    // 获取 tiptap 编辑器实例（由 Editor 组件暴露）
    const editor = getActiveEditor()
    const cursorPos = editor?.state.selection.anchor
    
    switch (e.key) {
      case 'Enter':
        e.preventDefault()
        blockStore.splitBlock(activeBlockId, cursorPos)
        break
      case 'Backspace':
        // 光标在 Block 开头时合并
        if (cursorPos === 0) {
          e.preventDefault()
          blockStore.mergeWithPrevious(activeBlockId)
        }
        break
      case 'Tab':
        e.preventDefault()
        if (e.shiftKey) {
          blockStore.outdent(activeBlockId)
        } else {
          blockStore.indent(activeBlockId)
        }
        break
    }
  }
}
```

**说明：** `cursorPos` 通过 tiptap 编辑器实例获取，无需在 EditorState 中维护。

### 5.4 主题管理（useTheme）

**用途：** 管理应用主题状态，支持浅色/暗色/跟随系统三种模式。

**实现位置：** `src/composables/useTheme.ts`

```typescript
type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'comind-theme'

const theme = ref<Theme>(loadTheme())
const resolvedTheme = ref<'light' | 'dark'>(resolve(theme.value))

function loadTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'system'
}

function resolve(t: Theme): 'light' | 'dark' {
  if (t !== 'system') return t
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(t: Theme) {
  const resolved = resolve(t)
  document.documentElement.setAttribute('data-theme', resolved)
  resolvedTheme.value = resolved
}

function setTheme(t: Theme) {
  theme.value = t
  localStorage.setItem(STORAGE_KEY, t)
  applyTheme(t)
}

export function useTheme() {
  return { theme, resolvedTheme, setTheme }
}
```

**使用方式：**
```typescript
const { theme, resolvedTheme, setTheme } = useTheme()

// 切换主题
setTheme('dark')

// 监听当前解析后的主题
watch(resolvedTheme, (newTheme) => {
  // 主题已更新
})
```

### 5.5 设置模态框（useSettingsModal）

**用途：** 控制设置模态框的打开/关闭状态。

**实现位置：** `src/composables/useSettingsModal.ts`

```typescript
const isOpen = ref(false)

function open() {
  isOpen.value = true
}

function close() {
  isOpen.value = false
}

export function useSettingsModal() {
  return { isOpen, open, close }
}
```

**使用方式：**
```typescript
const { isOpen, open, close } = useSettingsModal()

// 在组件中
<SettingsModal v-model:visible="isOpen" />

// 打开设置
open()

// 关闭设置
close()
```

### 5.6 内容解析

**utils/parser.ts：**

```typescript
// 解析结果类型定义
export interface ParseResult {
  links: LinkParse[]
  tags: string[]
  properties: Record<string, any>
}

export interface LinkParse {
  targetTitle: string    // 链接文本（用于查找/创建 Page）
  displayText: string    // 显示文本
  position: number       // 在 content 中的字符偏移
}

export function parseContent(content: string): ParseResult {
  const links: LinkParse[] = []
  const tags: string[] = []
  const properties: Record<string, any> = {}

  // 解析 [[链接]]
  // 支持 [[页面名]] 和 [[页面名|别名]]
  const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  let match
  while ((match = linkRegex.exec(content)) !== null) {
    const [_, target, display] = match
    links.push({
      targetTitle: target.trim(),
      displayText: (display || target).trim(),
      position: match.index
    })
  }

  // 解析 #标签
  // 规则：# 后紧跟 Unicode 字母或汉字，不能以数字开头
  // 排除：URL 锚点（https://...#section）、邮箱（me@example.com）
  const tagRegex = /#([\p{L}_][\p{L}\p{N}_]*)/gu
  while ((match = tagRegex.exec(content)) !== null) {
    // 简单排除常见误匹配
    const tag = match[1]
    if (!tag.includes('/') && !tag.includes('.')) {
      tags.push(tag)
    }
  }

  // 解析属性（key:: value）
  // 规则：行首为 key:: value 格式，value 支持多种类型
  const propRegex = /^(\w+)::\s*(.+)$/gm
  while ((match = propRegex.exec(content)) !== null) {
    properties[match[1]] = parsePropertyValue(match[2])
  }

  return { links, tags, properties }
}

// 属性值类型推断
function parsePropertyValue(value: string): any {
  const trimmed = value.trim()

  // 布尔值
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false

  // 日期（YYYY-MM-DD）
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  // 数字
  if (/^\d+\.?\d*$/.test(trimmed)) return Number(trimmed)

  // 列表 [item1, item2]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1).split(',').map(s => s.trim())
  }

  // 页面引用 [[页面名]] → 返回页面名
  const pageMatch = trimmed.match(/^\[\[([^\]]+)\]\]$/)
  if (pageMatch) return pageMatch[1]

  // 默认返回字符串
  return trimmed
}
```

### 5.7 关系类型管理（useRelationshipTypes）

**用途**：管理关系类型的 CRUD 操作，包括加载、创建、更新、删除和排序。

**实现位置**：`comind/src/composables/useRelationshipTypes.ts`

```typescript
export interface RelationshipType {
  id: string
  type: string           // 正向英文标识
  inverse: string | null  // 反向英文标识
  label: string          // 正向中文标签
  inverseLabel: string   // 反向中文标签
  color: string          // 颜色，hex 格式
  order: number          // 排序权重
  deleted: boolean       // 软删除标记
  builtin: boolean       // 是否内置
}

// 主要 API
function loadRelationshipTypes(): Promise<void>
function createRelationshipType(data: Omit<RelationshipType, 'id'>): Promise<RelationshipType>
function updateRelationshipType(id: string, data: Partial<RelationshipType>): Promise<void>
function deleteRelationshipType(id: string): Promise<void>
function reorderRelationshipTypes(ids: string[]): Promise<void>
function getActiveRelationshipTypes(): RelationshipType[]
```

**使用方式**：
```typescript
const {
  relationshipTypes,
  loadRelationshipTypes,
  createRelationshipType,
  updateRelationshipType,
  deleteRelationshipType,
} = useRelationshipTypes()

// 初始化时加载
onMounted(() => loadRelationshipTypes())
```

### 5.8 关系类型菜单（useRelationshipMenu）

**用途**：管理关系类型选择菜单的状态，包括打开/关闭、位置、搜索过滤和键盘导航。

**实现位置**：`comind/src/composables/useRelationshipMenu.ts`

```typescript
// 主要 API
function open(options: { position: Position; range: Range; query?: string }): void
function openSwitch(options: { position: Position; range: Range; currentType: string }): void
function close(): void
function setQuery(query: string): void
function moveSelection(delta: number): void
function select(): void
```

### 5.9 关系类型同步（useRelationshipSync）

**用途**：同步同一页面内指向相同页面的关系类型链接。

**实现位置**：`comind/src/composables/useRelationshipSync.ts`

```typescript
// 主要 API
function setEditingBlock(blockId: string | null): void
function refreshSnapshot(): void
function syncRelationshipType(sourceBlockId: string, targetTitle: string, newType: string): Promise<void>
function removeRelationshipType(targetTitle: string): Promise<void>
```

### 5.10 块删除关系清理（useBlockRelationshipCleanup）

**用途**：当 Block 被删除时，自动清理跨页面指向该 Block 的类型链接。

**实现位置**：`src/composables/useBlockRelationshipCleanup.ts`

```typescript
// 主要 API
function cleanupBlockRelationships(blockId: string): Promise<void>
```

**清理逻辑**：
1. **删除前准备**：保存块快照，检查同页存活块的关联关系
2. **跨页清理准备**：收集需要清理的跨页类型链接
3. **执行删除**：删除目标块
4. **完成清理**：将相关类型链接降级为普通链接

**时序修复要点**：
- 在删除块前先检查存活块的关联关系
- 避免删除块后再检查导致的存活块判断错误
- 将跨页清理准备、存活关联检查提前到删除操作之前

### 5.11 模板系统开发指南

#### 5.11.1 模板类型定义（template.ts）

**用途**：定义模板系统的所有数据结构

**实现位置**：`src/types/template.ts`

**核心类型**：
```typescript
// TemplateBlock - 模板块
interface TemplateBlock {
  type: 'bullet' | 'heading' | 'property'
  content: string  // 支持 {{var}} 变量
  headingLevel?: 1 | 2 | 3
  propertyKey?: string
  children?: TemplateBlock[]
}

// BuiltinTemplate - 内置模板
interface BuiltinTemplate {
  id: string
  name: string
  aliases?: string[]
  category: 'thinking-model' | 'work' | 'journal' | 'review'
  description: string
  icon: string
  blocks: TemplateBlock[]
}

// UserTemplate - 用户模板
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
  date: string      // 本地化日期
  time: string      // 本地化时间
  isoDate: string   // ISO 日期
  pageTitle: string // 当前页面标题
  cursor: '__CURSOR__'
  clipboard: string
  now: number
}

// BlockDraft - 渲染结果
interface BlockDraft {
  id: string
  pageId: string
  parentId: string | null
  pos: number
  content: string
  format: Record<string, any>
  type: 'bullet' | 'property' | 'query' | 'embed' | 'code' | 'image'
  properties: Record<string, any>
  cursorMarker: '__CURSOR__' | null
}
```

#### 5.11.2 内置模板配置（builtin-templates.ts）

**用途**：配置10个内置模板

**实现位置**：`src/config/builtin-templates.ts`

**修改原则**：
1. 保持 ID 全局唯一
2. blocks 数组至少 1 个元素
3. heading 类型必须指定 headingLevel
4. property 类型必须指定 propertyKey

**添加新内置模板**：
```typescript
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  // ... 现有模板
  {
    id: 'my-new-template',
    name: '我的新模板',
    aliases: ['new', 'template'],
    category: 'work',
    description: '模板描述',
    icon: '📝',
    blocks: [
      { type: 'heading', headingLevel: 2, content: '标题: {{cursor}}' },
      { type: 'bullet', content: '内容' },
      { type: 'property', propertyKey: '日期', content: '{{date}}' },
    ]
  }
]
```

#### 5.11.3 模板注册表（useTemplateRegistry）

**用途**：合并内置和用户模板，提供统一查询接口

**实现位置**：`src/composables/useTemplateRegistry.ts`

**设计要点**：
- 模块级共享 state（避免多次调用返回不同实例）
- 用户模板 ID 前缀 `user:`
- 用户模板优先排序

**主要 API**：
```typescript
export function useTemplateRegistry() {
  // 状态
  const all: Ref<NormalizedTemplate[]>
  const isLoaded: ComputedRef<boolean>
  
  // 方法
  async function loadAll(): Promise<NormalizedTemplate[]>
  function getById(id: string): NormalizedTemplate | undefined
  function searchByText(query: string): NormalizedTemplate[]
  
  return { all, isLoaded, loadAll, getById, searchByText }
}
```

**使用示例**：
```typescript
const registry = useTemplateRegistry()

// 加载所有模板
await registry.loadAll()

// 按 ID 获取
const template = registry.getById('second-order-thinking')

// 搜索模板
const results = registry.searchByText('思维')
```

#### 5.11.4 用户模板 Store（user-templates）

**用途**：管理用户自定义模板的 CRUD

**实现位置**：`src/stores/user-templates.ts`

**主要 API**：
```typescript
export const useUserTemplatesStore = defineStore('user-templates', () => {
  const templates: Ref<UserTemplate[]>
  
  async function loadAll(): Promise<void>
  async function create(input: CreateTemplateInput): Promise<UserTemplate>
  async function remove(id: string): Promise<void>
  async function rename(id: string, newName: string): Promise<void>
  async function update(id: string, patch: Partial<Omit<UserTemplate, 'id' | 'createdAt'>>): Promise<void>
  
  return { templates, loadAll, create, remove, rename, update }
})
```

**创建用户模板**：
```typescript
interface CreateTemplateInput {
  name: string
  description?: string
  category?: string
  sourcePageId: string
  blocks: TemplateBlock[]
}

const store = useUserTemplatesStore()
const template = await store.create({
  name: '我的模板',
  sourcePageId: pageId,
  blocks: [...]
})
```

#### 5.11.5 模板渲染器（TemplateRenderer）

**用途**：展开模板变量，渲染为 BlockDraft 列表

**实现位置**：`src/services/template-renderer.ts`

**主要 API**：
```typescript
export class TemplateRenderer {
  // 构建变量上下文
  static async buildContext(pageTitle: string): Promise<TemplateContext>
  
  // 展开变量
  static expandContent(content: string, context: TemplateContext): ExpandResult
  
  // 渲染模板
  static render(
    template: NormalizedTemplate,
    context: TemplateContext,
    anchorBlock: Block
  ): BlockDraft[]
}
```

**渲染流程**：
1. 使用 `deserializeBlockTree` 分配 ID、pos、parentId
2. 递归展开 `TemplateBlock`
3. 展开模板变量（`{{cursor}}` 替换为空字符串）
4. property 类型序列化为 `key:: value`
5. 通过 `hasCursor` 标记追踪光标位置

**变量展开规则**：
- `{{date}}` → 本地化日期
- `{{time}}` → 本地化时间
- `{{iso_date}}` → ISO 格式日期
- `{{page_title}}` → 当前页面标题
- `{{cursor}}` → **替换为空字符串**，通过 `ExpandResult.hasCursor` 标记追踪
- `{{clipboard}}` → 剪贴板内容
- 其他 `{{xxx}}` → 保留原样

**关键修复**：
- `{{cursor}}` 不再渲染为可见的 `__CURSOR__` 文本
- 移除了废弃的 `PlaceholderMarker` 接口（无消费者读取）

#### 5.11.6 模板与斜杠命令集成

**用途**：在 SlashCommandMenu 中集成模板命令

**实现位置**：`src/composables/useSlashCommands.ts`

**主要函数**：
```typescript
// 构建模板命令列表
export function buildTemplateCommands(): Command[]

// 执行模板命令
export async function executeTemplateCommand(
  blockId: string | undefined,
  templateId: string,
  editorInstance: Editor,
  range: { from: number; to: number }
): Promise<void>
```

**执行流程**：
1. 清除斜杠命令文本
2. 加载模板注册表
3. 构建模板上下文
4. 渲染模板
5. 按 pos 倒序插入新块
6. 定位光标

---

### 5.12 多块选择（useCrossBlockSelection）

**用途**：管理多 Block 选择状态，支持批量操作。

**实现位置**：`comind/src/composables/useCrossBlockSelection.ts`

```typescript
// 主要 API
function selectBlock(blockId: string): void
function deselectBlock(blockId: string): void
function toggleSelection(blockId: string): void
function selectRange(fromId: string, toId: string): void
function clearSelection(): void
function deleteSelected(): Promise<void>
```

### 5.12 数据持久化

**storage/indexedDB.ts：**

```typescript
import Dexie, { Table } from 'dexie'

// IndexedDB 存储结构（字段名与 data-model.md 一致）
export interface BlockRecord {
  id: string
  content: string
  parentId: string | null
  pageId: string
  left: number           // 同级排序位置（与 data-model.md 一致）
  createdAt: number      // 时间戳
  updatedAt: number      // 时间戳
  isPage: boolean
  title?: string
  properties?: string    // JSON 字符串（与 data-model.md 一致）
  collapsed?: boolean       // 折叠状态
}

export interface LinkRecord {
  id?: number
  sourceBlockId: string
  targetPageId: string | null  // 目标 Page UUID；外部链接时为 null
  displayText: string
  position?: number
  linkType: 'internal' | 'external'
  createdAt: number
}

class ComindDB extends Dexie {
  blocks!: Table<BlockRecord, string>
  links!: Table<LinkRecord, number>
  pages!: Table<{ id: string; title: string; createdAt: number; updatedAt: number }, string>

  constructor() {
    super('comind')
    this.version(1).stores({
      blocks: 'id, parentId, pageId, left, createdAt, updatedAt',
      links: '++id, sourceBlockId, targetPageId, linkType',
      pages: 'id, title, createdAt, updatedAt'
    })
  }
}

export const db = new ComindDB()

// IndexedDB 适配器
// 依赖 utils/parser.ts 中导出的 LinkParse 类型和 parseBlockLinks 函数
export class IndexedDBAdapter implements StorageAdapter {
  
  async saveBlock(block: Block): Promise<void> {
    await db.blocks.put({
      id: block.id,
      content: block.content,
      parentId: block.parentId,
      pageId: block.pageId,
      left: block.left,
      createdAt: new Date(block.createdAt).getTime(),
      updatedAt: Date.now(),
      isPage: block.isPage,
      title: block.title,
      properties: block.properties ? JSON.stringify(block.properties) : undefined,
      folded: block.folded
    })
    
    // 解析内容中的 [[...]] 并保存 Link
    // parseBlockLinks 是 parseContent 的链接子集，专门返回 LinkParse[]
    const linkParses = parseBlockLinks(block.content)
    await this.saveLinks(block.id, linkParses)
  }
  
  /**
   * 保存链接：targetTitle → 查找/创建 Page → 写入 Link 表
   */
  private async saveLinks(sourceBlockId: string, linkParses: LinkParse[]): Promise<void> {
    await db.transaction('rw', db.links, db.pages, async () => {
      // 1. 删除旧链接
      await db.links.where('sourceBlockId').equals(sourceBlockId).delete()
      
      // 2. 写入新链接
      for (const link of linkParses) {
        if (link.isExternal) {
          // 外部链接：不查找 Page，targetPageId 留 null
          await db.links.add({
            sourceBlockId,
            targetPageId: null,
            displayText: link.displayText,
            position: link.position,
            linkType: 'external',
            createdAt: Date.now()
          })
          continue
        }
        
        // 内部链接：查找或创建目标 Page
        let targetPage = await db.pages.where('title').equals(link.targetTitle).first()
        
        if (!targetPage) {
          const pageId = generateUUID()
          targetPage = {
            id: pageId,
            title: link.targetTitle,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
          await db.pages.put(targetPage)
        }
        
        await db.links.add({
          sourceBlockId,
          targetPageId: targetPage.id,
          displayText: link.displayText,
          position: link.position,
          linkType: 'internal',
          createdAt: Date.now()
        })
      }
    })
  }
  
  async getBlockTree(pageId: string): Promise<Block[]> {
    // 按 left 排序查询
    const blocks = await db.blocks
      .where('pageId')
      .equals(pageId)
      .sortBy('left')
    
    return blocks.map(this.recordToBlock)
  }
  
  private recordToBlock(record: BlockRecord): Block {
    return {
      id: record.id,
      content: record.content,
      parentId: record.parentId,
      pageId: record.pageId,
      left: record.left,
      createdAt: new Date(record.createdAt).toISOString(),
      updatedAt: new Date(record.updatedAt).toISOString(),
      isPage: record.isPage,
      title: record.title,
      properties: record.properties ? JSON.parse(record.properties) : undefined,
      collapsed: record.collapsed
    }
  }
}
```

**关键点：**
- `left` 字段与 `data-model.md` 保持一致
- `properties` 存储为 JSON 字符串，读写时需序列化/反序列化
- Link 存储时通过 `targetTitle` 查找/创建 Page，再写入 `targetPageId`
- 使用 `++id` 让 Dexie 自动生成自增 ID

***

## 6. 性能优化规则

### 6.1 必须遵守

- ✅ Block 组件 memo 化（避免不必要重渲染）
- ✅ 编辑器仅在 active Block 上挂载（单编辑器原则）
- ✅ 输入防抖（save 操作 debounce 300ms）
- ✅ 避免深层嵌套响应式对象
- ✅ 按需渲染（非编辑态 Block 使用静态 HTML，不走 Vue 响应式）

### 6.2 Phase 1 后按需引入

- **虚拟列表**：当 Block 数量达到 500+ 出现性能瓶颈时引入（vue-virtual-scroller / tanstack-virtual）
- Phase 1 阶段 100 个 Block ≈ 100 个 DOM 节点，浏览器性能完全可承受

### 6.3 性能指标

| 指标              | 目标值         |
| --------------- | ----------- |
| 1000 Block 滚动   | 无卡顿，>30 FPS |
| 编辑器切换延迟         | <50ms       |
| 输入响应延迟          | <16ms       |
| 首屏加载（100 Block） | <200ms      |

***

## 7. 测试策略

### 7.1 单元测试

- 工具函数：`parser.ts`、`id.ts`
- 存储层：`IndexedDBAdapter`
- 状态管理：Pinia stores

### 7.2 集成测试

- Block CRUD 操作
- 键盘快捷键流程
- 数据持久化完整流程

### 7.3 E2E 测试（可选）

- Cypress / Playwright
- 验收标准中的关键路径

***

## 8. 常见问题

### Q1: 为什么只能有一个 tiptap 实例？

**答：**

- 多编辑器并存会占用大量内存
- 状态管理复杂，容易出现同步问题
- Logseq 等成熟产品都采用单编辑器架构

### Q2: Block.content 中是否包含标题行？

**答：** 不包含。

- 标题行（Markdown 的 `#` 标题）用于层级解析
- Block.content 只包含正文内容
- 详见 `storage-spec.md` §3.2

### Q3: Link 解析时机？

**答：** Phase 1 采用保存时解析。

- 输入时实时解析开销大
- 保存时解析 + Link 表写入，查询高效

### Q4: 如何处理大量 Block？

**答：**
- Phase 1：按需渲染（非编辑态 Block 用静态 HTML）+ memo 化 + 防抖，100 Block 内无性能问题
- 500+ Block 时：引入虚拟列表（vue-virtual-scroller / tanstack-virtual）
- 避免在 Pinia 状态中存储渲染无关的临时数据

***

## 9. 相关文档索引

| 文档     | 路径                    | 内容                            |
| ------ | --------------------- | ----------------------------- |
| 数据模型   | `../2-architecture/data-model.md`  | Block、Link、Tag、Property 详细定义 |
| 技术选型   | `../1-overview/tech-selection.md` | Vue 3 / Pinia / tiptap / IndexedDB 选型依据 |
| 存储规范   | `../2-architecture/storage-spec.md` | Markdown + SQLite 混合存储（Phase 2/3） |
| 链接规范   | `../3-features/link-spec.md`   | 双链语法、解析时机、页面匹配、UI 交互           |
| UI/UX 规范 | `../4-ui/ui-ux-spec.md`  | 视觉系统、布局、组件、交互状态               |
| 斜杠命令规格 | `../3-features/slash-commands-spec.md` | 斜杠命令功能规格 |
| 模板系统规格 | `../3-features/template-system-spec.md` | 模板系统功能规格 |

***

## 10. Phase 1 不做的事

明确边界，避免过度设计：

| 功能             | 原因                         |
| -------------- | -------------------------- |
| 文件系统读写         | Phase 1 纯 Web，IndexedDB 足够 |
| SQLite         | Phase 2/3 引入               |
| Electron/Tauri | Phase 3 引入                 |
| 多设备同步          | 远期规划                       |
| 协作编辑           | 远期规划                       |
| 富文本（加粗、斜体）     | Phase 1 聚焦大纲体验             |
| 图片/附件          | Phase 2 考虑                 |
| 全文搜索           | Phase 2 考虑                 |
| Graph 视图       | Phase 2 考虑                 |

***

## 11. 开发检查清单

### 功能开发前

- [ ] 阅读相关规范文档（`data-model.md`、`block-editor-spec.md`）
- [ ] 理解 Block 数据模型
- [ ] 理解单编辑器架构

### 功能开发中

- [ ] 遵守单编辑器原则
- [ ] 遵守数据流规范（UI → Pinia → IndexedDB）
- [ ] 使用 TypeScript 类型
- [ ] 性能测试（>100 Block 场景）

### 功能开发后

- [ ] 单元测试覆盖
- [ ] 性能指标达标
- [ ] 文档更新（如有必要）

***

*文档由 AI 助手协助生成，待开发者评审确认。*
