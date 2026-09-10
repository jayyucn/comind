# ADR-0044: Tabs 拖拽排序（NamedViewBar）用原生 Sortable.js + 后端持久化

- Status: accepted
- Date: 2026-09-10
- Supersedes: —
- Related: ADR-0029 (Screen→Tab 两级 NamedView，其 Open follow-up #3 即本 ADR), ADR-0031 (字段管理面板，声明拖拽用 Sortable.js force-fallback), ADR-0009 (View/ViewQuery 模型)

## Context

`NamedViewBar.vue` 的 tab 条目前**没有任何拖拽能力**——tab 仅由 `v-for` 静态渲染。用户希望给 tab 加拖拽排序。

两条已确认的事实前提：

1. **数据模型已支持排序**：`screen_view` 表的 `sort_order` 字段已存在，`currentTabs` 已按 `sort_order` 排序；但**后端没有更新 `sort_order` 的写路径**（`updateTab(id,name,viewType,queryJson,config)` 不接收 sortOrder），store 也没有 reorder 方法。即"读"已就绪，"写"缺失。
2. **项目已有的拖拽实现不统一**：Block 树（BlockList / BlockChildren）与 FieldManagerPanel / SortMenu / QuadrantView 共 5 处都用 `vue-draggable-plus`；但 ADR-0031 文本声明拖拽"用现有 Sortable.js（force-fallback 模式）"——文档与实现已漂移。Block 树当年从 `useSortable` 迁到 `vue-draggable-plus`，理由含 webview 下原生 DnD 失效、force-fallback 可靠性；那次迁移弃用的是 `useSortable` **wrapper**，引擎始终是 Sortable.js。

本 ADR 决定：用**原生 Sortable.js**（同一引擎，去掉 wrapper）实现 tab 拖拽排序，并补齐后端 `sort_order` 写路径，使顺序刷新后保留。

## Decision

### ① 拖拽库：原生 `sortablejs`（force-fallback 模式）

- 直接 `new Sortable(el, {...})` + `onBeforeUnmount` 中 `destroy()`。新增 `sortablejs` 为**直接依赖**（当前仅为 `vue-draggable-plus` 的传递依赖；显式声明以避免脆弱的传递路径导入）。
- `forceFallback: true`：与 Block 树迁移理由一致——webview 下原生 HTML5 DnD 会失效，fallback 模式可靠性已验证。
- 不采用 `vue-draggable-plus`：它对"派生列表 + 后端为真相源"场景有 v-model 数组归属摩擦（需建本地数组 mirror 再 `@end`→持久化）。本场景真相在 store/后端，前端只需 `onEnd` 拿到 `oldIndex/newIndex` → 算出新顺序 → `store.reorderTabs(ids)`，无需可写数组，代码更少，也正好对应你吐槽的"vue-draggable-plus 不好用"。
- 说明：选 raw Sortable.js **不是推翻**既有迁移——引擎相同，只是更薄的封装。同时把 ADR-0031 声明的"Sortable.js force-fallback"约定在本特性落地，纠正 FieldManagerPanel/SortMenu 实际用 vue-draggable-plus 的漂移（**不回改**那两处既有实现，范围仅限本特性）。

### ② 范围：仅 Tabs（不含 Screens）

按用户原话只做 tab 条拖拽排序。Screen 顺序维持现状（screen 列表在弹层内，不在条上；如需可后续复用同一 `reorderScreenViews` 接口，传 `parentId=''`）。

### ③ 触发方式：整 tab 可拖 + filter 排除交互元素

tab 上已有 点击选中 / 双击重命名 / `⋯` 菜单 / 脏点提示按钮（清除/保存），拖拽不能误触。Sortable 配：
- `draggable: '.tab'`
- `filter: '.kebab, .rename, input, .action'`（kebab 菜单、`#tabRenameInput` 重命名输入、"你调整了…"的清除/保存按钮）
- `preventOnFilter: false`、`delay: 120`（区分点击与拖拽，避免轻微移动误判为拖拽）

### ④ 持久化：新增后端批量接口 `reorderScreenViews`

- 前端 `onEnd` 计算新有序 id 数组 → `store.reorderTabs(ids)`。
- store 乐观更新本地 `views` 的 `sort_order`（computed `currentTabs` 立即反映），再异步调后端；失败回滚。
- 后端新增 `reorderScreenViews(entity, parentId, orderedIds: string[])`：在一个事务内按数组下标原子重写该 `(entity, parentId)` 下所有子项的 `sort_order`，并校验 id 归属。一次调用完成整条重排，优于"扩展 updateTab 逐个更新"或"moveScreenView 单条移动"（后者需 N 次调用）。  `parentId` 参数让 Screens 未来也能复用（传 `''`）。

### ⑤ 交互细节（拖拽视觉 / 手柄 / 拖拽期间行为）

- **拖拽视觉——force-fallback 下的"无拷贝"风格**：`forceFallback:true` 会生成一个跟随光标的 fallback clone（挂 `dragClass`），原生位置留下 `ghostClass` 占位。为达成"只有 tab 移动、看不到拷贝对象"的观感：
  - `dragClass`（浮动克隆）样式与 `.tab` **完全一致**——无阴影、无半透明、无缩放；让浮动体读起来就是"tab 本身在移动"，而非一个拷贝副本。
  - `ghostClass`（落点占位）渲染成**中性 gap**：`--bg-base2` 实底或 `1px --border` 虚线轮廓，清晰指示落点，但不产生第二个可见的 tab 影像。
  - `chosenClass`：仅给拖拽起点极轻强调（如 `--accent` 1px 内描边，`box-shadow:none`），避免与 `dragClass` 叠加出重影。
  - 全部用设计 token（`--bg-base2`/`--border`/`--accent`），不写裸色值；暗色 `[data-theme="dark"]` 自动继承。`animation: 150`（常量/token）让相邻 tab 让位平滑。
- **手柄 / 可发现性**：`draggable: '.tab'` 整 tab 可拖；hover 时在 tab 标签左侧**淡入一个 grip 图标**（grip affordance，移出淡出，不占布局）提示"可拖"。grip 位于 draggable 区域内、**不作为 filter 项**（在 grip 上按下也应能发起拖拽）；配合 `cursor: grab` / `grabbing`。
- **拖拽期间冻结**：`onStart` 设 `isDragging=true`，模板用该标志守卫——跳过 tab 的 click 激活、不打开 hover 弹层/tooltip，`onEnd` 恢复，彻底防误触与误激活。
- **范围边界**：仅当前 screen 的 tabs 参与；无 `group`，不可跨 screen 拖、不跨容器；拖到条外/无效区域自动归位。

## Considered Options

**拖拽库**
- *(A) 原生 `sortablejs`（选定）*：同引擎、更薄、对派生/store 驱动列表最贴合、代码更少；需手动生命周期（onMounted new + onBeforeUnmount destroy），即 blocks 历史泄漏 bug 的同类模式——但本场景单实例、明确 destroy，风险可控。
- (B) `vue-draggable-plus`（沿用 5 处标准）：生命周期安全，但 flat 派生列表需本地数组 mirror + `@end`，正是你吐槽的摩擦点；且与 ADR-0031 声明约定不符。
- (C) `vuedraggable`：第三种 API，维护面更大，不取。

**范围**
- *(A) 仅 Tabs（选定）*：按用户原话。
- (B) Tabs + Screens：范围更大，需额外 screen 条 UI，本期不做。

**持久化**
- *(A) 持久化 + 批量 `reorderScreenViews`（选定）*：刷新保留，原子、一次调用。
- (B) 仅内存态：MVP 快但刷新丢失，与既有"顺序已存 sort_order"模型不一致，不取。

**后端接口形态**
- *(A) `reorderScreenViews(entity, parentId, orderedIds[])`（选定）*：批量原子。
- (B) 扩展 `updateTab`/`updateScreen` 加 sortOrder：N 次调用 + 前端算每个序值，零散。
- (C) `moveScreenView(id, newIndex)`：单条语义、仍多次调用。

**拖拽视觉风格**
- *(A) 无拷贝（选定）*：`dragClass` 克隆与 `.tab` 外观完全一致（无阴影/半透明），`ghostClass` 仅作中性 gap 占位——感知为"tab 本身在移动"，不出现第二个影像。
- (B) 强提示：在 (A) 基础上加落点竖线 indicator（手动 marker），落点更明确但实现更重。
- (C) 极简：仅位移动画 + 来源变灰，无 shadow/克隆。

**钉住 / 手柄 / 拖拽期间**
- *(A) 全部可拖 + hover 显 grip + 拖拽期间冻结交互（选定）*：无 tab 被钉住；grip hover 淡入作可发现性提示；`onStart` 冻结 click/hover 避免误触。
- (B) 无 grip：纯整 tab 可拖，仅靠 `cursor:grab`。
- (C) 钉住默认 tab：若数据模型有 isDefault 标记则固定最左不可拖（本特性不依赖此字段，未选）。

## Consequences

- 正面：tab 条首次支持拖拽排序且刷新保留；引擎与项目既有（含文档约定）一致；代码比 vue-draggable-plus 方案更短、更直。
- 中性：代码库现出现**第二种**拖拽机制（raw Sortable.js 此处 vs vue-draggable-plus 5 处）；已记录为本特性刻意选择，非无意识漂移；暂不回改既有 vue-draggable-plus 站点。
- 代价：新增直接依赖 `sortablejs`（+ `@types/sortablejs`）；需手动管理单实例生命周期；WASM 后端新增接口并重新 `wasm:build`（须 sandbox-off，锁卡时 `cargo clean -p comind-wasm`）。
- 关闭：ADR-0029 Open follow-up #3。
- 待跟进（实现阶段，见下"实施计划"）：
  1. Rust core 新增 `reorder_screen_views` + wasm-bindgen 导出；
  2. `src/wasm/client.ts` CoreClient 接口 + 真实/mock 实现新增 `reorderScreenViews`；
  3. `src/stores/screenView.ts` 新增 `reorderTabs(ids)`（乐观更新 + 回滚）；
  4. `NamedViewBar.vue` 集成：本地 `localTabs` mirror + `onMounted` 建 Sortable（`draggable:'.tab'`、`filter:'.kebab,.rename,input,.action'`、`forceFallback:true`、`delay:120`、`animation:150`、`dragClass`/`ghostClass`/`chosenClass` 映射设计 token，克隆外观与 `.tab` 一致、落点仅中性 gap）+ `onBeforeUnmount` destroy + `onEnd`→`store.reorderTabs`；hover 淡入 grip affordance（`isDragging` 守卫冻结 click/hover）；`.tab-row` 已是 `overflow-x:auto`，force-fallback 规避滚动冲突；
  5. 新增 `NamedViewBar.test.ts`：模拟 `onEnd` 校验 `reorderTabs` 收到正确 id 顺序、`localTabs` 重排、`currentTabs` 反映新序；`screenView.test.ts` 补 `reorderTabs` 持久化 + 回滚用例；
  6. 验证：`vue-tsc -b` + `eslint` + `vitest run` 全绿，手动 `npm run dev` 手测拖拽不误触 kebab/重命名/提示按钮。

## Implementation Notes（2026-09-10 落地勘误）

- **WASM 范围修正**：上文"通过 wasm-bindgen 导出并重新 wasm:build"**未按字面执行**——comind-wasm 本就未实现任何 screen_view 命令，`WasmClientAdapter` 对全部 screen 方法统一 throw `'WASM: screens not supported'`，`reorderScreenViews` 沿用同款 throw（web 端 screens 整体不可用是既有状态）。后端写路径落地为 **Tauri-only**：`reorder_screen_views` 命令经 `execute_with_transaction_adapter` 在事务内调用 core；`sqljs.rs` 的 `reorder` 实现仅为满足 repository trait（web 不可达）。
- **后端完整性校验**：`reorder` 校验 `ordered_ids` 去重且**恰好覆盖**该 `(entity, parent_id)` 下全部子项（越界/缺漏/重复均拒绝），落实"重写所有子项"语义。
- **onEnd 取序方式**：实现用 `readTabOrder()` 读取拖拽后 DOM 的完整 `.tab` 顺序（`data-id`），替代规格中的 `oldIndex/newIndex` 拼接——行为等价、天然保证完整覆盖，规避下标计算的边界分支。
