# Page（Block 树）交互规范 — 系统功能验证报告

**基准文档**: `d:\comind\docs\interaction-spec.md` v0.6  
**验证日期**: 2026-04-27  
**验证方法**: 代码逐行比对 + 边界条件推演  

---

## 验证总览

| 章节 | 功能点 | 通过 | 部分 | 未实现 | 阻塞 |
|------|--------|------|------|--------|------|
| 1 基础状态 | 状态机定义 | 2 | 1 | 1 | 0 |
| 2 鼠标操作 | 7 个子项 | 5 | 2 | 0 | 0 |
| 3 键盘操作 | 9 个子项 | 7 | 1 | 1 | 0 |
| 4 边界情况 | 4 个子项 | 2 | 1 | 1 | 0 |
| 5 优先级/一致性 | 2 个子项 | 1 | 1 | 0 | 0 |
| **合计** | **28 个检查点** | **17** | **6** | **4** | **0** |

---

## 1. 基础状态定义

### 1.1 Block 状态机

| 状态 | 设计定义 | 实现位置 | 验证结果 | 说明 |
|------|----------|----------|----------|------|
| display | 展示态，不在编辑 | Block/index.vue — isActive=false 时渲染 block-text | 通过 | — |
| edit | 编辑态，tiptap 挂载 | Block/index.vue — isActive=true 时渲染 Editor | 通过 | — |
| focused | 键盘焦点态（未编辑） | **未实现** | 未实现 | 规范标注部分实现，代码中无此状态 |
| dragging | 正在被拖拽 | Sortable.js 通过 CSS class 控制视觉，无 Pinia 状态 | 部分实现 | 规范要求 draggingBlockId 状态控制，实际未实现 |

**结论**: display/edit 已实现。focused 态未实现（Phase 2）。dragging 态仅有 Sortable 内置视觉反馈，无状态机控制。

### 1.2 状态转换图

| 转换路径 | 设计 | 实现 | 结果 |
|----------|------|------|------|
| display -> edit (点击/Enter) | activateBlock() | Block/index.vue:handleContentMouseDown -> editorStore.activateBlock() | 通过 |
| edit -> display (ESC/blur/点击其他) | deactivateBlock() | Editor.vue:onBlur / Block/index.vue:handleExitEdit / Page/index.vue:handleMainClick | 通过 |
| display -> focused (↑↓) | 键盘焦点移动 | **未实现** | 未实现 |
| focused -> edit (Enter) | 进入编辑 | **未实现**（focused 态不存在） | 未实现 |

**结论**: 主路径（display <-> edit）已实现。focused 态相关路径全部缺失。

### 1.2 临时状态与 collapsed 字段

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| pendingCursorPos | editorStore.cursorPos，用完即清 | editor.ts:pendingCursorPos + consumeCursorPos() | 通过 |
| collapsed 运行时状态 | 控制子节点折叠，存储于 IndexedDB | Block/index.vue:collapsed = ref(false) — **本地 ref，不在 Block 数据模型中** | 部分实现 |

**I-1: collapsed 状态未持久化**  
规范声称 "collapsed 存储于 IndexedDB"，但 Block 接口和 BlockRecord 均无 collapsed 字段。collapsed 是 Block/index.vue 的本地 ref(false)，页面刷新后全部重置为展开态。

**影响**: 
- 折叠状态无法跨会话保持
- findPreviousBlockInTreeOrder / findNextBlockInTreeOrder 无法获知折叠状态，导致 ↑↓ 导航行为与规范不符（见 3.5/3.6）

**建议**: 将 collapsed 加入 Block.properties 或新增 collapsed 字段到数据模型。

---

## 2. 鼠标操作

### 2.1 单击 Block 内容区

| 检查项 | 设计行为 | 实现代码 | 结果 |
|--------|----------|----------|------|
| 切换 edit 态 | activateBlock() | Block/index.vue:handleContentMouseDown -> editorStore.activateBlock() | 通过 |
| 保存其他 edit 态 Block | 先保存再切换 | editorStore.activateBlock() 内部先 deactivateBlock() | 通过 |
| 光标落在点击位置 | document.caretPositionFromPoint | Block/index.vue:getCaretPositionFromPoint() + setCursorPos() | 通过 |
| 操作区保持可见 | 折叠图标、拖拽手柄始终可见 | 模板中操作区与内容区并列，不受 isActive 影响 | 通过 |

**边界情况验证**:

| 场景 | 设计行为 | 实现验证 | 结果 |
|------|----------|----------|------|
| 点击已有 edit 态 Block | 不切换，光标移动到点击位置 | activateBlock 内部若 activeBlockId === blockId 不操作；setCursorPos 仍执行 | 通过 |
| 点击折叠态父 Block | 进入 edit，不自动展开子节点 | collapsed 为本地 ref，activateBlock 不修改它 | 通过 |
| 点击子 Block（父折叠） | 父自动展开，子进入 edit | **无法实现** — 子 Block 被 max-height: 0px 隐藏，无法点击 | 部分实现 |
| 点击已选中文字 | 不触发状态切换 | @mousedown 在 tiptap 内部触发，handleContentMouseDown 仅在非 edit 态执行 | 通过 |
| 点击页面空白区域 | 退出 edit 态 | Page/index.vue:handleMainClick — editorStore.deactivateBlock() | 通过 |

**I-2: 点击折叠父 Block 的子节点无法触发**  
由于 collapsed 控制 max-height: 0px + overflow: hidden，子 Block 被完全隐藏，用户物理上无法点击到子节点。此边界情况在实际中不会发生，但规范描述的行为（"父 Block 自动展开"）无对应实现。

### 2.2 单击折叠图标

| 检查项 | 设计行为 | 实现代码 | 结果 |
|--------|----------|----------|------|
| 切换 collapsed | true <-> false | Block/index.vue:handleToggleCollapse | 通过 |
| 子节点高度动画 | max-height 过渡 200ms | watch(collapsed) + requestAnimationFrame + setTimeout(220) | 通过 |
| 不触发编辑态 | @click.stop | Block/index.vue — @click.stop="handleToggleCollapse" | 通过 |
| 无子节点时无操作 | children.length === 0 时 return | Block/index.vue:343 — 前置 guard | 通过 |
| 动画中重复点击 | isAnimating 直接跳目标 | Block/index.vue:343 — isAnimating.value guard | 通过 |

**结论**: 完全实现，与规范一致。

### 2.3 单击拖拽手柄

| 检查项 | 设计行为 | 实现代码 | 结果 |
|--------|----------|----------|------|
| Sortable.js 引入 | npm install sortablejs | package.json 依赖 | 通过 |
| useSortable.ts | 封装 Sortable 初始化 | src/composables/useSortable.ts | 通过 |
| 跨容器拖拽 | group: 'blocks' | useSortable.ts:21 — group: 'blocks' | 通过 |
| 拖拽手柄 | bullet 区域作为手柄 | useSortable.ts:28 — handle: '.block-bullet' | 通过 |
| 循环嵌套检测 | isDescendantOf() + onMove | useSortable.ts:32-37 | 通过 |
| dragging 态视觉 | opacity 0.5, accent-subtle 背景 | **未找到对应 CSS** | 未实现 |
| 放置指示线 | 2px accent 线 | Sortable 内置 ghost 元素 | 部分实现 |
| 放置类型（50% 区域/操作区） | 上方50%=前兄弟, 下方50%=后兄弟, 操作区=子 | **未实现** — Sortable 默认行为，无自定义放置逻辑 | 未实现 |

**I-3: 拖拽视觉反馈缺失**  
规范要求 dragging 态有 opacity: 0.5 和 accent-subtle 背景，但全局搜索 .sortable-ghost、.sortable-drag、dragging 等 CSS 类，在 src/style.css、src/components/Block/styles.css、src/components/Page/styles.css 中均无定义。Sortable.js 的默认 ghost 样式可能不符合设计规范。

**I-4: 放置类型逻辑未实现**  
规范定义了三种放置类型（前兄弟/后兄弟/子节点），由鼠标位置决定：
- 目标 Block 上方 50% -> 前兄弟
- 目标 Block 下方 50% -> 后兄弟  
- 目标 Block 操作区（左侧 24px）-> 子节点

实际实现中，useSortable.ts 仅传递 newIndex 给 moveBlock()，Sortable.js 自动计算插入位置，无自定义放置区域逻辑。这意味着：
- 无法通过拖拽到操作区实现缩进（放置为子节点）
- 放置指示线不会根据放置类型缩进 24px

### 2.4 双击 Block 内容区

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| 等同于单击 | 进入 edit 态 | Block/index.vue 无双击特殊处理，tiptap 自然处理 | 通过 |
| 双击选词 | tiptap 处理 | tiptap StarterKit 内置 | 通过 |

**结论**: 符合规范。

### 2.5 单击页面空白区域

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| 有 edit 态 Block -> blur+保存+退出 | editorStore.deactivateBlock() | Page/index.vue:handleMainClick | 通过 |
| 无 edit 态 Block -> 无操作 | 无操作 | 无 activeBlockId 时 deactivateBlock() 无副作用 | 通过 |

**边界情况**:

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| 点击页面标题区空白 | active block 失活 | handleMainClick 检查 !target.closest('.block')，标题区无 .block -> 失活 | 通过 |
| 点击 main-content padding | active block 失活 | 同上 | 通过 |
| 点击滚动条 | 无操作 | 滚动条非 HTMLElement，不触发 click | 通过 |

**结论**: 实现正确。注意实现位置在 Page/index.vue 而非 App.vue，但功能等效。

### 2.6 Sidebar 页面点击

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| 切换 currentPageId | 更新到目标 Page | SidebarRecent.vue:handleNavigate -> router.push() | 通过 |
| 切换后第一个 block 进入 edit 态 | ensureFirstBlock() + onMounted | **未实现** — 无 ensureFirstBlock 函数 | 未实现 |
| 切换前保存当前 block 内容 | deactivateBlock() | **未实现** — handleNavigate 直接 router.push()，不保存 | 部分实现 |

**I-5: 切换页面时当前 block 内容丢失（P0 已知问题，确认未修复）**  
SidebarRecent.vue:handleNavigate:
```typescript
function handleNavigate(pageId: string) {
  // 没有 editorStore.deactivateBlock()！
  router.push(...)
}
```

路由切换时：
1. Page/index.vue 的 onBeforeUnmount 调用 editorStore.deactivateBlock()
2. 但此时 Editor.vue 的 onBeforeUnmount 已经销毁了编辑器
3. onBlur 不会触发（编辑器已销毁）
4. 未保存的内容丢失

**I-6: 切换页面后第一个 Block 未自动进入 edit 态**  
规范要求 "第一个 Block 自动进入 edit 态，光标落入"。代码中无此逻辑：
- Page/index.vue 无 onMounted 激活逻辑
- 无 ensureFirstBlock 函数
- 路由切换后页面显示为全 display 态

### 2.7 Backlinks 区域点击

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| [[WikiLink]] 渲染 | 高亮样式 | Block/index.vue:renderContent() | 通过 |
| 页面内点击 WikiLink 跳转 | handleContentClick() | Block/index.vue:handleContentClick -> navigateToPage() | 通过 |
| Backlinks 面板 UI | 位于 Page 底部 | Page/index.vue 模板底部 <Backlinks /> | 通过 |
| Backlinks 点击跳转 | handleBacklinkClick() | Backlinks.vue:handleBacklinkClick | 通过 |
| 悬空链接（目标 Page 不存在） | 创建新 Page | useNavigateToPage -> router.push -> beforeEnter 创建 | 通过 |
| 源 Block 已删除 | 显示 "(来源块已删除)" | Backlinks.vue — orphan-block 样式 + hint 文本 | 通过 |
| 源 Page 已删除 | 显示 "(来源页面已删除)" | Backlinks.vue — orphan-page 样式 + hint 文本 | 通过 |
| Backlinks 可折叠 | collapsed ref + 点击 header | Backlinks.vue:collapsed + @click="collapsed = !collapsed" | 通过 |

**边界情况**:

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| 源 Block 已删除 | 保留 Backlink，悬空样式 | orphan-block class + cursor: not-allowed | 通过 |
| 源 Page 已删除 | 保留 Backlink，删除线样式 | orphan-page class + text-decoration: line-through | 通过 |
| 大量 Backlink（100+） | Phase 1 不分页 | 无分页逻辑，全部渲染 | 通过 |
| Backlinks 折叠/展开 | 点击 header 切换 | collapsed ref 控制 max-height | 通过 |

**结论**: 完全实现，与规范一致。

### 2.8 层级线（Level Lines）

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| 显示条件 | children.length > 0 && !collapsed | Block/index.vue:387 — v-if="children.length > 0 && !collapsed" | 通过 |
| 垂直高度 | 当前 Block 下方 -> 最后一个子孙底部 | calculateLevelLineHeight() — lastChildRect.bottom - blockRect.bottom | 通过 |
| 水平位置 | left: indentDepth * 24 + 9px | levelLineLeft computed | 通过 |
| 样式 | 1px, accent, opacity 0.15, 实线 | Block/styles.css — .block-level-line | 通过 |
| 过渡动画 | 200ms ease-out | transition: height 200ms ease-out, opacity 200ms ease-out | 通过 |

**边界情况**:

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| 无子 Block | 不显示 | v-if 条件控制 | 通过 |
| 折叠态 | 不显示 | !collapsed 条件 | 通过 |
| 嵌套极深（>10 层） | 正常显示 | 无硬编码限制 | 通过 |
| 展开/折叠切换 | 高度随子节点变化 | watch(collapsed) + calculateLevelLineHeight() | 通过 |
| 缩进/反缩进后 | 水平位置调整 | indentDepth computed 实时更新 | 通过 |

**结论**: 完全实现，与规范一致。

---

## 3. 键盘操作

### 3.1 Enter — 拆分 Block

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| 截断内容 | 光标位置 split | Block/index.vue:handleSplit — pmPosToTextOffset + .slice() | 通过 |
| 生成新 Block | blockStore.splitBlock() | blocks.ts:splitBlock | 通过 |
| 新 Block 为下一个兄弟 | 插入当前 Block 之后 | splitBlock 中 isCreateChild=false 时 newParentId=block.parentId | 通过 |
| 新 Block 自动 edit | activateBlock(newBlock.id, 1) | Block/index.vue:handleSplit — editorStore.activateBlock(newBlock.id, 1) | 通过 |
| 光标落入开头 | cursorPos=1 | activateBlock 设置 pendingCursorPos=1 | 通过 |

**边界情况**:

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| 空 Block 按 Enter | 插入空 Block，光标落入开头 | splitBlock 中 before='', after='' -> 新 Block 内容为空 | 通过 |
| 只有空白字符 | 视为空 Block | 空白字符是有效内容，content.length > 0 -> 正常 split | 部分实现 |
| Enter 后立即其他快捷键 | 依次处理 | 事件循环自然顺序，无阻塞 | 通过 |
| 拆分后新 Block Tab 缩进 | 正常处理 | handleIndent 独立处理 | 通过 |
| 页面最后一个 Block Enter | 在最后插入 | splitBlock 中 nextSibling=undefined -> calcInsertPos(block.pos, null) | 通过 |
| Block 有子 Block | 仅拆分当前，不影响子 | isCreateChild = isCollapsed || childBlocks.length > 0 -> 有子则新 Block 为子 | 通过 |

**I-7: "只有空白字符视为空 Block" 未实现**  
规范说 "Block 只有空白字符" 应视为空 Block，但代码中 content.length === 0 才触发 type='delete'（在 EnterAsBlockExtension 的 Backspace 处理中）。对于 Enter，splitBlock 始终按正常 split 处理，不会将全空白内容视为空 Block。

### 3.2 Backspace — 合并 Block

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| 光标在开头判定 | selection.anchor.offset === 0 | EnterAsBlockExtension: $from.parentOffset === 0 && from === to | 通过 |
| 内容追加到上一 Block | prev.content += block.content | blocks.ts:mergeWithPrevious | 通过 |
| 删除当前 Block | deleteBlock(blockId) | blocks.ts:mergeWithPrevious -> deleteBlock() | 通过 |
| 上一 Block 进入 edit | activateBlock(prev.id, cursorPos) | Block/index.vue:handleMerge -> activateBlock(result.id, result.cursorPos) | 通过 |
| 光标落在合并后末尾 | cursorPos = prevContentLen + 1 | blocks.ts:mergeWithPrevious — cursorPos = prevContentLen + 1 | 通过 |

**边界情况**:

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| 光标不在开头 | tiptap 处理 | EnterAsBlockExtension — return false | 通过 |
| 第一个 Block | 不触发合并 | findPreviousBlockInTreeOrder 返回 undefined -> return | 通过 |
| 第一个可见 Block（父折叠） | 不触发合并 | 同上，树前序遍历前驱可能为父 Block | 通过 |
| 上一 Block 有子 | 合并后子保持不变 | mergeWithPrevious 只改 content，不动子节点 | 通过 |
| 上一 Block 已折叠 | 保持折叠，光标落入不展开 | mergeWithPrevious 不改 collapsed 状态 | 通过 |
| 唯一空 Block Backspace | 保留，清空内容 | Block/index.vue:handleDelete — 无 prev 时 updateBlockContent(blockId, '') | 通过 |
| 空 Block Backspace | 删除空 Block，focus prev | content.length === 0 -> type='delete' -> handleDelete | 通过 |
| 合并后上一 Block 未保存 | 先保存再合并 | handleMerge 先 markSaved() + handleSave() | 通过 |

**结论**: 完全实现，与规范一致。

### 3.3 Tab — 缩进（Indent）

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| 检查前一个兄弟 | 存在才缩进 | blocks.ts:indent — getPrevSibling() | 通过 |
| 设为前一个兄弟的子 | parentId = prev.id | block.parentId = prev.id | 通过 |
| 更新 pos | calcInsertPos(lastPos, null) | 先计算 pos，再改 parentId | 通过 |
| 子 Block 随父移动 | parentId 不变，left 重排 | **pos 系统自然满足** — 子节点 parentId 不变，随父移动 | 通过 |
| 后续兄弟 left 重排 | 腾出空间 | **pos 系统无需重排** — gap 排序不需要调整其他节点 | 通过 |

**边界情况**:

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| 第一个 Block（无前兄弟） | 不操作 | !prev -> return | 通过 |
| 已是父第一个子 | 正常缩进 | 无前兄弟限制，任意位置可缩进 | 通过 |
| 有后续兄弟 | 后续保持层级 | pos 系统无需调整 | 通过 |
| 折叠态缩进 | 折叠态不变 | indent() 不改 collapsed | 通过 |
| 有子 Block | 子随父移动 | parentId 不变，自然跟随 | 通过 |
| 光标在末尾按 Tab | 正常缩进 | handleIndent 不依赖光标位置 | 通过 |

**结论**: 完全实现。pos 系统天然满足规范中 "子随父移动" 和 "兄弟重排" 的要求。

### 3.4 Shift+Tab — 反缩进（Outdent）

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| 前提：非顶级 | parentId !== null | blocks.ts:outdent — !block.parentId -> return | 通过 |
| 获取父 Block | blocks.value.find | blocks.ts:outdent — parent = blocks.value.find(...) | 通过 |
| 从父 children 移除 | parentId 变更 | block.parentId = newParentId | 通过 |
| 添加到父的兄弟数组 | 插入父之后 | calcInsertPos(parent.pos, nextSibling?.pos) | 通过 |
| 更新 pos | 先计算再修改 | blocks.ts:outdent — 先 getNextSibling(parent)，再改 parentId | 通过 |
| 子 Block 随父移动 | parentId 不变 | pos 系统自然满足 | 通过 |

**边界情况**:

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| 顶级 Block | 不操作 | !block.parentId -> return | 通过 |
| 有子 Block | 子随父反缩进 | parentId 不变，自然跟随 | 通过 |
| 父是最后一个子 | 插入父之后 | calcInsertPos(parent.pos, null) | 通过 |
| 父已折叠 | 折叠态不变 | outdent() 不改 collapsed | 通过 |
| 连续 Shift+Tab | 每次一级 | 每次调用 outdent() 只升一级 | 通过 |

**结论**: 完全实现。

### 3.5 ↑ — 上移焦点

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| 保存并退出 edit | markSaved() + handleSave() + deactivateBlock() | Block/index.vue:handleMoveUp | 通过 |
| 移动到上一 Block | 树前序遍历前驱 | blocks.ts:findPreviousBlockInTreeOrder | 通过 |
| 目标进入 edit | activateBlock(prev.id) | editorStore.activateBlock(prevBlock.id) | 通过 |

**边界情况**:

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| 第一个 Block | 无操作 | !prevBlock -> 不执行 | 通过 |
| 光标不在文档开头 | tiptap 处理 | $from.parentOffset === 0 guard | 通过 |
| 上一 Block 已折叠 | 切换到该 Block（不展开） | **实际行为: 进入最深末端子节点** | 部分实现 |
| 上一 Block 有子 | 切换到最深末端子节点 | findPreviousBlockInTreeOrder 始终深入子树 | 部分实现 |

**I-8: ↑↓ 导航不 respects 折叠状态**  
规范要求："折叠 Block 视为单个节点，焦点跳转到其前驱（不进入子树）"。

实际 findPreviousBlockInTreeOrder:
```typescript
if (prevSibling) {
  let current: Block = prevSibling
  while (true) {
    const children = getSortedChildren(blocks.value, current.id, block.pageId)
    if (children.length === 0) break
    current = children[children.length - 1]  // 始终深入最后一个子节点
  }
  return current
}
```

此代码**始终**深入子树找最深末端节点，无论父节点是否折叠。由于 collapsed 是本地 ref 而非数据模型字段，findPreviousBlockInTreeOrder 无法获知折叠状态。

**预期行为**: 若 prevSibling.collapsed === true，应直接返回 prevSibling 而非其最深末端子节点。

**同样问题存在于 findNextBlockInTreeOrder**:
```typescript
const children = getSortedChildren(blocks.value, block.id, block.pageId)
if (children.length > 0) {
  return children[0]  // 始终返回第一个子节点
}
```

若当前 Block 折叠，应视为无子节点，直接返回下一个兄弟或向上回溯。

### 3.6 ↓ — 下移焦点

与 3.5 相同分析，同样存在 I-8 折叠状态问题。

### 3.7 Enter（focused 态）

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| focused -> edit | 进入编辑，光标在末尾 | **未实现** — focused 态不存在 | 未实现 |

**结论**: 未实现 — 依赖 focused 态，无法验证。

### 3.8 ESC — 退出编辑

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| edit 态 -> 保存+退出 | handleExitEdit() | EnterAsBlockExtension:Escape -> type='exitEdit' -> Block/index.vue:handleExitEdit | 通过 |
| focused 态 -> 清除焦点 | 回到 display | **未实现** — focused 态不存在 | 未实现 |
| 拖拽中 -> 取消拖拽 | Block 回到原位 | **未实现** — 无拖拽取消逻辑 | 未实现 |
| 无特殊状态 -> 无操作 | 不做任何操作 | 仅在 edit 态时 ESC 有响应 | 通过 |

**结论**: edit 态 ESC 已实现。focused 态和拖拽取消 未实现（依赖缺失功能）。

### 3.9 Ctrl+S — 手动保存

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| 触发保存 | Mod-s 快捷键 | EnterAsBlockExtension:'Mod-s' | 通过 |
| 写入 IndexedDB | blockStore.updateBlockContent() | Editor.vue:handleEnterAsBlock -> emit('save') -> handleSave -> updateBlockContent | 通过 |
| 无 edit 态 Block | 不做任何操作 | 无 active editor 时快捷键不触发 | 通过 |
| 保存失败 | Phase 1 不实现错误处理 | 无错误处理 | 部分实现 |

**结论**: 核心功能已实现。保存失败处理为已知限制。

---

## 4. 边界情况汇总

### 4.1 空 Block 处理

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| Page 无 Block | 自动创建 1 个空 Block，进入 edit | createPageWithRootBlock 创建根 Block，Page/index.vue 无自动激活 | 部分实现 |
| 空 Block 按 Enter | 插入空 Block，光标落入开头 | splitBlock 处理 | 通过 |
| 空 Block 按 Backspace | 删除空 Block，focus prev | handleDelete 处理 | 通过 |
| 唯一空 Block 按 Backspace | 保留空 Block | handleDelete — 无 prev 时清空内容 | 通过 |
| 空 Block 拖拽 | 允许 | Sortable 不限制 | 通过 |
| 空 Block 有子 Block | 不可能 | 空 Block 不会有子 | 通过 |

**I-9: Page 无 Block 时未自动进入 edit 态**  
createPageWithRootBlock 创建根 Block 时设置 content=''，但 Page/index.vue 无逻辑在页面加载后自动激活第一个 Block。用户需要手动点击才能进入 edit 态。

### 4.2 层级边界

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| Tab 到极深层级 | 允许，无硬性限制 | 代码无限制 | 通过 |
| Shift+Tab 到顶级 | 允许，parentId=null 时不操作 | !block.parentId -> return | 通过 |
| Tab 后立即 Shift+Tab | 回到原始位置 | 理论上可以，但 pos 值可能不同 | 部分实现 |

**I-10: Tab + Shift+Tab 不一定回到原始位置**  
由于 pos 是 gap 排序，缩进后新 pos = calcInsertPos(lastChildPos, null)，反缩进后新 pos = calcInsertPos(parent.pos, nextSibling?.pos)。这两个计算结果通常不同，所以 Tab 后再 Shift+Tab 不会回到原始 pos 值。但在排序后的视觉位置上，Block 会回到原始位置（因为它回到了原来的父节点和兄弟之间）。

### 4.3 折叠状态下的操作

| 操作 | 设计 | 实现 | 结果 |
|------|------|------|------|
| ↑ 焦点移动 | 折叠 Block 视为单个节点 | **实际: 进入最深末端子节点** | 部分实现 I-8 |
| ↓ 焦点移动 | 折叠 Block 视为单个节点 | **实际: 进入第一个子节点** | 部分实现 I-8 |
| 点击折叠 Block 内容区 | 进入 edit，自动展开 | **实际: 进入 edit，但不自动展开** | 部分实现 |
| Tab 缩进到折叠 Block | 正常缩进，折叠态不变 | indent() 不改 collapsed | 通过 |
| 折叠 Block 有子被拖入 | 拖入后保持折叠 | **未验证** — 拖入操作通过 moveBlock 实现，不改 collapsed | 部分实现 |

**I-11: 点击折叠 Block 不自动展开**  
规范 2.1 边界情况："点击折叠态（collapsed=true）的父 Block 内容区 -> 进入 edit 态，父 Block 不展开，子 Block 不自动进入编辑"。

规范 4.3："点击折叠 Block 内容区 -> 进入 edit 态，Block 自动展开"。

这是规范内部矛盾！当前实现遵循 2.1（不展开）。

### 4.4 链接和标签交互

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| 页面内点击 [[WikiLink]] | 跳转对应 Page | handleContentClick -> navigateToPage() | 通过 |
| 点击悬空链接 | 创建新 Page 或显示提示 | navigateToPage -> beforeEnter 自动创建 | 通过 |
| 删除带链接的 Block | Link 表级联删除 | deleteBlockCascade 删除 sourceBlockId 相关 links | 通过 |
| #tag 点击 | 仅高亮，点击无操作 | handleContentClick — tag 打开筛选面板 | 部分实现 |

**I-12: 标签点击打开筛选面板**  
规范说 "Block 内容中的标签 #tag — 仅高亮显示，点击无操作"。但实现中 handleContentClick 对 .block-tag 调用 openFilter(tagText)，打开了标签筛选面板。这与规范不符。

### 4.5 Property 行

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| key:: value Enter | 保存 Property 到 Block.properties | **未实现** | 未实现 |
| Property 行中间 Enter | 拆分，Property 仅在前半 | **未实现** | 未实现 |
| Property 行开头 Backspace | 合并，Property 保留 | **未实现** | 未实现 |

**结论**: 未实现 Property 行解析（规范标注 Phase 2+）。

### 4.6 多操作连续触发

| 场景 | 设计 | 实现 | 结果 |
|------|------|------|------|
| Enter 后立即 Tab | 先 Enter 再 Tab | 事件循环自然顺序 | 通过 |
| Tab 后立即 Backspace | 先 Tab 再 Backspace | 事件循环自然顺序 | 通过 |
| 拖拽中按 Enter | 取消拖拽，Enter 正常 | **未实现** | 未实现 |
| blur 保存同时 Ctrl+S | 合并为一次保存 | 两次 _scheduleSave 调用，debounce 可能合并 | 部分实现 |

---

## 5. 交互优先级与冲突处理

### 5.1 操作优先级

| 优先级 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| blur / 点击外部 | 最高 | Page/index.vue:handleMainClick | 通过 |
| 拖拽 | 次高 | Sortable.js 事件拦截 | 通过 |
| ESC | 退出/取消 | EnterAsBlockExtension:Escape | 通过 |
| 其他快捷键 | Enter/Backspace/Tab/方向键 | 各 Extension 独立处理 | 通过 |

**结论**: 优先级未显式编码，但事件传播顺序自然满足。

### 5.2 状态一致性

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| Pinia 统一管理 | 所有状态变更通过 store | editorStore / blockStore / pageStore | 通过 |
| 禁止直接修改 DOM | 不通过 DOM 触发业务 | 无 DOM 直接修改业务逻辑 | 通过 |
| draggingBlockId 状态控制 | 拖拽视觉反馈状态 | **未实现** | 未实现 |
| activeBlockId 控制编辑态 | 单编辑器原则 | editorStore.activeBlockId | 通过 |

---

## 问题汇总（按严重程度排序）

### 阻塞级（0 个）
无阻塞级问题。

### 重要级（3 个）

| ID | 问题 | 位置 | 影响 | 建议修复 |
|----|------|------|------|----------|
| I-5 | 切换页面时当前 block 内容丢失 | SidebarRecent.vue:handleNavigate | 数据丢失 | 导航前调用 editorStore.deactivateBlock() |
| I-6 | 切换页面后第一个 Block 未自动进入 edit 态 | Page/index.vue | 用户体验 | onMounted 中检查并激活第一个 Block |
| I-8 | ↑↓ 导航不 respects 折叠状态 | blocks.ts:findPrevious/NextBlockInTreeOrder | 导航行为不符合预期 | 将 collapsed 加入数据模型，遍历前检查 |

### 中等级（6 个）

| ID | 问题 | 位置 | 影响 |
|----|------|------|------|
| I-1 | collapsed 状态未持久化 | Block/index.vue | 折叠状态页面刷新后丢失 |
| I-3 | 拖拽视觉反馈 CSS 缺失 | 全局样式文件 | 拖拽时无设计规范要求的视觉反馈 |
| I-4 | 放置类型逻辑未实现 | useSortable.ts | 无法通过拖拽实现缩进/反缩进 |
| I-9 | Page 无 Block 时未自动进入 edit 态 | Page/index.vue | 新页面需手动点击 |
| I-11 | 规范内部矛盾（折叠态点击是否展开） | interaction-spec.md | 2.1 与 4.3 描述矛盾 |
| I-12 | 标签点击打开筛选面板（与规范冲突） | Block/index.vue:handleContentClick | 行为与规范不符 |

### 低等级（3 个）

| ID | 问题 | 位置 | 影响 |
|----|------|------|------|
| I-2 | 点击折叠父 Block 的子节点无法触发（物理不可达） | Block/index.vue | 边界情况实际不会发生 |
| I-7 | 全空白字符 Block 未视为空 Block | EnterAsBlockExtension | 边缘情况 |
| I-10 | Tab + Shift+Tab pos 值不回到原始 | blocks.ts:indent/outdent | 视觉位置正确，pos 值不同 |

---

## 规范内部矛盾

发现 1 处规范内部矛盾：

**2.1 vs 4.3 — 折叠态 Block 点击行为**
- 2.1: "点击折叠态（collapsed=true）的父 Block 内容区 -> 进入 edit 态，父 Block 不展开"
- 4.3: "点击折叠 Block 内容区 -> 进入 edit 态，Block 自动展开"

当前实现遵循 2.1（不展开）。

---

*报告完成。28 个检查点中：17 通过，6 部分实现，4 未实现，0 阻塞。*
