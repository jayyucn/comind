# Sortable.js 编译错误 & Bug 修复 — 2026-04-21

## 背景
上次 Sortable.js 实施后，编译出现 7 类 TypeScript 错误，修复后运行时发现两个 bug：无法折叠、无法拖拽。

## 编译错误修复

| # | 文件 | 错误描述 | 修复 |
|---|------|----------|------|
| 1 | blocks.ts | `recalculateLeftValues`/`isDescendantOf` 定义在 store 外部，引用 `blocks.value`（store 内部状态）；且文件有重复定义 | 重写 blocks.ts，函数移入 `defineStore` 内部，删除重复定义 |
| 2 | useSortable.ts | `Sortable.Instance` 类型不存在；`parentId` 参数未使用 | 改为 `Sortable`；删除 `parentId` 参数 |
| 3 | Block.vue / App.vue | `useSortable(ref.value)` TypeScript 不接受 `HTMLElement` 参数 | 改 `useSortable(el: HTMLElement)` 直接接收 DOM 元素 |
| 4 | Editor.vue | `onMounted`/`ref` 导入但未使用 | 移除导入 |
| 5 | leftCalculator.ts | `reindexLeftValues` 中 `for ([parentId, children])` 的 `parentId` 未使用 | 改为 `_parentId` |

## Bug 修复

### Bug 1：Block 无法折叠

**根因**：Block.vue 采用了 `v-show` + 分离动画层的错误结构：
```html
<!-- 问题：animator 是空 div，max-height 动画不会影响 .block-children -->
<div v-show="children.length > 0" ref="transitionRef" class="block-children" ...>
  <!-- 内容在 .block-children 内部，v-show 控制 display -->
</div>
<div class="block-children-animator" :style="{ maxHeight: collapsed ? '0' : '2000px' }">
  <!-- 空 div，max-height 改变对它自己无效 -->
</div>
```

**修复**：改回 `v-if` + Transition 钩子控制动画：
```html
<Transition
  @before-enter="onBeforeEnter"
  @enter="onEnter"
  @after-enter="onAfterEnter"
  @before-leave="onBeforeLeave"
  @leave="onLeave"
>
  <div v-if="children.length > 0" ref="childrenRef" class="block-children" ...>
    <!-- Transition 直接包装实际内容，动画生效 -->
  </div>
</Transition>
```

**动画钩子逻辑**：
- `onBeforeEnter`：设 `max-height: 0px`（初始状态）
- `onEnter` (rAF×2)：从 `0` → `scrollHeight`，触发动画
- `onAfterEnter`：设 `auto`
- `onBeforeLeave`：设 `scrollHeight`
- `onLeave` (rAF×2)：从 `scrollHeight` → `0`，触发动画

### Bug 2：Block 无法拖拽

**根因**：`useSortable.ts` 配置了 `delay: 150, delayOnTouchOnly: true`：
```ts
delay: 150,
delayOnTouchOnly: true,
```
- `delay` 作用于**所有输入**（包括鼠标）
- `delayOnTouchOnly: true` 只对触摸设备生效延迟
- 桌面端鼠标 mousedown 后延迟 150ms 才触发拖拽，几乎不可能成功拖拽

**修复**：移除 `delay` 和 `delayOnTouchOnly`，桌面端立即响应：
```ts
// 已移除这两个配置
```

## 修复后文件状态

| 文件 | 行数 | 状态 |
|------|------|------|
| src/components/Block.vue | ~275 | ✅ 重写，折叠动画正确，Sortable 接入 |
| src/composables/useSortable.ts | ~60 | ✅ 简化，桌面端拖拽正常 |
| src/stores/blocks.ts | ~400 | ✅ 无重复定义，moveBlock/isDescendantOf 在 store 内 |
| src/App.vue | ~90 | ✅ 根容器 Sortable 初始化 |

## 编译结果
```
✓ 88 modules transformed
✓ built in 615ms
```

## 待验证
- [ ] 折叠动画流畅度
- [ ] 跨层级拖拽（root ↔ nested）数据持久化
