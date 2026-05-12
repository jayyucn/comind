# comind 前端应用

这是 comind 项目的前端应用，基于 Vue 3 + TypeScript + Vite 构建的本地块编辑器。

## 目录结构

```
src/
├── components/          # Vue 组件
│   ├── Block/          # 块编辑器组件
│   ├── Journal/        # 日记相关组件
│   ├── Page/           # 页面组件
│   ├── Sidebar/        # 侧边栏组件
│   ├── BlockList.vue   # 块列表（树形结构）
│   ├── Editor.vue      # 编辑器组件
│   └── ...
├── composables/         # Vue 组合函数
│   ├── useBlockTree.ts # 块树操作
│   ├── useContentRenderer.ts # 内容渲染
│   ├── useJournal.ts   # 日记功能
│   └── ...
├── stores/             # Pinia 状态管理
│   ├── blocks.ts       # 块状态
│   ├── editor.ts       # 编辑器状态
│   └── pages.ts        # 页面状态
├── storage/            # 存储层
│   └── indexedDB.ts    # IndexedDB 操作
├── utils/              # 工具函数
│   ├── parser.ts       # 内容解析
│   ├── block-helpers.ts # 块工具
│   └── ...
├── router/             # 路由配置
├── types/              # TypeScript 类型定义
├── App.vue             # 根组件
└── main.ts             # 应用入口
```

## 核心概念

### Page（页面）
- 每个页面有唯一 ID、标题和类型（普通页面或日记）
- 页面包含多个 Block

### Block（块）
- 内容的基本单元，支持嵌套结构
- 每个块有 content、parentId、pos、pageId 等属性
- 支持拖拽排序、缩进/反缩进

### WikiLink（维基链接）
- 使用 `[[Page Name]]` 格式创建内部链接
- 外部链接使用 `[[https://example.com]]` 格式
- 自动生成反向链接

### Tag（标签）
- 使用 `#tag` 格式添加标签
- 支持标签过滤

## 开发命令

```bash
# 开发模式
npm run dev

# 生产构建
npm run build

# 预览构建
npm run preview

# 类型检查
vue-tsc -b

# 单元测试
npm test

# 测试监听模式
npm run test:watch

# 测试覆盖率
npm run test:coverage

# ESLint 检查
npm run lint

# ESLint 自动修复
npm run lint:fix

# Playwright E2E 测试
npx playwright test
```

## 架构说明

### 数据流
```
用户交互 → 组件 → Composable → Store → Storage (IndexedDB)
                ↑_____________________________|
```

### 状态管理
- **blocks.ts**: 管理所有块的状态、CRUD 操作、树结构维护
- **pages.ts**: 管理页面列表、页面元数据
- **editor.ts**: 管理当前激活的编辑器状态

### 块树构建
使用 `useBlockTree.ts` 中的 `buildTree` 函数将扁平的块列表构建为树形结构，`syncTreeToStore` 将树结构同步回扁平列表。

## 测试

### 单元测试
- `src/stores/blocks.test.ts`: 块操作测试
- `src/composables/useBlockTree.test.ts`: 块树操作测试
- `src/utils/parser.test.ts`: 解析器测试

### E2E 测试
- `e2e/routing.test.ts`: 路由导航测试

## 质量门禁

提交代码前确保：
1. `npm run build` 构建通过
2. `npm test` 测试通过
3. `npm run lint` 无错误

## 设计文档

更多详细设计文档请参考项目根目录下的 [docs/](../docs/) 目录。
