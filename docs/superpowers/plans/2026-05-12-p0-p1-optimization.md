# P0/P1 问题优化实施计划
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性解决 comind 项目评估报告中的所有 P0 和 P1 优先级问题
**Architecture:** 按模块顺序实施，先解决布局问题，然后是功能修复，最后是工具配置
**Tech Stack:** Vue 3, TypeScript, Vite, Vitest, Playwright, ESLint

---

## 文件结构

| 文件 | 操作 | 目的 |
|------|------|------|
| `comind/src/App.vue` | 修改 | 完善滚动容器 + 事件处理 |
| `comind/src/components/Page/index.vue` | 修改 | 移除重复的滚动容器 |
| `comind/src/components/Page/styles.css` | 修改 | 移除滚动容器样式 |
| `comind/src/composables/useContentRenderer.ts` | 修改 | 修复 WikiLink 渲染 |
| `comind/src/components/Block/index.vue` | 修改 | 修复外部链接打开 |
| `comind/vitest.config.ts` | 修改 | 包含 gap-exhausted 测试 |
| `comind/package.json` | 修改 | 添加 lint 和 coverage 脚本 |
| `comind/.eslintrc.cjs` | 创建 | ESLint 配置 |

---

## 任务清单

### Task 1: 修复重复的 .page-scroll-wrapper - App.vue

**Files:**
- Modify: `comind/src/App.vue`

- [ ] **Step 1: 修改 App.vue**
```vue
<script setup lang="ts">
import Sidebar from './components/Sidebar/index.vue'
import { useEditorStore } from './stores/editor'

const editorStore = useEditorStore()

function handleMainClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.block')) return
  editorStore.deactivateBlock()
}
</script>

<template>
  <div class="app-layout">
    <Sidebar />
    
    <div class="page-scroll-wrapper" @click="handleMainClick">
      <div class="page-body">
        <main class="main-content">
          <RouterView />
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: row;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg-base);
}

.page-scroll-wrapper {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  min-width: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.page-scroll-wrapper::-webkit-scrollbar {
  width: 6px;
}

.page-scroll-wrapper::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 3px;
}

.page-scroll-wrapper::-webkit-scrollbar-thumb:hover {
  background: var(--text-tertiary);
}

.page-body {
  max-width: 800px;
  min-width: 0;
  margin: 0 auto;
  padding: 0 24px;
}

.main-content {
  padding: 48px 0;
}
</style>
```

- [ ] **Step 2: 验证编译**
Run: `cd d:\comind\comind ; npm run build`
Expected: Build success

- [ ] **Step 3: 检查 git status 和 commit**
```bash
cd d:\comind
git add comind/src/App.vue
git commit -m "fix: update App.vue with complete scroll wrapper and click handler"
```

---

### Task 2: 修复重复的 .page-scroll-wrapper - Page 组件

**Files:**
- Modify: `comind/src/components/Page/index.vue`
- Modify: `comind/src/components/Page/styles.css`

- [ ] **Step 1: 修改 Page/index.vue**
```vue
<script setup lang="ts">
import { computed, ref, onBeforeUnmount, nextTick } from 'vue'
import BlockList from '../BlockList.vue'
import Backlinks from '../Backlinks.vue'
import MergeDialog from '../MergeDialog.vue'
import TagFilterPanel from '../TagFilterPanel.vue'
import SlashCommandMenu from '../SlashCommandMenu.vue'
import { usePageStore } from '../../stores/pages'
import { useEditorStore } from '../../stores/editor'
import type { Page } from '../../types/page'

const props = withDefaults(defineProps<{
  pageId: string
  editableTitle?: boolean
}>(), {
  editableTitle: false
})

const pageStore = usePageStore()
const editorStore = useEditorStore()

/** 解析实际的 pageId：props 可能是 UUID 或 date title（journal-page 路由） */
const resolvedPageId = computed(() => {
  const direct = pageStore.getPage(props.pageId)
  if (direct) return direct.id
  const byTitle = pageStore.getPageByTitle(props.pageId)
  if (byTitle) return byTitle.id
  return props.pageId
})

const currentPageTitle = computed(() => {
  const page = pageStore.getPage(resolvedPageId.value)
  return page?.title ?? 'comind'
})

const isEditingTitle = ref(false)
const editingTitle = ref('')
const titleInputRef = ref<HTMLInputElement | null>(null)

const showMergeDialog = ref(false)
const mergeTarget = ref<Page | null>(null)

onBeforeUnmount(() => {
  editorStore.deactivateBlock()
})

async function startEditTitle() {
  if (!props.editableTitle) return
  editorStore.deactivateBlock()
  editingTitle.value = await currentPageTitle.value
  isEditingTitle.value = true
  nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}

async function saveTitle() {
  isEditingTitle.value = false
  const newTitle = editingTitle.value.trim()
  if (!newTitle || newTitle === await currentPageTitle.value) return

  const result = await pageStore.renamePage(await resolvedPageId.value, newTitle)
  if (result.duplicated) {
    editingTitle.value = newTitle
    showMergeDialog.value = true
    mergeTarget.value = result.duplicated
  }
}

function cancelEditTitle() {
  isEditingTitle.value = false
  editingTitle.value = ''
}

async function handleMerge() {
  if (!mergeTarget.value) return
  const sourceId = await resolvedPageId.value
  const targetId = mergeTarget.value.id
  showMergeDialog.value = false
  mergeTarget.value = null
  await pageStore.mergePage(sourceId, targetId)
  await pageStore.openPage(targetId)
}

function handleCancelMerge() {
  showMergeDialog.value = false
  mergeTarget.value = null
  editingTitle.value = ''
}
</script>

<template>
  <div class="page-container">
    <div class="page-body">
      <main class="main-content">
        <div class="page-header">
          <h1
            v-if="!isEditingTitle"
            class="page-title page-title--display"
            :class="{ 'page-title--editable': editableTitle }"
            @click="startEditTitle"
          >{{ currentPageTitle }}</h1>
          <input
            v-else
            ref="titleInputRef"
            v-model="editingTitle"
            class="page-title page-title--input"
            @blur="saveTitle"
            @keydown.enter.prevent="saveTitle"
            @keydown.escape="cancelEditTitle"
          />
        </div>

        <BlockList :page-id="resolvedPageId" />
      </main>

      <Backlinks />
    </div>

    <MergeDialog
      :visible="showMergeDialog"
      :source-title="editingTitle"
      :target-title="mergeTarget?.title ?? ''"
      @merge="handleMerge"
      @cancel="handleCancelMerge"
    />

    <TagFilterPanel />
    <SlashCommandMenu />
  </div>
</template>

<style scoped>
@import './styles.css';
</style>
```

- [ ] **Step 2: 修改 Page/styles.css**
```css
.page-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 100%;
  gap: 48px;
  padding-bottom: var(--space-6);
}

.main-content {
  max-width: var(--max-width);
  min-height: calc(100vh * 0.618);
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
  flex: 1;
}

.page-header {
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--border);
}

.page-title {
  font-family: var(--font-sans);
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.5px;
  line-height: 1.4;
}

.page-title--display {
  cursor: default;
  padding: 2px var(--space-1);
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  transition: border-color 150ms ease, background 150ms ease;
}

.page-title--editable:hover {
  border-color: var(--border);
  background: var(--accent-03);
  cursor: text;
}

.page-title--input {
  background: transparent;
  border: 1px solid var(--accent);
  outline: none;
  padding: 2px var(--space-1);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-focus);
  width: 100%;
  max-width: 600px;
}
```

- [ ] **Step 3: 验证编译**
Run: `cd d:\comind\comind ; npm run build`
Expected: Build success

- [ ] **Step 4: 验证单元测试**
Run: `cd d:\comind\comind ; npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**
```bash
cd d:\comind
git add comind/src/components/Page/index.vue comind/src/components/Page/styles.css
git commit -m "fix: remove duplicate page-scroll-wrapper from Page component"
```

---

### Task 3: 修复外部 WikiLink 渲染

**Files:**
- Modify: `comind/src/composables/useContentRenderer.ts`

- [ ] **Step 1: 修改 useContentRenderer.ts**
```typescript
import { TAG_REGEX } from '../utils/parser'

const CSS_CLASSES = {
  blockLink: 'block-link',
  blockTag: 'block-tag',
  tagSegment: 'tag-segment',
  tagSep: 'tag-sep'
}

export function useContentRenderer() {
  function escapeHtmlEntities(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function renderContentToHtml(text: string): string {
    const html = escapeHtmlEntities(text)
    return html
      .replace(/\[\[(https?:\/\/[^\]]+)\]\]/g, (_, url) => {
        return `<span class="${CSS_CLASSES.blockLink} external" data-external="${escapeHtmlEntities(url)}">${url}</span>`
      })
      .replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target, alias) => {
        const display = alias || target
        return `<span class="${CSS_CLASSES.blockLink}" data-page="${escapeHtmlEntities(target)}">${display}</span>`
      })
      .replace(TAG_REGEX, (_, tag) => {
        if (tag.includes('.')) return `#${tag}`
        const parts = tag.split('/')
        const rendered = parts.map((p: string, i: number) => {
          const span = `<span class="${CSS_CLASSES.tagSegment}">${escapeHtmlEntities(p)}</span>`
          return i < parts.length - 1 ? span + `<span class="${CSS_CLASSES.tagSep}">/</span>` : span
        }).join('')
        return `<span class="${CSS_CLASSES.blockTag}">#${rendered}</span>`
      })
  }

  return { renderContentToHtml }
}
```

- [ ] **Step 2: 验证编译**
Run: `cd d:\comind\comind ; npm run build`
Expected: Build success

- [ ] **Step 3: Commit**
```bash
cd d:\comind
git add comind/src/composables/useContentRenderer.ts
git commit -m "fix: external WikiLink rendering - match external links first, store URL in data-external"
```

---

### Task 4: 修复外部 WikiLink 打开

**Files:**
- Modify: `comind/src/components/Block/index.vue`

- [ ] **Step 1: 修改 Block/index.vue 的 link click handler**
找到内容点击处理函数，修改外部链接打开部分：
```typescript
  if (link.dataset.external) {
    window.open(link.dataset.external, '_blank', 'noopener,noreferrer')
    return
  }
```

- [ ] **Step 2: 验证编译**
Run: `cd d:\comind\comind ; npm run build`
Expected: Build success

- [ ] **Step 3: 验证单元测试**
Run: `cd d:\comind\comind ; npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**
```bash
cd d:\comind
git add comind/src/components/Block/index.vue
git commit -m "fix: use safe window.open with noopener,noreferrer for external links"
```

---

### Task 5: 更新 vitest.config.ts 包含 gap-exhausted 测试

**Files:**
- Modify: `comind/vitest.config.ts`

- [ ] **Step 1: 修改 vitest.config.ts**
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'test-*.spec.ts'],
    globals: true
  }
})
```

- [ ] **Step 2: 验证测试**
Run: `cd d:\comind\comind ; npm test`
Expected: All tests pass, including gap-exhausted test

- [ ] **Step 3: Commit**
```bash
cd d:\comind
git add comind/vitest.config.ts
git commit -m "feat: include test-*.spec.ts in test files"
```

---

### Task 6: 安装 lint 和 coverage 依赖

**Files:**
- Modify: `comind/package.json`
- Create: `comind/.eslintrc.cjs`

- [ ] **Step 1: 安装依赖**
Run: `cd d:\comind\comind ; npm install --save-dev @vitest/coverage-v8 eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-plugin-vue`
Expected: Installation successful

- [ ] **Step 2: 修改 package.json scripts**
```json
{
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src --ext .vue,.ts,.tsx,.js,.jsx",
    "lint:fix": "eslint src --ext .vue,.ts,.tsx,.js,.jsx --fix"
  }
}
```

- [ ] **Step 3: 创建 .eslintrc.cjs**
```javascript
module.exports = {
  root: true,
  env: {
    browser: true,
    es2021: true,
    node: true
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:vue/vue3-recommended'
  ],
  parser: 'vue-eslint-parser',
  parserOptions: {
    ecmaVersion: 'latest',
    parser: '@typescript-eslint/parser',
    sourceType: 'module'
  },
  plugins: [
    '@typescript-eslint',
    'vue'
  ],
  rules: {
    'vue/multi-word-component-names': 'off'
  }
}
```

- [ ] **Step 4: 验证 lint**
Run: `cd d:\comind\comind ; npm run lint`
Expected: Runs without errors (warnings are OK)

- [ ] **Step 5: 验证 coverage**
Run: `cd d:\comind\comind ; npm run test:coverage`
Expected: Coverage report generated

- [ ] **Step 6: Commit**
```bash
cd d:\comind
git add comind/package.json comind/package-lock.json comind/.eslintrc.cjs
git commit -m "feat: add lint and coverage tooling with eslint and @vitest/coverage-v8"
```

---

### Task 7: 验证路由 E2E 测试

**Files:**
- Verify: `comind/e2e/routing.test.ts`

- [ ] **Step 1: 确保开发服务器或预览服务器可以运行**
首先运行构建并启动预览：
```bash
cd d:\comind\comind
npm run build
npm run preview
```
(在另一个终端运行 Playwright，或停止预览后单独运行 Playwright)

- [ ] **Step 2: 运行路由 E2E 测试**
Run: `cd d:\comind\comind ; npx playwright test e2e/routing.test.ts`
Expected: All tests pass (如果还有失败，根据错误信息适当调整)

---

## 验收标准检查

完成所有任务后，验证以下内容：

- [ ] `npx playwright test e2e/routing.test.ts` 全部通过
- [ ] `npm test` 包含并通过 gap-exhausted 测试
- [ ] `npm run lint` 可运行
- [ ] `npm run test:coverage` 可运行
- [ ] 页面只有一个 `.page-scroll-wrapper`
- [ ] `npm run build` 仍然通过
