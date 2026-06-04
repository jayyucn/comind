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
- **概念图谱**: 可视化展示页面间的关系网络（使用 AntV/G6）
- **关系类型链接**: 支持 `[[Page]]^(type)` 语法，预定义多种关系类型
- **关系类型菜单**: 支持模糊搜索的关系类型选择菜单
- **关系类型同步**: 页面内多 Block 关系类型自动同步
- **图谱 PNG 导出**: 支持导出概念图谱为 PNG 图片

## 文档

详细文档位于 [docs/](docs/) 目录：

- [docs/README.md](docs/README.md) - 文档总索引
- [docs/1-overview/](docs/1-overview/) - 项目概览
- [docs/2-architecture/](docs/2-architecture/) - 架构设计
- [docs/3-features/](docs/3-features/) - 功能规格
- [docs/4-ui/](docs/4-ui/) - UI/UX 设计
- [docs/5-development/](docs/5-development/) - 开发指南
- [docs/6-reports/](docs/6-reports/) - 验证报告
- [docs/7-sidebar/](docs/7-sidebar/) - 侧边栏
- [docs/sort/](docs/sort/) - 排序功能
- [docs/superpowers/](docs/superpowers/) - 能力增强

## 开发指南

详见 [comind/README.md](comind/README.md)

## License

MIT
