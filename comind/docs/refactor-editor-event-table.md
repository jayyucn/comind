# 重构方案：Editor 事件表深化（候选 6）

> 来源：`/improve-codebase-architecture` 评审 → `/grilling` 决策树。
> 状态：决策已达成共识，待执行。
> 日期：2026-08-18

## 目标

把 `Editor.vue` 里 14 个手抄的 mount/unmount DOM 事件镜像（全库 17 个活事件 + 1 个死事件）收敛为一个声明式事件表模块 `createEditorEvents(ctx)`，用本地自动清理 composable 注册；菜单类 handler 改走 Vue emit；`BulletRender` 与保存调度解耦；补齐事件链端到端测试。**保留 DOM CustomEvent 传输不动**（见 ADR-0016）。

## 已定决策（grilling 产出）

| # | 决策 | 选定 |
|---|------|------|
| D1 | 坍缩机制 | 声明式事件表 + 自动清理 composable；保留 DOM CustomEvent 传输 |
| D2 | scope | 覆盖全部 17 个活事件 + 删死事件 `dateRefTriggerClose` |
| D3 | 是否缩短 5 跳链 | 不缩短（enter-as-block 族的分层有意为之；5 跳的真正问题「hop2 桥无真测」由 D4 解决） |
| D4 | 测试 | 表驱动测试 + 补 `EnterAsBlockExtension`/`DateRefTriggerExtension` 测试文件 |
| D5 | BulletRender | 抽 `SaveErrorBadge` 展示组件，渲染路径不再 import 保存调度 |
| D6 | 迁移 | 三相位：测试先行 → 表转换 → 清理 |
| D7 | 表模块形状 | 工厂 `createEditorEvents(ctx)`；菜单类 handler 改 `emit('open-xxx-menu', payload)` 由模板接 |
| D8 | ADR | 写 ADR-0016 + `editorEvents` 加进 CONTEXT.md |
| D9 | 测试 view 形状 | 轻量 stub（不挂真 TipTap） |

## 关键事实（fact-find 摘要）

- **14 事件镜像属实**：`Editor.vue` L437-450（`onBeforeUnmount`）与 L468-481（`onMounted`）是同一组 14 事件的 add/remove 镜像（Vue 不自动清理模板外 DOM 监听器的手工补救）。
- **全库 17 个活事件 + 1 死事件**：另 3 个是 `delete-between-property`（`index.vue:246` 监听）、`slash-command-trigger`（`SlashCommandMenu.vue:381` 监听）、`dateRefTriggerClose`（派发于 `DateRefTriggerExtension.ts:83,100`，**全库无监听——死事件**）。
- **5 跳链仅 enter-as-block 族**（split/merge/delete/indent/outdent/moveUp/moveDown/exitEdit/save）；菜单/面板类事件 2-3 跳即短路。
- **DOM CustomEvent 部分正当**：TipTap Extension 拿不到父 Vue 组件实例是真实约束；`editor.emit/on` 可替代但不明显减复杂度（仍要 on/off 配对）。载荷是 ProseMirror 运行时对象引用（view/position/range/$from/coords），不可序列化，须按引用直达。
- **测试覆盖**：`Editor.test.ts` 的 `handleEnterAsBlock` 测试是同义反复假测；`EnterAsBlockExtension`（派发 14 中 9 个）与 `DateRefTriggerExtension` 无测试文件；hop2 桥（addEventListener→handler）无真测；仅 `SlashCommandMenu.test.ts` 真正走过 jsdom CustomEvent 链。

## 三相位执行计划

### Phase 1 — 测试先行（针对当前镜像结构）

先铺安全网、刻画现有行为。Phase 1 测试对镜像结构还是对工厂表透明（dispatch 的是 `view.dom` 上的 CustomEvent），先写不浪费。

- **1.1** 新建 `src/components/Block/__tests__/editorEvents.test.ts`：对 17 个活事件逐个 `dispatchEvent(new CustomEvent(name, { detail }))`，断言 handler 触发（emit 被调 / store action 被调 / 菜单 emit 被调）。`view` 用轻量 stub（`{ dom: jsdom 元素, coordsAtPos: () => 固定坐标, posAtCoords: () => null }`）。
- **1.2** 新建 `src/components/Block/handlers/extensions/__tests__/EnterAsBlockExtension.test.ts`：覆盖 enter-as-block 的 9 个派发点。
- **1.3** 新建 `src/components/Block/handlers/extensions/__tests__/DateRefTriggerExtension.test.ts`：补派发侧测试。
- **验收**：新测试全绿；现有 `Editor.test.ts` / `index.test.ts` / `useBlockEditorLifecycle` 测试不退化。

### Phase 2 — 镜像 → 工厂表转换

- **2.1** 新建 `src/components/Block/editorEvents.ts`：
  ```ts
  export interface EditorEventCtx {
    emit: (event: string, ...args: unknown[]) => void
    view: EditorView          // TipTap/ProseMirror view
    props: { pageId: string; blockId: string }
    editorStore: EditorStore
  }
  export function createEditorEvents(ctx: EditorEventCtx): Record<string, (e: Event) => void> { ... }
  ```
  - 17 个 handler 从 `Editor.vue`（及 `index.vue` 的 `delete-between-property`、`SlashCommandMenu` 的 `slash-command-trigger`）迁入。
  - 菜单类 handler（`dateRefClick`/`wiki-link-menu-*`/`relationship-*`/`dateRefTrigger`/`dateRefKindSelect`）改为 `ctx.emit('open-xxx-menu', payload)`。
- **2.2** 新建本地 composable `src/composables/useDomEvents.ts`（自动 `onUnmounted` 清理，避免引入 VueUse 新依赖）：
  ```ts
  export function useDomEvents(target: HTMLElement, events: Record<string, (e: Event) => void>) {
    for (const [name, handler] of Object.entries(events)) target.addEventListener(name, handler)
    onUnmounted(() => { for (const [name, handler] of Object.entries(events)) target.removeEventListener(name, handler) })
  }
  ```
- **2.3** `Editor.vue`：删 L437-450 / L468-481 两块镜像，改为：
  ```ts
  const events = createEditorEvents({ emit, view: editor.value.view, props, editorStore })
  useDomEvents(editor.value.view.dom, events)
  ```
  模板加 `@open-xxx-menu` 接线，驱动菜单组件（原先由闭包直接控制 open 态的菜单迁到 emit 驱动）。
- **2.4** `index.vue`：`delete-between-property` 的 handler 改从 `editorEvents` 模块取（或经工厂统一）。`SlashCommandMenu.vue` 同理 for `slash-command-trigger`。
- **验收**：Phase 1 测试全程绿；`Editor.vue` 行数显著下降；无内存泄漏（composable 自动清理）。

### Phase 3 — 清理与文档

- **3.1** 删死事件 `dateRefTriggerClose`：删除 `DateRefTriggerExtension.ts:83,100` 的派发点。
- **3.2** 抽 `src/components/Block/handlers/bullet/SaveErrorBadge.vue`：展示组件，props `{ saveError }`，emit `retry`。`BulletRender.vue` 组合它，不再直接 import 保存调度。
- **3.3** 写 `docs/adr/0016-editor-dom-event-transport.md`：记录「Editor↔TipTap 扩展通信走 DOM CustomEvent；本次只坍缩镜像、不换传输层」+ 理由（扩展够不到 Vue emit 是真实约束；`editor.emit/on` 不明显减复杂度；载荷是 ProseMirror 运行时对象引用需按引用直达）。
- **3.4** `comind/CONTEXT.md` 加术语：`editorEvents` / 「Block editor event table」/ `createEditorEvents(ctx)` / `EditorEventCtx`。
- **3.5** `graphify update .`（AGENTS.md 要求改代码后刷新图谱）。
- **验收**：死事件已删；`BulletRender` 不再 import 保存调度；ADR + CONTEXT.md 落地；graphify 刷新。

## 文件清单

**新增**
- `src/components/Block/editorEvents.ts`
- `src/composables/useDomEvents.ts`
- `src/components/Block/handlers/bullet/SaveErrorBadge.vue`
- `src/components/Block/__tests__/editorEvents.test.ts`
- `src/components/Block/handlers/extensions/__tests__/EnterAsBlockExtension.test.ts`
- `src/components/Block/handlers/extensions/__tests__/DateRefTriggerExtension.test.ts`
- `docs/adr/0016-editor-dom-event-transport.md`

**修改**
- `src/components/Editor.vue`（删两块镜像、wire 工厂、模板加菜单 emit 接线）
- `src/components/Block/index.vue`（`delete-between-property` handler 来源）
- `src/components/SlashCommandMenu.vue`（`slash-command-trigger` handler 来源）
- `src/components/Block/handlers/bullet/BulletRender.vue`（组合 `SaveErrorBadge`，移除保存调度 import）
- `src/components/Block/handlers/extensions/DateRefTriggerExtension.ts`（删死事件派发）
- `comind/CONTEXT.md`（加术语）

**删除**
- 死事件 `dateRefTriggerClose` 的派发点

## 风险

- **菜单 emit 迁移**：菜单类 handler 改 emit 后，`Editor.vue` 模板需新增若干 `@open-xxx-menu` 接线；原先由闭包直接控制 open 态的菜单需迁到 emit 驱动。Phase 1 测试须先刻画这些菜单的开启行为，确保迁移不改变行为。
- **注册时机**：`view` 在 `onMounted`（TipTap 初始化后）才可用；`useDomEvents` 注册须在 `editor.value` 就绪后。
- **EnterAsBlockExtension 测试刻画量大**：9 个派发点行为复杂，Phase 1.2 工作量大——但这是 Phase 2 安全网的前提，不可省。

## 整体验收标准

1. 17 个活事件每个都有 dispatch→handler→action 真测。
2. `Editor.vue` 不再有两块手抄镜像。
3. 加一个新事件 = 加一行表项 + 一行测试（不再改 4 处）。
4. `BulletRender` 不 import 保存调度。
5. ADR-0016 + CONTEXT.md 术语落地；graphify 刷新。

## 后续（不在本任务）

- 换传输层（DOM CustomEvent → `editor.emit/on`）作为独立候选另开，ADR-0016 已记录不本次做的理由。
- 候选 1（Repository 三写收敛）的 grilling 仍挂起，5 个第 1 轮问题待答。
