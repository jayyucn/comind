# Phase 3.5 规范：版本化系统 + 云同步

> 版本：v0.2
> 日期：2026-06-29
> 状态：✅ 设计完成（版本化）/ ✅ 设计完成（云同步）
> 依赖：Phase 3（Tauri 壳 + SQLite 迁移 + Markdown 文件 IO）

***

## 0. 概述

### 0.1 范围

Phase 3.5 包含两个工作流：

| 工作流 | 状态 | Sprint |
|--------|------|--------|
| 版本化系统（Block 历史 + git diff 式对比） | ✅ 设计完成 | Sprint 5-6 |
| 云同步 M2（web ↔ 桌面自动同步） | ⏳ 设计待定 | Sprint 7-8 |

### 0.2 时间线

| Sprint | 周期 | 内容 |
|--------|------|------|
| Sprint 5 | Week 9-10 | 版本化 schema + 服务 + 双层防抖 |
| Sprint 6 | Week 11-12 | 版本化 UI（diff 抽屉 + hover 按钮 + restore） |
| Sprint 7 | Week 13-14 | 云同步后端（Rust 嵌入式服务 + WebSocket + mDNS） |
| Sprint 8 | Week 15-16 | 云同步客户端集成（前端同步客户端 + 设置页面 + 资产同步） |

### 0.3 与 Phase 3 的关系

**依赖关系**：
- Phase 3 完成 Tauri 壳 + SQLite 迁移 + Markdown IO + 性能优化
- Phase 3.5 在 Phase 3 交付的 SQLite 存储基础上构建版本化
- Phase 3.5 的云同步替代原 Phase 3 计划中的 M1 手动 JSON 导出/导入（已废弃）

**Phase 3 影响变更**：
- Phase 3 不再包含 web → 桌面迁移工具（M1 已废弃）
- Phase 3 上线的桌面应用：用户从空数据开始
- 已有 web 数据的用户需等 Phase 3.5 云同步才能跨端使用

### 0.4 关联文档

| 文档 | 说明 |
|------|------|
| [SPEC.md](../1-overview/SPEC.md) | 项目总规范，Phase 3 章节 |
| [storage-adapter.md](storage-adapter.md) | StorageAdapter 接口规范 |
| [core-layer.md](core-layer.md) | Core 层架构设计 |
| [storage-spec.md](storage-spec.md) | 存储格式规范 |

***

## 1. 版本化系统（设计完成）

### 1.1 核心决策摘要

| 决策点 | 选择 | 说明 |
|--------|------|------|
| 版本存储位置 | V1：SQLite 内部版本表 | 不依赖外部 git，自建版本系统 |
| 版本粒度 | G2：Block + 属性 + 出向关系 | 完整快照，diff 信号清晰 |
| 触发时机 | T2：双层防抖（详见 §1.3） | 失焦 + 显式 + 冷却，不轰炸 |
| 保留策略 | A2：分层保留 | 7d 全部 + 8-30d 每日首个 + 30d+ 每周首个 + 手动永久 |
| 哈希比对 | B2：G2 完整快照哈希 | 跳过无变更保存 |
| Block 级失焦 | C2：同 Page 内 Block 切换强制落盘 | 粒度对齐核心编辑单元 |
| 退出 bypass | 退出软件 bypass Layer 2 冷却 | 防止丢会话边界版本 |
| Restore 语义 | R1：前向 restore + restored_from 字段 | 历史只追加，永不破坏 |
| 悬空关系 | D2：标红显示 | restore 不阻塞，问题透明交给用户 |
| Diff 展示 | U2：侧栏抽屉 | 非阻塞，匹配 Notion/Obsidian 心智 |
| 入口形态 | E1：hover 按钮（主）+ SlashCommandMenu（辅）双入口 | view/edit 都可用主入口，edit 模式补充辅助入口 |

### 1.2 数据模型

#### 1.2.1 block_versions 表 schema

```typescript
interface BlockVersion {
  id: string                          // 版本 id（nanoid）
  block_id: string                    // 外键 → blocks.id
  version: number                     // 单调递增（per block，从 1 开始）
  snapshot: string                    // JSON 序列化的 G2 快照
  hash: string                        // snapshot 序列化后的 SHA-256
  message: string | null              // 用户填的 commit message（手动触发时）
  source: 'auto' | 'manual' | 'major_op' | 'app_exit' | 'restore'
  restored_from_version_id: string | null  // R1 还原链路
  created_at: number                  // 创建时间戳
}
```

**索引**：
- `(block_id, version)` 唯一索引
- `(block_id, created_at)` 时间序查询
- `(hash)` 用于去重判断（可选）

#### 1.2.2 G2 快照结构

`snapshot` 字段是 JSON 序列化后的字符串，结构：

```typescript
interface BlockSnapshot {
  block: {
    id: string
    content: string
    type: BlockType
    order: number
    parentId: string | null
    pageId: string
    deleted: boolean
    // ... Block 表所有字段
  }
  properties: Property[]              // 该 Block 的所有属性
  relationships: Relationship[]      // 从该 Block 出发的关系（不含入向）
}
```

**注意**：relationships 只快照出向关系（该 Block 作为 source 的关系），入向关系不快照。理由：入向关系属于 source Block 的版本范围，避免双写。

### 1.3 双层防抖架构

#### 1.3.1 设计原则

对标 Logseq 增量快照 + Obsidian 双层防抖逻辑，以「编辑不频繁存、停顿精准存、操作兜底存、重复不冗余存」为核心。

适配场景：块编辑/全文编辑、实时热更新、本地离线快照，轻量无负担。

#### 1.3.2 第一层：实时落盘防抖（内存 → SQLite blocks 表）

| 项 | 值 |
|----|----|
| 作用 | 控制磁盘高频写入，保障编辑流畅度，为快照生成做前置过滤 |
| 防抖类型 | 尾部后置防抖（Trailing Debounce） |
| 默认阈值 | 2 秒 |
| 触发逻辑 | 连续编辑时持续重置计时器；停止编辑满 2 秒，统一写入 SQLite blocks 表 |
| 强制落盘（跳过防抖） | 切换 Page、切换 Block（同 Page 内）、关闭 Page、退出软件、手动保存 |
| 极限节流 | 持续编辑超过 30 秒无停顿，强制自动落盘一次 |

#### 1.3.3 第二层：版本快照防抖（SQLite blocks 表 → SQLite block_versions 表）

| 项 | 值 |
|----|----|
| 作用 | 控制历史版本数量，避免冗余快照，精准留存有效修改记录 |
| 防抖类型 | 冷却间隔防抖（最小快照间隔锁） |
| 默认阈值 | 3 分钟 |
| 核心规则 | 同一个 Block，两次有效快照最小间隔 3 分钟；冷却期内的修改只落盘不生成版本 |
| 去重优化 | 落盘后比对前后 G2 快照的 SHA-256 哈希，无变更则跳过快照生成 |

#### 1.3.4 特殊场景快照豁免（bypass Layer 2 冷却）

以下场景无视 3 分钟冷却，立即生成快照：

1. **退出软件**：退出时对自上次版本后有改动的 Block 强制生成版本（防止丢会话边界）
2. **手动触发**：用户主动点「保存版本」，可填 commit message
3. **重大操作**：Block 重命名、批量块修改、内容还原（restore）、导入导出操作

**已删除规则**：原方案「软件启动：对离线变更文件生成初始快照」在 SQLite 架构下 moot（SQLite 始终一致，不存在「离线变更」），不实现。

#### 1.3.5 完整执行链路

```
用户编辑 → 2s 尾部防抖等待 → 停止编辑，写入 SQLite blocks 表
  → 哈希校验 G2 快照变更
  → 判断是否过 3 分钟快照冷却期
    → 是 → 生成历史快照（写 block_versions 表）
    → 否 → 静默跳过
  → 例外：退出软件 / 手动 / 重大操作 → 直接生成快照（bypass 冷却）
```

#### 1.3.6 无效操作过滤

纯空格、换行、光标移动等不触发落盘和快照。这避免了用户在编辑器中移动光标或敲入无意义空白时产生噪声版本记录。配合 §1.3.3 的哈希去重（内容无变更则跳过快照生成），形成双重过滤。

### 1.4 保留策略（A2 分层）

```
最近 7 天        → 保留全部版本
第 8-30 天      → 每天保留首个版本（其余清理）
30 天之后       → 每周保留首个版本（其余清理）
手动检查点      → 永久保留（不清理）
```

#### 1.4.1 清理任务

- 触发：应用启动时 + 每 24 小时定时
- 实现：SQL 查询 + 删除，事务包裹
- 配置项：保留窗口可配置（3 / 7 / 15 天可选，默认 7 天）

### 1.5 Restore 语义（R1 前向 restore）

#### 1.5.1 操作语义

restore v3（当前在 v5）= 创建 v6，内容 = v3 的快照副本。

```
v1 → v2 → v3 → v4 → v5（当前）
                 ↘ v6 = copy of v3, restored_from = v3.id
```

- 历史只追加，永不破坏
- v3 仍在历史里
- v6 的 `restored_from_version_id` 字段记 v3 的 id
- v6 的 `source` 字段 = `'restore'`

#### 1.5.2 悬空关系处理（D2）

restore Block A 的 v3 时，若其快照中的关系指向已删除的 Block B：

- **不阻塞 restore**
- 关系照常恢复，但目标 Block B 不存在
- UI 上该关系显示红色 `[[B]]（已删除）`
- 用户可后续手动决定：恢复 B 的最新版本 / 删除该悬空关系 / 保持现状

### 1.6 UI / UX

#### 1.6.1 入口（E1 hover-revealed 按钮）

- Block 行 hover 时显示一个历史图标（时钟 / `↶`）
- 位置：Block 行右侧（不挤占左侧 bullet 的拖拽 / 折叠功能）
- 点击 → 打开 diff 抽屉
- view 和 edit 模式都可用

**不引入的模式**：
- ❌ 右键菜单（全应用无 Block 级右键菜单先例）
- ❌ 常驻按钮（破坏 chrome-free 设计）
- ❌ SlashCommandMenu 唯一入口（view 模式不可用，硬伤）

#### 1.6.2 Diff 展示（U2 侧栏抽屉）

- 右侧抽屉滑出
- 左侧：版本列表（时间戳、source 标签、message、restored_from 标记）
- 右侧：diff 区域（双栏旧 / 新对比，或单栏 + 切换按钮）
- Page 仍可见，可继续编辑（非阻塞）
- 横向布局冲突：抽屉打开时 GraphView 等横向组件自动收起（落地时定）

#### 1.6.3 Diff 渲染

- 文本 diff：`jsdiff` 或 `diff-match-patch` 库，红绿渲染
- 属性变更：key/value 行级 diff
- 关系变更：added / removed / changed（type / strength）的行级 diff

### 1.7 Web 支持（WF1 决定 web 等同桌面）

#### 1.7.1 IndexedDB 加 block_versions

```typescript
// comind/src/storage/db.ts 扩展
export class ComindDB extends Dexie {
  // ... 现有表
  blockVersions!: Table<BlockVersionRecord, string>  // 新增
}
```

#### 1.7.2 业务层不动

- `BlockService.save()` 调 `versionRepository.create(snapshot)` —— `versionRepository` 是接口
- `IndexedDBVersionRepository` 用 Dexie 实现
- `SqliteVersionRepository`（Phase 3.5 桌面）用 `invoke('sqlite_exec', ...)` 实现
- 业务逻辑（触发时机、保留策略、restore）在 service 层，与 adapter 无关

### 1.8 迁移策略

- 现有 IndexedDB 数据迁到 SQLite 时（Phase 3 Sprint 2），**不创建任何版本记录**
- 迁移完成后，每个 Block 第一次触发版本规则时，创建 v1
- 用户感知：迁移后没有历史，从 v1 开始累积——需在迁移日志中说明

### 1.9 配置项（可自定义）

| 参数 | 默认值 | 可选值 |
|------|--------|--------|
| 落盘防抖阈值 | 2 秒 | 1 / 2 / 3 秒 |
| 快照冷却间隔 | 3 分钟 | 2 / 3 / 5 分钟 |
| 保留窗口 | 7 天 | 3 / 7 / 15 天 |

***

## 2. 云同步 M2（局域网实时同步）

### 2.1 目标

- 替代废弃的 M1（手动 JSON 导出 / 导入）
- 局域网内 web（IndexedDB）与桌面（SQLite）自动双向同步
- 多设备同步（同一局域网，多端编辑）
- 解决 Phase 3 桌面应用上线时用户从空数据开始的问题
- 完全离线支持，联网后自动增量同步

### 2.2 核心决策摘要

| 决策点 | 选择 | 说明 |
|--------|------|------|
| 后端技术栈 | A1：Rust 嵌入式服务 | tokio + axum + tokio-tungstenite，无额外体积 |
| 账户系统 | A4：无认证 | 局域网内无需认证，简化连接流程 |
| 同步协议 | P1：WebSocket（长连接） | 双向实时，低延迟，与 Tauri 原生兼容 |
| 冲突解决 | C1：Last-Write-Wins | 服务端时间戳权威，配合版本化系统保留历史 |
| 同步粒度 | G2：实体级事件同步 | 每个实体增删改作为独立事件，粒度适中 |
| 离线支持 | O1：完全离线 + 联网增量同步 | 客户端本地有完整数据，联网后增量同步 |
| 服务端存储 | S1：无持久化（纯广播） | 服务端只是广播器，不存储数据 |
| 时间戳权威 | T2：服务端时间 | 统一时间源，避免客户端时钟偏差 |
| 版本历史同步 | V1：不同步 | 版本历史仅本地存储，不增加同步负担 |
| 资产文件同步 | A3：HTTP 端点传输 | WebSocket 通知事件，HTTP 传输文件本体 |
| 服务发现 | D3：mDNS + 手动输入 | 自动发现优先，手动输入兜底 |
| 同步范围 | R1：全部同步 | Block、Page、Link、Property、RelationshipType、Template 全部同步 |
| 连接管理 | M2：有状态轻量管理 | 记录设备信息、心跳检测、在线设备列表 |
| 初始同步 | I1：服务端主动推送快照 | 新客户端连接后立即推送完整快照 |
| 配置管理 | C3：设置页面 | 应用内图形界面管理配置 |
| 错误处理 | E3：混合策略 | 可恢复错误自动重试，不可恢复错误提示用户 |

### 2.3 架构设计

#### 2.3.1 总体架构

```
局域网环境
┌─────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  PC-A（服务端模式）                                        │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  Comind Desktop App (Tauri + Rust)                 │  │   │
│  │  │  ├── Tauri Shell                                   │  │   │
│  │  │  ├── SQLite（真相源）                              │  │   │
│  │  │  └── Embedded Sync Server                          │  │   │
│  │  │      ├── WebSocket Server (tokio-tungstenite)      │  │   │
│  │  │      │   └── 监听 192.168.1.xxx:8080               │  │   │
│  │  │      ├── mDNS Registration (_comind-sync._tcp)     │  │   │
│  │  │      └── HTTP Server (axum)                        │  │   │
│  │  │          └── /assets/:filename (文件上传下载)       │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│              ┌───────────────┼───────────────┐                   │
│              ▼               ▼               ▼                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  PC-B（客户端模式）                                        │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  Comind Desktop App (Tauri + Rust)                 │  │   │
│  │  │  ├── Tauri Shell                                   │  │   │
│  │  │  ├── SQLite（本地缓存）                             │  │   │
│  │  │  └── Sync Client                                   │  │   │
│  │  │      ├── WebSocket Client                          │  │   │
│  │  │      │   └── 连接 ws://192.168.1.xxx:8080          │  │   │
│  │  │      └── HTTP Client                               │  │   │
│  │  │          └── GET/POST /assets/:filename            │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Web 端（浏览器）                                          │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  Comind Web App (Vue + TypeScript)                 │  │   │
│  │  │  ├── IndexedDB（本地缓存）                          │  │   │
│  │  └── Sync Client                                      │  │   │
│  │      ├── WebSocket Client                             │  │   │
│  │      │   └── 连接 ws://192.168.1.xxx:8080             │  │   │
│  │      └── HTTP Client                                  │  │   │
│  │          └── GET/POST /assets/:filename               │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

#### 2.3.2 核心数据流

```
客户端编辑 → 写入本地存储 → 生成事件 → WebSocket 发送 → 服务端广播 → 其他客户端接收 → 写入本地存储
                                              ↓
                                        服务端生成时间戳
```

### 2.4 同步事件格式

```typescript
type SyncEvent =
  // Block
  | { type: 'block_created';   payload: Block;  updatedAt: number }
  | { type: 'block_updated';   payload: Block;  updatedAt: number }
  | { type: 'block_deleted';   payload: { id: string }; updatedAt: number }
  // Page
  | { type: 'page_created';    payload: Page;   updatedAt: number }
  | { type: 'page_updated';    payload: Page;   updatedAt: number }
  | { type: 'page_deleted';    payload: { id: string }; updatedAt: number }
  // Link
  | { type: 'link_created';    payload: Link;   updatedAt: number }
  | { type: 'link_deleted';    payload: { id: string }; updatedAt: number }
  // Property
  | { type: 'property_created';payload: Property; updatedAt: number }
  | { type: 'property_updated';payload: Property; updatedAt: number }
  | { type: 'property_deleted';payload: { id: string }; updatedAt: number }
  // RelationshipType
  | { type: 'relationship_type_created';  payload: RelationshipType; updatedAt: number }
  | { type: 'relationship_type_updated';  payload: RelationshipType; updatedAt: number }
  | { type: 'relationship_type_deleted';  payload: { id: string }; updatedAt: number }
  // Template
  | { type: 'template_created';           payload: UserTemplate; updatedAt: number }
  | { type: 'template_updated';           payload: UserTemplate; updatedAt: number }
  | { type: 'template_deleted';           payload: { id: string }; updatedAt: number }
  // 资产文件
  | { type: 'asset_added';                payload: { filename: string; size: number }; updatedAt: number }
  | { type: 'asset_deleted';              payload: { filename: string }; updatedAt: number }
  // 初始快照
  | { type: 'initial_snapshot';           payload: FullDataSnapshot; updatedAt: number }
  // 心跳
  | { type: 'ping' }
  | { type: 'pong' }
  // 设备信息
  | { type: 'device_info';                payload: { deviceId: string; deviceName: string; deviceType: 'desktop' | 'web'; hasData: boolean } }
  | { type: 'snapshot_ack';               payload: { receivedAt: number } }
```

```typescript
interface FullDataSnapshot {
  pages: Page[]
  blocks: Block[]
  links: Link[]
  properties: Property[]
  relationshipTypes: RelationshipType[]
  templates: UserTemplate[]
}
```

### 2.5 同步流程

#### 2.5.1 客户端首次连接

1. 客户端连接到服务端（WebSocket 握手）
2. 客户端发送设备信息：
   ```typescript
   { type: 'device_info', payload: { deviceId, deviceName, deviceType, hasData: false } }
   ```
3. 服务端收到 `hasData: false` → 生成完整数据快照
4. 服务端推送快照：
   ```typescript
   { type: 'initial_snapshot', payload: { pages, blocks, links, ... }, updatedAt: 1719667200000 }
   ```
5. 客户端接收快照 → 写入本地存储（清空旧数据，写入新数据）
6. 客户端发送确认：
   ```typescript
   { type: 'snapshot_ack', payload: { receivedAt: 1719667200001 } }
   ```
7. 服务端确认 → 开始实时同步增量变更

#### 2.5.2 日常编辑同步

1. 客户端本地编辑
2. 写入本地存储（SQLite / IndexedDB）
3. 生成 SyncEvent，推入本地待发送队列
4. 通过 WebSocket 发送到服务端（不带 `updatedAt`）
5. 服务端接收 → 生成 `updatedAt`（服务端当前时间）
6. 服务端广播给所有客户端（包括发送方）
7. 其他客户端接收 → 比较 `updatedAt` → 若更新则写入本地
8. 发送方客户端：用服务端返回的时间戳更新本地记录

#### 2.5.3 离线重同步

1. 客户端重新连接到服务端
2. 客户端发送设备信息（`hasData: true`）
3. 服务端检测到客户端已有数据 → 跳过快照，直接进入增量同步
4. 客户端将本地离线期间的变更发送给服务端
5. 服务端应用变更，广播给其他客户端

### 2.6 冲突解决策略（LWW）

#### 2.6.1 规则

- 所有事件使用服务端时间戳作为权威时间
- 同一实体的多次更新，取 `updatedAt` 最大的版本
- 版本化系统保留本地所有变更历史，冲突丢失的数据可通过 restore 找回

#### 2.6.2 场景示例

```
时间线：
T0: 初始状态，Block-X v5（content: "Hello"）
T1: A 编辑为 "Hello World"，本地落盘，准备同步
T2: B 编辑为 "Hello Rust"，本地落盘，准备同步
T3: A 的变更先到达服务端，广播给 B
T4: B 的变更后到达服务端，服务端判定冲突（updatedAt T2 > T1）

处理：
- 服务端采用 LWW：B 的变更覆盖 A
- 版本化系统记录：A 的变更生成 v6（content: "Hello World"），B 的变更生成 v7（content: "Hello Rust"）
- 客户端 A 收到 B 的变更后，本地也生成 v6（内容与 v7 一致）

用户可在版本历史中查看 A 的变更（v6）和 B 的变更（v7），必要时可 restore
```

### 2.7 资产文件同步

#### 2.7.1 HTTP 端点

服务端开放两个 HTTP 端点：
- `GET  /assets/:filename` → 下载资产文件
- `POST /assets/:filename` → 上传资产文件

#### 2.7.2 同步流程

**新增资产：**
1. 客户端 A 新增资产文件（截图_20260416.png）
2. A 写入本地 `assets/` 目录
3. A 通过 WebSocket 广播事件：
   ```typescript
   { type: 'asset_added', payload: { filename: '截图_20260416.png', size: 102400 } }
   ```
4. 客户端 B 接收事件 → 通过 HTTP `GET /assets/截图_20260416.png` 下载文件
5. B 写入本地 `assets/` 目录

**删除资产：**
1. 客户端 A 删除资产文件
2. A 删除本地 `assets/` 目录中的文件
3. A 通过 WebSocket 广播事件：
   ```typescript
   { type: 'asset_deleted', payload: { filename: '截图_20260416.png' } }
   ```
4. 客户端 B 接收事件 → 删除本地 `assets/` 目录中的对应文件

### 2.8 服务端设计

#### 2.8.1 Rust 依赖

| 依赖 | 用途 |
|------|------|
| `tokio` | async runtime |
| `axum` | HTTP 服务器 |
| `tokio-tungstenite` | WebSocket 服务器 |
| `mdns-sd` | mDNS 服务注册 |
| `serde` | JSON 序列化/反序列化 |
| `uuid` | 设备 ID 生成 |

#### 2.8.2 连接管理

```typescript
interface ConnectedClient {
  id: string            // 连接 ID（随机生成）
  deviceId: string      // 设备唯一标识（客户端生成）
  deviceName: string    // 设备名称（如 "PC-B"）
  deviceType: 'desktop' | 'web'
  lastSeen: number      // 最后活跃时间戳
  connection: WebSocket // WebSocket 连接对象
}
```

#### 2.8.3 心跳机制

- 客户端每 30 秒发送一次心跳：`{ type: 'ping' }`
- 服务端响应：`{ type: 'pong' }`
- 服务端超过 90 秒未收到心跳 → 断开连接

### 2.9 客户端设计

#### 2.9.1 同步客户端（TypeScript）

- 实现 WebSocket 客户端
- 实现事件处理器（各类实体的增删改）
- 实现增量同步逻辑
- 实现初始快照接收和解析

#### 2.9.2 设备 ID

客户端首次启动时生成唯一设备 ID，存储在本地：

```typescript
// 生成设备 ID
const deviceId = uuid.v4()
// 存储在 localStorage（Web）或 Tauri store（桌面）
```

### 2.10 服务发现

#### 2.10.1 mDNS 自动发现

服务端启动时注册 mDNS 服务：
- 服务类型：`_comind-sync._tcp.local.`
- TXT 记录：`{ name: "PC-A", version: "1.0" }`

客户端连接流程：
1. 启动同步客户端
2. 发送 mDNS 查询，寻找 `_comind-sync._tcp.local.` 服务
3. 找到 → 自动连接
4. 未找到 → 显示「手动输入 IP 地址」表单

#### 2.10.2 手动输入

Web 端浏览器无法直接发送 mDNS 查询，仅支持手动输入 IP：

```
Server URL: [192.168.1.100:8080]
[Connect]
```

### 2.11 设置页面

#### 2.11.1 服务端模式配置

```
┌─────────────────────────────────────┐
│  Sync Settings                      │
│  ┌─────────────────────────────┐    │
│  │ Server Mode:                │    │
│  │ [✅ Enabled / ❌ Disabled]   │    │
│  ├─────────────────────────────┤    │
│  │ Network Settings:           │    │
│  │ Port: [8080]               │    │
│  │ IP: [192.168.1.100]        │    │
│  ├─────────────────────────────┤    │
│  │ Connected Devices:          │    │
│  │ • PC-B (Desktop)           │    │
│  │ • PC-C (Web)               │    │
│  ├─────────────────────────────┤    │
│  │ Client Mode:                │    │
│  │ Server URL: [________________] │
│  │ [Connect / Disconnect]      │    │
│  └─────────────────────────────┘    │
│  [Save]                           │    │
└─────────────────────────────────────┘
```

#### 2.11.2 配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| serverMode | disabled | 是否开启服务端模式 |
| port | 8080 | 服务端监听端口 |
| serverUrl | - | 客户端连接的服务端地址 |
| autoConnect | false | 启动时自动连接服务端 |

### 2.12 错误处理

#### 2.12.1 错误分类

| 错误类型 | 处理方式 | 示例 |
|----------|----------|------|
| 网络错误 | 自动重试（指数退避） | WebSocket 连接断开、HTTP 请求超时 |
| 数据格式错误 | 记录日志 + 跳过错误数据 + toast 提示 | 收到无法解析的事件格式 |
| 存储错误 | toast 提示 + 用户手动处理 | 磁盘空间不足、数据库损坏 |
| 冲突解决 | LWW 自动处理 + 版本历史保留 | 多设备同时编辑同一 Block |
| 服务端拒绝 | toast 提示 + 用户检查配置 | 端口被占用、权限不足 |

#### 2.12.2 重试策略

```
网络中断后的重试：
- 第 1 次：1 秒后重试
- 第 2 次：2 秒后重试
- 第 3 次：4 秒后重试
- 第 4 次：8 秒后重试
- 第 5 次及以上：10 秒后重试（最大间隔）

超过 10 次重试仍失败 → 提示用户「同步连接已断开，请检查网络」
```

### 2.13 影响范围

- **替换 M1**：原 Phase 3 计划的手动 JSON 导出/导入工具废弃
- **Phase 3 桌面应用无 web → 桌面迁移路径**：用户在 Phase 3 上线后需重新开始桌面端数据
- **版本历史不同步**：版本历史仅本地存储，跨设备无法查看
- **局域网限制**：同步仅在局域网内可用，无公网支持

### 2.14 关键风险

| 风险 | 影响 | 缓解方案 |
|------|------|----------|
| Rust 嵌入式服务增加构建复杂度 | 构建时间延长，依赖管理复杂 | 使用成熟 crate（tokio、axum），参考 Tauri 官方示例 |
| Web 端浏览器无法使用 mDNS | Web 端用户体验差 | Web 端仅支持手动输入 IP，桌面端支持自动发现 |
| 服务端无持久化导致重启后数据丢失 | 服务端重启后需重新获取快照 | 服务端只是广播器，数据存储在各客户端本地；重启后新客户端需要重新获取快照 |
| 局域网网络不稳定 | 同步中断频繁 | 客户端本地完整数据，网络恢复后自动重连同步 |
| 无认证导致安全风险 | 局域网内任何设备都可接入 | 仅局域网场景，风险可控；未来可扩展 Token 认证 |

***

## 3. Sprint 规划

### Sprint 5（Week 9-10）：版本化后端

**目标**：实现版本化 schema、服务、双层防抖

**任务清单**：

1. 数据模型
   - 设计 `block_versions` 表 schema（含索引）
   - 实现 `BlockVersionRepository` 接口
   - 实现 `IndexedDBVersionRepository`（web）
   - 实现 `SqliteVersionRepository`（桌面，调 `invoke('sqlite_exec', ...)`）

2. 服务层
   - 扩展 `BlockService.save()`：保存前写版本表
   - 实现 `BlockVersionService.create(snapshot, source)`
   - 实现 `BlockVersionService.list(blockId, filters)`
   - 实现 `BlockVersionService.restore(versionId)` —— R1 前向 restore
   - 实现保留策略清理任务

3. 双层防抖
   - 实现 Layer 1 落盘防抖（2 秒尾部 + 30 秒极限 + 强制落盘触发器）
   - 实现 Layer 2 快照冷却（3 分钟 + 哈希去重 + 豁免规则）

4. 哈希计算
   - G2 快照序列化（稳定字段顺序）
   - SHA-256 哈希计算

5. 测试
   - 单元测试：repository、service、防抖逻辑
   - 集成测试：save → version 创建链路

### Sprint 6（Week 11-12）：版本化 UI

**目标**：实现 diff 抽屉、hover 按钮、restore UI

**任务清单**：

1. 入口组件
   - `BlockHistoryButton.vue`：hover 显示，点击触发抽屉
   - 集成到 `Block/index.vue` 的 hover 事件
   - 快捷键 `Cmd/Ctrl + H`（选中 Block 时）

2. Diff 抽屉
   - `BlockHistoryDrawer.vue`：右侧抽屉
   - 版本列表组件（时间戳、source 标签、message、restored_from 标记）
   - Diff 渲染组件（文本 / 属性 / 关系三类 diff）
   - 横向布局适配（GraphView 自动收起逻辑）

3. Restore UI
   - 在版本列表项加「还原」按钮
   - Restore 二次确认 modal
   - Restore 后 toast 提示 + 跳转到新版本

4. 悬空关系渲染
   - 在关系渲染组件加 `is-dangling` class
   - 红色显示 + 「已删除」标签

5. 测试
   - 单元测试：UI 组件渲染
   - E2E 测试（Playwright）：hover → 抽屉 → 选两版本 → 看 diff → restore

### Sprint 7（Week 13-14）：云同步后端（设计待定）

**目标**：实现云同步服务端（具体任务取决于 §2.2 设计决策）

**任务清单**：⏳ 待 grill 后填充

### Sprint 8（Week 15-16）：云同步客户端集成（设计待定）

**目标**：在 web 和桌面应用集成云同步（具体任务取决于 §2.2 设计决策）

**任务清单**：⏳ 待 grill 后填充

***

## 4. 风险与开放问题

### 4.1 已识别风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Phase 3 桌面无迁移路径 | 早期用户从空数据开始，已有 web 数据无法搬 | Phase 3.5 云同步解决，但有时间窗 |
| 云同步设计未完成 | Sprint 7-8 任务无法规划 | Sprint 6 结束前必须完成 grill |
| 版本化与云同步交互未定 | 同步冲突时如何处理版本？ | 列入 §4.2 grill 清单 |
| 双层防抖的「失焦」定义未细化 | 落地时需明确各种边界（切到设置页算？切到外部应用算？） | Sprint 5 实现时定 |
| restore 频繁导致历史噪声 | 一连串「还原自 vX」 | UI 折叠 + 排序合并 |

### 4.2 待后续 grill 的决策清单

1. **云同步 M2 完整子决策**（§2.2 表格）
2. **版本化与云同步交互**：
   - 同步时是否同步版本历史？
   - 同步冲突时版本怎么处理？
   - 多设备同时编辑同一 Block 的版本如何合并？
3. **双层防抖的失焦边界细化**
4. **restore 频繁场景的 UI 优化**

***

## 5. 决策溯源

本规范基于 2026-06-29 grill-me 会话产生的决策树。每个决策点的论证详见会话记录。

| 决策点 | 选择 | 推翻的备选 |
|--------|------|-----------|
| Core 层归宿 | 选项 1：TS Core 不动，Rust = 能力层 | 选项 2（Rust 重写 Core）/ 选项 3（WASM） |
| Markdown ↔ SQLite 真相源 | 选项 A：SQLite 真相源 + Markdown 导入导出 | 选项 B（Markdown 真相源）/ 选项 C（双写） |
| 版本化实现 | V1：SQLite 内部版本表 | V2（git 仓库托底）/ V3（混合） |
| 版本粒度 | G2：Block + 属性 + 出向关系 | G1（仅 Block 行）/ G3（Page 树） |
| 触发时机 | T2：双层防抖（用户方案） | T1（每次保存）/ T3（纯显式） |
| 保留策略 | A2：分层保留 | A1（7 天扁平）/ A3（永久） |
| 哈希范围 | B2：G2 完整快照 | B1（仅 Block.content） |
| Block 级失焦 | C2：同 Page 内 Block 切换强制落盘 | C1（仅 Page 级失焦） |
| Restore 语义 | R1：前向 restore + restored_from | R2（破坏性回滚）/ R3（分支 fork） |
| 悬空关系 | D2：标红显示 | D1（拒绝 restore）/ D3（cascade restore） |
| Diff 展示 | U2：侧栏抽屉 | U1（modal）/ U3（内联）/ U4（独立路由） |
| 入口形态 | E1：hover-revealed 按钮 | E2（SlashCommandMenu）/ E3（右键菜单）/ E4（双入口） |
| 版本化排程 | S2：独立为 Phase 3.5 | S1（并入 Phase 3）/ S3（先行于 IndexedDB） |
| IPC 粒度 | IG4：裸 SQL + 原生能力命令 | IG1（裸 SQL）/ IG2（类型化 CRUD）/ IG3（领域级命令） |
| Web 应用命运 | WF1：web 与桌面双一等 | WF2（维护模式）/ WF3（弃用）/ WF4（功能分叉） |
| SQLite 库 | SQL4：rusqlite + tokio spawn_blocking | SQL1（rusqlite 同步）/ SQL2（tauri-plugin-sql）/ SQL3（sqlx） |
| 迁移工具 | M2：云同步（替代 M1） | M1（手动 JSON 导出/导入）/ M3（局域网 P2P）/ M4（共享文件） |
| Markdown 格式 | MD2：HTML 注释藏 Block ID | MD1（纯 Markdown）/ MD3（一 Block 一文件）/ MD4（结构化 frontmatter） |
| 导入路径 | I2：智能导入 | I1（纯 Markdown）/ I3（仅 comind 格式） |

***

## 6. 后续工作

1. **Phase 3 主决策树剩余分支**（✅ 已完成）：
   - 组件拆分：O1 — 不拆分，维持现状
   - 跨平台目标：P3 — Windows 先行，macOS/Linux 推迟
   - 打包 / 自动更新：B1 — Tauri Native + GitHub Releases
   - Tauri 权限模型：R2 — 宽松权限（暂不上架）
   - 以上决策已更新至 [SPEC.md](../1-overview/SPEC.md) §6.4 核心决策摘要

2. **Phase 3.5 云同步子决策**（✅ 已完成）：
   - 所有决策点已确定（后端栈、认证、同步协议、冲突解决等）
   - 版本化与云同步交互：版本历史不同步，冲突时 LWW 处理

3. **本规范待补充**：
   - Sprint 7-8 任务清单（✅ 已填充）
   - 版本化与云同步交互（✅ 已确定）

4. **待后续 grill 的决策清单**：
   - 双层防抖的失焦边界细化
   - restore 频繁场景的 UI 优化
