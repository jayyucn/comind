# Phase 3.5 - 版本化系统 - 执行规范

## Overview
- **Summary**: 实现 Block 级版本化系统（含 git diff 式对比、双层防抖、分层保留策略）
- **Purpose**: 为用户提供 Block 历史回溯能力
- **Target Users**: Comind 桌面应用和 Web 应用用户

## Goals
- 实现 Block 版本化系统：自动/手动快照、diff 对比、前向 restore
- 实现双层防抖架构：2秒落盘防抖 + 3分钟快照冷却 + 30秒极限节流
- 实现分层版本保留策略：7天全部 + 8-30天每日 + 30天+每周 + 手动永久
- 实现版本化 UI：hover 入口、diff 抽屉、restore 操作

## Non-Goals (Out of Scope)
- 版本历史跨设备同步（版本仅本地存储）

## Background & Context
- 当前架构：Rust Core（SQLite）→ Tauri/WASM Client → TypeScript Pinia Store
- 现有 sync.rs 是 Markdown 文件同步系统，与 Phase 3.5 云同步无关
- WASM 路径（Web）需要通过 Dexie/IndexedDB 实现版本存储

## Functional Requirements
- **FR-1**: Block 版本化数据模型（block_versions 表 + G2 快照结构）
- **FR-2**: 双层防抖架构（Layer 1: 2秒落盘防抖；Layer 2: 3分钟快照冷却；30秒极限节流）
- **FR-3**: 版本服务层（create、list、restore、cleanup），cleanup 触发时机：应用启动 + 定时（每6小时）
- **FR-4**: 版本化 UI（hover 入口、diff 抽屉、restore 操作、GraphView 横向适配）

## Non-Functional Requirements
- **NFR-1**: 编辑流畅度不受影响（防抖确保）
- **NFR-2**: 版本存储不占用过多空间（分层保留策略）
- **NFR-3**: 完全离线支持（本地完整数据）

## Constraints
- **Technical**: TypeScript + Vue + Pinia（前端），Rust + Tauri（桌面），Dexie/IndexedDB（Web）
- **Dependencies**: 依赖 Phase 3 的 SQLite 存储基础

## Assumptions
- 项目已完成 Phase 3 的 SQLite 迁移和 Markdown IO
- CoreClient 接口模式已稳定（TauriClient/WasmClientAdapter）

## Acceptance Criteria

### AC-1: G2 快照格式稳定
- **Given**: 需要生成版本快照
- **When**: 序列化 Block 本体 + Property 列表（独立表）+ 出向 Link 列表（独立表）
- **Then**: 生成的 JSON 字符串字段顺序稳定，SHA-256 哈希可重复
- **Verification**: `programmatic`

### AC-1.1: G2 快照内容完整性
- **Given**: Block 有 properties 和 links
- **When**: 生成版本快照
- **Then**: 快照包含完整的 Block 字段（不含 properties）、所有 Property 记录、所有出向 Link 记录
- **Verification**: `programmatic`

### AC-2: Layer 1 落盘防抖
- **Given**: 用户连续编辑 Block
- **When**: 停止编辑满 2 秒
- **Then**: 自动写入 SQLite/IndexedDB
- **Verification**: `programmatic`

### AC-3: Layer 2 快照冷却
- **Given**: Block 已生成版本快照
- **When**: 3 分钟冷却期内再次修改
- **Then**: 只落盘不生成新快照
- **Verification**: `programmatic`

### AC-4: 快照豁免规则
- **Given**: 触发退出/手动/重大操作
- **When**: 调用版本创建
- **Then**: 无视冷却期，立即生成快照
- **Verification**: `programmatic`

### AC-5: 前向 restore
- **Given**: 当前在 v5，选择 restore v3
- **When**: 点击还原
- **Then**: 创建 v6，内容 = v3 副本，restored_from = v3.id，更新时间为当前时间
- **Verification**: `programmatic`

### AC-5.1: Restore 副作用 - Property 恢复
- **Given**: Block 有多个 Property 记录
- **When**: restore 到历史版本
- **Then**: 恢复该版本快照中的所有 Property 记录（删除当前 Property，创建快照中的 Property），保留 `sortOrder`、`isHidden`
- **Verification**: `programmatic`

### AC-5.2: Restore 副作用 - Link 恢复
- **Given**: Block 有出向 Links
- **When**: restore 到历史版本
- **Then**: 只恢复目标 Page 仍存在的 Links；目标已删除的 Links 不恢复；恢复的 Link 使用当前时间创建
- **Verification**: `programmatic`

### AC-6: 分层保留清理
- **Given**: 应用启动或定时触发
- **When**: 执行清理任务
- **Then**: 按策略清理过期版本，手动检查点永久保留
- **Verification**: `programmatic`

### AC-7: hover 入口
- **Given**: Block 行 hover
- **When**: 鼠标悬停在 Block 右侧
- **Then**: 显示历史图标按钮
- **Verification**: `human-judgment`

### AC-8: diff 抽屉
- **Given**: 点击历史图标
- **When**: 打开版本列表
- **Then**: 右侧抽屉显示版本列表 + diff 对比，GraphView 等横向组件自动收起
- **Verification**: `human-judgment`

### AC-9: 悬空关系标红
- **Given**: restore 后关系目标已删除
- **When**: 渲染关系
- **Then**: 显示红色 + "已删除"标签
- **Verification**: `human-judgment`

### AC-10: 30秒极限节流
- **Given**: 用户持续编辑超过 30 秒
- **When**: 编辑持续时间达到 30 秒
- **Then**: 强制触发落盘（不生成快照），重置节流计时器
- **Verification**: `programmatic`

## Open Questions
- [ ] 双层防抖的失焦边界细化（切到设置页算？切到外部应用算？）
- [ ] restore 频繁场景的 UI 优化

