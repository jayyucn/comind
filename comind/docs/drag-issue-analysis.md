# 拖拽问题分析与修复

## 问题描述

用户报告：拖拽子节点时，父节点也随之移动。

## 根本原因

### 核心问题：生命周期钩子注册时机错误

**问题代码（修复前）：**

```typescript
// Block/index.vue
onMounted(() => {
  if (childrenRef.value) {
    useSortable(childrenRef.value)  // ❌ 在 onMounted 中调用
  }
})

// useSortable.ts
export function useSortable(el: HTMLElement) {
  const sortable = Sortable.create(el, { ... })

  onBeforeUnmount(() => {  // ❌ 在 onMounted 回调中注册生命周期钩子
    sortable.destroy()
  })

  return sortable
}
```

**问题根因：**

1. **Vue 生命周期钩子必须在 setup 阶段同步调用**
   - 根据 Vue 3 文档：生命周期钩子必须在 `setup()` 或 `<script setup>` 的顶层同步调用
   - 在 `onMounted` 回调中调用 `onBeforeUnmount` 会导致钩子无法正确注册

2. **Sortable 实例泄漏**
   - 由于 `onBeforeUnmount` 钩子注册失败，组件卸载时不会销毁 Sortable 实例
   - 泄漏的 Sortable 实例仍然绑定在 DOM 元素上

3. **多个 Sortable 实例响应同一拖拽事件**
   - 在嵌套的 Block 结构中，每个有子节点的 Block 都会初始化一个 Sortable 实例
   - 当路由切换或组件重新渲染时，旧的实例未被销毁
   - 新实例创建后，同一个 DOM 元素上有多个 Sortable 实例监听
   - 拖拽时，多个实例的 `onEnd` 回调都会执行，导致数据被多次更新

### 为什么会导致父子节点联动移动？

当拖拽子节点时：

1. 子节点容器的 Sortable 实例触发 `onEnd`，正确更新子节点数据
2. **泄漏的父容器 Sortable 实例也触发 `onEnd`**（因为它也监听了同一组 DOM 事件）
3. 父容器的 `moveBlock` 被错误调用，修改父节点数据

## 修复方案

### 修复 1：useSortable 改为接受 Ref 参数

```typescript
// useSortable.ts
export function useSortable(containerRef: Ref<HTMLElement | null>) {
  const sortableRef = ref<Sortable | null>(null)

  // ✅ onMounted 在 setup 阶段注册
  onMounted(() => {
    if (containerRef.value) {
      sortableRef.value = Sortable.create(containerRef.value, { ... })
    }
  })

  // ✅ onBeforeUnmount 在 setup 阶段注册，确保组件卸载时执行
  onBeforeUnmount(() => {
    if (sortableRef.value) {
      sortableRef.value.destroy()
      sortableRef.value = null
    }
  })

  return sortableRef
}
```

### 修复 2：Block 和 Page 组件在 setup 阶段调用 useSortable

```typescript
// Block/index.vue
const childrenRef = ref<HTMLElement | null>(null)

// ✅ 在 setup 阶段调用，传入 ref 而不是元素本身
useSortable(childrenRef)

onMounted(() => {
  // 其他初始化逻辑...
})
```

```typescript
// Page/index.vue
const blockListRef = ref<HTMLElement | null>(null)

// ✅ 根容器的 Sortable（必须在 setup 阶段调用）
useSortable(blockListRef)
```

## 验证修复

### 单元测试

新增测试用例验证：

1. ✅ 移动子节点时，父节点的 pos 不应改变
2. ✅ 移动子节点时，只有被移动节点的位置改变
3. ✅ 跨容器移动子节点时，原父节点和新父节点都不受影响
4. ✅ 移动孙节点时，所有祖先节点都不受影响

所有测试通过：

```
 ✓ moveBlock - 拖拽子节点问题修复 > 移动子节点时，父节点的 pos 不应改变
 ✓ moveBlock - 拖拽子节点问题修复 > 移动子节点时，只有被移动节点的位置改变
 ✓ moveBlock - 拖拽子节点问题修复 > 跨容器移动子节点时，原父节点和新父节点都不受影响
 ✓ moveBlock - 拖拽子节点问题修复 > 移动孙节点时，所有祖先节点都不受影响

 Test Files  2 passed (2)
      Tests  41 passed (41)
```

## 影响范围

### 修改的文件

1. `src/composables/useSortable.ts` - 核心修复
2. `src/components/Block/index.vue` - 调用方式修复
3. `src/components/Page/index.vue` - 调用方式修复
4. `src/stores/blocks.test.ts` - 新增测试用例

### 无需修改

- `blocks.ts` 的 `moveBlock` 方法逻辑正确
- `isDescendantOf` 循环检测逻辑正确
- Sortable.js 的配置正确

## 防止问题再次发生

### 边界条件处理

1. ✅ 循环移动检测（父→子、祖先→后代）
2. ✅ 移动到超出范围的位置被 clamp
3. ✅ 移动不存在的 block 无操作
4. ✅ 移动到同一位置无操作

### 最佳实践

1. **Vue Composables 必须在 setup 阶段调用**
   - 生命周期钩子（onMounted, onBeforeUnmount 等）必须在 setup 阶段同步调用
   - 不能在异步回调或 onMounted 中调用

2. **使用 Ref 而不是直接传递 DOM 元素**
   - Composable 接收 `Ref<HTMLElement | null>` 而不是 `HTMLElement`
   - 内部在 onMounted 中解引用 ref 并创建实例

3. **确保资源清理**
   - onBeforeUnmount 必须在 setup 阶段注册
   - 清理所有 Side Effects（事件监听、定时器、第三方实例）

## 相关文档

- [Vue 3 生命周期钩子](https://vuejs.org/guide/essentials/lifecycle.html#lifecycle-hooks)
- [Vue Composables 最佳实践](https://vuejs.org/guide/reusability/composables.html)
- `docs/sortable-implementation.md` - Sortable.js 实现规范
