# 重构方案 · 候选 5：Extract App.vue's cross-cutting responsibilities

> 决策记录见 `docs/adr/0017-app-composition-extraction.md`。本文是**可执行方案**。
> 哲学（同候选 6 / ADR-0016）：**保留运行时行为，只坍缩结构**。

## 决策速查（grill 共识）

| 轮 | 问 | 决策 |
|----|----|------|
| R1 | Q1 范围 | **B** 一次性大 PR 全抽 |
| R1 | Q2 落点 | **B** 新模块落 `src/app/`（不散落 `src/composables/`） |
| R1 | Q3 测试 | **A** 隔离单测（mock router/store），App.vue 无挂载测试 |
| R2 | Q4 边界 | **A** `src/app/`=应用级编排；`src/composables/`=跨 feature 通用 |
| R2 | Q5 导航接口 | **A** 模块自维护栈，只暴露 `canGoBack/canGoForward/goBack/goForward` |
| R2 | Q6 history 耦合 | **A** 保留 `window.history.go(±1)` |
| R2 | Q7 回调注册 | **A** 模块自注册 `onRemovePageFromHistory` |
| R2 | Q8 持久化 | **A** 不持久化，内存态 |
| R3 | Q9 快捷键/search | **A** `useGlobalHotkeys({ onToggleSearch })` 收回调 |
| R3 | Q10 窗口/连接 | **B** `useWindowControls` 一并收窗口+连接监听 |
| R3 | Q11 6 模块 API | 同意下表 |
| R3 | Q15 同步 toast | **A** 抽独立 `useSyncPeerToast` |
| R3 | Q14 单文件合并 | **否** 保持 `src/app/` 下独立文件 |

**3 项保留（不抽模块）**：graph 预取（`prefetchGraphSnapshot()` 直调）、`handleMainClick` 胶水、两处 `registerPanel`。

## 文件清单

### 新建（`src/app/`）

| 文件 | 内容 | 覆盖 App.vue 行号 |
|------|------|------------------|
| `useNavigationHistory.ts` | 栈 + route watch + 自注册回收回调 | L121–294 |
| `useNavigationHistory.test.ts` | goBack/goForward/截断/removePage | — |
| `useWindowControls.ts` | 按钮+拖拽+resize+auto-reconnect+online | L134–165 + onMounted L178–203 |
| `useWindowControls.test.ts` | isMaximized 初值 / startDragging 守卫 / minimize·maximize·close 调 tauri | — |
| `useGlobalHotkeys.ts` | ctrl+k/g/i/b/t 路由+快捷键 | L102–119 + L175/207 |
| `useGlobalHotkeys.test.ts` | 各快捷键触发 router.push / ctrl+b 调 toggle / ctrl+k 触发 onToggleSearch | — |
| `useTrashedPageRestore.ts` | trashedPageWarnings watch + 确认/取消 | L129–130 + L237–258 |
| `useTrashedPageRestore.test.ts` | watch→visible+pageTitle；confirm→restorePage+clear；cancel→clear | — |
| `useGraphSidebarToggle.ts` | 图谱侧栏开关 + meta watch | L51–63 + L231–235 |
| `useGraphSidebarToggle.test.ts` | toggle 三态；meta.hide→setVisible(false) | — |
| `useEmbedSelector.ts` | BlockSelector 编排 | L305–312 |
| `useEmbedSelector.test.ts` | handleSelect：无 target→early return；有→updateBlockType+updateBlockProperties+close | — |
| `useSyncPeerToast.ts` | peer 数增→toast | L88–96 |
| `useSyncPeerToast.test.ts` | prevPeerCount 初 0；增→showToast；减→不触发 | — |

### 修改

| 文件 | 改动 |
|------|------|
| `src/App.vue` | 删除全部手写逻辑（L51–63/88–96/102–119/121–294/305–312 等），仅 import 7 composable + 模板装配；`onMounted` 仅保留 `prefetchGraphSnapshot()` + `useRelationshipTypes().load()` + `pageStore.loadAllPages()`（L170–172） |

> 不触碰：`src/composables/*`（30+ 现有）、所有 store、路由、`registerPanel`、graph 预取函数、`handleMainClick`。

## 三相位

### Phase 1 · 测试先行（每模块先在 `src/app/*.test.ts` 写隔离单测，红）

- 复用现有范式（已确认）：`vitest` jsdom + `globals: true` + `setupFiles: ['./tests/setup.ts']`；测试同目录 `*.test.ts`。
- router mock：`vi.mock('vue-router', () => ({ useRoute: () => ({...}), useRouter: () => ({ push: vi.fn() }) }))`。
- store mock：`vi.mock('../stores/pages', () => ({ usePageStore: () => ({...}) }))` + `setActivePinia(createPinia())`（参照 `useIdeasFreeze.test.ts`）。
- 每个模块先用「调用即验证」式测试钉住**现有行为**，再抽取——保证 Phase 2 不漂移。

### Phase 2 · 抽取（绿后搬逻辑）

1. `useNavigationHistory` 最先（最高杠杆、首个可测点）：搬 L121–294，内部 `useRoute()`+`watch`，对外只暴露 `canGoBack/canGoForward/goBack/goForward`，setup 时 `pageStore.onRemovePageFromHistory(removePageFromHistory)`。
2. 其余 6 模块按上表搬；`@toggle`/`@close` 等模板绑定改绑到 composable 返回。
3. `App.vue` 仅留：import 7 个 composable + 调 `useRelationshipTypes().load()` / `pageStore.loadAllPages()` / `prefetchGraphSnapshot()`；模板 `<Sidebar :canGoBack="nav.canGoBack" … @goBack="nav.goBack" />` 等。
4. `showSearchPanel` 仍是 App.vue 本地 ref（Q9=A：hotkey 经 `onToggleSearch` 回调切换）。

### Phase 3 · 清理 + 收口

- 删除 App.vue 中被抽走的全部函数/ref/watch（确认 `git diff` 净减 ~250+ 行）。
- 跑 `vue-tsc -b` 类型检查；`graphify update .` 刷新图谱（AGENTS.md 要求）。
- 全量 `vitest run` 回归（注意：当前全量套件有 21 个**预存** Tauri/jsdom 环境失败，与本重构无关，见候选 6 记录）。

## 测试矩阵

| 模块 | 关键用例 |
|------|----------|
| `useNavigationHistory` | goBack 减 index + `history.go(-1)`；goForward 增 index + `history.go(1)`；中段跳转后新导航截断后续；`removePage` 删当前页时 index 回退；reload 初始 `[{path:''}]` |
| `useWindowControls` | 非 Tauri 环境各方法早退；`isMaximized` 初值来自 `tauriIsMaximized`；`startDragging` 命中 button/controls 早退；resize 监听更新 `isMaximized`；online 触发 auto-reconnect（Android） |
| `useGlobalHotkeys` | ctrl+g→`/graph`、ctrl+i→`/ideas`、ctrl+t→`/tasks`、ctrl+b→`toggle()`、ctrl+k→`onToggleSearch()`（各 `preventDefault`） |
| `useTrashedPageRestore` | warnings 非空→`visible=true`+`pageTitle`；confirm→`restorePage`+`clearTrashedPageWarnings`；cancel→`clear` |
| `useGraphSidebarToggle` | toggle 三态（关→开图、开图→保持、开非图→切图）；`meta.hideRightSidebarToggle`→`setVisible(false)` |
| `useEmbedSelector` | 无 `blockSelector.blockId`→early return；有→`updateBlockType('embed')`+`updateBlockProperties({sourceBlockId,sourcePageId})`+`closeBlockSelector` |
| `useSyncPeerToast` | `prevPeerCount` 初 0；peer 增→`showToast`；peer 减/等→不触发 |

## 验收标准

1. ✅ App.vue 缩为组合根（仅 import + 装配），删除全部手写逻辑。
2. ✅ 导航历史有单测覆盖 goBack/goForward/截断/removePage。
3. ✅ 其余 6 模块各有隔离单测（jsdom，mock router/store）。
4. ✅ `git diff --stat`：App.vue 净减 ~250+ 行；新增 `src/app/*.ts` + `*.test.ts`。
5. ✅ 行为零变化（手动走查 + 全量测试绿）。
6. ✅ 不引入 `src/app/` 之外的结构性改动。

## 开放 follow-up（不计入本次）

- `useWindowControls` 是否拆出 `useTauriConnection`（若评审挑战「窗口+连接一体」）。
- `onRemovePageFromHistory` 单槽→多槽（若第二个消费者出现）。
- graph 预取 / `handleMainClick` / `registerPanel` 的进一步收口（未来单独评估）。
