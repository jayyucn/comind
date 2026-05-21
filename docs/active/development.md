# comind 开发指南

> 版本：v4.0（Dexie v4, Gap Pos 排序）
> 日期：2026-05-21
> 状态：活跃
> 来源：合并自 dev-guide.md + page-block-crud.md + tech-selection.md

---

## 1. 技术栈

| 维度 | 选择 | 依据 |
|------|------|------|
| 前端框架 | **Vue 3 + TypeScript** | 组合式 API，开发效率高 |
| 状态管理 | **Pinia** | Vue 官方推荐，TypeScript 友好 |
| 构建工具 | **Vite** | 秒级启动，HMR 顺滑 |
| 编辑器内核 | **tiptap (ProseMirror)** | ProseMirror 的 Vue 封装，开箱即用 |
| 本地存储 | **IndexedDB (Dexie.js)** | 容量大，异步 API，TypeScript 友好 |
| 拖拽库 | **Sortable.js** | 轻量，支持嵌套列表 |
| 路由 | **Vue Router** | Vue 官方路由 |
| 测试 | **Vitest + Playwright** | 单元测试 + E2E 测试 |

### 依赖清单

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
    "dexie": "^4.0",
    "sortablejs": "^1.15"
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
│   ├── Block/              # Block 组件目录
│   │   ├── index.vue       # Block 核心组件
│   │   └── styles.css      # Block 样式
│   ├── BlockList.vue       # Block 列表容器
│   ├── Editor.vue          # tiptap 编辑器封装
│   ├── Sidebar.vue         # 侧边栏
│   ├── Backlinks.vue       # 反向链接面板
│   └── LinkPopup.vue       # 链接弹出框
├── composables/            # 组合式函数
│   ├── useBlock.ts         # Block 操作逻辑
│   ├── useLink.ts          # 链接跳转逻辑
│   └── useSortable.ts      # 拖拽排序逻辑
├── storage/                # 存储层
│   ├── interface.ts        # StorageAdapter 接口定义
│   ├── db.ts               # Dexie 数据库定义
│   └── indexedDB.ts        # IndexedDB 适配器实现
├── types/                  # TypeScript 类型定义
│   ├── block.ts            # Block 类型
│   ├── page.ts             # Page 类型
│   └── link.ts             # Link 类型
├── extensions/             # tiptap 自定义扩展
│   └── EnterAsBlockExtension.ts  # 键盘快捷键扩展
└── utils/                  # 工具函数
    ├── parser.ts           # 内容解析（Link、Tag、Property）
    ├── id.ts               # UUID 生成
    └── block-helpers.ts    # Block 辅助函数（排序、插入位置计算等）
```

---

## 3. 核心架构约束

以下约束是 comind 的硬性架构规则，违反任一条均视为系统性错误：

**约束 1：单编辑器原则（最重要）**
- 任何时刻，系统只能存在 **1 个活跃的 tiptap 编辑器实例**
- 任何时刻，只有 **1 个 Block 处于编辑状态**
- 编辑器必须随 Block 切换而销毁或复用

**约束 2：Block 是唯一数据单元**
- 系统所有数据围绕 Block 构建：编辑、层级结构、存储、Page 组成
- 禁止引入"文档级编辑模型"

**约束 3：状态驱动，而非 DOM 驱动**
- 所有行为通过状态机控制（`activeBlockId`、Block 树结构）
- 禁止直接 DOM 操作控制业务逻辑

**约束 4：Phase 1 不引入虚拟列表**
- 100 个 Block ≈ 100 个 DOM 节点，浏览器性能完全可承受

**约束 5：分层架构**
- Pinia 为状态中心，tiptap 为编辑内核，IndexedDB 为持久化层
- 三者职责严格分层，UI 状态不得反向污染数据结构

---

## 4. 编辑器管理

### 4.1 单编辑器架构

```typescript
// stores/editor.ts
export const useEditorStore = defineStore('editor', {
  state: () => ({
    activeBlockId: null as string | null,
    pendingCursorPos: null as number | null  // 临时光标位置
  }),
  actions: {
    async activateBlock(blockId: string, cursorPos?: number) {
      if (this.activeBlockId && this.activeBlockId !== blockId) {
        await this.deactivateBlock()
      }
      this.activeBlockId = blockId
      if (cursorPos !== undefined) {
        this.pendingCursorPos = cursorPos
      }
    },
    async deactivateBlock() {
      this.activeBlockId = null
      this.pendingCursorPos = null
    }
  }
})
```

### 4.2 Editor 组件职责

- 组件挂载时创建 tiptap 实例
- 组件卸载时销毁 tiptap 实例
- 监听 blur 事件触发保存
- 通过 `watch(activeBlockId)` 响应编辑态切换

---

## 5. Page ↔ Block CRUD 联动

### 5.1 核心原则

1. **Page 是主动方**：创建页面时连带创建根 Block
2. **Block 被动跟随**：修改 Page 元数据不影响 Block，反之亦然
3. **删除 Page = 删除整个 Block 树 + 相关 Link**
4. **所有操作在事务内完成**（Phase 2/3 SQLite）

### 5.2 创建页面

```typescript
async function createPage(title: string, type: 'normal' | 'journal' = 'normal') {
  const now = Date.now()
  // 1. 创建根 Block
  const rootBlock = await blockStore.createBlock({
    pageId: null,
    parentId: null,
    pos: GAP_SIZE,  // 初始排序位置
    content: '',
    format: {},
    type: 'bullet',
    properties: {},
  })
  // 2. 创建 Page，关联根 Block
  const page = await db.page.create({
    id: generateId(),
    blockId: rootBlock.id,
    title,
    type,
    createdAt: now,
    updatedAt: now,
  })
  // 3. 回填 Block.pageId
  await blockStore.updateBlock(rootBlock.id, { pageId: page.id })
  return page
}
```

### 5.3 读取页面

```typescript
async function getPage(pageId: string) {
  const page = await db.page.findById(pageId)
  if (!page) return null
  const blocks = await blockStore.getBlocksByPage(pageId)
  return { page, blocks }
}
```

### 5.4 删除页面（级联删除）

```typescript
async function deletePage(pageId: string) {
  const page = await db.page.findById(pageId)
  if (!page) return
  await db.transaction(async () => {
    // 1. 删除相关 Link
    await db.link.where('targetPageId').equals(pageId).delete()
    // 2. 删除所有 Block
    await deleteBlockTree(page.blockId)
    // 3. 删除 Page
    await db.page.delete(pageId)
  })
}
```

### 5.5 操作联动表

| 操作 | 触发方 | 联动效果 |
|------|--------|----------|
| 创建 Page | 用户 | 自动创建根 Block，回填 blockId |
| 删除 Page | 用户 | 级联删除所有 Block + Link |
| 更新 Page.title | 用户 | 仅 Page 表，不动 Block |
| 创建 Block | 用户 | 绑定 pageId，可选更新统计 |
| 删除 Block | 用户 | 级联删除子 Block + Link，同步统计 |
| 更新 Block.content | 用户 | 同步 Page 统计（延迟） |

---

## 6. 内容解析

### 6.1 解析顺序

1. Property 行（`key:: value`）
2. WikiLink（`[[...]]`）
3. 标签（`#...`）
4. 外部链接（`https://...`）

### 6.2 解析实现

```typescript
export function parseContent(content: string): ParseResult {
  const links: LinkParse[] = []
  const tags: string[] = []
  const properties: Record<string, any> = {}

  // 解析 [[链接]]
  const linkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
  let match
  while ((match = linkRegex.exec(content)) !== null) {
    links.push({
      targetTitle: match[1].trim(),
      displayText: (match[2] || match[1]).trim(),
      position: match.index
    })
  }

  // 解析 #标签
  const tagRegex = /#([\p{L}_][\p{L}\p{N}_]*)/gu
  while ((match = tagRegex.exec(content)) !== null) {
    const tag = match[1]
    if (!tag.includes('/') && !tag.includes('.')) {
      tags.push(tag)
    }
  }

  // 解析属性
  const propRegex = /^(\w+)::\s*(.+)$/gm
  while ((match = propRegex.exec(content)) !== null) {
    properties[match[1]] = parsePropertyValue(match[2])
  }

  return { links, tags, properties }
}
```

**解析时机：** 保存时解析（非输入时实时解析）

---

## 7. 存储层

### 7.1 Dexie Schema（版本 4）

```typescript
this.version(4).stores({
  blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
  links: 'id, sourceBlockId, targetPageId, displayText, createdAt',
  pages: 'id, blockId, title, type, createdAt, updatedAt'
})
```

### 7.2 存储接口抽象

```typescript
interface StorageAdapter {
  getBlock(id: string): Promise<Block | null>
  getAllBlocks(): Promise<Block[]>
  saveBlock(block: Block): Promise<void>
  deleteBlock(id: string): Promise<void>
  getPage(id: string): Promise<Page | null>
  getAllPages(): Promise<Page[]>
  batch(fn: (tx: any) => Promise<void>): Promise<void>
}
```

Phase 1 实现 `IndexedDBAdapter`（基于 Dexie），Phase 2 可替换为 `SQLiteAdapter`。

---

## 8. 性能规则

### 8.1 必须遵守

- Block 组件 memo 化（避免不必要重渲染）
- 编辑器仅在 active Block 上挂载（单编辑器原则）
- 输入防抖（save 操作 debounce 300ms）
- 避免深层嵌套响应式对象
- 非编辑态 Block 使用静态 HTML，不走 Vue 响应式

### 8.2 性能指标

| 指标 | 目标值 |
|------|--------|
| 1000 Block 滚动 | 无卡顿，>30 FPS |
| 编辑器切换延迟 | <50ms |
| 输入响应延迟 | <16ms |
| 首屏加载（100 Block） | <200ms |

---

## 9. 开发检查清单

### 功能开发前
- [ ] 阅读相关规范文档（architecture.md, features.md）
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

---

*本文档由 3 个开发相关文档合并而成，版本 v4.0*
