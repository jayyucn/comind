# 删除 Block 时整理语义关系

## 概述

为 comind 编辑器增加删除 Block 时的语义关系整理能力。当一个或多个 Block 被删除（单 block Backspace / 多选 Backspace / 未来其他删除路径）时，自动处理它们涉及到的 typed-link 关系，确保数据库不会出现"源端已删、目标端还挂着 typed 类型"的悬空引用。

## 需求

- 单 block 删除（`Block/index.vue` 的 `handleDelete`）触发语义关系整理
- 多选 Backspace 删除（`useCrossBlockSelection.deleteSelected`）触发同样的语义关系整理
- 同页内仍然有其他 Block 引用同一目标 → 不做任何处理（关系仍由其他 Block 维持）
- 同页内已无对同一目标的 typed-link → 跨页扫描目标页面，移除那些 `[[OurPage]]^(inverseType)` 形式的反向引用（降级为纯 `[[OurPage]]`，不删除链接本身）
- 仅处理带 `inverseRelationshipType` 的 link；单向 `^(depends-on)` 不参与跨页清理（无 inverse 概念）
- 降级采用文本正则替换，复用 `useRelationshipSync` 中的 `applyRelationshipTypeToBlockContent` 工具（如合适）

## 架构

### 组件

```
useBlockRelationshipCleanup   ←── 新增
       │
       │ cleanupAfterDelete(pageId, deletedBlockIds)
       │
       ├──► useBlockStore (deleteBlock / updateBlockContent)
       ├──► useRelationshipSync (refreshSnapshot，自动)
       └──► storage (links 表读 inverseRelationshipType)
```

### 职责边界

| Composable | 职责 |
|------------|------|
| `useRelationshipSync` | 维护**同页** typed-link 类型快照（已有） |
| `useBlockRelationshipCleanup` | 跨页反向清理：把目标页面的反向 typed-link 降级（新增） |
| `useCrossBlockSelection.deleteSelected` | 协调多选删除 + 调用 cleanup（修改） |
| `Block/index.vue handleDelete` | 协调单 block 删除 + 调用 cleanup（修改） |

## 数据流

```
deleteSelected(blockIds) 或 handleDelete(blockId)
  │
  └─► cleanupAfterDelete(pageId, [blockId, ...])
        │
        ├─ 1. 收集 typed-link 目标
        │     对每个被删 block，扫描其 content 中的 [[X]]^(type<->invType) 和 [[X]]^(type!)
        │     收集 { targetTitle, inverseType } 去重集合
        │
        ├─ 2. blockStore.deleteBlock(ids)
        │     级联清理被删 block 的 link 表（links.where('sourceBlockId').anyOf(ids).delete()）
        │
        ├─ 3. 对每个 (targetTitle, inverseType)：
        │     扫描本页 SURVIVING blocks 是否有 typed-link 到 targetTitle
        │     ├─ 有 → 跳过（同页其他 Block 维持关系）
        │     └─ 无 → 跨页降级
        │            扫描全库 blocks，找出所有含 [[OurPage]]^(inverseType) 的 block
        │            用 applyRelationshipTypeToBlockContent(content, ourPageTitle, null) 降级
        │            blockStore.updateBlockContent(blockId, newContent) 持久化
        │
        └─ 4. 返回被修改的跨页 block 列表
```

## API 设计

```typescript
// src/composables/useBlockRelationshipCleanup.ts
import { useBlockStore } from '../stores/blocks'
import { parseBlockLinks } from '../utils/parser'
import { applyRelationshipTypeToBlockContent } from '../composables/useRelationshipSync'

export interface CleanupResult {
  /** 被修改的跨页 block（降级 typed-link 后被持久化的） */
  modifiedCrossPageBlocks: Array<{ id: string; pageId: string; content: string }>
  /** 被识别为需要跨页清理的目标集合 */
  orphanedTargets: Array<{ targetTitle: string; inverseType: string }>
}

export function useBlockRelationshipCleanup() {
  const blockStore = useBlockStore()

  /**
   * 在一组 Block 被删除后，整理它们涉及到的语义关系。
   *
   * 流程：
   * 1. 解析被删 blocks 中带 inverse 的 typed-link 目标
   * 2. 调 blockStore.deleteBlock 删除
   * 3. 对每个目标，若本页已无 typed-link 维持，跨页降级反向引用
   *
   * @param pageId 当前页面 ID（被删 block 所属页）
   * @param deletedBlockIds 被删除的 block ID 集合
   */
  async function cleanupAfterDelete(
    pageId: string,
    deletedBlockIds: string[]
  ): Promise<CleanupResult>

  return { cleanupAfterDelete }
}
```

## 关键决策

### 1. `inverseType` 来源

被删 block 的 typed-link 在 IndexedDB `links` 表中已有 `inverseRelationshipType` 字段（由 `saveBlock` 时 `parseBlockLinks` 写入）。无需重新解析块内容推断。

但注意：links 表的 `inverseRelationshipType` 仅对 `^()` 含 `<->` 或 `!` 修饰符的链接写入；纯 `^(depends-on)` 单向链接为 `null`。本次仅清理有 inverse 的关系。

### 2. 收集目标集合的方式

- 方案 a：直接读 IndexedDB `links` 表（跨 storage 层）
- 方案 b：从 `blockStore.blocks` 内存中解析 `content`（用 `parseBlockLinks`）

选择 **方案 b**：
- 单次删除涉及的 block 通常 1~10 个，内存中已有快照
- 避免跨 storage 调用，更易测试
- `parseBlockLinks` 已能完整解析 typed-link 信息

### 3. 跨页降级工具

复用 `useRelationshipSync` 内部 `applyRelationshipTypeToBlockContent(content, targetTitle, null)`：
- 该函数是 `useRelationshipSync` 的私有函数
- 需要从 `useRelationshipSync.ts` export 出来

如不愿导出私有函数，可在 `useBlockRelationshipCleanup.ts` 内独立实现一份（成本约 30 行）。

### 4. 跨页扫描策略

不一次性 `getAllBlocks()`，而是：
- `blockStore.blocks` 已在内存中（来自初始化时 `getAllBlocks`）
- 一次 filter + some 即可

```ts
const targetPageBlocks = blockStore.blocks.filter(b => b.pageId === targetPageId)
for (const block of targetPageBlocks) {
  const links = parseBlockLinks(block.content)
  const hasInverse = links.some(l =>
    l.targetTitle === ourPageTitle && l.relationshipType === inverseType
  )
  if (hasInverse) {
    const newContent = applyRelationshipTypeToBlockContent(block.content, ourPageTitle, null)
    if (newContent !== block.content) {
      await blockStore.updateBlockContent(block.id, newContent)
    }
  }
}
```

注意：这里 `applyRelationshipTypeToBlockContent` 第二个参数是"目标标题"，传 `ourPageTitle` 是因为我们要把 `[[OurPage]]^(invType)` 降级。但工具函数的入参语义是"对所有指向 targetTitle 的链接应用类型"——传 `ourPageTitle` 时，它会对**所有**指向 OurPage 的链接移除 `^(...)`，不仅仅是 inverse 类型。这可能误伤！

需仔细审视 `applyRelationshipTypeToBlockContent` 的实现：

```ts
function applyRelationshipTypeToBlockContent(
  content: string,
  targetTitle: string,
  newRelationshipType: string | null
): string {
  // 匹配 [[target]] 或 [[target|alias]]，可选带 ^(relationType)
  const withTypeRegex = new RegExp(
    `\\[\\[(${escapedTitle})(?:\\|[^\\]]+?)?\\]\\]\\^?\\(([^)]+)\\)`,
    'g'
  )
  // ...
  // 第一步：替换已带关系类型的链接
  let result = content.replace(withTypeRegex, (match) => {
    const baseMatch = match.match(/^\[\[[^\]]+?\]\]/)
    if (!baseMatch) return match
    if (newRelationshipType === null) return baseMatch[0]  // 移除 ^(...)
    return `${baseMatch[0]}^(${newRelationshipType})`
  })
}
```

问题：传入 `ourPageTitle` + `null`，它会**移除**所有 `[[OurPage]]^(任意类型)` 的类型后缀。**这是符合我们意图的**——我们要的就是把"指向我们页面的所有 typed-link 降级"，因为从目标页面的视角看，对方的 typed-link 都没有了 inverse。

实际上更准确：因为我们删的是 source，反向链接失去意义，typed-link 类型应该一律降级。**工具函数现有行为恰好对**。

### 5. `pageId` 注入

`useBlockRelationshipCleanup` 不接受 pageId 注入。`Block/index.vue` 的 `handleDelete` 通过 props.pageId 传入；`useCrossBlockSelection.deleteSelected` 当前没有 pageId 上下文（composable 是单例），需要：
- 选项 a：`useCrossBlockSelection` 接受 pageId 参数（从 BlockList 注入）
- 选项 b：被删 block 自己有 pageId，从 `blockStore.blocks` 中读

选择 **选项 b**：避免改动 `useCrossBlockSelection` 的现有 API。`pageId` 集合取 `deletedBlockIds` 映射 `blockStore.blocks` 的 pageId 唯一集合（通常为单值，因为 `useCrossBlockSelection` 是按页选区）。

但若选区跨页（极端情况），`cleanupAfterDelete` 应接受 `pageId: string[]` 或在内部推导。本次取 pageId 唯一集合，对每页分别 cleanup。

## 集成点

### `Block/index.vue` 的 `handleDelete`

```ts
async function handleDelete() {
  const prevBlock = blockStore.findPreviousBlockInTreeOrder(blockId.value)
  const prevId = prevBlock?.id

  if (!prevId) {
    if (editorRef.value) editorRef.value.markSaved()
    await blockStore.updateBlockContent(blockId.value, '')
    return
  }

  if (editorRef.value) editorRef.value.markSaved()
  editorStore.deactivateBlock()
  
  // 新增：调用关系清理
  await relationshipCleanup.cleanupAfterDelete(props.pageId, [blockId.value])
  
  if (prevId) {
    editorStore.activateBlock(prevId)
  }
}
```

### `useCrossBlockSelection.ts` 的 `deleteSelected`

```ts
const relationshipCleanup = useBlockRelationshipCleanup()

async function deleteSelected() {
  if (anchorIds.size === 0) return
  const toDelete = [...anchorIds]
  anchorIds.clear()
  
  // 推导 pageId 唯一集合
  const pageIds = new Set<string>()
  for (const id of toDelete) {
    const b = blockStore.blocks.find(x => x.id === id)
    if (b) pageIds.add(b.pageId)
  }
  
  for (const pageId of pageIds) {
    await relationshipCleanup.cleanupAfterDelete(pageId, toDelete)
  }
}
```

## 边界条件

| 场景 | 行为 |
|------|------|
| `deletedBlockIds` 为空 | 立即 return，不做 IO |
| 被删 block 无 typed-link（只有纯 `[[X]]`） | 不收集目标，跨页不写入 |
| 被删 block 仅含单向 `^(depends-on)`（无 inverse） | 不做跨页清理（无 inverse 概念） |
| 同页 SURVIVING block 仍含 typed-link 到目标 X | 跳过（其他 Block 维持关系） |
| 同页 SURVIVING block 仅含纯 `[[X]]`（无 `^(...)`） | 视作"无 typed-link 维持"，触发跨页清理 |
| 目标页面无 `^(inverseType)` 引用 | 扫描空结果，零写入 |
| 多选删除跨多个 pageId | 每页分别 cleanup |
| 目标页面已被删除 | `inverseType` 仅在 Link 表中存在；目标页无内容则无 block 可改，安全 |
| 跨页降级涉及多个 block | 全部降级，独立持久化 |

## 已知遗留

- `useCrossBlockSelection.deleteSelected` **不级联删除子块**（anchorIds 不含后代）。父块被删后子块仍留存——与 `blockStore.deleteBlock` 的级联行为不一致，需要后续单独决定。本次范围不涉及。
- 本次不处理「概念图谱」缓存的失效（`RightSidebar`），图谱通过 watch 重新计算，理应自愈。
- `applyRelationshipTypeToBlockContent` 当前是 `useRelationshipSync` 私有函数，需要 export 出来供 `useBlockRelationshipCleanup` 复用。

## 测试策略

### 单元测试：`useBlockRelationshipCleanup.test.ts`

| 用例 | 验证 |
|------|------|
| 空 deletedBlockIds | 无 IO 调用 |
| 被删 block 无 typed-link | 跨页不写入 |
| 被删 block 仅含单向 `^(depends-on)` | 不做跨页清理 |
| 被删 block 含 `^(depends-on<->required-by)` 双向 | 跨页扫描找到 `[[OurPage]]^(required-by)` → 降级 |
| 同页 SURVIVING block 仍含 typed-link 到目标 X | 不做跨页清理 |
| 同页 SURVIVING block 仅含纯 `[[X]]` | 触发跨页清理 |
| 目标页面有多个 block 含 inverse | 全部降级 |
| 跨页降级后调 `blockStore.updateBlockContent` | spy 验证 |
| 删除前快照与删除后一致 | 不残留已删 block 的 link |

### 集成测试（回归）

- `useCrossBlockSelection.test.ts` 中 `deleteSelected` 新增断言：被删 block 含 typed-link 时 `cleanupAfterDelete` 被调
- `Block/index.test.ts` 中 `handleDelete` 新增断言：删除后 `cleanupAfterDelete` 被调

### 编译检查

- `vue-tsc -b`（TypeScript 类型检查）
- `vite build`（构建）
- `vitest run`（单元测试）
