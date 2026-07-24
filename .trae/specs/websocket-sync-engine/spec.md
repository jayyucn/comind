# WebSocket 同步引擎 - 产品需求文档 (PRD)

## Overview
- **Summary**: 实现 PC 端（Tauri Desktop）与 Android 端（Tauri Mobile）之间的局域网 WebSocket 直连同步，采用实体级 LWW（Last-Write-Wins）行级合并策略。MVP 阶段完成传输层搭建，支持实时推送和双向全量同步。
- **Purpose**: 解决用户在 PC 和 Android 设备间无缝同步笔记数据的需求，无需云服务，低延迟，数据本地可控。
- **Target Users**: comind 应用的多设备用户（PC + Android）

## Goals
- 实现 PC 端 WebSocket Server，支持 QR 码配对
- 实现 Android 端 WebSocket Client，支持扫码连接
- 实现 7 张表（Block、Page、Link、Property、DateRef、RelationshipType、Template）的双向同步
- 实现 LWW 行级合并，保证数据收敛
- 实现断线重连后双向全量同步，确保离线编辑不丢失
- 实现实时推送 + 30 分钟定时全量校验

## Non-Goals (Out of Scope)
- 云端中转同步
- Patch Sync（只传变更字段）
- 冲突保留副本
- 多数据库同时同步
- 多设备实时转发（PC 中继路由）
- Domain Event / OpLog / HLC（混合逻辑时钟）
- ws:// 加密、双向认证、DB 静态加密

## Background & Context
- 项目采用 Tauri 2.x 框架，Rust 核心逻辑在 comind-core crate
- 数据层已完成改造，所有同步表已有 `version`、`deleted_at`、`updated_at` 字段（UserTemplate 需补）
- SQLite 使用 WAL 模式，支持多连接并发读写
- LWW 采用 `(version, updated_at)` 字典序比较，保证收敛性

## Functional Requirements
- **FR-1**: PC 端启动 WebSocket Server，生成配对 QR 码
- **FR-2**: Android 端扫码解析 ws 地址和 token，建立连接
- **FR-3**: 配对成功后执行双向全量同步（7 张表）
- **FR-4**: PC 端编辑后实时推送给 Android
- **FR-5**: Android 端编辑后实时推送给 PC
- **FR-6**: 断线重连后执行双向全量同步，确保离线编辑不丢失
- **FR-7**: 每 30 分钟执行双向定时全量校验
- **FR-8**: 支持软删除同步和传播
- **FR-9**: 支持取消已配对设备

## Non-Functional Requirements
- **NFR-1**: 全量同步支持循环外键（Page↔Block），通过 `defer_foreign_keys` 保证导入成功
- **NFR-2**: WebSocket 消息大小限制：单行 ≤ 1 MiB，单消息 ≤ 4 MiB，WS 上限 8 MiB
- **NFR-3**: 心跳间隔 30 秒，超时 90 秒判定断连
- **NFR-4**: 指数退避重连（1s→2s→4s→8s→16s→30s），连续 3 次失败后停止
- **NFR-5**: MVP 仅支持 1 台 Android 配对
- **NFR-6**: RowPayload 包含 `id, data, version, updated_at, deleted_at` 字段，LWW 按 `(version, updated_at)` 字典序比较

## Constraints
- **Technical**: Tauri 2.x, Rust, tokio-tungstenite, SQLite
- **Business**: MVP 阶段完成，无额外预算
- **Dependencies**: `tokio-tungstenite`, `qrcode`, `uuid`

## Assumptions
- LAN 环境下 NTP 时钟同步可靠（漂移 < 50ms）
- MVP 数据量 < 10000 行，全量同步内存累积可接受
- 专用 SQLite 连接与主应用连接在 WAL 模式下并发安全

## Acceptance Criteria

### AC-1: PC 端启动后显示 QR 码
- **Given**: PC 端应用启动，SyncServer 正常运行
- **When**: 用户打开设置 → 数据管理 → 设备同步
- **Then**: 显示未配对状态和「显示配对二维码」按钮，点击后弹出 QR 码
- **Verification**: `human-judgment`
- **Notes**: QR 码 5 分钟过期，过期后显示刷新按钮

### AC-2: Android 扫码后配对成功
- **Given**: PC 端显示 QR 码，Android 端打开扫码入口
- **When**: Android 扫码成功
- **Then**: 配对成功，PC 端 QR 弹窗关闭，显示已配对设备列表
- **Verification**: `human-judgment`

### AC-3: 全量同步 - 7 张表数据一致
- **Given**: PC 端有完整数据（7 张表），Android 端为空
- **When**: 配对成功后执行全量同步
- **Then**: Android 端 7 张表数据与 PC 端一致（行数、内容、软删除状态）
- **Verification**: `programmatic`

### AC-4: 实时同步 - PC 编辑 → Android 即时看到
- **Given**: 已配对且连接正常
- **When**: PC 端编辑 Block 内容
- **Then**: Android 端在 500ms 内看到更新
- **Verification**: `human-judgment`

### AC-5: 实时同步 - Android 编辑 → PC 即时看到
- **Given**: 已配对且连接正常
- **When**: Android 端编辑 Block 内容
- **Then**: PC 端在 500ms 内看到更新
- **Verification**: `human-judgment`

### AC-6: 软删除同步
- **Given**: 已配对且连接正常
- **When**: PC 端删除 Block（软删除）
- **Then**: Android 端对应 Block 消失（查询自动过滤）
- **Verification**: `human-judgment`

### AC-7: 断线重连 → 双向全量同步 → 数据一致
- **Given**: 已配对且正在同步
- **When**: WiFi 断开后恢复连接
- **Then**: 自动触发双向全量同步，两端数据最终一致
- **Verification**: `human-judgment`

### AC-8: 离线编辑不丢失
- **Given**: PC 端关闭，Android 端离线编辑 Block
- **When**: PC 端重启，Android 端重连成功
- **Then**: PC 端收到 Android 的离线编辑内容，两端数据一致
- **Verification**: `human-judgment`

### AC-9: 定时全量校验 - 30 分钟自动双向校验
- **Given**: 已配对且连接正常
- **When**: 30 分钟后
- **Then**: 自动执行双向全量校验，补齐遗漏数据
- **Verification**: `programmatic`

## Open Questions
- [x] BlockVersion 是否同步 → 不同步，Phase 2
- [x] RelationshipType / UserTemplate 是否同步 → 同步，扩为 7 张表
- [x] UserTemplate 是否需要补 version + deleted_at → 需要
- [x] client_id 生成与持久化 → UUID v4，存 config.json
- [x] LWW 比较规则 → (version, updated_at) 字典序
- [x] 重连后同步策略 → 双向全量重传
- [x] 多设备策略 → MVP 限 1 台
- [x] 多数据库策略 → MVP 单 DB
- [x] 本地变更检测 → Command 层显式钩子
- [x] 全量同步 FK 冲突 → defer_foreign_keys + 单事务
- [x] 消息大小限制 → 三重限制 + 动态拆分
- [x] 安全模型 → bind 特定接口 + 速率限制 + QR 销毁
- [x] QR 生成位置 → 后端生成 base64 图片

## Resolved Decisions
| 决策项 | 最终选择 | 拷问轮次 |
|--------|----------|----------|
| Android 路线 | Tauri 2.0 Mobile | Q1 |
| 同步通道 | 局域网 WebSocket 直连 | Q1 |
| 冲突策略 | LWW 行级覆盖（version + updated_at） | Q2 |
| 重连后同步 | 双向全量重传 | Q7 |
| 多设备 | MVP 限 1 台配对（F4+G1） | Q7 |
| 多数据库 | MVP 单 DB，删除伪需求描述 | Q8 |
| 本地变更检测 | Command 层显式钩子（方案 2） | Q9 |
| debounce 粒度 | per-table-per-row，跨表同 tick flush | Q9 |
| 全量同步 FK | 累积批次 + 单事务 + defer_foreign_keys | Q10 |
| 消息大小限制 | 三重限制 + 动态拆分 | Q5 |
| 安全模型 | bind 特定接口 + 速率限制 + QR 销毁 | Q5 |
