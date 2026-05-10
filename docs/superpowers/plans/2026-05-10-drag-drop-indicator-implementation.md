# 拖拽放置指示线实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Goal:** 实现拖拽放置指示线功能，支持排序/嵌套/升级三种放置类型
> **Architecture:** 在 Block 组件内联实现放置检测逻辑，使用全局单一 DOM 元素渲染指示线
> **Tech Stack:** Vue 3 + vue-draggable-plus + TypeScript
>
> **相关文件:**
> - `src/components/Block/index.vue` - 主组件
> - `src/components/Block/styles.css` - 样式
> - `docs/superpowers/specs/2026-05-10-drag-drop-indicator-design.md` - 设计文档

---

## 文件结构

```
src/components/Block/
├── index.vue      # 修改：添加放置检测、指示线渲染、拖拽处理
└── styles.css    # 修改：添加指示线样式、优化 ghost 样式
```

---

## 实施步骤

### Task 1: 添加放置检测常量和接口

**Files:**
- Modify: `src/components/Block/index.vue:60-75`

- [ ] **Step 1: 添加拖拽阈值常量**
```typescript
// ── 拖拽阈值配置 ──
const DRAG_THRESHOLD = {
  LEFT: 20,
  RIGHT: 20
}
```

- [ ] **Step 2: 添加放置目标类型和接口**
```typescript
type DropAction = 'sort' | 'nest' | 'promote' | null

interface DropTarget {
  action: DropAction
  toParentId: string | null
  beforeId: string | null
}
```

- [ ] **Step 3: 添加拖拽状态 ref**
```typescript
const dragState = ref<{
  currentDropTarget: DropTarget | null
  indicator: HTMLElement | null
}>({
  currentDropTarget: null,
  indicator: null
})
```

- [ ] **Step 4: Commit**
```bash
git add src/components/Block/index.vue
git commit -m "feat(drag): add drop target types and drag state"
```

---

### Task 2: 实现放置区域计算函数

**Files:**
- Modify: `src/components/Block/index.vue:310-395` (在 toggleCollapse 之后)

- [ ] **Step 1: 添加 computeDropZone 函数**
```typescript
function computeDropZone(cursorX: number, bulletRect: DOMRect): 'left' | 'center' | 'right' {
  if (cursorX <= bulletRect.left + DRAG_THRESHOLD.LEFT) return 'left'
  if (cursorX >= bulletRect.right - DRAG_THRESHOLD.RIGHT) return 'right'
  return 'center'
}
```

- [ ] **Step 2: 添加 computeSortPosition 函数**
```typescript
function computeSortPosition(cursorY: number, bulletRect: DOMRect): 'before' | 'after' {
  const bulletCenterY = bulletRect.top + bulletRect.height / 2
  return cursorY < bulletCenterY ? 'before' : 'after'
}
```

- [ ] **Step 3: 添加 findDropTarget 函数**
```typescript
function findDropTarget(
  cursorX: number,
  cursorY: number,
  targetBlockEl: HTMLElement
): DropTarget | null {
  const bullet = targetBlockEl.querySelector('.block-bullet') as HTMLElement
  if (!bullet) return null

  const bulletRect = bullet.getBoundingClientRect()
  const zone = computeDropZone(cursorX, bulletRect)

  if (zone === 'left') {
    // 升级放置
    const parentBlock = targetBlockEl.parentElement?.closest('.block') as HTMLElement | null
    if (parentBlock) {
      return {
        action: 'promote',
        toParentId: parentBlock.dataset.blockId ?? null,
        beforeId: targetBlockEl.dataset.blockId ?? null
      }
    }
    return {
      action: 'sort',
      toParentId: null,
      beforeId: targetBlockEl.dataset.blockId ?? null
    }
  }

  if (zone === 'right') {
    // 嵌套放置
    return {
      action: 'nest',
      toParentId: targetBlockEl.dataset.blockId ?? null,
      beforeId: null
    }
  }

  // 排序放置
  const position = computeSortPosition(cursorY, bulletRect)
  const parentBlock = targetBlockEl.parentElement?.closest('.block') as HTMLElement | null
  const parentId = parentBlock?.dataset.blockId ?? null

  if (position === 'before') {
    return {
      action: 'sort',
      toParentId: parentId,
      beforeId: targetBlockEl.dataset.blockId ?? null
    }
  } else {
    // after: 找到下一个兄弟节点
    const nextSibling = targetBlockEl.nextElementSibling as HTMLElement | null
    return {
      action: 'sort',
      toParentId: parentId,
      beforeId: nextSibling?.dataset.blockId ?? null
    }
  }
}
```

- [ ] **Step 4: Commit**
```bash
git add src/components/Block/index.vue
git commit -m "feat(drag): add drop zone calculation functions"
```

---

### Task 3: 实现放置指示线渲染

**Files:**
- Modify: `src/components/Block/index.vue:395-445`

- [ ] **Step 1: 添加 getOrCreateIndicator 函数**
```typescript
function getOrCreateIndicator(): HTMLElement {
  let indicator = document.querySelector('.drop-indicator') as HTMLElement | null
  if (!indicator) {
    indicator = document.createElement('div')
    indicator.className = 'drop-indicator'
    document.body.appendChild(indicator)
    dragState.value.indicator = indicator
  }
  return indicator
}
```

- [ ] **Step 2: 添加 renderDropIndicator 函数**
```typescript
function renderDropIndicator(targetBlockEl: HTMLElement, dropTarget: DropTarget) {
  const indicator = getOrCreateIndicator()
  const bullet = targetBlockEl.querySelector('.block-bullet')
  if (!bullet) return

  const rect = bullet.getBoundingClientRect()
  const scrollY = window.scrollY

  indicator.style.left = `${rect.left}px`
  indicator.style.width = `${rect.right - rect.left}px`
  indicator.style.top = `${rect.top + scrollY}px`
  indicator.style.height = '2px'

  indicator.className = 'drop-indicator'
  if (dropTarget.action === 'sort') {
    const position = dropTarget.beforeId ? 'before' : 'after'
    if (position === 'after') {
      indicator.style.top = `${rect.bottom + scrollY}px`
    }
    indicator.classList.add('sort')
  } else if (dropTarget.action === 'nest') {
    const targetDepth = parseInt(targetBlockEl.dataset.depth ?? '0', 10)
    const indentWidth = 24 * (targetDepth + 1)
    indicator.style.left = `${rect.left + indentWidth}px`
    indicator.style.width = `${rect.right - rect.left - indentWidth}px`
    indicator.classList.add('nest')
  } else if (dropTarget.action === 'promote') {
    indicator.classList.add('promote')
  }

  indicator.classList.add('visible')
}
```

- [ ] **Step 3: 添加 clearDropIndicator 函数**
```typescript
function clearDropIndicator() {
  const indicator = document.querySelector('.drop-indicator') as HTMLElement | null
  if (indicator) {
    indicator.classList.remove('visible')
  }
  dragState.value.indicator = null
}
```

- [ ] **Step 4: Commit**
```bash
git add src/components/Block/index.vue
git commit -m "feat(drag): add drop indicator rendering functions"
```

---

### Task 4: 更新拖拽处理函数

**Files:**
- Modify: `src/components/Block/index.vue:318-345`

- [ ] **Step 1: 重写 handleDragMove 函数**
```typescript
function handleDragMove(evt: any): boolean | void {
  const draggedId = (evt.dragged as HTMLElement)?.dataset.blockId
  const related = evt.related as HTMLElement

  if (draggedId && related) {
    const targetBlock = related.closest('.block') as HTMLElement | null
    if (targetBlock?.dataset.blockId === draggedId) {
      clearDropIndicator()
      return false
    }
  }

  const toEl = evt.to as HTMLElement
  if (!toEl) {
    clearDropIndicator()
    return true
  }

  const rawTargetId = toEl.dataset.parentId ?? null
  const targetId = rawTargetId === '' ? null : rawTargetId

  if (draggedId && targetId && blockStore.isDescendantOf(targetId, draggedId)) {
    clearDropIndicator()
    return false
  }

  const cursorX = evt.originalEvent.clientX
  const cursorY = evt.originalEvent.clientY
  const targetBlock = related?.closest('.block') as HTMLElement | null

  if (targetBlock) {
    const dropTarget = findDropTarget(cursorX, cursorY, targetBlock)
    if (dropTarget) {
      dragState.value.currentDropTarget = dropTarget
      renderDropIndicator(targetBlock, dropTarget)
    } else {
      clearDropIndicator()
    }
  }

  return true
}
```

- [ ] **Step 2: 重写 handleBlockDragEnd 函数**
```typescript
async function handleBlockDragEnd() {
  const dropTarget = dragState.value.currentDropTarget

  if (dropTarget && dropTarget.action) {
    const draggedEl = document.querySelector('.block-chosen') as HTMLElement
    const draggedId = draggedEl?.dataset.blockId

    if (draggedId) {
      let siblings: Block[]
      if (dropTarget.toParentId === null) {
        siblings = blockStore.getBlocksByPage(pageStore.currentPageId).filter(b => b.parentId === null)
      } else {
        siblings = blockStore.getChildren(dropTarget.toParentId)
      }

      let newIndex: number
      if (dropTarget.action === 'sort') {
        if (dropTarget.beforeId === null) {
          newIndex = siblings.length
        } else {
          const insertIdx = siblings.findIndex(b => b.id === dropTarget.beforeId)
          newIndex = insertIdx >= 0 ? insertIdx : siblings.length
        }
      } else {
        newIndex = siblings.length
      }

      await blockStore.moveBlock({
        blockId: draggedId,
        toParentId: dropTarget.toParentId,
        newIndex
      })
    }
  }

  clearDropIndicator()
  dragState.value.currentDropTarget = null
  onDragEnd?.()
}
```

- [ ] **Step 3: 添加 Block 类型导入**
在文件顶部确保导入了 Block 类型：
```typescript
import type { TreeNode, Block } from '../../types/block'
```

- [ ] **Step 4: Commit**
```bash
git add src/components/Block/index.vue
git commit -m "feat(drag): update drag move and end handlers"
```

---

### Task 5: 添加 CSS 样式

**Files:**
- Modify: `src/components/Block/styles.css` (在文件末尾添加)

- [ ] **Step 1: 添加放置指示线样式**
```css
/* ── 放置指示线 ── */
.drop-indicator {
  position: fixed;
  height: 2px;
  background: var(--color-accent);
  pointer-events: none;
  z-index: 1000;
  opacity: 0;
  transition: opacity 0ms;
}

.drop-indicator.visible {
  opacity: 1;
}

.drop-indicator.nest {
  border-left: 2px solid var(--color-accent);
  background: transparent;
  height: 0;
}
```

- [ ] **Step 2: 更新 ghost 样式为简洁占位符**
将现有 `.block-ghost` 样式替换为：
```css
.block-ghost {
  opacity: 0.3;
  background: var(--accent-06);
  border: 2px dashed var(--color-accent);
  border-radius: var(--radius-md);
}

.block-ghost .block-content,
.block-ghost .block-bullet {
  visibility: hidden;
}
```

- [ ] **Step 3: 更新 drag 样式保持完整外观**
将现有 `.block-drag` 样式替换为：
```css
.block-drag {
  opacity: 1;
  transform: scale(1.02);
  box-shadow: 0 6px 20px var(--overlay);
  border-radius: var(--radius-md);
  cursor: grabbing;
}
```

- [ ] **Step 4: Commit**
```bash
git add src/components/Block/styles.css
git commit -m "style(drag): add drop indicator styles and optimize ghost/drag"
```

---

### Task 6: 编译检查和测试

**Files:**
- (no changes)

- [ ] **Step 1: 运行 TypeScript 编译检查**
```bash
cd d:\comind\comind && npm run build
```
Expected: 编译成功，无错误

- [ ] **Step 2: 运行单元测试**
```bash
cd d:\comind\comind && npm run test
```
Expected: 所有测试通过

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "chore: verify build and tests pass"
```

---

### Task 7: 手动功能测试

**Files:**
- (no changes)

- [ ] **Step 1: 测试排序放置（上/下方）**
- 拖动 A 到 B 的 bullet 左侧偏上，应显示上方指示线
- 拖动 A 到 B 的 bullet 左侧偏下，应显示下方指示线

- [ ] **Step 2: 测试嵌套放置**
- 拖动 A 到 B 的 bullet 右侧，应显示缩进指示线

- [ ] **Step 3: 测试升级放置**
- 拖动 A 到 B 的 bullet 左侧区域，应显示升级指示线

- [ ] **Step 4: 测试边界情况**
- 拖拽到自己：不应显示指示线
- 拖拽到后代：不应显示指示线
- ESC 取消：指示线应消失

---

## 实施完成

所有任务完成后，请进行手动功能测试验证实现是否符合设计规范。
