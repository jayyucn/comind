# Phase 1.1 开发文档

> 版本：v0.6
> 日期：2026-04-26
> 状态：开发中
> 关联文档：[phase-1-1-plan.md](./phase-1-1-plan.md)、[routing-design.md](./routing-design.md)

---

## 1. 概述

本文档定义 Phase 1.1 中 Journal（日记流）功能的详细实现规范。

**关联规划：**
- 对应 [phase-1-1-plan.md](./phase-1-1-plan.md) §3.2 Journal（日记流）
- 依赖 [ui-ux-spec.md](./ui-ux-spec.md) §Sidebar / §Journal Section

**核心设计：**
- Journal 列表作为右侧内容区的**独立视图**
- 与 Page 编辑视图平级，通过 App.vue 的 view 状态切换
- 列表中每个日记条目**直接显示完整内容**，支持**内联编辑**
- 点击日记标题导航到该日记的独立页面视图
- **与 Page.vue 的区别：** 只有标题是否可编辑和页面高度（日记列表项标题不可编辑，高度根据内容自动调整）

---

## 2. 架构设计

### 2.1 路由设计

> 详见 [routing-design.md](./routing-design.md) §3 路由设计。

Phase 1.1 采用 vue-router（history 模式），URL 是视图状态的唯一来源。

**路由表：**

| 路由 | URL 示例 | 视图 |
|------|----------|------|
| 首页重定向 | `/` | → `/journal` |
| 日记列表 | `/journal` | JournalView |
| 日记正文 | `/journal/:date` | PageView |
| 普通页面 | `/page/:pageId` | PageView |

**App.vue 不再持有视图状态** — `currentView` ref 删除，视图由 `<RouterView>` 渲染。

### 2.2 状态管理原则

```
URL 变化 → Router → beforeEach 守卫加载 Page 数据 → RouterView 渲染对应组件
```

| 操作 | 导航方式 |
|------|----------|
| Sidebar Journal 点击 | `router.push('/journal')` |
| Sidebar Recent 页面点击 | `router.push('/page/${pageId}')` |
| [[WikiLink]] 点击 | `router.push('/page/${pageId}')` |
| 日记列表条目点击 | `router.push('/journal/${date}')` |

`pageStore.openPage(id)` 保留，负责设置 `currentPageId` + 加载 Blocks，**不负责视图切换**。

### 2.2 与 Logseq 对照

| 功能 | Logseq | comind |
|------|--------|--------|
| Journal 入口 | 左侧边栏 Journal 按钮 | Sidebar Journal Hero Card |
| Journal 列表展示 | 主内容区连续时间线 | 主内容区独立视图 |
| 内容编辑 | 内联编辑 | 内联编辑 |
| 日记查看 | 点击条目跳转 | 点击标题跳转独立页面 |

---

## 3. Journal 列表视图

### 3.1 布局结构

```
┌────────────────────────────────────────────────────────────┐
│    日记列表                               📅 2026-04 ▼│  ← Header
├────────────────────────────────────────────────────────────┤
│                                                            │
│  📅 2026-04-23  周四                              今天     │  ← 日期标题（可点击）
│  ┌──────────────────────────────────────────────────────┐  │
│  │  [日记内容 Block 列表 - 高度根据内容自动扩展]          │  │  ← 内容区（内联编辑）
│  │  • 第一条 Block                                      │  │
│  │    • 子 Block                                        │  │
│  │  • 第二条 Block                                      │  │
│  │                                                      │  │
│  │  [Backlinks - 与 Page.vue 相同]                     │  │
│  │  [TagFilterPanel - 与 Page.vue 相同]                │  │
│  │  [SlashCommandMenu - 与 Page.vue 相同]             │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  📅 2026-04-22  周三                                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  [日记内容 Block 列表 - 高度根据内容自动扩展]          │  │
│  │  [Backlinks - 与 Page.vue 相同]                     │  │
│  │  [TagFilterPanel - 与 Page.vue 相同]                │  │
│  │  [SlashCommandMenu - 与 Page.vue 相同]             │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 3.2 组件设计

**文件：** `src/components/Journal/JournalList.vue`

```vue
<template>
  <div class="journal-list-view">
    <!-- Header -->
    <header class="journal-header">
      <h1 class="journal-title">日记列表</h1>
      <div class="date-picker">
        <input
          type="month"
          class="month-input"
          :value="monthValue"
          @input="onMonthChange"
        />
      </div>
    </header>

    <!-- 日记条目列表 -->
    <div class="journal-entries">
      <article
        v-for="journal in filteredJournals"
        :key="journal.id"
        class="journal-entry"
        :class="{ 'is-today': journal.title === today }"
      >
        <!-- 日期标题（点击跳转独立页面，不可编辑） -->
        <header
          class="entry-header"
          @click="openJournalPage(journal.id)"
        >
          <span class="entry-icon">📅</span>
          <span class="entry-date">{{ journal.title }}</span>
          <span class="entry-weekday">{{ getWeekday(journal.title) }}</span>
          <span v-if="journal.title === today" class="today-badge">今天</span>
        </header>

        <!-- 内容区：内联 Block 列表（高度根据内容自动扩展） -->
        <div class="entry-content">
          <BlockList
            :page-id="journal.id"
            :top-level-only="false"
          />
          
          <!-- 与 Page.vue 相同的组件 -->
          <Backlinks :page-id="journal.id" />
          <TagFilterPanel :page-id="journal.id" />
          <SlashCommandMenu />
        </div>
      </article>
    </div>
  </div>
</template>
```

### 3.3 样式规范

**容器：**
```css
.journal-list-view {
  max-width: 800px;
  width: 100%;
  margin: 0 auto;
  padding: var(--space-8) 48px;
  box-sizing: border-box;
}
```

**Header：**
```css
.journal-header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}

.journal-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  flex: 1;
}
```

**月份选择器（日期选择器）：**
```css
.date-picker {
  display: flex;
  align-items: center;
}

.month-input {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  cursor: pointer;
  transition: border-color 80ms;
}
.month-input:hover { border-color: var(--border-active); }
.month-input:focus { outline: none; border-color: var(--accent); }
```

**日记条目：**
```css
.journal-entry {
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: var(--space-4);
  overflow: hidden;
}

.journal-entry.is-today {
  border-color: var(--accent);
  background: var(--accent-subtle);
}

.entry-header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-hover);
  cursor: pointer;
  transition: background 80ms;
}
.entry-header:hover { background: var(--bg-active); }

.entry-date {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.entry-weekday {
  font-size: 13px;
  color: var(--text-secondary);
}

.today-badge {
  font-size: 12px;
  padding: 2px 8px;
  background: var(--accent);
  color: white;
  border-radius: 10px;
  margin-left: auto;
}

.entry-content {
  padding: var(--space-3) var(--space-4) var(--space-4);
  height: auto;
  min-height: 0;
}

/* 与 Page.vue 相同的组件样式 */
.entry-content .backlinks,
.entry-content .tag-filter-panel,
.entry-content .slash-command-menu {
  margin-top: var(--space-4);
  border-top: 1px solid var(--border);
  padding-top: var(--space-3);
}
```

### 3.4 日期筛选器

**实现：** 使用原生 `type="month"` 的 `<input>` 元素，配合 `date-fns` 处理筛选逻辑。

```typescript
import { startOfMonth, format, parse } from 'date-fns'

const currentMonth = ref<Date>(startOfMonth(new Date()))

const monthValue = computed(() => format(currentMonth.value, 'yyyy-MM'))

const filteredJournals = computed(() => {
  const monthStr = monthValue.value
  return journalPages.value.filter(p => p.title.startsWith(monthStr))
})

function onMonthChange(e: Event) {
  const value = (e.target as HTMLInputElement).value
  currentMonth.value = parse(value, 'yyyy-MM', new Date())
}
```

---

## 4. BlockList 组件

**文件：** `src/components/BlockList.vue`

提取现有 Block 渲染逻辑，供 Journal 列表复用。

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useBlockStore } from '../stores/blocks'
import Block from './Block.vue'

const props = defineProps<{
  pageId: string
  topLevelOnly?: boolean
}>()

const blockStore = useBlockStore()

const blocks = computed(() => {
  let list = blockStore.blocks.filter(b => b.pageId === props.pageId)
  if (props.topLevelOnly) {
    list = list.filter(b => b.parentId === null)
  }
  return list.sort((a, b) => a.left - b.left)
})
</script>

<template>
  <div class="block-list">
    <Block
      v-for="block in blocks"
      :key="block.id"
      :block-id="block.id"
      :block="block"
    />
  </div>
</template>
```

---

## 5. useJournal 组合式函数

**文件：** `src/composables/useJournal.ts`

```typescript
import { ref, computed } from 'vue'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'

// 判断 Page 是否为日记（标题符合日期格式 YYYY-MM-DD）
function isJournalPage(page: any): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(page.title)
}

export function useJournal() {
  const pageStore = usePageStore()
  const blockStore = useBlockStore()
  
  // ===== 视图状态 =====
  const isOpen = ref(false)
  
  // ===== Session 级状态 =====
  const createdTodayThisSession = ref(false)
  
  // ===== readOnly 模式 =====
  const isReadOnly = ref(false)

  // ===== 计算属性 =====
  const today = computed(() => {
    return new Date().toISOString().slice(0, 10)
  })

  const journalPages = computed(() => {
    return pageStore.pages
      .filter(isJournalPage)
      .sort((a, b) => b.title.localeCompare(a.title))
  })

  const todayJournalExists = computed(() => {
    return journalPages.value.some(p => p.title === today.value)
  })

  // ===== 方法 =====
  function openJournalList() {
    isOpen.value = true
  }

  async function openJournal(pageId: string) {
    const page = pageStore.getPage(pageId)
    if (!page) return

    const isToday = page.title === today.value
    isReadOnly.value = !isToday

    await pageStore.openPage(pageId)
  }

  async function createTodayJournal() {
    const existing = journalPages.value.find(p => p.title === today.value)
    if (existing) {
      await pageStore.openPage(existing.id)
      return
    }

    const newPage = await pageStore.createPage(today.value)
    
    await blockStore.createBlock({
      pageId: newPage.id,
      content: today.value,
      parentId: null,
    })
    
    await pageStore.openPage(newPage.id)
  }

  async function checkAndCreateTodayJournal() {
    if (createdTodayThisSession.value) return
    createdTodayThisSession.value = true

    if (!todayJournalExists.value) {
      await createTodayJournal()
    }
  }

  return {
    isOpen: computed(() => isOpen.value),
    isReadOnly: computed(() => isReadOnly.value),
    today,
    journalPages,
    todayJournalExists,
    openJournalList,
    openJournal,
    createTodayJournal,
    checkAndCreateTodayJournal,
  }
}
```

---

## 6. App.vue 集成

### 6.1 Router 注册

```typescript
// main.ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './style.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)    // ← 新增
app.mount('#app')
```

### 6.2 App.vue

```vue
<script setup lang="ts">
import Sidebar from './components/Sidebar/index.vue'
// 移除 currentView ref 和 view.ts
</script>

<template>
  <div class="app-layout">
    <Sidebar />
    <div class="page-scroll-wrapper">
      <div class="page-body">
        <main class="main-content">
          <RouterView />
        </main>
      </div>
    </div>
  </div>
</template>
```

### 6.3 router/index.ts

```typescript
// src/router/index.ts
import { createRouter, createWebHistory } from 'vue-router'
import routes from './routes'
import { usePageStore } from '../stores/pages'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 全局守卫：所有路由切换前确保 Page 数据已加载
router.beforeEach(async () => {
  const pageStore = usePageStore()
  if (pageStore.pages.length === 0) {
    await pageStore.loadAllPages()
  }
})

export default router
```

### 6.4 router/routes.ts

```typescript
// src/router/routes.ts
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/journal' },
  {
    path: '/journal',
    name: 'journal-list',
    component: () => import('../views/JournalView.vue'),
  },
  {
    path: '/journal/:date',
    name: 'journal-page',
    component: () => import('../views/PageView.vue'),
  },
  {
    path: '/page/:pageId',
    name: 'page',
    component: () => import('../views/PageView.vue'),
  },
  // 404 兜底
  { path: '/:pathMatch(.*)*', redirect: '/journal' },
]

export default routes
```

### 6.5 SidebarJournal 组件

**改造前：**
```typescript
const { openJournalList } = useJournal()
function handleClick() { openJournalList() }
```

**改造后：**
```typescript
import { useRouter } from 'vue-router'
const router = useRouter()
function handleClick() { router.push('/journal') }
```

### 6.6 useNavigateToPage.ts

**改造前：**
```typescript
await pageStore.openPage(pageId)
currentView.value = 'editor'
```

**改造后：**
```typescript
router.push(`/page/${pageId}`)
```

---

## 7. 编辑器焦点管理

**原则：** 全局仍只有一个 `activeBlockId`，但支持跨日记定位。

```typescript
// stores/editor.ts
export const useEditorStore = defineStore('editor', () => {
  const activeBlockId = ref<string | null>(null)
  
  // 当前激活的 Block 属于哪个日记
  const activeJournalId = computed(() => {
    if (!activeBlockId.value) return undefined
    const block = blockStore.getBlock(activeBlockId.value)
    return block?.pageId
  })
  
  function activateBlock(blockId: string, cursorPosition?: number) {
    // 先失活之前的 Block
    if (activeBlockId.value && activeBlockId.value !== blockId) {
      deactivateBlock()
    }
    activeBlockId.value = blockId
    // ... 聚焦逻辑
  }
  
  return { activeBlockId, activeJournalId, activateBlock, deactivateBlock }
})
```

---

## 8. 文件变更清单

```
src/
├── router/                           # 新增
│   ├── index.ts                     # router 实例 + beforeEach 守卫
│   └── routes.ts                    # 路由定义
├── views/                            # 新增（由现有组件改名）
│   ├── JournalView.vue               # 改名自 JournalList.vue
│   └── PageView.vue                  # 改名自 Page/index.vue
└── types/
    └── view.ts                       # 删除（AppView 不再需要）

src/ （导航改造）
├── App.vue                           # 移除 currentView，替换为 <RouterView>
├── main.ts                           # 注册 router plugin
├── components/
│   └── Sidebar/
│       ├── SidebarContainer.vue     # 移除 handleNavigate 中的 store.openPage
│       └── SidebarJournal.vue        # router.push('/journal')
├── composables/
│   └── useNavigateToPage.ts         # router.push() 替代 store.openPage
└── stores/
    └── pages.ts                      # 恢复 loadAllPages（由 beforeEach 调用）
```

---

## 9. 依赖

```bash
npm install vue-router date-fns
```

---

## 10. 实现优先级

| 优先级 | 任务 | 预估 | 说明 |
|--------|------|------|------|
| P0 | `types/view.ts` + `BlockList.vue` | 1h | 基础组件提取 |
| P0 | `JournalList.vue` 组件 | 4h | 核心功能 |
| P0 | App.vue 视图切换集成 | 1.5h | 状态联动 |
| P0 | `SidebarJournal.vue` 触发逻辑 | 0.5h | 入口联动 |
| P1 | 日期筛选器（原生 month input） | 1h | 使用原生日期选择器 |
| P2 | 动效优化（entry 展开/折叠） | 2h | 体验优化 |

---

## 11. 验收标准

### Journal 功能

| 功能 | 验收标准 |
|------|----------|
| 入口 | 点击 Sidebar Journal Card → URL 变为 `/journal` |
| 列表显示 | 显示当月所有日记，按日期倒序排列 |
| 内联编辑 | 可在 Journal 列表中直接编辑任意日记内容 |
| 单编辑器原则 | 同一时间只有一个 Block 处于编辑态 |
| 标题导航 | 点击日记标题 URL 变为 `/journal/:date` |
| 日期筛选 | 使用日期选择器筛选月份，列表实时更新 |
| 今天高亮 | 今天日记条目有特殊样式标识 |
| Backlinks | Journal 列表视图显示与 PageView 相同的 Backlinks |
| TagFilterPanel | Journal 列表视图显示与 PageView 相同的 TagFilterPanel |
| SlashCommandMenu | Journal 列表视图显示与 PageView 相同的 SlashCommandMenu |

### 路由功能

| 功能 | 验收标准 |
|------|----------|
| URL 正确 | 日记列表 `/journal`，日记正文 `/journal/:date`，普通页面 `/page/:pageId` |
| 刷新恢复 | 在 `/page/abc` 刷新页面，仍停留在 `/page/abc`，数据完整 |
| 分享可用 | 复制的 URL 打开后直接进入对应视图 |
| Back/Forward | 浏览器 back/forward 按钮切换视图，不丢状态 |
| 404 优雅 | 访问不存在的 `/page/xxx` 不会崩溃，重定向到 `/journal` |
| 无回归 | Sidebar Journal/Recent、WikiLink 导航、SlashCommand 导航均正常 |

---

*文档 v0.6，开发中。*
