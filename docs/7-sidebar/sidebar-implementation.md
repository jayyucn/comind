# Sidebar 组件实现方案

> 版本：v1.0（Ideas v0.8.1 行为调整）
> 日期：2026-04-23

---

## 1. 文件结构

```
src/
├── components/
│   └── Sidebar/
│       ├── index.vue                # 导出入口（= SidebarContainer）
│       ├── SidebarContainer.vue     # 主容器
│       ├── SidebarHeader.vue        # Logo + 折叠
│       ├── SidebarIdeas.vue       # Ideas Hero Card
│       ├── SidebarRecent.vue        # Recent Section
│       ├── SidebarFavorites.vue     # Favorites Section
│       ├── SidebarFooter.vue        # 快捷键提示
│       └── PageItem.vue             # 共用 Page 项
└── composables/
    ├── useSidebar.ts                # 折叠状态
    ├── useRecent.ts                 # 最近页面
    ├── useFavorites.ts              # 收藏状态
    └── useIdeas.ts                # 点滴逻辑
```

---

## 2. Composables 接口

### 2.1 useSidebar

```typescript
// composables/useSidebar.ts
import { ref, computed } from 'vue'

const isCollapsed = ref(false)

export function useSidebar() {
  function toggle() {
    isCollapsed.value = !isCollapsed.value
  }

  function collapse() {
    isCollapsed.value = true
  }

  function expand() {
    isCollapsed.value = false
  }

  return {
    isCollapsed: computed(() => isCollapsed.value),
    toggle,
    collapse,
    expand,
  }
}
```

**状态持久化：** 不持久化（每次打开恢复展开状态）

---

### 2.2 useRecent

```typescript
// composables/useRecent.ts
import { computed, ref } from 'vue'
import { usePageStore } from '../stores/pages'

export function useRecent() {
  const pageStore = usePageStore()
  const isExpanded = ref(false)

  // 按 Page.updatedAt 降序排列
  const recentPages = computed(() => {
    return [...pageStore.pages]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, isExpanded.value ? 10 : 3)
  })

  function toggleExpand() {
    isExpanded.value = !isExpanded.value
  }

  return {
    recentPages,
    isExpanded: computed(() => isExpanded.value),
    toggleExpand,
  }
}
```

**排序规则：** 按 `Page.updatedAt` 降序，不考虑 Block 级联更新

---

### 2.3 useFavorites

```typescript
// composables/useFavorites.ts
import { ref, computed, watch, onMounted } from 'vue'
import { usePageStore } from '../stores/pages'

const STORAGE_KEY = 'comind:favorites'

// 全局状态（模块级单例）
const favoriteIds = ref<string[]>([])

export function useFavorites() {
  const pageStore = usePageStore()

  // 初始化：从 LocalStorage 加载
  onMounted(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      try {
        favoriteIds.value = JSON.parse(stored)
      } catch {
        favoriteIds.value = []
      }
    }
  })

  // 持久化：变化时写入
  watch(favoriteIds, (ids) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  }, { deep: true })

  // 收藏的 Page 列表（按收藏顺序）
  const favoritePages = computed(() => {
    return favoriteIds.value
      .map(id => pageStore.getPage(id))
      .filter(Boolean) as PageRecord[]
  })

  function isFavorite(pageId: string): boolean {
    return favoriteIds.value.includes(pageId)
  }

  function addFavorite(pageId: string) {
    if (!favoriteIds.value.includes(pageId)) {
      favoriteIds.value.push(pageId)
    }
  }

  function removeFavorite(pageId: string) {
    const index = favoriteIds.value.indexOf(pageId)
    if (index > -1) {
      favoriteIds.value.splice(index, 1)
    }
  }

  function toggleFavorite(pageId: string) {
    if (isFavorite(pageId)) {
      removeFavorite(pageId)
    } else {
      addFavorite(pageId)
    }
  }

  return {
    favoritePages,
    isFavorite,
    addFavorite,
    removeFavorite,
    toggleFavorite,
  }
}
```

**LocalStorage Key：** `comind:favorites`
**数据格式：** `string[]`（Page ID 数组，按收藏顺序）

---

### 2.4 useIdeas

```typescript
// composables/useIdeas.ts
import { ref, computed } from 'vue'
import { usePageStore } from '../stores/pages'
import { useBlockStore } from '../stores/blocks'

// 判断 Page 是否为点滴（标题符合日期格式 YYYY-MM-DD）
function isIdeasPage(page: PageRecord): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(page.title)
}

export function useIdeas() {
  const pageStore = usePageStore()
  const blockStore = useBlockStore()
  const isOpen = ref(false)  // 点滴列表 Panel 展开状态

  // 今天的日期字符串（YYYY-MM-DD）
  const today = computed(() => {
    return new Date().toISOString().slice(0, 10)
  })

  // 所有点滴 Page（按日期倒序）
  const IdeasPages = computed(() => {
    return pageStore.pages
      .filter(isIdeasPage)
      .sort((a, b) => b.title.localeCompare(a.title))  // 日期倒序
  })

  // 今天的点滴是否已存在
  const todayIdeasExists = computed(() => {
    return IdeasPages.value.some(p => p.title === today.value)
  })

  // ===== Session 级状态 =====
  // App 运行时标记：今天是否已处理过创建检查
  // 关闭 APP 后重开，状态重置，符合"首次访问"直觉
  const createdTodayThisSession = ref(false)

  // 检查并创建今天点滴（Session 级，只触发一次）
  async function checkAndCreateTodayIdeas() {
    if (createdTodayThisSession.value) return  // 已处理过
    createdTodayThisSession.value = true

    // 今天点滴不存在 → 创建
    if (!todayIdeasExists.value) {
      await createTodayIdeas()
    }
  }

  // ===== readOnly 模式 =====
  // 当前打开的点滴是否为只读（过往点滴）
  const isReadOnly = ref(false)

  // 打开点滴列表 Panel
  function openIdeasList() {
    isOpen.value = true
  }

  // 关闭点滴列表 Panel
  function closeIdeasList() {
    isOpen.value = false
  }

  // 打开指定点滴（若不存在则创建，仅当天可写）
  async function openIdeas(pageId: string) {
    const page = pageStore.getPage(pageId)
    if (!page) return

    const isToday = page.title === today.value

    // 设置 readOnly 模式：过往点滴不可编辑
    isReadOnly.value = !isToday

    // 今天 → 可编辑 | 过往 → 只读（仍打开，但不进入编辑状态）
    await pageStore.openPage(pageId)

    closeIdeasList()
  }

  // 创建今天点滴（仅当天可创建）
  async function createTodayIdeas() {
    // 检查是否已存在
    const existing = IdeasPages.value.find(p => p.title === today.value)
    if (existing) {
      await pageStore.openPage(existing.id)
      closeIdeasList()
      return
    }

    // 创建新点滴 Page
    const newPage = await pageStore.createPage(today.value)
    
    // 注入模板：第一个 Block 为日期
    await blockStore.createBlock({
      pageId: newPage.id,
      content: today.value,
      parentId: null,
    })
    
    await pageStore.openPage(newPage.id)
    closeIdeasList()
  }

  return {
    isOpen: computed(() => isOpen.value),
    isReadOnly: computed(() => isReadOnly.value),
    today,
    IdeasPages,
    todayIdeasExists,
    openIdeasList,
    closeIdeasList,
    openIdeas,
    createTodayIdeas,
    checkAndCreateTodayIdeas,
  }
}
```

**行为规则：**
- 标题固定为日期（YYYY-MM-DD），不可修改
- 只能创建当天点滴（today）
- 过往点滴不可编辑（只读）

**App.vue 初始化调用**：
```typescript
// App.vue onMounted
const Ideas = useIdeas()
Ideas.checkAndCreateTodayIdeas()
```

**Editor 组件响应 readOnly**：
```typescript
// Editor.vue
const Ideas = useIdeas()
const showReadOnlyOverlay = computed(() => Ideas.isReadOnly.value)
```

---

### 2.5 Page.updatedAt 同步更新

Block 内容变更时，需同步更新所属 Page 的 `updatedAt`。

**stores/blocks.ts — updateBlockContent 末尾添加**：
```typescript
// 找到对应的 Page，更新 Page.updatedAt
const page = pages.value.find(p => p.id === block.pageId)
if (page) {
  page.updatedAt = Date.now()
  await storage.updatePage(page)
}
```

**storage/indexedDB.ts — 新增方法**：
```typescript
async function updatePage(page: PageRecord): Promise<void> {
  const tx = db.transaction('pages', 'readwrite')
  const store = tx.objectStore('pages')
  await store.put(page)
  await tx.done
}
```

---

## 3. 组件 Props 接口

### 3.1 PageItem.vue

```typescript
// 共用 Page 项组件
interface Props {
  page: PageRecord          // Page 数据
  active?: boolean          // 是否当前页面
  showTime?: boolean        // 是否显示时间（默认 true）
  timeFormat?: 'relative' | 'absolute'  // 时间格式
}

interface Emits {
  (e: 'click'): void        // 点击事件
}
```

**样式：**
- height: 32px
- padding: 4px 8px
- radius: 5px
- active: 左 2px accent 竖条

---

### 3.2 SidebarIdeas.vue

```typescript
// Ideas Hero Card
interface Props {
  // 无 props，内部使用 useIdeas
}

interface Emits {
  (e: 'navigate', pageId: string): void   // 导航到今日点滴
  (e: 'create-today'): void              // 创建今日点滴
}
```

**行为说明：** 内部调用 `useIdeas()` 获取状态，点击事件通过 emit 向上冒泡给 `SidebarContainer` 统一处理导航和创建逻辑。

**样式：**
- height: 80px
- background: --accent-subtle
- radius: 8px
- hover: 背景 #FEF0C0，箭头右移
- active: scale(0.96)

---

### 3.3 SidebarRecent.vue

```typescript
// Recent Section
interface Props {
  // 无 props，内部使用 useRecent + usePageStore
}

interface Emits {
  (e: 'navigate', pageId: string): void  // 导航到页面
}
```

---

### 3.4 SidebarFavorites.vue

```typescript
// Favorites Section
interface Props {
  // 无 props，内部使用 useFavorites + usePageStore
}

interface Emits {
  (e: 'navigate', pageId: string): void       // 导航到页面
  (e: 'add-favorite'): void                   // 打开添加收藏面板
}
```

---

### 3.5 SidebarHeader.vue

```typescript
// Header
interface Props {
  // 无 props
}

interface Emits {
  (e: 'toggle-collapse'): void  // 切换折叠
}
```

---

## 4. 状态流

```
┌─────────────────────────────────────────────────────────────┐
│                      SidebarContainer                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ SidebarHeader                                        │   │
│  │   └─ useSidebar().toggle()                           │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ SidebarIdeas                                       │   │
│  │   └─ useIdeas().openTodayIdeas()                 │   │
│  │        └─ pageStore.createPage() / openPage()        │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ SidebarRecent                                        │   │
│  │   └─ useRecent().recentPages                         │   │
│  │        └─ pageStore.pages (sorted by updatedAt)      │   │
│  │   └─ @navigate → pageStore.openPage()                │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ SidebarFavorites                                     │   │
│  │   └─ useFavorites().favoritePages                    │   │
│  │        └─ LocalStorage 'comind:favorites'            │   │
│  │   └─ @add-favorite → CommandPalette(mode='page-select')│  │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ SidebarFooter                                        │   │
│  │   └─ 静态提示 "Ctrl+K · 命令与搜索"                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Ctrl+K 模式扩展

当前 `SlashCommandMenu.vue` 仅支持命令模式。需扩展支持页面选择模式。

### 5.1 模式定义

```typescript
// types/command-palette.ts
export type CommandPaletteMode = 'command' | 'page-select'

export interface CommandPaletteProps {
  mode: CommandPaletteMode
  targetRef?: { x: number; y: number }  // 定位（可选）
  onSelect?: (result: Command | PageRecord) => void  // 选择回调
}
```

### 5.2 触发方式

| 模式 | 触发 | 内容 |
|------|------|------|
| command | Ctrl+K / 编辑器内 `/` | 命令列表 |
| page-select | 收藏添加点击 | 页面列表（搜索 + 选择）|

### 5.3 实现方案

**方案 A（推荐）：扩展现有 SlashCommandMenu**

```typescript
// SlashCommandMenu.vue 新增 mode prop
const props = defineProps<{
  mode?: 'command' | 'page-select'
  onSelect?: (result: any) => void
}>()

// 根据 mode 切换数据源
const items = computed(() => {
  if (props.mode === 'page-select') {
    return filterPages(query.value, pageStore.pages)
  } else {
    return filterCommands(query.value, commands)
  }
})
```

**方案 B（备选）：独立 PageSelectPanel**

如果扩展复杂度高，可新建 `PageSelectPanel.vue` 复用 SlashCommandMenu 的 UI 结构。

---

## 6. 迁移步骤

### Step 1：创建目录结构
```bash
mkdir -p src/components/Sidebar
```

### Step 2：实现 Composables
1. `useSidebar.ts`
2. `useRecent.ts`
3. `useFavorites.ts`
4. `useIdeas.ts`

### Step 3：实现组件（自底向上）
1. `PageItem.vue`（共用）
2. `SidebarHeader.vue`
3. `SidebarIdeas.vue`
4. `SidebarRecent.vue`
5. `SidebarFavorites.vue`
6. `SidebarFooter.vue`
7. `SidebarContainer.vue`（组装）
8. `index.vue`（导出）

### Step 4：替换 App.vue 引用
```diff
- import Sidebar from './components/Sidebar.vue'
+ import Sidebar from './components/Sidebar/index.vue'
```

### Step 5：删除旧 Sidebar.vue
```bash
rm src/components/Sidebar.vue
```

### Step 6：扩展 Ctrl+K
1. 修改 `SlashCommandMenu.vue` 支持 `mode` prop
2. 或新建 `PageSelectPanel.vue`

---

## 7. 测试要点

| 测试项 | 验证点 |
|--------|--------|
| Ideas 跳转 | 点击 Card → 打开/创建今日点滴 |
| Recent 排序 | 按 updatedAt 降序，最多 3 条 |
| Recent 展开 | 点击 [▼] → 显示最多 10 条 |
| Favorites 持久化 | 刷新页面后收藏状态保留 |
| Favorites 添加 | 点击 [+ 添加收藏] → 打开页面选择 |
| Sidebar 折叠 | 点击 [◀] → width: 0，主内容区扩展 |
| PageItem active | 当前页面左侧 2px accent 竖条 |

---

## 8. 性能考虑

- **Recent/Favorites 列表**：≤10 项，无需虚拟化
- **收藏持久化**：LocalStorage 同步写入，数据量小（<1KB）
- **折叠动画**：width 过渡 200ms，GPU 加速
