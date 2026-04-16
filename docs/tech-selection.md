# 技术选型规范

> 版本：v0.2
> 日期：2026-04-16
> 状态：评审完成，已确认

---

## 1. 选型原则

- **成熟度优先** — 选经过大规模生产验证的技术
- **生态兼容** — 与 Logseq 技术栈保持一致，降低踩坑成本
- **本地优先** — 数据存储本地化，不依赖云服务
- **可替换性** — 核心模块抽象接口，后续可平滑替换实现

---

## 2. 技术栈总览

| 维度 | 选择 | 依据 |
|------|------|------|
| 前端框架 | React + TypeScript | 生态最成熟，Logseq 在用 |
| 状态管理 | Zustand | 极简 Hook 风格，体积小(~1KB) |
| 构建工具 | Vite | 秒级启动，HMR 顺滑 |
| 编辑器内核 | tiptap (ProseMirror) | ProseMirror 的 React 封装，开箱即用 |
| 本地数据库 | better-sqlite3 | 同步 API，性能好 |

---

## 3. 选型详细说明

### 3.1 前端框架：React + TypeScript

**选项对比：**

| 选项 | 成熟度 | 生态 | 学习成本 | 适合场景 |
|------|--------|------|----------|----------|
| React + TypeScript | ⭐⭐⭐⭐⭐ | 极其成熟 | 中等 | 复杂交互应用 |
| Vue 3 + TypeScript | ⭐⭐⭐⭐ | 成熟 | 较低 | 中等复杂度 |
| Svelte | ⭐⭐⭐ | 新兴 | 低 | 轻量快速开发 |

**选择理由：**
- Logseq 本身基于 React，技术兼容性好
- 社区资源最丰富，遇到问题容易搜到答案
- 周边库（状态管理、测试、构建）最成熟
- 长期维护风险低

---

### 3.2 状态管理：Zustand

**选项对比：**

| 选项 | 特点 | 适合场景 |
|------|------|----------|
| Zustand | 极简，Hook 风格 | 轻量首选 |
| Jotai | 原子化，React 协程友好 | 需要细粒度订阅 |
| Redux Toolkit | 功能全，样板代码多 | 大型团队项目 |
| Context + useReducer | React 内置 | 简单场景 |

**选择理由：**
- 极简 API，和 React Hook 风格一致
- 足够满足 Block/Page/Link 的状态管理需求
- 体积小（~1KB）
- Logseq 也在用（Jotai 方案，切过来成本不高）

---

### 3.3 构建工具：Vite

**选项对比：**

| 选项 | 特点 |
|------|------|
| Vite | 快，开发体验好，Vue 出品但对 React 支持也很好 |
| Webpack | 成熟，但配置繁琐 |
| esbuild / rollup | 偏底层，更多是底层工具 |

**选择理由：**
- 开发服务器启动快（秒级）
- Hot Module Replacement 体验顺滑
- 社区主流，下一代默认选择
- 对 TypeScript 支持好

---

### 3.4 编辑器内核：tiptap (ProseMirror)

**选项对比：**

| 选项 | 特点 | 适合场景 |
|------|------|----------|
| ProseMirror | 学术界工业级，Logseq 在用 | 首选 |
| CodeMirror 6 | 代码编辑器强，Markdown 支持一般 | 偏代码场景 |
| Monaco | VS Code 同源，重量级 | 偏代码场景 |
| Draft.js / Slate | Facebook/Medium 出品，API 较土 | 不推荐 |
| tiptap | ProseMirror 的 React 封装 | 开箱即用 |

**选择理由：**
- 基于 ProseMirror，Logseq 验证过，大纲体验好
- 支持树状文档结构（和我们的数据模型天然匹配）
- 插件生态丰富
- tiptap 开箱即用的 React 组件，节省 30% 初始工作量
- 底层还是 ProseMirror，需要时可以直接访问底层 API

---

### 3.5 本地数据库：better-sqlite3

**选项对比：**

| 选项 | 特点 | 适合场景 |
|------|------|----------|
| better-sqlite3 | 同步 API，性能好 | 首选（Electron/Node 端） |
| sql.js | 纯 JS，无 Native 依赖 | Electron 之外的跨平台 |
| IndexedDB | 浏览器内置，API 较土 | 轻量数据 |

**选择理由：**
- 同步 API，书写流畅，不需要 async/await 嵌套
- 性能最好
- Logseq 在用，已验证
- **注意**：只能用于 Electron/Node 端，前端用 sql.js 桥接或 IPC 通信

---

## 4. 技术架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      React + TypeScript                     │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐  │
│  │   Zustand   │   │   tiptap    │   │   React Router  │  │
│  │  (状态管理)  │   │  (编辑器)   │   │    (路由)       │  │
│  └─────────────┘   └─────────────┘   └─────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                      IPC / Context Bridge                   │
├─────────────────────────────────────────────────────────────┤
│                    Electron Main Process                     │
│  ┌─────────────────┐   ┌────────────────────────────────┐  │
│  │  better-sqlite3  │   │      File System (Markdown)    │  │
│  │   (本地数据库)   │   │        (pages/, assets/)       │  │
│  └─────────────────┘   └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. 待确认事项

| 事项 | 说明 |
|------|------|
| SQLite 前端桥接 | sql.js 直接在前端 vs IPC 通信到主进程 |
| 数据库迁移策略 | SQLite Schema 版本管理 |
| tiptap 自定义节点 | Block/Page/Property/Link 如何映射到编辑器节点 |

---

## 6. SQLite 前端桥接方案

### 6.1 方案对比

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **方案 A：IPC 通信** | 前端通过 Electron IPC 调用主进程的 better-sqlite3 | 同步 API 性能好，数据不离开主进程，安全 | 每次查询都有 IPC 开销 |
| **方案 B：sql.js（纯 JS）** | 前端直接运行 sql.js，WebAssembly 加载 SQLite | 无 IPC 开销，无 Native 依赖，跨平台 | 内存占用高，首次加载慢，大数据量性能差 |
| **方案 C：Preload 暴露 API** | 主进程封装数据库操作，通过 preload 暴露有限 API | 安全可控，减少 IPC 往返 | 需要定义清晰的 API 接口 |

### 6.2 方案 A：IPC 通信（推荐）

**架构：**

```
React 前端                    Electron 主进程
     │                              │
     │  ipcRenderer.invoke          │
     │ ─────────────────────────►  │
     │                              │  better-sqlite3
     │                              │  执行 SQL
     │  ◄─────────────────────────  │
     │   返回结果                   │
```

**IPC 通道设计：**

```typescript
// preload.ts
contextBridge.exposeInMainWorld('comind', {
  db: {
    query: (sql: string, params?: any[]) => ipcRenderer.invoke('db:query', sql, params),
    run: (sql: string, params?: any[]) => ipcRenderer.invoke('db:run', sql, params),
    get: (sql: string, params?: any[]) => ipcRenderer.invoke('db:get', sql, params),
    all: (sql: string, params?: any[]) => ipcRenderer.invoke('db:all', sql, params),
  }
})
```

**主进程处理：**

```typescript
// main.ts
ipcMain.handle('db:query', async (event, sql, params) => {
  return db.prepare(sql).all(params)
})
```

**优化策略：**

- 批量操作：合并多个 SQL 为一个事务，减少 IPC 往返
- 连接池：主进程维护一个 SQLite 连接，所有前端请求复用
- 缓存：高频只读查询结果缓存在前端（Zustand）

---

### 6.3 方案 B：sql.js 备选

如果未来需要跨平台（如 Web-only、无 Electron），可考虑 sql.js：

- 首次加载：下载 ~1MB WASM 文件（约 500KB 压缩）
- 数据文件：从主进程读取 .db 文件内容，传给 sql.js 初始化
- 同步机制：主进程写入 Markdown 时通知前端刷新

---

## 7. 待确认事项

| 事项 | 说明 |
|------|------|
| 数据库迁移策略 | SQLite Schema 版本管理 |
| tiptap 自定义节点 | Block/Page/Property/Link 如何映射到编辑器节点 |
