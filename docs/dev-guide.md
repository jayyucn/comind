# 开发指南（Development Guide）

> 版本：v0.2
> 日期：2026-04-16
> 适用阶段：Phase 1 MVP
> 技术栈：Vue 3 + TypeScript + Pinia + Vite + tiptap + IndexedDB
> 状态：已修正（v0.1 审核问题已修复）

***

## 1. 快速开始

### 1.1 环境要求

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
│   └── settings.ts         # 用户设置
├── components/             # Vue 组件
│   ├── Block.vue           # 单个 Block 组件
│   ├── BlockList.vue       # Block 列表（虚拟滚动）
│   ├── Editor.vue          # tiptap 编辑器封装
│   ├── Sidebar.vue         # 侧边栏
│   └── LinkPopup.vue       # 链接弹出框
├── composables/            # 组合式函数
│   ├── useBlock.ts         # Block 操作逻辑
│   ├── useLink.ts          # 链接跳转逻辑
│   └── useKeyboard.ts      # 键盘快捷键
├── storage/                # 存储层
│   ├── interface.ts        # StorageAdapter 接口定义
│   ├── db.ts               # Dexie 数据库定义
│   └── indexedDB.ts        # IndexedDB 适配器实现
├── types/                  # TypeScript 类型定义
│   ├── block.ts            # Block 类型
│   ├── page.ts             # Page 类型
│   └── link.ts             # Link 类型
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
  // cursorOffset: 光标位置由 tiptap 内部管理，无需在状态中维护
}
```

**状态转换：**

| 事件         | 当前状态          | 目标状态          | 行为                      |
| ---------- | ------------- | ------------- | ----------------------- |
| 点击 Block   | display       | edit          | 挂载 tiptap，设置内容          |
| blur / ESC | edit          | display       | 保存内容，销毁 tiptap          |
| 切换 Block   | edit（Block A） | edit（Block B） | 保存 A → 销毁 editor → 挂载 B |

### 3.3 编辑行为规范

详细规范见 `docs/block-editor-spec.md`。

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
    activeBlockId: null as string | null,
    cursorOffset: null as number | null
  }),
  
  actions: {
    async activateBlock(blockId: string) {
      // 1. 如果已有活跃 Block，先保存
      if (this.activeBlockId && this.activeBlockId !== blockId) {
        await this.deactivateBlock()
      }
      
      // 2. 设置新的活跃 Block
      this.activeBlockId = blockId
      // tiptap 实例由 Editor 组件管理
    },
    
    async deactivateBlock() {
      if (!this.activeBlockId) return
      
      // 1. 触发保存（通过事件或直接调用）
      // 2. 清除状态
      this.activeBlockId = null
      this.cursorOffset = null
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

### 5.4 内容解析

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

### 5.5 数据持久化

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
  folded?: boolean       // 折叠状态
}

export interface LinkRecord {
  id?: number
  sourceBlockId: string
  targetPageId: string   // 目标 Page 的 UUID（解析后填充）
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
    
    // 解析内容并保存 Link
    const { links } = parseContent(block.content)
    await this.saveLinks(block.id, links)
  }
  
  /**
   * 保存链接：解析 targetTitle → 查找/创建 Page → 写入 Link
   */
  private async saveLinks(sourceBlockId: string, linkParses: LinkParse[]): Promise<void> {
    // 1. 删除旧链接
    await db.links.where('sourceBlockId').equals(sourceBlockId).delete()
    
    // 2. 解析并写入新链接
    for (const link of linkParses) {
      // 查找或创建目标 Page
      let targetPage = await db.pages.where('title').equals(link.targetTitle).first()
      
      if (!targetPage) {
        // 页面不存在，创建新 Page（UUID 由系统生成）
        const pageId = generateUUID()
        targetPage = {
          id: pageId,
          title: link.targetTitle,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
        await db.pages.put(targetPage)
      }
      
      // 写入 Link
      await db.links.add({
        sourceBlockId,
        targetPageId: targetPage.id,
        displayText: link.displayText,
        position: link.position,
        linkType: 'internal',
        createdAt: Date.now()
      })
    }
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
      folded: record.folded
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

- ✅ 使用虚拟列表（只渲染可见 Block）
- ✅ Block 组件 memo 化（避免不必要重渲染）
- ✅ 编辑器仅在 active Block 上挂载
- ✅ 输入防抖（save 操作 debounce 300ms）
- ✅ 避免深层嵌套响应式对象

### 6.2 性能指标

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

- 虚拟列表（vue-virtual-scroller / tanstack-virtual）
- 按需加载（分页查询子节点）
- 渲染优化（静态内容不用响应式）

***

## 9. 相关文档索引

| 文档          | 路径                          | 内容                                      |
| ----------- | --------------------------- | --------------------------------------- |
| 数据模型        | `docs/data-model.md`        | Block、Link、Tag、Property 详细定义            |
| 技术选型        | `docs/tech-selection.md`    | Vue 3 / Pinia / tiptap / IndexedDB 选型依据 |
| Block 编辑器规范 | `docs/block-editor-spec.md` | 单编辑器架构、键盘行为、性能约束                        |
| 存储规范        | `docs/storage-spec.md`      | Markdown + SQLite 混合存储（Phase 2/3）       |

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
