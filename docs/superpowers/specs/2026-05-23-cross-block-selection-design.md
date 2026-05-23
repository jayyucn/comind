# 跨 Block 选择功能设计

## 概述

为 comind 编辑器增加跨 block 选择能力，支持用户拖拽选中多个连续 block、Ctrl+Click 切换单个 block 选中状态，以及 Ctrl+C 复制选中 block 的内容。

## 需求

- 鼠标拖拽跨 block 选择（整 block 级别，粗粒度）
- Ctrl+Click 切换单个 block 的选中状态
- Ctrl+C 复制所有选中 block 的文本内容到剪贴板
- 选中 block 显示蓝色半透明遮罩高亮

## 交互流程

### Block 各区域职责

```
┌─ block ────────────────────────────────────────────────┐
│        │              │                                │
│  缩进   │    bullet    │  属性  │     内容区 content    │
│  空白   │ 点击→折叠    │  空   │ 短按→激活编辑器       │
│        │ 拖拽→重排    │       │ 长拖→跨block选择 ★新  │
│        │  (已有)      │       │ Ctrl+Click→切换选中 ★新│
└────────┴──────────────┴───────┴───────────────────────┘
```

bullet 区和 content 区各司其职，不冲突。

### 状态机

```
                         Escape / 点击空白
              ┌──────────────────────────────────┐
              ▼                                  │
        ┌──────────┐    content区短按(无Ctrl)     │
        │  空闲状态  │ ──────────────────────► 编辑模式（已有）
        │ 无选区    │                            │
        └─────┬────┘                            │
              │                                  │
              │ content区长拖(>5px)              │
              ▼                                  │
        ┌──────────┐   mouseup    ┌──────────┐  │
        │ 拖选中    │ ──────────► │ 选区确定  │  │
        │ 实时预览  │             │ 等待操作  │──┘
        └──────────┘             └────┬─────┘
                                     │
                    Ctrl+Click ──────┤  ← 增删切换
                    Ctrl+C     ──────┤  ← 复制到剪贴板
                    Escape     ──────┘  ← 清除选区
```

### 事件时序

**mousedown（content 区）**：

1. 保留现有 `editorStore.setCursorPos(...)` 逻辑
2. 调用 `selection.startTracking(blockId)` 记录起始 block
3. 暂不激活编辑器（延迟到 mouseup 判断）

**mousemove（document 级，BlockList 注册）**：

- 鼠标仍在初始 block 范围内 → 不干预
- 鼠标超出初始 block 范围 → 进入选择模式：
  1. 如果当前有编辑器激活，先退出编辑
  2. `elementFromPoint(x, y)` 定位鼠标所在 block
  3. 计算起始 block 到当前 block 之间（树前序）的所有 block
  4. 递归展开子 block 到 selectedIds
  5. 更新遮罩渲染

**mouseup（document 级）**：

- 从未进入选择模式 → 短按行为，激活编辑器
- 在选择模式中 → 选区固化，遮罩保持

**Ctrl+Click（content 区）**：

- 切换该 block 的选中状态（连带子 block）
- 不激活编辑器

**Ctrl+C**：

- 有选区 → 从 blockStore 提取文本，写入剪贴板，阻止默认
- 无选区 → 走浏览器默认复制

**清除选区**：

- Escape 键
- 点击任意 block（进入编辑模式时）
- 点击底部留白区域

## 数据模型

```ts
// useCrossBlockSelection composable 内部状态
const selectedIds = ref<Set<string>>(new Set())
const anchorIds = ref<Set<string>>(new Set())    // mouseup 后固化的选区
const isDragging = ref(false)
const dragStartBlockId = ref<string | null>(null)
```

`anchorIds` 是 mouseup 后固化的最终选区，`selectedIds` 是拖拽过程中的实时选区。

## 新增 / 修改文件

### 新增

| 文件 | 职责 |
|------|------|
| `src/composables/useCrossBlockSelection.ts` | 核心 composable，管理选区状态、事件处理、复制逻辑 |

### 修改

| 文件 | 改动 |
|------|------|
| `src/components/BlockList.vue` | 初始化 composable，provide 注入，绑定 document mousemove/mouseup/keydown 事件 |
| `src/components/Block/index.vue` | inject composable，mousedown 区分短按/长拖/Ctrl+Click，根据 selectedIds 渲染遮罩 class |

### 不改动

- 所有 handler 的 renderComponent 不受影响
- 所有 editorComponent 不受影响
- bullet 拖拽重排逻辑不受影响

## 复制逻辑

```ts
function getSelectionText(): string {
  const parts: string[] = []
  const visited = new Set<string>()

  function collect(blockId: string) {
    if (visited.has(blockId)) return
    const block = blockStore.blocks.find(b => b.id === blockId)
    if (!block) return
    visited.add(blockId)

    if (!anchorIds.value.has(blockId)) return

    parts.push(block.content)

    // 折叠状态下不收集子节点内容
    if (block.format?.collapsed) return

    for (const child of blockStore.getChildren(blockId)) {
      collect(child.id)
    }
  }

  for (const block of blockStore.sortedBlocks) {
    collect(block.id)
  }

  return parts.join('\n')
}
```

## 遮罩渲染

通过 CSS `::after` 伪元素实现，不侵入 block 内部结构：

```css
.block.cb-selected {
  position: relative;
}
.block.cb-selected::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(66, 133, 244, 0.15);
  pointer-events: none;
  border-radius: 4px;
  z-index: 1;
}
```

## 嵌套子 block 行为

- 选中父 block 时，子 block 自动连带选中（selectedIds 中包含所有后代 block）
- 复制的文本中，折叠状态的父 block 只输出自身 content，不输出子 block 内容
- 展开状态的父 block 递归输出所有后代 block 的 content

## 边界情况

| 场景 | 行为 |
|------|------|
| 拖选从展开状态到折叠状态的 block | 折叠 block 及其后代都加入 selectedIds，视觉上只高亮折叠 block 的可见区域 |
| 拖选到 image block | image block 整体被选中，遮罩覆盖，复制时输出 `![alt](url)` 原文 |
| 拖选到 code block | code block 整体被选中，遮罩覆盖，复制时输出代码原文 |
| 编辑器处于激活状态时开始拖选 | 先保存内容（blur），退出编辑模式，再进入选择模式 |
| 快速连续短按（无拖拽） | 正常激活编辑器，不触发选择 |