# Block 排序机制重构设计文档

## 文档信息
- **版本**: v1.0
- **状态**: 已实施
- **日期**: 2026-04-27
- **前置文档**: `data-model.md`、`block-editor-spec.md`、`interaction-spec.md`

---

## 1. 问题分析

### 1.1 现状：`leftId` 链表排序方案

原 Block 使用 `leftId` 字段实现排序：

```typescript
interface Block {
  id: string
  pageId: string
  parentId: string | null
  leftId: string | null  // 指向前一个兄弟节点的 ID
  // ...其他字段
}
```

### 1.2 根本缺陷

| 缺陷 | 说明 |
|------|------|
| 排序算法错误 | `sortByLeftId` 使用 `localeCompare` 比较 UUID 字符串，完全无意义。UUID 的字典序与创建顺序无关 |
| 链表遍历缺失 | 整个代码库没有实现真正的链表遍历（`null → A → B → C`），所有"排序"都是错误的字符串比较 |
| 多处维护 `leftId` | `createBlock`、`indent`、`outdent`、`moveBlock`、`deleteBlock`、`splitBlock` 六处需手动维护，极易出错 |
| indent/outdent 顺序 bug | 先修改 `parentId` 再计算 `leftId`/`pos`，导致辅助函数查找到自身而非真正兄弟 |

---

## 2. 解决方案对比

| 方案 | 描述 | 优点 | 缺点 | 复杂度 |
|------|------|------|------|--------|
| **A. 修复链表遍历** | 实现正确的链表排序算法 | 保持现有数据结构 | 仍然复杂，易出错 | 高 |
| **B. 浮点 order** | 用 `order: number` 排序 | 简单直观 | 精度耗尽问题 | 中 |
| **C. Gap 整数排序** | 用 `pos: integer` + 间隔 | 简单、稳定、可预测 | 偶尔需要重编号 | 低 |
| **D. 嵌套集模型** | 用 `left/right` 边界 | 支持高效子树查询 | 插入/移动复杂 | 高 |

**选择方案 C**：Gap 整数排序，理由见 §3。

---

## 3. Gap 整数排序方案

### 3.1 核心思想

- 每个节点有一个 `pos: number` 字段，**直接存储在 Block 主数据结构中**
- 初始间隔为 1000（`GAP_SIZE`），预留足够的插入空间
- 同一 `parentId` 下的兄弟按 `pos` 升序排列
- 排序只需 `sort((a, b) => a.pos - b.pos)`，O(n log n)

### 3.2 数据结构定义

```typescript
// src/types/block.ts

/** Block — 核心数据模型 */
export interface Block {
  id: string
  pageId: string
  parentId: string | null
  pos: number           // 排序位置（Gap 排序，初始间隔 1000）
  content: string
  format: Record<string, any>
  type: 'bullet' | 'property' | 'query' | 'embed'
  properties: Record<string, any>
  createdAt: number
  updatedAt: number
}

/** IDB 存储格式（format/properties 序列化为 string） */
export interface BlockRecord {
  id: string
  pageId: string
  parentId: string | null
  pos: number
  content: string
  format: string
  type: string
  properties: string
  createdAt: number
  updatedAt: number
}
```

**关键变更**：
- `pos` 字段从 `BlockWithPos` 扩展接口**提升至 `Block` 主接口**，成为 Block 的固有属性
- **删除 `BlockWithPos` 类型定义**，改为 `type BlockWithPos = Block` 类型别名以兼容过渡期引用
- `pos` 字段**直接存储在 IndexedDB** 中（`BlockRecord.pos`），确保数据持久化

### 3.3 数据迁移说明

**无需进行历史数据迁移**。当前环境不存在真实业务数据，所有 Block 数据均为开发测试数据。Schema 升级（v2 → v3）时 Dexie 会自动处理索引重建。

### 3.4 核心算法

#### 3.4.1 位置计算 — `calcInsertPos`

```typescript
/**
 * 计算插入位置的 pos 值
 * @param prevPos 前一个节点的 pos（null 表示在开头）
 * @param nextPos 后一个节点的 pos（null 表示在末尾）
 * @returns 新节点的 pos 值
 */
export function calcInsertPos(prevPos: number | null, nextPos: number | null): number {
  if (prevPos === null && nextPos === null) return GAP_SIZE   // 空列表，第一个节点
  if (prevPos === null) return nextPos! - GAP_SIZE             // 插入到开头
  if (nextPos === null) return prevPos + GAP_SIZE              // 插入到末尾
  const mid = (prevPos + nextPos) / 2                          // 插入到中间
  if (mid === prevPos || mid === nextPos) {
    console.warn('[calcInsertPos] Gap exhausted, renumbering needed')
  }
  return mid
}
```

**间隔耗尽概率**：在间隔 1000 下，需要连续在同一位置插入 9 次才会耗尽（1000 → 500 → 250 → 125 → 62 → 31 → 15 → 7 → 3 → 1）。

#### 3.4.2 重编号 — `renumberBlocks`

当间隔耗尽时，对同一 `parentId` 下的兄弟节点重新分配均匀的 pos：

```typescript
export function renumberBlocks(blocks: Block[]): void {
  const sorted = sortByPos([...blocks])
  sorted.forEach((block, index) => {
    block.pos = (index + 1) * GAP_SIZE
  })
}
```

#### 3.4.3 关键规则：先计算 pos 再修改 parentId

这是从 leftId 迁移过程中发现的核心 bug 模式。**所有涉及层级变更的操作（indent、outdent）必须先计算新位置，再修改 parentId**：

```
❌ 错误顺序：
  block.parentId = newParentId    // 先改层级
  children = getChildren(prev.id) // getChildren 返回了 block 自身！
  block.pos = calcInsertPos(...)  // pos 计算错误

✅ 正确顺序：
  children = getChildren(prev.id) // block 还在原层级，结果正确
  newPos = calcInsertPos(...)     // pos 计算正确
  block.parentId = newParentId    // 最后改层级
  block.pos = newPos
```

### 3.5 各操作实现要点

#### 创建 Block（`createBlock`）

```
输入: pageId, content, parentId?
流程:
  1. 查找同 parentId 下的兄弟节点
  2. 取最后兄弟的 pos → lastPos
  3. newPos = calcInsertPos(lastPos, null)
  4. 创建 Block，pos = newPos
  5. 写入 IDB
```

#### 拆分 Block（`splitBlock`）

```
输入: blockId, cursorPos, isCollapsed?
流程:
  1. 按 cursorPos 截断内容为 before / after
  2. 保存当前 Block（content = before）
  3. 判断新 Block 的 parentId:
     - isCollapsed || 有子节点 → 作为当前 Block 的子节点
     - 否则 → 作为当前 Block 的兄弟
  4. 计算新 Block 的 pos:
     - 作为子节点: calcInsertPos(lastChildPos, null)
     - 作为兄弟: calcInsertPos(block.pos, nextSibling?.pos)
  5. 创建新 Block
```

#### 合并 Block（`mergeWithPrevious`）

```
输入: blockId
流程:
  1. 找到文档序前驱 prev
  2. prev.content += block.content
  3. 删除 block（级联删除子节点）
  4. 返回 { id: prev.id, cursorPos: prevContentLen + 1 }
注意: 不需要更新任何其他节点的 pos
```

#### 缩进（`indent`）

```
输入: blockId
前提: 存在前一个兄弟 prev
流程:
  1. 先计算: children = getChildren(prev.id)
  2. 先计算: newPos = calcInsertPos(lastChildPos, null)
  3. 后修改: block.parentId = prev.id
  4. 后修改: block.pos = newPos
  5. _scheduleSave(block)
```

#### 反缩进（`outdent`）

```
输入: blockId
前提: block.parentId !== null
流程:
  1. 找到父节点 parent
  2. 先计算: nextSibling = getNextSibling(parent)
  3. 先计算: newPos = calcInsertPos(parent.pos, nextSibling?.pos)
  4. 后修改: block.parentId = parent.parentId
  5. 后修改: block.pos = newPos
  6. _scheduleSave(block)
```

#### 移动 Block（`moveBlock`）

```
输入: blockId, toParentId, newIndex
流程:
  1. 循环检测: isDescendantOf(toParentId, blockId) → 拒绝
  2. 查找目标位置兄弟（排除自身）
  3. 计算 prevPos / nextPos
  4. block.parentId = toParentId
  5. block.pos = calcInsertPos(prevPos, nextPos)
  6. _scheduleSave(block)
注意: 不需要更新任何其他节点的 pos
```

#### 删除 Block（`deleteBlock`）

```
输入: blockId
流程:
  1. BFS 收集所有后代节点 ID
  2. 从 blocks.value 中移除
  3. storage.deleteBlockCascade(allIds)
注意: 不需要更新任何其他节点的 pos
```

### 3.6 排序复杂度对比

| 操作 | leftId 链表 | pos 整数 |
|------|------------|----------|
| 排序 n 个节点 | O(n²)（链表遍历）或 O(n log n)（但结果错误） | O(n log n)（数值比较，结果正确） |
| 创建节点 | 查找末节点 id + 设置 leftId | lastPos + GAP_SIZE |
| 移动节点 | 更新 3 个节点的 leftId | 更新 1 个节点的 pos |
| 删除节点 | 更新 nextSibling 的 leftId | 无需更新 |

---

## 4. 数据库 Schema

### 4.1 Schema 定义

```typescript
// src/storage/db.ts
this.version(3).stores({
  blocks: 'id, pageId, parentId, pos, createdAt, updatedAt',
  links: 'id, sourceBlockId, targetPageId, displayText, createdAt',
  pages: 'id, blockId, title, type, createdAt, updatedAt'
})
```

### 4.2 IDB 记录转换

```typescript
// recordToBlock: BlockRecord → Block（pos 直接映射）
function recordToBlock(record: BlockRecord): Block {
  return {
    id: record.id,
    pageId: record.pageId,
    parentId: record.parentId,
    pos: record.pos,            // 直接映射，无需转换
    content: record.content,
    format: JSON.parse(record.format),
    type: record.type as Block['type'],
    properties: JSON.parse(record.properties),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }
}

// blockToRecord: Block → BlockRecord（pos 直接映射）
function blockToRecord(block: Block): BlockRecord {
  return {
    id: block.id,
    pageId: block.pageId,
    parentId: block.parentId,
    pos: block.pos,             // 直接映射，无需转换
    content: block.content,
    format: JSON.stringify(block.format),
    type: block.type,
    properties: JSON.stringify(block.properties),
    createdAt: block.createdAt,
    updatedAt: block.updatedAt
  }
}
```

### 4.3 查询排序

```typescript
// getBlockTree: 按 pos 排序
async getBlockTree(pageId: string): Promise<Block[]> {
  const records = await db.blocks.where('pageId').equals(pageId).toArray()
  return records.map(recordToBlock).sort((a, b) => a.pos - b.pos)
}
```

---

## 5. 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/types/block.ts` | 修改 | `pos` 提升至 Block 主接口；删除 `BlockWithPos` 独立定义，改为类型别名 |
| `src/storage/db.ts` | 修改 | Schema v3，索引 `leftId` → `pos` |
| `src/storage/indexedDB.ts` | 修改 | recordToBlock/blockToRecord 映射 `pos`；getBlockTree 按 pos 排序；createPageWithBlock 使用 pos=1000 |
| `src/utils/block-helpers.ts` | 重写 | sortByPos、calcInsertPos、renumberBlocks、getPrevSibling/getNextSibling 等 |
| `src/stores/blocks.ts` | 重写 | 所有操作函数使用 pos；moveBlock 移除 fromParentId 参数 |
| `src/stores/blocks.test.ts` | 重写 | 16 个测试全部覆盖 pos 方案 |
| `src/components/BlockList.vue` | 修改 | 排序逻辑 `localeCompare(leftId)` → `a.pos - b.pos` |
| `src/components/Journal/JournalListItem.vue` | 修改 | 同上 |
| `src/components/Page/index.vue` | 修改 | 同上 |
| `src/composables/useSortable.ts` | 修改 | 移除 `fromParentId` 参数 |
| `docs/block-ordering-redesign.md` | 新建 | 本文档 |

---

## 6. 对 EnterAsBlockExtension 的影响分析

### 6.1 Extension 架构回顾

`EnterAsBlockExtension.ts` 是 tiptap 键盘快捷键扩展，**不包含任何业务逻辑**。它只做一件事：拦截键盘事件，派发 `enter-as-block` 自定义事件。

事件流：

```
键盘输入 → EnterAsBlockExtension（拦截判断）
  → 派发 CustomEvent('enter-as-block', { type, pos? })
    → Editor.vue handleEnterAsBlock() → emit(type)
      → Block.vue handleXxx() → blockStore.xxx()
```

Extension 的每个快捷键与 Block 操作的映射：

| 快捷键 | Extension 行为 | 派发事件 | Block.vue handler | blockStore 操作 | pos 影响 |
|--------|---------------|----------|-------------------|-----------------|----------|
| `Enter` | 拦截，`detail.type='split'` | `enter-as-block` | `handleSplit` | `splitBlock` | ⚠️ 见 §6.2 |
| `Backspace`（空 Block） | 拦截，`detail.type='delete'` | `enter-as-block` | `handleDelete` | `deleteBlock` | ✅ 无影响 |
| `Backspace`（光标在开头） | 拦截，`detail.type='merge'` | `enter-as-block` | `handleMerge` | `mergeWithPrevious` | ✅ 无影响 |
| `Tab` | 拦截，`detail.type='indent'` | `enter-as-block` | `handleIndent` | `indent` | ✅ 无影响 |
| `Shift-Tab` | 拦截，`detail.type='outdent'` | `enter-as-block` | `handleOutdent` | `outdent` | ✅ 无影响 |
| `ArrowUp`（光标在开头） | 拦截，`detail.type='moveUp'` | `enter-as-block` | `handleMoveUp` | `findPreviousBlockInTreeOrder` | ✅ 无影响 |
| `ArrowDown`（光标在末尾） | 拦截，`detail.type='moveDown'` | `enter-as-block` | `handleMoveDown` | `findNextBlockInTreeOrder` | ✅ 无影响 |
| `Escape` | 拦截，`detail.type='exitEdit'` | `enter-as-block` | `handleExitEdit` | `updateBlockContent` | ✅ 无影响 |
| `Ctrl/Cmd+S` | 拦截，`detail.type='save'` | `enter-as-block` | `handleSave` | `updateBlockContent` | ✅ 无影响 |

### 6.2 影响评估

**结论：EnterAsBlockExtension 无需任何代码修改。**

理由：

1. **Extension 是纯事件派发器**：它不操作 Block 数据结构，不引用 `pos`、`leftId` 或任何排序字段。唯一的"数据"是 `detail.type`（字符串枚举）和 `detail.pos`（ProseMirror 光标位置，与 Block.pos 无关）。

2. **所有 pos 相关逻辑在 blockStore 层**：`indent`、`outdent`、`splitBlock` 等操作的 pos 计算已完整实现在 `blocks.ts` 中，Extension 不感知也不需要感知。

3. **splitBlock 的 isCollapsed 参数**：`EnterAsBlockExtension` 不传递 `isCollapsed`，这是 Block.vue 在 `handleSplit` 中额外传入的（`collapsed.value`）。pos 方案下 `splitBlock` 的 `isCollapsed` 语义不变（折叠时创建子节点，展开时创建兄弟节点），无需修改交互逻辑。

4. **moveUp/moveDown 的树遍历**：`findPreviousBlockInTreeOrder` / `findNextBlockInTreeOrder` 内部已使用 `getSortedChildren`（按 pos 排序），无需修改。

### 6.3 边界条件验证

| 边界场景 | Extension 行为 | pos 方案下是否正确 | 说明 |
|----------|---------------|-------------------|------|
| 页面唯一空 Block 按 Backspace | `type='delete'` | ✅ | Block.vue 检测到无前驱，仅清空内容 |
| 折叠态 Block 按 Enter | `type='split'` | ✅ | `splitBlock` 传入 `isCollapsed=true`，新 Block 作为子节点 |
| 展开态 Block 有子节点按 Enter | `type='split'` | ✅ | `splitBlock` 检测 `childBlocks.length > 0`，新 Block 作为子节点 |
| 展开态 Block 无子节点按 Enter | `type='split'` | ✅ | 新 Block 作为兄弟节点 |
| 第一个 Block 按 Tab | `type='indent'` | ✅ | `indent` 检测无前驱兄弟，不操作 |
| 顶级 Block 按 Shift-Tab | `type='outdent'` | ✅ | `outdent` 检测 `parentId === null`，不操作 |
| 模态层打开时按 Tab/Enter/Escape | 返回 `false`（不拦截） | ✅ | `hasModalOpen()` 判断在前 |

### 6.4 交互规范一致性检查

对照 `interaction-spec.md`，pos 方案对以下交互规范的影响：

| 规范章节 | 操作 | pos 方案影响 | 需要更新交互规范？ |
|----------|------|-------------|-------------------|
| §3.1 Enter 拆分 | `splitBlock` | pos 计算代替 leftId 设置，外部行为不变 | 否 |
| §3.2 Backspace 合并 | `mergeWithPrevious` | 无影响（合并不涉及 pos 重排） | 否 |
| §3.3 Tab 缩进 | `indent` | 先算 pos 再改 parentId，外部行为不变 | 否 |
| §3.4 Shift+Tab 反缩进 | `outdent` | 先算 pos 再改 parentId，外部行为不变 | 否 |
| §3.5/3.6 方向键移动 | `findPrev/NextBlockInTreeOrder` | 内部按 pos 排序，外部行为不变 | 否 |
| §2.3 拖拽放置 | `moveBlock` | 移除 fromParentId，pos 计算更简单 | 否 |

**结论：无需更新 `interaction-spec.md`**。pos 方案是纯内部实现变更，所有交互行为的外部语义保持一致。

---

## 7. 风险与应对

| 风险 | 影响 | 应对措施 | 状态 |
|------|------|----------|------|
| 间隔耗尽 | 无法插入新节点 | `calcInsertPos` 检测并 warn，`renumberBlocks` 重新分配 | ✅ 已实现 |
| pos 冲突（同 parentId 下两个节点 pos 相同） | 排序不稳定 | 极少发生；`createBlock` 始终计算新 pos | ⚠️ 理论风险 |
| indent/outdent 先改 parentId 再算 pos | 树结构断裂 | 已修复：先算 pos 再改 parentId | ✅ 已修复 |
| Dexie Schema 升级丢失数据 | 数据丢失 | Dexie 版本升级仅重建索引，不删除数据；且无历史数据 | ✅ 无风险 |

---

## 8. 测试覆盖

### 8.1 单元测试（`blocks.test.ts`）

16 个测试用例，全部通过：

| # | 测试 | 验证的 pos 行为 |
|---|------|---------------|
| 1 | 创建 Block | pos 递增 GAP_SIZE |
| 2 | 排序正确 | sortByPos 结果正确 |
| 3 | 拆分 Block（展开态） | 新 Block 作为兄弟，pos 在当前和 nextSibling 之间 |
| 4 | 拆分 Block（折叠态） | 新 Block 作为子节点，pos 在 lastChild 之后 |
| 5 | 合并 Block | 删除当前 Block，prev.content 追加，无需更新 pos |
| 6 | 合并第一个 Block | 无前驱，不操作 |
| 7 | 删除 Block | 从列表移除，无需更新其他 pos |
| 8 | 递归删除子节点 | BFS 收集后代，批量移除 |
| 9 | 缩进 Block | parentId → prev.id，pos 插入到 prev 子节点末尾 |
| 10 | 缩进第一个 Block | 无前驱兄弟，不操作 |
| 11 | 反缩进 Block | parentId → parent.parentId，pos 插入到 parent 之后 |
| 12 | 反缩进顶级 Block | parentId === null，不操作 |
| 13 | 移动 Block | pos 计算到目标位置，parentId 更新 |
| 14 | 禁止循环移动 | isDescendantOf 检测 |
| 15 | 大量节点排序性能 | 1000 节点 < 500ms |
| 16 | 内容/格式/属性更新 | pos 不受影响 |

### 8.2 构建验证

```
✓ vue-tsc 类型检查通过
✓ vite build 成功
✓ 16/16 tests passed
```
