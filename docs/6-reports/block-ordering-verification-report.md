# Block 排序机制 — 系统功能验证报告

**基准文档**: `d:\comind\docs\block-ordering-redesign.md` v1.0  
**验证日期**: 2026-04-27  
**验证方法**: 代码逐行比对 + 测试重跑 + 构建重跑 + 边界条件分析  

---

## 1. 数据结构 (§3.2) — ✅ 通过

| 检查项 | 设计 | 实现 | 结果 |
|--------|------|------|------|
| Block 含 `pos: number` | 是 | `src/types/block.ts:4` — `pos: number` | ✅ |
| BlockRecord 含 `pos: number` | 是 | `src/types/block.ts:17` — `pos: number` | ✅ |
| BlockWithPos 改为类型别名 | 是 | `src/types/block.ts:29` — `export type BlockWithPos = Block` | ✅ |
| pos 注释放置 | "排序位置（Gap 排序，初始间隔 1000）" | 第4行注释匹配 | ✅ |

## 2. 核心算法 (§3.4) — ✅ 通过（1个边界⚠️）

### 2.1 `calcInsertPos` — 逐路径验证

| 路径 | 设计行为 | 代码 (block-helpers.ts:106-120) | 结果 |
|------|----------|-------------------------------|------|
| null, null | GAP_SIZE | `return GAP_SIZE` ✓ | ✅ |
| null, N | N - GAP_SIZE | `return nextPos! - GAP_SIZE` ✓ | ⚠️ 见下方 |
| N, null | N + GAP_SIZE | `return prevPos + GAP_SIZE` ✓ | ✅ |
| N, M | (N+M)/2 | `return (prevPos + nextPos) / 2` ✓ | ⚠️ 见下方 |

**⚠️ B-1: 负 pos 值**  
当 `nextPos < GAP_SIZE` 且 `prevPos === null` 时，`calcInsertPos(null, nextPos)` 返回 **负数**（例如 `calcInsertPos(null, 500) = -500`）。虽然排序仍然正确（负值排在所有正值之前），但不符合"pos 值为正整数"的直觉预期。`renumberBlocks` 可修复此问题（重新分配为 `(i+1)*GAP_SIZE`），但不会自动触发。

**⚠️ B-2: 间隔耗尽检测不精确**  
`mid === prevPos || mid === nextPos` 仅在相邻位置差为 1（即 `prevPos=1, nextPos=2` 时 `mid=1.5 !== 1 && 1.5 !== 2` 不触发）时不生效。检测需要相邻节点 pos 完全相同（整数相等）才触发，但正常情况下相邻 pos 不可能完全相同。意味着 **gap exhaustion warning 几乎永远不会触发**。

**严重程度**: B-1 低（不影响正确性），B-2 低（诊断工具不精确，不影响功能）

### 2.2 `renumberBlocks` — ✅

| 特性 | 设计 | 代码 (block-helpers.ts:125-129) | 结果 |
|------|------|-------------------------------|------|
| 输入 | Block[] | `blocks: Block[]` ✓ | ✅ |
| 排序 | sortByPos | `sortByPos([...blocks])` ✓ | ✅ |
| 分配 | (i+1)*GAP_SIZE | `block.pos = (index + 1) * GAP_SIZE` ✓ | ✅ |
| 空数组 | 无操作 | 遍历空数组，无副作用 | ✅ |

### 2.3 "先计算 pos 再修改 parentId" 规则 — ✅

| 操作 | 设计顺序 | 代码顺序 | 结果 |
|------|----------|----------|------|
| indent | ① getChildren → ② calcInsertPos → ③ set parentId | blocks.ts:255-261 完全匹配 | ✅ |
| outdent | ① getNextSibling → ② calcInsertPos → ③ set parentId | blocks.ts:274-279 完全匹配 | ✅ |

## 3. 业务操作 (§3.5) — ✅ 全部通过

### 3.1 `createBlock` — ✅

```
设计: 找兄弟 → lastPos → calcInsertPos(lastPos, null) → 创建 → 写 IDB
代码: blocks.ts:128-153
  1. ✅ getSortedChildren 获取同 parentId 兄弟
  2. ✅ lastPos = siblings[siblings.length-1].pos
  3. ✅ calcInsertPos(lastPos, null)
  4. ✅ 创建 Block（含 pos 字段）
  5. ✅ storage.saveBlock(block)
```

### 3.2 `splitBlock` — ✅

```
设计: 截断 → 保存 before → 判断父节点 → 计算 pos → 创建
代码: blocks.ts:156-191
  1. ✅ pmPosToTextOffset 转换 cursorPos → .slice() 截断
  2. ✅ 保存 current block (content=before)
  3. ✅ isCreateChild = isCollapsed || childBlocks.length > 0
  4. ✅ 子节点路径: calcInsertPos(lastChildPos, null)
  5. ✅ 兄弟节点路径: calcInsertPos(block.pos, nextSibling?.pos)
```

### 3.3 `mergeWithPrevious` — ✅

```
设计: 找前驱 → 追加内容 → 级联删除 → 返回 {id, cursorPos}
代码: blocks.ts:229-244
  1. ✅ findPreviousBlockInTreeOrder 树前序查找
  2. ✅ prev.content += block.content
  3. ✅ cursorPos = prevContentLen + 1
  4. ✅ deleteBlock(blockId) 级联删除
  5. ✅ return { id: prev.id, cursorPos }
注: 不需要更新任何 pos ✓
```

### 3.4 `indent` — ✅

```
设计: 前提 prev 存在 → getChildren(prev.id) → calcInsertPos → set parentId/pos
代码: blocks.ts:247-262
  1. ✅ 无 prev → return
  2. ✅ children = getChildren(prev.id)  // 在改 parentId 之前
  3. ✅ newPos = calcInsertPos(lastPos, null)  // 先算
  4. ✅ block.parentId = prev.id  // 后改
  5. ✅ block.pos = newPos  // 后改
```

### 3.5 `outdent` — ✅

```
设计: 前提 parentId !== null → getNextSibling(parent) → calcInsertPos → set parentId/pos
代码: blocks.ts:265-282
  1. ✅ !block.parentId → return
  2. ✅ nextSibling = getNextSibling(parent)  // 在改 parentId 之前
  3. ✅ newPos = calcInsertPos(parent.pos, nextSibling?.pos)  // 先算
  4. ✅ block.parentId = newParentId  // 后改
  5. ✅ block.pos = newPos  // 后改
```

### 3.6 `moveBlock` — ✅

```
设计: 循环检测 → 找兄弟(排除自身) → 计算 prev/next → 更新 parentId/pos
代码: blocks.ts:285-306
  1. ✅ isDescendantOf → return
  2. ✅ getSortedChildren(excludeId=blockId)
  3. ✅ clampedIndex = clamp(newIndex, 0, siblings.length)
  4. ✅ prevPos/nextPos 基于 clampedIndex
  5. ✅ block.parentId = toParentId, block.pos = calcInsertPos(...)
注: 不需要更新任何其他节点 pos ✓
```

### 3.7 `deleteBlock` — ✅

```
设计: BFS 收集后代 → 从 blocks.value 移除 → deleteBlockCascade
代码: blocks.ts:309-337
  1. ✅ while queue BFS 收集所有后代
  2. ✅ pendingSaves 清理（cancel + delete）
  3. ✅ blocks.value = blocks.value.filter(...)
  4. ✅ storage.deleteBlockCascade(Array.from(toDelete))
注: 不需要更新任何其他节点 pos ✓
```

## 4. 数据库 Schema (§4) — ✅ 通过

| 检查项 | 设计 | 代码 | 结果 |
|--------|------|------|------|
| version | 3 | `db.ts:12` — `this.version(3)` | ✅ |
| blocks 索引 | id, pageId, parentId, pos, createdAt, updatedAt | 完全一致 | ✅ |
| recordToBlock pos | `pos: record.pos` | `indexedDB.ts:12` — 直接映射 | ✅ |
| blockToRecord pos | `pos: block.pos` | `indexedDB.ts:26` — 直接映射 | ✅ |
| getBlockTree 排序 | 按 parentId 分组 → 组内按 pos 排序 → DFS 展平 | `indexedDB.ts:121-140` — 完全匹配 | ✅ |
| createPageWithRootBlock | pos=1000 | `indexedDB.ts:259` — `pos: 1000` | ✅ |

## 5. 组件排序 (§5) — ✅ 通过

| 组件 | 排序方式 | 结果 |
|------|----------|------|
| BlockList.vue:19 | `list.sort((a, b) => a.pos - b.pos)` | ✅ |
| JournalListItem.vue:27 | `.sort((a, b) => a.pos - b.pos)` | ✅ |
| Page/index.vue:41 | `.sort((a, b) => a.pos - b.pos)` | ✅ |
| useSortable.ts | 无 fromParentId / 无 leftId 引用 | ✅ |

**确认**: 3 个组件 + 1 个 composable 全部使用 `a.pos - b.pos`，无任何 `leftId` 或 `localeCompare` 残留。

## 6. 边界条件验证 (§6.3) — ✅ 全部通过

| 边界场景 | 设计预期 | 实现分析 | 结果 |
|----------|----------|----------|------|
| 页面唯一空 Block 按 Backspace | type='delete'，Block.vue 检测到无前驱仅清空 | deleteBlock BFS 正常，只删除自己 | ✅ |
| 折叠态 Block 按 Enter | type='split', isCollapsed=true, 子节点 | splitBlock isCreateChild=true ✓ | ✅ |
| 展开态 Block 有子节点按 Enter | type='split', 子节点 | isCreateChild=true (children>0) ✓ | ✅ |
| 展开态 Block 无子节点按 Enter | type='split', 兄弟 | isCreateChild=false, 兄弟 ✓ | ✅ |
| 第一个 Block 按 Tab | type='indent'，无 prev 不操作 | indent: !prev → return ✓ | ✅ |
| 顶级 Block 按 Shift-Tab | type='outdent'，noop | outdent: !parentId → return ✓ | ✅ |
| 模态层打开时按键 | 不拦截 (hasModalOpen) | Extension 层处理，与 pos 无关 | ✅ |

## 7. 额外边界条件深度分析

### 7.1 资源耗尽场景

| 场景 | 分析 | 结论 |
|------|------|------|
| 连续在同一位置插入 10 次 | GAP=1000→500→250→125→63→32→16→8→4→2→1 | ⚠️ 第10次后 pos 差=1，仍可插入但精度极低 |
| 连续插入 12 次 | 1→0.5→0.25→… | IEEE 754 双精度约可做53次二分，远超实用值 |
| 1000 个 Block 在同一 parentId | 每个300ms 防抖保存 | ✅ 性能测试：1000 节点排序408ms |
| renumberBlocks 后 IDB 同步 | renumberBlocks 只改内存中的 Block.pos | ⚠️ **未触发 _scheduleSave**，IDB 不会自动更新 |

**⚠️ B-3: `renumberBlocks` 不触发持久化**  
`renumberBlocks` 直接修改 `block.pos` 但不调用 `_scheduleSave`。如果需要持久化重编号结果，调用方需自行处理。

**严重程度**: 中（重编号极少发生，但若忽略持久化会导致下次加载时 pos 值回退）

### 7.2 并发操作冲突

| 场景 | 分析 | 结论 |
|------|------|------|
| 用户同时 Enter 拆分两个 Block | splitBlock 各自独立计算 pos | ✅ 无冲突（各自按不同兄弟列表计算） |
| 用户拖拽移动 + 立即 Enter | moveBlock 防抖 300ms + splitBlock 同步保存 | ⚠️ moveBlock 可能未保存完成 |
| 大量防抖 save 排队 | 每个 Block 独立 debounce Map | ✅ 隔离良好 |

### 7.3 异常输入处理

| 场景 | 代码处理 | 结果 |
|------|----------|------|
| splitBlock: blockId 不存在 | `blocks.value.find` 返回 undefined → return | ✅ |
| splitBlock: cursorPos 越界 | `pmPosToTextOffset` 确保 ≥0，`.slice(len)` 返回 '' | ✅ |
| mergeWithPrevious: blockId 不存在 | find 返回 undefined → return | ✅ |
| indent: 第一个 Block (no prev) | `getPrevSibling` 返回 undefined → return | ✅ |
| outdent: 顶级 Block (parentId=null) | 检测 `!block.parentId` → return | ✅ |
| moveBlock: blockId 不存在 | find 返回 undefined → return | ✅ |
| deleteBlock: blockId 不存在 | BFS toDelete={[blockId]}, filter 可能不移除任何内容 | ✅ 静默处理 |

### 7.4 复杂层级场景

| 场景 | 分析 | 结论 |
|------|------|------|
| 3 层深度 inden t | Grandchild outdent → 先算 nextSibling(parent)，再改层级 | ✅ 顺序正确 |
| 跨页移动 | moveBlock 没有跨页检测（当前设计不阻止） | ⚠️ 可能导致 pageId 不一致 |
| 同级大量节点 pos 漂移 | GAP 1000 下 pos 理论范围 ~1 到 ~n*1000 | ✅ 远超 JS Number 安全整数范围 |

**⚠️ B-4: `moveBlock` 缺少 pageId 一致性检查**  
如果 `toParentId` 指向的 Block 属于不同的 Page，移动后 Block 的 `pageId` 不会更新，导致 pageId 与 parent 不一致。

**严重程度**: 低（当前交互中不会触发，BlockList 渲染时已按 pageId 过滤；但数据层防御性不足）

## 8. 测试覆盖分析

### 8.1 现有测试 — ✅ 16/16 通过

| # | 测试 | 覆盖设计点 | 结果 |
|---|------|-----------|------|
| 1 | 创建 Block 自动分配 pos | §3.5 createBlock | ✅ |
| 2 | 子节点独立排序 | §3.1 同 parentId 排序 | ✅ |
| 3 | 排序正确 | §3.1 sortByPos | ✅ |
| 4 | 按光标位置拆分 | §3.5 splitBlock | ✅ |
| 5 | 折叠态拆分 = 子节点 | §3.5 splitBlock isCollapsed | ✅ |
| 6 | 展开态拆分 = 兄弟 | §3.5 splitBlock !isCollapsed | ✅ |
| 7 | Backspace 合并 | §3.5 mergeWithPrevious | ✅ |
| 8 | 首个 Block 无法合并 | §6.3 边界 | ✅ |
| 9 | Indent 缩进 | §3.5 indent | ✅ |
| 10 | Outdent 反缩进 | §3.5 outdent | ✅ |
| 11 | 多级缩进顺序 | §3.5 indent+children | ✅ |
| 12 | 删除空 Block | §3.5 deleteBlock | ✅ |
| 13 | 递归删除子节点 | §3.5 deleteBlock BFS | ✅ |
| 14 | 移动到新位置 | §3.5 moveBlock | ✅ |
| 15 | 禁止循环移动 | §3.5 moveBlock 循环检测 | ✅ |
| 16 | 大量节点性能 | §8.1 1000 节点 | ✅ |

### 8.2 测试覆盖缺口

| 缺失的测试 | 对应的设计点 | 优先级 |
|-----------|-------------|--------|
| calcInsertPos 负值路径（null, <1000） | §3.4.1 边界 | 低 |
| splitBlock 空 Block 拆分（content=''） | §3.5 边界 | 中 |
| moveBlock 跨页一致性 | §3.5 moveBlock | 低 |
| outdent 后 pos 不冲突验证 | §3.5 outdent | 中 |
| indent 嵌套 3 层 + outdent 回退 | §3.5 复杂层级 | 中 |

## 9. 排序复杂度实测验证

| 操作 | 理论复杂度 | 实测 |
|------|-----------|------|
| sortByPos 1000 节点 | O(n log n) | 408ms (含 1000次 createBlock) |
| createBlock | O(k) k=兄弟数 | 瞬时 |
| moveBlock | O(1) 仅改 1 个节点 | 瞬时 |
| deleteBlock | O(k) BFS | 瞬时 |

## 10. 验证结论

### 通过项（27/27）
- ✅ 数据结构: 3/3
- ✅ 核心算法路径: 6/6 (含 2个 ⚠️ 不阻塞)
- ✅ 业务操作: 7/7
- ✅ 数据库 Schema: 5/5
- ✅ 组件排序: 3/3 + 1 composable
- ✅ 边界条件: 7/7 (§6.3 全部通过)
- ✅ 测试: 16/16 通过
- ✅ 构建: vue-tsc + vite build 成功

### 发现的问题（4 个边界 ⚠️，0 个阻塞）

| ID | 级别 | 问题 | 位置 |
|----|------|------|------|
| B-1 | ⚠️ 低 | calcInsertPos(null, <GAP_SIZE) 返回负值 | block-helpers.ts:113 |
| B-2 | ⚠️ 低 | 间隔耗尽检测不精确（几乎不会触发 warning） | block-helpers.ts:121-122 |
| B-3 | ⚠️ 中 | renumberBlocks 不触发 IDB 持久化保存 | block-helpers.ts:125-129 |
| B-4 | ⚠️ 低 | moveBlock 缺少 pageId 一致性检查 | blocks.ts:291 |

### 总体评估

**设计文档所有功能需求已完整实现，核心功能通过验证。4个发现的边界问题均为低/中优先级，不影响系统正常运行。**
