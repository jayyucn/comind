# comind 前端应用

这是 comind 项目的前端应用，基于 Vue 3 + TypeScript + Vite 构建的本地块编辑器，支持 Tauri 2.x 桌面应用。

## 目录结构

```
src/
├── components/          # Vue 组件
│   ├── Block/          # 块编辑器组件
│   ├── Journal/        # 日记相关组件
│   ├── Page/           # 页面组件
│   ├── Sidebar/        # 侧边栏组件
│   ├── Settings/       # 设置相关组件
│   ├── BlockList.vue   # 块列表（树形结构）
│   ├── Editor.vue      # 编辑器组件
│   └── ...
├── composables/         # Vue 组合函数
│   ├── useBlockTree.ts # 块树操作
│   ├── useContentRenderer.ts # 内容渲染
│   ├── useJournal.ts   # 日记功能
│   ├── useRelationshipTypes.ts # 关系类型管理
│   └── ...
├── config/             # 配置文件
│   └── relationship-types-seed.ts # 默认关系类型种子数据
├── stores/             # Pinia 状态管理
│   ├── blocks.ts       # 块状态
│   ├── editor.ts       # 编辑器状态
│   └── pages.ts        # 页面状态
├── wasm/               # WASM 客户端
│   ├── client.ts       # 统一客户端入口
│   └── tauri-client.ts # Tauri 命令封装
├── storage/            # 存储层
├── utils/              # 工具函数
│   ├── parser.ts       # 内容解析
│   ├── block-helpers.ts # 块工具
│   └── ...
├── router/             # 路由配置
├── types/              # TypeScript 类型定义
├── App.vue             # 根组件
└── main.ts             # 应用入口

src-tauri/              # Tauri 后端
├── src/
│   ├── commands.rs     # Tauri 命令
│   ├── config.rs       # 应用配置
│   ├── markdown.rs     # Markdown 序列化/反序列化
│   ├── state.rs        # 状态管理（ConfigManager）
│   ├── sync.rs         # 自动同步管理
│   └── main.rs         # 应用入口
└── Cargo.toml          # Rust 依赖
```

## 核心概念

### Page（页面）
- 每个页面有唯一 ID、标题和类型（普通页面或日记）
- 页面包含多个 Block
- 页面的 `updated_at` 字段会在 Block 内容修改时自动更新

### Block（块）
- 内容的基本单元，支持嵌套结构
- 每个块有 content、parentId、pos、pageId 等属性
- 支持拖拽排序、缩进/反缩进

### WikiLink（维基链接）
- 使用 `[[Page Name]]` 格式创建内部链接
- 外部链接使用 `[[https://example.com]]` 格式
- 自动生成反向链接
- 支持关系类型：`((relationship-type))[[Target Page|Display Text]]`

### Tag（标签）
- 使用 `#tag` 格式添加标签
- 支持标签过滤

### RelationshipType（关系类型）
- 定义页面之间的关系类型（如"是一个"、"属于"、"依赖"等）
- 系统默认提供 8 种关系类型，用户可自定义
- 支持双向关系（正/反标签）
- 存储在后端数据库，前端和后端共享相同的种子数据

### 自动同步
- 支持 SQLite ↔ Markdown 双向同步
- 每隔 5 秒自动执行变更同步
- 应用启动首次同步、退出、窗口切换时执行全量同步
- 支持配置自动同步开关、同步目录和同步间隔

## 开发命令

```bash
# 前端开发模式
npm run dev

# 前端生产构建
npm run build

# 前端预览构建
npm run preview

# 前端类型检查
vue-tsc -b

# 前端单元测试
npm test

# 前端测试监听模式
npm run test:watch

# 前端测试覆盖率
npm run test:coverage

# 前端 ESLint 检查
npm run lint

# 前端 ESLint 自动修复
npm run lint:fix

# Playwright E2E 测试
npx playwright test

# Tauri 开发模式（前端 + 后端）
npm run tauri dev

# Tauri 生产构建
npm run tauri build

# Tauri 仅 Rust 编译检查
cd src-tauri && cargo check

# Tauri Rust 单元测试
cd src-tauri && cargo test
```

## 架构说明

### 数据流（Tauri 模式）
```
用户交互 → Vue 组件 → Composable → Store → WASM Client → Tauri Command → SQLite
                    ↑__________________________________________________________|
```

### 状态管理
- **blocks.ts**: 管理所有块的状态、CRUD 操作、树结构维护
- **pages.ts**: 管理页面列表、页面元数据
- **editor.ts**: 管理当前激活的编辑器状态

### 块树构建
使用 `useBlockTree.ts` 中的 `buildTree` 函数将扁平的块列表构建为树形结构，`syncTreeToStore` 将树结构同步回扁平列表。

### 同步机制
- **全量同步**：导出/导入所有数据（Page + Block + Property + RelationshipType + Template）
- **变更同步**：只同步 `updated_at > last_sync_time` 的内容
- **自动同步触发场景**：
  - 应用启动首次同步（全量）
  - 定时同步（每5秒，变更同步）
  - 应用退出（全量）
  - 窗口最小化/切换到后台（变更同步）
  - 窗口恢复/切换到前台（全量，距上次全量同步超过1小时）
  - 用户手动点击"立即同步"（全量）
  - 页面保存后（防抖5秒，变更同步）

### 配置管理
- 使用 `ConfigManager` 基于 `Mutex` 管理配置的并发访问
- 支持配置版本迁移，确保默认值变更时自动更新旧配置

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
4. `cd src-tauri && cargo check` Rust 编译检查通过

## 设计文档

更多详细设计文档请参考：
- SQLite ↔ Markdown 转换功能：[sqlite-markdown-conversion.md](.trae/documents/sqlite-markdown-conversion.md)
