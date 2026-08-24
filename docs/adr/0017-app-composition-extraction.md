# ADR-0017 · Extract App.vue's cross-cutting responsibilities

- **Status**: Accepted (2026-08-18) — 候选 5，经 `/grilling` 决策树收敛
- **Deciders**: jay (产品判断) + WorkBuddy (工程判断)
- **Supersedes / Relates**: 延续候选 6 的设计哲学（ADR-0016：保留行为、只坍缩结构）；本 ADR 把同一哲学用到 App.vue 组合根
- **Scope**: 仅前端 `src/App.vue` 与新建 `src/app/*` 编排层；不改任何 store / 路由 / 后端

---

## Context（背景）

`src/App.vue` 是组合根（composition root），全仓最热前端文件（49 次提交），544 行，零测试。它把 9 类横切职责的手写逻辑全堆在根上：

| 职责 | 行号 | 现状 |
|------|------|------|
| 窗口控制（按钮/拖拽/resize） | L134–165 + onMounted L178–183 | 手写 |
| 全局快捷键（ctrl+k/g/i/b/t） | L102–119 + L175/207 | 手写 |
| **自实现导航历史栈** | L121–294（~170 行纯逻辑） | 手写、最热、零测试 |
| 回收站恢复对话框 | L129–130/L237–258 | 手写 |
| BlockSelector 编排 | L305–312 | 手写 |
| 右侧栏图谱开关 | L51–63/L231–235 | 手写 |
| 同步对端 toast | L88–96 | 手写 watch |
| 右侧面板注册 | L34–46 | `registerPanel` 模块级副作用 |
| graph 预取 | L170 | `prefetchGraphSnapshot()` 委托 |

> 注：`date-ref 面板挂载` 已被 `useDateTimePickerPanel`（L21/L70–79）抽走，本次不再处理——属已完结项。

**问题**：根模块变成「杂物抽屉」。导航历史栈是手卷的 `ref` 数组 + `watch`，全仓最热却零测试；其余 6 类手写逻辑各自 10–40 行，散在根上难定位、难单测、难回滚。

**触发**：这是 `/improve-codebase-architecture` 评审的 8 个深化候选之一（候选 5）。

---

## Decision（决策）

将 9 类职责拆为 **7 个独立 composable 模块**（落 `src/app/`）+ **3 项保留**，沿用候选 6 验证过的三相位（测试先行 → 抽取 → 清理），一个大 PR 一次性收口。

### 7 个抽出模块（均落 `src/app/use*.ts`）

| 模块 | 覆盖行号 | 对外 API（推荐） |
|------|----------|------------------|
| `useNavigationHistory` | L121–294（栈 + watchers + 回调注册） | `{ canGoBack, canGoForward, goBack(), goForward() }`；**内部自 `useRoute()`+`watch` 维护栈、自注册 `onRemovePageFromHistory`** |
| `useWindowControls` | L134–165 + onMounted L178–203 | `{ isMaximized, startDragging(e), minimize(), maximize(), close() }`；**一并收 `tauri://resize` + Android auto-reconnect + `online` 监听（窗口+连接一体）** |
| `useGlobalHotkeys` | L102–119 + L175/207 | 无返回；`useGlobalHotkeys({ onToggleSearch })` 自管 `document` keydown；search 开关走回调 |
| `useTrashedPageRestore` | L129–130/L237–258 | `{ visible, pageTitle, confirm(), cancel() }`；自 `watch(blockStore.trashedPageWarnings)` |
| `useGraphSidebarToggle` | L51–63/L231–235 | `{ isGraphPanelOpen, handleToggle() }`；自 `watch(route.meta.hideRightSidebarToggle)` |
| `useEmbedSelector` | L305–312 | `{ handleSelect(sourceBlockId, sourcePageId) }`；读 `editorStore.blockSelector` |
| `useSyncPeerToast` | L88–96 | 无返回；自 `watch(useSyncStatus().status.peers)` → `editorStore.showToast` |

### 3 项保留（不抽模块）

- **graph 预取**（`prefetchGraphSnapshot()`，L170）：已是委托函数，App.vue `onMounted` 直调，不再包 composable（避免 AGENTS.md 反对的过度抽象）。
- **`handleMainClick`**（外部点击 `deactivateBlock`，L296–303）：短小胶水，留 App.vue。
- **`registerPanel` 两处**（L34–46）：模块级副作用注册，保持原样。

### 目录边界

- **`src/app/`** = 应用级编排层，只收「服务于 App 组合根的专属关注」（上述 7 模块）。
- **`src/composables/`** = 跨 feature 通用可复用层（30+ 现有 composable 不动）。
- 判断标准一句话：「是否只服务于 App 根装配」。

### 导航历史模块契约（已锁定）

- `useNavigationHistory` 内部 `useRoute()` + `watch(() => route.fullPath, …)` 自维护 `historyStack`/`historyIndex`。
- 对外**只暴露** `canGoBack`/`canGoForward`（computed）+ `goBack()`/`goForward()`。App.vue 不再知道栈存在。
- **保留** `window.history.go(-1)` / `go(1)` 耦合（行为零变化，最低回归风险）。
- **保留**内存态，不持久化（reload 回到 `[{ path: '' }]`，与现状一致）。
- 模块 setup 时**自行** `pageStore.onRemovePageFromHistory(removePageFromHistory)` 并自清理；App.vue 不再碰。
- ⚠️ 已知约束：`pages.ts` 的 `onRemovePageFromHistory` 是**单槽回调**（只存一个 fn）。本次仅导航历史用，安全；若将来出现第二个消费者会互相覆盖——届时需改为多槽订阅。

---

## Consequences（后果）

**正面**
- 导航历史栈**首次可测**（纯逻辑 + 明确接口，隔离单测 mock `useRoute`/`usePageStore`）。
- locality：热点分散退热，每模块单一职责、单一变更理由。
- App.vue 缩为「组合根」：仅 import 调 7 个 composable + 模板装配，删除全部手写逻辑（`git diff` 预计净减 ~250+ 行）。
- 与候选 6（ADR-0016）同哲学：保留运行时行为、只坍缩结构，回归风险最低。

**负面 / 风险**
- `useWindowControls` 因 Q10=B 把「连接生命周期」（auto-reconnect / `online`）并进来，与「窗口控制」语义略有张力——若评审挑战，可拆出 `useTauriConnection`（本 ADR 记录的备选 C）。
- `useSyncPeerToast` 让 UI toast 逻辑离开 App.vue，但 `useSyncStatus` 仍保持纯数据、不碰 UI（符合分层）。
- 新模块增加 `src/app/` 7 个文件 + 7 个测试文件；目录需维持「只服务根装配」的纪律，否则会沦为新杂物间。

**不做的事（刻意排除）**
- 不合并 7 模块为一个文件（破坏可测性 + 单职责，且 App.vue 不合并也已足够薄）。
- 不给 App.vue 加挂载级测试（组合根依赖全局副作用，脆弱且价值低）。
- 不持久化导航历史、不解耦 `window.history`、不改 `registerPanel`。

---

## Alternatives considered（被否的备选）

- **A) 增量、导航历史优先**：被否——用户选一次性大 PR（Q1=B），统一评审、统一回滚点更清晰。
- **B) 把所有有状态编排搬进 `src/app/`、`composables/` 只留纯函数**：被否（Q2/B 仅指「新模块落 `src/app/`」，不搬迁现有 composable）。
- **C) `useWindowControls` 只管按钮+拖拽+resize，auto-reconnect/`online` 收独立 `useTauriConnection`**：被否（Q10=B 选全部并入）。
- **D) 导航历史解耦到 `router.back()/forward()` 或纯内部指针**：被否（Q6=A 保留 `window.history.go`，最低回归）。
- **E) 7 模块合并单文件让 App.vue「更简洁」**：被否——见上「不做的事」；隐藏复杂度而非消除。

---

## 验收（Acceptance）

1. App.vue 缩为组合根：仅 import 7 composable + 模板装配面板；删除全部手写逻辑。
2. 导航历史单测覆盖 `goBack`/`goForward`/分支截断(`historyIndex` 中段跳转后新导航截断后续)/`removePage`(删当前页调索引)。
3. 其余 6 模块各有隔离单测（mock router/store，jsdom）。
4. `git diff --stat`：App.vue 净减 ~250+ 行；新增 `src/app/*.ts` + `src/app/*.test.ts`。
5. 行为零变化（手动走查 + 全量测试绿）。
6. 不引入 `src/app/` 之外的结构性改动。

> 详细方案与逐模块接口/测试矩阵见 `docs/refactor-app-composition.md`。
