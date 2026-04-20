# Page（Block 树）交互规范

> 版本：v0.1\
> 日期：2026-04-20\
> 状态：初稿，待评审\
> 依据：`SPEC.md` `block-editor-spec.md` `ui-ux-spec.md`

***

## 概述

本文档定义 **Page（Block 树）** 的所有交互行为，包括鼠标操作和键盘操作。\
**核心原则：**

- 单编辑器原则：任何时刻只有 1 个 Block 处于编辑态
- Block 是唯一操作单元
- 所有行为必须考虑边界情况

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

***

## 2. 鼠标操作

### 2.1 单击 Block 内容区

**行为：**

- 将目标 Block 切换为 `edit` 态（挂载 tiptap）
- 如果有其他 Block 处于 `edit` 态，先保存内容并销毁其 tiptap 实例
- **光标落在点击位置**（tiptap 内部 click 事件自然处理，无需手动干预）
- 操作区（折叠图标、拖拽手柄）保持可见

> **实现说明：**
>
> - Block.vue 用 `@mousedown` 而非 `@click` 捕获点击事件，在 tiptap 挂载前通过 `document.caretPositionFromPoint` 获取点击处的字符偏移，传给 `editorStore.setCursorPos()`
> - watch 在 `nextTick` 后执行，此时 click 事件已传播完毕，tiptap 不会再覆盖光标
> - `pendingCursorPos` 有值 → 设置到点击位置；null（点击 padding 空白等）→ 回退到末尾
> - `pendingCursorPos` 仅用于 merge 等操作后的光标恢复

**边界情况：**

| 场景                                | 行为                                           | 状态                         |
| --------------------------------- | -------------------------------------------- | -------------------------- |
| 点击已有 `edit` 态 Block 的内容区          | 不做任何操作（已是编辑态），光标移动到点击位置                      | ✅ 已实现（tiptap click 事件自然处理） |
| 点击折叠态（collapsed=true）的父 Block 内容区 | 进入 `edit` 态，父 Block 不展开，子 Block 不自动进入编辑      | ✅ 已实现（折叠切换与编辑态独立）          |
| 点击子 Block 内容区（父 Block 折叠）         | 父 Block 自动展开，显示子 Block，再进入子 Block 的 `edit` 态 | ✅ 已实现                      |
| 点击已选中的文字                          | 不触发状态切换，光标移动到点击位置，文字保持选中                     | ✅ 已实现（tiptap 内部处理）         |
| 点击页面空白区域                          | 无任何操作（Phase 1 不实现多选）                         | ✅ 已实现                      |

***

### 2.2 单击操作区 — 折叠图标

**前提：** Block 有子 Block（children.length > 0）

**行为：**

- 切换 `collapsed` 属性（true ↔ false）
- 折叠时：子 Block 高度动画收缩（max-height 过渡 180ms），子 Block 从 DOM 流中隐藏（display: none 或 v-show=false）
- 展开时：子 Block 高度动画展开（max-height 过渡 180ms）
- **不触发编辑态切换**

> **实现说明：**
> - `handleCollapseToggle()`：使用 double-RAF 模式触发 max-height 过渡动画；`transitionRef` 指向 `.block-children` div，`scrollHeight` 作为实际高度
> - `isAnimating` 状态防止动画期间重复触发；动画进行中再次点击直接切换到目标状态
> - `@after-leave="onTransitionEnd"` 清理状态；折叠完成后 maxHeight 设为 'auto' 释放固定值
> - `@click.stop` 阻止冒泡，防止误触发 Block 激活
> - collapsed 态 `.block-bullet.collapsed` 有视觉反馈（opacity 降低）

**边界情况：**

| 场景               | 行为                      |
| ---------------- | ----------------------- |
| 无子 Block 时点击折叠图标 | ✅ 不做任何操作（children.length === 0 时 return） |
| 折叠/展开动画进行中再次点击   | ✅ 立即切换到目标状态（isAnimating 直接跳目标） |
| 折叠态 Block 被拖拽    | 待实现（Phase 1 拖拽）     |

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
| 目标 Block 操作区上/下半部  | 作为目标 Block 的**子 Block**（缩进 +24px） |

**放置层级指示：**

- 放置在 Block 之前/之后：水平线与目标 Block 左边缘对齐
- 放置为子 Block：水平线缩进 24px（与目标 Block 操作区对齐）

**边界情况：**

| 场景                         | 行为                    |
| -------------------------- | --------------------- |
| 拖拽自己到自己的位置                 | 无操作                   |
| 拖拽父 Block 到其子 Block 下方     | 不允许（禁止将父 Block 拖入其子树） |
| 拖拽 Block A 到 Block A 的后代位置 | 不允许（禁止循环嵌套）           |
| 拖拽到页面边缘外                   | 拖拽状态清除，Block 回到原位     |
| 拖拽过程中按 ESC                 | 拖拽状态清除，Block 回到原位     |
| 拖拽空 Block（无文字）             | 允许，正常拖拽               |

***

### 2.4 双击 Block 内容区

**Phase 1 行为：** 等同于单击（进入编辑态）。

> 双击选词、双击 URL 等细粒度编辑行为由 tiptap 处理，不影响 Block 树状态。

***

### 2.5 单击页面空白区域（BlockList 外部）

**行为：**

- 如果当前有 `edit` 态 Block：执行 blur → 保存 → 退出编辑态
- 如果没有 `edit` 态 Block：无操作

***

### 2.6 Sidebar 页面点击

**行为：**

- 如果当前有 `edit` 态 Block：先保存内容并退出编辑
- 切换 `activePageId` 到目标 Page
- 渲染新 Page 的 Block 树（第一个 Block 自动进入 `edit` 态，光标落入）

**边界情况：**

| 场景                           | 行为                            |
| ---------------------------- | ----------------------------- |
| 点击当前活跃 Page                  | 无操作                           |
| Page 没有任何 Block              | 自动创建 1 个空 Block → 进入 `edit` 态 |
| Page 有 Block，但最后一个 Block 无内容 | 无特殊处理，正常渲染                    |

***

### 2.7 Backlinks 区域点击

**行为：**

- 点击 BacklinkItem：跳转到源 Block 所在 Page，并将该 Block 切换为 `edit` 态

**边界情况：**

| 场景                | 行为                                      |
| ----------------- | --------------------------------------- |
| 源 Block 已被删除      | 显示"来源 Block 已不存在"提示，Backlink 保留（悬空链接样式） |
| 源 Page 已被删除       | 显示"来源页面已不存在"提示，该 Backlink 以删除线样式显示      |
| 大量 Backlink（100+） | Phase 1 不实现分页，所有显示；性能问题在 Phase 1.1 考虑   |

***

## 3. 键盘操作

> 所有键盘操作仅在 `edit` 态或 `focused` 态生效。\
> 除非特别说明，键盘操作不会触发页面滚动（除非操作目标在视口外）。

### 3.1 Enter — 拆分 Block

**前提：** 当前 Block 处于 `edit` 态，光标在任意位置（开头 / 中间 / 末尾）

**行为：**

1. 将 Block 内容按光标位置截断
2. 后半部分生成新 Block（`newBlock`）
3. `newBlock` 作为当前 Block 的下一个兄弟插入
4. `newBlock` 自动切换为 `edit` 态，光标落入开头
5. `newBlock.createdAt` = 当前时间，`newBlock.updatedAt` = 当前时间

**光标位置影响：**

| 光标位置              | 行为                                |
| ----------------- | --------------------------------- |
| Block 中间          | 按光标位置截断                           |
| Block 末尾（最后字符之后）  | 创建空 Block，光标落入新 Block             |
| Block 开头（第一个字符之前） | 在当前 Block 之前插入空 Block，光标落入新 Block |

**拆分后的 left 值计算：**

- 新 Block 的 `left` = 当前 Block 的 `left` + gap（如当前 left=100，新 Block left=150）

**边界情况：**

| 场景                              | 行为                                           |
| ------------------------------- | -------------------------------------------- |
| 空 Block（无任何文字）按 Enter           | 在当前 Block 之前插入空 Block，光标落入新 Block（用于快速创建上一行） |
| Block 只有空白字符                    | 视为空 Block                                    |
| Enter 触发后立即触发其他快捷键（如 Backspace） | 依次处理，不阻塞                                     |
| 拆分后新 Block 需要缩进（Tab）            | 正常处理，新 Block 成为当前 Block 的兄弟                  |
| 页面最后一个 Block 按 Enter            | 在最后插入新 Block                                 |
| Block 有子 Block                  | 仅拆分当前 Block，不影响子 Block                       |

***

### 3.2 Backspace — 合并 Block

**前提：** 当前 Block 处于 `edit` 态，光标在 Block 开头

**光标在 Block 开头的判定：**

- tiptap `selection.anchor.offset === 0` 且 `selection.anchor.path` 指向第一个段落

**行为：**

1. 将当前 Block 内容追加到上一个 Block 末尾
2. 删除当前 Block（从父级的 children 数组移除）
3. 上一个 Block 切换为 `edit` 态，光标落在合并后的末尾
4. 如果上一个 Block 有 `collapsed` 子 Block：不做特殊处理，光标落入上一个 Block

**边界情况：**

| 场景                                      | 行为                                    |
| --------------------------------------- | ------------------------------------- |
| 光标不在 Block 开头                           | Backspace 由 tiptap 处理（删除光标前字符），不触发合并  |
| 当前 Block 是页面第一个 Block                   | 不触发合并，Backspace 由 tiptap 处理（无字符可删时忽略） |
| 当前 Block 是第一个可见 Block（父 Block 折叠导致）     | 不触发合并                                 |
| 上一个 Block 有子 Block                      | 合并后，上一个 Block 的子 Block 保持不变           |
| 上一个 Block 已折叠                           | 合并后保持折叠态，光标落入后不展开                     |
| 当前 Block 是 Page（isPage=true）且是其唯一 Block | 不允许删除 Page 本身（backlinks 依赖），改为清空内容    |
| 空 Block（无文字）按 Backspace                 | 视为"光标在 Block 开头"，触发合并（删除空 Block）      |
| 合并后上一个 Block 有未保存内容                     | 先保存上一个 Block，再合并                      |

***

### 3.3 Tab — 缩进（Indent）

**前提：** 当前 Block 处于 `edit` 态或 `focused` 态

**行为：**

1. 检查前一个兄弟 Block 是否存在
2. 如果存在：将当前 Block 添加为前一个 Block 的子 Block（作为最后一个子节点）
3. 更新当前 Block 的 `parentId` = 前一个 Block 的 `id`
4. 更新当前 Block 的 `left`（继承父级子树末尾的 gap）
5. 如果当前 Block 有兄弟 Block：将兄弟 Block 的 `left` 值重排（腾出空间）

**缩进层级限制：**

| 当前层级              | Tab 行为                 |
| ----------------- | ---------------------- |
| level 1 → level 2 | 正常缩进                   |
| level 2 → level 3 | 正常缩进                   |
| ... → level 6     | 正常缩进                   |
| level 6 → level 7 | 允许缩进，但不显示层级线（视觉上限 6 级） |
| level 任意 → 超过合理深度 | 允许操作，代码无硬性限制           |

**边界情况：**

| 场景                             | 行为                               |
| ------------------------------ | -------------------------------- |
| 当前 Block 是页面第一个 Block（无前一个兄弟）  | 不做任何操作                           |
| 当前 Block 已是父 Block 的第一个子 Block | 正常缩进                             |
| 当前 Block 有后续兄弟 Block           | 缩进后，后续兄弟 Block 保持原有层级，left 值重排   |
| 当前 Block 处于折叠态（collapsed=true） | 正常缩进，折叠态不变                       |
| 当前 Block 有子 Block              | 子 Block 随父 Block 一起移动（整棵子树缩进）    |
| 光标在 Block 末尾按 Tab              | 正常缩进，光标位置保持（移动到新父 Block 的子节点末尾）  |
| 光标在 Block 中间按 Tab              | 正常缩进，光标位置保持（tiptap selection 保持） |

***

### 3.4 Shift + Tab — 反缩进（Outdent）

**前提：** 当前 Block 处于 `edit` 态或 `focused` 态，且不是顶级 Block（`parentId !== null`）

**行为：**

1. 获取当前 Block 的父 Block（parentId 查找）
2. 将当前 Block 从父 Block 的 children 数组中移除
3. 将当前 Block 添加到父 Block 的兄弟数组中（插入到父 Block 之后）
4. 更新当前 Block 的 `parentId` = 父 Block 的 `parentId`
5. 更新当前 Block 的 `left`（基于新位置计算）

**边界情况：**

| 场景                                               | 行为                              |
| ------------------------------------------------ | ------------------------------- |
| 当前 Block 是顶级 Block（parentId = null，isPage=true）  | 不做任何操作                          |
| 当前 Block 是顶级 Block（parentId = null，isPage=false） | 不做任何操作                          |
| 当前 Block 有子 Block                                | 子 Block 随当前 Block 一起移动（整棵子树反缩进） |
| 父 Block 是当前页面的最后一个子 Block                        | 当前 Block 反缩进后，插入到父 Block 之后     |
| 父 Block 已折叠                                      | 当前 Block 反缩进后，父 Block 的折叠态不变    |
| 反缩进后当前 Block 无前一个兄弟（成为父级的第一个子节点）                 | left 值从父级的第一个子节点计算              |
| 连续 Shift+Tab（多级反缩进）                              | 每次操作一个层级                        |

***

### 3.5 ↑ — 上移焦点

**前提：** 无特定状态要求，在 `edit` 态和 `focused` 态均可触发

**行为：**

1. 如果当前处于 `edit` 态：先保存内容，退出编辑态
2. 移动焦点到上一个 Block（按树的先序遍历顺序）
3. 目标 Block 进入 `focused` 态（而非 `edit` 态）
4. 如果目标 Block 在视口外：滚动页面使目标 Block 可见

**树的先序遍历顺序定义：**

- 父 Block 先于子 Block
- 同级按 left 值升序
- 示例：level1-A → level2-A1 → level3-A1a → level2-A2 → level1-B

**边界情况：**

| 场景                                 | 行为                         |
| ---------------------------------- | -------------------------- |
| 当前 Block 是页面第一个 Block              | 不做任何操作                     |
| 当前 Block 是折叠态父 Block 的第一个可见子 Block | 焦点移动到父 Block               |
| 上一个 Block 是折叠态父 Block              | 焦点移动到该父 Block（不进入其子 Block） |
| 上一个 Block 在折叠子树中                   | 焦点移动到折叠子树的父 Block          |
| 快速连续按 ↑                            | 依次处理，每次按键移动一个 Block        |

***

### 3.6 ↓ — 下移焦点

**前提：** 无特定状态要求

**行为：**

1. 如果当前处于 `edit` 态：先保存内容，退出编辑态
2. 移动焦点到下一个 Block（按树的先序遍历顺序）
3. 目标 Block 进入 `focused` 态
4. 如果目标 Block 在视口外：滚动页面使目标 Block 可见

**边界情况：**

| 场景                     | 行为                                 |
| ---------------------- | ---------------------------------- |
| 当前 Block 是页面最后一个 Block | 不做任何操作                             |
| 当前 Block 是折叠态父 Block   | 跳过其所有子 Block（不获取焦点），移动到下一个可见 Block |
| 下一个 Block 是折叠态父 Block  | 焦点移动到该父 Block（不进入其子 Block）         |
| 快速连续按 ↓                | 依次处理，每次按键移动一个 Block                |

***

### 3.7 Enter（在 `focused` 态）— 进入编辑

**前提：** 当前 Block 处于 `focused` 态（非 `edit`）

**行为：**

- 将当前 Block 切换为 `edit` 态（挂载 tiptap）
- 光标落在 Block 末尾（tiptap 自动将 selection 设置到文档末尾）

> 这与 3.1 的 Enter（拆分）不同：3.1 要求在 `edit` 态触发。

***

### 3.8 ESC — 退出编辑 / 取消操作

**行为（按优先级）：**

| 当前状态        | ESC 行为                  |
| ----------- | ----------------------- |
| `edit` 态    | 保存内容，退出编辑态（`display` 态） |
| `focused` 态 | 清除焦点（回到 `display` 态）    |
| 拖拽中         | 取消拖拽，Block 回到原位         |
| 无特殊状态       | 不做任何操作                  |

**边界情况：**

| 场景                                  | 行为                                          |
| ----------------------------------- | ------------------------------------------- |
| ESC 退出编辑时内容为空                       | 保存空内容，不删除 Block（除非 Block 是空 Page 的唯一 Block） |
| ESC 时有未保存的 Property（key:: value 格式） | 与普通内容一起保存                                   |
| ESC 后立即触发其他键盘操作                     | 按顺序依次处理                                     |

***

### 3.9 Ctrl + S — 手动保存

**行为：**

- 触发当前 `edit` 态 Block 的保存逻辑（等同于 blur）
- 写入 IndexedDB
- 无 UI 反馈（Phase 1 不实现 toast 提示）

**边界情况：**

| 场景                 | 行为                                  |
| ------------------ | ----------------------------------- |
| 无 `edit` 态 Block   | 不做任何操作                              |
| 保存失败（IndexedDB 错误） | Phase 1 不实现错误处理（dev-guide.md 中标注待定） |

***

## 4. 边界情况汇总

### 4.1 空 Block 处理

| 场景                    | 处理方式                          |
| --------------------- | ----------------------------- |
| Page 无 Block          | 自动创建 1 个空 Block，进入 `edit` 态   |
| 空 Block 按 Enter       | 在空 Block 之前插入空 Block（快速创建上一行） |
| 空 Block 按 Backspace   | 删除空 Block，焦点移动到上一个 Block      |
| 唯一空 Block 按 Backspace | 保留空 Block（不可删除最后一个 Block）     |
| 空 Block 拖拽            | 允许，正常拖拽操作                     |
| 空 Block 有子 Block      | 不可能（空 Block 不会有子 Block）       |

### 4.2 层级边界

| 场景                    | 处理方式                           |
| --------------------- | ------------------------------ |
| Tab 到极深层级（level > 10） | 允许，代码无硬性限制，但层级线最多显示 6 条        |
| Shift+Tab 到顶级         | 允许，如果已是顶级（parentId = null）则不操作 |
| Tab 后立即 Shift+Tab     | 回到原始位置                         |

### 4.3 折叠状态下的操作

| 操作                    | 折叠态 Block 的行为                   |
| --------------------- | ------------------------------- |
| ↑ 焦点移动                | 折叠 Block 视为单个节点，焦点跳过其所有子 Block  |
| ↓ 焦点移动                | 折叠 Block 视为单个节点，焦点跳过其所有子 Block  |
| 点击折叠 Block 内容区        | 进入 `edit` 态，Block 自动展开          |
| Tab 缩进到折叠 Block       | 正常缩进，折叠态不变                      |
| 折叠 Block 有子 Block 被拖入 | 拖入后 Block 保持折叠态（collapsed=true） |

### 4.4 链接和标签交互

| 场景                  | 处理方式                                |
| ------------------- | ----------------------------------- |
| 点击悬空链接（目标 Page 不存在） | 显示链接文本，但点击无反应（Phase 1），或显示"页面不存在"提示 |
| 编辑态输入 `[[` 后立即按 ESC | 临时高亮清除，`[[` 字符保留在内容中（待下次保存时解析）      |
| 删除带链接的 Block        | Link 表中对应记录同步删除（保存时触发）              |
| Block 内容中的标签 `#tag` | 仅高亮显示，点击无操作（Phase 1）                |

### 4.5 Property 行

| 场景                        | 处理方式                                  |
| ------------------------- | ------------------------------------- |
| 输入 `key:: value` 后按 Enter | 内容保存，Property 持久化到 `Block.properties` |
| Enter 在 Property 行中间      | 拆分 Block，Property 仅存在于前半 Block        |
| Backspace 在 Property 行开头  | 合并到上一个 Block，Property 保留              |

### 4.6 多操作连续触发

| 场景                   | 处理方式                                            |
| -------------------- | ----------------------------------------------- |
| Enter 后立即按 Tab       | 先完成 Enter（创建新 Block + 进入编辑），再处理 Tab（新 Block 缩进） |
| Tab 后立即按 Backspace   | 先完成 Tab，再处理 Backspace（撤消 Tab 效果）                |
| 拖拽过程中按 Enter         | 拖拽被取消，Enter 正常触发（当前 Block 进入编辑）                 |
| blur 触发保存的同时按 Ctrl+S | 两者合并为一次保存（防抖处理）                                 |

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

### 5.2 状态一致性保证

- 所有状态变更通过 Pinia store 统一管理
- 禁止直接修改 DOM 触发业务逻辑
- 拖拽操作的视觉反馈通过 `draggingBlockId` 状态控制
- 编辑态切换通过 `activeBlockId` 控制

***

## 6. 未涵盖场景（Phase 2+）

以下场景暂不在本文档定义：

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

*文档 v0.1，初稿待评审。*
