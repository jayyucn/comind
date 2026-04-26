# 路由系统设计方案

> 版本：v0.2
> 日期：2026-04-26
> 状态：**设计稿**
> 关联文档：[SPEC.md](./SPEC.md) §4.2、[data-model.md](./data-model.md) §2.1

---

## 1. 现状与问题

### 1.1 当前架构

`App.vue` 用本地 `ref<AppView>` 状态切换视图，导航完全依赖状态机：

```typescript
// App.vue
const currentView = ref<AppView>('editor')

// 切换方式
if (someCondition) currentView.value = 'journal-list'
if (otherCondition) currentView.value = 'editor'
```

**当前支持的视图：**

| View | 触发 | 渲染组件 |
|------|------|----------|
| `editor` | `pageStore.openPage(id)` | `Page` |
| `journal-list` | `journal.openJournalList()` | `JournalList` |

### 1.2 存在的问题

| # | 问题 | 影响 |
|---|------|------|
| P0 | **无 URL** — 页面刷新后丢失当前视图状态 | 刷新 = 丢位置 |
| P1 | **无法分享链接** — 不能把某个 Page 链接发给同事 | 协作基础缺失 |
| P2 | **浏览器 back/forward 不可用** — popstate 未监听 | 违反浏览器预期 |
| P2 | **视图状态与 Page 数据耦合** — `currentView` 管理在 App.vue，跨组件传参混乱 | 维护性差 |
| P3 | **无嵌套路由** — 未来扩展（如 `/page/:id#block-xxx`）无法支持 | 扩展性差 |

---

## 2. 设计目标

| 目标 | 说明 |
|------|------|
| **URL 即状态** | URL 是视图状态的唯一来源，刷新后可还原 |
| **浏览器历史** | pushState + popstate，back/forward 完全可用 |
| **Deep Link** | 任意 URL 直接打开对应页面 |
| **类型安全** | 路由定义有类型推导，params 访问不错漏 |
| **最小侵入** | 尽量不改现有组件逻辑，只改导航方式 |

---

## 3. 路由设计

### 3.1 路由表

| 路由 | URL 示例 | 视图 | 说明 |
|------|----------|------|------|
| 日记列表 | `/journal` | JournalList | 按月筛选的日记列表 |
| 日记正文 | `/journal/:date` | Page | 打开指定日期的日记（date = `yyyy-MM-dd`），对应 data-model.md §2.1 Page.type = `'journal'` |
| 普通页面 | `/page/:pageId` | Page | 打开指定 Page，对应 data-model.md §2.1 Page.type = `'normal'` |
| 首页重定向 | `/` | → `/journal` | 默认进入日记列表 |

**URL 设计原则：**
- 用真实路径（无 `#` hash），便于分享
- `:date` 和 `:pageId` 均为 URL-safe 字符串
- 日记路径前缀 `/journal/` 与普通页面 `/page/` 语义区分清晰

### 3.2 路由参数

```typescript
// params 类型
'/journal'                    // → { date?: string } （可选，月筛选用）
'/journal/:date'              // → { date: string }
'/page/:pageId'               // → { pageId: string }

// query 参数（可选扩展）
'/page/:pageId?focus=blockId'  // → { pageId: string, focus?: string }
```

### 3.3 404 与未找到

- `/page/:pageId` 但 pageId 不存在 → 导航到 `/journal`，提示"页面不存在"
- `/journal/:date` 但 date 不是有效日期格式 → 导航到 `/journal`
- 未知路由 → 重定向到 `/journal`

---

## 4. 架构设计

### 4.1 技术选型

使用 **vue-router（history 模式）**，符合 SPEC.md §4.2 定义的技术栈。

### 4.2 目录结构

```
src/
├── router/
│   ├── index.ts          # createRouter + createWebHistory 实例
│   └── routes.ts         # 路由定义（静态，类型安全）
├── views/                # 视图层（RouteView 渲染目标）
│   └── PageView.vue      # 改名自 Page/index.vue（语义对齐 RouterView）
├── components/
│   └── Journal/
│       └── JournalList.vue  # 直接作为路由组件使用，不需改名
├── composables/
│   └── useNavigateToPage.ts  # 改造：router.push 替代 store.openPage
├── App.vue               # 改造：<RouterView> 替代 v-if currentView
├── SidebarJournal.vue    # 改造：router.push('/journal') 替代 openJournalList
└── main.ts               # 注册 router plugin
```

**与现有文件对照：**

| 现有文件 | 新文件（同名或改名） | 说明 |
|----------|---------------------|------|
| `components/Journal/JournalList.vue` | 不变，直接作为路由组件 | 路由引用该组件 |
| `components/Page/index.vue` | `views/PageView.vue` | 改名，语义对齐 RouteView |
| `components/BlockList.vue` | 不变 | 被 JournalList/PageView 共用 |
| — | `router/index.ts` | 新增：router 实例 |
| — | `router/routes.ts` | 新增：路由定义 |

### 4.3 核心实现

#### router/routes.ts — 路由定义

```typescript
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/journal',
  },
  {
    path: '/journal',
    name: 'journal-list',
    component: () => import('../components/Journal/JournalList.vue'),
  },
  {
    path: '/journal/:date',
    name: 'journal-page',
    component: () => import('../views/PageView.vue'),
    // 进入时自动加载该日记
    beforeEnter: async (to) => {
      const pageStore = usePageStore()
      await pageStore.loadAllPages()
      const page = pageStore.getPageByTitle(to.params.date as string)
      if (page) {
        await pageStore.openPage(page.id)
      }
    },
  },
  {
    path: '/page/:pageId',
    name: 'page',
    component: () => import('../views/PageView.vue'),
    beforeEnter: async (to) => {
      const pageStore = usePageStore()
      await pageStore.loadAllPages()
      const page = pageStore.getPage(to.params.pageId as string)
      if (page) {
        await pageStore.openPage(page.id)
      }
    },
  },
  // 404 兜底
  {
    path: '/:pathMatch(.*)*',
    redirect: '/journal',
  },
]

export default routes
```

#### router/index.ts — Router 实例

```typescript
import { createRouter, createWebHistory } from 'vue-router'
import routes from './routes'

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
```

**⚠️ 注册顺序约束（SPEC.md §8.1 数据流相关）：**

`app.use(createPinia())` 必须在 `app.use(router)` 之前执行。`router.beforeEach` 守卫内调用 `usePageStore()` 依赖 Pinia 已完成初始化，顺序颠倒会导致 store 调用失败。

#### main.ts — 注册

```typescript
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

#### App.vue — 改造

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
          <!-- 替换 v-if 状态机 -->
          <RouterView />
        </main>
      </div>
    </div>
  </div>
</template>
```

#### SidebarJournal.vue — 改造

```typescript
// 之前
import { useJournal } from '../../composables/useJournal'
const { openJournalList } = useJournal()
function handleClick() { openJournalList() }

// 之后
import { useRouter } from 'vue-router'
const router = useRouter()
function handleClick() { router.push('/journal') }
```

#### useNavigateToPage.ts — 改造

```typescript
// 之前
await pageStore.openPage(pageId)
currentView.value = 'editor'

// 之后
router.push(`/page/${pageId}`)
```

---

## 5. 状态管理重构

### 5.1 移除 AppView 类型

`types/view.ts` 可以删除，App.vue 不再持有视图状态：

```
App.vue 不再有 currentView: ref<AppView>
视图切换完全由 <RouterView> + URL 驱动
```

### 5.2 pageStore.openPage 保留

`openPage(id)` 负责：
1. 设置 `currentPageId`
2. 从 IndexedDB 加载该 Page 的 Blocks

**不负责视图切换**（视图由 URL/Route 决定）。

> ⚠️ **编辑状态清理（SPEC.md §7 单编辑器原则）：**
> PageView 在路由切换时（`onBeforeUnmount`）必须销毁当前 editor 实例并重置 `activeBlockId`，确保任何时刻只有 1 个 tiptap 实例存在，符合 SPEC.md §7 核心规则。

### 5.3 beforeEach 守卫职责（SPEC.md §8.1 数据流）

`router.beforeEach` 在所有路由切换前执行，职责对应 SPEC.md §8.1 定义的数据流层次：

```typescript
router.beforeEach(async (to) => {
  const pageStore = usePageStore()
  // 若 Pinia 运行态为空，从 IndexedDB 持久化层补充 Page 数据
  if (pageStore.pages.length === 0) {
    await pageStore.loadAllPages()  // IndexedDB → Pinia（符合 §8.1 数据流）
  }
  // 路由特定 Block 数据由 beforeEnter 通过 openPage 补充
})
```


**beforeEach 加载 Page 表，beforeEnter 通过 openPage 加载 Block 表。** 两阶段加载与 SPEC §8.1 "IndexedDB → Pinia → Vue 响应式渲染"的时序一致。


### 5.4 WikiLink 导航集成（SPEC.md §8.2）

WikiLink 在渲染态从 Link 表读取 `targetPageId`，查 PageStore 获取 Page 后按 type 分流路由：


```typescript
import { useRouter } from 'vue-router'
import { usePageStore } from '../stores/pages'

function navigateByPageId(pageId: string) {
  const pageStore = usePageStore()
  const router = useRouter()
  const page = pageStore.getPage(pageId)

  if (page?.type === 'journal') {
    // date 格式已在 Page.title 规范化存储为 yyyy-MM-dd
    router.push(`/journal/${page.title}`)
  } else {
    router.push(`/page/${pageId}`)
  }
}
```

WikiLink 组件渲染态 `<a href>` 引用以上函数，链接格式符合 data-model.md §2.1 Page.type 定义。

### 5.5 useJournal 简化

---

## 6. 迁移路径

### Phase A：基础设施（不影响现有功能）

1. 安装 vue-router：`npm install vue-router`
2. 新建 `router/routes.ts` + `router/index.ts`
3. `main.ts` 注册 router plugin，**注意 `app.use(createPinia())` 必须在 `app.use(router)` 之前执行**
4. **不动 App.vue** — 此时 `<RouterView>` 和 `v-if currentView` 并存，URL 有值但不起作用

### Phase B：视图组件迁移

5. `components/Page/index.vue` → `views/PageView.vue`
6. 更新 `routes.ts` 中的 import 路径（JournalList 不动，直接引用）

### Phase C：导航改造

8. `SidebarJournal.vue` → `router.push('/journal')`
9. `SidebarRecent.vue` → `router.push('/page/${pageId}')`
10. `useNavigateToPage.ts` → `router.push()` 替换 store 状态切换
11. `useJournal.ts` → 移除 `openJournalList()`，`ensureTodayJournalExists()` 内部导航改为 `router.push('/journal/${date}')`

### Phase D：清理

12. `App.vue` 移除 `currentView` ref 和 `view.ts`
13. `SidebarContainer.vue` 移除 `handleNavigate` 中的 `pageStore.openPage` 调用（路由的 `beforeEnter` 统一处理）
14. 删除 `types/view.ts`

---

## 7. 关键设计决策

### Q1：为什么用 history 模式而不是 hash 模式？

| 模式 | URL 示例 | 分享可用 | 服务器配置 |
|------|----------|----------|------------|
| hash | `app.com/#/page/abc` | ⚠️ 常被截断 | 不需要 |
| **history** | `app.com/page/abc` | ✅ 正常 | 需配置 SPA fallback |

Phase 1 是纯前端 SPA，不需要 SSR，直接部署到静态服务器或 Tauri。Tauri 支持 history 路由，ViteDevServer 也天然支持。**选 history 模式**。

### Q2：beforeEnter 里 await openPage 会阻塞导航吗？

不会。`beforeEnter` 是异步守卫，导航会等待 Promise resolve/reject：
- resolve → 继续导航
- reject → 导航中止，显示路由错误

如果 Page 不存在，导航到 `/journal` 并提示"页面不存在"（可以在 App.vue 加一个全局错误提示组件）。

### Q3：刷新后 pageStore.pages 是空的怎么办？

路由导航由 `router.beforeEach` 统一处理（见 §5.3）。所有路由切换前检查 `pageStore.pages` 是否为空，为空则从 IndexedDB 加载，确保 Pinia 运行态在渲染前已就绪，符合 SPEC §8.1 数据流。

### Q4：多个 beforeEnter 都有重复的 `loadAllPages` 逻辑？

可以用 Router 的全局前置守卫：

```typescript
// router/index.ts
router.beforeEach(async (to) => {
  const pageStore = usePageStore()
  if (pageStore.pages.length === 0) {
    await pageStore.loadAllPages()
  }
})
```

统一在所有路由切换前加载 Page 数据，消除每个 route 里的重复逻辑。

---

## 8. 验收标准

| 功能 | 验收标准 |
|------|----------|
| URL 正确 | 打开日记列表 URL 为 `/journal`，打开 Page URL 为 `/page/:id` |
| 刷新恢复 | 在 `/page/abc` 刷新页面，仍停留在 `/page/abc`，数据完整 |
| 分享可用 | 复制的 URL 打开后直接进入对应视图 |
| Back/Forward | 浏览器 back/forward 按钮切换视图，不丢状态 |
| 404 优雅 | 访问不存在的 `/page/xxx` 不会崩溃，重定向到 `/journal` |
| 无回归 | 现有 Sidebar 导航、Journal 入口、SlashCommand 导航均正常 |

---

*文档 v0.2，已根据 SPEC.md / data-model.md 一致性审查更新。*
