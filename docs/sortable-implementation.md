# Sortable.js 拖拽实现方案

> 版本：v0.1
> 日期：2026-04-21
> 状态：评审中

---

## 1. 背景

Phase 1 拖拽功能经历多次迭代，均存在稳定性问题：

- 原生 `elementFromPoint` 方案：目标检测不稳定（`pointer-events` 覆盖、事件竞态）
- 指示线与实际放置位置不一致

本文档制定 Sortable.js 替代方案，作为正式实现指南。

---

## 2. 核心约束

本文档实现必须遵守 comind 的核心架构约束：

| 约束 | 说明 |
|------|------|
| **C1 单编辑器** | 任何时刻只有 1 个 tiptap 实例，拖拽不引入新实例 |
| **C2 Block 唯一数据单元** | 所有操作通过 blocks.ts 的 Block 状态，Sortable.js 只负责 UI 层 |
| **C3 状态驱动** | DOM 变更必须与 Pinia 状态一致，不允许 DOM 驱动数据 |

---

## 3. 架构设计

### 3.1 职责划分

```
┌─────────────────────────────────────────────────────────────┐
│                        用户交互层                            │
│  Sortable.js：检测拖拽、动画、ghost、放置位置计算                │
└────────────────────────────┬────────────────────────────────┘
                             │ onEnd 事件（仅获取信息）
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                       数据模型层                             │
│  blocks.ts：moveBlock() 更新 parentId + left + 持久化        │
└────────────────────────────┬────────────────────────────────┘
                             │ Vue 响应式
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                       渲染层                                 │
│  Block.vue v-for keyed by block.id：按 blockTree 渲染        │
└─────────────────────────────────────────────────────────────┘
```

**关键原则**：

- Sortable.js **只读** blocks 数据（读 parentId 用于分组）
- 数据变更**只能**通过 blocks.ts 的响应式状态
- Vue 组件是 `v-for keyed` 的，Sortable.js 移动 DOM 后 Vue 能正确识别"同一组件换了位置"

### 3.2 Sortable.js 与 Vue 的协同机制

**为什么不会冲突？**

Sortable.js 移动 DOM 元素时，Vue 组件的 `key`（block.id）不变。当 blocks 数据更新后：

1. Vue 的 keyed diffing 识别到组件 A 的 key 没变
2. 组件 A 已经在正确位置（Sortable.js 刚移过来的）
3. Vue 只更新 props（content 等），不重建 DOM 节点
4. 拖拽动画（ghost、opacity 变化）不受影响

**数据更新时机**：`nextTick` + 延迟，确保 Sortable 动画完成后再同步数据。

### 3.3 每个 .block-children 是一个 Sortable group

```
Root Container (Sortable group="blocks", data-parent-id="")
├── Block A
├── Block B
│   └── .block-children (data-parent-id="B")
│       ├── Block B1
│       └── Block B2
├── Block C
└── Block D
    └── .block-children (data-parent-id="D")
        └── Block D1
```

- 所有 group 用同一个 name：`"blocks"`
- Sortable.js 自动允许跨 group 拖拽
- 容器使用 `data-parent-id` 属性标识所属 parent（null 时为空字符串）

---

## 4. 数据模型影响

### 4.1 Block 字段不变

Sortable.js 只负责 UI 层排序，Block 数据模型不变：

```
Block.id          ← 组件 key，不变
Block.parentId    ← 由 moveBlock 更新
Block.left        ← 由 moveBlock 更新（见 §4.2）
Block.content     ← 不变
Block.children    ← 由 parentId 推导，不单独存储
```

### 4.2 left 值重排策略

采用**完全重排**策略，每次拖拽后对目标 parent 的所有子节点重新分配 left 值：

```
移动前 B 的 children: [A(left=100), X(left=200), C(left=300)]
移动 X 到 A 后面后:    [A(100), X(200), C(300)]  ← left 值不变，仅顺序变

移动后 B 的 children: [X(left=200)]  ← X 从 A 的 children 移入
A 的 children:        [B(left=100)]  ← A 的 children 减少
```

**优点**：
- 避免中点计算导致 gap 耗尽
- 逻辑简单，每次移动最多重排两个 parent 的子节点
- 完全重排后 left 始终为 `100, 200, 300, ...`

**实现**：
```typescript
function recalculateLeftValues(siblings: Block[], startStep = 100) {
  siblings.forEach((block, index) => {
    block.left = startStep * (index + 1)
  })
}
```

### 4.3 子节点跟随规则

当 Block X 从 parent A 移动到 parent B 时：
- X 的子节点**不需要**修改（它们的 parentId 仍是 X.id）
- X 的 `parentId` 改为 B.id
- X 的 `left` 重新计算（相对于 B 的新 siblings）

---

## 5. blocks.ts 改造

### 5.1 新增 moveBlock 方法

```typescript
/**
 * 移动 Block 到新位置
 *
 * @param opts.blockId       被移动的 Block ID
 * @param opts.fromParentId   原始 parentId（移动前）
 * @param opts.toParentId     目标 parentId（移动后）
 * @param opts.newIndex       在目标 parent 下的新位置（0-based）
 */
async function moveBlock(opts: {
  blockId: string
  fromParentId: string | null
  toParentId: string | null
  newIndex: number
}) {
  const { blockId, fromParentId, toParentId, newIndex } = opts
  const block = findBlockById(blockId, blocks.value)
  if (!block) return

  // 1. 循环检测：阻止将 block 移动到自己的子树中
  if (isDescendantOf(toParentId, blockId)) {
    console.warn('[moveBlock] 禁止：将 block 移动到自己的子树中')
    return
  }

  // 2. 同一 parent 内移动
  if (fromParentId === toParentId) {
    const siblings = blocks.value
      .filter(b => b.parentId === toParentId && b.pageId === block.pageId)
      .sort((a, b) => a.left - b.left)

    const fromIndex = siblings.findIndex(b => b.id === blockId)
    if (fromIndex === -1) return

    // 移动数组中的位置
    const [moved] = siblings.splice(fromIndex, 1)
    const targetIndex = Math.min(newIndex, siblings.length)
    siblings.splice(targetIndex, 0, moved)

    // 重排 left 值
    recalculateLeftValues(siblings)

  } else {
    // 3. 跨 parent 移动

    // 3a. 从 source parent 移除
    block.parentId = toParentId
    const sourceSiblings = blocks.value
      .filter(b => b.parentId === fromParentId && b.pageId === block.pageId && b.id !== blockId)
      .sort((a, b) => a.left - b.left)
    recalculateLeftValues(sourceSiblings)

    // 3b. 插入到 target parent
    const targetSiblings = blocks.value
      .filter(b => b.parentId === toParentId && b.pageId === block.pageId)
      .sort((a, b) => a.left - b.left)
    const targetIndex = Math.min(newIndex, targetSiblings.length)
    targetSiblings.splice(targetIndex, 0, block)
    recalculateLeftValues(targetSiblings)
  }

  // 4. 批量保存（防抖）
  const allUpdated = blocks.value
    .filter(b => b.parentId === fromParentId || b.parentId === toParentId)
    .filter((b, i, arr) => arr.findIndex(x => x.id === b.id) === i) // 去重

  for (const b of allUpdated) {
    b.updatedAt = new Date().toISOString()
    _scheduleSave(b)
  }
}
```

### 5.2 新增 recalculateLeftValues 工具函数

```typescript
import { LEFT_STEP } from '../utils/leftCalculator'

/**
 * 对 siblings 数组重排 left 值
 * @param siblings 按 left 排序的 Block 数组
 * @param step 间隔，默认 LEFT_STEP=100
 */
function recalculateLeftValues(siblings: Block[], step = LEFT_STEP) {
  siblings.forEach((block, index) => {
    block.left = step * (index + 1)
  })
}
```

### 5.3 删除的代码

从 blocks.ts 中删除：

- `draggingBlockId` 相关状态
- `dropTargetInfo` 相关状态
- `startDrag()` / `endDrag()` / `setDropTarget()` 方法
- `isDescendantOf(targetId, blockId)` 调用（改为 `isDescendantOf(toParentId, blockId)`）

---

## 6. useSortable.ts Composable

### 6.1 实现

```typescript
// src/composables/useSortable.ts
import { onMounted, onBeforeUnmount, nextTick } from 'vue'
import Sortable from 'sortablejs'
import { useBlockStore } from '../stores/blocks'

export function useSortable(containerEl: HTMLElement, parentId: string | null) {
  const blockStore = useBlockStore()
  let sortable: Sortable.Instance | null = null

  function init() {
    sortable = Sortable.create(containerEl, {
      group: 'blocks',              // 跨 parent 拖拽
      animation: 150,              // 拖拽动画
      ghostClass: 'block-ghost',    // 拖拽中 ghost 样式
      dragClass: 'block-drag',     // 正在拖拽的样式
      delay: 150,                  // 区分 click 和 drag
      delayOnTouchOnly: true,      // 仅触摸设备延迟
      handle: '.block-bullet',     // 只能从 bullet 拖拽
      forceFallback: false,        // 使用原生 HTML5 拖拽

      // onMove：拖拽中判断是否能放置到目标
      // 返回 false 阻止放置，但不阻止拖拽
      onMove(evt) {
        const targetId = (evt.to as HTMLElement).dataset.parentId || null

        // 阻止放置到自己子树中
        const draggedId = (evt.dragged as HTMLElement).dataset.blockId
        if (draggedId && blockStore.isDescendantOf(targetId, draggedId)) {
          return false
        }

        return true
      },

      // onEnd：拖拽结束，核心回调
      onEnd(evt) {
        const blockId = (evt.item as HTMLElement).dataset.blockId!
        if (!blockId) return

        const fromParentId = (evt.from as HTMLElement).dataset.parentId || null
        const toParentId = (evt.to as HTMLElement).dataset.parentId || null
        const newIndex = evt.newIndex ?? 0

        // 延迟到 nextTick：确保 Sortable 动画完成后再更新数据
        // 这样 Vue 的响应式更新不会打断拖拽动画
        nextTick(() => {
          blockStore.moveBlock({
            blockId,
            fromParentId,
            toParentId,
            newIndex
          })
        })
      }
    })
  }

  onMounted(() => {
    init()
  })

  onBeforeUnmount(() => {
    sortable?.destroy()
    sortable = null
  })

  return {
    sortable
  }
}
```

### 6.2 关键设计决策

**为什么用 `nextTick` 延迟数据更新？**

```
时刻 0: Sortable.js 移动 DOM 元素 A 到 B 的容器（动画开始）
时刻 0: onEnd 回调触发
时刻 0: nextTick() 注册回调（等待 Vue DOM 更新周期）
时刻 1: Sortable 动画完成
时刻 2: nextTick 回调执行 → blocks.ts 数据更新 → Vue 响应式更新
```

如果不用 `nextTick`，数据更新会在 Sortable 动画期间发生，可能导致 DOM 闪烁。

---

## 7. Block.vue 改造

### 7.1 删除的代码

完全移除手动拖拽实现：

```typescript
// 删除以下全部内容：
// - dragStartX, dragStartY, dragThresholdPassed
// - pendingDragBlockId, dragListenersAttached
// - handleBulletMouseDown()
// - handleGlobalMouseMove()
// - handleGlobalMouseUp()
// - handleDragKeydown()
// - cleanupDragListeners()
// - isDraggingNow, isDragging computed
// - dropPosition computed
// - startDrag(), endDrag() 的 store 调用
```

### 7.2 CSS 删除

删除以下样式（由 Sortable.js 的 ghostClass/dragClass 替代）：

```css
/* 删除：*/
.block.dragging { opacity: 0.5; background: ... }
.drop-indicator { ... }
.drop-indicator--before { ... }
.drop-indicator--after { ... }
```

### 7.3 新增代码

```typescript
import { onMounted, ref } from 'vue'
import { useSortable } from '../composables/useSortable'

const props = defineProps<{ blockId: string; block: Block }>()

// .block-children 容器 ref
const childrenContainerRef = ref<HTMLElement | null>(null)

// 子节点容器初始化 Sortable
onMounted(() => {
  if (childrenContainerRef.value) {
    useSortable(childrenContainerRef.value, props.blockId)
  }
})
```

```vue
<!-- 模板改动 -->
<template>
  <div class="block" :class="{ active: isActive }">
    <div class="block-row">
      <div class="block-indent" :style="{ width: indentWidth }"></div>
      <!-- bullet 作为拖拽手柄 -->
      <span class="block-bullet" :class="{ collapsed }" @click.stop="handleCollapseToggle">
        <span v-if="children.length > 0" class="bullet-chevron" :class="{ 'is-collapsed': collapsed }"></span>
        <span v-else class="bullet-dot"></span>
      </span>
      <div class="block-content" @mousedown="handleContentMouseDown">
        <Editor v-if="isActive" ... />
        <div v-else class="block-text" v-html="renderContent(block.content)"></div>
      </div>
    </div>

    <!-- 子节点容器：Sortable group -->
    <div
      v-if="children.length > 0 && !collapsed"
      ref="childrenContainerRef"
      class="block-children"
      :data-parent-id="props.blockId"
    >
      <Block
        v-for="child in children"
        :key="child.id"
        :block-id="child.id"
        :block="child"
      />
    </div>
  </div>
</template>
```

### 7.4 data-parent-id 的响应式

子容器的 `data-parent-id` 绑定到 `props.blockId`。当 block 跨 parent 移动时：
1. Sortable.js 先移动 DOM 元素
2. `nextTick` 后 `moveBlock` 更新 `block.parentId`
3. Vue 响应式更新，`data-parent-id` 自动更新为新的 parentId

---

## 8. Editor.vue 改造（根容器）

### 8.1 根容器 Sortable 初始化

```vue
<!-- Editor.vue -->
<template>
  <div class="editor-root" data-parent-id="">
    <Block
      v-for="root in rootBlocks"
      :key="root.id"
      :block-id="root.id"
      :block="root"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useBlockStore } from '../stores/blocks'
import { useSortable } from '../composables/useSortable'
import Block from './Block.vue'

const blockStore = useBlockStore()
const rootContainerRef = ref<HTMLElement | null>(null)

// 顶级 Block（parentId = null）
const rootBlocks = computed(() => blockStore.blockTree.get(null) ?? [])

onMounted(() => {
  if (rootContainerRef.value) {
    useSortable(rootContainerRef.value, null)
  }
})
</script>
```

---

## 9. CSS 改造

### 9.1 新增样式

```css
/* Sortable.js 拖拽样式（替代原有 .block.dragging） */

/* ghost：被拖拽元素的半透明投影 */
.block-ghost {
  opacity: 0.4;
  background: rgba(180, 83, 9, 0.08);
  border-radius: 4px;
}

/* drag：正在被拖拽的元素本身 */
.block-drag {
  opacity: 0.9;
  cursor: grabbing !important;
}

/* 拖拽时 bullet 手柄反馈 */
.block-drag .block-bullet {
  cursor: grabbing;
}
```

### 9.2 删除样式

删除原有手动拖拽样式（已无代码引用）：
- `.block.dragging`
- `.drop-indicator`
- `.drop-indicator--before`
- `.drop-indicator--after`

---

## 10. 循环检测

### 10.1 检测时机

- **onMove 钩子**：阻止 Sortable.js 展示"可放置"状态（返回 false）
- **moveBlock 方法内部**：双重保险，阻止实际数据变更

```typescript
// onMove 钩子中
onMove(evt) {
  const targetId = (evt.to as HTMLElement).dataset.parentId || null
  const draggedId = (evt.dragged as HTMLElement).dataset.blockId

  if (draggedId && blockStore.isDescendantOf(targetId, draggedId)) {
    return false  // Sortable.js 显示禁止图标，但不阻止拖拽
  }
  return true
}
```

```typescript
// moveBlock 方法内部
if (isDescendantOf(toParentId, blockId)) {
  console.warn('[moveBlock] 禁止循环嵌套移动')
  return
}
```

### 10.2 isDescendantOf 签名

```typescript
/**
 * 检查 targetId 是否是 blockId 的后代
 * @param targetId 要检查的节点（移动目标）
 * @param blockId 潜在祖先（被拖拽的 block）
 */
function isDescendantOf(targetId: string | null, blockId: string): boolean
```

注意：参数顺序是 `targetId`（要检查的）先，`blockId`（祖先）后。

---

## 11. 折叠态处理

当 Block 处于折叠态时：
- `.block-children` 容器 `v-if="children.length > 0 && !collapsed"`
- `display: none` → Sortable.js 无法将元素放置到折叠容器内
- 行为正确，不需要额外处理

---

## 12. 实施步骤

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 安装依赖：`npm install sortablejs @types/sortablejs` | 无 |
| 2 | 创建 `src/composables/useSortable.ts` | 步骤 1 |
| 3 | blocks.ts：新增 `moveBlock()` + `recalculateLeftValues()`，删除拖拽状态 | 无 |
| 4 | Block.vue：删除手动拖拽代码，接入 `useSortable` | 步骤 2, 3 |
| 5 | Editor.vue：根容器接入 `useSortable` | 步骤 2 |
| 6 | CSS：新增 ghost/drag 样式，删除旧拖拽样式 | 步骤 4, 5 |
| 7 | 手动测试：同 parent、跨 parent、循环检测、折叠态拖拽 | 步骤 1-6 |
| 8 | 单元测试：更新/新增 moveBlock 测试用例 | 步骤 3 |

---

## 13. 测试用例

### 13.1 手动测试清单

| 场景 | 操作 | 预期结果 |
|------|------|---------|
| 同 parent 移动 | 拖 A 到 C 后面 | A.left = C.left + 100 |
| 跨 parent 移动 | 拖 A 到 B 的 children 中 | A.parentId = B.id |
| 子节点跟随 | 拖父节点 X 到新位置 | X 的所有子节点跟随移动 |
| 循环检测 | 尝试将父节点拖入自己的子节点 | 阻止，block 不移动 |
| 折叠态拖拽 | 折叠父节点后拖动 | 折叠态不变，children 不被拖动 |
| 根节点拖拽 | 拖 root 节点 A 到 B 后面 | A.parentId=null，A.left 更新 |

### 13.2 单元测试覆盖

```typescript
// blocks.test.ts 新增
describe('moveBlock', () => {
  test('同 parent 移动：A 移到 C 后面', ...)
  test('跨 parent 移动：A 从 root 移到 B 的 children', ...)
  test('子节点跟随父节点移动', ...)
  test('循环检测：阻止父节点移入子节点', ...)
  test('循环检测：阻止节点移入孙节点', ...)
  test('移动后 left 值正确重排', ...)
  test('移动后无重复 left 值', ...)
})
```

---

## 14. 已知限制

1. **触摸设备**：`delay: 150` + `delayOnTouchOnly: true` 可能需要根据实际测试调整
2. **大量子节点**（500+）：Sortable.js 对大列表的性能尚可，Phase 1 足够
3. **SSR 兼容**：不适用，comind 是纯客户端应用

---

## 15. 相关文档

| 文档 | 说明 |
|------|------|
| `SPEC.md` | 项目总规范（核心约束） |
| `data-model.md` | 数据模型（Block.left 字段说明） |
| `block-editor-spec.md` | 编辑器架构规范（C1-C4） |
| `storage-spec.md` | 存储层规范 |
