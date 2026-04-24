# 日记列表界面设计

**日期：** 2026-04-24
**状态：** 待审核

---

## 1. 需求概述

### 核心功能

- 侧边栏入口点击后，路由切换为日记列表视图
- 列表项为标题不可修改的 Page（一天一个 Page）
- 日记仅在当天打开时创建（懒创建）
- 列表第一个显示今天（今天存在时显示，不存在时创建一个）
- 列表按时间倒序排列（今天在最前）

### 用户流程

1. 点击侧边栏入口 → 路由切换到 `#/`，显示日记列表
2. 点击列表中的某个 Page 标题 → 路由切换到 `#/YYYY-MM-DD`，打开对应日记 Page
3. 在日记 Page 中操作 → 点击返回时回到之前的状态（不一定是列表）

---

## 2. 路由设计

### 路由结构

| 路由               | 组件          | 说明           |
| ---------------- | ----------- | ------------ |
| `#/`             | JournalList | 日记列表（默认视图）   |
| `#/page/:pageId` | Page        | 通用 Page 页面   |
| `#/YYYY-MM-DD`   | Page        | 某天日记（标题不可编辑） |

### 技术选型

**Vue Router** — 考虑到未来还有筛选、任务、知识图谱、思考、工作流、情绪地图等多个独立视图，使用 Vue Router 可以：

- 支持按需加载，独立打包各视图
- 命名路由，代码清晰
- 嵌套路由支持未来扩展
- 浏览器历史正常运作
- 路由守卫等高级功能

### 路由守卫

- 访问 `#/YYYY-MM-DD` 时：
  - 日记存在 → 正常打开
  - 日记不存在 → 显示"页面不存在"提示，不自动创建
- 访问 `#/page/:pageId` 时：
  - Page 存在 → 正常打开
  - Page 不存在 → 显示"页面不存在"提示

---

## 3. 架构设计

### 组件结构

```
src/
├── router/
│   └── index.ts              # 新增：Vue Router 配置
├── components/
│   ├── JournalList/          # 新增：日记列表视图
│   │   └── index.vue
│   ├── Page/
│   │   └── index.vue         # 修改：editableTitle 由 Block 数据决定
│   └── Sidebar/
│       └── SidebarJournal.vue # 修改：使用 router.push('/')
├── composables/
│   ├── useJournal.ts         # 新增独立 composable
│   └── useDateNavigation.ts  # 新增：日期导航 composable（使用 date-fns）
└── App.vue                   # 修改：使用 <RouterView> 替换 Page
```

### App.vue 改动

```vue
<template>
  <div class="app-layout">
    <Sidebar />
    <RouterView />
  </div>
</template>
```

### Block 数据结构改动

在 Block 中新增字段标识日记页面：

```typescript
interface Block {
  // ... 现有字段
  isJournal?: boolean  // 新增：标识是否为日记页面
  journalDate?: string // 新增：日记日期 YYYY-MM-DD（仅 isJournal 为 true 时有效）
}
```

`editableTitle` 的判断逻辑：
- `isJournal === true` → `editableTitle = false`
- `isJournal === false` 或 `undefined` → `editableTitle = true`

### useJournal.ts（独立 composable）

```typescript
export function useJournal() {
  // today — 今天日期字符串
  // journalPages — 所有日记 Page（已按日期倒序）
  // todayJournalExists — 今天日记是否存在
  // createTodayJournal() — 创建今天日记

  return { today, journalPages, todayJournalExists, createTodayJournal }
}
```

### useDateNavigation.ts（新增）

使用 `date-fns` 处理日期导航：

```typescript
export function useDateNavigation() {
  // navigateToPreviousDay() — 导航到前一天
  // navigateToNextDay() — 导航到后一天
  // navigateToDate(date: string) — 导航到指定日期
  // isToday(date: string) — 判断是否为今天
  // formatDate(date: Date) — 格式化日期
}
```

---

## 4. 组件设计

### JournalList/index.vue

**职责：** 渲染日记列表视图

**核心逻辑：**

- 计算属性 `displayedPages`：今天（若存在）+ 所有已存在的日记 Page，按时间倒序排列
- 列表项交互与 Page 相同（点击可编辑 Block 内容等）
- 标题点击触发路由跳转

**列表项设计：**

- 高度：根据 Block 内容自适应
- 布局：日期标题 + Block 内容预览
- 交互：点击标题触发 `router.push('/YYYY-MM-DD')`，其他交互与 Page 相同

---

## 5. 数据流

### 打开日记列表

```
用户点击 SidebarJournal
  → router.push('/')
  → Vue Router 切换到 JournalList 组件
```

### 打开具体日记

```
用户点击 JournalList 中的 Page
  → router.push('/2026-04-24')
  → Vue Router 切换到 Page 组件
  → Block.isJournal = true → editableTitle = false
```

### 日期导航

```
用户点击"前一天"/"后一天"
  → useDateNavigation 计算目标日期
  → router.push('/YYYY-MM-DD')
  → 若日记不存在，显示"页面不存在"
```

### 返回之前状态

```
用户在日记 Page 点击返回
  → router.back()
  → 回到浏览器历史中的上一个路由
```

---

## 6. 样式考虑

### JournalList 列表项

- 紧凑布局，高度根据 Block 内容自适应
- 日期标题突出显示（如加粗、颜色区分）
- 内容预览使用与 Page 相同的 Block 渲染逻辑

### 过渡动画

- 路由切换时添加淡入/淡出动画（Vue Router transition）

---

## 7. 实现步骤

### Phase 1：路由基础

1. 安装 Vue Router：`npm install vue-router`
2. 安装 date-fns：`npm install date-fns`
3. 创建 `src/router/index.ts`，配置基础路由
4. 修改 `App.vue`，使用 `<RouterView>` 替换原 Page 组件

### Phase 2：Block 数据结构

5. 在 `Block` 类型中新增 `isJournal` 和 `journalDate` 字段
6. 更新 `storage/indexedDB.ts` 中 Block 的读写逻辑
7. 更新 `blockStore` 相关方法

### Phase 3：日记列表

8. 创建 `useJournal.ts` 独立 composable
9. 新建 `JournalList/index.vue` 组件
10. 实现列表渲染逻辑（今天存在时显示在第一位 + 其他日记倒序）
11. 点击列表项触发路由跳转

### Phase 4：日期导航

12. 创建 `useDateNavigation.ts` composable
13. 在 JournalList 中添加日期导航功能

### Phase 5：日记 Page

14. 配置 `#/YYYY-MM-DD` 路由 → Page 组件
15. 在 Page 中根据 `Block.isJournal` 判断 `editableTitle`
16. 实现路由守卫：访问不存在日期时显示"页面不存在"

### Phase 6：集成与优化

17. 修改 `SidebarJournal.vue`，使用 `router.push('/')`
18. 调整样式和过渡动画
19. 测试完整流程
