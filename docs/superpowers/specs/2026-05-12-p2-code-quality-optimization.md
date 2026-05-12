# P2 代码质量优化设计方案

**日期**: 2026-05-12
**评估文档**: [project-evaluation-2026-05-11.md](file:///d:/comind/docs/project-evaluation-2026-05-11.md)

---

## 概述

本次优化针对项目评估报告中 P2 优先级的问题，主要关注代码质量和可维护性提升。

---

## 问题清单

| # | 问题 | 当前状态 | 方案 |
|---|------|----------|------|
| 1 | 运行期日志散落 | 22 处 console.* | 创建轻量 logger 工具 |
| 2 | 文件过大 | blocks.ts 779行, Block 649行 | 保守拆分，抽取纯函数 |
| 3 | E2E 目录混乱 | 78 个文件含调试脚本 | 归档到 e2e/archive/ |
| 4 | Bundle 无预算 | 未设置 size limit | 添加 budget 警告配置 |
| 5 | 词数计算不准确 | 空字符串计为 1 | 修复边界情况 |

---

## 一、日志处理：创建轻量 logger 工具

### 1.1 设计方案

创建 `src/utils/logger.ts`，支持 dev/prod 环境区分：
- 开发环境：输出所有日志
- 生产环境：只输出 error 级别日志

### 1.2 实现代码

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

### 1.3 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/utils/logger.ts` | 新建 |
| `src/stores/blocks.ts` | 10 处 console.* → logger.* |
| `src/components/Block/index.vue` | 1 处 console.* → logger.* |
| `src/components/Editor.vue` | 2 处 console.* → logger.* |
| `src/utils/block-helpers.ts` | 1 处 console.* → logger.* |
| `src/components/Backlinks.vue` | 4 处 console.* → logger.* |
| `src/router/routes.ts` | 4 处 console.* → logger.* |

---

## 二、文件拆分：保守拆分

### 2.1 blocks.ts 拆分

**目标**：779行 → <600行

**抽取内容**：
- 树遍历函数：`getAncestors`、`getDescendants`、`getSiblings`
- 位置计算函数：`calcInsertPosition`
- 验证函数：`isValidMove`

**修改文件**：
- 扩展 `src/utils/block-helpers.ts`
- 修改 `src/stores/blocks.ts`

### 2.2 Block/index.vue 拆分

**目标**：649行 → <500行

**抽取内容**：
- 拖拽命中测试：`findDropTarget`
- 放置指示器渲染：`renderDropIndicator`、`getOrCreateIndicator`
- 缩进计算：`indentWidth` 计算

**修改文件**：
- 创建 `src/composables/useDragDrop.ts`
- 修改 `src/components/Block/index.vue`

---

## 三、E2E 目录整理

### 3.1 归档方案

- 创建 `e2e/archive/` 目录
- 将 Python 脚本和调试文件移入
- 只保留 Playwright 正式测试

### 3.2 创建文档

创建 `e2e/README.md`：
```markdown
# E2E 测试目录

## 正式测试
- `*.test.ts` - Playwright E2E 测试

## 归档文件
- `archive/` - 历史调试脚本和工具
```

---

## 四、Bundle Budget 配置

### 4.1 修改 vite.config.ts

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

### 4.2 修改 vue.config.js (如果存在)

```javascript
module.exports = {
  transpileDependencies: true,
  configureWebpack: {
    optimization: {
      splitChunks: {
        chunks: 'all'
      }
    }
  },
  chainWebpack: config => {
    if (process.env.NODE_ENV === 'production') {
      config.performance
        .maxEntrypointSize(500000)
        .maxAssetSize(500000)
    }
  }
}
```

---

## 五、词数计算修复

### 5.1 当前问题

`src/storage/indexedDB.ts` 中 `computeWordCount` 函数：
```typescript
// 当前代码（有问题）
function computeWordCount(content: string): number {
  return content.split(/\s+/).length // 空字符串返回 1
}
```

### 5.2 修复方案

```typescript
// 修复后
function computeWordCount(content: string): number {
  if (!content || !content.trim()) return 0
  return content.trim().split(/\s+/).length
}
```

---

## 六、实施顺序

| 顺序 | 任务 | 原因 |
|------|------|------|
| 1 | 创建 logger.ts | 建立工具基础 |
| 2 | 替换 console.* 调用 | 批量替换 22 处 |
| 3 | 修复词数计算 | 逻辑简单 |
| 4 | E2E 目录整理 | 清理工作 |
| 5 | 拆分 blocks.ts | 风险较高 |
| 6 | 拆分 Block/index.vue | 在 blocks.ts 后 |
| 7 | 配置 Bundle Budget | 可选最后一步 |

---

## 七、验收标准

- [ ] `npm run build` 成功
- [ ] `npm test` 所有测试通过
- [ ] `npm run lint` 无新增错误
- [ ] `npx playwright test e2e/routing.test.ts` 全部通过
- [ ] blocks.ts 行数 < 600
- [ ] Block/index.vue 行数 < 500
- [ ] e2e 目录只包含正式测试
- [ ] `npm run build` 不触发 budget 警告
