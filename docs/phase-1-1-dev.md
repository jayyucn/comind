# Phase 1.1 开发文档

> 版本：v0.2
> 日期：2026-04-24
> 状态：开发中
> 关联文档：[phase-1-1-plan.md](./phase-1-1-plan.md)

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

---

## 2. 架构设计

### 2.1 视图状态

```typescript
// src/types/view.ts
export type AppView = 'editor' | 'journal-list'
```

**App.vue 状态管理：**
```typescript
const currentView = ref<AppView>('editor')
const currentJournalPageId = ref<string>() // 从列表进入时记录，用于返回
```

**视图切换规则：**
| 触发 | 动作 | 结果 |
|------|------|------|
| 点击 Sidebar Journal Card | `journal.openJournalList()` | `currentView = 'journal-list'` |
| 点击日记标题 | `journal.openJournal(pageId)` | `currentView = 'editor'`，打开对应 Page |
| 点击返回按钮 | `journal.closeJournalList()` | `currentView = 'editor'`，恢复之前页面 |

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
│ ← 返回    日记列表                            [2026-04] ▼  │  ← Header
├────────────────────────────────────────────────────────────┤
│                                                            │
│  📅 2026-04-23  周四                              今天     │  ← 日期标题（可点击）
│  ┌──────────────────────────────────────────────────────┐  │
│  │                                                      │  │
│  │  [日记内容 Block 列表 - 可直接编辑]                   │  │  ← 内容区（内联编辑）
│  │                                                      │  │
│  │  • 第一条 Block                                      │  │
│  │    • 子 Block                                        │  │
│  │  • 第二条 Block                                      │  │
│  │                                                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  📅 2026-04-22  周三                                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  [日记内容 Block 列表 - 可直接编辑]                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 3.2 组件设计

**文件：** `src/components/Journal/JournalListView.vue`

```vue
<template>
  <div class="journal-list-view">
    <!-- Header -->
    <header class="journal-header">
      <button class="back-btn" @click="goBack">
        <span class="back-icon">←</span>
        <span>返回</span>
      </button>
      <h1 class="journal-title">日记列表</h1>
      <div class="month-picker">
        <button class="month-btn" @click="prevMonth">◀</button>
        <span class="month-label">{{ monthLabel }}</span>
        <button class="month-btn" @click="nextMonth">▶</button>
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
        <!-- 日期标题（点击跳转独立页面） -->
        <header 
          class="entry-header" 
          @click="openJournalPage(journal.id)"
        >
          <span class="entry-icon">📅</span>
          <span class="entry-date">{{ journal.title }}</span>
          <span class="entry-weekday">{{ getWeekday(journal.title) }}</span>
          <span v-if="journal.title === today" class="today-badge">今天</span>
        </header>

        <!-- 内容区：内联 Block 列表（可直接编辑） -->
        <div class="entry-content">
          <BlockList 
            :page-id="journal.id"
            :top-level-only="false"
          />
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

.back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  color: var(--link);
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background 80ms;
}
.back-btn:hover { background: var(--bg-hover); }
```

**月份选择器：**
```css
.month-picker {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.month-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-hover);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: background 80ms;
}
.month-btn:hover { background: var(--bg-active); }

.month-label {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  min-width: 80px;
  text-align: center;
}
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
}
```

### 3.4 月份筛选器

**实现：** 使用 `date-fns` 处理月份切换

```typescript
import { startOfMonth, subMonths, addMonths, format } from 'date-fns'

const currentMonth = ref<Date>(startOfMonth(new Date()))

const monthLabel = computed(() => format(currentMonth.value, 'yyyy-MM'))

const filteredJournals = computed(() => {
  const monthStr = format(currentMonth.value, 'yyyy-MM')
  return journalPages.value.filter(p => p.title.startsWith(monthStr))
})

function prevMonth() {
  currentMonth.value = subMonths(currentMonth.value, 1)
}

function nextMonth() {
  currentMonth.value = addMonths(currentMonth.value, 1)
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

  function closeJournalList() {
    isOpen.value = false
  }

  async function openJournal(pageId: string) {
    const page = pageStore.getPage(pageId)
    if (!page) return

    const isToday = page.title === today.value
    isReadOnly.value = !isToday

    await pageStore.openPage(pageId)
    closeJournalList()
  }

  async function createTodayJournal() {
    const existing = journalPages.value.find(p => p.title === today.value)
    if (existing) {
      await pageStore.openPage(existing.id)
      closeJournalList()
      return
    }

    const newPage = await pageStore.createPage(today.value)
    
    await blockStore.createBlock({
      pageId: newPage.id,
      content: today.value,
      parentId: null,
    })
    
    await pageStore.openPage(newPage.id)
    closeJournalList()
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
    closeJournalList,
    openJournal,
    createTodayJournal,
    checkAndCreateTodayJournal,
  }
}
```

---

## 6. App.vue 集成

### 6.1 视图状态管理

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import type { AppView } from './types/view'
import { useJournal } from './composables/useJournal'
// ... 其他 imports

const journal = useJournal()
const currentView = ref<AppView>('editor')
const currentJournalPageId = ref<string>()

// 监听 journal.isOpen 变化，同步视图状态
watch(() => journal.isOpen.value, (open) => {
  if (open) {
    currentView.value = 'journal-list'
  } else {
    currentView.value = 'editor'
  }
})
</script>

<template>
  <div class="app-layout">
    <Sidebar />

    <div class="page-scroll-wrapper">
      <div class="page-body">
        <main class="main-content">
          <!-- 编辑视图 -->
          <template v-if="currentView === 'editor'">
            <div class="page-header">...</div>
            <div class="block-list">...</div>
          </template>

          <!-- Journal 列表视图 -->
          <JournalListView
            v-else-if="currentView === 'journal-list'"
            @open-page="(id) => { currentJournalPageId = id; journal.openJournal(id) }"
          />
        </main>

        <!-- Backlinks 只在编辑视图显示 -->
        <Backlinks v-if="currentView === 'editor'" />
      </div>
    </div>
  </div>
</template>
```

### 6.2 SidebarJournal 组件

**文件：** `src/components/Sidebar/SidebarJournal.vue`

```vue
<script setup lang="ts">
import { useJournal } from '../../composables/useJournal'

const { today, todayJournalExists, openJournalList, createTodayJournal } = useJournal()

async function handleClick() {
  if (todayJournalExists.value) {
    openJournalList()
  } else {
    await createTodayJournal()
  }
}
</script>

<template>
  <div class="journal-hero" @click="handleClick">
    <div class="journal-content">
      <div class="journal-icon">📓</div>
      <div class="journal-text">
        <div class="journal-title">今日日记</div>
        <div class="journal-date">{{ today }}</div>
      </div>
    </div>
    <div class="journal-arrow">
      <span>→</span>
    </div>
  </div>
</template>
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
├── components/
│   ├── Journal/
│   │   └── JournalListView.vue      # 新增：日记列表主视图
│   ├── BlockList.vue                 # 新增：可复用的 Block 列表
│   └── Sidebar/
│       └── SidebarJournal.vue        # 修改：点击触发 journal.openJournalList()
├── composables/
│   └── useJournal.ts                 # 已有，确认 isOpen 与 App.vue 联动
├── types/
│   └── view.ts                       # 新增：AppView 类型定义
├── App.vue                           # 修改：视图状态管理 + JournalListView 集成
└── main.ts                           # 修改：注册 date-fns（如未安装）
```

---

## 9. 依赖

```bash
npm install date-fns
```

---

## 10. 实现优先级

| 优先级 | 任务 | 预估 | 说明 |
|--------|------|------|------|
| P0 | `types/view.ts` + `BlockList.vue` | 1h | 基础组件提取 |
| P0 | `JournalListView.vue` 组件 | 4h | 核心功能 |
| P0 | App.vue 视图切换集成 | 1.5h | 状态联动 |
| P0 | `SidebarJournal.vue` 触发逻辑 | 0.5h | 入口联动 |
| P1 | 月份筛选器（date-fns） | 2h | 可用性增强 |
| P2 | 动效优化（entry 展开/折叠） | 2h | 体验优化 |

---

## 11. 验收标准

| 功能 | 验收标准 |
|------|----------|
| 入口 | 点击 Sidebar Journal Card 打开 Journal 列表视图 |
| 列表显示 | 显示当月所有日记，按日期倒序排列 |
| 内联编辑 | 可在 Journal 列表中直接编辑任意日记内容 |
| 单编辑器原则 | 同一时间只有一个 Block 处于编辑态 |
| 标题导航 | 点击日记标题跳转到该日记独立页面 |
| 返回 | 点击返回按钮回到 Journal 列表 |
| 月份切换 | 左右箭头可切换月份，列表实时更新 |
| 今天高亮 | 今天日记条目有特殊样式标识 |
| Backlinks | Journal 列表视图不显示 Backlinks |

---

*文档 v0.2，开发中。*
