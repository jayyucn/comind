# P0/P1 问题优化设计方案

**日期**: 2026-05-12
**评估文档**: [project-evaluation-2026-05-11.md](file:///d:/comind/docs/project-evaluation-2026-05-11.md)

---

## 概述

本次优化针对项目评估报告中 **P0** 和 **P1** 优先级的问题，旨在一次性解决所有关键问题。

---

## 问题清单

| 优先级 | 问题 | 文件 |
|--------|------|------|
| P0 | 路由 E2E 测试失败 | `e2e/routing.test.ts` |
| P0 | glob 依赖漏洞 | `package.json` |
| P1 | 外部 WikiLink 渲染/打开问题 | `src/composables/useContentRenderer.ts` |
| P1 | gap-exhausted 测试未包含在 npm test 中 | `vitest.config.ts` |
| P1 | 缺少 lint/format 工具与 coverage 配置 | `package.json` |
| P1 | 重复的 .page-scroll-wrapper | `App.vue` + `Page/index.vue` |

---

## 一、问题：重复的 .page-scroll-wrapper

### 问题描述
[App.vue](file:///d:/comind/comind/src/App.vue#L9-L15) 和 [Page/index.vue](file:///d:/comind/comind/src/components/Page/index.vue#L104) 都定义了 `.page-scroll-wrapper`，导致：
- Playwright strict 模式匹配到多个元素
- 样式职责混淆

### 解决方案

**保留 App.vue 中的容器，移除 Page 组件中的版本**

#### 修改 1: App.vue
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

#### 修改 2: Page/index.vue
```vue
<template>
  <div class="page-container">
    <div class="page-body">
      <main class="main-content">
        <!-- 原有内容 -->
      </main>

      <Backlinks />
    </div>

    <!-- 其他组件 -->
  </div>
</template>

<style scoped>
/* 移除 .page-scroll-wrapper 相关样式，保持其他样式不变 */
@import './styles.css';
</style>
```

#### 修改 3: Page/styles.css
- 移除 `.page-scroll-wrapper` 相关样式，保留其他样式

---

## 二、问题：外部 WikiLink 渲染/打开问题

### 问题描述
在 [useContentRenderer.ts](file:///d:/comind/comind/src/composables/useContentRenderer.ts#L22-L28) 中：
1. 普通 WikiLink 正则先匹配，导致外部链接分支不可达
2. `data-external` 没有存储实际 URL 值
3. [Block/index.vue](file:///d:/comind/comind/src/components/Block/index.vue#L323-L325) 中打开链接缺少安全参数

### 解决方案

#### 修改 1: useContentRenderer.ts
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
      // 先匹配外部链接
      .replace(/\[\[(https?:\/\/[^\]]+)\]\]/g, (_, url) => {
        return `<span class="${CSS_CLASSES.blockLink} external" data-external="${escapeHtmlEntities(url)}">${url}</span>`
      })
      // 再匹配内部 WikiLink
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

#### 修改 2: Block/index.vue
```typescript
  if (link.dataset.external) {
    window.open(link.dataset.external, '_blank', 'noopener,noreferrer')
    return
  }
```

---

## 三、问题：gap-exhausted 测试未包含

### 解决方案
修改 [vitest.config.ts](file:///d:/comind/comind/vitest.config.ts#L6)：
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

---

## 四、问题：建立 lint 与 coverage 门禁

### 解决方案

#### 步骤 1: 安装依赖
```bash
npm install --save-dev @vitest/coverage-v8 eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-plugin-vue
```

#### 步骤 2: 添加 package.json scripts
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

#### 步骤 3: 创建 .eslintrc.cjs
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

---

## 五、问题：路由 E2E 失败

### 解决方案
在修复重复的 `.page-scroll-wrapper` 问题后，重新运行：
```bash
npx playwright test e2e/routing.test.ts
```

根据具体失败情况进行必要调整。

---

## 六、问题：glob 依赖漏洞

### 解决方案
当前 `npm audit` 未发现漏洞。后续定期运行：
```bash
npm audit --registry=https://registry.npmjs.org
```
如发现漏洞，使用 `npm audit fix` 或手动更新依赖。

---

## 验收标准

- [ ] `npx playwright test e2e/routing.test.ts` 全部通过
- [ ] `npm test` 包含并通过 gap-exhausted 测试
- [ ] `npm run lint` 可运行
- [ ] `npm run test:coverage` 可运行
- [ ] 外部 WikiLink `[[https://example.com]]` 可正确渲染和打开
- [ ] 页面只有一个 `.page-scroll-wrapper`
- [ ] `npm run build` 仍然通过
