# [[页面]] 跳转功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `[[页面名]]` 链接点击跳转功能，包括编辑态和展示态两种场景

**Architecture:**
- 编辑态（Editor.vue）：监听 WikiLinkExtension 触发的 `wiki-link-click` 事件
- 展示态（Block.vue）：为 `.block-link` span 绑定点击事件
- 页面解析：复用 `storage.getPage(title)` 查找页面，未找到则创建新页面

**Tech Stack:** Vue 3 + TypeScript + Pinia + tiptap

---

## 文件结构

```
src/
├── components/
│   ├── Editor.vue          # 修改：监听 wiki-link-click 事件
│   └── Block.vue          # 修改：展示态链接点击处理
├── stores/
│   └── pages.ts           # 新增：getPageByTitle 方法
└── storage/
    └── indexedDB.ts       # 新增：getPageByTitle 方法（用于内存页面查找）
```

---

## Task 1: Editor.vue — 编辑态链接点击处理

**Files:**
- Modify: `src/components/Editor.vue`

- [ ] **Step 1: 添加 wiki-link-click 事件监听**

在 `onMounted` 或初始化逻辑中添加 `@wiki-link-click` 事件监听：

```typescript
// 在 setup 中添加
import { usePageStore } from '../stores/pages'
import { storage } from '../storage/indexedDB'

const pageStore = usePageStore()

// 在 editor.value 初始化后添加事件监听
function setupWikiLinkHandler() {
  if (!editor.value) return
  const dom = editor.value.view.dom
  dom.addEventListener('wiki-link-click', handleWikiLinkClick as EventListener)
}

function handleWikiLinkClick(event: Event) {
  const customEvent = event as CustomEvent<{ pageName: string }>
  const pageName = customEvent.detail.pageName
  navigateToPage(pageName)
}

async function navigateToPage(pageName: string) {
  // 1. 尝试查找已存在的页面
  let page = pageStore.getPageByTitle?.(pageName)
  if (!page) {
    page = await storage.getPage(pageName)
  }

  if (page) {
    // 页面存在，直接跳转
    await pageStore.openPage(page.id)
  } else {
    // 页面不存在，创建新页面并跳转
    const newPage = await pageStore.createPage(pageName)
    await pageStore.openPage(newPage.id)
  }
}

onMounted(() => {
  setupWikiLinkHandler()
})
```

- [ ] **Step 2: 在 onBeforeUnmount 中清理事件监听**

```typescript
onBeforeUnmount(() => {
  savedFromOutside = false
  editor.value?.view.dom.removeEventListener('wiki-link-click', handleWikiLinkClick as EventListener)
  editor.value?.destroy()
})
```

---

## Task 2: Block.vue — 展示态链接点击处理

**Files:**
- Modify: `src/components/Block.vue`

- [ ] **Step 1: 在 Block.vue 中添加 navigateToPage 函数**

从 Editor.vue 复制 `navigateToPage` 函数逻辑到 Block.vue：

```typescript
import { usePageStore } from '../stores/pages'
import { storage } from '../storage/indexedDB'

const pageStore = usePageStore()

async function navigateToPage(pageName: string) {
  let page = await storage.getPage(pageName)
  if (page) {
    await pageStore.openPage(page.id)
  } else {
    const newPage = await pageStore.createPage(pageName)
    await pageStore.openPage(newPage.id)
  }
}
```

- [ ] **Step 2: 在 renderContent 中为 block-link 添加 data-page 属性**

修改 `renderContent` 函数，使 `[[target]]` 的 span 包含 `data-page` 属性：

```typescript
function renderContent(text: string): string {
  const html = escapeHtml(text)
  return html
    .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, alias) => {
      const display = alias || target
      return `<span class="block-link" data-page="${escapeHtml(target)}">${display}</span>`
    })
    .replace(/\[\[(https?:\/\/[^\]]+)\]\]/g, (_, url) => {
      return `<span class="block-link external" data-external href="${escapeHtml(url)}">${url}</span>`
    })
    // ... 标签处理保持不变
}
```

- [ ] **Step 3: 添加 handleContentClick 函数处理链接点击**

```typescript
function handleContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  const link = target.closest('.block-link') as HTMLElement | null
  if (!link) return

  // 外部链接
  if (link.dataset.external) {
    window.open(link.dataset.external, '_blank')
    return
  }

  // 内部链接
  const pageName = link.dataset.page
  if (pageName) {
    navigateToPage(pageName)
  }
}
```

- [ ] **Step 4: 在 block-text 的 div 上绑定 @click 事件**

修改模板中的 block-text div：

```vue
<div v-else class="block-text" v-html="renderContent(block.content)" @click="handleContentClick"></div>
```

---

## Task 3: pages.ts — 添加 getPageByTitle 便捷方法

**Files:**
- Modify: `src/stores/pages.ts`

- [ ] **Step 1: 添加 getPageByTitle 方法**

```typescript
function getPage(pageId: string): PageRecord | undefined {
  return pages.value.find(p => p.id === pageId)
}

function getPageByTitle(title: string): PageRecord | undefined {
  return pages.value.find(p => p.title === title)
}

return { pages, currentPageId, loading, loadAllPages, openPage, createPage, getPage, getPageByTitle }
```

---

## Task 4: 验证与测试

**Files:**
- 测试文件：无（Phase 1 暂不要求单元测试）

- [ ] **Step 1: 手动功能验证**

1. 在编辑态输入 `[[测试页面]]`，点击链接：
   - 如果页面存在 → 应跳转到该页面
   - 如果页面不存在 → 应创建新页面并跳转

2. 在展示态点击 `[[测试页面]]` 链接：
   - 同样的跳转逻辑

3. 验证外部链接 `[[https://example.com]]` 在新标签页打开

---

## 依赖关系

```
Task 3 (pages.ts) ──┐
                    ├──> Task 1 (Editor.vue)
Task 2 (Block.vue) ─┴──> Task 4 (验证)
```

---

## 注意事项

1. **XSS 防护**：`renderContent` 中的 `escapeHtml(target)` 确保 pageName 安全
2. **事件冒泡**：使用 `closest('.block-link')` 确保点击子元素也能正确捕获
3. **编辑态退出**：点击链接跳转时，应先 deactivate 当前 Block
4. **别名链接**：`[[目标|别名]]` 导航时使用 `目标`（target）而非 `别名`（display）
