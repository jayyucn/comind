# 嵌套折叠 Bug 修复总结

## 问题
三层结构 (p1 → p2 → s1) 下，连续折叠 p2、p1 后展开 p1，p2 无法显示。

## 根因
`scrollHeight` 在子块已折叠时返回的是折叠后的高度（27px），不是完整高度（54px）。

展开动画使用 `scrollHeight` 作为目标高度，导致动画终点错误。

## 修复方案

### 1. 引入 `childrenHeight` 状态
```typescript
const childrenHeight = ref(0)
```

### 2. 在子块挂载/卸载时更新
```typescript
watch(children, async () => {
  await nextTick()
  updateChildrenHeight()  // childrenHeight.value = scrollHeight
}, { deep: false })
```

### 3. 展开动画使用 `childrenHeight`
```typescript
watch(collapsed, async (isCollapsed) => {
  if (!isCollapsed) {
    // 展开：使用 childrenHeight（完整展开高度）
    const targetHeight = childrenHeight.value || childrenRef.value.scrollHeight
    // ...
  }
})
```

### 4. `collapsed` 状态持久化
- 初始化：`const collapsed = ref(props.block.collapsed ?? false)`
- 变化时保存：`watch(collapsed, async (newVal) => { blockStore.updateBlock(...) })`
- store 新增 `updateBlock` 方法支持任意字段更新

## 验证结果
- p1 展开后 `children_maxHeight: 54px` ✅
- s1 存在于 DOM 中（p2 的子块）✅
- p2 `block_offsetHeight: 27` ✅
- `collapsed` 状态刷新后保持 ✅

## 待修复
内容保存问题（p2/s1 的 text 为空）—— 这是 `Enter` 创建新块时的保存逻辑 bug，不影响折叠功能本身。
