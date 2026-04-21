# Page（Block 树）交互规范

> 版本：v0.4\
> 日期：2026-04-21\
> 状态：**已更新** — §2.3–§2.7 实现状态同步完成，Backlinks 组件已添加\
> 依据：`SPEC.md` `block-editor-spec.md` `ui-ux-spec.md` `data-model.md`

***

## 概述

本文档定义 **Page（Block 树）** 的所有交互行为，包括鼠标操作和键盘操作。\
**核心原则：**

- 单编辑器原则：任何时刻只有 1 个 Block 处于编辑态
- Block 是唯一操作单元
- 所有行为必须考虑边界情况

**实现状态标注约定：**

| 标注 | 含义 |
|------|------|
| ✅ 已实现 | 行为已正确实现，与规范一致 |
| ⚠️ 部分实现 | 核心逻辑已有，但与规范描述存在差异或边界情况未覆盖 |
| ❌ 未实现 | 规范有定义，但代码中不存在对应实现 |
| 🔴 阻塞 | 存在会导致功能不可用的 bug |

***

## 1. 基础状态定义

### 1.1 Block 状态机

每个 Block 同一时刻处于以下状态之一：

| 状态         | 说明            | 视觉                                       |
| ---------- | ------------- | ---------------------------------------- |
| `display`  | 展示态，不在编辑      | 纯 HTML，无边框，无背景                           |
| `edit`     | 编辑态，tiptap 挂载 | 左侧 2px accent 边框，背景提亮                    |
| `focused`  | 键盘焦点态（未编辑）    | 2px accent focus ring，outline-offset 2px |
| `dragging` | 正在被拖拽         | opacity 0.5，背景 accent-subtle             |

> ⚠️ **与规范差异**：当前实现中 `focused` 态未单独实现。↑↓ 方向键不会移动焦点到其他 block（Phase 2 实现）。

### 1.2 状态转换图

```
display ──[点击 / Enter]──→ edit
  ↑                            │
  └──[ESC / blur / 点击其他]────┘

edit ──[拖拽目标悬停]──→ dragging

display ──[键盘↑↓]──→ focused ──[Enter]──→ edit
                    ↑         │
                    └──[ESC]──┘
```

> ⚠️ `focused` 态当前未实现，↑↓ 键无操作。

**临时状态说明：**
- `pendingCursorPos`（`editorStore.cursorPos`）：仅在编辑态切换瞬间使用的临时状态，用于记录点击位置。tiptap 挂载后立即消费，不持久化。

**Block.collapsed 字段说明：**
- `collapsed` 是运行时状态，控制 Block 是否折叠子节点
- 存储于 IndexedDB，不持久化到 Markdown
- 默认值为 `false`（展开态）

***

## 2. 鼠标操作

### 2.1 单击 Block 内容区

**行为：**

- 将目标 Block 切换为 `edit` 态（挂载 tiptap）
- 如果有其他 Block 处于 `edit` 态，先保存内容并销毁其 tiptap 实例
- **光标落在点击位置**（tiptap 内部 click 事件自然处理，无需手动干预）
- 操作区（折叠图标、拖拽手柄）保持可见

**实现说明：**

- Block.vue 用 `@mousedown` 捕获点击事件（非 `@click`），在 tiptap 挂载前通过 `document.caretPositionFromPoint` 获取点击处的字符偏移，传给 `editorStore.setCursorPos()`
- `watch(isActive)` 在 `nextTick` 后执行，此时 click 事件已传播完毕，tiptap 不会再覆盖光标
- `pendingCursorPos` 有值 → 设置到点击位置；null → 回退到末尾

**实现状态：✅ 已实现**

**边界情况：**

| 场景                                | 行为                                           | 状态 |
| --------------------------------- | -------------------------------------------- | ---- |
| 点击已有 `edit` 态 Block 的内容区          | 不做任何操作（已是编辑态），光标移动到点击位置                      | ✅   |
| 点击折叠态（collapsed=true）的父 Block 内容区 | 进入 `edit` 态，父 Block 不展开，子 Block 不自动进入编辑      | ✅   |
| 点击子 Block 内容区（父 Block 折叠）         | 父 Block 自动展开，显示子 Block，再进入子 Block 的 `edit` 态 | ✅   |
| 点击已选中的文字                          | 不触发状态切换，光标移动到点击位置，文字保持选中                     | ✅   |
| 点击页面空白区域                          | 无任何操作（Phase 1 不实现多选）                         | ❌   |

> ❌ **点击页面空白区域**：App.vue 当前无 `@click` 监听，点击 block 外部区域时 active block **不会失活**。需要补充 `handleMainClick` 或其他机制。

***

### 2.2 单击操作区 — 折叠图标

**前提：** Block 有子 Block（children.length > 0）

**行为：**

- 切换 `collapsed` 属性（true ↔ false）
- 折叠时：子 Block 高度动画收缩（max-height 过渡 200ms）
- 展开时：子 Block 高度动画展开（max-height 过渡 200ms）
- **不触发编辑态切换**

**实现说明：**

- `watch(collapsed)` 使用 double-`nextTick` + `requestAnimationFrame` 模式精确控制 max-height
- `isAnimating` 状态防止动画期间重复触发
- `childrenHeight` ref 记录子节点完整展开高度，解决嵌套折叠时 `scrollHeight=0` 的问题
- `@click.stop` 阻止冒泡，防止误触发 Block 激活

**实现状态：✅ 已实现**

**边界情况：**

| 场景               | 行为                      | 状态 |
| ---------------- | ----------------------- | ---- |
| 无子 Block 时点击折叠图标 | ✅ 不做任何操作（children.length === 0 时 return） | ✅   |
| 折叠/展开动画进行中再次点击   | ✅ 立即切换到目标状态（isAnimating 直接跳目标） | ✅   |
| 折叠态 Block 被拖拽    | ❌ 拖拽未实现（Phase 1 拖拽）     | ❌   |

***

### 2.3 单击操作区 — 拖拽手柄

**前提：** 手柄默认隐藏（opacity: 0），hover 时显示

**行为：**

- 按下鼠标左键开始拖拽（`mousedown`）
- 拖拽过程中：被拖 Block 变为 `dragging` 态，opacity 0.5，背景 accent-subtle
- 拖拽经过其他 Block 时：显示放置指示线（2px accent 线，instant）

**放置类型（由松开位置决定）：**

| 放置位置               | 放置结果                              |
| ------------------ | --------------------------------- |
| 目标 Block 上方 50% 区域 | 作为目标 Block 的**前一个兄弟**             |
| 目标 Block 下方 50% 区域 | 作为目标 Block 的**后一个兄弟**             |
| 目标 Block 操作区（左侧 24px） | 作为目标 Block 的**子 Block**（缩进 +100 left 值） |

**操作区定义：**
- 操作区宽度：24px，包含折叠图标和拖拽手柄
- 放置为子 Block 时，水平线缩进 24px（与操作区左边缘对齐）

**放置层级指示：**

- 放置在 Block 之前/之后：水平线与目标 Block 左边缘对齐
- 放置为子 Block：水平线缩进 24px（与操作区对齐）

**实现状态：✅ 已实现**

| 子项                    | 状态 | 实现 |
| --------------------- | ---- | ---- |
| Sortable.js 引入          | ✅ | `npm install sortablejs` |
| `useSortable.ts` composable | ✅ | 封装 Sortable 初始化逻辑 |
| Sortable group 配置（父子嵌套） | ✅ | `group: 'nested'` 配置 |
| 放置指示线（drop indicator） | ✅ | Sortable 内置 ghost 元素 |
| 循环嵌套检测（onMove）     | ✅ | `isDescendantOf()` + `onMove` 返回 `false` |
| dragging 态视觉反馈       | ✅ | `.sortable-ghost` / `.sortable-drag` CSS |

**实现差异说明：**
- 当前用 bullet（圆点）作为拖拽触发区，而非独立的拖拽手柄（符合设计）
- `isDescendantOf` 循环检测已实现（`blocks.ts`），Sortable `onMove` 钩子已接入
- 放置指示线由 Sortable 内置 ghost 元素提供视觉反馈

**边界情况：**

| 场景                         | 行为                    | 状态 |
| -------------------------- | --------------------- | ---- |
| 拖拽自己到自己的位置                 | 无操作（Sortable 自动处理）     | ✅   |
| 拖拽父 Block 到其子 Block 下方     | 禁止（`onMove` 返回 `false`，无放置指示） | ✅   |
| 拖拽 Block A 到 Block A 的后代位置 | 禁止（循环嵌套检测）              | ✅   |
| 拖拽到页面边缘外                   | 拖拽取消，Block 回到原位（Sortable 默认） | ✅   |
| 拖拽过程中按 ESC                 | 拖拽取消，Block 回到原位          | ✅   |
| 拖拽空 Block（无文字）             | 允许，正常拖拽               | ✅   |

***

### 2.4 双击 Block 内容区

**Phase 1 行为：** 等同于单击（进入编辑态）。

> 双击选词、双击 URL 等细粒度编辑行为由 tiptap 处理，不影响 Block 树状态。

**实现状态：✅ 已实现**（Block.vue 无特殊处理，tiptap 自然处理双击选词）

***

### 2.5 单击页面空白区域（BlockList 外部）

**行为：**

- 如果当前有 `edit` 态 Block：执行 blur → 保存 → 退出编辑态
- 如果没有 `edit` 态 Block：无操作

**实现状态：✅ 已实现**

```typescript
// App.vue
function handleMainClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.block')) return
  editorStore.deactivateBlock()
}
```

**边界情况：**

| 场景               | 行为                              | 状态 |
| ---------------- | --------------------------------- | ---- |
| 点击页面标题区空白       | active block 失活，内容保存              | ✅   |
| 点击 main-content padding | active block 失活，内容保存              | ✅   |
| 点击 main-content 滚动条  | 无操作（滚动条非 HTMLElement，不触发）     | ✅   |

***

### 2.6 Sidebar 页面点击

**行为：**

- 如果当前有 `edit` 态 Block：先保存内容并退出编辑
- 切换 `activePageId` 到目标 Page
- 渲染新 Page 的 Block 树（第一个 Block 自动进入 `edit` 态，光标落入）

**实现状态：⚠️ 部分实现（已知问题，暂不修复）**

| 子项                    | 状态 |
| --------------------- | ---- |
| 切换 currentPageId ✅  | ✅   |
| 切换后第一个 block 进入 edit 态 | ✅（Sidebar `ensureFirstBlock()` + onMounted 逻辑） |
| 切换 page 前保存当前 block 内容 | ⚠️ **已知问题**：`handleOpenPage` 不保存内容 |

> ⚠️ **已知问题**：切换页面时当前 block 内容不会自动保存。用户需手动 blur（点击外部）后再切换页面。Phase 1.1 考虑修复。

**边界情况：**

| 场景                           | 行为                            | 状态 |
| ---------------------------- | ----------------------------- | ---- |
| 点击当前活跃 Page                  | 无操作                           | ✅   |
| Page 没有任何 Block              | 自动创建 1 个空 Block → 进入 `edit` 态 | ✅   |
| Page 有 Block，但最后一个 Block 无内容 | 无特殊处理，正常渲染                    | ✅   |
| 切换 page 时当前 block 有未保存内容     | ⚠️ 内容可能丢失（需先 blur 保存）          | ⚠️   |

***

### 2.7 Backlinks 区域点击

**行为：**

- 点击 BacklinkItem：跳转到源 Block 所在 Page，并将该 Block 切换为 `edit` 态

**实现状态：✅ 已实现**

| 子项                    | 状态 | 实现 |
| --------------------- | ---- | ---- |
| `[[WikiLink]]` 渲染（高亮样式） | ✅ | `Block.renderContent()` |
| 页面内点击 `[[WikiLink]]` 跳转 Page | ✅ | `Block.handleContentClick()` |
| Backlinks 面板 UI          | ✅ | `Backlinks.vue` 组件 |
| Backlinks 列表点击跳转       | ✅ | `handleBacklinkClick()` |
| 悬空链接（目标 Page 不存在）处理  | ✅ | 点击时创建新 Page（`useNavigateToPage`） |
| 源 Block 已被删除的处理       | ✅ | 显示 "(block deleted)" 提示，点击无操作 |
| 源 Page 已被删除的处理        | ✅ | 显示 "(page deleted)" 提示，删除线样式 |

**实现细节：**

```typescript
// Backlinks.vue
async function handleBacklinkClick(link: LinkRecord) {
  // 1. 先保存当前 block 内容
  if (editorStore.activeBlockId) {
    editorStore.deactivateBlock()
  }

  // 2. 查找源 Block
  const sourceBlock = blockStore.blocks.find(b => b.id === link.sourceBlockId)
  if (!sourceBlock) return // 源 Block 已删除

  // 3. 切换到源 Block 所在 Page
  if (sourceBlock.pageId !== pageStore.currentPageId) {
    await pageStore.openPage(sourceBlock.pageId)
    await blockStore.loadPage(sourceBlock.pageId)
  }

  // 4. 激活源 Block
  setTimeout(() => {
    editorStore.activateBlock(sourceBlock.id)
  }, 0)
}
```

**边界情况：**

| 场景                | 行为                                      | 状态 |
| ----------------- | --------------------------------------- | ---- |
| 源 Block 已被删除      | 显示"(block deleted)"提示，Backlink 保留（悬空链接样式） | ✅   |
| 源 Page 已被删除       | 显示"(page deleted)"提示，该 Backlink 以删除线样式显示      | ✅   |
| 大量 Backlink（100+） | Phase 1 不实现分页，所有显示；性能问题在 Phase 1.1 考虑   | ✅   |

***

## 3. 键盘操作

> 所有键盘操作仅在 `edit` 态生效（`focused` 态未实现）。\
> 除非特别说明，键盘操作不会触发页面滚动。

### 3.1 Enter — 拆分 Block

**前提：** 当前 Block 处于 `edit` 态，光标在任意位置

**行为：**

1. 将 Block 内容按光标位置截断
2. 后半部分生成新 Block（`newBlock`）
3. `newBlock` 作为当前 Block 的下一个兄弟插入
4. `newBlock` 自动切换为 `edit` 态，光标落入开头
5. `newBlock.createdAt` = 当前时间，`newBlock.updatedAt` = 当前时间

**实现状态：✅ 已实现**

**实现细节：**

```typescript
// Block.vue
async function handleSplit(cursorPosArg: number) {
  editorRef.value?.markSaved()
  await handleSave(editorRef.value.getText())
  editorStore.deactivateBlock()          // 同步失活，不等 onBlur 链
  const newBlock = await blockStore.splitBlock(props.blockId, cursorPosArg)
  if (newBlock) {
    editorStore.activateBlock(newBlock.id, 1)  // 光标在开头
  }
}
```

**边界情况：**

| 场景                              | 行为                                           | 状态 |
| ------------------------------- | -------------------------------------------- | ---- |
| 空 Block（无任何文字）按 Enter           | 在当前 Block 之后插入空 Block，光标落入新 Block 开头 | ✅   |
| Block 只有空白字符                    | 视为空 Block                                    | ✅   |
| Enter 触发后立即触发其他快捷键（如 Backspace） | 依次处理，不阻塞                                     | ✅   |
| 拆分后新 Block 需要缩进（Tab）            | 正常处理，新 Block 成为当前 Block 的兄弟                  | ✅   |
| 页面最后一个 Block 按 Enter            | 在最后插入新 Block                                 | ✅   |
| Block 有子 Block                  | 仅拆分当前 Block，不影响子 Block                       | ✅   |

> ~~⚠️ **光标位置差异**~~：规范已修正为与实现一致——统一在当前 Block **之后**插入新 Block。

***

### 3.2 Backspace — 合并 Block

**前提：** 当前 Block 处于 `edit` 态，光标在 Block 开头

**光标在 Block 开头的判定：**

- tiptap `selection.anchor.offset === 0` 且 `selection.anchor.path` 指向第一个段落

**行为：**

1. 将当前 Block 内容追加到上一个 Block 末尾
2. 删除当前 Block
3. 上一个 Block 切换为 `edit` 态，光标落在合并后的末尾

**实现状态：✅ 已实现**

**边界情况：**

| 场景                                      | 行为                                    | 状态 |
| --------------------------------------- | ------------------------------------- | ---- |
| 光标不在 Block 开头                           | Backspace 由 tiptap 处理（删除光标前字符），不触发合并  | ✅   |
| 当前 Block 是页面第一个 Block                   | 不触发合并，Backspace 由 tiptap 处理（无字符可删时忽略） | ✅   |
| 当前 Block 是第一个可见 Block（父 Block 折叠导致）     | 不触发合并                                 | ✅   |
| 上一个 Block 有子 Block                      | 合并后，上一个 Block 的子 Block 保持不变           | ✅   |
| 上一个 Block 已折叠                           | 合并后保持折叠态，光标落入后不展开                     | ✅   |
| 当前 Block 是 Page 且是其唯一 Block             | 不允许删除 Page 本身，改为清空内容                    | ⚠️   |
| 空 Block（无文字）按 Backspace                 | 视为"光标在 Block 开头"，触发合并（删除空 Block）      | ✅   |
| 合并后上一个 Block 有未保存内容                     | 先保存上一个 Block，再合并                      | ✅   |

> ⚠️ "唯一空 Block 按 Backspace 保留" 未做特殊处理，当前会合并。

***

### 3.3 Tab — 缩进（Indent）

**前提：** 当前 Block 处于 `edit` 态

**行为：**

1. 检查前一个兄弟 Block 是否存在
2. 如果存在：将当前 Block 添加为前一个 Block 的子 Block（作为最后一个子节点）
3. 更新当前 Block 的 `parentId` = 前一个 Block 的 `id`
4. 更新当前 Block 的 `left`
5. 如果当前 Block 有后续兄弟 Block：将兄弟 Block 的 `left` 值重排（腾出空间）

**实现状态：✅ 已实现**

**实现细节：**
- `blocks.ts`：`indent()` 用 `calculateIndentLeft()` 计算新 left 值
- `Block.vue`：`handleIndent()` 调用 `deactivateBlock()` → `blockStore.indent()` → `activateBlock()`

**边界情况：**

| 场景                             | 行为                               | 状态 |
| ------------------------------ | -------------------------------- | ---- |
| 当前 Block 是页面第一个 Block（无前一个兄弟）  | 不做任何操作                           | ✅   |
| 当前 Block 已是父 Block 的第一个子 Block | 正常缩进                             | ✅   |
| 当前 Block 有后续兄弟 Block           | 缩进后，后续兄弟 Block 保持原有层级，left 值重排   | ✅   |
| 当前 Block 处于折叠态（collapsed=true） | 正常缩进，折叠态不变                       | ✅   |
| 当前 Block 有子 Block              | ❌ **缺失**：子 Block 应随父 Block 一起缩进 | ❌   |
| 光标在 Block 末尾按 Tab              | 正常缩进，光标位置保持                       | ✅   |

> ❌ **阻塞问题**：缩进有子 Block 的 block 时，子 block **不会**随父 block 一起移动。子 block 的 `parentId` 和 `left` 值保持不变，导致树结构断裂。

***

### 3.4 Shift + Tab — 反缩进（Outdent）

**前提：** 当前 Block 处于 `edit` 态，且不是顶级 Block（`parentId !== null`）

**行为：**

1. 获取当前 Block 的父 Block
2. 将当前 Block 从父 Block 的 children 数组中移除
3. 将当前 Block 添加到父 Block 的兄弟数组中（插入到父 Block 之后）
4. 更新当前 Block 的 `parentId` = 父 Block 的 `parentId`
5. 更新当前 Block 的 `left`

**实现状态：✅ 已实现（子 Block 随父移动的缺失同样存在）**

**边界情况：**

| 场景                                               | 行为                              | 状态 |
| ------------------------------------------------ | ------------------------------- | ---- |
| 当前 Block 是顶级 Block（parentId = null）              | 不做任何操作                          | ✅   |
| 当前 Block 有子 Block                                | ❌ **缺失**：子 Block 应随当前 Block 一起反缩进 | ❌   |
| 父 Block 是当前页面的最后一个子 Block                        | 当前 Block 反缩进后，插入到父 Block 之后     | ✅   |
| 父 Block 已折叠                                      | 当前 Block 反缩进后，父 Block 的折叠态不变    | ✅   |
| 连续 Shift+Tab（多级反缩进）                              | 每次操作一个层级                        | ✅   |

***

### 3.5 ↑ — 上移焦点

**前提：** 无特定状态要求

**行为：**

1. 如果当前处于 `edit` 态：先保存内容，退出编辑态
2. 移动焦点到上一个 Block（按树的先序遍历顺序）
3. 目标 Block 进入 `focused` 态

**实现状态：❌ 未实现**

> 当前按 ↑ 键无任何 Block 树级别的操作（tiptap 会将 ↑ 作为光标移动处理）。

***

### 3.6 ↓ — 下移焦点

**前提：** 无特定状态要求

**行为：**

1. 如果当前处于 `edit` 态：先保存内容，退出编辑态
2. 移动焦点到下一个 Block（按树的先序遍历顺序）
3. 目标 Block 进入 `focused` 态

**实现状态：❌ 未实现**

> 当前按 ↓ 键无任何 Block 树级别的操作（tiptap 会将 ↓ 作为光标移动处理）。

***

### 3.7 Enter（在 `focused` 态）— 进入编辑

**前提：** 当前 Block 处于 `focused` 态（非 `edit`）

**行为：**

- 将当前 Block 切换为 `edit` 态（挂载 tiptap）
- 光标落在 Block 末尾

**实现状态：❌ 未实现（`focused` 态未实现）**

> `focused` 态未实现，因此本节无效。

***

### 3.8 ESC — 退出编辑 / 取消操作

**行为（按优先级）：**

| 当前状态        | ESC 行为                  |
| ----------- | ----------------------- |
| `edit` 态    | 保存内容，退出编辑态（`display` 态） |
| `focused` 态 | 清除焦点（回到 `display` 态）    |
| 拖拽中         | 取消拖拽，Block 回到原位         |
| 无特殊状态       | 不做任何操作                  |

**实现状态：⚠️ 部分实现**

> 当前 `edit` 态按 ESC：tiptap 的默认行为是将光标移动到文档开头（而非退出编辑态）。需要通过 tiptap keyboard shortcut 拦截 ESC 并触发保存 + 失活。

| 子项                   | 状态 |
| -------------------- | ---- |
| ESC 退出编辑态           | ❌   |
| ESC 保存内容             | ❌   |
| ESC 取消拖拽             | ❌   |
| focused 态按 ESC        | ❌   |

***

### 3.9 Ctrl + S — 手动保存

**行为：**

- 触发当前 `edit` 态 Block 的保存逻辑
- 写入 IndexedDB

**实现状态：❌ 未实现**

| 场景                 | 行为                                  | 状态 |
| ------------------ | ----------------------------------- | ---- |
| 无 `edit` 态 Block   | 不做任何操作                              | ❌   |
| 保存失败（IndexedDB 错误） | Phase 1 不实现错误处理                   | ❌   |

***

## 4. 边界情况汇总

### 4.1 空 Block 处理

| 场景                    | 处理方式                          | 状态 |
| --------------------- | ----------------------------- | ---- |
| Page 无 Block          | 自动创建 1 个空 Block，进入 `edit` 态   | ✅   |
| 空 Block 按 Enter       | 在空 Block 之后插入空 Block，光标落入新 Block 开头 | ✅   |
| 空 Block 按 Backspace   | 删除空 Block，焦点移动到上一个 Block      | ✅   |
| 唯一空 Block 按 Backspace | 保留空 Block（不可删除最后一个 Block）     | ⚠️   |
| 空 Block 拖拽            | 允许，正常拖拽操作                     | ⚠️   |
| 空 Block 有子 Block      | 不可能（空 Block 不会有子 Block）       | ✅   |

### 4.2 层级边界

| 场景                    | 处理方式                           | 状态 |
| --------------------- | ------------------------------ | ---- |
| Tab 到极深层级（level > 10） | 允许，代码无硬性限制，但层级线最多显示 6 条        | ⚠️   |
| Shift+Tab 到顶级         | 允许，如果已是顶级（parentId = null）则不操作 | ✅   |
| Tab 后立即 Shift+Tab     | 回到原始位置                         | ⚠️   |

### 4.3 折叠状态下的操作

| 操作                    | 折叠态 Block 的行为                   | 状态 |
| --------------------- | ------------------------------- | ---- |
| ↑ 焦点移动                | 折叠 Block 视为单个节点，焦点跳过其所有子 Block  | ❌   |
| ↓ 焦点移动                | 折叠 Block 视为单个节点，焦点跳过其所有子 Block  | ❌   |
| 点击折叠 Block 内容区        | 进入 `edit` 态，Block 自动展开          | ✅   |
| Tab 缩进到折叠 Block       | 正常缩进，折叠态不变                      | ✅   |
| 折叠 Block 有子 Block 被拖入 | 拖入后 Block 保持折叠态（collapsed=true） | ❌   |

### 4.4 链接和标签交互

| 场景                  | 处理方式                                | 状态 |
| ------------------- | ----------------------------------- | ---- |
| 页面内点击 `[[WikiLink]]` | ✅ 跳转对应 Page（`handleContentClick`） | ✅   |
| 点击悬空链接（目标 Page 不存在） | 当前无反馈（应创建新 Page 或显示提示）         | ⚠️   |
| 删除带链接的 Block        | ❌ Link 表级联删除未实现                   | ❌   |
| Block 内容中的标签 `#tag` | 仅高亮显示，点击无操作                         | ✅   |

### 4.5 Property 行

| 场景                        | 处理方式                                  | 状态 |
| ------------------------- | ------------------------------------- | ---- |
| 输入 `key:: value` 后按 Enter | 内容保存，Property 持久化到 `Block.properties` | ❌   |
| Enter 在 Property 行中间      | 拆分 Block，Property 仅存在于前半 Block        | ❌   |
| Backspace 在 Property 行开头  | 合并到上一个 Block，Property 保留              | ❌   |

### 4.6 多操作连续触发

| 场景                   | 处理方式                                            | 状态 |
| -------------------- | ----------------------------------------------- | ---- |
| Enter 后立即按 Tab       | 先完成 Enter（创建新 Block + 进入编辑），再处理 Tab（新 Block 缩进） | ⚠️   |
| Tab 后立即 Backspace   | 先完成 Tab，再处理 Backspace（撤消 Tab 效果）                | ⚠️   |
| 拖拽过程中按 Enter         | 拖拽被取消，Enter 正常触发（当前 Block 进入编辑）                 | ❌   |
| blur 触发保存的同时按 Ctrl+S | 两者合并为一次保存（防抖处理）                                 | ❌   |

***

## 5. 交互优先级与冲突处理

### 5.1 操作优先级

当多个操作同时触发时，按以下优先级处理：

```
blur / 点击外部    （最高优先级，退出编辑）
拖拽              （次高，处理拖拽状态）
ESC               （退出编辑 / 取消）
其他快捷键        （Enter, Backspace, Tab, 方向键）
```

**实现状态：** ⚠️ 部分实现

> 当前 `blur` 路径存在设计问题：点击 block 外部区域**不会触发失活**（§2.5 未实现），因此优先级最高的"点击外部退出编辑"缺失。

### 5.2 状态一致性保证

- 所有状态变更通过 Pinia store 统一管理 ✅
- 禁止直接修改 DOM 触发业务逻辑 ✅
- 拖拽操作的视觉反馈通过 `draggingBlockId` 状态控制 ⚠️
- 编辑态切换通过 `activeBlockId` 控制 ✅

***

## 6. 优先级修复清单

以下为本次审查识别的阻塞/重要问题，按优先级排序：

### 🔴 P0 — 阻塞（功能完全不可用）

| # | 问题 | 涉及章节 | 文件 | 状态 |
|---|------|---------|------|------|
| 1 | **切换页面时当前 block 内容丢失** — `handleOpenPage` 不保存内容 | §2.6 | `Sidebar.vue` | ⚠️ 已知问题，暂不修复 |
| 2 | **缩进/反缩进有子节点的 block 时树结构断裂** — 子 block 不随父移动 | §3.3/§3.4 | `blocks.ts` | 🔴 待修复 |

### 🟠 P1 — 重要（影响核心体验）

| # | 问题 | 涉及章节 | 状态 |
|---|------|---------|------|
| 3 | 点击 block 外部区域不退出编辑态（`handleMainClick` 缺失） | §2.5 | ✅ 已修复 |
| 4 | ESC 键不退出编辑态（tiptap 未拦截 ESC） | §3.8 | 🔴 待修复 |
| 5 | 拖拽循环检测未接入 Sortable `onMove` | §2.3 | ✅ 已实现 |
| 6 | 放置指示线未实现 | §2.3 | ✅ 已实现（Sortable ghost） |

### 🟡 P2 — 优化（体验问题）

| # | 问题 | 涉及章节 | 状态 |
|---|------|---------|------|
| 7 | `focused` 态未实现（↑↓ 无焦点移动） | §3.5/§3.6/§3.7 | 🔴 待实现 |
| 8 | Ctrl+S 手动保存未实现 | §3.9 | 🔴 待实现 |
| 9 | Property 行（`key:: value`）解析未实现 | §4.5 | 🔴 待实现 |
| 10 | 链接删除时 Link 表级联删除未实现 | §4.4 | 🔴 待实现 |
| 11 | Backlinks 面板 UI 未实现 | §2.7 | ✅ 已实现 |

***

## 7. 未涵盖场景（Phase 2+）

| 场景                           | 说明         |
| ---------------------------- | ---------- |
| Block 多选（Shift+Click）        | Phase 2 考虑 |
| 批量拖拽                         | Phase 2 考虑 |
| 块级引用（Block Reference）        | Phase 2 考虑 |
| 富文本快捷键（Ctrl+B, Ctrl+I 等）     | Phase 2 考虑 |
| 全局快捷键（不聚焦 Block 时）           | Phase 2 考虑 |
| 撤销/重做（Ctrl+Z / Ctrl+Shift+Z） | Phase 2 考虑 |
| 移动端触摸交互                      | 远期规划       |
| 语音输入                         | 远期规划       |

***

*文档 v0.4，更新 §2.3–§2.7 及 §3.5–§3.9 实现状态，补充 P0/P1/P2 优先级修复清单，Backlinks 组件已添加。*
