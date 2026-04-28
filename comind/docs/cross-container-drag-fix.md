# 跨容器拖拽黑线问题修复方案

**问题描述：** 跨父节点拖拽子节点时，页面下方偶尔会闪过一根横向的黑线

## 问题分析

### 可能的原因

1. **Sortable.js 的占位符元素**
   - 跨容器拖拽时，Sortable.js 会在目标容器中插入临时占位符
   - 这个占位符的默认样式可能显示为黑线

2. **缩进线伪元素（`::before`）**
   - 拖拽过程中，某些 Block 的缩进线可能短暂可见
   - 由于 `position: absolute` 和旋转，显示为横向黑线

3. **空容器占位符**
   - 当目标容器为空时，Sortable.js 会插入占位符
   - 这个占位符可能有默认样式

4. **Ghost 元素的边框**
   - `block-ghost` 类的 `border: 2px dashed` 可能在某些角度显示为横向黑线

## 修复方案

### 1. Sortable.js 配置优化

```typescript
// src/composables/useSortable.ts
sortableRef.value = Sortable.create(containerRef.value, {
  group: 'blocks',
  animation: 150,
  ghostClass: 'block-ghost',
  dragClass: 'block-drag',
  chosenClass: 'block-chosen',
  handle: '.block-bullet',

  // 禁用空容器占位符
  emptyInsertThreshold: 0,

  // 禁用 swap 模式
  swap: false,
})
```

### 2. 全局样式优化

```css
/* src/style.css */

/* 隐藏 Sortable.js 的默认占位符样式 */
.sortable-ghost,
.sortable-chosen,
.sortable-drag {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

/* 隐藏占位符的伪元素 */
.sortable-ghost::before,
.sortable-ghost::after,
.sortable-chosen::before,
.sortable-chosen::after,
.sortable-drag::before,
.sortable-drag::after {
  display: none !important;
}

/* 隐藏没有 block ID 的临时元素（Sortable.js 插入的占位符） */
.block-children > div:not([data-block-id]) {
  display: none !important;
}
```

### 3. Block 组件样式优化

```css
/* src/components/Block/styles.css */

.block-ghost::before,
.block-ghost .block-children::before {
  display: none !important;
}

.block-drag {
  /* 移除 rotate，避免缩进线位置偏移 */
  transform: scale(1.02);  /* 只保留 scale */
}
```

## 测试方案

### E2E 测试

运行以下测试复现问题：

```bash
cd d:\comind\comind
python e2e\test_cross_container_drag.py
```

测试步骤：
1. 创建两个父节点 Parent1, Parent2
2. 在 Parent1 下创建子节点 Child
3. 跨容器拖拽 Child 到 Parent2 下
4. 观察拖拽过程中是否有横向黑线闪烁

### 手动测试

1. 启动开发服务器：`npm run dev`
2. 打开浏览器：http://localhost:5173
3. 创建嵌套结构：
   - Parent1
     - Child1
     - Child2
   - Parent2
     - Child3
4. 测试场景：
   - 将 Child1 拖拽到 Child2 下（同容器）
   - 将 Child1 拖拽到 Parent2 下（跨容器）
   - 将 Parent1 拖拽到 Parent2 下（跨容器）
   - 将 Child1 拖拽到根级别（跨容器）
5. 观察是否还有黑线闪烁

## 调试技巧

### 1. 检查 DOM 结构

在拖拽过程中，打开浏览器开发者工具，检查 `.block-children` 容器内是否有临时元素插入。

### 2. 检查样式应用

使用以下代码检查拖拽过程中的样式：

```javascript
// 在浏览器控制台运行
document.querySelectorAll('.block-children').forEach(el => {
  console.log('Container:', el.dataset.parentId)
  console.log('Children:', el.children.length)
  Array.from(el.children).forEach(child => {
    console.log('  -', child.className, child.dataset.blockId)
  })
})
```

### 3. 检查伪元素

```javascript
// 检查伪元素是否可见
document.querySelectorAll('.block').forEach(el => {
  const before = window.getComputedStyle(el, '::before')
  if (before.content !== 'none') {
    console.log('Block has ::before:', el.dataset.blockId, before.display, before.opacity)
  }
})
```

## 可能的后续优化

1. **使用 `forceFallback` 模式**
   - Sortable.js 的 fallback 模式可以更好地控制拖拽行为
   - 但可能会影响性能

2. **自定义占位符**
   - 使用 `onStart` / `onEnd` 回调自定义占位符样式
   - 完全控制拖拽过程中的视觉效果

3. **禁用 HTML5 拖拽 API**
   - 使用 Sortable.js 的自定义拖拽实现
   - 避免浏览器默认行为导致的视觉问题

## 相关文件

- `src/composables/useSortable.ts` - Sortable.js 配置
- `src/components/Block/styles.css` - Block 拖拽样式
- `src/style.css` - 全局样式
- `e2e/test_cross_container_drag.py` - E2E 测试
