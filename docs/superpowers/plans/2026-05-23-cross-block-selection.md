# 跨 Block 选择 实施方案

> **面向智能体执行者：必须使用子技能**：通过 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务执行本方案。步骤使用复选框（`- [ ]`）格式用于进度追踪。
>
> **目标**：实现跨 block 整块选择功能——拖拽选中、Ctrl+Click 切换、Ctrl+C 复制
> **架构**：新增 `useCrossBlockSelection` composable 管理选区状态，BlockList 绑定全局 DOM 事件，Block 组件注入状态并渲染遮罩
> **技术栈**：Vue 3 + TypeScript + Pinia
>
> **相关文件：**
> - `docs/superpowers/specs/2026-05-23-cross-block-selection-design.md` — 设计文档

---

## 文件结构

```
src/composables/
└── useCrossBlockSelection.ts  # 新建：选区状态管理、复制逻辑

src/components/
├── BlockList.vue              # 修改：初始化 composable，provide，绑定全局事件
└── Block/
    ├── index.vue              # 修改：inject composable，修改 mousedown，添加遮罩 class
    └── styles.css             # 修改：添加 .cb-selected 样式
```

---

### Task 1: 创建 useCrossBlockSelection composable

**涉及文件：**
- 新建：`comind/src/composables/useCrossBlockSelection.ts`

- [ ] **Step 1: 编写 composable 完整代码**

```typescript
import { reactive, ref, shallowRef } from 'vue'
import { useBlockStore } from '../stores/blocks'

export function useCrossBlockSelection() {
  const blockStore = useBlockStore()

  const dragStartBlockId = ref<string | null>(null)
  const isDragging = ref(false)
  const selectedIds = reactive(new Set<string>())
  const anchorIds = reactive(new Set<string>())

  function clearSelection() {
    anchorIds.clear()
    selectedIds.clear()
  }

  function clearTracking() {
    dragStartBlockId.value = null
    isDragging.value = false
    selectedIds.clear()
  }

  function startTracking(blockId: string) {
    if (anchorIds.size > 0) {
      clearSelection()
    }
    dragStartBlockId.value = blockId
  }

  function computeRange(targetBlockId: string, pageId: string): Set<string> {
    const startId = dragStartBlockId.value
    if (!startId) return new Set()

    const result = new Set<string>()
    const visited = new Set<string>()

    function addDescendants(id: string) {
      if (visited.has(id)) return
      const block = blockStore.blocks.find(b => b.id === id)
      if (!block || block.pageId !== pageId) return
      visited.add(id)
      result.add(id)
      for (const child of blockStore.getChildren(id)) {
        addDescendants(child.id)
      }
    }

    if (startId === targetBlockId) {
      addDescendants(startId)
      return result
    }

    let current = startId
    let foundForward = false

    while (current) {
      if (current === targetBlockId) {
        foundForward = true
        break
      }
      const next = blockStore.findNextBlockInTreeOrder(current)
      if (!next) break
      current = next.id
    }

    const [fromId, toId] = foundForward
      ? [startId, targetBlockId]
      : [targetBlockId, startId]

    current = fromId
    while (current) {
      addDescendants(current)
      if (current === toId) break
      const next = blockStore.findNextBlockInTreeOrder(current)
      if (!next) break
      current = next.id
    }

    return result
  }

  function finalizeSelection() {
    anchorIds.clear()
    for (const id of selectedIds) {
      anchorIds.add(id)
    }
    isDragging.value = false
    dragStartBlockId.value = null
    selectedIds.clear()
  }

  function toggleBlock(blockId: string, pageId: string) {
    const toToggle = new Set<string>()
    const visited = new Set<string>()

    function collect(id: string) {
      if (visited.has(id)) return
      const block = blockStore.blocks.find(b => b.id === id)
      if (!block || block.pageId !== pageId) return
      visited.add(id)
      toToggle.add(id)
      for (const child of blockStore.getChildren(id)) {
        collect(child.id)
      }
    }
    collect(blockId)

    const isSelected = anchorIds.has(blockId)

    if (isSelected) {
      for (const id of toToggle) {
        anchorIds.delete(id)
      }
    } else {
      for (const id of toToggle) {
        anchorIds.add(id)
      }
    }
  }

  function isBlockSelected(blockId: string): boolean {
    return anchorIds.size > 0
      ? anchorIds.has(blockId)
      : selectedIds.has(blockId)
  }

  async function copyToClipboard() {
    const parts: string[] = []
    const visited = new Set<string>()

    function collect(blockId: string) {
      if (visited.has(blockId)) return
      const block = blockStore.blocks.find(b => b.id === blockId)
      if (!block) return
      visited.add(blockId)

      if (!anchorIds.has(blockId)) return

      parts.push(block.content)

      if (block.format?.collapsed) return

      for (const child of blockStore.getChildren(blockId)) {
        collect(child.id)
      }
    }

    for (const block of blockStore.sortedBlocks) {
      collect(block.id)
    }

    const text = parts.join('\n')
    await navigator.clipboard.writeText(text)
  }

  return {
    dragStartBlockId,
    isDragging,
    selectedIds,
    anchorIds,
    clearSelection,
    clearTracking,
    startTracking,
    computeRange,
    finalizeSelection,
    toggleBlock,
    isBlockSelected,
    copyToClipboard
  }
}

export type CrossBlockSelection = ReturnType<typeof useCrossBlockSelection>
```

- [ ] **Step 2: 提交代码**

```bash
git add comind/src/composables/useCrossBlockSelection.ts
git commit -m "feat: add useCrossBlockSelection composable"
```

---

### Task 2: 添加选中遮罩样式

**涉及文件：**
- 修改：`comind/src/components/Block/styles.css` — 追加样式

- [ ] **Step 1: 在 styles.css 末尾追加 cb-selected 样式**

```css
/* ── 跨 Block 选中遮罩 ── */
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

- [ ] **Step 2: 提交代码**

```bash
git add comind/src/components/Block/styles.css
git commit -m "feat: add cb-selected overlay style"
```

---

### Task 3: 在 BlockList.vue 中集成 composable 和全局事件

**涉及文件：**
- 修改：`comind/src/components/BlockList.vue`

- [ ] **Step 1: 导入 composable，初始化并 provide**

在现有 import 区域追加导入，在 `onMounted(syncFromStore)` 之前新增代码。

找到这一段：
```typescript
import { ref, watch, onMounted, provide } from 'vue'
```

替换为：
```typescript
import { ref, watch, onMounted, onBeforeUnmount, provide } from 'vue'
```

在现有 import 区域末尾追加：
```typescript
import { useCrossBlockSelection } from '../composables/useCrossBlockSelection'
import type { CrossBlockSelection } from '../composables/useCrossBlockSelection'
```

在 `provide('onDragEnd', handleDragEnd)` 之前插入 composable 初始化和 provide：
```typescript
const selection = useCrossBlockSelection()
provide<CrossBlockSelection>('crossBlockSelection', selection)
```

- [ ] **Step 2: 添加文档级事件处理函数**

在 `syncFromStore` 函数之后、`handleDragEnd` 之前插入：

```typescript
function handleDocMouseMove(e: MouseEvent) {
  if (!selection.dragStartBlockId.value) return

  const el = document.elementFromPoint(e.clientX, e.clientY)
  const blockEl = el?.closest('[data-block-id]') as HTMLElement | null
  if (!blockEl) return

  const targetId = blockEl.dataset.blockId
  if (!targetId) return

  if (!selection.isDragging.value) {
    if (targetId === selection.dragStartBlockId.value) return
    editorStore.deactivateBlock()
    selection.isDragging.value = true
  }

  const range = selection.computeRange(targetId, props.pageId)
  selection.selectedIds.clear()
  for (const id of range) {
    selection.selectedIds.add(id)
  }
}

function handleDocMouseUp() {
  if (!selection.dragStartBlockId.value) return

  if (selection.isDragging.value) {
    selection.finalizeSelection()
  } else {
    const blockId = selection.dragStartBlockId.value
    selection.clearTracking()
    editorStore.activateBlock(blockId)
  }
}

function handleDocKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    selection.clearSelection()
    return
  }
  if ((e.key === 'c' || e.key === 'C') && (e.ctrlKey || e.metaKey)) {
    if (selection.anchorIds.size > 0) {
      e.preventDefault()
      selection.copyToClipboard()
    }
  }
}
```

- [ ] **Step 3: 在 onMounted / onBeforeUnmount 中注册/移除文档事件**

在现有的 `onMounted(syncFromStore)` 之后追加：

```typescript
onMounted(() => {
  document.addEventListener('mousemove', handleDocMouseMove)
  document.addEventListener('mouseup', handleDocMouseUp)
  document.addEventListener('keydown', handleDocKeyDown)
})
```

在 `onMounted(syncFromStore)` 之后、`</script>` 之前新增：

```typescript
onBeforeUnmount(() => {
  document.removeEventListener('mousemove', handleDocMouseMove)
  document.removeEventListener('mouseup', handleDocMouseUp)
  document.removeEventListener('keydown', handleDocKeyDown)
})
```

- [ ] **Step 4: 页面切换时清除选区**

在现有的 `watch(() => props.pageId, syncFromStore)` 处，追加清除选区逻辑。找到：
```typescript
watch(() => props.pageId, syncFromStore)
```

替换为：
```typescript
watch(() => props.pageId, (newId, oldId) => {
  if (newId !== oldId) {
    selection.clearSelection()
  }
  syncFromStore()
})
```

- [ ] **Step 5: 提交代码**

```bash
git add comind/src/components/BlockList.vue
git commit -m "feat: integrate cross-block selection into BlockList"
```

---

### Task 4: 在 Block/index.vue 中集成选区和遮罩

**涉及文件：**
- 修改：`comind/src/components/Block/index.vue`

- [ ] **Step 1: 注入 composable**

在现有 inject 区域追加。找到：
```typescript
const onDragEnd = inject<() => void>('onDragEnd')
```

在其后追加：
```typescript
const selection = inject<CrossBlockSelection>('crossBlockSelection')
```

在现有 import 中追加类型导入。找到：
```typescript
import type { TreeNode, Block } from '../../types/block'
```

替换为：
```typescript
import type { TreeNode, Block } from '../../types/block'
import type { CrossBlockSelection } from '../../composables/useCrossBlockSelection'
```

- [ ] **Step 2: 修改 mousedown 处理，区分短按/Ctrl+Click/长拖**

在 `startEditingAtClick` 函数定义之前插入新的 mousedown 处理器：

```typescript
function handleContentMousedown(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.block-link')) return

  if (e.ctrlKey || e.metaKey) {
    if (selection) {
      selection.toggleBlock(blockId.value, pageStore.currentPageId)
      e.preventDefault()
    }
    return
  }

  const cursorPosVal = getCaretPositionFromPoint(e.clientX, e.clientY) ?? 0
  editorStore.setCursorPos(cursorPosVal + 1)

  if (selection) {
    selection.startTracking(blockId.value)
  }
}
```

- [ ] **Step 3: 模板中替换 mousedown 绑定**

找到模板中的：
```html
<div class="block-content" @mousedown="startEditingAtClick">
```

替换为：
```html
<div class="block-content" @mousedown="handleContentMousedown">
```

- [ ] **Step 4: 添加 isSelected computed 和 cb-selected class**

在现有的 computed 区域追加。找到 `const isActive = computed(...)`，在其后追加：

```typescript
const isSelected = computed(() => {
  if (!selection) return false
  return selection.isBlockSelected(blockId.value)
})
```

- [ ] **Step 5: 模板中绑定 cb-selected class**

找到根 div：
```html
<div class="block" :class="[priorityClass, { active: isActive }]" :data-block-id="blockId">
```

替换为：
```html
<div class="block" :class="[priorityClass, { active: isActive, 'cb-selected': isSelected }]" :data-block-id="blockId">
```

- [ ] **Step 6: 激活编辑器时清除选区**

在现有的 `watch(isActive, ...)` 的 `active` 分支中，追加清除选区。找到：
```typescript
if (active) {
```

在其后插入：
```typescript
      selection?.clearSelection()
```

- [ ] **Step 7: 提交代码**

```bash
git add comind/src/components/Block/index.vue
git commit -m "feat: integrate cross-block selection into Block component"
```

---

### Task 5: 编译验证

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
cd comind && npx vue-tsc -b --noEmit
```

预期结果：无类型错误。

- [ ] **Step 2: 运行 Vite build**

```bash
cd comind && npx vite build
```

预期结果：构建成功，无错误。

---

## 自查记录

| 检查项 | 状态 |
|--------|------|
| 规范覆盖性 — 拖拽选中 ✓ | Task 1/3/4 |
| 规范覆盖性 — Ctrl+Click 切换 ✓ | Task 4 Step 2 |
| 规范覆盖性 — Ctrl+C 复制 ✓ | Task 1 (copyToClipboard) / Task 3 (keydown) |
| 规范覆盖性 — 遮罩高亮 ✓ | Task 2 / Task 4 Step 5 |
| 规范覆盖性 — 嵌套子 block 连带 ✓ | Task 1 (computeRange/toggleBlock) |
| 规范覆盖性 — 折叠子 block 复制排除 ✓ | Task 1 (copyToClipboard) |
| 规范覆盖性 — Escape 清除 ✓ | Task 3 Step 2 |
| 规范覆盖性 — 编辑器激活时退出 ✓ | Task 3 Step 2 (deactivateBlock) |
| 无占位内容 ✓ | — |
| 类型一致性 ✓ | CrossBlockSelection 导出类型，inject/provide 一致 |