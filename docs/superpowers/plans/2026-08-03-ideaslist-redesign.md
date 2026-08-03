# IdeasList 左右分栏重设计 实施方案

> **面向智能体执行者：必须使用子技能**：通过 subagent-driven-development（推荐）或 executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。

**目标**：将 IdeasList 从垂直堆叠改为左右分栏布局（60/40），左侧今日突出显示，右侧历史列表虚拟滚动。

**架构**：IdeasList.vue 改为数据编排层，分离 todayPage + historyPages。新增 IdeasTodayPanel（左栏可编辑）、IdeasHistoryList（右栏虚拟滚动容器）、IdeasHistoryItem（右栏单项只读）。复用 BlockList + useIdeasFreeze，零改动核心文件。

**技术栈**：Vue 3 + TypeScript + vue-virtual-scroller + Vitest + Playwright

---

## 任务 1：新增 vue-virtual-scroller 依赖

**涉及文件：**
- 修改：`comind/package.json`
- 修改：`comind/package-lock.json`（npm 自动更新）

- [ ] **步骤 1：安装 vue-virtual-scroller**

执行命令：
```bash
cd d:\comind\comind && npm install vue-virtual-scroller
```

预期结果：`package.json` 中 `dependencies` 新增 `"vue-virtual-scroller": "^x.x.x"`

- [ ] **步骤 2：验证编译通过**

执行命令：
```bash
cd d:\comind\comind && npm run build
```

预期结果：`vue-tsc -b` 和 `vite build` 均成功，无报错

- [ ] **步骤 3：提交依赖变更**

执行命令：
```bash
cd d:\comind && git add comind/package.json comind/package-lock.json && git commit -m "feat: add vue-virtual-scroller dependency"
```

预期结果：提交成功

---

## 任务 2：导出 useIdeas 的 isTodayTitle 函数

**涉及文件：**
- 修改：`comind/src/composables/useIdeas.ts:37-40`
- 修改：`comind/src/composables/useIdeas.ts:80-86`
- 测试：`comind/src/composables/useIdeas.test.ts`（已有，无需新增）

- [ ] **步骤 1：在 return 语句中导出 isTodayTitle**

编辑 `comind/src/composables/useIdeas.ts`，将第 80-86 行的 return 语句修改为：

```typescript
// 兼容旧名称

return {
  today,
  ideasPages,
  todayIdeasExists,
  checkAndEnsureTodayIdeas,
  ensureTodayIdeasExists,
  isTodayTitle,
}
```

- [ ] **步骤 2：运行现有测试，验证无回归**

执行命令：
```bash
cd d:\comind\comind && npm run test -- src/composables/useIdeas.test.ts
```

预期结果：所有测试通过

- [ ] **步骤 3：编译检查**

执行命令：
```bash
cd d:\comind\comind && npm run build
```

预期结果：编译成功

- [ ] **步骤 4：提交代码**

执行命令：
```bash
cd d:\comind && git add comind/src/composables/useIdeas.ts && git commit -m "feat(useIdeas): export isTodayTitle for IdeasList split"
```

---

## 任务 3：创建 IdeasTodayPanel 组件（左栏今日区域）

**涉及文件：**
- 新建：`comind/src/components/Ideas/IdeasTodayPanel.vue`
- 新建：`comind/src/components/Ideas/__tests__/IdeasTodayPanel.test.ts`

- [ ] **步骤 1：编写 IdeasTodayPanel 组件测试用例**

创建文件 `comind/src/components/Ideas/__tests__/IdeasTodayPanel.test.ts`：

```typescript
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import IdeasTodayPanel from '../IdeasTodayPanel.vue'

// Mock stores and composables
vi.mock('../../../stores/pages', () => ({
  usePageStore: () => ({
    getPage: vi.fn((id: string) => ({ id, title: '2026-08-03', type: 'ideas' })),
  }),
}))

vi.mock('../../../stores/blocks', () => ({
  useBlockStore: () => ({
    blocks: [],
    loadMultiPageBlocks: vi.fn(),
  }),
}))

vi.mock('../../../composables/useIdeas', () => ({
  useIdeas: () => ({
    today: { value: '2026-08-03' },
    isTodayTitle: (title: string) => title === '2026-08-03',
  }),
}))

describe('IdeasTodayPanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('renders today card with correct title', () => {
    const wrapper = mount(IdeasTodayPanel, {
      props: { pageId: 'page-1' },
      global: { stubs: { BlockList: true, Icon: true } },
    })
    expect(wrapper.find('.today-panel').exists()).toBe(true)
    expect(wrapper.find('.today-badge').text()).toContain('今天')
  })
})
```

- [ ] **步骤 2：运行测试，验证失败（组件未创建）**

执行命令：
```bash
cd d:\comind\comind && npm run test -- src/components/Ideas/__tests__/IdeasTodayPanel.test.ts
```

预期结果：测试失败，提示 `Cannot find module '../IdeasTodayPanel.vue'`

- [ ] **步骤 3：编写 IdeasTodayPanel 组件实现**

创建文件 `comind/src/components/Ideas/IdeasTodayPanel.vue`：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { usePageStore } from '../../stores/pages'
import { useIdeas } from '../../composables/useIdeas'
import BlockList from '../BlockList.vue'
import { Icon } from '../Icons'

const props = defineProps<{
  pageId: string
}>()

const pageStore = usePageStore()
const { today, isTodayTitle } = useIdeas()

const page = computed(() => pageStore.getPage(props.pageId))
const isToday = computed(() => page.value ? isTodayTitle(page.value.title) : false)

function getWeekday(dateStr: string): string {
  const date = new Date(dateStr)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return weekdays[date.getDay()]
}

function getMonthDay(dateStr: string): { month: string; day: string } {
  const date = new Date(dateStr)
  return {
    month: `${date.getMonth() + 1}月`,
    day: `${date.getDate()}`,
  }
}
</script>

<template>
  <div class="today-panel" v-if="page">
    <div class="today-card">
      <div class="today-header">
        <span class="today-badge">今天</span>
        <span class="today-date">{{ getMonthDay(page.title).month }}{{ getMonthDay(page.title).day }}日 {{ getWeekday(page.title) }}</span>
        <span class="today-label">可编辑</span>
      </div>
      <div class="today-body">
        <BlockList :page-id="pageId" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.today-panel {
  flex: 0 0 60%;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow: hidden;
}

.today-card {
  background: #fff;
  border: 1px solid var(--accent-subtle, #C7D2FE);
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.12);
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.today-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border, #E7E5E4);
  flex-shrink: 0;
}

.today-badge {
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--accent, #6366F1);
  padding: 3px 10px;
  border-radius: 6px;
  letter-spacing: 0.03em;
}

.today-date {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1C1917);
}

.today-label {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary, #A8A29E);
  letter-spacing: 0.04em;
}

.today-body {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: none;
}

.today-body::-webkit-scrollbar {
  display: none;
}
</style>
```

- [ ] **步骤 4：运行测试，验证通过**

执行命令：
```bash
cd d:\comind\comind && npm run test -- src/components/Ideas/__tests__/IdeasTodayPanel.test.ts
```

预期结果：测试通过

- [ ] **步骤 5：编译检查**

执行命令：
```bash
cd d:\comind\comind && npm run build
```

预期结果：编译成功

- [ ] **步骤 6：提交代码**

执行命令：
```bash
cd d:\comind && git add comind/src/components/Ideas/IdeasTodayPanel.vue comind/src/components/Ideas/__tests__/IdeasTodayPanel.test.ts && git commit -m "feat: add IdeasTodayPanel component for left column"
```

---

## 任务 4：创建 IdeasHistoryItem 组件（右栏单项只读）

**涉及文件：**
- 新建：`comind/src/components/Ideas/IdeasHistoryItem.vue`
- 新建：`comind/src/components/Ideas/__tests__/IdeasHistoryItem.test.ts`

- [ ] **步骤 1：编写 IdeasHistoryItem 组件测试用例**

创建文件 `comind/src/components/Ideas/__tests__/IdeasHistoryItem.test.ts`：

```typescript
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import IdeasHistoryItem from '../IdeasHistoryItem.vue'

// Mock stores and composables
vi.mock('../../../stores/pages', () => ({
  usePageStore: () => ({
    getPage: vi.fn((id: string) => ({ id, title: '2026-08-02', type: 'ideas' })),
  }),
}))

vi.mock('../../../composables/useIdeas', () => ({
  useIdeas: () => ({
    today: { value: '2026-08-03' },
    isTodayTitle: (title: string) => title === '2026-08-03',
  }),
}))

vi.mock('../../../composables/useIdeasFreeze', () => ({
  useIdeasFreeze: () => ({
    isFrozen: { value: true },
  }),
}))

describe('IdeasHistoryItem', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  test('renders history item with date header', () => {
    const wrapper = mount(IdeasHistoryItem, {
      props: { pageId: 'page-2' },
      global: { stubs: { BlockList: true } },
    })
    expect(wrapper.find('.history-item').exists()).toBe(true)
    expect(wrapper.find('.history-date').exists()).toBe(true)
  })

  test('applies frozen state to BlockList', () => {
    const wrapper = mount(IdeasHistoryItem, {
      props: { pageId: 'page-2' },
      global: { stubs: { BlockList: true } },
    })
    // BlockList should receive frozen pageId (通过 useIdeasFreeze 自动处理)
    expect(wrapper.findComponent({ name: 'BlockList' }).exists()).toBe(true)
  })
})
```

- [ ] **步骤 2：运行测试，验证失败（组件未创建）**

执行命令：
```bash
cd d:\comind\comind && npm run test -- src/components/Ideas/__tests__/IdeasHistoryItem.test.ts
```

预期结果：测试失败

- [ ] **步骤 3：编写 IdeasHistoryItem 组件实现**

创建文件 `comind/src/components/Ideas/IdeasHistoryItem.vue`：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { usePageStore } from '../../stores/pages'
import BlockList from '../BlockList.vue'

const props = defineProps<{
  pageId: string
}>()

const pageStore = usePageStore()

const page = computed(() => pageStore.getPage(props.pageId))

function getWeekday(dateStr: string): string {
  const date = new Date(dateStr)
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return weekdays[date.getDay()]
}

function getMonthDay(dateStr: string): { month: string; day: string } {
  const date = new Date(dateStr)
  return {
    month: `${date.getMonth() + 1}月`,
    day: `${date.getDate()}`,
  }
}
</script>

<template>
  <div class="history-item" v-if="page">
    <div class="history-header">
      <span class="history-date">{{ getMonthDay(page.title).month }}{{ getMonthDay(page.title).day }}日</span>
      <span class="history-weekday">{{ getWeekday(page.title) }}</span>
    </div>
    <div class="history-body">
      <BlockList :page-id="pageId" />
    </div>
  </div>
</template>

<style scoped>
.history-item {
  background: #fff;
  border: 1px solid var(--border, #E7E5E4);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
}

.history-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border, #E7E5E4);
  flex-shrink: 0;
}

.history-date {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #1C1917);
}

.history-weekday {
  font-size: 10px;
  color: var(--text-tertiary, #A8A29E);
}

.history-body {
  flex: 1;
  overflow: hidden;
}
</style>
```

- [ ] **步骤 4：运行测试，验证通过**

执行命令：
```bash
cd d:\comind\comind && npm run test -- src/components/Ideas/__tests__/IdeasHistoryItem.test.ts
```

预期结果：测试通过

- [ ] **步骤 5：编译检查**

执行命令：
```bash
cd d:\comind\comind && npm run build
```

预期结果：编译成功

- [ ] **步骤 6：提交代码**

执行命令：
```bash
cd d:\comind && git add comind/src/components/Ideas/IdeasHistoryItem.vue comind/src/components/Ideas/__tests__/IdeasHistoryItem.test.ts && git commit -m "feat: add IdeasHistoryItem component for right column"
```

---

## 任务 5：创建 IdeasHistoryList 组件（右栏虚拟滚动容器）

**涉及文件：**
- 新建：`comind/src/components/Ideas/IdeasHistoryList.vue`

- [ ] **步骤 1：编写 IdeasHistoryList 组件实现**

创建文件 `comind/src/components/Ideas/IdeasHistoryList.vue`：

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import type { Page } from '../../types/page'
import IdeasHistoryItem from './IdeasHistoryItem.vue'

const props = defineProps<{
  pages: Page[]
}>()

// 虚拟滚动配置
const itemSize = 300 // 预估高度
const buffer = 5

// 空状态
const isEmpty = computed(() => props.pages.length === 0)
</script>

<template>
  <div class="history-list">
    <div class="history-sticky-header">历史 · 倒序</div>

    <RecycleScroller
      v-if="!isEmpty"
      class="history-scroller"
      :items="pages"
      :item-size="itemSize"
      :buffer="buffer"
      key-field="id"
    >
      <template #default="{ item }">
        <IdeasHistoryItem :page-id="item.id" />
      </template>
    </RecycleScroller>

    <div v-else class="empty-state">
      <div class="empty-text">暂无历史点滴</div>
    </div>
  </div>
</template>

<style scoped>
.history-list {
  flex: 0 0 40%;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border, #E7E5E4);
  overflow: hidden;
}

.history-sticky-header {
  position: sticky;
  top: 0;
  background: var(--bg-base, #F5F5F7);
  font-size: 10px;
  font-weight: 700;
  color: var(--text-secondary, #44403C);
  padding: 8px 12px;
  letter-spacing: 0.05em;
  z-index: 2;
  border-bottom: 1px solid var(--border, #E7E5E4);
  backdrop-filter: blur(4px);
}

.history-scroller {
  flex: 1;
  padding: 8px 12px;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.empty-text {
  font-size: 12px;
  color: var(--text-tertiary, #A8A29E);
}
</style>
```

- [ ] **步骤 2：编译检查**

执行命令：
```bash
cd d:\comind\comind && npm run build
```

预期结果：编译成功

- [ ] **步骤 3：提交代码**

执行命令：
```bash
cd d:\comind && git add comind/src/components/Ideas/IdeasHistoryList.vue && git commit -m "feat: add IdeasHistoryList with virtual scrolling"
```

---

## 任务 6：重写 IdeasList.vue 数据分离逻辑

**涉及文件：**
- 修改：`comind/src/components/Ideas/IdeasList.vue`

- [ ] **步骤 1：备份当前 IdeasList.vue**

执行命令：
```bash
cd d:\comind && git mv comind/src/components/Ideas/IdeasListItem.vue comind/src/components/Ideas/IdeasListItem.vue.bak
```

- [ ] **步骤 2：重写 IdeasList.vue**

完整替换 `comind/src/components/Ideas/IdeasList.vue` 内容为：

```vue
<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { usePageStore } from '../../stores/pages'
import { useBlockStore } from '../../stores/blocks'
import { useIdeas } from '../../composables/useIdeas'
import IdeasTodayPanel from './IdeasTodayPanel.vue'
import IdeasHistoryList from './IdeasHistoryList.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import PropertyQuickEditor from '../Block/PropertyQuickEditor.vue'
import PropertyEditor from '../Block/PropertyEditor.vue'

const pageStore = usePageStore()
const blockStore = useBlockStore()
const { ideasPages, isTodayTitle } = useIdeas()

// 数据分离：今日 vs 历史
const todayPage = computed(() => {
  return ideasPages.value.find(p => isTodayTitle(p.title))
})

const historyPages = computed(() => {
  return ideasPages.value
    .filter(p => !isTodayTitle(p.title))
    .sort((a, b) => b.title.localeCompare(a.title))
})

// 加载所有点滴 page 的 blocks
onMounted(async () => {
  await pageStore.loadAllPages()

  const ideasPageIds = pageStore.pages
    .filter(p => p.type === 'ideas')
    .map(p => p.id)

  if (ideasPageIds.length > 0) {
    await blockStore.loadMultiPageBlocks(ideasPageIds)
  }
})
</script>

<template>
  <div class="ideas-split-view">
    <!-- 左栏：今日 -->
    <IdeasTodayPanel v-if="todayPage" :page-id="todayPage.id" />

    <!-- 右栏：历史列表 -->
    <IdeasHistoryList :pages="historyPages" />
  </div>

  <!-- 全局单例组件 -->
  <SlashCommandMenu />
  <PropertyQuickEditor />
  <PropertyEditor />
</template>

<style scoped>
.ideas-split-view {
  display: flex;
  height: 100%;
  overflow: hidden;
}
</style>
```

- [ ] **步骤 3：编译检查**

执行命令：
```bash
cd d:\comind\comind && npm run build
```

预期结果：编译成功

- [ ] **步骤 4：提交代码**

执行命令：
```bash
cd d:\comind && git add comind/src/components/Ideas/IdeasList.vue && git commit -m "feat: rewrite IdeasList with left-right split layout"
```

---

## 任务 7：删除 IdeasListItem.vue

**涉及文件：**
- 删除：`comind/src/components/Ideas/IdeasListItem.vue.bak`（已备份）

- [ ] **步骤 1：确认无引用残留**

执行命令：
```bash
cd d:\comind && grep -r "IdeasListItem" --include="*.vue" --include="*.ts" comind/src/
```

预期结果：无匹配（IdeasList.vue 已改用新组件）

- [ ] **步骤 2：删除备份文件**

执行命令：
```bash
cd d:\comind && rm comind/src/components/Ideas/IdeasListItem.vue.bak
```

- [ ] **步骤 3：提交删除**

执行命令：
```bash
cd d:\comind && git add -A && git commit -m "chore: remove IdeasListItem (replaced by IdeasHistoryItem)"
```

---

## 任务 8：添加骨架屏与渐入动效

**涉及文件：**
- 修改：`comind/src/components/Ideas/IdeasTodayPanel.vue`
- 修改：`comind/src/components/Ideas/IdeasHistoryList.vue`

- [ ] **步骤 1：为 IdeasTodayPanel 添加骨架屏**

编辑 `comind/src/components/Ideas/IdeasTodayPanel.vue`，在 `<template>` 顶部添加骨架屏结构：

```vue
<template>
  <div class="today-panel" v-if="page">
    <div class="today-card" :class="{ 'is-loading': !page }">
      <!-- 骨架屏 -->
      <div v-if="!page" class="skeleton-header">
        <div class="skeleton-badge"></div>
        <div class="skeleton-date"></div>
      </div>
      <div v-if="!page" class="skeleton-body">
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
        <div class="skeleton-line"></div>
      </div>

      <!-- 实际内容 -->
      <template v-else>
        <!-- ... 原有内容 ... -->
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 骨架屏样式 */
.skeleton-header {
  display: flex;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}

.skeleton-badge {
  width: 50px;
  height: 20px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 6px;
}

.skeleton-date {
  width: 120px;
  height: 16px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 4px;
}

.skeleton-body {
  padding-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.skeleton-line {
  height: 10px;
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 3px;
}

.skeleton-line.short {
  width: 60%;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
```

- [ ] **步骤 2：添加渐入动效**

在 `comind/src/components/Ideas/IdeasList.vue` 的 `<style>` 中添加：

```css
.ideas-split-view {
  display: flex;
  height: 100%;
  overflow: hidden;
  animation: fadeIn 200ms ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

- [ ] **步骤 3：编译检查**

执行命令：
```bash
cd d:\comind\comind && npm run build
```

预期结果：编译成功

- [ ] **步骤 4：提交代码**

执行命令：
```bash
cd d:\comind && git add -A && git commit -m "feat: add skeleton screen and fade-in animation"
```

---

## 任务 9：E2E 测试编写与执行

**涉及文件：**
- 新建：`comind/tests/ideas-split-layout.spec.ts`

- [ ] **步骤 1：编写 E2E 测试用例**

创建文件 `comind/tests/ideas-split-layout.spec.ts`：

```typescript
import { test, expect } from '@playwright/test'

test.describe('IdeasList Split Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ideas')
    await page.waitForSelector('.ideas-split-view', { timeout: 10000 })
  })

  test('left column displays today panel', async ({ page }) => {
    const todayPanel = page.locator('.today-panel')
    await expect(todayPanel).toBeVisible()
    await expect(todayPanel.locator('.today-badge')).toContainText('今天')
  })

  test('right column displays history list', async ({ page }) => {
    const historyList = page.locator('.history-list')
    await expect(historyList).toBeVisible()
    await expect(historyList.locator('.history-sticky-header')).toContainText('历史')
  })

  test('left and right columns are independently scrollable', async ({ page }) => {
    const todayBody = page.locator('.today-body')
    const historyScroller = page.locator('.history-scroller')

    // 验证左右栏各自有滚动能力
    await expect(todayBody).toBeDefined()
    await expect(historyScroller).toBeDefined()
  })
})
```

- [ ] **步骤 2：运行 E2E 测试**

执行命令：
```bash
cd d:\comind\comind && npm run test:e2e -- tests/ideas-split-layout.spec.ts
```

预期结果：测试通过

- [ ] **步骤 3：提交测试文件**

执行命令：
```bash
cd d:\comind && git add comind/tests/ideas-split-layout.spec.ts && git commit -m "test: add E2E tests for IdeasList split layout"
```

---

## 任务 10：编译检查 + 整体回归

**涉及文件：**
- 无新增文件，仅验证

- [ ] **步骤 1：运行完整测试套**

执行命令：
```bash
cd d:\comind\comind && npm run test
```

预期结果：所有单元测试通过

- [ ] **步骤 2：运行编译检查**

执行命令：
```bash
cd d:\comind\comind && npm run build
```

预期结果：vue-tsc 和 vite build 均成功

- [ ] **步骤 3：运行 E2E 测试**

执行命令：
```bash
cd d:\comind\comind && npm run test:e2e
```

预期结果：所有 E2E 测试通过

- [ ] **步骤 4：最终提交（如有遗漏）**

执行命令：
```bash
cd d:\comind && git status && git add -A && git commit -m "chore: final cleanup for IdeasList redesign"
```

---

## 设计约束汇总

- **新增依赖**：`vue-virtual-scroller`
- **修改文件**：`IdeasList.vue`、`useIdeas.ts`
- **新增文件**：`IdeasTodayPanel.vue`、`IdeasHistoryList.vue`、`IdeasHistoryItem.vue`、测试文件、E2E 测试
- **删除文件**：`IdeasListItem.vue`
- **零改动**：`BlockList.vue`、`useIdeasFreeze.ts`、`routes.ts`、设计 tokens、`App.vue`