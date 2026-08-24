# ADR-0016: Editor↔TipTap 扩展通信走 DOM CustomEvent —— 本次只坍缩镜像、不换传输层

- 状态：已采纳（Accepted）
- 日期：2026-08-18
- 范围：`src/components/Editor.vue` 的 14 个手抄 DOM 事件镜像 → `src/components/Block/editorEvents.ts` 声明式事件表；配套 `src/composables/useDomEvents.ts` 自动清理。`DateRefTriggerExtension.ts` 删除死事件 `dateRefTriggerClose`。`BulletRender.vue` 抽 `SaveErrorBadge.vue`。
- 关联代码：
  - 事件表：`src/components/Block/editorEvents.ts`（`createEditorEvents(ctx)` / `EditorEventCtx`）
  - 自动清理：`src/composables/useDomEvents.ts`
  - 注册点：`src/components/Editor.vue`
  - 死事件删除：`src/extensions/DateRefTriggerExtension.ts`
  - 错误徽标：`src/components/Block/handlers/bullet/SaveErrorBadge.vue`
- 来源：候选 6（/improve-codebase-architecture 评审 → /grilling 决策树，3 轮确认）。

---

## 背景 / 问题陈述

`Editor.vue` 里长期存在一组「手抄镜像」：14 个 DOM CustomEvent handler 在 `onMounted` 里 `addEventListener`、在 `onBeforeUnmount` 里 `removeEventListener`，两块代码逐行对应（L437-450 / L468-481）。Vue 不会自动清理模板外的 DOM 监听器，所以这是手工补救，但：

- **重复**：新增一个事件要改 4 处（handler 函数、`onMounted` 注册、`onBeforeUnmount` 注销、模板接线），极易漏改导致事件泄漏或静默失效。
- **不可测**：handler 闭包捕获 `Editor.vue` 的局部状态，无法脱离组件 mount 直接驱动，现有 `Editor.test.ts` 对 `handleEnterAsBlock` 的测试是同义反复假测。
- **散落**：菜单/面板开启态由闭包直接操作，逻辑与 UI 耦合在组件内部。

全库共有 **17 个活事件 + 1 个死事件**：14 个在 `Editor.vue` 镜像内；另 2 个是模板外的单监听器（`delete-between-property` 在 `index.vue` 监听 `document`、`slash-command-trigger` 在 `SlashCommandMenu.vue` 监听 `document`）；1 个 `dateRefTriggerClose` 在 `DateRefTriggerExtension.ts` 派发但**全库零监听——死事件**。

---

## 决策

### D1：坍缩为声明式事件表 `createEditorEvents(ctx)`，保留 DOM CustomEvent 传输通道

不把传输层从 DOM CustomEvent 换成 `editor.emit/on`。理由（真实约束，非风格偏好）：

- **TipTap 扩展够不到父 Vue 组件实例。** 派发方是 TipTap/ProseMirror 扩展（`EnterAsBlockExtension`、`DateRefTriggerExtension`、`WikiLinkTriggerExtension`、`RelationshipTriggerExtension`、`DateRefExtension` 等），它们运行在编辑器实例作用域，**只能拿到 `editor.view.dom`**，拿不到 `Editor.vue` 的 `setup` 上下文。扩展要通知组件，唯一不打洞的通道就是在 `view.dom` 上 `dispatchEvent(new CustomEvent(...))`，由组件在 `onMounted` 后挂监听。
- **载荷是 ProseMirror 运行时对象引用，不可序列化。** detail 里装的是 `view`、`position`、`range`、`$from`、`coords` 这类引用，必须按引用直达；走事件总线/`emit` 同样要传引用，省不掉这层「引用桥」，反而多一层订阅管理（on/off 配对，依旧要手写清理）。
- **本次范围收敛为「去重」而非「换管道」。** 换传输层是独立候选（见「后续」），收益不明确、风险（所有扩展的派发代码要改）较大。把 14 个镜像收进一张表 + 一个自动清理 composable，用最小改动消除 4 处重复的痛点。

### D2：`useDomEvents` 统一注册与自动清理，替代手抄镜像

```ts
useDomEvents(
  () => editor.value?.view?.dom ?? null,
  () => createEditorEvents(ctx),
)
```

composable 在 `onMounted` 注册、在 `onBeforeUnmount` 注销，**消除手抄两块镜像**，杜绝漏注销导致的内存泄漏。目标 DOM 用 getter 延迟到 `editor` 就绪后取值（TipTap 初始化后 `view` 才存在）。

### D3：死事件 `dateRefTriggerClose` 直接删除

它在 `DateRefTriggerExtension.ts` 的 Escape 分支与失焦分支各派发一次，**全库无任何 `addEventListener('dateRefTriggerClose')`**。其语义（关闭 dateRef 面板）实际由 `dateRefKindSelectClose`（有真监听、保留）覆盖。本次删除两处派发点。

### D4：`SaveErrorBadge` 抽离，BulletRender 不再直接调用保存调度

`BulletRender.vue` 原内联「保存失败红点 + 点击重试」。重试动作 `blockStore.retrySave` 属保存调度，与纯渲染态组件职责不符。抽到 `SaveErrorBadge.vue`：props `{ blockId, saveError }`、emit `retry`，内部持有 `retrying` 态并调用 `retrySave`。`BulletRender` 只负责「是否有错」的状态读取（`blockStore.saveErrors`），不再 invoke 保存调度。

### D5：测试经由 stub ctx 直接驱动事件表，不挂真 TipTap

`createEditorEvents(ctx)` 不依赖任何 Vue 组件实例，传入 `vi.fn()` 桩 ctx + 在 `document.createElement('div')` 上 `dispatchEvent` 即可断言每个 handler 的副作用（emit / 菜单 ref 调用 / `openDateRefPanel` 调用 / `blockId` 解析）。覆盖全部 14 个 handler，且可直接验证 `enter-as-block` 各类型路由、`dateRefTrigger` 的 `blockId` DOM 解析等原闭包难以测的行为。

---

## 后果 / 权衡

- **正面**：新增/修改事件 = 表加一行 + 测试加一行，不再改 4 处；消除手抄镜像与泄漏风险；事件表可独立单测；死事件清除；保存调度从渲染组件解耦。
- **负面 / 风险**：
  - DOM CustomEvent 传输层原样保留，事件名字符串仍是「隐式契约」——扩展派发名与表键名需人工对齐（已用 `DATE_REF_CLICK_EVENT` 常量与「返回恰好 14 键」测试锁住）。
  - 2 个模板外单监听器（`delete-between-property` / `slash-command-trigger`）**未纳入本次事件表**，仍各自手写 add/remove。原因：它们是 `document` 上的单监听器、scope 不在 `Editor.vue` 镜像内，纳入会扩大改动面且违反「精准限定修改范围」；列为后续独立候选。
- **权衡取舍**：选择「只坍缩镜像、不换管道」，因为传输层更换收益不明且改动面大，而镜像去重已解决核心痛点（重复 + 不可测 + 泄漏）。

---

## 术语表（Glossary）

| 术语 | 含义 | 备注 |
|------|------|------|
| `editorEvents` | Editor 声明式事件表模块 | `src/components/Block/editorEvents.ts` |
| `createEditorEvents(ctx)` | 工厂函数，返回 14 个 DOM CustomEvent handler 的映射表 | 不依赖 Vue 组件实例，可 stub 单测 |
| `EditorEventCtx` | 事件表所需上下文接口（emit / getEditor / props / 菜单与选择器 ref / relMenu / openDateRefPanel / closeWikiLinkMenuByEditor） | 菜单 API 以 `relMenu` 注入，避免 factory 内耦合 |
| `useDomEvents` | 自动注册/清理 DOM 监听的 composable | 替 `Editor.vue` 手抄镜像，防泄漏 |
| Block editor event table | 14 个 Editor DOM 事件的统一声明式表 | 替代 `Editor.vue` 的两块镜像 |
| `dateRefTriggerClose` | 已删除的死事件 | 原全库零监听，D3 删除 |
| `SaveErrorBadge` | 保存失败红点展示组件 | props `{ blockId, saveError }`、emit `retry` |

---

## 后续（不在本任务）

- 换传输层（DOM CustomEvent → `editor.emit/on` 或事件总线）作为独立候选另开，需评估所有扩展派发点的改动成本。
- 候选 1（Repository 三写收敛）仍挂起。
