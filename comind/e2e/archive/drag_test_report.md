# 拖拽位置问题验证报告

## 测试环境
- 浏览器: Chromium (Playwright)
- 测试方式: E2E 自动化测试

## 测试结果

### 测试 1: after 位置（拖到 Second 后面）
**操作**: 拖拽 First 到 Second 的下半部分  
**期望结果**: Second, First, Third  
**实际结果**: ✅ Second, First, Third（正确）

### 测试 2: before 位置（拖到 Beta 前面）
**操作**: 拖拽 Gamma 到 Beta 的上半部分  
**期望结果**: Alpha, Gamma, Beta  
**实际结果**: ✅ Alpha, Gamma, Beta（正确）

## 截图证据

### 拖拽前
```
Alpha
Beta
Gamma
```

### 拖拽 Gamma 到 Beta 前面后
```
Alpha
Gamma  ← 正确移动到了 Beta 前面
Beta
```

## 结论

当前代码的 **before/after 位置检测逻辑是正确的**。

如果用户报告"拖拽位置与目标位置不符"，可能是以下情况之一：

1. **child 位置**（缩进为子节点）- 当前代码只支持 before/after，不支持拖为子节点
2. **跨层级拖拽**（拖到不同 parent 下）- 需要验证
3. **特定边界情况**（如拖到第一个/最后一个位置）
4. **视觉反馈问题**（指示线显示位置与实际放置位置不一致）

## 需要进一步验证的场景

- [ ] 拖到第一个 block 的 before 位置
- [ ] 拖到最后一个 block 的 after 位置
- [ ] 跨 parent 拖拽（如从子节点拖为根节点）
- [ ] 拖为子节点（child 位置）

## 代码变更

本次修复了以下问题：
1. ✅ mouseup 时如果没有 dropTargetInfo，会重新计算
2. ✅ 增加了 targetIndex === -1 的边界检查
3. ✅ 修复了 isDescendantOf 检查（防止拖入自己的子树）
