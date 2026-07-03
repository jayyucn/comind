# Phase 3.5 - 版本化系统 - 执行计划

## [ ] Task 0: 定义 G2 快照序列化格式（契约层）
- **Priority**: high
- **Depends On**: None
- **Description**: 
  - 定义稳定的 G2 快照 JSON 字段顺序（Block → Properties → Relationships）
  - 实现 SHA-256 哈希计算函数（Rust 和 TypeScript 两端一致）
  - 定义 `BlockVersion` 和 `BlockSnapshot` 类型（Rust 和 TypeScript）
- **Acceptance Criteria Addressed**: AC-1
- **Test Requirements**:
  - `programmatic` TR-0.1: 相同数据序列化两次，哈希值完全一致
  - `programmatic` TR-0.2: 不同数据序列化，哈希值不同
- **Notes**: 这是所有后续任务的基础契约，必须先完成

## [ ] Task 1: Rust 层 - block_versions 表 Schema + Repository
- **Priority**: high
- **Depends On**: Task 0
- **Description**: 
  - 在 `comind-core/src/types/` 添加 `BlockVersion` 和 `BlockSnapshot` 结构体
  - 在 `comind-core/src/storage/repository.rs` 添加 `BlockVersionRepository` trait
  - 在 `comind-core/src/storage/sqlite.rs` 实现 `block_versions` 表 CRUD（含索引）
  - 实现 `SQLiteTransactionAdapter` 的 `BlockVersionRepository`
- **Acceptance Criteria Addressed**: FR-1
- **Test Requirements**:
  - `programmatic` TR-1.1: SQLite 初始化时正确创建 `block_versions` 表和索引
  - `programmatic` TR-1.2: 创建、查询、删除版本记录功能正常
- **Notes**: 需要注意 G2 快照的 JSON 序列化稳定性

## [ ] Task 2: Rust 层 - BlockVersionService（业务逻辑）
- **Priority**: high
- **Depends On**: Task 1
- **Description**: 
  - 在 `comind-core/src/services/` 创建 `block_version_service.rs`
  - 实现 `create(snapshot, source)`: 创建版本快照，包含 Block + Properties + 出向 Links
  - 实现 `list(block_id, filters)`: 查询版本列表
  - 实现 `restore(version_id)`: 前向 restore（创建新版本，内容为旧版本副本），恢复 Property（删除当前，创建快照中的），恢复 Link（仅目标存在的）
  - 实现 `cleanup(retention_days)`: 分层保留清理任务
  - 实现 SHA-256 哈希计算和去重判断
- **Acceptance Criteria Addressed**: FR-3, AC-5, AC-5.1, AC-5.2, AC-6
- **Test Requirements**:
  - `programmatic` TR-2.1: restore 创建新版本，restored_from 字段正确，更新时间为当前时间
  - `programmatic` TR-2.2: 相同快照哈希去重，不重复创建版本
  - `programmatic` TR-2.3: 清理任务按分层策略删除过期版本
  - `programmatic` TR-2.4: restore 后 Property 正确恢复（删除当前，创建快照中的）
  - `programmatic` TR-2.5: restore 后只恢复目标 Page 仍存在的 Links
- **Notes**: restore 是前向操作，历史永不破坏

## [ ] Task 3: Tauri 命令层 - 版本化 API 暴露
- **Priority**: high
- **Depends On**: Task 2
- **Description**: 
  - 在 `src-tauri/src/commands.rs` 添加版本化相关命令：
    - `create_block_version(block_id, source, message)`
    - `get_block_versions(block_id)`
    - `restore_block_version(version_id)`
    - `cleanup_block_versions(retention_days)`
  - 实现 `create_block_version` 时自动构建 G2 快照（Block 本体 + Property 列表 + 出向 Link 列表）
- **Acceptance Criteria Addressed**: FR-1, FR-3, AC-1, AC-1.1
- **Test Requirements**:
  - `programmatic` TR-3.1: Tauri 命令正确调用 Rust service
  - `programmatic` TR-3.2: G2 快照包含完整的 Block 本体（不含 properties）+ 所有 Property 记录 + 所有出向 Link 记录
- **Notes**: 需要确保 G2 快照构建时查询 Properties 和 Links

## [ ] Task 4: CoreClient 层 - 版本化方法接口
- **Priority**: high
- **Depends On**: Task 3
- **Description**: 
  - 在 `src/wasm/types.ts` 添加版本化相关类型定义
  - 在 `src/wasm/client.ts` 的 `CoreClient` 接口添加版本化方法
  - 在 `TauriClient` 实现版本化方法（调用 Tauri 命令）
  - 在 `WasmClientAdapter` 实现版本化方法（调用 WASM）
- **Acceptance Criteria Addressed**: FR-1, FR-3
- **Test Requirements**:
  - `programmatic` TR-4.1: Tauri 环境下版本方法调用成功
  - `programmatic` TR-4.2: WASM 环境下版本方法调用成功（待 WASM 实现）
- **Notes**: WASM 路径需要后续添加 `block_versions` 存储支持

## [ ] Task 5: TypeScript 层 - 双层防抖架构实现
- **Priority**: high
- **Depends On**: Task 4
- **Description**: 
  - 在 `src/stores/blocks.ts` 改造 `_scheduleSave` 实现双层防抖：
    - Layer 1: 2秒尾部防抖（现有逻辑，保持不变）
    - Layer 2: 3分钟快照冷却（新增 `pendingSnapshots` Map 追踪）
    - 30秒极限节流：持续编辑超过30秒强制落盘（不生成快照），重置计时器
  - 添加 `forceCreateVersion(source, message)` 方法（用于退出/手动/重大操作）
  - 实现哈希去重：落盘后比对前后 G2 快照哈希
  - 添加配置项支持（落盘防抖阈值、快照冷却间隔、保留窗口）
- **Acceptance Criteria Addressed**: FR-2, AC-2, AC-3, AC-4, AC-10
- **Test Requirements**:
  - `programmatic` TR-5.1: 连续编辑 2秒内只触发一次落盘
  - `programmatic` TR-5.2: 3分钟内多次修改只生成一次版本快照
  - `programmatic` TR-5.3: 调用 `forceCreateVersion` 无视冷却期立即生成快照
  - `programmatic` TR-5.4: 持续编辑超过30秒触发强制落盘，不生成快照
- **Notes**: 现有 `pendingSaves` Map 是 Layer 1 的实现，Layer 2 需要新增 `pendingSnapshots`

## [ ] Task 6: Web 端 - IndexedDB 版本存储（Dexie）
- **Priority**: high
- **Depends On**: Task 4
- **Description**: 
  - 在 `src/wasm/` 创建 `indexedDBVersionRepository.ts`（使用 Dexie）
  - 实现 `blockVersions` 表（匹配 SQLite schema）
  - 实现版本 CRUD 操作
  - 在 `WasmClientAdapter` 中集成版本化方法
- **Acceptance Criteria Addressed**: FR-1
- **Test Requirements**:
  - `programmatic` TR-6.1: Web 端版本创建、查询、删除功能正常
  - `programmatic` TR-6.2: Web 端与桌面端版本数据结构一致
- **Notes**: Web 端使用 Dexie，桌面端使用 SQLite，通过 CoreClient 接口统一

## [ ] Task 7: UI 层 - BlockHistoryButton（hover 入口）
- **Priority**: medium
- **Depends On**: Task 5
- **Description**: 
  - 创建 `src/components/Block/BlockHistoryButton.vue` 组件
  - hover 时显示历史图标（时钟/↶），点击触发抽屉
  - 集成到 `src/components/Block/index.vue` 的 hover 事件
  - 添加快捷键 `Cmd/Ctrl + H`（选中 Block 时）
- **Acceptance Criteria Addressed**: FR-4, AC-7
- **Test Requirements**:
  - `human-judgment` TR-7.1: hover 时按钮显示位置正确（右侧不挤占拖拽区域）
  - `human-judgment` TR-7.2: view 和 edit 模式都可用
- **Notes**: 不引入右键菜单和常驻按钮，保持 chrome-free 设计

## [ ] Task 8: UI 层 - BlockHistoryDrawer（diff 抽屉）
- **Priority**: medium
- **Depends On**: Task 7
- **Description**: 
  - 创建 `src/components/Block/BlockHistoryDrawer.vue` 组件（右侧抽屉）
  - 版本列表组件：时间戳、source 标签、message、restored_from 标记
  - Diff 渲染组件：文本 diff（jsdiff/diff-match-patch）、属性变更、关系变更
  - 横向布局适配：抽屉打开时 GraphView 等横向组件自动收起
- **Acceptance Criteria Addressed**: FR-4, AC-8
- **Test Requirements**:
  - `human-judgment` TR-8.1: 抽屉滑出动画流畅，Page 仍可见可编辑
  - `human-judgment` TR-8.2: diff 对比清晰，红绿渲染正确
- **Notes**: 需要选择 diff 库（jsdiff 或 diff-match-patch）

## [ ] Task 9: UI 层 - Restore 操作 + 悬空关系渲染
- **Priority**: medium
- **Depends On**: Task 8
- **Description**: 
  - 在版本列表项添加「还原」按钮
  - Restore 二次确认 modal
  - Restore 后 toast 提示 + 跳转到新版本
  - 悬空关系渲染：添加 `is-dangling` class，红色显示 + "已删除"标签
- **Acceptance Criteria Addressed**: FR-4, AC-5, AC-9
- **Test Requirements**:
  - `human-judgment` TR-9.1: restore 操作流程清晰，确认后正确执行
  - `human-judgment` TR-9.2: 悬空关系红色显示，用户可识别
- **Notes**: restore 不阻塞，问题透明交给用户

## [ ] Task 10: 测试与集成
- **Priority**: high
- **Depends On**: 所有任务
- **Description**: 
  - 单元测试：repository、service、防抖逻辑、diff 渲染
  - 集成测试：save → version 创建链路
  - E2E 测试（Playwright）：hover → 抽屉 → 选两版本 → 看 diff → restore
- **Acceptance Criteria Addressed**: 所有 AC
- **Test Requirements**:
  - `programmatic` TR-10.1: 所有单元测试通过
  - `programmatic` TR-10.2: 所有集成测试通过
  - `human-judgment` TR-10.3: E2E 测试覆盖关键用户流程

