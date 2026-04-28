# Sortable.js 拖拽实现方案

> 版本：v0.2
> 日期：2026-04-29
> 状态：已实现

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
│  blocks.ts：moveBlock() 更新 parentId + pos + 持久化         │
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

### 4.1 Block 字段

Sortable.js 只负责 UI 层排序，Block 数据模型使用以下关键字段：

```
Block.id          ← 组件 key，不变
Block.parentId    ← 由 moveBlock 更新
Block.pos         ← 由 moveBlock 更新（见 §4.2）
Block.content     ← 不变
Block.children    ← 由 parentId 推导，不单独存储
```

### 4.2 pos 值计算策略

采用**动态插入位置计算**策略，使用 `safeCalcInsertPos()` 函数：

- 基于前一个和后一个兄弟节点的 pos 值计算中间位置
- 当间隔耗尽（gap exhausted）时自动触发重新编号
- 重新编号后通过回调重新计算位置参数

**核心函数：**

```typescript
async function safeCalcInsertPos(
  prevPos: number | null,
  nextPos: number | null,
  blocksRef: Block[],
  storageRef: typeof storage,
  recalcPos?: () => { prevPos: number | null; nextPos: number | null }
): Promise<number>
```

**优点：**
- 自动处理间隔耗尽问题
- 重新编号后位置参数自动更新
- 避免显式重排所有兄弟节点

### 4.3 子节点跟随规则

当 Block X 从 parent A 移动到 parent B 时：
- X 的子节点**不需要**修改（它们的 parentId 仍是 X.id）
- X 的 `parentId` 改为 B.id
- X 的 `pos` 根据目标位置重新计算

---

## 5. blocks.ts 改造

### 5.1 moveBlock 方法

```typescript
/**
 * 移动 Block 到新位置
 *
 * @param opts.blockId       被移动的 Block ID
 * @param opts.toParentId    目标 parentId（移动后）
 * @param opts.newIndex      在目标 parent 下的新位置（0-based）
 */
async function moveBlock(opts: {
  blockId: string
  toParentId: string | null
  newIndex: number
}) {
  const { blockId, toParentId, newIndex } = opts
  const block = blocks.value.find(b => b.id === blockId)
  if (!block) return

  // 循环检测：阻止将 block 移动到自己的子树中
  if (isDescendantOf(toParentId, blockId)) {
    console.warn('[moveBlock] 禁止循环移动')
    return
  }

  // 计算目标位置
  const calcPositions = () => {
    const targetSiblings = getSortedChildren(blocks.value, toParentId, block.pageId, blockId)
    const clampedIndex = Math.max(0, Math.min(newIndex, targetSiblings.length))
    return {
      prevPos: clampedIndex > 0 ? targetSiblings[clampedIndex - 1].pos : null,
      nextPos: clampedIndex < targetSiblings.length ? targetSiblings[clampedIndex].pos : null
    }
  }

  const { prevPos, nextPos } = calcPositions()
  block.parentId = toParentId
  block.pos = await safeCalcInsertPos(prevPos, nextPos, blocks.value, storage, calcPositions)
  block.updatedAt = Date.now()

  _scheduleSave(block)
}
```

### 5.2 safeCalcInsertPos 安全插入位置计算

```typescript
/**
 * 安全计算插入位置，带自动重试机制
 *
 * 当间隔耗尽时自动触发重新编号，然后通过回调重新计算位置参数。
 * 这解决了重编号后 prevPos/nextPos 过时的问题。
 */
async function safeCalcInsertPos(
  prevPos: number | null,
  nextPos: number | null,
  blocksRef: Block[],
  storageRef: typeof storage,
  recalcPos?: () => { prevPos: number | null; nextPos: number | null }
): Promise<number>
```

### 5.3 isDescendantOf 循环检测

```typescript
/**
 * 检查 targetId 是否是 blockId 的后代
 * @param targetId 要检查的节点（移动目标）
 * @param blockId 潜在祖先（被拖拽的 block）
 */
function isDescendantOf(targetId: string | null, blockId: string): boolean
```

---

## 6. useSortable.ts Composable

### 6.1 实现

```typescript
// src/composables/useSortable.ts
import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue'
import Sortable from 'sortablejs'
import { useBlockStore } from '../stores/blocks'
import { useEditorStore } from '../stores/editor'

/**
 * 使用响应式 ref 初始化 Sortable 实例
 *
 * 此函数必须在 setup 阶段调用，确保生命周期钩子正确注册。
 * Sortable 实例会在容器元素挂载后自动创建，在组件卸载时自动销毁。
 *
 * @param containerRef - 指向 .block-children 容器的 ref
 * @returns Sortable 实例的 ref（可用于手动控制）
 */
export function useSortable(containerRef: Ref<HTMLElement | null>) {
  const blockStore = useBlockStore()
  const editorStore = useEditorStore()
  const sortableRef = ref<Sortable | null>(null)

  onMounted(() => {
    if (containerRef.value) {
      sortableRef.value = Sortable.create(containerRef.value, {
        group: 'blocks',              // 跨 parent 拖拽
        animation: 150,              // 拖拽动画
        ghostClass: 'block-ghost',    // 拖拽中 ghost 样式
        dragClass: 'block-drag',     // 正在拖拽的样式
        chosenClass: 'block-chosen',  // 占位符样式
        handle: '.block-bullet',     // 只能从 bullet 拖拽
        emptyInsertThreshold: 0,      // 禁用空容器占位符
        swap: false,                  // 禁用 swap 模式

        // onStart：拖拽开始时失活编辑器
        onStart() {
          editorStore.deactivateBlock()
        },

        // onMove：拖拽中判断是否能放置
        onMove(evt) {
          const draggedId = (evt.dragged as HTMLElement).dataset.blockId
          const related = evt.related as HTMLElement

          // 阻止放置到自身
          if (draggedId && related) {
            const targetBlock = related.closest('.block') as HTMLElement | null
            if (targetBlock?.dataset.blockId === draggedId) {
              return false
            }
          }

          // 阻止放置到自己子树中
          const rawTargetId = (evt.to as HTMLElement).dataset.parentId ?? null
          const targetId = rawTargetId === '' ? null : rawTargetId

          if (draggedId && blockStore.isDescendantOf(targetId, draggedId)) {
            return false
          }

          return true
        },

        // onEnd：拖拽结束，核心回调
        onEnd: async (evt) => {
          const blockId = (evt.item as HTMLElement).dataset.blockId
          if (!blockId) return

          const fromEl = evt.from as HTMLElement
          const oldIndex = evt.oldIndex

          const rawToParentId = (evt.to as HTMLElement).dataset.parentId ?? null
          const toParentId = rawToParentId === '' ? null : rawToParentId
          const newIndex = evt.newIndex ?? 0

          try {
            await blockStore.moveBlock({ blockId, toParentId, newIndex })
          } catch (error) {
            console.error('[useSortable] moveBlock failed, rolling back DOM:', error)
            // 失败时回滚 DOM
            if (fromEl && oldIndex != null) {
              const refChild = fromEl.children[oldIndex] ?? null
              fromEl.insertBefore(evt.item, refChild)
            }
          }
        }
      })
    }
  })

  onBeforeUnmount(() => {
    if (sortableRef.value) {
      sortableRef.value.destroy()
      sortableRef.value = null
    }
  })

  return sortableRef
}
```

### 6.2 关键设计决策

**为什么用 async/await + try-catch？**

```
时刻 0: Sortable.js 移动 DOM 元素 A 到 B 的容器（动画开始）
时刻 0: onEnd 回调触发
时刻 1: Sortable 动画完成
时刻 2: await moveBlock() 执行 → blocks.ts 数据更新 → Vue 响应式更新
时刻 3: 若失败 → DOM 回滚到原始位置
```

- **async/await**：确保异步操作完成后再进行后续处理
- **try-catch**：数据层失败时回滚 DOM，保持 DOM 与数据一致性

**为什么不需要 fromParentId？**

moveBlock 内部通过 `block.parentId` 获取原始 parent，无需调用方传入，简化 API。

---

## 7. Block.vue 改造

### 7.1 使用方式

```typescript
import { ref } from 'vue'
import { useSortable } from '../composables/useSortable'

const childrenRef = ref<HTMLElement | null>(null)

// 直接传入 ref，无需在 onMounted 中调用
useSortable(childrenRef)
```

```vue
<!-- 模板改动 -->
<template>
  <div class="block" :class="{ active: isActive }" :data-block-id="blockId">
    <div class="block-row">
      <div class="block-indent" :style="{ width: indentWidth }"></div>
      <!-- bullet 作为拖拽手柄 -->
      <span class="block-bullet" :class="{ collapsed }" @click.stop="toggleCollapse">
        <span v-if="children.length > 0" class="bullet-chevron" :class="{ 'is-collapsed': collapsed }"></span>
        <span v-else class="bullet-dot"></span>
      </span>
      <div class="block-content" @mousedown="startEditingAtClick">
        <Editor v-if="isActive" ... />
        <div v-else class="block-text" v-html="renderContent(block.content)"></div>
      </div>
    </div>

    <!-- 子节点容器：Sortable group -->
    <div
      v-if="children.length > 0"
      ref="childrenRef"
      class="block-children"
      :data-parent-id="blockId"
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

### 7.2 关键注意事项

- `useSortable` 必须在 setup 阶段直接调用（不是在 onMounted 内部）
- 传入的是 `ref` 对象，而非 DOM 元素本身
- Sortable 实例会在容器挂载后自动创建

---

## 8. Editor.vue 改造（根容器）

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
import { computed, ref, onMounted } from 'vue'
import { useBlockStore } from '../stores/blocks'
import { useSortable } from '../composables/useSortable'
import Block from './Block.vue'

const blockStore = useBlockStore()
const rootContainerRef = ref<HTMLElement | null>(null)

const rootBlocks = computed(() => blockStore.blockTree.get(null) ?? [])

onMounted(() => {
  // 根容器需要在 onMounted 中初始化
  // 因为根容器不是 Block 组件，没有自动调用 useSortable
  if (rootContainerRef.value) {
    useSortable(rootContainerRef)
  }
})
</script>
```

---

## 9. CSS 改造

### 9.1 新增样式

```css
/* Sortable.js 拖拽样式 */

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

/* chosen：拖拽时的占位符 */
.block-chosen {
  background: rgba(180, 83, 9, 0.05);
}

/* 拖拽时 bullet 手柄反馈 */
.block-drag .block-bullet {
  cursor: grabbing;
}
```

---

## 10. 循环检测

### 10.1 检测时机

- **onMove 钩子**：阻止 Sortable.js 展示"可放置"状态（返回 false）
- **moveBlock 方法内部**：双重保险，阻止实际数据变更

```typescript
// onMove 钩子中
onMove(evt) {
  const targetId = (evt.to as HTMLElement).dataset.parentId ?? null
  const draggedId = (evt.dragged as HTMLElement).dataset.blockId

  if (draggedId && blockStore.isDescendantOf(targetId, draggedId)) {
    return false
  }
  return true
}

// moveBlock 方法内部
if (isDescendantOf(toParentId, blockId)) {
  console.warn('[moveBlock] 禁止循环嵌套移动')
  return
}
```

### 10.2 防止放置到自身

额外检测防止将 block 放置到自身或自身内容区域：

```typescript
const targetBlock = related.closest('.block') as HTMLElement | null
if (targetBlock?.dataset.blockId === draggedId) {
  return false
}
```

---

## 11. 折叠态处理

当 Block 处于折叠态时：
- `.block-children` 容器仍存在（`v-if="children.length > 0"`）
- 通过 CSS `max-height: 0` + `overflow: hidden` 隐藏内容
- Sortable.js 无法将元素放置到折叠容器内（容器高度为 0）

---

## 12. 错误处理机制

### 12.1 DOM 回滚

当 `moveBlock` 失败时，自动将 DOM 元素回滚到原始位置：

```typescript
try {
  await blockStore.moveBlock({ blockId, toParentId, newIndex })
} catch (error) {
  console.error('[useSortable] moveBlock failed, rolling back DOM:', error)
  if (fromEl && oldIndex != null) {
    const refChild = fromEl.children[oldIndex] ?? null
    fromEl.insertBefore(evt.item, refChild)
  }
}
```

### 12.2 间隔耗尽自动恢复

当 pos 值间隔耗尽时，自动触发重新编号：

```typescript
if (isGapExhaustedError(error)) {
  renumberBlocks(blocksRef)
  // 持久化 + 重新计算位置
}
```

---

## 13. 实施步骤

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 安装依赖：`npm install sortablejs @types/sortablejs` | 无 |
| 2 | 创建 `src/composables/useSortable.ts` | 步骤 1 |
| 3 | blocks.ts：新增 `moveBlock()` + `safeCalcInsertPos()` | 无 |
| 4 | Block.vue：接入 `useSortable(childrenRef)` | 步骤 2, 3 |
| 5 | Editor.vue：根容器接入 `useSortable` | 步骤 2 |
| 6 | CSS：新增 ghost/drag/chosen 样式 | 步骤 4, 5 |
| 7 | 手动测试：同 parent、跨 parent、循环检测、折叠态拖拽 | 步骤 1-6 |
| 8 | 单元测试：更新/新增 moveBlock 测试用例 | 步骤 3 |

---

## 14. 测试用例

### 14.1 手动测试清单

| 场景 | 操作 | 预期结果 |
|------|------|---------|
| 同 parent 移动 | 拖 A 到 C 后面 | A.pos 正确更新 |
| 跨 parent 移动 | 拖 A 到 B 的 children 中 | A.parentId = B.id |
| 子节点跟随 | 拖父节点 X 到新位置 | X 的所有子节点跟随移动 |
| 循环检测 | 尝试将父节点拖入自己的子节点 | 阻止，block 不移动 |
| 阻止放置自身 | 尝试将 block 拖到自身位置 | 阻止放置 |
| 错误回滚 | 模拟 moveBlock 失败 | DOM 回滚到原始位置 |
| 间隔耗尽 | 多次插入触发间隔耗尽 | 自动重新编号并恢复 |

### 14.2 单元测试覆盖

```typescript
// blocks.test.ts 新增
describe('moveBlock', () => {
  test('同 parent 移动', ...)
  test('跨 parent 移动', ...)
  test('子节点跟随父节点移动', ...)
  test('循环检测：阻止父节点移入子节点', ...)
  test('循环检测：阻止节点移入孙节点', ...)
  test('移动后 pos 值正确', ...)
})

describe('safeCalcInsertPos', () => {
  test('正常插入位置计算', ...)
  test('间隔耗尽时自动重新编号', ...)
  test('重编号后位置正确', ...)
})
```

---

## 15. 已知限制

1. **触摸设备**：`handle: '.block-bullet'` 可能需要根据实际测试调整
2. **大量子节点**（500+）：Sortable.js 对大列表的性能尚可，Phase 1 足够
3. **SSR 兼容**：不适用，comind 是纯客户端应用

---

## 16. 相关文档

| 文档 | 说明 |
|------|------|
| `SPEC.md` | 项目总规范（核心约束） |
| `data-model.md` | 数据模型（Block.pos 字段说明） |
| `block-editor-spec.md` | 编辑器架构规范（C1-C4） |
| `storage-spec.md` | 存储层规范 |
