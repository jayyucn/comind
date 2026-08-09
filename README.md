# comind

一个本地优先（Local-First）的块编辑器与知识管理应用。\
**架构演进：** Phase 3 进行中 — 核心业务逻辑持续迁移至 **Rust / Tauri / WASM**。

## 项目结构

```
comind/
├── comind/                      # 主应用根目录
│   ├── src/                     # Vue 3 前端
│   │   ├── components/         # Vue 组件（Block / TaskHub / Ideas / Sidebar ...）
│   │   ├── composables/        # Vue 组合函数（useBlockQuery / useContentRenderer ...）
│   │   ├── stores/             # Pinia 状态（blocks / blockCard / taskView / savedFilter ...）
│   │   ├── wasm/               # WASM / Tauri CoreClient 封装（client.ts / tauri-client.ts）
│   │   ├── types/              # TS 类型定义（新增 blockQuery.ts）
│   │   └── utils/              # 工具函数（逐步迁移至 Rust）
│   ├── crates/                 # Rust Core（comind-core / comind-wasm）
│   │   └── comind-core/src/
│   │       ├── services/       # 6 个 Rust Service（content_parse / render_segment / block_projection / filter / notification / block）
│   │       ├── utils/          # 3 个工具模块（date_parser / journal_detect / recurrence）
│   │       ├── types/          # Rust 类型（新增 notification_config / block_card / task_view / saved_filter ...）
│   │       └── storage/        # SQLite / SQL.js 双实现
│   ├── src-tauri/              # Tauri 桌面壳（commands.rs 命令入口）
│   └── package.json
└── docs/                       # 项目文档
```

## 技术栈

**前端层：**
- **框架**: Vue 3 (Composition API) + TypeScript
- **状态管理**: Pinia
- **路由**: Vue Router
- **富文本编辑**: TipTap
- **UI 样式**: SCSS + 自研 Design Tokens（Indigo 系）

**核心层（Rust Core）：**
- **语言**: Rust 2021 Edition
- **存储后端**: SQLite（Tauri 桌面）/ SQL.js（Web WASM）双实现
- **桌面壳**: Tauri 2.x
- **Web 端**: WASM（wasm-pack）

**测试：**
- **单元测试**: Vitest
- **E2E**: Playwright
- **构建校验**: vue-tsc + vite build（编译检查强制规则）

## 快速开始

### 安装依赖

```bash
cd comind
npm install
```

### Web 开发模式

```bash
npm run dev
```

### Tauri 桌面开发模式（Rust 工具链已安装）

```bash
npm run tauri:dev          # 热重载；首次会编译 Rust Core
```

### 生产构建

```bash
npm run build              # Web 构建（vue-tsc 类型检查 + vite build）
npm run tauri:build        # 桌面端安装包（Windows NSIS / MSI）
```

### 测试

```bash
npm test                   # 单元测试（Vitest）
npx playwright test        # E2E 测试（Playwright）
npm run test:coverage      # 测试覆盖率
```

## 核心功能

### 编辑与内容

- **块编辑**: 支持块的创建、编辑、拆分、合并、删除
- **块树结构**: 支持块的嵌套、缩进、Gap-based 拖拽排序
- **块保存失败提示**: 🔴 红点 + 点击重试（[Block/index.vue](file:///D:/comind/comind/src/components/Block/index.vue)）
- **日记系统**: 自动创建每日日记，按日期管理（日记日期检测已迁移 Rust）
- **Wiki 链接**: 支持 `[[Page]]`、`((type))[[Page|别名]]` 带类型链接（解析已迁移 Rust `content_parse_service.rs`）
- **属性系统**: 支持 `key:: value` 语法（解析已迁移 Rust）
- **反向链接**: 自动显示引用当前页面的链接
- **概念图谱**: 可视化展示页面间的关系网络（AntV/G6），PNG 导出

### 任务管理（2026-08 新增）

- **✨ TaskHub 任务中心**（`/taskhub` 路由）
  - **Table 视图**: 可配置列的表格展示 BlockCard
  - **Board 看板**: 按 status 分列，支持点击切换状态 / 拖拽
  - **Calendar 日历**: 按月展示含日期引用的块
  - **声明式过滤**: 7 种操作符（hasAny / isEmpty / is / isNot / contains / before / after）
  - **TaskView 视图方案**: 可保存切换；**SavedFilter 过滤器预设**: 可复用条件
- **IdeasTodayPanel / IdeasHistoryList 任务项**: 未完成任务分组展示与快捷勾选

### 通知系统（2026-08 Rust 重构）

- 三类提醒开关：Schedule / Deadline / Overdue
- **静默时段**（默认 22:00–08:00）
- 浏览器通知可选启用
- 配置持久化于 `notification_config` 表（单行 id=1）

### 架构变更（Phase 3 TS→Rust 迁移）

| TS 端原实现 | → Rust 新位置 | 状态 |
| --- | --- | --- |
| `utils/parser.ts` | `services/content_parse_service.rs` | ✅ 已迁移 |
| `utils/quiet-hours.ts` | `services/notification_service.rs` | ✅ 已迁移 |
| `utils/date-ref.ts` 主逻辑 | `utils/date_parser.rs` | 🔄 进行中 |
| `utils/journal-detect.ts` | `utils/journal_detect.rs` | ✅ 已迁移 |
| `utils/recurrence.ts` | `utils/recurrence.rs` | ✅ 已迁移 |
| `composables/useContentRenderer.ts` 渲染拆分 | `services/render_segment_service.rs` | ✅ 已迁移 |
| —（新增） | `services/block_projection_service.rs` BlockCard 投影 | ✅ 新增 |
| —（新增） | `services/filter_service.rs` 块过滤 | ✅ 新增 |

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
