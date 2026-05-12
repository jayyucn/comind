# P2 代码质量优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 解决 comind 项目 P2 优先级问题，提升代码质量和可维护性
**Architecture:** 按实施顺序逐步处理，先建立 logger 工具，再处理文件拆分，最后清理和优化
**Tech Stack:** Vue 3, TypeScript, Vitest, Vite

---

## 文件结构

| 文件 | 操作 | 目的 |
|------|------|------|
| `comind/src/utils/logger.ts` | 创建 | 轻量 logger 工具 |
| `comind/src/stores/blocks.ts` | 修改 | 替换 console.* |
| `comind/src/components/Block/index.vue` | 修改 | 替换 console.* |
| `comind/src/components/Editor.vue` | 修改 | 替换 console.* |
| `comind/src/utils/block-helpers.ts` | 修改 | 替换 console.* |
| `comind/src/components/Backlinks.vue` | 修改 | 替换 console.* |
| `comind/src/router/routes.ts` | 修改 | 替换 console.* |
| `comind/src/storage/indexedDB.ts` | 修改 | 修复词数计算 |
| `comind/e2e/archive/` | 创建 | 归档目录 |
| `comind/e2e/README.md` | 创建 | 测试入口文档 |
| `comind/vite.config.ts` | 修改 | 添加 chunk 配置 |

---

## 任务清单

### Task 1: 创建 logger 工具

**Files:**
- Create: `comind/src/utils/logger.ts`

- [ ] **Step 1: 创建 logger.ts**
```typescript
// src/utils/logger.ts

const isDev = import.meta.env.DEV

export const logger = {
  warn: (message: string, ...args: unknown[]) => {
    if (isDev) console.warn(message, ...args)
  },
  info: (message: string, ...args: unknown[]) => {
    if (isDev) console.info(message, ...args)
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(message, ...args)
  },
  debug: (message: string, ...args: unknown[]) => {
    if (isDev) console.debug(message, ...args)
  }
}
```

- [ ] **Step 2: 验证文件创建成功**
Run: `ls d:\comind\comind\src\utils\logger.ts`
Expected: 文件存在

- [ ] **Step 3: Commit**
```bash
cd d:\comind
git add src/utils/logger.ts
git commit -m "feat: add lightweight logger utility with dev/prod environment support"
```

---

### Task 2: 替换 blocks.ts 中的 console.*

**Files:**
- Modify: `comind/src/stores/blocks.ts`

**当前 console.* 调用位置（共 10 处）：**
- 第 47 行：`console.warn('[safeCalcInsertPos] Gap exhausted, triggering renumbering...')`
- 第 57 行：`console.info('[safeCalcInsertPos] Renumbering complete, recalculating positions...')`
- 第 62 行：`console.info(...)`
- 第 67 行：`console.error(...)`
- 第 76 行：`console.warn(...)`
- 第 80 行：`console.error(...)`
- 第 150 行：`console.error(...)`
- 第 154 行：`console.error(...)`
- 第 648 行：`console.warn(...)`
- 第 697 行：`console.error(...)`

- [ ] **Step 1: 修改 blocks.ts，导入 logger**
在文件开头添加：
```typescript
import { logger } from '@/utils/logger'
```

- [ ] **Step 2: 替换所有 console.* 调用**
将所有 `console.warn(...)` 替换为 `logger.warn(...)`
将所有 `console.info(...)` 替换为 `logger.info(...)`
将所有 `console.error(...)` 替换为 `logger.error(...)`

- [ ] **Step 3: 验证编译**
Run: `cd d:\comind\comind ; npm run build`
Expected: Build success

- [ ] **Step 4: 验证测试**
Run: `cd d:\comind\comind ; npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**
```bash
cd d:\comind
git add src/stores/blocks.ts
git commit -m "refactor: replace console.* with logger utility in blocks.ts"
```

---

### Task 3: 替换其他文件中的 console.*

**Files:**
- Modify: `comind/src/components/Block/index.vue` (1 处)
- Modify: `comind/src/components/Editor.vue` (2 处)
- Modify: `comind/src/utils/block-helpers.ts` (1 处)
- Modify: `comind/src/components/Backlinks.vue` (4 处)
- Modify: `comind/src/router/routes.ts` (4 处)

**总计：12 处**

- [ ] **Step 1: 修改 Block/index.vue**
在文件中添加导入：
```typescript
import { logger } from '@/utils/logger'
```
替换 `console.error('导航失败:', err)` 为 `logger.error('导航失败:', err)`

- [ ] **Step 2: 修改 Editor.vue**
在文件中添加导入：
```typescript
import { logger } from '@/utils/logger'
```
替换所有 `console.warn(...)` 为 `logger.warn(...)`

- [ ] **Step 3: 修改 block-helpers.ts**
在文件中添加导入：
```typescript
import { logger } from '@/utils/logger'
```
替换 `console.error(error.message)` 为 `logger.error(error.message)`

- [ ] **Step 4: 修改 Backlinks.vue**
在文件中添加导入：
```typescript
import { logger } from '@/utils/logger'
```
替换所有 `console.error(...)` 为 `logger.error(...)`

- [ ] **Step 5: 修改 routes.ts**
在文件中添加导入：
```typescript
import { logger } from '@/utils/logger'
```
替换所有 `console.warn(...)` 为 `logger.warn(...)`
替换所有 `console.error(...)` 为 `logger.error(...)`

- [ ] **Step 6: 验证编译**
Run: `cd d:\comind\comind ; npm run build`
Expected: Build success

- [ ] **Step 7: 验证测试**
Run: `cd d:\comind\comind ; npm test`
Expected: All tests pass

- [ ] **Step 8: Commit**
```bash
cd d:\comind
git add src/components/Block/index.vue src/components/Editor.vue src/utils/block-helpers.ts src/components/Backlinks.vue src/router/routes.ts
git commit -m "refactor: replace console.* with logger utility across codebase"
```

---

### Task 4: 修复词数计算

**Files:**
- Modify: `comind/src/storage/indexedDB.ts`

**问题位置：约第 366 行**

- [ ] **Step 1: 查找 computeWordCount 函数**
确认当前实现：
```typescript
function computeWordCount(content: string): number {
  return content.split(/\s+/).length // 空字符串返回 1
}
```

- [ ] **Step 2: 修改为修复版本**
```typescript
function computeWordCount(content: string): number {
  if (!content || !content.trim()) return 0
  return content.trim().split(/\s+/).length
}
```

- [ ] **Step 3: 验证编译**
Run: `cd d:\comind\comind ; npm run build`
Expected: Build success

- [ ] **Step 4: 验证测试**
Run: `cd d:\comind\comind ; npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**
```bash
cd d:\comind
git add src/storage/indexedDB.ts
git commit -m "fix: computeWordCount correctly handles empty strings"
```

---

### Task 5: 整理 E2E 目录

**Files:**
- Create: `comind/e2e/archive/`
- Create: `comind/e2e/README.md`

- [ ] **Step 1: 创建归档目录**
Run: `mkdir -p d:\comind\comind\e2e\archive`

- [ ] **Step 2: 查看当前 e2e 目录内容**
Run: `ls d:\comind\comind\e2e`
Expected: 列出所有文件和目录

- [ ] **Step 3: 将非正式测试文件移入 archive**
识别并移动：
- Python 脚本 (.py)
- 调试输出文件
- 非 .test.ts 文件

- [ ] **Step 4: 创建 e2e/README.md**
```markdown
# E2E 测试目录

## 正式测试
- `*.test.ts` - Playwright E2E 测试

## 归档文件
- `archive/` - 历史调试脚本和工具
```

- [ ] **Step 5: Commit**
```bash
cd d:\comind
git add e2e/archive e2e/README.md
git commit -m "chore: organize e2e directory - archive debug scripts"
```

---

### Task 6: 拆分 blocks.ts（可选 - 如果行数仍超过 600）

**Files:**
- Modify: `comind/src/utils/block-helpers.ts`
- Modify: `comind/src/stores/blocks.ts`

**注意：** 先检查 blocks.ts 当前行数，如果已 <600 则跳过此任务

- [ ] **Step 1: 检查 blocks.ts 行数**
Run: `wc -l d:\comind\comind\src\stores\blocks.ts`

- [ ] **Step 2: 如果行数 > 600，执行拆分**
识别可抽取的纯函数：
- 树遍历函数：`getAncestors`、`getDescendants`、`getSiblings`
- 位置计算函数：`calcInsertPosition`
- 验证函数：`isValidMove`、`isDescendantOf`

- [ ] **Step 3: 抽取函数到 block-helpers.ts**
将识别的函数移动到 `src/utils/block-helpers.ts`

- [ ] **Step 4: 更新 blocks.ts 导入**
```typescript
import { getAncestors, getDescendants, getSiblings, calcInsertPosition, isValidMove, isDescendantOf } from '@/utils/block-helpers'
```

- [ ] **Step 5: 验证编译和测试**
Run: `cd d:\comind\comind ; npm run build && npm test`
Expected: Build success, all tests pass

- [ ] **Step 6: Commit**
```bash
cd d:\comind
git add src/stores/blocks.ts src/utils/block-helpers.ts
git commit -m "refactor: extract tree traversal functions from blocks.ts"
```

---

### Task 7: 拆分 Block/index.vue（可选 - 如果行数仍超过 500）

**Files:**
- Create: `comind/src/composables/useDragDrop.ts`
- Modify: `comind/src/components/Block/index.vue`

**注意：** 先检查 Block/index.vue 当前行数，如果已 <500 则跳过此任务

- [ ] **Step 1: 检查 Block/index.vue 行数**
Run: `wc -l d:\comind\comind\src\components\Block\index.vue`

- [ ] **Step 2: 如果行数 > 500，执行拆分**
识别可抽取的函数：
- 拖拽命中测试：`findDropTarget`
- 放置指示器渲染：`renderDropIndicator`、`getOrCreateIndicator`
- 缩进计算：`indentWidth` 计算

- [ ] **Step 3: 创建 useDragDrop.ts**
将拖拽相关函数抽取到 `src/composables/useDragDrop.ts`

- [ ] **Step 4: 更新 Block/index.vue 导入**
```typescript
import { useDragDrop } from '@/composables/useDragDrop'
const { findDropTarget, renderDropIndicator, getOrCreateIndicator } = useDragDrop()
```

- [ ] **Step 5: 验证编译和测试**
Run: `cd d:\comind\comind ; npm run build && npm test`
Expected: Build success, all tests pass

- [ ] **Step 6: Commit**
```bash
cd d:\comind
git add src/composables/useDragDrop.ts src/components/Block/index.vue
git commit -m "refactor: extract drag-drop logic from Block component"
```

---

### Task 8: 配置 Bundle Budget

**Files:**
- Modify: `comind/vite.config.ts`

- [ ] **Step 1: 读取当前 vite.config.ts**
```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
```

- [ ] **Step 2: 添加 chunk 配置**
```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
          tiptap: ['@tiptap/vue-3', '@tiptap/starter-kit', '@tiptap/extension-placeholder']
        }
      }
    }
  }
})
```

- [ ] **Step 3: 验证编译**
Run: `cd d:\comind\comind ; npm run build`
Expected: Build success，可能有 chunk size 警告

- [ ] **Step 4: Commit**
```bash
cd d:\comind
git add vite.config.ts
git commit -m "config: add manual chunks and bundle budget configuration"
```

---

## 验收标准检查

完成所有任务后，验证以下内容：

- [ ] `npm run build` 成功
- [ ] `npm test` 所有测试通过
- [ ] `npm run lint` 无新增错误
- [ ] `npx playwright test e2e/routing.test.ts` 全部通过
- [ ] blocks.ts 行数 < 600（如果执行了 Task 6）
- [ ] Block/index.vue 行数 < 500（如果执行了 Task 7）
- [ ] e2e 目录只包含正式测试 + archive/
- [ ] `npm run build` 不触发 budget 错误（警告可接受）
