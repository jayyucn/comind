# comind

一个基于 Vue 3 的本地优先的块编辑器和知识管理应用。

## 项目结构

```
comind/
├── comind/                 # 前端应用
│   ├── src/
│   │   ├── components/    # Vue 组件
│   │   ├── composables/   # Vue 组合函数
│   │   ├── stores/        # Pinia 状态管理
│   │   ├── storage/       # 存储层
│   │   └── utils/         # 工具函数
│   └── package.json
└── docs/                  # 项目文档
```

## 技术栈

- **前端框架**: Vue 3 (Composition API)
- **状态管理**: Pinia
- **路由**: Vue Router
- **富文本编辑**: TipTap
- **本地存储**: Dexie (IndexedDB)
- **拖拽排序**: vue-draggable-plus
- **构建工具**: Vite
- **测试框架**: Vitest + Playwright

## 快速开始

### 安装依赖

```bash
cd comind
npm install
```

### 开发模式

```bash
npm run dev
```

### 生产构建

```bash
npm run build
npm run preview
```

### 测试

```bash
# 运行单元测试
npm test

# 运行 E2E 测试
npx playwright test

# 测试覆盖率
npm run test:coverage
```

## 核心功能

- **块编辑**: 支持块的创建、编辑、拆分、合并、删除
- **块树结构**: 支持块的嵌套、缩进、拖拽排序
- **日记系统**: 自动创建每日日记，按日期管理
- **Wiki 链接**: 支持 `[[Page Name]]` 格式的内部链接
- **标签系统**: 支持 `#tag` 标签和标签过滤
- **反向链接**: 自动显示引用当前页面的链接
- **收藏功能**: 快速访问常用页面
- **最近页面**: 显示最近访问的页面

## 文档

详细文档位于 [docs/](docs/) 目录：

- [SPEC.md](docs/SPEC.md) - 项目规格说明
- [data-model.md](docs/data-model.md) - 数据模型设计
- [dev-guide.md](docs/dev-guide.md) - 开发指南
- [tech-selection.md](docs/tech-selection.md) - 技术选型说明
- [functional-design-spec.md](docs/functional-design-spec.md) - 功能设计规格

## 开发指南

详见 [comind/README.md](comind/README.md)

## License

MIT
