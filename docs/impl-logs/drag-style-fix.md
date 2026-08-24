# 拖拽样式修复说明

**问题：** 拖拽过程中页面下方偶尔会闪过一根横向的黑线

## 问题分析

### 根本原因

拖拽样式与缩进线（`::before` 伪元素）冲突：

1. **`block-drag` 类有 `transform: rotate(1.5deg)`**
   - 拖拽时元素轻微旋转
   - 导致缩进线（`::before` 伪元素）位置偏移
   - 缩进线可能短暂显示为横向黑线

2. **`block-ghost` 类未隐藏缩进线伪元素**
   - ghost 元素是被拖拽元素的克隆
   - 克隆包含 `::before` 伪元素（缩进线）
   - 在拖拽过程中，这些伪元素可能短暂可见
   - 由于 `position: absolute` 和旋转，显示为横向黑线

## 修复方案

### 修改 `src/components/Block/styles.css`

```css
/* ── 拖拽样式（Sortable.js ghostClass / dragClass）── */

.block-ghost {
  opacity: 0.35;
  background: var(--accent-06);
  border: 2px dashed var(--color-accent);
  border-radius: var(--radius-md);
}

/* 隐藏 ghost 元素的缩进线，避免黑线闪烁 */
.block-ghost::before {
  display: none !important;
}

/* 隐藏 ghost 元素内部所有缩进线 */
.block-ghost .block-children::before {
  display: none !important;
}

.block-drag {
  opacity: 0.45;
  transform: scale(1.02);  /* 移除 rotate，只保留 scale */
  box-shadow: 0 6px 20px var(--overlay);
  border-radius: var(--radius-md);
  cursor: grabbing;
}
```

## 关键修改

1. **移除 `rotate(1.5deg)`**
   - 避免元素旋转导致缩进线位置偏移
   - 只保留 `scale(1.02)` 保持"漂浮"效果

2. **隐藏 ghost 元素的所有缩进线伪元素**
   - `.block-ghost::before` - 隐藏 ghost 元素自身的缩进线
   - `.block-ghost .block-children::before` - 隐藏 ghost 元素内部所有子容器的缩进线

## 视觉效果

修复后：
- ✅ 拖拽时不会出现黑线闪烁
- ✅ 保留"漂浮"视觉效果（opacity + scale + shadow）
- ✅ ghost 占位符清晰可见（虚线边框 + 半透明背景）

## 测试验证

手动测试：
1. 创建嵌套 Block 结构（Parent → Child1, Child2）
2. 拖拽 Child1 到 Child2 后面
3. 观察拖拽过程中是否还有黑线闪烁

预期结果：无黑线闪烁，拖拽流畅。

## 相关文件

- `src/components/Block/styles.css` - 拖拽样式定义
- `src/composables/useSortable.ts` - Sortable.js 配置
- `docs/drag-issue-analysis.md` - 拖拽问题详细分析
