# 拖拽放置指示线设计文档

> 版本：v1.0
> 日期：2026-05-10
> 状态：**待实现**

---

## 1. 概述

本文档描述 Block 树拖拽交互的放置指示线功能。

### 1.1 目标

- 在拖拽过程中显示放置位置指示线
- 支持三种放置类型：排序（sort）、嵌套（nest）、升级（promote）
- 保留 ghost 占位符，显示被拖拽项的原始位置
- 提供清晰、一致的视觉反馈

### 1.2 相关文件

| 文件 | 说明 |
|------|------|
| `src/components/Block/index.vue` | Block 组件，拖拽交互核心 |
| `src/components/Block/styles.css` | 拖拽相关样式 |
| `src/components/BlockList.vue` | 根级 Block 列表容器 |

### 1.3 技术约束

- 使用 vue-draggable-plus 实现拖拽
- 不引入新的外部依赖
- 指示线为单个 DOM 元素，动态定位

---

## 2. 放置区域检测

### 2.1 区域划分

每个 Block 的 bullet 区域划分为三个检测区域：

```
┌─────────────────────────────────────────────────────────────┐
│                    放置区域检测逻辑                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   [左侧区域]  [bullet]    [中间区域]   [bullet]  [右侧区域]  │
│       ↑          ↑          ↑           ↑         ↑       │
│    升级放置    (边界)     排序放置    (边界)     嵌套放置   │
│   (promote)               (sort)               (nest)     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 区域计算

```typescript
const DRAG_THRESHOLD = {
  LEFT: 20,   // 升级区域阈值
  RIGHT: 20   // 嵌套区域阈值
}

function computeDropZone(cursorX: number, bulletRect: DOMRect): 'left' | 'center' | 'right' {
  if (cursorX <= bulletRect.left + DRAG_THRESHOLD.LEFT) return 'left'
  if (cursorX >= bulletRect.right - DRAG_THRESHOLD.RIGHT) return 'right'
  return 'center'
}
```

### 2.3 放置类型映射

| 区域 | 放置类型 | 说明 | 放置结果 |
|------|---------|------|---------|
| left | promote | 升级放置 | 作为目标的前一个兄弟 |
| center | sort | 排序放置 | 根据在 bullet 上方/下方决定 |
| right | nest | 嵌套放置 | 作为目标的子节点 |

### 2.4 排序放置的细分

当区域为 `center` 时，需要进一步判断是"上方"还是"下方"：

```typescript
function computeSortPosition(cursorY: number, bulletRect: DOMRect): 'before' | 'after' {
  const bulletCenterY = bulletRect.top + bulletRect.height / 2
  return cursorY < bulletCenterY ? 'before' : 'after'
}
```

---

## 3. 数据结构

### 3.1 DropTarget 接口

```typescript
interface DropTarget {
  action: 'sort' | 'nest' | 'promote' | null
  toParentId: string | null  // 目标父节点 ID
  beforeId: string | null   // 插入到此节点之前（null = 追加到末尾）
}
```

### 3.2 放置结果示例

| 场景 | action | toParentId | beforeId | 说明 |
|------|--------|-----------|----------|------|
| A 拖到 B 上方 | sort | B.parentId | B.id | A 成为 B 的前一个兄弟 |
| A 拖到 B 下方 | sort | B.parentId | B.nextSiblingId | A 成为 B 的后一个兄弟 |
| A 拖到 B 右侧 | nest | B.id | null | A 成为 B 的第一个子节点 |
| A 拖到 B 左侧 | promote | A.parentId | B.id | A 成为 B 的前一个兄弟（同级） |

---

## 4. 实现方案

### 4.1 放置位置计算

在 `Block/index.vue` 中新增以下函数：

```typescript
function computeDropZone(cursorX: number, bulletRect: DOMRect): 'left' | 'center' | 'right'

function findDropTarget(cursorX: number, cursorY: number, targetBlockEl: HTMLElement): DropTarget | null
```

### 4.2 放置指示线渲染

**DOM 元素**：全局单一指示线元素，动态定位

```typescript
// 创建/更新指示线
function renderDropIndicator(targetBlockEl: HTMLElement, dropTarget: DropTarget) {
  const indicator = getOrCreateIndicator()
  const bullet = targetBlockEl.querySelector('.block-bullet')
  if (!bullet) return

  const rect = bullet.getBoundingClientRect()
  const scrollY = window.scrollY

  // 基础定位
  indicator.style.left = `${rect.left}px`
  indicator.style.width = `${rect.right - rect.left}px`

  // 根据放置类型调整
  if (dropTarget.action === 'sort') {
    // 排序放置：线在 bullet 上方或下方
    indicator.style.top = `${dropTarget.position === 'before' ? rect.top : rect.bottom}px`
    indicator.className = 'drop-indicator sort'
  } else if (dropTarget.action === 'nest') {
    // 嵌套放置：线缩进显示
    const indentWidth = 24 * (targetBlockDepth + 1)
    indicator.style.top = `${rect.top}px`
    indicator.style.left = `${rect.left + indentWidth}px`
    indicator.style.width = `${rect.right - rect.left - indentWidth}px`
    indicator.className = 'drop-indicator nest'
  } else if (dropTarget.action === 'promote') {
    // 升级放置：线在 bullet 上方，位置提升
    indicator.style.top = `${rect.top}px`
    indicator.className = 'drop-indicator promote'
  }

  indicator.classList.add('visible')
}

// 清除指示线
function clearDropIndicator() {
  const indicator = document.querySelector('.drop-indicator')
  if (indicator) {
    indicator.classList.remove('visible')
  }
}
```

### 4.3 拖拽移动处理

```typescript
function handleDragMove(evt: any): boolean | void {
  const draggedId = (evt.dragged as HTMLElement)?.dataset.blockId
  const related = evt.related as HTMLElement

  // 防止放置到自身
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

  // 防止循环嵌套
  if (draggedId && targetId && blockStore.isDescendantOf(targetId, draggedId)) {
    clearDropIndicator()
    return false
  }

  // 计算放置目标并渲染指示线
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

---

## 5. CSS 样式

### 5.1 放置指示线样式

```css
.drop-indicator {
  position: fixed;
  height: 2px;
  background: var(--color-accent);
  pointer-events: none;
  z-index: 1000;
  opacity: 0;
  transition: opacity 0ms; /* 无动画，即时响应 */
}

.drop-indicator.visible {
  opacity: 1;
}

/* 嵌套放置：缩进样式 */
.drop-indicator.nest {
  border-left: 2px solid var(--color-accent);
  background: transparent;
}

/* 升级放置：位置提升 */
.drop-indicator.promote {
  /* 与排序放置相同，通过 top 定位实现 */
}

/* 排序放置：默认样式 */
.drop-indicator.sort {
  /* 默认样式即可 */
}
```

### 5.2 Ghost 占位符优化

当前 `block-ghost` 显示为被拖拽项的克隆。优化为简洁占位符：

```css
.block-ghost {
  /* 简洁占位符样式 */
  opacity: 0.3;
  background: var(--accent-06);
  border: 2px dashed var(--color-accent);
  border-radius: var(--radius-md);
  height: 24px; /* 固定高度，与 bullet 行高一致 */
}

/* 隐藏 ghost 内的内容 */
.block-ghost .block-content {
  visibility: hidden;
}

.block-ghost .block-bullet {
  visibility: hidden;
}
```

### 5.3 被拖拽项样式

保持被拖拽项的完整外观：

```css
.block-drag {
  /* 保持完整外观，只是添加漂浮效果 */
  opacity: 1;
  box-shadow: 0 6px 20px var(--overlay);
  transform: scale(1.02);
  cursor: grabbing;
}
```

---

## 6. 状态管理

### 6.1 dragState ref

```typescript
const dragState = ref<{
  currentDropTarget: DropTarget | null
  indicator: HTMLElement | null
}>({
  currentDropTarget: null,
  indicator: null
})
```

### 6.2 拖拽结束处理

```typescript
async function handleBlockDragEnd() {
  const dropTarget = dragState.value.currentDropTarget

  if (dropTarget && dropTarget.action) {
    const draggedEl = document.querySelector('.block-chosen') as HTMLElement
    const draggedId = draggedEl?.dataset.blockId

    if (draggedId) {
      // 计算最终放置位置
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

---

## 7. 测试场景

### 7.1 手动测试清单

| 场景 | 操作 | 预期结果 |
|------|------|---------|
| 拖拽到目标上方 | 拖动 A 到 B 的 bullet 左侧偏上 | 显示排序指示线在上方 |
| 拖拽到目标下方 | 拖动 A 到 B 的 bullet 左侧偏下 | 显示排序指示线在下方 |
| 拖拽到目标右侧 | 拖动 A 到 B 的 bullet 右侧 | 显示嵌套缩进指示线 |
| 拖拽到目标左侧 | 拖动 A 到 B 的 bullet 左侧区域 | 显示升级指示线 |
| 拖拽到自己 | 尝试拖动 A 到 A 的区域 | 不显示指示线，拖拽被阻止 |
| 拖拽到自己后代 | 尝试将父节点拖入子节点区域 | 不显示指示线，拖拽被阻止 |
| 快速移动鼠标 | 在不同目标之间快速移动 | 指示线即时更新 |

### 7.2 边界情况

| 场景 | 预期行为 |
|------|---------|
| 拖拽到页面边缘 | 指示线消失，拖拽可正常取消 |
| 拖拽到折叠节点 | 指示线正常显示在 bullet 区域 |
| 拖拽到根级区域 | 升级放置指示线与根级 bullet 对齐 |
| ESC 取消拖拽 | 指示线消失，恢复原始状态 |

---

## 8. 性能考虑

### 8.1 避免频繁 DOM 操作

- 放置指示线使用全局单一 DOM 元素
- 只在目标变化时更新位置
- 使用 `requestAnimationFrame` 节流（可选优化）

### 8.2 CSS 优化

- 指示线使用 `position: fixed` 避免滚动重排
- 使用 CSS 变量便于主题适配

---

## 9. 实施步骤

1. 在 `Block/index.vue` 中添加 `computeDropZone` 和 `findDropTarget` 函数
2. 添加 `renderDropIndicator` 和 `clearDropIndicator` 函数
3. 修改 `handleDragMove` 以调用放置检测和指示线渲染
4. 修改 `handleBlockDragEnd` 以使用放置类型
5. 添加 CSS 样式到 `styles.css`
6. 手动测试各场景

---

## 10. 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2026-05-10 | v1.0 | 初稿 |

---

*文档结束*
